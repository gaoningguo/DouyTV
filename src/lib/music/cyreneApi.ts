/**
 * CyreneMusic 聚合音源适配器（nekofun 风格后端）。
 *  - 搜索/元数据：OmniParse 多平台 REST（/search、/qq/search、/kugou/search）。
 *    ⚠️ OmniParse 源码只暴露 netease/qq/kugou，无 /kuwo/*，故不含酷我。
 *  - 播放解析：三种模式（对应 CyreneMusic audioSourceService 的 AudioSourceType）：
 *      omni    —— {playBase}/song?id=&quality=…（OmniParse，默认）
 *      tunehub —— TuneHub V3：POST {playBase}/v1/parse + X-API-Key（按文档实测）
 *      lx      —— {playBase}/url/{source}/{id}/{quality}
 * 已验证：nekofun 公共实例搜索可用；播放链在公共实例 404（公共聚合器禁播放），需用户填自有后端。
 */
import { scriptFetch } from "@/source-script/fetch";
import { getLxRuntimeMusicUrl } from "./lxRuntime";
import type {
  MusicPlayResult,
  MusicPlatform,
  MusicQuality,
  MusicSearchResult,
  MusicSong,
  MusicSourceDescriptor,
} from "./types";
import { normalizeMusicPlatform } from "./types";
import { asNumber, asRecord, asString, cleanBaseUrl } from "./utils";

// OmniParse 源码仅 netease/qq/kugou，无酷我端点。
const DEFAULT_PLATFORMS: MusicPlatform[] = ["wy", "tx", "kg"];

interface PlatformSpec {
  path: string; // 搜索子路径
  method: "GET" | "POST";
  list: (payload: Record<string, unknown>) => unknown[];
}

