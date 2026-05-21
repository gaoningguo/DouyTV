/**
 * Chaturbate 直播 adapter —— 18+ 成人内容平台。
 *
 * 公开 affiliate API（`/api/public/affiliates/onlinerooms/`）需要 wm（affiliate id）
 * 才返 200 —— 不带时回 400。改走他们 web 站本身用的 ts API（无需 wm）：
 *   - `/api/ts/roomlist/room-list/?limit=24&offset=0&genders=f`
 * 这条 endpoint web 端浏览公开房间时直接调用，匿名 OK。
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
const REFERER = "https://chaturbate.com/";
const API_BASE = "https://chaturbate.com/api/ts/roomlist/room-list/";

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "application/json, text/plain, */*",
  Referer: REFERER,
  Origin: "https://chaturbate.com",
  "X-Requested-With": "XMLHttpRequest",
};

interface CbRoomRaw {
  username: string;
  display_name?: string;
  num_users?: number;
  num_followers?: number;
  current_show?: string;
  is_new?: boolean;
  chat_room_url_revamped?: string;
  image_url?: string;
  image_url_360x270?: string;
  iframe_embed?: string;
  iframe_embed_revamped?: string;
  gender?: string;
  age?: number;
  location?: string;
  spoken_languages?: string;
  room_subject?: string;
  hls_source?: string;
  tags?: string[];
}

interface CbListResp {
  rooms?: CbRoomRaw[];
  results?: CbRoomRaw[];
  remainingRooms?: number;
}

function mapRoom(r: CbRoomRaw): NetLiveRoom | undefined {
  if (!r.username) return undefined;
  return {
    platform: "chaturbate",
    roomId: r.username,
    title:
      r.room_subject ||
      r.current_show ||
      r.display_name ||
      r.username,
    uname: r.display_name || r.username,
    cover: r.image_url_360x270 || r.image_url,
    online: r.num_users ?? 0,
    category: r.tags && r.tags.length > 0 ? r.tags[0] : r.gender,
    introduction: r.spoken_languages
      ? `${r.gender ?? "—"} · ${r.location ?? "—"} · ${r.spoken_languages}`
      : undefined,
    live: true,
    link: `https://chaturbate.com/${r.username}/`,
  };
}

async function fetchList(
  params: Record<string, string | number>
): Promise<CbRoomRaw[]> {
  const url = new URL(API_BASE);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  const res = await scriptFetch(url.toString(), {
    method: "GET",
    headers: COMMON_HEADERS,
    timeout: 25_000,
    http2: true,
  });
  if (!res.ok) throw new Error(`Chaturbate HTTP ${res.status}`);
  const body = await res.json<CbListResp>();
  return body.rooms ?? body.results ?? [];
}

/* ─────────────── 推荐 ─────────────── */

async function getRecommend(
  page: number,
  pageSize: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const limit = Math.max(pageSize, 30);
  const rooms = await fetchList({
    limit,
    offset: (page - 1) * limit,
  });
  const list = rooms.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: rooms.length >= limit };
}

/* ─────────────── 分类（gender + 热门 tag） ─────────────── */
// ts/roomlist 用 `genders` （f/m/c/t）和 `tags` 多值；这里一次过滤一个值。

const PRESET_CATEGORIES: NetLiveCategory[] = [
  { id: "genders=f", name: "Female" },
  { id: "genders=m", name: "Male" },
  { id: "genders=c", name: "Couples" },
  { id: "genders=t", name: "Trans" },
  { id: "tags=asian", name: "Asian" },
  { id: "tags=latina", name: "Latina" },
  { id: "tags=ebony", name: "Ebony" },
  { id: "tags=teen18", name: "18+" },
  { id: "tags=milf", name: "MILF" },
  { id: "tags=mature", name: "Mature" },
  { id: "tags=bigboobs", name: "Big Boobs" },
  { id: "tags=anal", name: "Anal" },
  { id: "tags=squirt", name: "Squirt" },
  { id: "tags=dance", name: "Dance" },
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
  const limit = 30;
  const rooms = await fetchList({
    [k]: v,
    limit,
    offset: (page - 1) * limit,
  });
  const list = rooms.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: rooms.length >= limit };
}

