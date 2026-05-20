/**
 * 抖音直播 adapter —— 移植自 pure_live `lib/core/site/douyin_site.dart`。
 *
 * 实现范围：
 *   - getRecommend：`partition=720,partition_type=1` 热门推荐
 *   - getCategories：从 `live.douyin.com/?from_nav=1` HTML 提取 categoryData JSON
 *   - getCategoryRooms：按 `partition,partition_type` 拉
 *   - search：`www.douyin.com/aweme/v1/web/live/search/`，返回的 lives.rawdata 是 JSON 字符串
 *   - getRoomDetail：先按 webRid 走 `webcast/room/web/enter/`，失败 fallback HTML 解析
 *   - resolve：从 detail 的 stream_url 中按 quality 抽 flv/hls
 *
 * 签名：所有 `webcast/web/*` 请求都需要 `a_bogus` + `msToken`，通过 vendored ABOGUS_SCRIPT 计算。
 * 不依赖 cookie 登录态——默认 ttwid 即可拿到所有公开数据。
 */
import { scriptFetch } from "@/source-script/fetch";
import { ABOGUS_SCRIPT } from "./douyin-abogus";
import type {
  NetLiveAdapter,
  NetLiveCategory,
  NetLiveRoom,
  NetLiveStream,
} from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.5845.97 Safari/537.36 Core/1.116.567.400 QQBrowser/19.7.6764.400";
const DEFAULT_COOKIE =
  "ttwid=1%7CB1qls3GdnZhUov9o2NxOMxxYS2ff6OSvEWbv0ytbES4%7C1680522049%7C280d802d6d478e3e78d0c807f7c487e7ffec0ae4e5fdd6a0fe74c3c6af149511";
const AUTHORITY = "live.douyin.com";
const REFERER = "https://live.douyin.com";

const MSTOKEN_ALPHA =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function generateMsToken(length = 107): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += MSTOKEN_ALPHA[Math.floor(Math.random() * MSTOKEN_ALPHA.length)];
  }
  return out;
}

let compiledAbogus: ((params: string, ua: string) => string) | null = null;

function getAbogusFn(): (params: string, ua: string) => string {
  if (compiledAbogus) return compiledAbogus;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const fn = new Function(
    "params",
    "userAgent",
    `${ABOGUS_SCRIPT}\nreturn getABogus(params, userAgent);`
  );
  compiledAbogus = fn as (p: string, ua: string) => string;
  return compiledAbogus;
}

/** 给签名接口的 URL 追加 `&msToken=...&a_bogus=...` */
function signUrl(url: string): string {
  const msToken = generateMsToken(107);
  const withToken = `${url}&msToken=${msToken}`;
  // ABogus 输入是 query string（不带 `?`）
  const qs = withToken.split("?")[1] ?? "";
  let aBogus = "";
  try {
    aBogus = getAbogusFn()(qs, UA);
  } catch (e) {
    console.warn("[douyin] a_bogus 失败", e);
    aBogus = "";
  }
  return `${url}&msToken=${encodeURIComponent(msToken)}&a_bogus=${encodeURIComponent(aBogus)}`;
}

