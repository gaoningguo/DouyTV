/**
 * CyreneMusic 聚合音源适配器（nekofun 风格后端）。
 *  - 搜索/元数据：多平台 REST（/search、/qq/search、/kuwo/search、/kugou/search），各平台响应形态不同。
 *  - 播放解析：三种模式（对应 CyreneMusic audioSourceService 的 AudioSourceType）：
 *      omni    —— {playBase}/song?id=&quality=…（OmniParse，默认）
 *      tunehub —— {playBase}/api/?type=url&source=&id=&br=
 *      lx      —— {playBase}/url/{source}/{id}/{quality}
 * 已验证：nekofun 公共实例搜索可用；播放链在公共实例 404（公共聚合器禁播放），需用户填自有后端。
 */
import { scriptFetch } from "@/source-script/fetch";
import type {
  MusicPlayResult,
  MusicPlatform,
  MusicQuality,
  MusicSearchResult,
  MusicSong,
  MusicSourceDescriptor,
} from "./types";
import { normalizeMusicPlatform } from "./types";
import { asRecord, asString, cleanBaseUrl } from "./utils";

const DEFAULT_PLATFORMS: MusicPlatform[] = ["wy", "tx", "kw", "kg"];

interface PlatformSpec {
  path: string; // 搜索子路径
  method: "GET" | "POST";
  list: (payload: Record<string, unknown>) => unknown[];
}

// 各平台搜索端点（与 CyreneMusic urlService/searchService 一致）。mg 无 nekofun 端点，略。
const SEARCH_SPECS: Partial<Record<MusicPlatform, PlatformSpec>> = {
  wy: { path: "/search", method: "POST", list: (p) => arr(p.result) },
  tx: { path: "/qq/search", method: "GET", list: (p) => arr(p.result) },
  kw: { path: "/kuwo/search", method: "GET", list: (p) => arr(asRecord(p.data)?.songs) },
  kg: { path: "/kugou/search", method: "GET", list: (p) => arr(p.result) },
};

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function headersFor(source: MusicSourceDescriptor): Record<string, string> {
  return { Accept: "application/json", ...(source.headers ?? {}) };
}

function playBase(source: MusicSourceDescriptor): string {
  return cleanBaseUrl(source.playBaseUrl) || cleanBaseUrl(source.baseUrl);
}

function sourcePlatforms(source: MusicSourceDescriptor): MusicPlatform[] {
  if (source.defaultPlatform && source.defaultPlatform !== "all") return [source.defaultPlatform];
  const configured = (source.platforms ?? [])
    .map((item) => normalizeMusicPlatform(item))
    .filter((item): item is MusicPlatform => !!item && item in SEARCH_SPECS);
  return configured.length > 0 ? configured : DEFAULT_PLATFORMS;
}

/** 各平台搜索结果对象 → MusicSong（id 取该平台播放所需的标识）。 */
function normalizeCyreneSong(
  source: MusicSourceDescriptor,
  platform: MusicPlatform,
  input: unknown
): MusicSong | null {
  const item = asRecord(input);
  if (!item) return null;
  const title = asString(item.name);
  if (!title) return null;

  let id = "";
  if (platform === "tx") {
    id = asString(item.mid) || asString(item.id) || "";
  } else if (platform === "kg") {
    const hash = asString(item.hash);
    const albumId = asString(item.album_id) || "0";
    id = hash ? `${hash}:${albumId}` : asString(item.emixsongid) || "";
  } else if (platform === "kw") {
    id = asString(item.rid) || asString(item.id) || "";
  } else {
    id = asString(item.id) || "";
  }
  if (!id) return null;

  return {
    id,
    sourceId: source.id,
    sourceName: source.name,
    title,
    artist:
      asString(item.artists) ||
      asString(item.singer) ||
      asString(item.artist) ||
      "未知歌手",
    album: asString(item.album) || asString(asRecord(item.album)?.name),
    cover: asString(item.picUrl) || asString(item.pic) || asString(item.img),
    platform,
    songmid: platform === "tx" ? asString(item.mid) : undefined,
    raw: item,
  };
}

