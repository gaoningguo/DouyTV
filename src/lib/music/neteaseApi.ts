/**
 * 网易云音源适配器，两种传输模式归一到同一 MusicSong/MusicPlayResult：
 *  - builtin  ：前端直连 music.163.com。搜索走免加密 GET /api/search/get，
 *               播放链走 weapi POST，歌词走 GET /api/song/lyric。全平台零部署。
 *  - external ：用户自部署的 NeteaseCloudMusicApi 实例（REST /cloudsearch、
 *               /song/url/v1、/lyric/new）。
 * 经 scriptFetch（Tauri 下 Rust ureq，绕 WebView CORS、走用户代理）。
 * 已 curl 匿名验证：搜索/播放链/歌词均可用，免费曲 320k、版权曲 128k，VIP 曲 url=null（交上层回落解灰）。
 */
import { scriptFetch } from "@/source-script/fetch";
import { weapiEncrypt } from "./neteaseCrypto";
import type {
  MusicLyricResult,
  MusicPlayResult,
  MusicQuality,
  MusicSearchResult,
  MusicSong,
  MusicSourceDescriptor,
} from "./types";
import { asNumber, asRecord, asString, cleanBaseUrl, unwrapArray } from "./utils";

const NETEASE_BASE = "https://music.163.com";
const DIRECT_HEADERS: Record<string, string> = {
  Referer: "https://music.163.com",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  Cookie: "os=pc; appver=2.9.7",
};

/** 网易音质等级映射（对应 /song/url/v1 的 level 参数）。 */
function neteaseLevel(quality: MusicQuality): string {
  switch (quality) {
    case "128k":
      return "standard";
    case "192k":
      return "higher";
    case "320k":
      return "exhigh";
    case "flac":
      return "lossless";
    case "flac24bit":
      return "hires";
    default:
      return "exhigh";
  }
}

function isExternal(source: MusicSourceDescriptor): boolean {
  if (source.neteaseMode === "external") return true;
  if (source.neteaseMode === "builtin") return false;
  return !!cleanBaseUrl(source.baseUrl);
}

function headersFor(source: MusicSourceDescriptor): Record<string, string> {
  return { ...DIRECT_HEADERS, ...(source.headers ?? {}) };
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await scriptFetch(url, { headers, timeout: 15000 });
  if (!res.ok) throw new Error((await res.text()) || `请求失败 ${res.status}`);
  return res.json<unknown>();
}

