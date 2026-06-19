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
  MusicSongListSummary,
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

/**
 * 网易反爬哨兵：内置直连匿名访问富接口（artist/album/cloudsearch 多类型）常返回
 * code -462。UI 据此显示「该页面需自部署网易源」降级提示，而非静默空白。
 */
export class NeteaseAntiBotError extends Error {
  code = -462;
  constructor(message = "网易反爬限制：该接口需自部署 NeteaseCloudMusicApi 源") {
    super(message);
    this.name = "NeteaseAntiBotError";
  }
}

export function isNeteaseAntiBotError(error: unknown): error is NeteaseAntiBotError {
  return error instanceof NeteaseAntiBotError;
}

/** 命中 -462 即抛哨兵，让上层走降级提示而非当作空数据。 */
function assertNotAntiBot(record: Record<string, unknown> | null | undefined): void {
  if (asNumber(record?.code) === -462) throw new NeteaseAntiBotError();
}

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

// ───────────────────────── 富页面数据（批2）─────────────────────────
// 仅网易源可用；built-in 直连 music.163.com，external 走 NeteaseCloudMusicApi。
// 评论/推荐歌单匿名可用；相似歌曲 built-in 被反爬挡(code -462)→ 降级空列表，external 正常。

export interface NeteaseComment {
  id: string;
  nickname: string;
  avatar?: string;
  content: string;
  liked: number;
  timeText?: string;
  hot: boolean;
}

function normalizeComment(input: unknown, hot: boolean): NeteaseComment | null {
  const item = asRecord(input);
  if (!item) return null;
  const content = asString(item.content);
  if (!content) return null;
  const user = asRecord(item.user);
  return {
    id: asString(item.commentId) || asString(item.time) || content.slice(0, 12),
    nickname: asString(user?.nickname) || "网易云用户",
    avatar: asString(user?.avatarUrl),
    content,
    liked: asNumber(item.likedCount) ?? 0,
    timeText: asString(item.timeStr) || undefined,
    hot,
  };
}

/** 歌曲评论（热评 + 最新）。 */
export async function getNeteaseComments(
  source: MusicSourceDescriptor,
  songId: string,
  limit = 20
): Promise<NeteaseComment[]> {
  const url = isExternal(source)
    ? `${cleanBaseUrl(source.baseUrl)}/comment/music?id=${encodeURIComponent(songId)}&limit=${limit}`
    : `${NETEASE_BASE}/api/v1/resource/comments/R_SO_4_${encodeURIComponent(
        songId
      )}?limit=${limit}&offset=0`;
  const record = asRecord(await getJson(url, headersFor(source)));
  const hot = (Array.isArray(record?.hotComments) ? record?.hotComments : [])
    .map((item) => normalizeComment(item, true))
    .filter((item): item is NeteaseComment => !!item);
  const latest = (Array.isArray(record?.comments) ? record?.comments : [])
    .map((item) => normalizeComment(item, false))
    .filter((item): item is NeteaseComment => !!item);
  // 去重(热评常与最新重叠)，热评优先。
  const seen = new Set(hot.map((c) => c.id));
  return [...hot, ...latest.filter((c) => !seen.has(c.id))];
}

/** 相似歌曲。built-in 反爬挡返回空，external 正常。 */
export async function getNeteaseSimiSongs(
  source: MusicSourceDescriptor,
  songId: string
): Promise<MusicSong[]> {
  try {
    const url = isExternal(source)
      ? `${cleanBaseUrl(source.baseUrl)}/simi/song?id=${encodeURIComponent(songId)}`
      : `${NETEASE_BASE}/api/v1/discovery/simiSong?songid=${encodeURIComponent(
          songId
        )}&limit=30&offset=0`;
    const record = asRecord(await getJson(url, headersFor(source)));
    if (asNumber(record?.code) === -462) return []; // 反爬验证，built-in 拿不到
    const rawList = Array.isArray(record?.songs) ? record?.songs : [];
    return (rawList ?? [])
      .map((item) => normalizeNeteaseSong(source, item))
      .filter((item): item is MusicSong => !!item);
  } catch {
    return [];
  }
}

