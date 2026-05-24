/**
 * Streamate (streamate.com,旗下 PornHubLive) —— 美国老牌成人 cam。
 *
 * 真实可用 API(2026-05 抓 Cumination + StreaMonitor + curl 验证):
 *
 *   - 列表 / 分类 / 搜索:走 naiadsystems v3 后端(主站 v4 是二进制 + xsrf token,跳过它)
 *     GET https://member.naiadsystems.com/search/v3/performers
 *         ?domain=streamate.com
 *         &from={offset}
 *         &size={pageSize}
 *         &filters=gender:f,ff,mf,tm2f,g;online:true[;category:xxx]
 *         &genderSetting=f
 *     Headers: platform: SCP + smtid/smeid/smvid 全 `f` 占位 UUID
 *     返 application/json,字段:nickname / id / age / country / categoryName[] /
 *     thumbnail (icfcdn webp) / highDefinition / liveState.freeChat / online
 *
 *   - 单房间状态 / 拉流(StreaMonitor):
 *     GET https://manifest-server.naiadsystems.com/live/s:{username}.json?last=load&format=mp4-hls
 *     返 { formats: { 'mp4-hls': { encodings: [{ location, videoWidth, videoHeight }] } } }
 *     首个 encoding.location 是 HLS m3u8(h264+aac,144/432/720p,无 DRM)
 *
 *   - roomId = nickname(小写 slug),房间页 https://streamate.com/cam/{nickname}
 */
import { createPlatformFetch } from "@/lib/netlive/scriptFetch";
const scriptFetch = createPlatformFetch("streamate");
import type {
  NetLiveAdapter,
  NetLiveCategory,
  NetLiveRoom,
  NetLiveStream,
} from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const REFERER = "https://streamate.com/";

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Referer: REFERER,
  Accept: "application/json, text/plain, */*",
};

// naiadsystems v3 列表 endpoint 要求的占位 IDs —— Cumination 实测 ffff 全占位即可匿名通过
const PLACEHOLDER_ID = "ffffffff-ffff-ffff-ffff-ffffffffffffG0000000000000";
const LIST_HEADERS: Record<string, string> = {
  ...COMMON_HEADERS,
  platform: "SCP",
  smtid: PLACEHOLDER_ID,
  smeid: PLACEHOLDER_ID,
  smvid: PLACEHOLDER_ID,
};

/* ─────────────────────────────── */
/* types */
/* ─────────────────────────────── */

interface SmPerformer {
  id?: number | string;
  nickname?: string;
  age?: number;
  country?: string;
  categoryName?: string[];
  thumbnail?: string;
  highDefinition?: boolean;
  online?: boolean;
  liveState?: {
    freeChat?: boolean;
  };
}

interface SmListResp {
  // v3 实际字段:`performers` + `totalResultCount`(2026-05 抓包确认)
  // `available` = 平台总注册数,`online` = 当前在线总数,`totalResultCount` = 当前 filter 下命中数
  performers?: SmPerformer[];
  results?: SmPerformer[];
  data?: SmPerformer[];
  totalResultCount?: number;
  total?: number;
  totalHits?: number;
  online?: number;
  available?: number;
}

interface SmEncoding {
  location?: string;
  videoWidth?: number;
  videoHeight?: number;
}

interface SmManifestResp {
  formats?: {
    "mp4-hls"?: {
      encodings?: SmEncoding[];
    };
  };
}

/* ─────────────────────────────── */
/* api */
/* ─────────────────────────────── */

function buildListUrl(
  from: number,
  size: number,
  extraFilters: string[] = [],
): string {
  const filters = ["gender:f,ff,mf,tm2f,g", "online:true", ...extraFilters].join(";");
  const u = new URL("https://member.naiadsystems.com/search/v3/performers");
  u.searchParams.set("domain", "streamate.com");
  u.searchParams.set("from", String(from));
  u.searchParams.set("size", String(size));
  u.searchParams.set("filters", filters);
  u.searchParams.set("genderSetting", "f");
  return u.toString();
}

async function fetchList(url: string): Promise<SmListResp> {
  const res = await scriptFetch(url, {
    method: "GET",
    headers: LIST_HEADERS,
    timeout: 25_000,
    http2: true,
  });
  if (!res.ok) throw new Error(`Streamate HTTP ${res.status}`);
  return res.json<SmListResp>();
}

async function fetchManifest(username: string): Promise<SmManifestResp> {
  const url = `https://manifest-server.naiadsystems.com/live/s:${encodeURIComponent(
    username,
  )}.json?last=load&format=mp4-hls`;
  const res = await scriptFetch(url, {
    method: "GET",
    headers: COMMON_HEADERS,
    timeout: 25_000,
    http2: true,
  });
  if (!res.ok) throw new Error(`Streamate manifest HTTP ${res.status}`);
  return res.json<SmManifestResp>();
}

/* ─────────────────────────────── */
/* mapping */
/* ─────────────────────────────── */

function pickList(resp: SmListResp): SmPerformer[] {
  return resp.performers ?? resp.results ?? resp.data ?? [];
}