async function searchPlatform(
  source: MusicSourceDescriptor,
  platform: MusicPlatform,
  keyword: string,
  limit: number
): Promise<MusicSong[]> {
  const spec = SEARCH_SPECS[platform];
  const base = cleanBaseUrl(source.baseUrl);
  if (!spec || !base) return [];
  const headers = headersFor(source);
  let payload: unknown;
  if (spec.method === "POST") {
    const res = await scriptFetch(`${base}${spec.path}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
      body: `keywords=${encodeURIComponent(keyword)}&limit=${limit}`,
      timeout: 15000,
    });
    if (!res.ok) return [];
    payload = await res.json<unknown>();
  } else {
    const res = await scriptFetch(
      `${base}${spec.path}?keywords=${encodeURIComponent(keyword)}&limit=${limit}`,
      { headers, timeout: 15000 }
    );
    if (!res.ok) return [];
    payload = await res.json<unknown>();
  }
  const record = asRecord(payload) ?? {};
  return spec
    .list(record)
    .map((item) => normalizeCyreneSong(source, platform, item))
    .filter((item): item is MusicSong => !!item)
    .slice(0, limit);
}

export async function searchCyrene(
  source: MusicSourceDescriptor,
  keyword: string,
  page: number,
  limit: number
): Promise<MusicSearchResult> {
  // 聚合后端按平台分别搜，结果合并。分页交由各平台（nekofun 多数仅首页）。
  const platforms = sourcePlatforms(source);
  const settled = await Promise.allSettled(
    platforms.map((platform) => searchPlatform(source, platform, keyword, limit))
  );
  const list = settled.flatMap((item) => (item.status === "fulfilled" ? item.value : []));
  return { list, page, limit, hasMore: false };
}

// ── 播放解析 ──

function omniQuality(quality: MusicQuality): string {
  switch (quality) {
    case "128k":
      return "standard";
    case "flac":
      return "lossless";
    case "flac24bit":
      return "hires";
    default:
      return "exhigh";
  }
}

const LX_SOURCE_CODE: Partial<Record<MusicPlatform, string>> = {
  wy: "wy",
  tx: "tx",
  kg: "kg",
  kw: "kw",
};
const TUNEHUB_SOURCE: Partial<Record<MusicPlatform, string>> = {
  wy: "netease",
  tx: "qq",
  kw: "kuwo",
};

function buildOmniUrl(base: string, platform: MusicPlatform, id: string, q: string): string {
  switch (platform) {
    case "wy":
      return `${base}/song?id=${encodeURIComponent(id)}&quality=${q}&type=json`;
    case "tx":
      return `${base}/qq/song?ids=${encodeURIComponent(id)}&quality=${q}`;
    case "kw":
      return `${base}/kuwo/song?mid=${encodeURIComponent(id)}&quality=${q}`;
    case "kg": {
      if (id.includes(":")) {
        const [hash, albumId] = id.split(":");
        return `${base}/kugou/song?hash=${hash}&album_audio_id=${albumId || "0"}&quality=${q}`;
      }
      return `${base}/kugou/song?emixsongid=${encodeURIComponent(id)}&quality=${q}`;
    }
    default:
      return "";
  }
}

function extractPlayUrl(payload: unknown): string | undefined {
  if (typeof payload === "string") return payload;
  const record = asRecord(payload);
  if (!record) return undefined;
  const data = record.data;
  if (typeof data === "string") return data;
  const first = Array.isArray(data) ? asRecord(data[0]) : undefined;
  return asString(record.url) || asString(asRecord(data)?.url) || asString(first?.url);
}

export async function resolveCyrene(
  source: MusicSourceDescriptor,
  song: MusicSong,
  quality: MusicQuality
): Promise<MusicPlayResult> {
  const base = playBase(source);
  if (!base) throw new Error("聚合源缺少播放后端地址");
  const platform = (normalizeMusicPlatform(song.platform) || "wy") as MusicPlatform;
  const mode = source.cyreneMode ?? "omni";

  let url = "";
  if (mode === "tunehub") {
    const src = TUNEHUB_SOURCE[platform];
    if (!src) throw new Error(`TuneHub 不支持平台 ${platform}`);
    url = `${base}/api/?type=url&source=${src}&id=${encodeURIComponent(song.id)}&br=${quality}`;
  } else if (mode === "lx") {
    const code = LX_SOURCE_CODE[platform];
    if (!code) throw new Error(`LX 不支持平台 ${platform}`);
    url = `${base}/url/${code}/${encodeURIComponent(song.id)}/${quality}`;
  } else {
    url = buildOmniUrl(base, platform, song.id, omniQuality(quality));
  }
  if (!url) throw new Error("无法为该平台构建播放地址");

  const res = await scriptFetch(url, { headers: headersFor(source), timeout: 15000 });
  if (!res.ok) throw new Error((await res.text()) || `获取播放地址失败 ${res.status}`);
  // 后端可能直接返回音频字节、JSON、或纯文本 URL。
  const text = await res.text();
  let direct = "";
  if (/^https?:\/\//i.test(text.trim())) {
    direct = text.trim();
  } else {
    try {
      direct = extractPlayUrl(JSON.parse(text)) ?? "";
    } catch {
      direct = "";
    }
  }
  if (!direct) throw new Error("聚合源未返回可用播放地址（可能版权/实例禁播放）");
  return { url: direct, directUrl: direct, quality, headers: source.headers };
}