function defaultHeaders(): Record<string, string> {
  return {
    "User-Agent": UA,
    Referer: REFERER,
    Authority: AUTHORITY,
    Cookie: DEFAULT_COOKIE,
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await scriptFetch(url, {
    method: "GET",
    headers: defaultHeaders(),
    timeout: 20_000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json<T>();
}

async function fetchText(url: string): Promise<string> {
  const res = await scriptFetch(url, {
    method: "GET",
    headers: defaultHeaders(),
    timeout: 20_000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

/* ─────────────── 列表卡片公共映射 ─────────────── */

interface DouyinPartitionItem {
  web_rid?: string;
  tag_name?: string;
  room?: {
    title?: string;
    cover?: { url_list?: string[] };
    owner?: {
      nickname?: string;
      avatar_thumb?: { url_list?: string[] };
    };
    room_view_stats?: { display_value?: string };
  };
}

function mapPartitionItem(item: DouyinPartitionItem): NetLiveRoom | undefined {
  const rid = item.web_rid;
  if (!rid) return undefined;
  const room = item.room ?? {};
  return {
    platform: "douyin",
    roomId: String(rid),
    title: room.title ?? "",
    cover: room.cover?.url_list?.[0],
    uname: room.owner?.nickname,
    avatar: room.owner?.avatar_thumb?.url_list?.[0],
    online: parseDisplayCount(room.room_view_stats?.display_value),
    category: item.tag_name ?? "热门推荐",
    live: true,
    link: `https://live.douyin.com/${rid}`,
  };
}

function parseDisplayCount(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const num = parseFloat(v);
  if (isNaN(num)) return undefined;
  if (v.includes("万")) return Math.round(num * 10_000);
  if (v.includes("亿")) return Math.round(num * 100_000_000);
  return Math.round(num);
}

/* ─────────────── 共用 query 串 ─────────────── */

function partitionQuery(
  partition: string,
  partitionType: string,
  page: number
): Record<string, string> {
  return {
    aid: "6383",
    app_name: "douyin_web",
    live_id: "1",
    device_platform: "web",
    language: "zh-CN",
    enter_from: "link_share",
    cookie_enabled: "true",
    screen_width: "1980",
    screen_height: "1080",
    browser_language: "zh-CN",
    browser_platform: "Win32",
    browser_name: "Edge",
    browser_version: "125.0.0.0",
    browser_online: "true",
    count: "15",
    offset: String((page - 1) * 15),
    partition,
    partition_type: partitionType,
    req_from: "2",
  };
}

function buildUrl(base: string, params: Record<string, string>): string {
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return `${base}?${qs}`;
}

/* ─────────────── 推荐 ─────────────── */

interface DouyinPartitionResp {
  data?: { data?: DouyinPartitionItem[] };
}

async function getRecommend(
  page: number,
  _pageSize: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const url = buildUrl(
    "https://live.douyin.com/webcast/web/partition/detail/room/v2/",
    partitionQuery("720", "1", page)
  );
  const signed = signUrl(url);
  const data = await fetchJson<DouyinPartitionResp>(signed);
  const items = data.data?.data ?? [];
  const list = items
    .map(mapPartitionItem)
    .filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: items.length >= 15 };
}

/* ─────────────── 分类（从首页 HTML 抽 categoryData） ─────────────── */

function extractCategoryDataJson(source: string): string {
  const startPattern = '{\\"pathname\\":\\"/\\",\\"categoryData\\":';
  const startIndex = source.indexOf(startPattern);
  if (startIndex === -1) return "";
  let openBraces = 0;
  let foundFirstBrace = false;
  for (let i = startIndex; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      openBraces++;
      foundFirstBrace = true;
    } else if (ch === "}") {
      openBraces--;
    }
    if (foundFirstBrace && openBraces === 0) {
      const raw = source.substring(startIndex, i + 1);
      return raw.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
  }
  return "";
}

interface DouyinCategoryRoot {
  categoryData?: Array<{
    partition?: { id_str?: string; type?: number | string; title?: string };
    sub_partition?: Array<{
      partition?: { id_str?: string; type?: number | string; title?: string };
    }>;
  }>;
}

async function getCategories(): Promise<NetLiveCategory[]> {
  const html = await fetchText("https://live.douyin.com/?from_nav=1");
  const extracted = extractCategoryDataJson(html);
  if (!extracted) return [];
  let parsed: DouyinCategoryRoot;
  try {
    parsed = JSON.parse(extracted) as DouyinCategoryRoot;
  } catch {
    return [];
  }
  const out: NetLiveCategory[] = [];
  for (const item of parsed.categoryData ?? []) {
    const parentTitle = item.partition?.title ?? "";
    const parentId = `${item.partition?.id_str ?? ""},${item.partition?.type ?? ""}`;
    for (const sub of item.sub_partition ?? []) {
      const subId = `${sub.partition?.id_str ?? ""},${sub.partition?.type ?? ""}`;
      if (!subId.startsWith(",")) {
        out.push({
          id: subId,
          name: sub.partition?.title ?? "",
          parent: parentTitle,
        });
      }
    }
    // 把"父类整体"作为伪子分类也加入，便于浏览
    if (parentId && !parentId.startsWith(",")) {
      out.push({ id: parentId, name: `${parentTitle}-全部`, parent: parentTitle });
    }
  }
  return out;
}

async function getCategoryRooms(
  categoryId: string,
  page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const [partition, partitionType] = categoryId.split(",");
  if (!partition || !partitionType) {
    throw new Error(`抖音 categoryId 格式应为 "id,type"，收到：${categoryId}`);
  }
  const url = buildUrl(
    "https://live.douyin.com/webcast/web/partition/detail/room/v2/",
    partitionQuery(partition, partitionType, page)
  );
  const signed = signUrl(url);
  const data = await fetchJson<DouyinPartitionResp>(signed);
  const items = data.data?.data ?? [];
  const list = items
    .map(mapPartitionItem)
    .filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: items.length >= 15 };
}

/* ─────────────── 搜索 ─────────────── */

interface DouyinSearchResp {
  data?: Array<{
    lives?: { rawdata?: string };
  }>;
}

interface DouyinSearchRawdata {
  status?: number;
  title?: string;
  cover?: { url_list?: string[] };
  owner?: {
    web_rid?: string;
    nickname?: string;
    avatar_thumb?: { url_list?: string[] };
  };
  stats?: { total_user_str?: string };
}

async function search(
  keyword: string,
  page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const params: Record<string, string> = {
    device_platform: "webapp",
    aid: "6383",
    channel: "channel_pc_web",
    search_channel: "aweme_live",
    keyword,
    search_source: "switch_tab",
    query_correct_type: "1",
    is_filter_search: "0",
    from_group_id: "",
    offset: String((page - 1) * 10),
    count: "10",
    pc_client_type: "1",
    version_code: "170400",
    version_name: "17.4.0",
    cookie_enabled: "true",
    screen_width: "1980",
    screen_height: "1080",
    browser_language: "zh-CN",
    browser_platform: "Win32",
    browser_name: "Edge",
    browser_version: "125.0.0.0",
    browser_online: "true",
    engine_name: "Blink",
    engine_version: "125.0.0.0",
    os_name: "Windows",
    os_version: "10",
    cpu_core_num: "12",
    device_memory: "8",
    platform: "PC",
    downlink: "10",
    effective_type: "4g",
    round_trip_time: "100",
    webid: "7382872326016435738",
  };
  const url = buildUrl(
    "https://www.douyin.com/aweme/v1/web/live/search/",
    params
  );
  const res = await scriptFetch(url, {
    method: "GET",
    headers: {
      "User-Agent": UA,
      Authority: "www.douyin.com",
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Cookie: DEFAULT_COOKIE,
      Referer: `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=live`,
    },
    timeout: 20_000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  let resp: DouyinSearchResp;
  try {
    resp = await res.json<DouyinSearchResp>();
  } catch {
    throw new Error("抖音搜索被风控，请稍后再试");
  }
  const list: NetLiveRoom[] = [];
  for (const item of resp.data ?? []) {
    const raw = item.lives?.rawdata;
    if (!raw) continue;
    let parsed: DouyinSearchRawdata;
    try {
      parsed = JSON.parse(raw) as DouyinSearchRawdata;
    } catch {
      continue;
    }
    const owner = parsed.owner;
    if (!owner?.web_rid) continue;
    const live = (parsed.status ?? 0) === 2;
    list.push({
      platform: "douyin",
      roomId: owner.web_rid,
      title: parsed.title ?? "",
      cover: parsed.cover?.url_list?.[0],
      uname: owner.nickname,
      avatar: owner.avatar_thumb?.url_list?.[0],
      online: parseDisplayCount(parsed.stats?.total_user_str),
      live,
      link: `https://live.douyin.com/${owner.web_rid}`,
    });
  }
  return { list, hasMore: list.length >= 10 };
}

/* ─────────────── 房间详情 + resolve ─────────────── */

interface DouyinStreamData {
  flv_pull_url?: Record<string, string>;
  hls_pull_url_map?: Record<string, string>;
  live_core_sdk_data?: {
    pull_data?: {
      options?: { qualities?: Array<{ name: string; level: number; sdk_key?: string }> };
      stream_data?: string;
    };
  };
}

interface DouyinEnterResp {
  data?: {
    data?: Array<{
      id_str?: string;
      title?: string;
      cover?: { url_list?: string[] };
      owner?: {
        nickname?: string;
        avatar_thumb?: { url_list?: string[] };
        signature?: string;
      };
      room_view_stats?: { display_value?: string };
      status?: number;
      stream_url?: DouyinStreamData;
    }>;
    user?: {
      nickname?: string;
      avatar_thumb?: { url_list?: string[] };
    };
  };
}

async function fetchEnter(webRid: string): Promise<DouyinEnterResp["data"]> {
  const params: Record<string, string> = {
    aid: "6383",
    app_name: "douyin_web",
    live_id: "1",
    device_platform: "web",
    enter_from: "web_live",
    web_rid: webRid,
    room_id_str: "",
    enter_source: "",
    "Room-Enter-User-Login-Ab": "0",
    is_need_double_stream: "false",
    cookie_enabled: "true",
    screen_width: "1980",
    screen_height: "1080",
    browser_language: "zh-CN",
    browser_platform: "Win32",
    browser_name: "Edge",
    browser_version: "125.0.0.0",
  };
  const url = buildUrl(
    "https://live.douyin.com/webcast/room/web/enter/",
    params
  );
  const signed = signUrl(url);
  const json = await fetchJson<DouyinEnterResp>(signed);
  return json.data;
}

async function getRoomDetail(roomId: string): Promise<NetLiveRoom> {
  const data = await fetchEnter(roomId);
  const r = data?.data?.[0];
  if (!r) throw new Error("抖音未返回房间数据");
  const live = (r.status ?? 0) === 2;
  return {
    platform: "douyin",
    roomId,
    title: r.title ?? "",
    cover: live ? r.cover?.url_list?.[0] : undefined,
    uname: live ? r.owner?.nickname : data?.user?.nickname,
    avatar: live
      ? r.owner?.avatar_thumb?.url_list?.[0]
      : data?.user?.avatar_thumb?.url_list?.[0],
    online: parseDisplayCount(r.room_view_stats?.display_value),
    introduction: r.owner?.signature,
    live,
    link: `https://live.douyin.com/${roomId}`,
  };
}

interface DouyinQualityUrl {
  qn: string;
  label: string;
  url: string;
}

function pickStreamUrls(stream: DouyinStreamData): {
  primary: string;
  type: NetLiveStream["streamType"];
  alts: DouyinQualityUrl[];
} {
  const qualities = stream.live_core_sdk_data?.pull_data?.options?.qualities ?? [];
  const streamDataStr = stream.live_core_sdk_data?.pull_data?.stream_data ?? "";

  const alts: DouyinQualityUrl[] = [];
  let primary = "";
  let type: NetLiveStream["streamType"] = "hls";

  if (streamDataStr.startsWith("{")) {
    // 新版 stream_data JSON
    let parsed: { data?: Record<string, { main?: { flv?: string; hls?: string } }> } = {};
    try {
      parsed = JSON.parse(streamDataStr);
    } catch {
      /* ignore */
    }
    const qData = parsed.data ?? {};
    for (const q of qualities) {
      const main = q.sdk_key ? qData[q.sdk_key]?.main : undefined;
      const hls = main?.hls;
      const flv = main?.flv;
      if (hls) {
        alts.push({ qn: String(q.level), label: q.name, url: hls });
        if (!primary) {
          primary = hls;
          type = "hls";
        }
      } else if (flv) {
        alts.push({ qn: String(q.level), label: q.name, url: flv });
        if (!primary) {
          primary = flv;
          type = "flv";
        }
      }
    }
  } else {
    // 旧版 flv_pull_url / hls_pull_url_map
    const flvList = Object.values(stream.flv_pull_url ?? {});
    const hlsList = Object.values(stream.hls_pull_url_map ?? {});
    for (const q of qualities) {
      const flvIdx = flvList.length - q.level;
      const hlsIdx = hlsList.length - q.level;
      const hlsUrl =
        hlsIdx >= 0 && hlsIdx < hlsList.length ? hlsList[hlsIdx] : "";
      const flvUrl =
        flvIdx >= 0 && flvIdx < flvList.length ? flvList[flvIdx] : "";
      const chosen = hlsUrl || flvUrl;
      if (!chosen) continue;
      alts.push({ qn: String(q.level), label: q.name, url: chosen });
      if (!primary) {
        primary = chosen;
        type = hlsUrl ? "hls" : "flv";
      }
    }
  }
  return { primary, type, alts };
}

async function resolve(roomId: string): Promise<NetLiveStream> {
  const data = await fetchEnter(roomId);
  const r = data?.data?.[0];
  if (!r) throw new Error("抖音未返回房间数据");
  if ((r.status ?? 0) !== 2) throw new Error("抖音直播间未开播");
  const stream = r.stream_url;
  if (!stream) throw new Error("抖音未返回 stream_url");
  const picked = pickStreamUrls(stream);
  if (!picked.primary) throw new Error("抖音未匹配到可播流");
  return {
    url: picked.primary,
    streamType: picked.type,
    qn: picked.alts[0]?.qn,
    qnLabel: picked.alts[0]?.label,
    alternatives: picked.alts.length > 0 ? picked.alts : undefined,
    referer: REFERER + "/",
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

export const douyinAdapter: NetLiveAdapter = {
  platform: "douyin",
  getRecommend,
  search,
  resolve,
  getCategories,
  getCategoryRooms,
  getRoomDetail,
  getLiveStatus,
};
