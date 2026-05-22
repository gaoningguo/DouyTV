/**
 * BongaCams 直播 adapter —— 18+ 成人 cam 平台。
 *
 * 走 bongacams 公开 listing endpoint：
 *   - `https://bongacams.com/tools/listing_v3.php?livetab=female&offset=0&limit=24`
 *     返 JSON（响应一般是 200 ok 即可，没有 envelope code）
 *
 * 实现范围：
 *   - getRecommend：listing_v3 livetab=female 默认
 *   - getCategories：预置 livetab（female/male/couples/transsexual + 热门 tag）
 *   - getCategoryRooms：listing_v3 多传 tag
 *   - search：listing_v3 tag={keyword}
 *   - resolve：抓房间页 HTML，提取 `playerData.streamUrl`（HLS）
 *   - getRoomDetail：listing_v3 找出该 username 的 room snapshot
 *
 * roomId = username。
 */
import { scriptFetch } from "@/source-script/fetch";
import type {
  NetLiveAdapter,
  NetLiveCategory,
  NetLiveRoom,
  NetLiveStream,
} from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const REFERER = "https://bongacams.com/";

/**
 * 实测 2026-05：直接最朴素的 header 就能过 Cloudflare（Python urllib 都 200）。
 * 加 sec-ch-ua / Sec-Fetch-* 反而触发 CF Bot Management 识别为爬虫（真浏览器在
 * 同源 XHR 里 *不* 主动发这些 Client Hints），所以这里保持最小化。
 */
const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Referer: REFERER,
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "X-Requested-With": "XMLHttpRequest",
};

interface BcRoom {
  // 实测 2026-05 真实字段（listing_v3.php 响应）
  username?: string;
  display_name?: string;
  viewers?: number; // 人数（不是 members_count！）
  vq?: string; // 视频分辨率 "1920x1080"
  vsid?: string; // video stream id
  esid?: string; // edge stream id "live-edge65-rn"
  room?: string; // 房间状态 "public" / "private" / "group"
  gender?: string; // female / male / couples / transsexual
  thumb_image?: string; // 含 "{ext}" 占位符，需要替换为 webp/jpg + 加 https: 前缀
  f?: number;
  is_top?: boolean;
  blocks?: number[];
  // 老接口兼容
  members_count?: number;
  topic?: string;
  thumb_image_blured?: string;
  profile_image?: string;
  profile_images?: { thumbnail_image_medium?: string };
  age?: number;
  country?: string;
  type?: string;
  tags?: string[];
}

interface BcListResp {
  status?: string;
  total_count?: number;
  online_count?: number;
  models?: BcRoom[];
}

/** 处理 thumb_image 的 {ext} 占位符 + 补 https 前缀 */
function buildThumbUrl(thumb?: string): string | undefined {
  if (!thumb) return undefined;
  let url = thumb.replace("{ext}", "webp");
  if (url.startsWith("//")) url = "https:" + url;
  return url;
}

function mapRoom(r: BcRoom): NetLiveRoom | undefined {
  if (!r.username) return undefined;
  // 实测：room === "public" 才是可看的公开直播；其他（"private" / "group"）跳过
  if (r.room && r.room !== "public") return undefined;
  return {
    platform: "bongacams",
    roomId: r.username,
    title: r.topic || r.display_name || r.username,
    uname: r.display_name || r.username,
    avatar:
      r.profile_image ?? r.profile_images?.thumbnail_image_medium,
    cover: buildThumbUrl(r.thumb_image),
    online: r.viewers ?? r.members_count ?? 0,
    category:
      r.gender ?? (r.tags && r.tags.length > 0 ? r.tags[0] : undefined) ?? r.country,
    live: true,
    link: `https://bongacams.com/${r.username}`,
  };
}

async function fetchList(
  params: Record<string, string | number>
): Promise<BcRoom[]> {
  const url = new URL("https://bongacams.com/tools/listing_v3.php");
  url.searchParams.set("livetab", "female");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  const res = await scriptFetch(url.toString(), {
    method: "GET",
    headers: COMMON_HEADERS,
    timeout: 25_000,
    http2: true,
  });
  if (!res.ok) throw new Error(`BongaCams HTTP ${res.status}`);
  const body = await res.json<BcListResp>();
  return body.models ?? [];
}

/* ─────────────── 推荐 ─────────────── */

async function getRecommend(
  page: number,
  pageSize: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const limit = Math.max(pageSize, 24);
  const arr = await fetchList({
    limit,
    offset: (page - 1) * limit,
  });
  const list = arr.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: arr.length >= limit };
}