/** 推荐歌单（首页个性化推荐，匿名可用）。 */
export async function getNeteasePersonalized(
  source: MusicSourceDescriptor,
  limit = 12
): Promise<MusicSongListSummary[]> {
  const url = isExternal(source)
    ? `${cleanBaseUrl(source.baseUrl)}/personalized?limit=${limit}`
    : `${NETEASE_BASE}/api/personalized/playlist?limit=${limit}`;
  const record = asRecord(await getJson(url, headersFor(source)));
  const rawList = Array.isArray(record?.result) ? record?.result : [];
  return (rawList ?? [])
    .map((item): MusicSongListSummary | null => {
      const row = asRecord(item);
      const id = asString(row?.id);
      const name = asString(row?.name);
      if (!id || !name) return null;
      return {
        id,
        name,
        source: "wy",
        pic: asString(row?.picUrl),
        playCount: asNumber(row?.playCount) ?? undefined,
      };
    })
    .filter((item): item is MusicSongListSummary => !!item);
}

/** 解析网易歌单链接/ID(对齐 CyreneMusic playlistImportService.parseNeteaseId)。 */
export function parseNeteasePlaylistInput(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  const q = trimmed.match(/[?&]id=(\d+)/);
  if (q) return q[1];
  if (trimmed.includes("music.163.com")) {
    const m = trimmed.match(/playlist\/(\d+)/);
    if (m) return m[1];
  }
  return null;
}

/** 歌单内歌曲（点开推荐歌单时载入）。built-in 用 v6 playlist/detail，external 用 /playlist/track/all。 */
export async function getNeteasePlaylistSongs(
  source: MusicSourceDescriptor,
  playlistId: string,
  limit = 50
): Promise<MusicSong[]> {
  const url = isExternal(source)
    ? `${cleanBaseUrl(source.baseUrl)}/playlist/track/all?id=${encodeURIComponent(
        playlistId
      )}&limit=${limit}`
    : `${NETEASE_BASE}/api/v6/playlist/detail?id=${encodeURIComponent(playlistId)}&n=${limit}`;
  const record = asRecord(await getJson(url, headersFor(source)));
  // external /playlist/track/all → {songs:[]}；built-in v6 → {playlist:{tracks:[]}}
  const rawList = Array.isArray(record?.songs)
    ? record?.songs
    : Array.isArray(asRecord(record?.playlist)?.tracks)
      ? asRecord(record?.playlist)?.tracks
      : [];
  return ((rawList as unknown[]) ?? [])
    .slice(0, limit)
    .map((item) => normalizeNeteaseSong(source, item))
    .filter((item): item is MusicSong => !!item);
}

/** 歌单搜索（cloudsearch type=1000）。external 可用；built-in 受反爬 -462 限制 → 降级空列表。 */
export async function searchNeteasePlaylists(
  source: MusicSourceDescriptor,
  keyword: string,
  limit = 20
): Promise<MusicSongListSummary[]> {
  try {
    const url = isExternal(source)
      ? `${cleanBaseUrl(source.baseUrl)}/cloudsearch?keywords=${encodeURIComponent(
          keyword
        )}&type=1000&limit=${limit}`
      : `${NETEASE_BASE}/api/search/get?s=${encodeURIComponent(
          keyword
        )}&type=1000&limit=${limit}`;
    const record = asRecord(await getJson(url, headersFor(source)));
    if (asNumber(record?.code) === -462) return [];
    const result = asRecord(record?.result);
    const rawList = Array.isArray(result?.playlists) ? result?.playlists : [];
    return (rawList ?? [])
      .map((item): MusicSongListSummary | null => {
        const row = asRecord(item);
        const id = asString(row?.id);
        const name = asString(row?.name);
        if (!id || !name) return null;
        return {
          id,
          name,
          source: "wy",
          pic: asString(row?.coverImgUrl) || asString(row?.picUrl),
          author: asString(asRecord(row?.creator)?.nickname),
          playCount: asNumber(row?.playCount) ?? undefined,
          total: asNumber(row?.trackCount) ?? undefined,
        };
      })
      .filter((item): item is MusicSongListSummary => !!item);
  } catch {
    return [];
  }
}