// OmniParse 搜索端点（源码 src/index.ts 实测：仅 /search、/qq/search、/kugou/search）。
// 酷我(kw)/咪咕(mg) 无端点。酷狗搜索返回 {name,hash,album_id,emixsongid,...}。
const SEARCH_SPECS: Partial<Record<MusicPlatform, PlatformSpec>> = {
  wy: { path: "/search", method: "POST", list: (p) => arr(p.result) },
  tx: { path: "/qq/search", method: "GET", list: (p) => arr(p.result) },
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
    // OmniParse /kugou/song 只认 emixsongid（签名参数 encode_album_audio_id），不接受 hash。
    id = asString(item.emixsongid) || "";
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

/** TuneHub V3 音质档位(/v1/parse 的 quality 参数)。仅 128k/320k/flac/flac24bit;192k 归一到 320k。 */
function tunehubQuality(quality: MusicQuality): string {
  switch (quality) {
    case "128k":
      return "128k";
    case "flac":
      return "flac";
    case "flac24bit":
      return "flac24bit";
    default:
      return "320k";
  }
}

/**
 * TuneHub V3 播放解析:POST {base}/v1/parse + header X-API-Key,返回 data.data[0]。
 * (旧实现用的 GET ?type=url 在 V3 不存在,真实服务返回 404。)
 */
async function resolveTunehub(
  source: MusicSourceDescriptor,
  song: MusicSong,
  platform: MusicPlatform,
  quality: MusicQuality
): Promise<MusicPlayResult> {
  const base = playBase(source);
  if (!base) throw new Error("TuneHub 缺少后端地址");
  const src = TUNEHUB_SOURCE[platform];
  if (!src) throw new Error(`TuneHub 不支持平台 ${platform}(仅 netease/qq/kuwo)`);
  if (!source.token) throw new Error("TuneHub 需要 API Key(在音源 token 填写 th_ 开头的 key)");

  const res = await scriptFetch(`${base}/v1/parse`, {
    method: "POST",
    headers: {
      ...headersFor(source),
      "Content-Type": "application/json",
      "X-API-Key": source.token,
    },
    json: { platform: src, ids: song.id, quality: tunehubQuality(quality) },
    timeout: 15000,
  });
  if (!res.ok) {
    throw new Error((await res.text()) || `TuneHub 请求失败 ${res.status}`);
  }
  const record = asRecord(await res.json<unknown>());
  if (!record) throw new Error("TuneHub 返回格式异常");
  const code = asNumber(record.code);
  if (code !== undefined && code !== 0) {
    throw new Error(asString(record.message) || `TuneHub 错误码 ${code}`);
  }
  const data = asRecord(record.data);
  const first = Array.isArray(data?.data) ? asRecord(data?.data[0]) : undefined;
  const direct = asString(first?.url);
  if (!direct) {
    throw new Error(asString(first?.error) || "TuneHub 未返回播放地址(积分不足/版权)");
  }
  return {
    url: direct,
    directUrl: direct,
    quality: asString(first?.actualQuality) || quality,
    headers: source.headers,
    lyric: asString(first?.lyrics) || undefined,
  };
}

function buildOmniUrl(base: string, platform: MusicPlatform, id: string, q: string): string {
  switch (platform) {
    case "wy":
      return `${base}/song?id=${encodeURIComponent(id)}&quality=${q}&type=json`;
    case "tx":
      return `${base}/qq/song?ids=${encodeURIComponent(id)}&quality=${q}`;
    case "kg":
      // OmniParse /kugou/song 只认 emixsongid（id 即搜索结果的 emixsongid）。
      return `${base}/kugou/song?emixsongid=${encodeURIComponent(id)}&quality=${q}`;
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
  const platform = (normalizeMusicPlatform(song.platform) || "wy") as MusicPlatform;
  const mode = source.cyreneMode ?? "omni";

  // LX runtime 模式:执行脚本里的 request 处理器算签名取直链(无静态后端地址)。
  if (mode === "lx" && source.lxMode === "runtime") {
    const code = source.code;
    if (!code) throw new Error("洛雪执行源缺少脚本源码");
    const lxCode = LX_SOURCE_CODE[platform];
    if (!lxCode) throw new Error(`LX 不支持平台 ${platform}`);
    const cacheKey = `${source.id}:${source.updatedAt ?? 0}`;
    const direct = await getLxRuntimeMusicUrl(cacheKey, code, lxCode, song.id, String(quality));
    return { url: direct, directUrl: direct, quality, headers: source.headers };
  }

  // TuneHub V3:独立的 POST /v1/parse 流程(响应结构与 omni/lx 不同,提前返回)。
  if (mode === "tunehub") {
    return resolveTunehub(source, song, platform, quality);
  }

  const base = playBase(source);
  if (!base) throw new Error("聚合源缺少播放后端地址");

  let url = "";
  if (mode === "lx") {
    const code = LX_SOURCE_CODE[platform];
    if (!code) throw new Error(`LX 不支持平台 ${platform}`);
    // 优先用导入脚本里解析出的 urlPathTemplate（含 {source}/{songId}/{quality} 占位），
    // 否则回退默认 /url/{source}/{songId}/{quality}（对齐 CyreneMusic buildLxMusicUrl）。
    const template = source.urlPathTemplate || "/url/{source}/{songId}/{quality}";
    const path = template
      .replace("{source}", code)
      .replace("{songId}", encodeURIComponent(song.id))
      .replace("{quality}", String(quality));
    url = `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  } else {
    url = buildOmniUrl(base, platform, song.id, omniQuality(quality));
  }
  if (!url) throw new Error("无法为该平台构建播放地址");

  const res = await scriptFetch(url, { headers: headersFor(source), timeout: 15000 });
  if (!res.ok) throw new Error((await res.text()) || `获取播放地址失败 ${res.status}`);
  // 后端可能直接返回音频字节、JSON、或纯文本 URL。
  const text = await res.text();
  let direct = "";
  let lyric: string | undefined;
  let tlyric: string | undefined;
  if (/^https?:\/\//i.test(text.trim())) {
    direct = text.trim();
  } else {
    try {
      const payload = JSON.parse(text);
      direct = extractPlayUrl(payload) ?? "";
      // OmniParse /song 顶层带 lyric/tlyric；/qq/song 为 lyric:{lyric,tylyric}。一并取出，省一次歌词请求。
      const record = asRecord(payload);
      const lyricObj = asRecord(record?.lyric);
      lyric = asString(record?.lyric) || asString(lyricObj?.lyric) || undefined;
      tlyric = asString(record?.tlyric) || asString(lyricObj?.tylyric) || asString(lyricObj?.tlyric) || undefined;
    } catch {
      direct = "";
    }
  }
  if (!direct) throw new Error("聚合源未返回可用播放地址（可能版权/实例禁播放）");
  return { url: direct, directUrl: direct, quality, headers: source.headers, lyric, tlyric };
}

// ── 发现页/弱音源补充接口（OmniParse 已暴露但此前未调用）──

/**
 * OmniParse 网易内置榜单：GET {base}/toplists → {status, toplists:[{name, list/songs:[...]}]}。
 * 4 个网易榜单（飙升/新歌/原创/热歌，每榜约 20 首），每首按 wy 平台归一。
 * 发现页榜单展示用，免走网易直连被反爬。失败返回空数组。
 */
export async function getOmniToplists(
  source: MusicSourceDescriptor
): Promise<Array<{ name: string; list: MusicSong[] }>> {
  const base = cleanBaseUrl(source.baseUrl);
  if (!base) return [];
  try {
    const res = await scriptFetch(`${base}/toplists`, {
      headers: headersFor(source),
      timeout: 15000,
    });
    if (!res.ok) return [];
    const payload = asRecord(await res.json<unknown>());
    const toplists = arr(payload?.toplists);
    return toplists
      .map((entry) => {
        const record = asRecord(entry);
        if (!record) return null;
        const name = asString(record.name);
        if (!name) return null;
        const rawList = arr(record.list).length > 0 ? arr(record.list) : arr(record.songs);
        const list = rawList
          .map((item) => normalizeCyreneSong(source, "wy", item))
          .filter((item): item is MusicSong => !!item);
        return { name, list };
      })
      .filter((entry): entry is { name: string; list: MusicSong[] } => !!entry);
  } catch {
    return [];
  }
}

/**
 * OmniParse 抖音 BGM 解析：GET {base}/douyin?url={分享链接或文案} →
 * {code, data:{results:[{aweme_id, desc, author, music:{url}, video:{cover}}]}}。
 * 提取每项 music.url 作可播音频（title 取 desc，cover 取 video.cover）。
 * 弱音源（抖音 BGM）。失败返回空数组。
 */
export interface OmniDouyinTrack {
  url: string;
  title?: string;
  cover?: string;
}

export async function getOmniDouyinMusic(
  source: MusicSourceDescriptor,
  shareUrlOrText: string
): Promise<OmniDouyinTrack[]> {
  const base = cleanBaseUrl(source.baseUrl);
  if (!base || !shareUrlOrText) return [];
  try {
    const res = await scriptFetch(
      `${base}/douyin?url=${encodeURIComponent(shareUrlOrText)}`,
      { headers: headersFor(source), timeout: 15000 }
    );
    if (!res.ok) return [];
    const payload = asRecord(await res.json<unknown>());
    const data = asRecord(payload?.data);
    const results = arr(data?.results);
    return results
      .map((entry): OmniDouyinTrack | null => {
        const record = asRecord(entry);
        if (!record) return null;
        const music = asRecord(record.music);
        const url = asString(music?.url);
        if (!url) return null;
        const video = asRecord(record.video);
        return {
          url,
          title: asString(record.desc) || undefined,
          cover: asString(video?.cover) || undefined,
        };
      })
      .filter((entry): entry is OmniDouyinTrack => !!entry);
  } catch {
    return [];
  }
}

/**
 * OmniParse 网易歌词：复用 omni 的 /song 接口（GET，参数与 buildOmniUrl 严格对齐：
 * id / quality / type=json），取其顶层 lyric/tlyric（或嵌套 lyric:{lyric,tylyric}）。
 * 当播放走 omni 时可省一次额外歌词请求。失败返回空对象。
 */
export async function getOmniNeteaseLyric(
  source: MusicSourceDescriptor,
  id: string
): Promise<{ lyric: string; tlyric?: string }> {
  const base = playBase(source);
  if (!base || !id) return { lyric: "" };
  try {
    const res = await scriptFetch(buildOmniUrl(base, "wy", id, "exhigh"), {
      headers: headersFor(source),
      timeout: 15000,
    });
    if (!res.ok) return { lyric: "" };
    const payload = asRecord(await res.json<unknown>());
    if (!payload) return { lyric: "" };
    const lyricObj = asRecord(payload.lyric);
    const lyric = asString(payload.lyric) || asString(lyricObj?.lyric) || "";
    const tlyric =
      asString(payload.tlyric) ||
      asString(lyricObj?.tylyric) ||
      asString(lyricObj?.tlyric) ||
      undefined;
    return { lyric, tlyric };
  } catch {
    return { lyric: "" };
  }
}
