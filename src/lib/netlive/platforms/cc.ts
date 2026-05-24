/**
 * 网易 CC 直播 adapter —— 移植自 pure_live `lib/core/site/cc_site.dart`。
 *
 * 实现范围：
 *   - getRecommend：`api/category/live?format=json&start=&size=20`
 *   - getCategories：4 父类（全部 / 端游 / 手游 / 其他）+ `category/?format=json` 的 `game_list`
 *     按 `game_tag` (pc_game / mobile_game / other) 拆到各父类下
 *   - getCategoryRooms：`_next/data/nextjs/category/{gametype}.json` → pageProps.gametypeData.lives
 *   - search：`search/anchor?query=&size=20&page=` → webcc_anchor.result
 *   - getRoomDetail：先 `activitylives/anchor/lives?anchor_ccid=` 拿 channel_id，
 *     再 `live/channel/?channelids=` 拿实际拉流串
 *   - resolve：复用 detail 拿到的 stream_list/quickplay 选清晰度
 *
 * 无签名，全公开 JSON。
 */
import { createPlatformFetch } from "@/lib/netlive/scriptFetch";
const scriptFetch = createPlatformFetch("cc");
import type {
  NetLiveAdapter,
  NetLiveCategory,
  NetLiveRoom,
  NetLiveStream,
} from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const HEADERS_BASE: Record<string, string> = {
  "User-Agent": UA,
  Referer: "https://cc.163.com/",
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await scriptFetch(url, {
    method: "GET",
    headers: HEADERS_BASE,
    timeout: 20_000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json<T>();
}

/* ─────────────── 推荐 ─────────────── */

interface CcLiveItem {
  cuteid?: number | string;
  title?: string;
  cover?: string;
  nickname?: string;
  webcc_visitor?: number | string;
  vision_visitor?: number | string;
  purl?: string;
  game_name?: string;
}

interface CcRecommendResp {
  lives?: CcLiveItem[];
}

function mapLive(item: CcLiveItem, watchKey: "webcc_visitor" | "vision_visitor"): NetLiveRoom | undefined {
  if (item.cuteid === undefined || item.cuteid === null) return undefined;
  const rid = String(item.cuteid);
  return {
    platform: "cc",
    roomId: rid,
    title: item.title ?? "",
    cover: item.cover,
    uname: item.nickname,
    avatar: item.purl,
    online: parseWatching(item[watchKey]),
    category: item.game_name ?? "",
    live: true,
    link: `https://cc.163.com/${rid}`,
  };
}

function parseWatching(v: number | string | undefined): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number") return v;
  const n = parseInt(v, 10);
  return isNaN(n) ? undefined : n;
}

async function getRecommend(
  page: number,
  _pageSize: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const start = (page - 1) * 20;
  const data = await fetchJson<CcRecommendResp>(
    `https://cc.163.com/api/category/live/?format=json&start=${start}&size=20`
  );
  const items = data.lives ?? [];
  const list = items
    .map((i) => mapLive(i, "vision_visitor"))
    .filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: items.length >= 20 };
}

/* ─────────────── 分类 ─────────────── */

const PARENT_CATS: Array<{ id: string; name: string; tag?: string }> = [
  { id: "1", name: "全部" },
  { id: "2", name: "端游", tag: "pc_game" },
  { id: "4", name: "手游", tag: "mobile_game" },
  { id: "5", name: "其他", tag: "other" },
];

interface CcCategoryRoot {
  game_list?: Array<{
    gametype?: number | string;
    gamename?: string;
    game_tag?: string;
    img?: string;
  }>;
}

async function getCategories(): Promise<NetLiveCategory[]> {
  const data = await fetchJson<CcCategoryRoot>(
    "https://cc.163.com/category/?format=json"
  );
  const all = data.game_list ?? [];
  const out: NetLiveCategory[] = [];
  for (const parent of PARENT_CATS) {
    const filtered = parent.tag
      ? all.filter((g) => g.game_tag === parent.tag)
      : all;
    for (const g of filtered) {
      if (g.gametype === undefined || g.gametype === null) continue;
      out.push({
        id: String(g.gametype),
        name: g.gamename ?? "",
        cover: g.img,
        parent: parent.name,
      });
    }
  }
  return out;
}

