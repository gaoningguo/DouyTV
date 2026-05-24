/**
 * 哔哩哔哩直播 adapter —— 完整移植自 `pure_live/lib/core/site/bilibili_site.dart`。
 *
 * 关键点（vs 早期简化版）：
 *   - 必须带 buvid3/buvid4 cookie（`api.bilibili.com/x/frontend/finger/spi` 拿）
 *   - 需要 WBI 签名（img_key/sub_key from `api.bilibili.com/x/web-interface/nav`，
 *     用固定 mixinKeyEncTab 重排 → md5(query+mixinKey) 得 w_rid）
 *   - 推荐用 `xlive/web-interface/v1/second/getListByArea` (+ WBI)
 *   - 分类房间用 `xlive/web-interface/v1/second/getList` (+ WBI + w_webid=access_id)
 *   - getRoomPlayInfo 须传 platform=html5 + dolby=5；过滤 format_name === 'flv' 只取 HLS
 *   - URL 含 mcdn 走 `proxy-tf-all-ws.bilivideo.com`；含 upgcxcode 重写为 mirror CDN
 */
import CryptoJS from "crypto-js";
import { createPlatformFetch } from "@/lib/netlive/scriptFetch";
const scriptFetch = createPlatformFetch("bilibili");
import type {
  NetLiveAdapter,
  NetLiveCategory,
  NetLiveRoom,
  NetLiveStream,
} from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";
const REFERER = "https://live.bilibili.com/";

let cachedBuvid3 = "";
let cachedBuvid4 = "";
let cachedImgKey = "";
let cachedSubKey = "";
let cachedAccessId = "";

interface BiliEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