/* ─────────────── 分类 ─────────────── */

const PRESET_CATEGORIES: NetLiveCategory[] = [
  { id: "livetab=female", name: "Female" },
  { id: "livetab=male", name: "Male" },
  { id: "livetab=couples", name: "Couples" },
  { id: "livetab=transsexual", name: "Trans" },
  { id: "tag=asian", name: "Asian" },
  { id: "tag=latin", name: "Latin" },
  { id: "tag=ebony", name: "Ebony" },
  { id: "tag=18-19", name: "Teen 18+" },
  { id: "tag=milf", name: "MILF" },
  { id: "tag=mature", name: "Mature" },
  { id: "tag=big-boobs", name: "Big Boobs" },
  { id: "tag=dance", name: "Dance" },
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
  const limit = 24;
  const arr = await fetchList({
    [k]: v,
    limit,
    offset: (page - 1) * limit,
  });
  const list = arr.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: arr.length >= limit };
}

/* ─────────────── 搜索 ─────────────── */

async function search(
  keyword: string,
  _page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const arr = await fetchList({
    tag: keyword.toLowerCase().replace(/\s+/g, "-"),
    limit: 30,
  });
  const list = arr.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: false };
}

/* ─────────────── 房间详情 + resolve ─────────────── */

async function findRoomInListing(roomId: string): Promise<BcRoom | null> {
  try {
    // 拉 100 个看是否能找到
    const arr = await fetchList({ limit: 100 });
    return arr.find((r) => r.username === roomId) ?? null;
  } catch {
    return null;
  }
}

async function getRoomDetail(roomId: string): Promise<NetLiveRoom> {
  const r = await findRoomInListing(roomId);
  if (r) {
    const mapped = mapRoom(r);
    if (mapped) return mapped;
  }
  return {
    platform: "bongacams",
    roomId,
    title: roomId,
    uname: roomId,
    live: false,
    link: `https://bongacams.com/${roomId}`,
  };
}

async function getLiveStatus(roomId: string): Promise<boolean> {
  return !!(await findRoomInListing(roomId));
}

async function resolve(roomId: string): Promise<NetLiveStream> {
  // 实测 2026-05：BongaCams 真实 resolve 路径：
  //   1. GET /tools/amf.php?method=getRoomData&args[]={user}&args[]=false
  //      返回 { localData: { videoServerUrl: "//live-edge65-rn.bcvcdn.com", vsid, dataKey }, ... }
  //   2. 构造 https:{videoServerUrl}/hls/stream_{username}/playlist.m3u8（实测 200 + mpegurl）
  // HTML scrape 方案已废 —— 房间页 CF 拦 403。
  const amfUrl = `https://bongacams.com/tools/amf.php?method=getRoomData&args%5B%5D=${encodeURIComponent(roomId)}&args%5B%5D=false`;
  const res = await scriptFetch(amfUrl, {
    method: "GET",
    headers: COMMON_HEADERS,
    timeout: 25_000,
    http2: true,
  });
  if (!res.ok) throw new Error(`BongaCams HTTP ${res.status}`);
  const body = await res.json<{
    status?: string;
    localData?: { videoServerUrl?: string; vsid?: string; dataKey?: string };
    performerData?: { isOnline?: boolean; showType?: string };
  }>();
  if (body.status !== "success") {
    throw new Error(`BongaCams 房间 ${roomId} 不可访问 (status=${body.status})`);
  }
  if (!body.performerData?.isOnline) {
    throw new Error(`BongaCams 房间 ${roomId} 未开播`);
  }
  if (body.performerData.showType && body.performerData.showType !== "public") {
    throw new Error(`BongaCams ${roomId} 当前为 ${body.performerData.showType}（非公开）`);
  }
  let videoHost = body.localData?.videoServerUrl ?? "";
  // 返回的是 `//live-edge65-rn.bcvcdn.com`，补 https:
  if (videoHost.startsWith("//")) videoHost = "https:" + videoHost;
  if (!videoHost) throw new Error("BongaCams 未返回 videoServerUrl");
  const url = `${videoHost.replace(/\/$/, "")}/hls/stream_${encodeURIComponent(roomId)}/playlist.m3u8`;
  return {
    url,
    streamType: "hls",
    qn: "auto",
    qnLabel: "自适应",
    referer: REFERER,
    ua: UA,
  };
}

/* ─────────────── 导出 ─────────────── */

export const bongacamsAdapter: NetLiveAdapter = {
  platform: "bongacams",
  getRecommend,
  search,
  resolve,
  getCategories,
  getCategoryRooms,
  getRoomDetail,
  getLiveStatus,
};