/** weapi 加密 POST（仅 builtin 直连用）。 */
async function weapiPost(endpoint: string, payload: unknown): Promise<unknown> {
  const { params, encSecKey } = await weapiEncrypt(payload);
  const body = `params=${encodeURIComponent(params)}&encSecKey=${encodeURIComponent(encSecKey)}`;
  const res = await scriptFetch(`${NETEASE_BASE}/weapi/${endpoint}`, {
    method: "POST",
    headers: { ...DIRECT_HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
    body,
    timeout: 15000,
  });
  if (!res.ok) throw new Error((await res.text()) || `请求失败 ${res.status}`);
  return res.json<unknown>();
}

function pickArtists(item: Record<string, unknown>): string {
  const arr = Array.isArray(item.ar)
    ? item.ar
    : Array.isArray(item.artists)
      ? item.artists
      : [];
  const names = arr
    .map((a) => asString(asRecord(a)?.name))
    .filter((name): name is string => !!name);
  return names.join(" / ");
}

function pickAlbum(item: Record<string, unknown>): Record<string, unknown> | undefined {
  return asRecord(item.al) ?? asRecord(item.album);
}

/** 网易歌曲对象（/api/search/get 与 /cloudsearch 两种字段形态都覆盖）→ MusicSong。 */
export function normalizeNeteaseSong(
  source: MusicSourceDescriptor,
  input: unknown
): MusicSong | null {
  const item = asRecord(input);
  if (!item) return null;
  const id = asString(item.id);
  const title = asString(item.name);
  if (!id || !title) return null;
  const album = pickAlbum(item);
  const durationMs = asNumber(item.dt) ?? asNumber(item.duration);
  return {
    id,
    sourceId: source.id,
    sourceName: source.name,
    title,
    artist: pickArtists(item) || "未知歌手",
    album: asString(album?.name),
    cover: asString(album?.picUrl) || asString(item.picUrl),
    durationSec: durationMs ? Math.round(durationMs / 1000) : undefined,
    platform: "wy",
    songmid: id,
    raw: item,
  };
}

export async function searchNeteaseApi(
  source: MusicSourceDescriptor,
  keyword: string,
  page: number,
  limit: number
): Promise<MusicSearchResult> {
  const offset = (page - 1) * limit;
  const url = isExternal(source)
    ? `${cleanBaseUrl(source.baseUrl)}/cloudsearch?keywords=${encodeURIComponent(
        keyword
      )}&type=1&limit=${limit}&offset=${offset}`
    : `${NETEASE_BASE}/api/search/get?s=${encodeURIComponent(
        keyword
      )}&type=1&limit=${limit}&offset=${offset}`;
  const payload = await getJson(url, headersFor(source));
  const record = asRecord(payload);
  const result = asRecord(record?.result);
  const rawList = Array.isArray(result?.songs) ? result?.songs : unwrapArray(payload);
  const list = (rawList ?? [])
    .map((item) => normalizeNeteaseSong(source, item))
    .filter((item): item is MusicSong => !!item);
  const total = asNumber(result?.songCount) ?? list.length;
  return { list, page, limit, hasMore: offset + list.length < total };
}

function normalizeLyricPayload(payload: unknown): MusicLyricResult {
  const record = asRecord(payload);
  return {
    lyric: asString(asRecord(record?.lrc)?.lyric) || "",
    tlyric: asString(asRecord(record?.tlyric)?.lyric) || undefined,
    yrc: asString(asRecord(record?.yrc)?.lyric) || undefined,
    romalrc: asString(asRecord(record?.romalrc)?.lyric) || undefined,
  };
}

async function fetchNeteaseLyric(
  source: MusicSourceDescriptor,
  id: string
): Promise<MusicLyricResult> {
  try {
    const url = isExternal(source)
      ? `${cleanBaseUrl(source.baseUrl)}/lyric/new?id=${encodeURIComponent(id)}`
      : `${NETEASE_BASE}/api/song/lyric/v1?id=${encodeURIComponent(
          id
        )}&lv=-1&kv=-1&tv=-1&rv=-1&yv=1&ytv=1&yrc=1`;
    return normalizeLyricPayload(await getJson(url, headersFor(source)));
  } catch {
    return { lyric: "" };
  }
}

export async function resolveNeteaseApi(
  source: MusicSourceDescriptor,
  song: MusicSong,
  quality: MusicQuality
): Promise<MusicPlayResult> {
  const level = neteaseLevel(quality);
  const lyric = await fetchNeteaseLyric(source, song.id);

  let payload: unknown;
  if (isExternal(source)) {
    payload = await getJson(
      `${cleanBaseUrl(source.baseUrl)}/song/url/v1?id=${encodeURIComponent(
        song.id
      )}&level=${level}`,
      headersFor(source)
    );
  } else {
    payload = await weapiPost("song/enhance/player/url/v1", {
      ids: `[${song.id}]`,
      level,
      encodeType: "flac",
    });
  }
  const record = asRecord(payload);
  const data = Array.isArray(record?.data) ? asRecord(record?.data[0]) : asRecord(record?.data);
  const url = asString(data?.url);
  if (!url) {
    throw new Error("网易匿名播放链不可用（版权/VIP），可回落其它源");
  }
  const br = asNumber(data?.br);
  return {
    url,
    directUrl: url,
    quality: br && br >= 900000 ? "flac" : br && br >= 320000 ? "320k" : br && br >= 192000 ? "192k" : "128k",
    lyric: lyric.lyric,
    tlyric: lyric.tlyric,
    yrc: lyric.yrc,
    romalrc: lyric.romalrc,
  };
}
