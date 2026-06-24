/**
 * 网易云灰曲解灰 —— 把 UnblockNeteaseMusic 的可前端化 provider 移植成 TS,
 * 经本项目的 scriptFetch(Rust ureq 出网,绕 CORS)请求各音乐平台。
 *
 * 移植范围(照 UNM src/provider/*):kuwo / kugou / migu / bodian / pyncmd。
 * youtube/yt-dlp 依赖本地二进制、bilibili 需登录 cookie + 回源代理,前端无法移植,略。
 *
 * 编排照 UNM match.js:对每个候选源「搜索关键词 → 按时长 ±5s 匹配 → 取直链」,
 * 并发执行,按 sources 顺序返回首个拿到直链的结果。
 *
 * 调用方:neteaseApi.resolveNeteaseApi 在网易匿名直链为 null(灰曲)时兜底。
 * 优先级规则(见 index.resolveMusicSource):有启用的外部网易云 API 源时,
 * 优先用其服务端 /song/url/match;否则(内置源/其他源)走本模块。
 */
import { scriptFetch } from "@/source-script/fetch";
import { md5 } from "./md5";
import { asNumber, asRecord, asString } from "./utils";

/** 可前端移植的 UNM 音源代号。 */
export type UnblockSource = "kuwo" | "kugou" | "migu" | "bodian" | "pyncmd";

export const UNBLOCK_SOURCES: UnblockSource[] = [
  "kuwo",
  "kugou",
  "migu",
  "bodian",
  "pyncmd",
];

export const UNBLOCK_SOURCE_LABELS: Record<UnblockSource, string> = {
  kuwo: "酷我",
  kugou: "酷狗",
  migu: "咪咕",
  bodian: "波点",
  pyncmd: "GD音乐台",
};

/** 解灰匹配用的目标曲信息(对齐 UNM 的 info 结构)。 */
export interface UnblockTarget {
  /** 网易云歌曲 id（pyncmd 直接用它打 GD 音乐台）。 */
  neteaseId: string;
  /** 歌名。 */
  name: string;
  /** 歌手（多位用 / 或 & 连接）。 */
  artist: string;
  /** 期望时长（毫秒），用于在搜索结果里挑最接近的版本。 */
  durationMs?: number;
}

interface CandidateSong {
  id: string;
  name?: string;
  duration?: number; // ms
}

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
};

/**
 * 从搜索结果里挑最匹配的一条(照 UNM select.js):
 * 前 5 条里找时长相差 5s 内的第一条;没有就取第一条。
 */
function select(list: CandidateSong[], durationMs?: number): CandidateSong | undefined {
  if (list.length === 0) return undefined;
  if (durationMs) {
    const hit = list
      .slice(0, 5)
      .find((song) => song.duration && Math.abs(song.duration - durationMs) < 5000);
    if (hit) return hit;
  }
  return list[0];
}

/** 解灰匹配关键词:歌名 歌手(去掉 UNM 的 " - " 连接符,空格分隔)。 */
function keywordOf(target: UnblockTarget): string {
  const artist = target.artist.replace(/\s*[/&]\s*/g, " ").trim();
  return `${target.name} ${artist}`.trim();
}

async function getJson(
  url: string,
  headers: Record<string, string> = {}
): Promise<unknown> {
  const res = await scriptFetch(url, {
    headers: { ...DEFAULT_HEADERS, ...headers },
    timeout: 15000,
  });
  if (!res.ok) throw new Error(`请求失败 ${res.status}`);
  return res.json<unknown>();
}

async function getText(
  url: string,
  headers: Record<string, string> = {}
): Promise<string> {
  const res = await scriptFetch(url, {
    headers: { ...DEFAULT_HEADERS, ...headers },
    timeout: 15000,
  });
  if (!res.ok) throw new Error(`请求失败 ${res.status}`);
  return res.text();
}

// ───────────────────────── 酷我 kuwo ─────────────────────────
// 搜索走 search.kuwo.cn/r.s,直链走 antiserver.kuwo.cn(免加密版,UNM 的回退路径)。

