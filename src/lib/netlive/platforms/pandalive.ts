/**
 * Pandalive (판다라이브) 直播 adapter —— 韩国最大成人 BJ 直播平台。
 *
 * 实测公开 API（2026-05 二次抓 Next.js client JS 验证，匿名免登可用）：
 *
 *   - 列表：POST https://api.pandalive.co.kr/v1/live/index
 *     Content-Type: application/json
 *     body: {"orderBy":"user","onlyNewBj":"N","limit":24,"offset":N}
 *     翻页用 offset = (page-1) * limit；orderBy: "user"(人气) / "newBj"(新人) / "bookmark"
 *     onlyNewBj: "Y"/"N" 仅看新人开关
 *     ⚠ CN IP 风控：从中国大陆访问时 server 强制 `siteMode.needAuth=true`，匿名 list 永远封顶
 *       10 间且 offset 失效（实测）。loginInfo 必返 `siteMode: {mode:"c", needAuth:true}` ——
 *       这是 Pandalive 的 CN 地理墙。唯一解：配韩国/日本节点代理（设置 → 代理）。
 *
 *   - 拉流：POST https://api.pandalive.co.kr/v1/live/play
 *     Content-Type: application/x-www-form-urlencoded（这个端点收 form 也收 JSON）
 *     body: userId={bjId}&action=watch&password=&shareLinkType=
 *     返回 { PlayList: { hls3:[{name,sort,url}], hls2:[...], hls:[...] }, media:{...} }
 *     hls3/hls2/hls.url 是 AWS IVS playback URL，自带 JWT 短期 token（~10min）
 *     JWT 内嵌 `aws:access-control-allow-origin: https://*.pandalive.co.kr` —— 拉 m3u8
 *     必须带 Origin 头，DouyTV dyproxy 自动从 Referer 派生 Origin
 *
 *   - 搜索：POST /v1/live/bj_list，body 同 index + `keyword` 字段
 *
 * 字段坑（旧版抄错的地方）：
 *   - 真字段名是 `orderBy`（不是 orderType）、`limit`（不是 rows）、`offset`（不是 page）
 *   - body 是裸 JSON（旧版错把它包在 `info=...` form 字段里，服务端忽略了所有字段，
 *     导致永远返第一页 10 间，offset 失效）
 *   - viewer 数是 `user`，封面 `thumbUrl`，头像 `userImg`
 *
 * **19+ 房间无法绕过**：Pandalive 的 isAdult=true 接口 + needAdult/needLogin 错误码
 *   都走韩国身份证 KCB 본인인증（실명인증），无技术绕过手段。匿名只能看 BJ 普通区
 *   （已经有大量 dance / 低胸 / lingerie / 비키니 BJ 内容）。
 *
 * roomId = userId（slug）。
 */
import { createPlatformFetch } from "@/lib/netlive/scriptFetch";
const scriptFetch = createPlatformFetch("pandalive");
import type {
  NetLiveAdapter,
  NetLiveCategory,
  NetLiveRoom,
  NetLiveStream,
} from "../types";
import { NetLiveListUnsupportedError } from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const REFERER = "https://www.pandalive.co.kr/";
const API_BASE = "https://api.pandalive.co.kr";

/**
 * 防风控降级：Pandalive 按 IP/ASN 风控,client 改 header / UA 都救不了。
 * 这里做两层缓解：
 *   1) listCache —— 同一 (orderBy,onlyNewBj,isAdult,page,pageSize) 30s 内复用响应,
 *      压缩"刷新/切换 tab/窗口聚焦"等触发的多余请求,延缓积累到封禁阈值。
 *   2) blockedUntil —— 一旦命中 errorData.code:"block",10 分钟内所有 Pandalive 请求
 *      失败快速返回同一友好错误,避免无效重试加深 ban。
 * 终极方案仍然是换住宅 IP（见模块顶部注释 + memory: pandalive-api-shape）。
 */
const LIST_CACHE_TTL_MS = 30_000;
const BLOCK_COOLDOWN_MS = 10 * 60_000;
const listCache = new Map<string, { data: PlListResp; expiry: number }>();
let blockedUntil = 0;
let lastBlockMessage = "";

function getCachedList(key: string): PlListResp | undefined {
  const hit = listCache.get(key);
  if (!hit) return undefined;
  if (hit.expiry < Date.now()) {
    listCache.delete(key);
    return undefined;
  }
  return hit.data;
}