interface CcGameTypeResp {
  pageProps?: {
    gametypeData?: {
      lives?: CcLiveItem[];
    };
  };
}

async function getCategoryRooms(
  categoryId: string,
  _page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const data = await fetchJson<CcGameTypeResp>(
    `https://cc.163.com/_next/data/nextjs/category/${encodeURIComponent(categoryId)}.json?game=${encodeURIComponent(categoryId)}`
  );
  const items = data.pageProps?.gametypeData?.lives ?? [];
  const list = items
    .map((i) => mapLive(i, "webcc_visitor"))
    .filter((r): r is NetLiveRoom => !!r);
  // CC 这个接口不分页，单次取完
  return { list, hasMore: false };
}

/* ─────────────── 搜索 ─────────────── */

interface CcSearchResp {
  webcc_anchor?: {
    result?: Array<{
      cuteid?: number | string;
      title?: string;
      portrait?: string;
      nickname?: string;
      game_name?: string;
      status?: number;
      follower_num?: number | string;
    }>;
  };
}

async function search(
  keyword: string,
  page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const data = await fetchJson<CcSearchResp>(
    `https://cc.163.com/search/anchor?query=${encodeURIComponent(keyword)}&size=20&page=${page}`
  );
  const items = data.webcc_anchor?.result ?? [];
  const list: NetLiveRoom[] = [];
  for (const item of items) {
    if (item.cuteid === undefined || item.cuteid === null) continue;
    const rid = String(item.cuteid);
    list.push({
      platform: "cc",
      roomId: rid,
      title: item.title ?? "",
      cover: item.portrait,
      uname: item.nickname,
      avatar: item.portrait,
      online: parseWatching(item.follower_num),
      category: item.game_name ?? "",
      live: item.status === 1,
      link: `https://cc.163.com/${rid}`,
    });
  }
  return { list, hasMore: items.length > 0 };
}

/* ─────────────── 房间详情 + resolve ─────────────── */

interface CcChannelInfoResp {
  data?: Array<{
    ccid?: number | string;
    title?: string;
    cover?: string;
    nickname?: string;
    purl?: string;
    gamename?: string;
    personal_label?: string;
    status?: number;
    follower_num?: number | string;
    m3u8?: string;
    cid?: number | string;
    quickplay?: CcStreamMap;
    stream_list?: CcStreamMap;
  }>;
}

interface CcQuickPlayQuality {
  vbr?: number;
  CDN_FMT?: Record<string, string>;
}

// stream_list 形态：{ qualityKey: { cdn: { lineKey: url } , vbr } }
interface CcStreamListQuality {
  vbr?: number;
  cdn?: Record<string, string>;
}

type CcStreamMap = Record<string, CcQuickPlayQuality | CcStreamListQuality>;

interface CcAnchorLivesResp {
  data?: Record<string, { channel_id?: number | string }>;
}

async function fetchChannelInfo(roomId: string): Promise<CcChannelInfoResp["data"]> {
  const anchorResp = await fetchJson<CcAnchorLivesResp>(
    `https://api.cc.163.com/v1/activitylives/anchor/lives?anchor_ccid=${encodeURIComponent(roomId)}`
  );
  const channelId = anchorResp.data?.[roomId]?.channel_id;
  if (channelId === undefined || channelId === null) {
    throw new Error("CC 未返回 channel_id（房间可能未开播）");
  }
  const channelResp = await fetchJson<CcChannelInfoResp>(
    `https://cc.163.com/live/channel/?channelids=${encodeURIComponent(String(channelId))}`
  );
  return channelResp.data;
}

async function getRoomDetail(roomId: string): Promise<NetLiveRoom> {
  const data = await fetchChannelInfo(roomId);
  const r = data?.[0];
  if (!r) throw new Error("CC 未返回房间数据");
  return {
    platform: "cc",
    roomId: String(r.ccid ?? roomId),
    title: r.title ?? "",
    cover: r.cover,
    uname: r.nickname,
    avatar: r.purl,
    online: parseWatching(r.follower_num),
    category: r.gamename,
    introduction: r.personal_label,
    notice: r.personal_label,
    live: r.status === 1,
    link: `https://cc.163.com/${roomId}`,
  };
}

/* ─────────────── 选流 ─────────────── */