/** 推荐新歌(/personalized/newsong,匿名可用)→ 可播放歌曲。对齐 SPlayer rec.ts personalized("newsong")。 */
export async function getNeteaseNewSongRecommend(
  source: MusicSourceDescriptor,
  limit = 30
): Promise<MusicSong[]> {
  const url = isExternal(source)
    ? `${cleanBaseUrl(source.baseUrl)}/personalized/newsong?limit=${limit}`
    : `${NETEASE_BASE}/api/personalized/newsong?limit=${limit}`;
  const record = asRecord(await getJson(url, headersFor(source)));
  if (asNumber(record?.code) === -462) return [];
  const rawList = Array.isArray(record?.result) ? record?.result : [];
  return (rawList ?? [])
    .map((item) => {
      const row = asRecord(item);
      // 每项含完整 song 对象(/personalized/newsong 形态);回退用项自身。
      return normalizeNeteaseSong(source, asRecord(row?.song) ?? row);
    })
    .filter((item): item is MusicSong => !!item);
}

// ── MV / 视频(端点对齐 SPlayer src/api/video.ts、rec.ts)──

export interface NeteaseMv {
  id: string;
  name: string;
  cover?: string;
  artist?: string;
  playCount?: number;
  durationSec?: number;
}

function pickMvArtist(item: Record<string, unknown>): string {
  if (Array.isArray(item.artists)) {
    return item.artists
      .map((a) => asString(asRecord(a)?.name))
      .filter(Boolean)
      .join(" / ");
  }
  return asString(item.artistName) || "";
}

/** MV 列表:个性化推荐(/personalized/mv,内置匿名可列)。 */
export async function getNeteaseMvList(source: MusicSourceDescriptor): Promise<NeteaseMv[]> {
  const url = isExternal(source)
    ? `${cleanBaseUrl(source.baseUrl)}/personalized/mv`
    : `${NETEASE_BASE}/api/personalized/mv`;
  const record = asRecord(await getJson(url, headersFor(source)));
  const rawList = Array.isArray(record?.result) ? record?.result : [];
  return (rawList ?? [])
    .map((item): NeteaseMv | null => {
      const row = asRecord(item);
      const id = asString(row?.id);
      const name = asString(row?.name);
      if (!id || !name) return null;
      const durationMs = asNumber(row?.duration);
      return {
        id,
        name,
        cover: asString(row?.picUrl) || asString(row?.cover),
        artist: row ? pickMvArtist(row) : "",
        playCount: asNumber(row?.playCount) ?? undefined,
        durationSec: durationMs ? Math.round(durationMs / 1000) : undefined,
      };
    })
    .filter((item): item is NeteaseMv => !!item);
}

/** MV 播放地址(/mv/url?id=&r=,对齐 SPlayer videoUrl)。built-in 受反爬限制可能失败。 */
export async function getNeteaseMvUrl(
  source: MusicSourceDescriptor,
  id: string,
  r = 1080
): Promise<string> {
  const url = isExternal(source)
    ? `${cleanBaseUrl(source.baseUrl)}/mv/url?id=${encodeURIComponent(id)}&r=${r}`
    : `${NETEASE_BASE}/api/mv/url?id=${encodeURIComponent(id)}&r=${r}`;
  const record = asRecord(await getJson(url, headersFor(source)));
  const data = asRecord(record?.data);
  const playUrl = asString(data?.url);
  if (!playUrl) throw new Error("MV 地址不可用(内置源受网易反爬限制,建议自部署源)");
  return playUrl;
}

// ── 电台 / 播客(端点对齐 SPlayer src/api/radio.ts;节目按 formatSongsList 取 mainTrackId)──

/** 电台推荐(/dj/recommend)。external 可用;built-in 受限降级。 */
export async function getNeteaseRadioRecommend(
  source: MusicSourceDescriptor
): Promise<MusicSongListSummary[]> {
  try {
    const url = isExternal(source)
      ? `${cleanBaseUrl(source.baseUrl)}/dj/recommend`
      : `${NETEASE_BASE}/api/djradio/recommend`;
    const record = asRecord(await getJson(url, headersFor(source)));
    if (asNumber(record?.code) === -462) return [];
    const rawList = Array.isArray(record?.djRadios)
      ? record?.djRadios
      : Array.isArray(record?.data)
        ? record?.data
        : [];
    return (rawList ?? [])
      .map((item): MusicSongListSummary | null => {
        const row = asRecord(item);
        const id = asString(row?.id);
        const name = asString(row?.name);
        if (!id || !name) return null;
        return {
          id,
          name,
          source: "wy",
          pic: asString(row?.picUrl),
          author: asString(asRecord(row?.dj)?.nickname),
          desc: asString(row?.rcmdtext) || asString(row?.desc),
          total: asNumber(row?.programCount) ?? undefined,
        };
      })
      .filter((item): item is MusicSongListSummary => !!item);
  } catch {
    return [];
  }
}

