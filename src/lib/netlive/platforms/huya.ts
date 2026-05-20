/**
 * 虎牙直播 adapter —— 移植自 pure_live `lib/core/site/huya_site.dart`。
 *
 * 实现范围：
 *   - getRecommend / getCategories / getCategoryRooms / search / getRoomDetail：公开 JSON，无登录
 *   - resolve：从 mp.huya.com profileRoom 拿 baseSteamInfoList，挑首条 HLS line，
 *     使用 client-side `buildAntiCode` 直接构造可播 m3u8（不走 TARS getCdnTokenInfoEx）。
 *     TARS 主要给 FLV 拿 sFlvToken；HLS 不依赖该 token，所以纯 web 实现足够。
 *
 * 注意：
 *   - 虎牙 sHlsAntiCode 中 base64(fm) 解码后包含 `_` 分隔字符串，secretPrefix = 第一段
 *   - convertUid = rotl64(presenterUid) —— 低 32 位左移 8 位，高位不变（uid 通常 <= 32bit，所以等价于 (uid<<8 | uid>>24) & 0xffffffff）
 *   - 匿名 uid 走 anonymousLogin 接口，避免登录态依赖
 */
import CryptoJS from "crypto-js";
import { scriptFetch } from "@/source-script/fetch";
import type {
  NetLiveAdapter,
  NetLiveCategory,
  NetLiveRoom,
  NetLiveStream,
} from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/102.0.0.0 Safari/537.36";

const HEADERS_BASE: Record<string, string> = {
  "User-Agent": UA,
  Origin: "https://www.huya.com",
  Referer: "https://www.huya.com/",
};

interface HuyaListItem {
  profileRoom?: number | string;
  introduction?: string;
  roomName?: string;
  screenshot?: string;
  nick?: string;
  totalCount?: number | string;
  avatar180?: string;
  gameFullName?: string;
}