async function kuwoMatch(target: UnblockTarget): Promise<string | undefined> {
  const keyword = encodeURIComponent(keywordOf(target));
  const searchUrl =
    "http://search.kuwo.cn/r.s?&correct=1&vipver=1&stype=comprehensive&encoding=utf8" +
    "&rformat=json&mobi=1&show_copyright_off=1&searchapi=6&all=" +
    keyword;
  const payload = asRecord(await getJson(searchUrl));
  const content = Array.isArray(payload?.content) ? payload?.content : [];
  const musicpage = asRecord(asRecord(content[1])?.musicpage);
  const abslist = Array.isArray(musicpage?.abslist) ? musicpage?.abslist : [];
  const list: CandidateSong[] = (abslist as unknown[]).map((item) => {
    const row = asRecord(item);
    const rid = asString(row?.MUSICRID)?.split("_").pop();
    return {
      id: rid || "",
      name: asString(row?.SONGNAME),
      duration: asNumber(row?.DURATION) ? asNumber(row?.DURATION)! * 1000 : undefined,
    };
  });
  const matched = select(
    list.filter((song) => song.id),
    target.durationMs
  );
  if (!matched) return undefined;
  // antiserver 免加密直链(mp3),UA 必须是 okhttp。
  const trackUrl =
    "http://antiserver.kuwo.cn/anti.s?type=convert_url&format=mp3&response=url&rid=MUSIC_" +
    matched.id;
  const body = await getText(trackUrl, { "User-Agent": "okhttp/3.10.0" });
  const url = (body.match(/http[^\s$"]+/) || [])[0];
  return url || undefined;
}

// ───────────────────────── 酷狗 kugou ─────────────────────────
// 搜索 mobilecdn.kugou.com,直链 trackercdn.kugou.com(key = md5(hash+"kgcloudv2"))。

interface KugouCandidate extends CandidateSong {
  albumId?: string;
}

async function kugouMatch(target: UnblockTarget): Promise<string | undefined> {
  const keyword = encodeURIComponent(keywordOf(target));
  const searchUrl =
    "http://mobilecdn.kugou.com/api/v3/search/song?keyword=" +
    keyword +
    "&page=1&pagesize=10";
  const payload = asRecord(await getJson(searchUrl));
  const data = asRecord(payload?.data);
  const info = Array.isArray(data?.info) ? data?.info : [];
  const list: KugouCandidate[] = (info as unknown[]).map((item) => {
    const row = asRecord(item);
    return {
      id: asString(row?.hash) || "",
      name: asString(row?.songname),
      duration: asNumber(row?.duration) ? asNumber(row?.duration)! * 1000 : undefined,
      albumId: asString(row?.album_id) || "",
    };
  });
  const matched = select(
    list.filter((song) => song.id),
    target.durationMs
  ) as KugouCandidate | undefined;
  if (!matched) return undefined;
  const key = md5(`${matched.id}kgcloudv2`);
  const trackUrl =
    "http://trackercdn.kugou.com/i/v2/?key=" +
    key +
    "&hash=" +
    matched.id +
    "&appid=1005&pid=2&cmd=25&behavior=play&album_id=" +
    (matched.albumId || "");
  const trackPayload = asRecord(await getJson(trackUrl));
  const urls = Array.isArray(trackPayload?.url) ? trackPayload?.url : [];
  return asString(urls[0]) || undefined;
}

// ───────────────────────── 咪咕 migu ─────────────────────────
// 搜索 m.music.migu.cn,直链 app.c.nf.migu.cn(按音质档位逐个试)。

const MIGU_HEADERS: Record<string, string> = {
  origin: "http://music.migu.cn/",
  referer: "http://m.music.migu.cn/v3/",
  channel: "0146921",
};

async function miguSingle(id: string, toneFlag: string): Promise<string | undefined> {
  const url =
    "https://app.c.nf.migu.cn/MIGUM2.0/strategy/listen-url/v2.4?" +
    "netType=01&resourceType=2&songId=" +
    id +
    "&toneFlag=" +
    toneFlag;
  const payload = asRecord(await getJson(url, MIGU_HEADERS));
  const data = asRecord(payload?.data);
  if (asString(data?.audioFormatType) !== toneFlag) return undefined;
  return asString(data?.url) || undefined;
}

async function miguMatch(target: UnblockTarget): Promise<string | undefined> {
  const url =
    "https://m.music.migu.cn/migu/remoting/scr_search_tag?keyword=" +
    encodeURIComponent(keywordOf(target)) +
    "&type=2&rows=20&pgc=1";
  const payload = asRecord(await getJson(url, MIGU_HEADERS));
  const musics = Array.isArray(payload?.musics) ? payload?.musics : [];
  const list: CandidateSong[] = (musics as unknown[]).map((item) => {
    const row = asRecord(item);
    return { id: asString(row?.id) || "", name: asString(row?.title) };
  });
  const matched = select(
    list.filter((song) => song.id),
    target.durationMs
  );
  if (!matched) return undefined;
  // 音质从高到低试(不含 ZQ24 无损,默认 HQ/PQ 更稳)。
  for (const tone of ["HQ", "PQ"]) {
    try {
      const url = await miguSingle(matched.id, tone);
      if (url) return url;
    } catch {
      // 试下一档
    }
  }
  return undefined;
}

// ───────────────────────── 波点 bodian ─────────────────────────
// 搜索复用酷我 search.kuwo.cn,直链走 bd-api.kuwo.cn(带 sign 签名)。

function bodianSign(rawUrl: string): string {
  const url = new URL(rawUrl);
  const withTime = `${rawUrl}&timestamp=${Date.now()}`;
  const filtered = withTime
    .substring(withTime.indexOf("?") + 1)
    .replace(/[^a-zA-Z0-9]/g, "")
    .split("")
    .sort()
    .join("");
  const sign = md5(`kuwotest${filtered}${url.pathname}`);
  return `${withTime}&sign=${sign}`;
}

async function bodianMatch(target: UnblockTarget): Promise<string | undefined> {
  const keyword = encodeURIComponent(keywordOf(target));
  const searchUrl =
    "http://search.kuwo.cn/r.s?&correct=1&vipver=1&stype=comprehensive&encoding=utf8" +
    "&rformat=json&mobi=1&show_copyright_off=1&searchapi=6&all=" +
    keyword;
  const payload = asRecord(await getJson(searchUrl));
  const content = Array.isArray(payload?.content) ? payload?.content : [];
  const musicpage = asRecord(asRecord(content[1])?.musicpage);
  const abslist = Array.isArray(musicpage?.abslist) ? musicpage?.abslist : [];
  const list: CandidateSong[] = (abslist as unknown[]).map((item) => {
    const row = asRecord(item);
    const rid = asString(row?.MUSICRID)?.split("_").pop();
    return {
      id: rid || "",
      name: asString(row?.SONGNAME),
      duration: asNumber(row?.DURATION) ? asNumber(row?.DURATION)! * 1000 : undefined,
    };
  });
  const matched = select(
    list.filter((song) => song.id),
    target.durationMs
  );
  if (!matched) return undefined;
  const headers: Record<string, string> = {
    "user-agent": "Dart/2.19 (dart:io)",
    plat: "ar",
    channel: "aliopen",
    ver: "3.9.0",
    host: "bd-api.kuwo.cn",
    "X-Forwarded-For": "1.0.1.114",
  };
  const audioUrl = bodianSign(
    `http://bd-api.kuwo.cn/api/play/music/v2/audioUrl?&br=320kmp3&musicId=${matched.id}`
  );
  const payload2 = asRecord(await getJson(audioUrl, headers));
  if (asNumber(payload2?.code) !== 200) return undefined;
  return asString(asRecord(payload2?.data)?.audioUrl) || undefined;
}

// ───────────────────────── GD 音乐台 pyncmd ─────────────────────────
// 直接用网易 id 打 GD 音乐台(无需搜索匹配)。

async function pyncmdMatch(target: UnblockTarget): Promise<string | undefined> {
  if (!target.neteaseId) return undefined;
  const url =
    "https://music-api.gdstudio.xyz/api.php?types=url&source=netease&id=" +
    encodeURIComponent(target.neteaseId) +
    "&br=320";
  const payload = asRecord(await getJson(url));
  return (asNumber(payload?.br) ?? 0) > 0 ? asString(payload?.url) : undefined;
}

const MATCHERS: Record<UnblockSource, (target: UnblockTarget) => Promise<string | undefined>> = {
  kuwo: kuwoMatch,
  kugou: kugouMatch,
  migu: miguMatch,
  bodian: bodianMatch,
  pyncmd: pyncmdMatch,
};

export interface UnblockResult {
  url: string;
  source: UnblockSource;
}

/**
 * 灰曲解灰:对每个启用源并发匹配,按 sources 给定顺序返回首个拿到直链的结果。
 * 全部失败返回 null。
 */
export async function unblockMatch(
  target: UnblockTarget,
  sources: UnblockSource[]
): Promise<UnblockResult | null> {
  const enabled = sources.filter((s) => MATCHERS[s]);
  if (enabled.length === 0 || !target.name) return null;

  const settled = await Promise.allSettled(
    enabled.map(async (source) => {
      const url = await MATCHERS[source](target);
      if (!url) throw new Error(`${source} 未匹配到`);
      return { url, source } satisfies UnblockResult;
    })
  );
  // 按 sources 顺序取首个成功(保留用户配置的优先级)。
  for (let i = 0; i < enabled.length; i += 1) {
    const r = settled[i];
    if (r.status === "fulfilled") return r.value;
  }
  return null;
}
