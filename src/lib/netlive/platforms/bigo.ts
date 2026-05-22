/**
 * Bigo Live 直播 adapter —— 全球热门社交/热舞直播平台（新加坡，YY 旗下）。
 *
 * 实现思路（公开 endpoint 历经多次改名，目前最稳的两条）：
 *   - 列表：`https://www.bigo.tv/oapi/jsonp_callback/...` 走不通，改抓 web 主页 HTML
 *     里的 `window.__INIT_STATE__ = {...}` 嵌入 JSON
 *   - 房间页：`https://www.bigo.tv/{slug}` 同样抓 `INIT_STATE` 拿 hls / 元信息
 *
 * 兼容多套老 endpoint 作为 fallback。
 *
 * roomId = bigoId (uid string) 或 alias。
 * 热舞 / 颜值 / 社交内容为主，非游戏向。
 */
import { scriptFetch } from "@/source-script/fetch";
import type {
  NetLiveAdapter,
  NetLiveCategory,
  NetLiveRoom,
  NetLiveStream,
} from "../types";
import { NetLiveListUnsupportedError } from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const REFERER = "https://www.bigo.tv/";
const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Referer: REFERER,
  Origin: "https://www.bigo.tv",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};
const HTML_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Referer: REFERER,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

interface BgRoom {
  bigo_id?: string | number;
  alias?: string;
  nick_name?: string;
  user_name?: string;
  room_topic?: string;
  cover_url?: string;
  big_url?: string;
  pic?: string;
  user_count?: number;
  audience?: number;
  country?: string;
  language?: string;
  tag?: string;
  uid?: string | number;
  avatar_url?: string;
  avatar?: string;
}

function pickStr<T>(...keys: T[]): string | undefined {
  for (const k of keys) {
    if (typeof k === "string" && k.length > 0) return k;
  }
  return undefined;
}

function mapRoom(r: BgRoom): NetLiveRoom | undefined {
  const id = r.bigo_id ?? r.uid ?? r.alias;
  if (id === undefined || id === null) return undefined;
  const slug = String(id);
  return {
    platform: "bigo",
    roomId: slug,
    title:
      pickStr(r.room_topic, r.nick_name, r.user_name) ?? r.alias ?? slug,
    uname: pickStr(r.nick_name, r.user_name, r.alias),
    avatar: pickStr(r.avatar_url, r.avatar),
    cover: pickStr(r.cover_url, r.big_url, r.pic),
    online: r.user_count ?? r.audience ?? 0,
    category: r.tag ?? r.country ?? r.language,
    live: true,
    link: `https://www.bigo.tv/${r.alias ?? slug}`,
  };
}

async function postJson<T>(
  url: string,
  body: unknown
): Promise<T> {
  const res = await scriptFetch(url, {
    method: "POST",
    headers: { ...COMMON_HEADERS, "Content-Type": "application/json" },
    json: body,
    timeout: 25_000,
    http2: true,
  });
  if (!res.ok) throw new Error(`Bigo HTTP ${res.status}`);
  return res.json<T>();
}

async function getJson<T>(url: string): Promise<T> {
  const res = await scriptFetch(url, {
    method: "GET",
    headers: COMMON_HEADERS,
    timeout: 25_000,
    http2: true,
  });
  if (!res.ok) throw new Error(`Bigo HTTP ${res.status}`);
  return res.json<T>();
}

async function fetchHtml(url: string): Promise<string> {
  const res = await scriptFetch(url, {
    method: "GET",
    headers: HTML_HEADERS,
    timeout: 25_000,
    http2: true,
  });
  if (!res.ok) throw new Error(`Bigo HTTP ${res.status}`);
  return res.text();
}