async function fetchJson<T>(
  url: string,
  init: { headers?: Record<string, string>; method?: string; body?: string } = {}
): Promise<T> {
  const res = await scriptFetch(url, {
    method: init.method ?? "GET",
    headers: { ...HEADERS_BASE, ...init.headers },
    body: init.body,
    timeout: 20_000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json<T>();
}

async function fetchText(
  url: string,
  init: { headers?: Record<string, string>; method?: string; body?: string } = {}
): Promise<string> {
  const res = await scriptFetch(url, {
    method: init.method ?? "GET",
    headers: { ...HEADERS_BASE, ...init.headers },
    body: init.body,
    timeout: 20_000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

/* ─────────────── 列表卡片公共映射 ─────────────── */

function mapRoom(item: HuyaListItem): NetLiveRoom | undefined {
  const rid = item.profileRoom;
  if (rid === undefined || rid === null) return undefined;
  let cover = item.screenshot ?? "";
  if (cover && !cover.includes("?")) {
    cover += "?x-oss-process=style/w338_h190&";
  }
  const title = item.introduction || item.roomName || "";
  return {
    platform: "huya",
    roomId: String(rid),
    title,
    cover,
    uname: item.nick,
    avatar: item.avatar180,
    online:
      typeof item.totalCount === "string"
        ? parseInt(item.totalCount, 10) || 0
        : item.totalCount,
    category: item.gameFullName,
    live: true,
    link: `https://www.huya.com/${rid}`,
  };
}

/* ─────────────── 推荐 ─────────────── */

interface HuyaListResp {
  data?: {
    datas?: HuyaListItem[];
    page?: number;
    totalPage?: number;
  };
}

async function getRecommend(
  page: number,
  _pageSize: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const url = `https://www.huya.com/cache.php?m=LiveList&do=getLiveListByPage&tagAll=0&page=${page}`;
  const data = await fetchJson<HuyaListResp>(url);
  const list = (data.data?.datas ?? [])
    .map(mapRoom)
    .filter((r): r is NetLiveRoom => !!r);
  const hasMore = (data.data?.page ?? 0) < (data.data?.totalPage ?? 0);
  return { list, hasMore };
}

/* ─────────────── 分类 ─────────────── */

const PARENT_CATS: Array<{ id: string; name: string }> = [
  { id: "1", name: "网游" },
  { id: "2", name: "单机" },
  { id: "8", name: "娱乐" },
  { id: "3", name: "手游" },
];

interface HuyaBussLiveResp {
  data?: Array<{ gid?: number; gameFullName?: string }>;
}

async function getCategories(): Promise<NetLiveCategory[]> {
  const out: NetLiveCategory[] = [];
  for (const parent of PARENT_CATS) {
    try {
      const data = await fetchJson<HuyaBussLiveResp>(
        `https://live.cdn.huya.com/liveconfig/game/bussLive?bussType=${parent.id}`
      );
      for (const item of data.data ?? []) {
        const gid = item.gid !== undefined ? String(item.gid) : null;
        if (!gid) continue;
        out.push({
          id: gid,
          name: item.gameFullName ?? "",
          cover: `https://huyaimg.msstatic.com/cdnimage/game/${gid}-MS.jpg`,
          parent: parent.name,
        });
      }
    } catch (e) {
      // 单父类失败不影响其他
      console.warn(`[huya] category ${parent.name} failed`, e);
    }
  }
  return out;
}

async function getCategoryRooms(
  categoryId: string,
  page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const url = `https://www.huya.com/cache.php?m=LiveList&do=getLiveListByPage&tagAll=0&gameId=${categoryId}&page=${page}`;
  const data = await fetchJson<HuyaListResp>(url);
  const list = (data.data?.datas ?? [])
    .map(mapRoom)
    .filter((r): r is NetLiveRoom => !!r);
  const hasMore = (data.data?.page ?? 0) < (data.data?.totalPage ?? 0);
  return { list, hasMore };
}

/* ─────────────── 搜索 ─────────────── */

interface HuyaSearchDoc {
  uid?: number;
  yyid?: number;
  room_id?: number | string;
  game_introduction?: string;
  game_roomName?: string;
  game_screenshot?: string;
  game_nick?: string;
  gameName?: string;
  game_imgUrl?: string;
  game_total_count?: number | string;
}

interface HuyaSearchResp {
  response?: {
    "1"?: { docs?: HuyaSearchDoc[]; numFound?: number };
    "3"?: { docs?: HuyaSearchDoc[] };
  };
}

function findRoomIdFromList(
  list: HuyaSearchDoc[],
  uid: number | undefined,
  yyid: number | undefined
): string | undefined {
  if (uid === undefined || yyid === undefined) return undefined;
  for (const item of list) {
    if (item.uid === uid && item.yyid === yyid) {
      return item.room_id !== undefined ? String(item.room_id) : undefined;
    }
  }
  return undefined;
}

async function search(
  keyword: string,
  page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const start = (page - 1) * 20;
  const url = `https://search.cdn.huya.com/?m=Search&do=getSearchContent&q=${encodeURIComponent(
    keyword
  )}&uid=0&v=4&typ=-5&livestate=0&rows=20&start=${start}`;
  const data = await fetchJson<HuyaSearchResp>(url);
  const queryList = data.response?.["3"]?.docs ?? [];
  const responseList = data.response?.["1"]?.docs ?? [];
  const list: NetLiveRoom[] = [];
  for (const item of queryList) {
    let cover = item.game_screenshot ?? "";
    if (cover && !cover.includes("?")) {
      cover += "?x-oss-process=style/w338_h190&";
    }
    const title = item.game_introduction || item.game_roomName || "";
    const roomId =
      findRoomIdFromList(responseList, item.uid, item.yyid) ??
      String(item.room_id ?? "");
    if (!roomId) continue;
    list.push({
      platform: "huya",
      roomId,
      title,
      cover,
      uname: item.game_nick,
      avatar: item.game_imgUrl,
      category: item.gameName,
      online:
        typeof item.game_total_count === "string"
          ? parseInt(item.game_total_count, 10) || 0
          : item.game_total_count,
      live: true,
      link: `https://www.huya.com/${roomId}`,
    });
  }
  return { list, hasMore: queryList.length > 0 };
}

/* ─────────────── 房间详情 + 流信息 ─────────────── */

interface HuyaStreamInfo {
  sCdnType: string;
  sFlvUrl?: string;
  sHlsUrl?: string;
  sFlvAntiCode?: string;
  sHlsAntiCode?: string;
  sStreamName?: string;
  lChannelId?: number | string;
  lSubChannelId?: number | string;
}

interface HuyaProfileResp {
  status?: number;
  data?: {
    liveStatus?: "ON" | "REPLAY" | "OFF";
    liveData?: {
      screenshot?: string;
      userCount?: number | string;
      gameFullName?: string;
      introduction?: string;
      bitRateInfo?: string;
      gid?: number;
    };
    profileInfo?: {
      nick?: string;
      avatar180?: string;
      yyid?: number;
    };
    welcomeText?: string;
    stream?: {
      baseSteamInfoList?: HuyaStreamInfo[];
      flv?: { multiLine?: Array<{ url?: string; cdnType?: string }>; rateArray?: HuyaBitRate[] };
      hls?: { multiLine?: Array<{ url?: string; cdnType?: string }>; rateArray?: HuyaBitRate[] };
    };
  };
}

interface HuyaBitRate {
  sDisplayName?: string;
  iBitRate?: number;
}

async function fetchProfile(roomId: string): Promise<HuyaProfileResp> {
  const url = `https://mp.huya.com/cache.php?m=Live&do=profileRoom&roomid=${roomId}&showSecret=1`;
  return fetchJson<HuyaProfileResp>(url, {
    headers: {
      Accept: "*/*",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-site",
    },
  });
}

async function getRoomDetail(roomId: string): Promise<NetLiveRoom> {
  const resp = await fetchProfile(roomId);
  if (resp.status !== 200 || !resp.data) {
    throw new Error(`虎牙 status=${resp.status}（房间可能不存在）`);
  }
  const d = resp.data;
  const live = d.liveStatus === "ON" || d.liveStatus === "REPLAY";
  return {
    platform: "huya",
    roomId,
    title: d.liveData?.introduction ?? "",
    cover: d.liveData?.screenshot,
    uname: d.profileInfo?.nick,
    avatar: d.profileInfo?.avatar180,
    online:
      typeof d.liveData?.userCount === "string"
        ? parseInt(d.liveData.userCount, 10) || 0
        : d.liveData?.userCount,
    category: d.liveData?.gameFullName,
    introduction: d.liveData?.introduction,
    notice: d.welcomeText,
    live,
    link: `https://www.huya.com/${roomId}`,
  };
}

/* ─────────────── 在线状态查询（轻量） ─────────────── */

async function getLiveStatus(roomId: string): Promise<boolean> {
  const html = await fetchText(`https://m.huya.com/${roomId}`, {
    headers: { Accept: "*/*" },
  });
  const m = html.match(/window\.HNF_GLOBAL_INIT.=.\{([\s\S]*?)\}.<\/script>/);
  if (!m) return false;
  try {
    const obj = JSON.parse(`{${m[1]}}`);
    return obj?.roomInfo?.eLiveStatus === 2;
  } catch {
    return false;
  }
}

/* ─────────────── 匿名 uid ─────────────── */

let cachedAnonymousUid: string | null = null;

async function getAnonymousUid(): Promise<string> {
  if (cachedAnonymousUid) return cachedAnonymousUid;
  try {
    const resp = await scriptFetch(
      "https://udblgn.huya.com/web/anonymousLogin",
      {
        method: "POST",
        headers: {
          ...HEADERS_BASE,
          Accept: "*/*",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          appId: 5002,
          byPass: 3,
          context: "",
          version: "2.4",
          data: {},
        }),
        timeout: 15_000,
      }
    );
    const json = await resp.json<{ data?: { uid?: string | number } }>();
    const uid = json.data?.uid;
    if (uid !== undefined && uid !== null) {
      cachedAnonymousUid = String(uid);
      return cachedAnonymousUid;
    }
  } catch (e) {
    console.warn("[huya] anonymousLogin failed", e);
  }
  // 兜底：随机 13 位数
  cachedAnonymousUid = String(
    1400000000000 + Math.floor(Math.random() * 100000000000)
  );
  return cachedAnonymousUid;
}

/* ─────────────── AntiCode 构造（client-side） ─────────────── */

function rotl64Low32(t: number): number {
  // 低 32 位左移 8 位 + 高 8 位回卷
  const low = t >>> 0;
  return ((low << 8) | (low >>> 24)) >>> 0;
}

function base64Decode(s: string): string {
  // 兼容 atob：先做 percent-decode，再用 atob
  try {
    return atob(decodeURIComponent(s));
  } catch {
    try {
      return atob(s);
    } catch {
      return "";
    }
  }
}

function md5Hex(s: string): string {
  return CryptoJS.MD5(s).toString(CryptoJS.enc.Hex);
}

function parseQuery(qs: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const seg of qs.split("&")) {
    if (!seg) continue;
    const idx = seg.indexOf("=");
    if (idx < 0) {
      out[seg] = "";
      continue;
    }
    out[seg.slice(0, idx)] = seg.slice(idx + 1);
  }
  return out;
}

/**
 * 把 sHlsAntiCode / sFlvAntiCode 转成可播 query string。
 * presenterUid 通常用 lChannelId（topSid）；HLS 路径下也可用匿名 uid。
 */
function buildAntiCode(
  streamName: string,
  presenterUid: number,
  antiCode: string
): string {
  const map = parseQuery(antiCode);
  if (!map.fm) return antiCode;

  const ctype = map.ctype ?? "huya_pc_exe";
  const platformId = parseInt(map.t ?? "0", 10);
  const isWap = platformId === 103;
  const now = Date.now();
  const seqId = presenterUid + now;
  const secretHash = md5Hex(`${seqId}|${ctype}|${platformId}`);
  const convertUid = rotl64Low32(presenterUid);
  const calcUid = isWap ? presenterUid : convertUid;
  const fm = base64Decode(map.fm);
  const secretPrefix = (fm.split("_")[0] ?? "") || "";
  const wsTime = map.wsTime ?? "";
  const secretStr = `${secretPrefix}_${calcUid}_${streamName}_${secretHash}_${wsTime}`;
  const wsSecret = md5Hex(secretStr);

  const ct = Math.floor(
    (parseInt(wsTime || "0", 16) + Math.random()) * 1000
  );
  const uuid = Math.floor((((ct % 1e10) + Math.random()) * 1e3) % 0xffffffff);

  const params: Record<string, string | number> = {
    wsSecret,
    wsTime,
    seqid: seqId,
    ctype,
    ver: "1",
    fs: map.fs ?? "",
    fm: encodeURIComponent(map.fm),
    t: platformId,
  };
  if (isWap) {
    params.uid = presenterUid;
    params.uuid = uuid;
  } else {
    params.u = convertUid;
  }
  return Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

/* ─────────────── resolve ─────────────── */

async function resolve(roomId: string): Promise<NetLiveStream> {
  const resp = await fetchProfile(roomId);
  if (resp.status !== 200 || !resp.data?.stream) {
    throw new Error("虎牙未返回 stream 数据（房间可能已下播）");
  }
  const baseList = resp.data.stream.baseSteamInfoList ?? [];
  if (baseList.length === 0) throw new Error("虎牙 baseSteamInfoList 为空");

  // 选首条 HLS（多数 CDN 都给齐）
  const flvLines = resp.data.stream.flv?.multiLine ?? [];
  const hlsLines = resp.data.stream.hls?.multiLine ?? [];

  // 优先匹配 HLS 中的 cdn type，再 fallback 到 FLV
  let chosen: HuyaStreamInfo | undefined;
  let streamType: NetLiveStream["streamType"] = "hls";
  let antiCode = "";
  let baseUrl = "";

  for (const line of hlsLines) {
    if (!line.url) continue;
    const found = baseList.find((b) => b.sCdnType === line.cdnType);
    if (found?.sHlsUrl && found.sHlsAntiCode && found.sStreamName) {
      chosen = found;
      antiCode = found.sHlsAntiCode;
      baseUrl = found.sHlsUrl;
      streamType = "hls";
      break;
    }
  }
  if (!chosen) {
    for (const line of flvLines) {
      if (!line.url) continue;
      const found = baseList.find((b) => b.sCdnType === line.cdnType);
      if (found?.sFlvUrl && found.sFlvAntiCode && found.sStreamName) {
        chosen = found;
        antiCode = found.sFlvAntiCode;
        baseUrl = found.sFlvUrl;
        streamType = "flv";
        break;
      }
    }
  }
  if (!chosen) throw new Error("虎牙无可用 line（cdn 全部下线？）");

  // presenterUid：优先用 lChannelId，再 fallback 匿名 uid
  let presenterUid = 0;
  if (chosen.lChannelId !== undefined && chosen.lChannelId !== null) {
    presenterUid =
      typeof chosen.lChannelId === "string"
        ? parseInt(chosen.lChannelId, 10) || 0
        : chosen.lChannelId;
  }
  if (!presenterUid) {
    const anon = await getAnonymousUid();
    presenterUid = parseInt(anon, 10) || 0;
  }

  const anti = buildAntiCode(chosen.sStreamName!, presenterUid, antiCode);
  const ext = streamType === "hls" ? "m3u8" : "flv";
  const url = `${baseUrl}/${chosen.sStreamName}.${ext}?${anti}&codec=264`;

  // 收集可选清晰度（仅 label，URL 留空，UI 选了再重拉）
  const biterates: HuyaBitRate[] = [];
  if (resp.data.liveData?.bitRateInfo) {
    try {
      const parsed = JSON.parse(resp.data.liveData.bitRateInfo);
      if (Array.isArray(parsed)) biterates.push(...parsed);
    } catch {
      /* ignore */
    }
  }
  if (biterates.length === 0 && resp.data.stream.flv?.rateArray) {
    biterates.push(...resp.data.stream.flv.rateArray);
  }
  const alternatives = biterates
    .filter((b) => b.sDisplayName && b.iBitRate !== undefined)
    .map((b) => ({
      qn: String(b.iBitRate),
      label: String(b.sDisplayName),
      url: b.iBitRate === 0 ? url : "",
    }));

  return {
    url,
    streamType,
    qn: "0",
    qnLabel: alternatives.find((a) => a.qn === "0")?.label ?? "原画",
    alternatives: alternatives.length > 0 ? alternatives : undefined,
    referer: "https://www.huya.com/",
    ua: UA,
  };
}

/* ─────────────── 导出 ─────────────── */

export const huyaAdapter: NetLiveAdapter = {
  platform: "huya",
  getRecommend,
  search,
  resolve,
  getCategories,
  getCategoryRooms,
  getRoomDetail,
  getLiveStatus,
};