function setCachedList(key: string, data: PlListResp): void {
  listCache.set(key, { data, expiry: Date.now() + LIST_CACHE_TTL_MS });
  // 简单 LRU：超过 32 项时清最早进入的
  if (listCache.size > 32) {
    const firstKey = listCache.keys().next().value;
    if (firstKey !== undefined) listCache.delete(firstKey);
  }
}

function ensureNotBlocked(): void {
  if (blockedUntil > Date.now()) {
    throw new NetLiveListUnsupportedError(
      "Pandalive",
      lastBlockMessage ||
        `代理 IP 已被 Pandalive 风控,${Math.ceil((blockedUntil - Date.now()) / 60_000)} 分钟后重试或更换出口节点`,
    );
  }
}

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Referer: REFERER,
  Origin: "https://www.pandalive.co.kr",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
  Accept: "application/json, text/plain, */*",
  // Pandalive client JS 默认带的 device identifier。匿名 ui="0"。
  // 不带的话部分接口（live/url）会报"잘못된 접근입니다"（非法访问）
  "X-Device-Info": JSON.stringify({
    t: "webPc",
    v: "1.0",
    ui: "0",
    ck: { sessKeyAsp: "" },
  }),
};

interface PlRoomRaw {
  userId?: string;
  userIdx?: number;
  userNick?: string;
  title?: string;
  category?: string;
  isAdult?: boolean;
  isPw?: boolean;
  user?: number; // 当前观看人数
  userLimit?: number;
  playCnt?: number;
  bookmarkCnt?: number;
  thumbUrl?: string;
  userImg?: string;
  isLive?: boolean;
  onAirType?: string;
  liveType?: string;
  startTime?: string;
  code?: string;
}

interface PlPageInfo {
  offset?: number;
  limit?: number;
  total?: number;
  page?: number;
  lastPage?: number;
}

interface PlListResp {
  list?: PlRoomRaw[];
  page?: PlPageInfo;
  result?: boolean;
  message?: string;
  errorData?: { code?: string; message?: string };
  userIp?: string;
}

/**
 * Pandalive 在 `result: false` 时把错误细节放在 `errorData.code` —— `block` 表示当前
 * 出口 IP 整段被风控（Oracle Cloud / AWS / GCP 等数据中心 IP 触发批量黑名单）。
 * 这种情况下 `data.list` 是 undefined,旧代码会静默返回空列表看上去像"加载失败"。
 * 这里检测出来后直接抛 NetLiveListUnsupportedError,UI 能渲染友好提示。
 */
function assertPandaliveOk(data: {
  result?: boolean;
  message?: string;
  errorData?: { code?: string; message?: string };
  userIp?: string;
}): void {
  if (data.result !== false) return;
  const code = data.errorData?.code;
  if (code === "block") {
    const msg = `代理出口 IP 被 Pandalive 风控${data.userIp ? `（${data.userIp}）` : ""} —— 数据中心 IP 段（Oracle / AWS / GCP / DigitalOcean 等）会被批量封,请换韩国/日本住宅代理或换出口节点`;
    blockedUntil = Date.now() + BLOCK_COOLDOWN_MS;
    lastBlockMessage = msg;
    throw new NetLiveListUnsupportedError("Pandalive", msg);
  }
  throw new Error(
    `Pandalive 服务端拒绝${code ? `（${code}）` : ""}: ${data.errorData?.message ?? data.message ?? "未知错误"}`,
  );
}

function mapRoom(r: PlRoomRaw): NetLiveRoom | undefined {
  const uid = r.userId;
  if (!uid) return undefined;
  return {
    platform: "pandalive",
    roomId: uid,
    title: r.title || r.userNick || uid,
    uname: r.userNick || uid,
    avatar: r.userImg,
    cover: r.thumbUrl,
    online: r.user ?? 0,
    category: r.isAdult ? "19+" : r.category,
    live: r.isLive ?? true,
    link: `https://www.pandalive.co.kr/live/play/${uid}`,
  };
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  let res;
  try {
    res = await scriptFetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { ...COMMON_HEADERS, "Content-Type": "application/json" },
      json: body,
      timeout: 25_000,
      http2: true,
    });
  } catch (e) {
    throw new NetLiveListUnsupportedError(
      "Pandalive",
      `网络层不可达（${(e as Error).message ?? String(e)}）—— 韩国边缘 CDN 对 TLS 指纹敏感，请配置代理（韩国/日本节点）`,
    );
  }
  if (!res.ok) {
    if (res.status === 403 || res.status === 503) {
      throw new NetLiveListUnsupportedError(
        "Pandalive",
        `HTTP ${res.status} 拦截，需配置代理`,
      );
    }
    throw new Error(`Pandalive HTTP ${res.status}`);
  }
  return res.json<T>();
}