/* ─────────────── 搜索 ─────────────── */

async function search(
  keyword: string,
  _page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  // 新 ts/roomlist 接受 `tags` 多值过滤；输入关键字直接当 tag 过滤
  const rooms = await fetchList({
    tags: keyword.toLowerCase().replace(/\s+/g, ""),
    limit: 30,
  });
  const list = rooms.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: false };
}

/* ─────────────── 房间详情 ─────────────── */

async function getRoomDetail(roomId: string): Promise<NetLiveRoom> {
  // affiliate API 不支持单 room 查询，回放 onlinerooms 找到该 room；
  // 若找不到说明已下播，返一个 live=false 的 stub。
  const rooms = await fetchList({ limit: 100 }).catch(() => [] as CbRoomRaw[]);
  const hit = rooms.find((r) => r.username === roomId);
  if (hit) {
    const mapped = mapRoom(hit);
    if (mapped) return mapped;
  }
  return {
    platform: "chaturbate",
    roomId,
    title: roomId,
    uname: roomId,
    live: false,
    link: `https://chaturbate.com/${roomId}/`,
  };
}

async function getLiveStatus(roomId: string): Promise<boolean> {
  try {
    const rooms = await fetchList({ limit: 100 });
    return rooms.some((r) => r.username === roomId);
  } catch {
    return false;
  }
}

/* ─────────────── resolve ─────────────── */

async function resolve(roomId: string): Promise<NetLiveStream> {
  // 优先看 onlinerooms 里是否带 hls_source（部分房间会带）
  try {
    const rooms = await fetchList({ limit: 100 });
    const hit = rooms.find((r) => r.username === roomId);
    if (hit?.hls_source) {
      return {
        url: hit.hls_source,
        streamType: "hls",
        qn: "auto",
        qnLabel: "自适应",
        referer: REFERER,
        ua: UA,
      };
    }
  } catch {
    /* 退到 HTML 解析 */
  }

  // HTML 解析：fetch 房间页，正则提取 `hls_source` / `dossier`
  const res = await scriptFetch(`https://chaturbate.com/${roomId}/`, {
    method: "GET",
    headers: {
      ...COMMON_HEADERS,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    timeout: 25_000,
    http2: true,
  });
  if (!res.ok) throw new Error(`Chaturbate HTTP ${res.status}`);
  const html = await res.text();
  // 常见嵌入：window.initialRoomDossier = "..."（URL-encoded JSON）
  // 或 "hls_source": "https://..."（直接出现在 chatSettings JSON）
  const m1 = html.match(/"hls_source"\s*:\s*"([^"]+)"/);
  if (m1) {
    const url = m1[1].replace(/\\u002F/g, "/").replace(/\\\//g, "/");
    return {
      url,
      streamType: "hls",
      qn: "auto",
      qnLabel: "自适应",
      referer: REFERER,
      ua: UA,
    };
  }
  const m2 = html.match(/window\.initialRoomDossier\s*=\s*"([^"]+)"/);
  if (m2) {
    try {
      const decoded = decodeURIComponent(m2[1]);
      const parsed = JSON.parse(decoded) as { hls_source?: string };
      if (parsed.hls_source) {
        return {
          url: parsed.hls_source,
          streamType: "hls",
          qn: "auto",
          qnLabel: "自适应",
          referer: REFERER,
          ua: UA,
        };
      }
    } catch {
      /* fall through */
    }
  }
  throw new Error("Chaturbate 未提取到 hls_source（房间可能未开播 / 需要登录）");
}

/* ─────────────── 导出 ─────────────── */

export const chaturbateAdapter: NetLiveAdapter = {
  platform: "chaturbate",
  getRecommend,
  search,
  resolve,
  getCategories,
  getCategoryRooms,
  getRoomDetail,
  getLiveStatus,
};