async function fetchJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const res = await scriptFetch(url, {
    method: "GET",
    headers,
    timeout: 20_000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const json = await res.json<BiliEnvelope<T>>();
  if (json.code !== undefined && json.code !== 0) {
    throw new Error(json.message ? `${json.message}` : `B站 code ${json.code}`);
  }
  return (json.data ?? json) as T;
}

/**
 * **不严格**版 fetchJson —— 无视 `code` 字段，只要 HTTP 200 + 有 data 就返回。
 *
 * B 站对未登录用户惯例性返 `code:-101 账号未登录`，但 **data 字段依然包含可用信息**
 * （例如 nav 仍返 `wbi_img`；getRoomPlayInfo 仍返默认清晰度的 stream URL）。
 * 严格按 code 拒绝会导致匿名场景一切都 -101 拒。
 */
async function fetchJsonLoose<T>(
  url: string,
  headers: Record<string, string>
): Promise<T | undefined> {
  const res = await scriptFetch(url, {
    method: "GET",
    headers,
    timeout: 20_000,
  });
  if (!res.ok) return undefined;
  try {
    const json = await res.json<BiliEnvelope<T>>();
    return (json.data ?? json) as T;
  } catch {
    return undefined;
  }
}

async function fetchText(url: string, headers: Record<string, string>): Promise<string> {
  const res = await scriptFetch(url, {
    method: "GET",
    headers,
    timeout: 20_000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

/* ─────────────── buvid3/4 + headers ───────────────
 * 严格对齐 dart_simple_live / pure_live —— 只拿 buvid3+buvid4 ，cookie 也只放这两项。
 * 之前的 ExClimbWuzhi + bili_ticket + _uuid + Origin/Sec-Fetch 等多余伪装会引入指纹冲突
 * （Win32 ↔ MacIntel 等），反而 100% 触发 Gaia -352。这两个开源项目长期匿名可用，
 * 证明 B 站对「最朴素」的请求是放行的，只要别凑出可疑的"伪浏览器"指纹。
 */

async function ensureBuvid(): Promise<void> {
  if (cachedBuvid3) return;
  // finger/spi 也可能因为没初始 cookie 返回 -101，用 loose 模式
  const data = await fetchJsonLoose<{ b_3?: string; b_4?: string }>(
    "https://api.bilibili.com/x/frontend/finger/spi",
    {
      "user-agent": UA,
      referer: REFERER,
    }
  );
  cachedBuvid3 = data?.b_3 ?? "";
  cachedBuvid4 = data?.b_4 ?? "";
}

async function getHeaders(): Promise<Record<string, string>> {
  await ensureBuvid();
  return {
    "user-agent": UA,
    referer: REFERER,
    cookie: `buvid3=${cachedBuvid3};buvid4=${cachedBuvid4};`,
  };
}

/* ─────────────── WBI 签名 ─────────────── */

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];

async function getWbiKeys(): Promise<{ imgKey: string; subKey: string }> {
  if (cachedImgKey && cachedSubKey) {
    return { imgKey: cachedImgKey, subKey: cachedSubKey };
  }
  const headers = await getHeaders();
  // nav 对未登录用户返 `code:-101 账号未登录`，但 data.wbi_img 依然包含 img_url/sub_url
  // 必须用 loose 版本绕过 code 校验
  const data = await fetchJsonLoose<{
    wbi_img?: { img_url?: string; sub_url?: string };
  }>("https://api.bilibili.com/x/web-interface/nav", headers);
  const imgUrl = data?.wbi_img?.img_url ?? "";
  const subUrl = data?.wbi_img?.sub_url ?? "";
  const imgKey = imgUrl.substring(imgUrl.lastIndexOf("/") + 1).split(".")[0] ?? "";
  const subKey = subUrl.substring(subUrl.lastIndexOf("/") + 1).split(".")[0] ?? "";
  cachedImgKey = imgKey;
  cachedSubKey = subKey;
  return { imgKey, subKey };
}

function getMixinKey(origin: string): string {
  let s = "";
  for (const i of MIXIN_KEY_ENC_TAB) {
    if (i < origin.length) s += origin[i];
  }
  return s.substring(0, 32);
}

const FORBIDDEN_CHARS = new Set(["!", "'", "(", ")", "*"]);

async function buildWbiQuery(baseUrl: string): Promise<string> {
  const { imgKey, subKey } = await getWbiKeys();
  const mixinKey = getMixinKey(imgKey + subKey);
  const wts = Math.floor(Date.now() / 1000);

  const u = new URL(baseUrl);
  const params: Array<[string, string]> = [];
  u.searchParams.forEach((v, k) => params.push([k, v]));
  params.push(["wts", String(wts)]);
  // 按 key 排序
  params.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  // 过滤 value 中的 !'()*
  const sanitized = params.map(([k, v]) => {
    const cleaned = Array.from(v)
      .filter((c) => !FORBIDDEN_CHARS.has(c))
      .join("");
    return [k, cleaned] as [string, string];
  });
  // urlencode value（key 不编码，按 dart 写法 encodeQueryComponent 对 value）
  const encoded = sanitized
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  const wRid = CryptoJS.MD5(encoded + mixinKey).toString(CryptoJS.enc.Hex);
  return `${encoded}&w_rid=${wRid}`;
}

async function fetchWithWbi<T>(baseUrl: string): Promise<T> {
  const query = await buildWbiQuery(baseUrl);
  const u = new URL(baseUrl);
  // 用签名后的 query 整体替换
  u.search = `?${query}`;
  const headers = await getHeaders();
  // loose 模式：B 站对未登录返 -101 但通常 data 已经填好
  const data = await fetchJsonLoose<T>(u.toString(), headers);
  if (data === undefined) throw new Error(`B站 ${baseUrl} 无响应`);
  return data;
}

/* ─────────────── access_id (w_webid) ─────────────── */

async function getAccessId(): Promise<string> {
  if (cachedAccessId) return cachedAccessId;
  try {
    const headers = await getHeaders();
    const html = await fetchText("https://live.bilibili.com/lol", headers);
    const m = html.match(/"access_id":"(.*?)"/);
    cachedAccessId = (m?.[1] ?? "").replace(/\\/g, "");
  } catch (e) {
    console.warn("[bilibili] access_id failed", e);
  }
  return cachedAccessId;
}

/* ─────────────── 列表卡片映射 ─────────────── */

interface BiliListItem {
  roomid?: number | string;
  title?: string;
  uname?: string;
  face?: string;
  cover?: string;
  online?: number | string;
  area_name?: string;
}

function mapRoom(item: BiliListItem): NetLiveRoom | undefined {
  const rid = item.roomid;
  if (rid === undefined || rid === null) return undefined;
  return {
    platform: "bilibili",
    roomId: String(rid),
    title: item.title ?? "",
    cover: item.cover ? `${item.cover}@400w.jpg` : undefined,
    uname: item.uname,
    avatar: item.face,
    online:
      typeof item.online === "string"
        ? parseInt(item.online, 10) || 0
        : item.online,
    category: item.area_name,
    live: true,
    link: `https://live.bilibili.com/${rid}`,
  };
}

/* ─────────────── 推荐（getListByArea + WBI） ─────────────── */

interface BiliListResp {
  list?: BiliListItem[];
  has_more?: number;
}

async function getRecommend(
  page: number,
  _pageSize: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const baseUrl = `https://api.live.bilibili.com/xlive/web-interface/v1/second/getListByArea?platform=web&sort=online&page_size=30&page=${page}`;
  const data = await fetchWithWbi<BiliListResp>(baseUrl);
  const arr = data.list ?? [];
  const list = arr.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: arr.length > 0 };
}

/* ─────────────── 分类树 ─────────────── */

interface BiliAreaListResp {
  data?: Array<{
    id?: number | string;
    name?: string;
    list?: Array<{
      id?: number | string;
      name?: string;
      parent_id?: string;
      pic?: string;
    }>;
  }>;
}

async function getCategories(): Promise<NetLiveCategory[]> {
  const headers = await getHeaders();
  const res = await scriptFetch(
    "https://api.live.bilibili.com/room/v1/Area/getList?need_entrance=1&parent_id=0",
    { method: "GET", headers, timeout: 20_000 }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const env = await res.json<BiliAreaListResp>();
  const out: NetLiveCategory[] = [];
  for (const parent of env.data ?? []) {
    for (const child of parent.list ?? []) {
      if (child.id === undefined || child.id === null) continue;
      out.push({
        id: `${parent.id ?? ""}:${child.id}`,
        name: child.name ?? "",
        cover: child.pic ? `${child.pic}@100w.png` : undefined,
        parent: parent.name,
      });
    }
  }
  return out;
}

async function getCategoryRooms(
  categoryId: string,
  page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const [parentId, areaId] = categoryId.split(":");
  if (!parentId || !areaId) {
    throw new Error('分类 ID 格式应为 "parent:child"');
  }
  const accessId = await getAccessId();
  const baseUrl = `https://api.live.bilibili.com/xlive/web-interface/v1/second/getList?platform=web&parent_area_id=${parentId}&area_id=${areaId}&sort_type=&page=${page}&w_webid=${encodeURIComponent(accessId)}`;
  const data = await fetchWithWbi<BiliListResp>(baseUrl);
  const arr = data.list ?? [];
  const list = arr.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: data.has_more === 1 };
}

/* ─────────────── 搜索 ─────────────── */

interface BiliSearchItem {
  roomid?: number | string;
  title?: string;
  cover?: string;
  uname?: string;
  online?: number | string;
  cate_name?: string;
  uface?: string;
  live_status?: number;
}

interface BiliSearchResp {
  result?: { live_room?: BiliSearchItem[] };
}

async function search(
  keyword: string,
  page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const headers = await getHeaders();
  const url = `https://api.bilibili.com/x/web-interface/search/type?context=&search_type=live&cover_type=user_cover&order=&keyword=${encodeURIComponent(keyword)}&category_id=&__refresh__=&_extra=&highlight=0&single_column=0&page=${page}`;
  const data = await fetchJson<BiliSearchResp>(url, headers);
  const arr = data.result?.live_room ?? [];
  const list: NetLiveRoom[] = [];
  for (const item of arr) {
    if (item.roomid === undefined || item.roomid === null) continue;
    const title = (item.title ?? "").replace(/<.*?em.*?>/g, "");
    list.push({
      platform: "bilibili",
      roomId: String(item.roomid),
      title,
      cover: item.cover ? `https:${item.cover}@400w.jpg` : undefined,
      uname: item.uname,
      avatar: item.uface ? `https:${item.uface}@400w.jpg` : undefined,
      online:
        typeof item.online === "string"
          ? parseInt(item.online, 10) || 0
          : item.online,
      category: item.cate_name,
      live: item.live_status === 1,
      link: `https://live.bilibili.com/${item.roomid}`,
    });
  }
  return { list, hasMore: arr.length > 0 };
}

/* ─────────────── 房间详情 ─────────────── */

interface BiliRoomInfo {
  room_info?: {
    room_id?: number | string;
    title?: string;
    cover?: string;
    description?: string;
    online?: number | string;
    area_name?: string;
    live_status?: number;
  };
  anchor_info?: {
    base_info?: { uname?: string; face?: string };
  };
}

async function getRoomDetail(roomId: string): Promise<NetLiveRoom> {
  const baseUrl = `https://api.live.bilibili.com/xlive/web-room/v1/index/getInfoByRoom?room_id=${roomId}`;
  const info = await fetchWithWbi<BiliRoomInfo>(baseUrl);
  const r = info.room_info;
  const a = info.anchor_info?.base_info;
  if (!r) throw new Error("B站未返回房间信息");
  // dart_simple_live: 用 room_info.room_id 作为真实 roomId（短号→长号映射）
  const realRoomId = String(r.room_id ?? roomId);
  return {
    platform: "bilibili",
    roomId: realRoomId,
    title: r.title ?? "",
    cover: r.cover,
    uname: a?.uname,
    avatar: a?.face ? `${a.face}@100w.jpg` : undefined,
    online:
      typeof r.online === "string" ? parseInt(r.online, 10) || 0 : r.online,
    category: r.area_name,
    introduction: r.description,
    live: r.live_status === 1,
    link: `https://live.bilibili.com/${roomId}`,
  };
}

/* ─────────────── resolve（getRoomPlayInfo） ─────────────── */

interface BiliPlayUrlInfo {
  host?: string;
  extra?: string;
}

interface BiliCodec {
  codec_name?: string;
  base_url?: string;
  url_info?: BiliPlayUrlInfo[];
  accept_qn?: number[];
  current_qn?: number;
}

interface BiliFormat {
  format_name?: string;
  codec?: BiliCodec[];
}

interface BiliStream {
  protocol_name?: string;
  format?: BiliFormat[];
}

interface BiliPlayInfoResp {
  playurl_info?: {
    playurl?: {
      g_qn_desc?: Array<{ qn?: number; desc?: string }>;
      stream?: BiliStream[];
    };
  };
}

/** Legacy `room/v1/Room/playUrl` 响应 —— durl + accept_quality + quality_description */
interface BiliLegacyPlayUrlResp {
  current_quality?: number;
  accept_quality?: string[];
  quality_description?: Array<{ qn?: number; desc?: string }>;
  durl?: Array<{ url?: string }>;
}

const MIRROR_CDN = "upos-sz-mirrorali.bilivideo.com";

function rewriteBiliUrl(url: string): string {
  if (url.includes(".mcdn.bilivideo")) {
    return `https://proxy-tf-all-ws.bilivideo.com/?url=${encodeURIComponent(url)}`;
  }
  if (url.includes("/upgcxcode/")) {
    return url.replace(
      /(https?):\/\/(.*?)\/upgcxcode\//,
      `https://${MIRROR_CDN}/upgcxcode/`
    );
  }
  return url;
}

/**
 * 拉流：用 **legacy `room/v1/Room/playUrl`** 作为主路径。
 *
 * 背景：B 站新版 `xlive/web-room/v2/index/getRoomPlayInfo` 对 `platform=web/html5` 都
 * 越来越严，匿名 buvid 经常返 `code:-101 账号未登录`。pure_live / dart_simple_live
 * 用的都是 v2 + buvid cookie，但要看用户账号 cookie 才稳。
 *
 * **legacy v1** (`room/v1/Room/playUrl?cid={realRoomId}&qn=...&platform=h5`) 是
 * B 站早期 H5 mobile 端用的接口，从未加过登录态校验，返回 `durl[]`（FLV 直链）。
 * 对未登录匿名访问最友好 —— 这是我们的主路径。
 *
 * v2 接口作为 fallback：如果 v1 也失败再尝试。
 */
async function fetchLegacyPlayUrl(
  realRoomId: string
): Promise<NetLiveStream | null> {
  const headers = await getHeaders();
  // platform=h5 走 mobile 端协议；qn=0 让服务器返默认；platform_id=3 / device=phone 模拟手机
  const url = `https://api.live.bilibili.com/room/v1/Room/playUrl?cid=${realRoomId}&qn=0&platform=h5&https_url_req=1&ptype=16`;
  // 用 loose 版 —— B 站对未登录返 -101 但 durl 仍在 data 里
  const data = await fetchJsonLoose<BiliLegacyPlayUrlResp>(url, headers);
  const durl = data?.durl ?? [];
  if (durl.length === 0) return null;

  // 排序：mcdn 排后面
  const sorted = [...durl].sort((a, b) => {
    const am = a.url?.includes("mcdn") ? 1 : 0;
    const bm = b.url?.includes("mcdn") ? 1 : 0;
    return am - bm;
  });
  const primaryRaw = sorted[0].url;
  if (!primaryRaw) return null;
  const primary = rewriteBiliUrl(primaryRaw);

  // accept_quality + quality_description 拼成 alternatives label
  const qLabels = new Map<number, string>();
  for (const q of data?.quality_description ?? []) {
    if (q.qn !== undefined && q.desc) qLabels.set(q.qn, q.desc);
  }
  const currentQuality = data?.current_quality ?? 0;
  const alternatives = (data?.accept_quality ?? [])
    .map((q) => parseInt(q, 10))
    .filter((q) => !isNaN(q))
    .map((qn) => ({
      qn: String(qn),
      label: qLabels.get(qn) ?? `qn=${qn}`,
      url: qn === currentQuality ? primary : "",
    }));

  const streamType: NetLiveStream["streamType"] = primary.includes(".m3u8")
    ? "hls"
    : "flv";
  return {
    url: primary,
    streamType,
    qn: String(currentQuality),
    qnLabel: qLabels.get(currentQuality) ?? "原画",
    alternatives: alternatives.length > 0 ? alternatives : undefined,
    referer: REFERER,
    ua: UA,
  };
}

/** v2 fallback —— 如果新版接口能匿名拿到也优先用（HLS 更好）；多数情况会被 -101 拒 */
async function fetchModernPlayInfo(
  realRoomId: string
): Promise<NetLiveStream | null> {
  const headers = await getHeaders();
  const url = `https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id=${realRoomId}&protocol=0,1&format=0,1,2&codec=0,1&platform=html5&dolby=5`;
  const data = await fetchJsonLoose<BiliPlayInfoResp>(url, headers);
  const streams = data?.playurl_info?.playurl?.stream ?? [];
  const qnDesc = data?.playurl_info?.playurl?.g_qn_desc ?? [];
  const qnLabelMap = new Map<number, string>();
  for (const q of qnDesc) {
    if (q.qn !== undefined && q.desc) qnLabelMap.set(q.qn, q.desc);
  }
  const urls: Array<{
    url: string;
    current_qn: number;
    alts: number[];
    streamType: NetLiveStream["streamType"];
  }> = [];
  for (const s of streams) {
    for (const fmt of s.format ?? []) {
      const formatName = (fmt.format_name ?? "").toLowerCase();
      const streamType: NetLiveStream["streamType"] =
        formatName === "flv" ? "flv" : "hls";
      for (const codec of fmt.codec ?? []) {
        const baseUrl = codec.base_url;
        if (!baseUrl) continue;
        for (const info of codec.url_info ?? []) {
          if (!info.host) continue;
          const raw = `${info.host}${baseUrl}${info.extra ?? ""}`;
          urls.push({
            url: rewriteBiliUrl(raw),
            current_qn: codec.current_qn ?? 0,
            alts: codec.accept_qn ?? [],
            streamType,
          });
        }
      }
    }
  }
  urls.sort((a, b) => {
    if (a.streamType !== b.streamType) {
      return a.streamType === "hls" ? -1 : 1;
    }
    const am = a.url.includes("mcdn") ? 1 : 0;
    const bm = b.url.includes("mcdn") ? 1 : 0;
    return am - bm;
  });
  if (urls.length === 0) return null;
  const chosen = urls[0];
  const alternatives = (chosen.alts ?? []).map((qn) => ({
    qn: String(qn),
    label: qnLabelMap.get(qn) ?? `qn=${qn}`,
    url: qn === chosen.current_qn ? chosen.url : "",
  }));
  return {
    url: chosen.url,
    streamType: chosen.streamType,
    qn: String(chosen.current_qn),
    qnLabel: qnLabelMap.get(chosen.current_qn) ?? "原画",
    alternatives: alternatives.length > 0 ? alternatives : undefined,
    referer: REFERER,
    ua: UA,
  };
}

async function resolve(roomId: string): Promise<NetLiveStream> {
  // 先用 getInfoByRoom 转换短号 → 真实 room_id
  let realRoomId = roomId;
  try {
    const info = await fetchWithWbi<BiliRoomInfo>(
      `https://api.live.bilibili.com/xlive/web-room/v1/index/getInfoByRoom?room_id=${roomId}`
    );
    if (info.room_info?.room_id !== undefined) {
      realRoomId = String(info.room_info.room_id);
    }
  } catch (e) {
    console.warn("[bilibili] resolve: getInfoByRoom failed, using raw roomId", e);
  }

  // 主：v1 legacy（匿名稳）；v2 fallback（HLS 体验更好但严风控）
  const v1 = await fetchLegacyPlayUrl(realRoomId);
  if (v1) return v1;
  const v2 = await fetchModernPlayInfo(realRoomId);
  if (v2) return v2;
  throw new Error("B站未返回可用拉流地址（房间未开播 / 风控）");
}

async function getLiveStatus(roomId: string): Promise<boolean> {
  try {
    const headers = await getHeaders();
    const data = await fetchJson<{ live_status?: number }>(
      `https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${roomId}`,
      headers
    );
    return data.live_status === 1;
  } catch {
    return false;
  }
}

/* ─────────────── 导出 ─────────────── */

export const bilibiliAdapter: NetLiveAdapter = {
  platform: "bilibili",
  getRecommend,
  search,
  resolve,
  getCategories,
  getCategoryRooms,
  getRoomDetail,
  getLiveStatus,
};