/**
 * `/v1/live/index` 实测必须用 **GET + query string** —— POST body 里的
 * `limit`/`offset`/`page` 全被服务端忽略,固定返 limit=10、page=1,导致"加载更多"
 * 拿到的还是首页,前端去重后看起来没新增。改用 GET 后 offset 才生效。
 */
async function getJson<T>(
  path: string,
  params: Record<string, string | number | boolean>,
): Promise<T> {
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const url = qs ? `${API_BASE}${path}?${qs}` : `${API_BASE}${path}`;
  let res;
  try {
    res = await scriptFetch(url, {
      method: "GET",
      headers: COMMON_HEADERS,
      timeout: 25_000,
      http2: true,
    });
  } catch (e) {
    throw new NetLiveListUnsupportedError(
      "Pandalive",
      `网络层不可达（${(e as Error).message ?? String(e)}）—— 韩国边缘 CDN 对 TLS 指纹敏感，请配置代理（韩国/日本节点）`,
    );
  }
  if (!res.ok) {
    if (res.status === 403 || res.status === 503) {
      throw new NetLiveListUnsupportedError(
        "Pandalive",
        `HTTP ${res.status} 拦截，需配置代理`,
      );
    }
    throw new Error(`Pandalive HTTP ${res.status}`);
  }
  return res.json<T>();
}

async function postForm<T>(
  path: string,
  body: Record<string, string>
): Promise<T> {
  const form = Object.entries(body)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  let res;
  try {
    res = await scriptFetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        ...COMMON_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      timeout: 25_000,
      http2: true,
    });
  } catch (e) {
    throw new NetLiveListUnsupportedError(
      "Pandalive",
      `网络层不可达（${(e as Error).message ?? String(e)}）—— 韩国边缘 CDN 对 TLS 指纹敏感，请配置代理（韩国/日本节点）`
    );
  }
  if (!res.ok) {
    if (res.status === 403 || res.status === 503) {
      throw new NetLiveListUnsupportedError(
        "Pandalive",
        `HTTP ${res.status} 拦截，需配置代理`
      );
    }
    throw new Error(`Pandalive HTTP ${res.status}`);
  }
  return res.json<T>();
}

async function fetchList(
  page: number,
  pageSize: number,
  orderBy: string = "user",
  isAdult: boolean = false,
  onlyNewBj: "Y" | "N" = "N",
): Promise<PlListResp> {
  ensureNotBlocked();
  const cacheKey = `${orderBy}|${onlyNewBj}|${isAdult ? 1 : 0}|${page}|${pageSize}`;
  const cached = getCachedList(cacheKey);
  if (cached) return cached;
  const offset = Math.max(0, (page - 1) * pageSize);
  // GET + query string —— 见 getJson 文档。POST body 会被服务端默 limit=10、page=1。
  const params: Record<string, string | number | boolean> = {
    orderBy,
    onlyNewBj,
    limit: pageSize,
    offset,
  };
  if (isAdult) params.isAdult = true;
  const data = await getJson<PlListResp>("/v1/live/index", params);
  assertPandaliveOk(data);
  setCachedList(cacheKey, data);
  return data;
}

/* ─────────────── 推荐 ─────────────── */

async function getRecommend(
  page: number,
  pageSize: number,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const limit = Math.max(pageSize, 24);
  const data = await fetchList(page, limit, "user", false);
  const arr = data.list ?? [];
  const list = arr.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
  // 用 server 返的 paging 判 hasMore（CN IP 触发 needAuth 时 page 永远 1，hasMore=false 是正确行为）
  const pg = data.page;
  const hasMore = pg
    ? (pg.page ?? page) < (pg.lastPage ?? 0)
    : arr.length >= limit;
  return { list, hasMore };
}

/* ─────────────── 分类 ─────────────── */

const PRESET_CATEGORIES: NetLiveCategory[] = [
  { id: "user", name: "人气" },
  { id: "newBj", name: "新人" },
  { id: "bookmark", name: "收藏多" },
  { id: "adult", name: "19+" }, // 匿名访问会空 / 报 needAdult —— 需韩国身份证 KCB 认证
];

async function getCategories(): Promise<NetLiveCategory[]> {
  return PRESET_CATEGORIES;
}

async function getCategoryRooms(
  categoryId: string,
  page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const isAdult = categoryId === "adult";
  const orderBy = isAdult ? "user" : categoryId;
  const data = await fetchList(page, 24, orderBy, isAdult);
  const arr = data.list ?? [];
  const list = arr.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
  const pg = data.page;
  const hasMore = pg
    ? (pg.page ?? page) < (pg.lastPage ?? 0)
    : arr.length >= 24;
  return { list, hasMore };
}