/** 电台全部节目(/dj/program?rid=) → 可播放歌曲(id 取 mainTrackId/mainSong.id,对齐 SPlayer formatSongsList)。 */
export async function getNeteaseRadioPrograms(
  source: MusicSourceDescriptor,
  rid: string,
  limit = 100
): Promise<MusicSong[]> {
  const url = isExternal(source)
    ? `${cleanBaseUrl(source.baseUrl)}/dj/program?rid=${encodeURIComponent(rid)}&limit=${limit}`
    : `${NETEASE_BASE}/api/dj/program?rid=${encodeURIComponent(rid)}&limit=${limit}`;
  const record = asRecord(await getJson(url, headersFor(source)));
  if (asNumber(record?.code) === -462) return [];
  const programs = Array.isArray(record?.programs) ? record?.programs : [];
  return (programs ?? [])
    .map((item): MusicSong | null => {
      const row = asRecord(item);
      if (!row) return null;
      // 播放 id：mainTrackId / mainSong.id（对齐 SPlayer：radio 类型用 dj.id 取 song/url）。
      const playId =
        asString(row.mainTrackId) || asString(asRecord(row.mainSong)?.id) || asString(row.id);
      const name = asString(row.name);
      if (!playId || !name) return null;
      const durationMs = asNumber(row.duration);
      return {
        id: playId,
        sourceId: source.id,
        sourceName: source.name,
        title: name,
        artist: asString(asRecord(row.dj)?.brand) || asString(asRecord(row.dj)?.nickname) || "播客",
        cover: asString(row.coverUrl) || asString(asRecord(row.mainSong)?.picUrl),
        durationSec: durationMs ? Math.round(durationMs / 1000) : undefined,
        platform: "wy",
        songmid: playId,
        raw: row,
      };
    })
    .filter((item): item is MusicSong => !!item);
}

// ───────────────────────── 歌手 / 专辑真接口（批 R1）─────────────────────────
// 端点对齐 SPlayer src/api/{artist,album,search,rec}.ts + CyreneMusic artistService。
// external 自部署 NCM 完整可用；builtin 直连基本被 -462 反爬挡 → 抛 NeteaseAntiBotError。

/** 歌手广场/搜索用的轻量歌手卡。 */
export interface NeteaseArtist {
  id: string;
  name: string;
  cover?: string;
  alias?: string[];
}

/** 歌手详情聚合（头部资料 + 热门歌曲）。 */
export interface NeteaseArtistDetail {
  artist: {
    id: string;
    name: string;
    cover?: string;
    briefDesc?: string;
    musicSize?: number;
    albumSize?: number;
    mvSize?: number;
  };
  songs: MusicSong[];
}

function normalizeArtistCard(input: unknown): NeteaseArtist | null {
  const row = asRecord(input);
  const id = asString(row?.id);
  const name = asString(row?.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    cover: asString(row?.picUrl) || asString(row?.img1v1Url) || asString(row?.cover),
    alias: Array.isArray(row?.alias)
      ? row?.alias.map((a) => asString(a)).filter((a): a is string => !!a)
      : undefined,
  };
}

/**
 * 歌手详情 + 热门歌曲。external `/artists?id=`（热门50首 + artist 资料），
 * builtin `/api/v1/artist/{id}`（多半 -462）。
 */
