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
 * BongaCams 套 Cloudflare —— 需 "像浏览器" 的 Accept / Sec-Fetch / Sec-Ch-Ua 头 + h2 才能通过。
 */
const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Referer: REFERER,
  Origin: "https://bongacams.com",
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "X-Requested-With": "XMLHttpRequest",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
  "Sec-Ch-Ua":
    '"Chromium";v="130", "Not(A:Brand";v="99", "Google Chrome";v="130"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
};

interface BcRoom {
  username?: string;
  display_name?: string;
  members_count?: number;
  topic?: string;
  thumb_image?: string;
  thumb_image_blured?: string;
  profile_image?: string;
  profile_images?: { thumbnail_image_medium?: string };
  age?: number;
  country?: string;
  type?: string; // female / male / couples / transsexual
  tags?: string[];
}

interface BcListResp {
  models?: BcRoom[];
}

function mapRoom(r: BcRoom): NetLiveRoom | undefined {
  if (!r.username) return undefined;
  return {
    platform: "bongacams",
    roomId: r.username,
    title: r.topic || r.display_name || r.username,
    uname: r.display_name || r.username,
    avatar:
      r.profile_image ?? r.profile_images?.thumbnail_image_medium,
    cover: r.thumb_image,
    online: r.members_count ?? 0,
    category: (r.tags && r.tags.length > 0 ? r.tags[0] : r.type) ?? r.country,
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
  // 房间页 HTML 含 `playerData = {...}` 嵌入 JS
  const res = await scriptFetch(`https://bongacams.com/${roomId}`, {
    method: "GET",
    headers: {
      ...COMMON_HEADERS,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
    },
    timeout: 25_000,
    http2: true,
  });
  if (!res.ok) throw new Error(`BongaCams HTTP ${res.status}`);
  const html = await res.text();
  // 常见嵌入 1：playerData.streamUrl
  const m1 = html.match(/"streamUrl"\s*:\s*"([^"]+)"/);
  if (m1) {
    const url = m1[1].replace(/\\\//g, "/");
    return {
      url,
      streamType: "hls",
      qn: "auto",
      qnLabel: "自适应",
      referer: REFERER,
      ua: UA,
    };
  }
  // 常见嵌入 2：cdnURL + 用户名拼 m3u8
  const m2 = html.match(/var\s+cdnURL\s*=\s*"([^"]+)"/);
  if (m2) {
    const cdn = m2[1].replace(/\\\//g, "/").replace(/\/$/, "");
    return {
      url: `${cdn}/hls/stream_${roomId}/playlist.m3u8`,
      streamType: "hls",
      qn: "auto",
      qnLabel: "自适应",
      referer: REFERER,
      ua: UA,
    };
  }
  throw new Error("BongaCams 未提取到 streamUrl（房间未开播 / 私密）");
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