const QUALITY_LABELS: Record<string, string> = {
  blueray: "原画",
  original: "原画",
  high: "高清",
  medium: "标准",
  standard: "标准",
  low: "低清",
  ultra: "蓝光",
};

const LINE_PRIORITY = ["hs", "ks", "ali", "fws", "wy"];

interface CcLiveQualityEntry {
  vbr?: number;
  CDN_FMT?: Record<string, string>;
}
interface CcVodQualityEntry {
  vbr?: number;
  cdn?: Record<string, string>;
}
type CcAnyQualityEntry = CcLiveQualityEntry | CcVodQualityEntry;

/**
 * pure_live `getPlayQualites` 逻辑：
 *   - detail.data = roomInfo['quickplay'] ?? roomInfo['stream_list']
 *   - isLiveStream = (detail.data['resolution'] == null)
 *   - 直播：quickplay 顶层 key 是清晰度（blueray/original/high/...），每个 value.CDN_FMT = line→tail
 *           最终 URL = roomInfo['m3u8'] + '&' + tail
 *   - 录播：stream_list.resolution 是清晰度 map，每个 value.cdn = line→fullUrl
 */
function pickCcStream(
  detail: NonNullable<CcChannelInfoResp["data"]>[number]
): { primary: string; alts: Array<{ qn: string; label: string; url: string }> } {
  const dataSource = detail.quickplay ?? detail.stream_list;
  if (!dataSource) return { primary: "", alts: [] };
  const link = detail.m3u8;

  // pure_live: isLiveStream = data['resolution'] == null
  const dataObj = dataSource as Record<string, unknown>;
  const isLiveStream = dataObj.resolution === undefined || dataObj.resolution === null;
  const qualityMap: Record<string, CcAnyQualityEntry> = isLiveStream
    ? (dataObj as Record<string, CcAnyQualityEntry>)
    : ((dataObj.resolution as Record<string, CcAnyQualityEntry>) ?? {});

  const alts: Array<{ qn: string; label: string; url: string }> = [];
  for (const [key, q] of Object.entries(qualityMap)) {
    if (!q || typeof q !== "object") continue;
    const label = QUALITY_LABELS[key] ?? key;
    const vbr = q.vbr ?? 0;
    const lineMap = isLiveStream
      ? (q as CcLiveQualityEntry).CDN_FMT ?? {}
      : (q as CcVodQualityEntry).cdn ?? {};
    let chosen: string | undefined;
    for (const line of LINE_PRIORITY) {
      const lineVal = lineMap[line];
      if (!lineVal) continue;
      if (isLiveStream) {
        if (!link) continue;
        chosen = `${link}&${lineVal}`;
      } else {
        chosen = lineVal;
      }
      break;
    }
    if (chosen) {
      alts.push({ qn: String(vbr), label, url: chosen });
    }
  }
  // 按 vbr 倒序，最优先 = 蓝光/原画
  alts.sort((a, b) => parseInt(b.qn, 10) - parseInt(a.qn, 10));
  return { primary: alts[0]?.url ?? "", alts };
}

async function resolve(roomId: string): Promise<NetLiveStream> {
  const data = await fetchChannelInfo(roomId);
  const r = data?.[0];
  if (!r) throw new Error("CC 未返回房间数据");
  if (r.status !== 1) throw new Error("CC 直播间未开播");
  const picked = pickCcStream(r);
  if (!picked.primary) throw new Error("CC 未匹配到可播流");
  const streamType: NetLiveStream["streamType"] = picked.primary.includes(
    ".m3u8"
  )
    ? "hls"
    : "flv";
  return {
    url: picked.primary,
    streamType,
    qn: picked.alts[0]?.qn,
    qnLabel: picked.alts[0]?.label,
    alternatives: picked.alts.length > 0 ? picked.alts : undefined,
    referer: "https://cc.163.com/",
    ua: UA,
  };
}

async function getLiveStatus(roomId: string): Promise<boolean> {
  try {
    const detail = await getRoomDetail(roomId);
    return detail.live;
  } catch {
    return false;
  }
}

/* ─────────────── 导出 ─────────────── */

export const ccAdapter: NetLiveAdapter = {
  platform: "cc",
  getRecommend,
  search,
  resolve,
  getCategories,
  getCategoryRooms,
  getRoomDetail,
  getLiveStatus,
};