export async function getNeteaseArtist(
  source: MusicSourceDescriptor,
  id: string
): Promise<NeteaseArtistDetail> {
  const url = isExternal(source)
    ? `${cleanBaseUrl(source.baseUrl)}/artists?id=${encodeURIComponent(id)}`
    : `${NETEASE_BASE}/api/v1/artist/${encodeURIComponent(id)}`;
  const record = asRecord(await getJson(url, headersFor(source)));
  assertNotAntiBot(record);
  const artist = asRecord(record?.artist) ?? {};
  const rawSongs = Array.isArray(record?.hotSongs)
    ? record?.hotSongs
    : Array.isArray(record?.songs)
      ? record?.songs
      : [];
  return {
    artist: {
      id: asString(artist.id) || id,
      name: asString(artist.name) || "未知歌手",
      cover: asString(artist.picUrl) || asString(artist.img1v1Url) || asString(artist.cover),
      briefDesc: asString(artist.briefDesc) || undefined,
      musicSize: asNumber(artist.musicSize) ?? undefined,
      albumSize: asNumber(artist.albumSize) ?? undefined,
      mvSize: asNumber(artist.mvSize) ?? undefined,
    },
    songs: ((rawSongs as unknown[]) ?? [])
      .map((item) => normalizeNeteaseSong(source, item))
      .filter((item): item is MusicSong => !!item),
  };
}

/** 歌手专辑（/artist/album?id=）→ 复用 MusicSongListSummary 承载专辑卡。 */
export async function getNeteaseArtistAlbums(
  source: MusicSourceDescriptor,
  id: string,
  limit = 30
): Promise<MusicSongListSummary[]> {
  const url = isExternal(source)
    ? `${cleanBaseUrl(source.baseUrl)}/artist/album?id=${encodeURIComponent(id)}&limit=${limit}`
    : `${NETEASE_BASE}/api/artist/albums/${encodeURIComponent(id)}?limit=${limit}`;
  const record = asRecord(await getJson(url, headersFor(source)));
  assertNotAntiBot(record);
  const rawList = Array.isArray(record?.hotAlbums)
    ? record?.hotAlbums
    : Array.isArray(record?.albums)
      ? record?.albums
      : [];
  return ((rawList as unknown[]) ?? [])
    .map((item): MusicSongListSummary | null => {
      const row = asRecord(item);
      const albumId = asString(row?.id);
      const name = asString(row?.name);
      if (!albumId || !name) return null;
      return {
        id: albumId,
        name,
        source: "wy",
        pic: asString(row?.picUrl) || asString(row?.coverImgUrl) || asString(row?.blurPicUrl),
        author: asString(asRecord(row?.artist)?.name),
        total: asNumber(row?.size) ?? undefined,
        updateFrequency: asString(row?.company) || undefined,
      };
    })
    .filter((item): item is MusicSongListSummary => !!item);
}

/** 歌手分类列表（/artist/list）。type -1全部/1男/2女/3乐队；area -1/7华语/96欧美/8日本/16韩国/0其他。 */
export async function getNeteaseArtistList(
  source: MusicSourceDescriptor,
  options: { type?: number; area?: number; initial?: number | string; limit?: number; offset?: number } = {}
): Promise<NeteaseArtist[]> {
  const { type = -1, area = -1, initial = -1, limit = 60, offset = 0 } = options;
  if (!isExternal(source)) {
    // builtin 直连无匿名 /artist/list（-462），直接抛哨兵交 UI 降级。
    throw new NeteaseAntiBotError();
  }
  const url =
    `${cleanBaseUrl(source.baseUrl)}/artist/list?type=${type}&area=${area}` +
    `&initial=${encodeURIComponent(String(initial))}&limit=${limit}&offset=${offset}`;
  const record = asRecord(await getJson(url, headersFor(source)));
  assertNotAntiBot(record);
  const rawList = Array.isArray(record?.artists) ? record?.artists : [];
  return ((rawList as unknown[]) ?? [])
    .map(normalizeArtistCard)
    .filter((item): item is NeteaseArtist => !!item);
}

/** 热门歌手（/top/artists）。 */
export async function getNeteaseTopArtists(
  source: MusicSourceDescriptor,
  limit = 60
): Promise<NeteaseArtist[]> {
  if (!isExternal(source)) throw new NeteaseAntiBotError();
  const record = asRecord(
    await getJson(`${cleanBaseUrl(source.baseUrl)}/top/artists?limit=${limit}`, headersFor(source))
  );
  assertNotAntiBot(record);
  const rawList = Array.isArray(record?.artists) ? record?.artists : [];
  return ((rawList as unknown[]) ?? [])
    .map(normalizeArtistCard)
    .filter((item): item is NeteaseArtist => !!item);
}

