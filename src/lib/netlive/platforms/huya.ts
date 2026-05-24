/**
 * 虎牙直播 adapter —— 完全按 dart_simple_live `simple_live_core/lib/src/huya_site.dart` 移植。
 *
 * 关键路径变更（vs 旧版用 mp.huya.com/cache.php）：
 *   - getRoomDetail/resolve 从 `m.huya.com/{roomId}` HTML 提取 `window.HNF_GLOBAL_INIT`
 *     正则 + 替换 function() 块为 "" → JSON.parse → roomInfo
 *   - topSid/subSid 从原始文本正则提（lChannelId / lSubChannelId）
 *   - vStreamInfo.value 是 line 列表，每个含 sFlvUrl / sFlvAntiCode / sHlsAntiCode / sStreamName / sCdnType
 *   - resolve：选首条 line，使用 sFlvAntiCode + buildAntiCode（不调 TARS getCdnTokenInfoEx；
 *     web 平台没 TARS 客户端，sFlvAntiCode 够用）
 *
 * 推荐 / 分类 / 搜索 / 状态 endpoint 与之前一致（与 pure_live 同）。
 */
import CryptoJS from "crypto-js";
import { createPlatformFetch } from "@/lib/netlive/scriptFetch";
const scriptFetch = createPlatformFetch("huya");
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

