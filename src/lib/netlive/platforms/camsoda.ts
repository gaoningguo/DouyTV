/**
 * CamSoda 直播 adapter —— 18+ 成人 cam 平台。
 *
 * 实测 2026-05 抓出来的真实接口结构:
 *
 * 1) 列表 `https://www.camsoda.com/api/v1/browse/online?page=1&gender=f&showType=all`
 *    顶层 { template[], results[] }。template 是 tpl 索引语义表(每次调用都返回):
 *      tpl[0]=user_id, [1]=username, [2]=display_name, [3]=status,
 *      [4]=connections(观看人数!), [5]=sort_value, [6]=subject_html(topic),
 *      [7]=stream_name, [8]=gender, [9]=edge_servers[](无 path 前缀,
 *      在 resolve 中不能用,会 403), [10]=thumb(live 缩略图), [11]=pvt_rating,
 *      [12]=bitrate(不是观看人数!), [13]=control_her, [14]=standby,
 *      [15]=offline_picture
 *    旧代码错把 tpl[12] 当 viewers、tpl[13] 当 online 状态过滤 —— 大量真在线主播被剔除。
 *
 * 2) 播放 `https://www.camsoda.com/api/v1/video/vtoken/{user}?username=guest_`
 *    返:{ stream_name, edge_servers[], token, status, width, height, ... }
 *    其中 edge_servers 形如 `streaming-edge-front.livemediahost.com/edge5-fld`
 *   (有 path 前缀,这是真实可用的)。HLS 主清单:
 *      https://{edge}/{stream_name}_v1/index.m3u8
 *    匿名可拉,master 内部把 token 嵌进了 variant URL,所以 token 不用单独存或传。
 *    旧代码用的 `/api/v1/user/{user}` 接口已废(返回 0 字节),resolve 永远失败。
 *
 * 3) NetLiveStream 类型只允许 url / streamType / qn / qnLabel / referer / ua / alternatives,
 *    旧代码瞎加了 headers / proxy 字段,触发 tsc error。
 */
import { createPlatformFetch } from "@/lib/netlive/scriptFetch";
const scriptFetch = createPlatformFetch("camsoda");
import type {
  NetLiveAdapter,
  NetLiveCategory,
  NetLiveRoom,
  NetLiveStream,
} from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const REFERER = "https://www.camsoda.com/";

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Referer: REFERER,
  Origin: REFERER.replace(/\/$/, ""),
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

/** vtoken 端点返回 —— 实测字段 */
interface CsVtokenResp {
  status?: string; // "online" / 其他
  stream_name?: string; // "cam_obs/<user>-flu" / "1280x720/<user>-flu-ingest3-fld"
  edge_servers?: string[]; // ["streaming-edge-front.livemediahost.com/edge5-fld", ...]
  token?: string;
  width?: number;
  height?: number;
  aspect?: number;
  quality_renditions?: string; // 通常 "4"
  ffmpeg_server?: string;
  ingest_server?: string;
}

interface CsBrowseResp {
  template?: string[]; // tpl 索引语义
  results?: Array<{ tpl?: Record<string, unknown>; [k: string]: unknown }>;
  cb?: number;
  count_total?: number;
  status?: string;
}

/** tpl 索引语义(实测 2026-05),用常量避免硬编码到处出现 */
const TPL = {
  USER_ID: "0",
  USERNAME: "1",
  DISPLAY_NAME: "2",
  STATUS: "3",
  CONNECTIONS: "4",
  SUBJECT_HTML: "6",
  STREAM_NAME: "7",
  GENDER: "8",
  THUMB: "10",
  BITRATE: "12",
  STANDBY: "14",
} as const;

function tplStr(tpl: Record<string, unknown> | undefined, idx: string): string | undefined {
  const v = tpl?.[idx];
  return typeof v === "string" ? v : undefined;
}

function tplNum(tpl: Record<string, unknown> | undefined, idx: string): number | undefined {
  const v = tpl?.[idx];
  return typeof v === "number" ? v : undefined;
}

function mapRoom(raw: { tpl?: Record<string, unknown> }): NetLiveRoom | undefined {
  const tpl = raw.tpl;
  if (!tpl) return undefined;

  const username = tplStr(tpl, TPL.USERNAME);
  if (!username) return undefined;

  // standby = 1 意味着主播挂机/暂离(技术上"在线"但实际看不到画面)。过滤掉。
  const standby = tplNum(tpl, TPL.STANDBY);
  if (standby === 1) return undefined;

  const displayName = tplStr(tpl, TPL.DISPLAY_NAME);
  const topic = tplStr(tpl, TPL.SUBJECT_HTML);
  const cover = tplStr(tpl, TPL.THUMB);
  const viewers = tplNum(tpl, TPL.CONNECTIONS) ?? 0;
  const gender = tplStr(tpl, TPL.GENDER);

  return {
    platform: "camsoda",
    roomId: username,
    title: topic || displayName || username,
    uname: displayName || username,
    // listing 不返 avatar,只有 thumb;前端有 thumb 显示就够了
    cover,
    online: viewers,
    category: gender,
    live: true,
    link: `https://www.camsoda.com/${username}`,
  };
}