/** 搜索歌手（cloudsearch type=100）。external 可用；builtin -462 → 抛哨兵。 */
export async function searchNeteaseArtists(
  source: MusicSourceDescriptor,
  keyword: string,
  limit = 30
): Promise<NeteaseArtist[]> {
  const url = isExternal(source)
    ? `${cleanBaseUrl(source.baseUrl)}/cloudsearch?keywords=${encodeURIComponent(
        keyword
      )}&type=100&limit=${limit}`
    : `${NETEASE_BASE}/api/search/get?s=${encodeURIComponent(keyword)}&type=100&limit=${limit}`;
  const record = asRecord(await getJson(url, headersFor(source)));
  assertNotAntiBot(record);
  const result = asRecord(record?.result);
  const rawList = Array.isArray(result?.artists) ? result?.artists : [];
  return ((rawList as unknown[]) ?? [])
    .map(normalizeArtistCard)
    .filter((item): item is NeteaseArtist => !!item);
}

/** 专辑详情（/album?id=）→ 专辑资料 + 曲目。 */
export interface NeteaseAlbumDetail {
  album: {
    id: string;
    name: string;
    cover?: string;
    artist?: string;
    desc?: string;
    publishTime?: number;
  };
  songs: MusicSong[];
}

export async function getNeteaseAlbum(
  source: MusicSourceDescriptor,
  id: string
): Promise<NeteaseAlbumDetail> {
  const url = isExternal(source)
    ? `${cleanBaseUrl(source.baseUrl)}/album?id=${encodeURIComponent(id)}`
    : `${NETEASE_BASE}/api/v1/album/${encodeURIComponent(id)}`;
  const record = asRecord(await getJson(url, headersFor(source)));
  assertNotAntiBot(record);
  const album = asRecord(record?.album) ?? {};
  const rawSongs = Array.isArray(record?.songs) ? record?.songs : [];
  return {
    album: {
      id: asString(album.id) || id,
      name: asString(album.name) || "未知专辑",
      cover: asString(album.picUrl) || asString(album.coverImgUrl) || asString(album.blurPicUrl),
      artist: asString(asRecord(album.artist)?.name),
      desc: asString(album.description) || asString(album.briefDesc) || undefined,
      publishTime: asNumber(album.publishTime) ?? undefined,
    },
    songs: ((rawSongs as unknown[]) ?? [])
      .map((item) => normalizeNeteaseSong(source, item))
      .filter((item): item is MusicSong => !!item),
  };
}

/** 按歌手名解析真歌手 id（用于派生歌手名 → 真歌手页跳转）。 */
export async function resolveNeteaseArtistId(
  source: MusicSourceDescriptor,
  name: string
): Promise<string | null> {
  if (!name.trim()) return null;
  try {
    const list = await searchNeteaseArtists(source, name, 1);
    return list[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * 热搜榜（对齐 SPlayer search.ts searchHot → /search/hot/detail）。
 * external 走 NCM，builtin 走 /api/search/hot（匿名可用，含 searchWord 列表）。
 * 返回关键词数组，供搜索面板「热门搜索」展示——替代自造推荐打分。
 */
export async function getNeteaseHotSearch(
  source: MusicSourceDescriptor,
  limit = 10
): Promise<string[]> {
  try {
    const url = isExternal(source)
      ? `${cleanBaseUrl(source.baseUrl)}/search/hot/detail`
      : `${NETEASE_BASE}/api/search/hot`;
    const record = asRecord(await getJson(url, headersFor(source)));
    if (asNumber(record?.code) === -462) return [];
    // external /search/hot/detail → {data:[{searchWord}]}；builtin /api/search/hot → {result:{hots:[{first}]}}
    const external = Array.isArray(record?.data) ? record?.data : [];
    const builtin = Array.isArray(asRecord(record?.result)?.hots)
      ? asRecord(record?.result)?.hots
      : [];
    const rows = external.length > 0 ? external : (builtin ?? []);
    return ((rows as unknown[]) ?? [])
      .map((item) => {
        const row = asRecord(item);
        return asString(row?.searchWord) || asString(row?.first) || asString(row?.keyword);
      })
      .filter((word): word is string => !!word)
      .slice(0, limit);
  } catch {
    return [];
  }
}