async function fetchJson<T>(
  url: string,
  init: { headers?: Record<string, string> } = {}
): Promise<T> {
  const res = await scriptFetch(url, {
    method: "GET",
    headers: { ...HEADERS_BASE, ...init.headers },
    timeout: 20_000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json<T>();
}

async function fetchText(
  url: string,
  init: { headers?: Record<string, string> } = {}
): Promise<string> {
  const res = await scriptFetch(url, {
    method: "GET",
    headers: { ...HEADERS_BASE, ...init.headers },
    timeout: 20_000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

/* ─────────────── 列表映射 ─────────────── */

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
    "3"?: { docs?: HuyaSearchDoc[]; numFound?: number };
  };
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
  const docs = data.response?.["3"]?.docs ?? [];
  const list: NetLiveRoom[] = [];
  for (const item of docs) {
    let cover = item.game_screenshot ?? "";
    if (cover && !cover.includes("?")) {
      cover += "?x-oss-process=style/w338_h190&";
    }
    const title = item.game_introduction || item.game_roomName || "";
    const roomId = String(item.room_id ?? "");
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
  const numFound = data.response?.["3"]?.numFound ?? 0;
  return { list, hasMore: numFound > page * 20 };
}

/* ─────────────── m.huya.com HTML 提取 roomInfo（dart_simple_live 同款） ─────────────── */

interface HuyaLineInfo {
  sCdnType?: string;
  sFlvUrl?: string;
  sFlvAntiCode?: string;
  sHlsAntiCode?: string;
  sStreamName?: string;
}

interface HuyaBitRate {
  sDisplayName?: string;
  iBitRate?: number;
}

interface HuyaRoomInfoJson {
  roomInfo?: {
    tLiveInfo?: {
      sIntroduction?: string;
      sRoomName?: string;
      sScreenshot?: string;
      lTotalCount?: number;
      lProfileRoom?: number | string;
      sGameFullName?: string;
      tLiveStreamInfo?: {
        vStreamInfo?: { value?: HuyaLineInfo[] };
        vBitRateInfo?: { value?: HuyaBitRate[] };
      };
    };
    tProfileInfo?: {
      sNick?: string;
      sAvatar180?: string;
    };
    eLiveStatus?: number;
  };
  welcomeText?: string;
  topSid?: number;
  subSid?: number;
}

async function fetchRoomInfoFromHtml(roomId: string): Promise<HuyaRoomInfoJson> {
  const html = await fetchText(`https://m.huya.com/${roomId}`, {
    headers: { Accept: "*/*" },
  });
  // dart_simple_live 正则的更宽松版本：允许 `=` 两侧 0+ 空白，结尾 `;</script>` 或 `</script>`
  // 原版 `\.=.` 强制 = 后面正好 1 个字符，对最近的 m.huya.com HTML 不再匹配
  const m =
    html.match(
      /window\.HNF_GLOBAL_INIT\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/
    ) ||
    html.match(/window\.HNF_GLOBAL_INIT\s*=\s*(\{[\s\S]*?\})\s*;/);
  let jsonText = m?.[1];
  if (!jsonText) {
    // 最后的 fallback —— 老接口 mp.huya.com/cache.php
    return fetchRoomInfoViaBetard(roomId);
  }
  // 把所有 function() {...} 替换成 ""
  jsonText = jsonText.replace(/function.*?\(.*?\).\{[\s\S]*?\}/g, '""');
  // 解析
  let jsonObj: HuyaRoomInfoJson;
  try {
    jsonObj = JSON.parse(jsonText) as HuyaRoomInfoJson;
  } catch (e) {
    console.warn("[huya] HTML JSON parse failed, fallback to betard", e);
    return fetchRoomInfoViaBetard(roomId);
  }
  // 从原文本提 topSid / subSid（vStreamInfo 内部嵌套，主对象上可能没有）
  const topSidMatch = html.match(/lChannelId":([0-9]+)/);
  const subSidMatch = html.match(/lSubChannelId":([0-9]+)/);
  jsonObj.topSid = topSidMatch ? parseInt(topSidMatch[1], 10) : 0;
  jsonObj.subSid = subSidMatch ? parseInt(subSidMatch[1], 10) : 0;
  return jsonObj;
}

/**
 * Fallback：m.huya.com HTML 拿不到时，调 mp.huya.com profileRoom API。
 * 不如 HTML 完整（缺 vStreamInfo），但至少 detail 可用。
 */
async function fetchRoomInfoViaBetard(roomId: string): Promise<HuyaRoomInfoJson> {
  interface ProfileResp {
    status?: number;
    data?: {
      liveStatus?: "ON" | "REPLAY" | "OFF";
      liveData?: {
        introduction?: string;
        screenshot?: string;
        userCount?: number;
        gameFullName?: string;
      };
      profileInfo?: {
        nick?: string;
        avatar180?: string;
      };
      welcomeText?: string;
      stream?: {
        baseSteamInfoList?: HuyaLineInfo[];
      };
    };
  }
  const data = await fetchJson<ProfileResp>(
    `https://mp.huya.com/cache.php?m=Live&do=profileRoom&roomid=${roomId}&showSecret=1`,
    {
      headers: {
        Accept: "*/*",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-site",
      },
    }
  );
  if (data.status !== 200 || !data.data) {
    throw new Error("虎牙 m.huya.com 与 mp.huya.com 都拿不到房间信息");
  }
  // 把 betard 响应模拟为 HuyaRoomInfoJson 结构
  const baseList = data.data.stream?.baseSteamInfoList ?? [];
  return {
    roomInfo: {
      tLiveInfo: {
        sIntroduction: data.data.liveData?.introduction,
        sScreenshot: data.data.liveData?.screenshot,
        lTotalCount: data.data.liveData?.userCount,
        lProfileRoom: roomId,
        sGameFullName: data.data.liveData?.gameFullName,
        tLiveStreamInfo: {
          vStreamInfo: { value: baseList },
        },
      },
      tProfileInfo: {
        sNick: data.data.profileInfo?.nick,
        sAvatar180: data.data.profileInfo?.avatar180,
      },
      eLiveStatus:
        data.data.liveStatus === "ON" || data.data.liveStatus === "REPLAY"
          ? 2
          : 0,
    },
    welcomeText: data.data.welcomeText,
    topSid: 0,
    subSid: 0,
  };
}

/* ─────────────── 详情 ─────────────── */

async function getRoomDetail(roomId: string): Promise<NetLiveRoom> {
  const info = await fetchRoomInfoFromHtml(roomId);
  const r = info.roomInfo;
  if (!r) throw new Error("虎牙 roomInfo 为空");
  const live = r.eLiveStatus === 2;
  const title = r.tLiveInfo?.sIntroduction || r.tLiveInfo?.sRoomName || "";
  return {
    platform: "huya",
    roomId: String(r.tLiveInfo?.lProfileRoom ?? roomId),
    title,
    cover: r.tLiveInfo?.sScreenshot,
    uname: r.tProfileInfo?.sNick,
    avatar: r.tProfileInfo?.sAvatar180,
    online: r.tLiveInfo?.lTotalCount,
    category: r.tLiveInfo?.sGameFullName,
    introduction: r.tLiveInfo?.sIntroduction,
    notice: info.welcomeText,
    live,
    link: `https://www.huya.com/${roomId}`,
  };
}

/* ─────────────── AntiCode 构造（client-side） ─────────────── */

function rotl64Low32(t: number): number {
  const low = t >>> 0;
  return ((low << 8) | (low >>> 24)) >>> 0;
}

function base64Decode(s: string): string {
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
  const fm = base64Decode(decodeURIComponent(map.fm));
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
  const info = await fetchRoomInfoFromHtml(roomId);
  const lines = info.roomInfo?.tLiveInfo?.tLiveStreamInfo?.vStreamInfo?.value ?? [];
  const presenterUid = info.topSid ?? 0;
  if (lines.length === 0) {
    throw new Error("虎牙 vStreamInfo 为空（房间未开播 / 风控）");
  }
  // 取首条有效 line —— 按 dart_simple_live：所有 line 都有 sFlvUrl
  let chosen: HuyaLineInfo | undefined;
  for (const line of lines) {
    if (line.sFlvUrl && line.sFlvAntiCode && line.sStreamName) {
      chosen = line;
      break;
    }
  }
  if (!chosen) throw new Error("虎牙未匹配到可播流");
  const anti = buildAntiCode(chosen.sStreamName!, presenterUid, chosen.sFlvAntiCode!);
  const url = `${chosen.sFlvUrl}/${chosen.sStreamName}.flv?${anti}&codec=264`;

  // 清晰度（仅 label）
  const biterates = info.roomInfo?.tLiveInfo?.tLiveStreamInfo?.vBitRateInfo?.value ?? [];
  const alternatives = biterates
    .filter((b) => b.sDisplayName && !b.sDisplayName.includes("HDR"))
    .map((b) => ({
      qn: String(b.iBitRate ?? 0),
      label: b.sDisplayName!,
      url: b.iBitRate === 0 ? url : "",
    }));

  return {
    url,
    streamType: "flv",
    qn: "0",
    qnLabel: alternatives.find((a) => a.qn === "0")?.label ?? "原画",
    alternatives: alternatives.length > 0 ? alternatives : undefined,
    referer: "https://www.huya.com/",
    ua: UA,
  };
}

async function getLiveStatus(roomId: string): Promise<boolean> {
  try {
    const info = await fetchRoomInfoFromHtml(roomId);
    return info.roomInfo?.eLiveStatus === 2;
  } catch {
    return false;
  }
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