function mapRoom(p: SmPerformer): NetLiveRoom | undefined {
  const nickname = p.nickname;
  if (!nickname) return undefined;
  const cats = p.categoryName ?? [];
  return {
    platform: "streamate",
    roomId: nickname,
    title: cats[0] ?? nickname,
    uname: nickname,
    avatar: p.thumbnail,
    cover: p.thumbnail,
    online: 0,
    category: cats.slice(0, 5).join(", ") || p.country || undefined,
    // 真正"可看"的只有 freeChat:true。online=true 但 freeChat=false 表示
    // 主播在 private/exclusive/gold show 中,匿名拉流会失败。
    live: p.online !== false && p.liveState?.freeChat === true,
    link: `https://streamate.com/cam/${nickname}`,
  };
}

/* ─────────────────────────────── */
/* recommend */
/* ─────────────────────────────── */

async function getRecommend(
  page: number,
  pageSize: number,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const from = Math.max(0, (page - 1) * pageSize);
  const data = await fetchList(buildListUrl(from, pageSize));
  const raw = pickList(data);
  const list = raw.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
  // v3 字段是 totalResultCount(实测约 1200+),兜底 total/totalHits 兼容
  const total =
    data.totalResultCount ?? data.total ?? data.totalHits ?? raw.length;
  return {
    list,
    hasMore: from + raw.length < total && raw.length > 0,
  };
}

/* ─────────────────────────────── */
/* search —— v3 endpoint 估计支持 q/query 参数,best-effort */
/* ─────────────────────────────── */

async function search(
  keyword: string,
  page: number,
  pageSize: number = 48,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  // 拉一次默认列表然后本地 filter —— v3 似乎没暴露文本搜索,bestguess 兜底
  const from = Math.max(0, (page - 1) * pageSize);
  const data = await fetchList(buildListUrl(from, pageSize * 4));
  const lower = keyword.toLowerCase();
  const all = pickList(data)
    .filter((p) => {
      return (
        p.nickname?.toLowerCase().includes(lower) ||
        p.categoryName?.some((c) => c.toLowerCase().includes(lower)) ||
        p.country?.toLowerCase().includes(lower)
      );
    })
    .map(mapRoom)
    .filter((r): r is NetLiveRoom => !!r);
  const start = 0;
  const end = pageSize;
  return {
    list: all.slice(start, end),
    hasMore: end < all.length,
  };
}

/* ─────────────────────────────── */
/* categories —— 用 streamate 主站常见分类 hardcode(没匿名 categories endpoint) */
/* ─────────────────────────────── */

const CATEGORIES: NetLiveCategory[] = [
  { id: "anal", name: "Anal" },
  { id: "bigboobs", name: "Big Boobs" },
  { id: "bigbutt", name: "Big Butt" },
  { id: "milf", name: "MILF" },
  { id: "teen", name: "Teen (18+)" },
  { id: "asian", name: "Asian" },
  { id: "ebony", name: "Ebony" },
  { id: "latina", name: "Latina" },
  { id: "blonde", name: "Blonde" },
  { id: "brunette", name: "Brunette" },
  { id: "redhead", name: "Redhead" },
  { id: "lesbian", name: "Lesbian" },
  { id: "couples", name: "Couples" },
  { id: "feet", name: "Feet" },
  { id: "smoking", name: "Smoking" },
];

async function getCategories(): Promise<NetLiveCategory[]> {
  return CATEGORIES;
}

async function getCategoryRooms(
  categoryId: string,
  page: number,
  pageSize: number = 48,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const from = Math.max(0, (page - 1) * pageSize);
  const data = await fetchList(
    buildListUrl(from, pageSize, [`category:${categoryId}`]),
  );
  const raw = pickList(data);
  const list = raw.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
  const total =
    data.totalResultCount ?? data.total ?? data.totalHits ?? raw.length;
  return {
    list,
    hasMore: from + raw.length < total && raw.length > 0,
  };
}

/* ─────────────────────────────── */
/* resolve */
/* ─────────────────────────────── */

async function resolve(roomId: string): Promise<NetLiveStream> {
  const data = await fetchManifest(roomId);
  const encs = data.formats?.["mp4-hls"]?.encodings ?? [];
  if (encs.length === 0) {
    throw new Error(`Streamate 主播 ${roomId} 不在线或私密模式`);
  }
  // 最高分辨率优先
  const sorted = [...encs].sort(
    (a, b) => (b.videoHeight ?? 0) - (a.videoHeight ?? 0),
  );
  const primary = sorted[0];
  if (!primary?.location) throw new Error("Streamate 无可用 HLS encoding");
  const alternatives = sorted.slice(1).map((e, i) => ({
    qn: `q${i}`,
    label: `${e.videoWidth ?? "?"}x${e.videoHeight ?? "?"}`,
    url: e.location!,
  }));
  return {
    url: primary.location,
    streamType: "hls",
    qn: "auto",
    qnLabel: `${primary.videoWidth ?? "?"}x${primary.videoHeight ?? "?"}`,
    alternatives: alternatives.length > 0 ? alternatives : undefined,
    referer: REFERER,
    ua: UA,
  };
}

/* ─────────────────────────────── */
/* live status */
/* ─────────────────────────────── */

async function getLiveStatus(roomId: string): Promise<boolean> {
  try {
    const data = await fetchManifest(roomId);
    return (data.formats?.["mp4-hls"]?.encodings?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/* ─────────────────────────────── */
/* export */
/* ─────────────────────────────── */

export const streamateAdapter: NetLiveAdapter = {
  platform: "streamate",
  getRecommend,
  search,
  resolve,
  getCategories,
  getCategoryRooms,
  getLiveStatus,
};