/* 从 web 主页 HTML 解析 `window.__INIT_STATE__ = {...};` */
function extractInitState(html: string): unknown | null {
  // 多种嵌入形式：__INIT_STATE__ / __INITIAL_STATE__
  const m =
    html.match(/window\.__INIT_STATE__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/) ||
    html.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

interface BgListResp {
  data?: {
    list?: BgRoom[];
    rooms?: BgRoom[];
  };
  code?: number;
  msg?: string;
}

/* ─────────────── 推荐 ─────────────── */

interface BgInitState {
  pageStore?: {
    homeStore?: {
      liveList?: BgRoom[];
      banner?: unknown;
    };
    userInfoStore?: { userInfo?: BgRoom & { live?: { hls?: string } } };
  };
  // Bigo 不同版本嵌入 key 命名各异，留 unknown 兜底
}

async function getRecommend(
  page: number,
  pageSize: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const reasons: string[] = [];
  // 主页 HTML 抓 INIT_STATE 是最稳的路径（页面始终需要这份数据来 SSR 渲染）
  if (page === 1) {
    try {
      const html = await fetchHtml("https://www.bigo.tv/");
      const state = extractInitState(html) as BgInitState | null;
      const rooms = state?.pageStore?.homeStore?.liveList ?? [];
      const list = rooms.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
      if (list.length > 0) return { list, hasMore: false };
      reasons.push(
        `HTML INIT_STATE：${state ? "存在但 liveList 空" : "未找到 INIT_STATE 嵌入"}`
      );
    } catch (e) {
      reasons.push(`HTML：${(e as Error).message ?? String(e)}`);
    }
  }
  // 多套 JSON endpoint 兜底（多年来 Bigo 改过多次，按"新→旧"顺序试）
  const limit = Math.max(pageSize, 24);
  const candidates = [
    `https://www.bigo.tv/oapi/v3/getNewListV2?page=${page}&size=${limit}`,
    `https://www.bigo.tv/oapi/v3/getList?page=${page}&size=${limit}&label=`,
    `https://ta.bigo.tv/official_website/studio/getNewListV3?page=${page}&pageSize=${limit}&tabId=0`,
    `https://api.bigo.tv/web/AjaxCommon/getRecommendBigoLiveList?page=${page}&size=${limit}`,
  ];
  for (const url of candidates) {
    try {
      const data = await getJson<BgListResp>(url);
      const arr = data.data?.list ?? data.data?.rooms ?? [];
      if (arr.length > 0) {
        const list = arr.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
        return { list, hasMore: arr.length >= limit };
      }
      reasons.push(`${url}: 返回 0 条`);
    } catch (e) {
      reasons.push(`${url}: ${(e as Error).message ?? String(e)}`);
    }
  }
  if (reasons.length > 0) {
    // 已知现实：Bigo web 列表端点全部 404 / SSL 拒；HTML 内嵌 __BIGOLIVE__ IIFE 不含 liveList。
    // 改抛 sentinel error，UI 显示"该平台仅支持搜索 / 输房间号"友好提示。
    throw new NetLiveListUnsupportedError(
      "Bigo Live",
      `已尝试 ${reasons.length} 个端点全部失败`
    );
  }
  return { list: [], hasMore: false };
}

/* ─────────────── 分类（tab）─────────────── */

const PRESET_CATEGORIES: NetLiveCategory[] = [
  { id: "0", name: "热门" },
  { id: "1", name: "热舞" },
  { id: "2", name: "颜值" },
  { id: "3", name: "唱见" },
  { id: "4", name: "脱口秀" },
  { id: "5", name: "派对" },
  { id: "6", name: "户外" },
  { id: "7", name: "游戏" },
];

async function getCategories(): Promise<NetLiveCategory[]> {
  return PRESET_CATEGORIES;
}

async function getCategoryRooms(
  categoryId: string,
  page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const limit = 24;
  const candidates = [
    `https://www.bigo.tv/oapi/v3/getNewListV2?page=${page}&size=${limit}&tabId=${encodeURIComponent(categoryId)}`,
    `https://ta.bigo.tv/official_website/studio/getNewListV3?page=${page}&pageSize=${limit}&tabId=${encodeURIComponent(categoryId)}`,
  ];
  for (const url of candidates) {
    try {
      const data = await getJson<BgListResp>(url);
      const arr = data.data?.list ?? data.data?.rooms ?? [];
      if (arr.length > 0) {
        const list = arr.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
        return { list, hasMore: arr.length >= limit };
      }
    } catch {
      /* try next */
    }
  }
  // 都跑通了仍空 —— 退到首页（categoryId 可能已废）
  if (page === 1) return getRecommend(1, limit);
  return { list: [], hasMore: false };
}

/* ─────────────── 搜索 ─────────────── */

interface BgSearchResp {
  data?: { list?: BgRoom[]; users?: BgRoom[] };
}

async function search(
  keyword: string,
  _page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  try {
    const data = await postJson<BgSearchResp>(
      "https://ta.bigo.tv/official_website/studio/getSearchInfo",
      { keyword, page: 1, size: 30 }
    );
    const arr = data.data?.list ?? data.data?.users ?? [];
    const list = arr.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
    return { list, hasMore: false };
  } catch {
    return { list: [], hasMore: false };
  }
}

/* ─────────────── 房间详情 + resolve ─────────────── */

interface BgPlayResp {
  data?: {
    // streamlink 验证的真实字段（POST /studio/getInternalStudioInfo 返回）
    hls_src?: string;
    roomId?: string;
    clientBigoId?: string;
    gameTitle?: string;
    roomTopic?: string;
    // 兼容旧/HTML fallback 路径
    hls_url?: string;
    rtmp_url?: string;
    flv_url?: string;
    live?: number;
    big_url?: string;
    room_topic?: string;
    nick_name?: string;
    user_count?: number;
    avatar?: string;
  };
  code?: number;
  msg?: string;
}

async function fetchPlayInfo(roomId: string): Promise<BgPlayResp> {
  // streamlink 验证：POST 方法 + query 形式参数（含 verify=）；返回 data.hls_src
  const url = `https://ta.bigo.tv/official_website/studio/getInternalStudioInfo?siteId=${encodeURIComponent(roomId)}&verify=`;
  try {
    const res = await scriptFetch(url, {
      method: "POST",
      headers: { ...COMMON_HEADERS, "Content-Length": "0" },
      timeout: 25_000,
      http2: true,
    });
    if (!res.ok) throw new Error(`Bigo HTTP ${res.status}`);
    return res.json<BgPlayResp>();
  } catch {
    // HTML fallback：从 /{slug} 主页解析 INIT_STATE.userInfo
    const html = await fetchHtml(`https://www.bigo.tv/${roomId}`);
    const state = extractInitState(html) as BgInitState | null;
    const ui = state?.pageStore?.userInfoStore?.userInfo;
    if (!ui) throw new Error("Bigo 房间数据缺失");
    return {
      data: {
        hls_src: ui.live?.hls,
        big_url: ui.big_url ?? ui.cover_url,
        room_topic: ui.room_topic,
        nick_name: ui.nick_name,
        user_count: ui.user_count,
        avatar: ui.avatar_url,
      },
    };
  }
}

async function getRoomDetail(roomId: string): Promise<NetLiveRoom> {
  const info = await fetchPlayInfo(roomId);
  const d = info.data;
  if (!d) throw new Error(`Bigo 房间 ${roomId} 未找到`);
  return {
    platform: "bigo",
    roomId,
    title: d.roomTopic ?? d.room_topic ?? d.nick_name ?? roomId,
    uname: d.nick_name,
    avatar: d.avatar,
    cover: d.big_url,
    online: d.user_count ?? 0,
    category: d.gameTitle,
    // streamlink 验证：hls_src 非空即在播（不再用 live 字段，新 API 不返回）
    live: !!(d.hls_src ?? d.hls_url),
    link: `https://www.bigo.tv/${roomId}`,
  };
}

async function getLiveStatus(roomId: string): Promise<boolean> {
  try {
    const info = await fetchPlayInfo(roomId);
    return !!(info.data?.hls_src ?? info.data?.hls_url);
  } catch {
    return false;
  }
}

async function resolve(roomId: string): Promise<NetLiveStream> {
  const info = await fetchPlayInfo(roomId);
  const d = info.data;
  if (!d) throw new Error(`Bigo 房间 ${roomId} 未找到`);
  // streamlink 验证：hls_src 是 m3u8 直链；空表示未开播
  const url = d.hls_src ?? d.hls_url ?? d.flv_url ?? d.rtmp_url;
  if (!url) throw new Error("Bigo 未开播 / 未返回拉流地址");
  return {
    url,
    streamType: url.includes(".m3u8") ? "hls" : url.includes(".flv") ? "flv" : "mp4",
    qn: "auto",
    qnLabel: "原画",
    referer: REFERER,
    ua: UA,
  };
}

/* ─────────────── 导出 ─────────────── */

export const bigoAdapter: NetLiveAdapter = {
  platform: "bigo",
  getRecommend,
  search,
  resolve,
  getCategories,
  getCategoryRooms,
  getRoomDetail,
  getLiveStatus,
};