async function fetchBrowse(
  params: Record<string, string | number>
): Promise<NonNullable<CsBrowseResp["results"]>> {
  const url = new URL("https://www.camsoda.com/api/v1/browse/online");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  const res = await scriptFetch(url.toString(), {
    method: "GET",
    headers: COMMON_HEADERS,
    timeout: 30_000,
    http2: true,
  });
  if (!res.ok) throw new Error(`CamSoda HTTP ${res.status}`);
  const data = await res.json<CsBrowseResp>();
  return data.results ?? [];
}

/* ─────────────── 推荐 ─────────────── */

async function getRecommend(
  page: number,
  _pageSize: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const arr = await fetchBrowse({ page, gender: "f", showType: "all" });
  const list = arr.map(mapRoom).filter((v): v is NetLiveRoom => !!v);
  // listing API 一次返几百到上千项,没有标准分页 hint;arr.length > 0 即认为还可能有下一页
  return { list, hasMore: arr.length > 0 };
}

/* ─────────────── 分类 ─────────────── */

const PRESET_CATEGORIES: NetLiveCategory[] = [
  { id: "gender=f", name: "Female" },
  { id: "gender=m", name: "Male" },
  { id: "gender=t", name: "Trans" },
  { id: "gender=c", name: "Couple" },
];

async function getCategories(): Promise<NetLiveCategory[]> {
  return PRESET_CATEGORIES;
}

async function getCategoryRooms(
  categoryId: string,
  page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const [k, v] = categoryId.split("=");
  if (!k || !v) return { list: [], hasMore: false };
  const arr = await fetchBrowse({ [k]: v, page, showType: "all" });
  const list = arr.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: arr.length > 0 };
}

/* ─────────────── 搜索 ─────────────── */

async function search(
  keyword: string,
  _page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const arr = await fetchBrowse({ find: keyword, page: 1, showType: "all" });
  const list = arr.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: false };
}

/* ─────────────── 房间详情 + 状态 ─────────────── */

async function fetchVtoken(roomId: string): Promise<CsVtokenResp> {
  const url = `https://www.camsoda.com/api/v1/video/vtoken/${encodeURIComponent(
    roomId
  )}?username=guest_`;
  const res = await scriptFetch(url, {
    method: "GET",
    headers: { ...COMMON_HEADERS, Referer: `https://www.camsoda.com/${roomId}` },
    timeout: 30_000,
    http2: true,
  });
  if (!res.ok) throw new Error(`CamSoda vtoken HTTP ${res.status}`);
  return res.json<CsVtokenResp>();
}

async function getRoomDetail(roomId: string): Promise<NetLiveRoom> {
  // 旧 /api/v1/user/{user} 已废(0 字节响应);用 vtoken 拿在线状态作为最小可用兜底。
  // listing 有更全的字段(topic/viewers/thumb),但要按 username 精确匹配开销大,
  // detail 页只在用户已经从 listing 进入时被调,信息已经传过去,这里只兜底.
  try {
    const v = await fetchVtoken(roomId);
    return {
      platform: "camsoda",
      roomId,
      title: roomId,
      uname: roomId,
      live: v.status === "online",
      link: `https://www.camsoda.com/${roomId}`,
    };
  } catch {
    return {
      platform: "camsoda",
      roomId,
      title: roomId,
      uname: roomId,
      live: false,
      link: `https://www.camsoda.com/${roomId}`,
    };
  }
}

async function getLiveStatus(roomId: string): Promise<boolean> {
  try {
    const v = await fetchVtoken(roomId);
    return v.status === "online";
  } catch {
    return false;
  }
}

/* ─────────────── resolve ─────────────── */

/**
 * 实测 2026-05 真实 HLS 路径:
 *   https://{vtoken.edge_servers[0]}/{vtoken.stream_name}_v1/index.m3u8
 *
 * 注意:
 *   - edge_servers 必须用 vtoken 返回的,listing tpl[9] 的 host 无 path 前缀,直接 403
 *   - master 内部 variant URL 自带 token,所以 master URL 本身不用带 token
 *   - 第一个 edge 走主路,第二个作为备用(alternatives)
 */
async function resolve(roomId: string): Promise<NetLiveStream> {
  const v = await fetchVtoken(roomId);

  if (v.status && v.status !== "online") {
    throw new Error(`CamSoda 房间 ${roomId} 状态 ${v.status}(未公开播放)`);
  }
  if (!v.stream_name) {
    throw new Error(`CamSoda vtoken 未返回 stream_name(房间可能未开播)`);
  }
  const edges = v.edge_servers ?? [];
  if (edges.length === 0) {
    throw new Error(`CamSoda vtoken 未返回 edge_servers`);
  }

  const urlFor = (edge: string) =>
    `https://${edge}/${v.stream_name}_v1/index.m3u8`;

  const primary = urlFor(edges[0]);
  const alternatives = edges.slice(1).map((edge, i) => ({
    qn: `edge${i + 2}`,
    label: `备用线路 ${i + 2}`,
    url: urlFor(edge),
  }));

  return {
    url: primary,
    streamType: "hls",
    qn: "auto",
    qnLabel: `自适应 (${v.width ?? "?"}x${v.height ?? "?"})`,
    alternatives: alternatives.length > 0 ? alternatives : undefined,
    referer: REFERER,
    ua: UA,
  };
}

/* ─────────────── 导出 ─────────────── */

export const camsodaAdapter: NetLiveAdapter = {
  platform: "camsoda",
  getRecommend,
  search,
  resolve,
  getCategories,
  getCategoryRooms,
  getRoomDetail,
  getLiveStatus,
};