/* ─────────────── 搜索 ─────────────── */

async function search(
  keyword: string,
  _page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  try {
    ensureNotBlocked();
    const data = await postJson<PlListResp>("/v1/live/bj_list", {
      keyword,
      orderBy: "user",
      onlyNewBj: "N",
      limit: 30,
      offset: 0,
    });
    assertPandaliveOk(data);
    const arr = data.list ?? [];
    const list = arr.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
    return { list, hasMore: false };
  } catch {
    return { list: [], hasMore: false };
  }
}

/* ─────────────── 房间详情 + resolve ─────────────── */
// play 接口返 media + PlayList 一气呵成，getRoomDetail 复用即可

interface PlPlayResp {
  result?: boolean;
  media?: PlRoomRaw;
  PlayList?: {
    size?: { width?: number; height?: number };
    hls?: Array<{ name?: string; sort?: number; url?: string }>;
    hls2?: Array<{ name?: string; sort?: number; url?: string }>;
    hls3?: Array<{ name?: string; sort?: number; url?: string }>;
  };
  errorData?: { code?: string; message?: string };
  message?: string;
}

async function fetchPlay(roomId: string): Promise<PlPlayResp> {
  ensureNotBlocked();
  const data = await postForm<PlPlayResp>("/v1/live/play", {
    userId: roomId,
    action: "watch",
    password: "",
    shareLinkType: "",
  });
  assertPandaliveOk(data);
  return data;
}

async function getRoomDetail(roomId: string): Promise<NetLiveRoom> {
  const info = await fetchPlay(roomId);
  const m = info.media;
  if (!m) throw new Error(`Pandalive 房间 ${roomId} 未找到`);
  return {
    platform: "pandalive",
    roomId,
    title: m.title || m.userNick || roomId,
    uname: m.userNick,
    avatar: m.userImg,
    cover: m.thumbUrl,
    online: m.user ?? 0,
    category: m.isAdult ? "19+" : m.category,
    live: m.isLive ?? true,
    link: `https://www.pandalive.co.kr/live/play/${roomId}`,
  };
}

async function getLiveStatus(roomId: string): Promise<boolean> {
  try {
    const info = await fetchPlay(roomId);
    return !!info.media?.isLive;
  } catch {
    return false;
  }
}

async function resolve(roomId: string): Promise<NetLiveStream> {
  const data = await fetchPlay(roomId);
  if (data.errorData?.code) {
    const c = data.errorData.code;
    if (c === "needAdult" || c === "needLogin") {
      throw new Error("Pandalive 该房间需登录 + 19+ 年龄验证（韩国身份证），匿名无法播放");
    }
    if (c === "needPw") {
      throw new Error("Pandalive 该房间已加密（密码房 / 粉丝房）");
    }
    throw new Error(`Pandalive 拉流失败：${data.errorData.message ?? c}`);
  }
  // 实测：PlayList.hls3 / hls2 / hls 三档，URL 都是 AWS IVS playback m3u8，自带短期 JWT
  const pl = data.PlayList;
  const url =
    pl?.hls3?.[0]?.url || pl?.hls2?.[0]?.url || pl?.hls?.[0]?.url;
  if (!url) {
    throw new Error("Pandalive 未返回 hls URL（房间可能刚下播 / 私密房）");
  }
  const alternatives = [
    ...(pl?.hls3 ?? []).map((x, i) => ({ qn: `hls3_${i}`, label: x.name ?? "原画", url: x.url ?? "" })),
    ...(pl?.hls2 ?? []).map((x, i) => ({ qn: `hls2_${i}`, label: x.name ?? "标清", url: x.url ?? "" })),
    ...(pl?.hls ?? []).map((x, i) => ({ qn: `hls_${i}`, label: x.name ?? "兼容", url: x.url ?? "" })),
  ].filter((a) => a.url);
  return {
    url,
    streamType: "hls",
    qn: "auto",
    qnLabel: "原画",
    referer: REFERER,
    ua: UA,
    alternatives: alternatives.length > 1 ? alternatives : undefined,
  };
}

/* ─────────────── 导出 ─────────────── */

export const pandaliveAdapter: NetLiveAdapter = {
  platform: "pandalive",
  getRecommend,
  search,
  resolve,
  getCategories,
  getCategoryRooms,
  getRoomDetail,
  getLiveStatus,
};
