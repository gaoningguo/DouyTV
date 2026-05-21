/**
 * Kick 直播 adapter —— Twitch 替代平台，公开 REST API（无需 token）。
 *
 * 实现范围：
 *   - getRecommend：`/api/v2/featured-livestreams/en?page=N` —— 推荐 livestream
 *   - getCategories：`/api/v1/categories` —— 顶层分类
 *   - getCategoryRooms：`/api/v2/categories/{slug}/livestreams?page=N`
 *   - search：`/api/v2/channels/search?searched_word=...`
 *   - resolve：`/api/v2/channels/{slug}` → `livestream.playback_url` 直接是 m3u8
 *   - getRoomDetail：`/api/v2/channels/{slug}`
 *
 * roomId = channel slug (lowercase username)。
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
const REFERER = "https://kick.com/";

/**
 * Cloudflare 默认会按 UA + Accept 组合判断 bot；用更"像浏览器"的全套头 + h2 才能通过。
 * Origin / Sec-Fetch-* 必须接近真实 web app 的请求。
 */
const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Referer: REFERER,
  Origin: "https://kick.com",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Dest": "empty",
  "Sec-Ch-Ua":
    '"Chromium";v="130", "Not(A:Brand";v="99", "Google Chrome";v="130"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
};

interface KickStream {
  id: number;
  slug?: string;
  session_title?: string;
  is_live?: boolean;
  viewer_count?: number;
  thumbnail?: { src?: string; srcset?: string; url?: string } | string | null;
  channel?: KickChannel;
  categories?: Array<{ id: number; name: string; slug: string }>;
  playback_url?: string;
}

interface KickChannel {
  id?: number;
  slug?: string;
  user?: { username?: string; profile_pic?: string; bio?: string };
  user_id?: number;
  followers_count?: number;
  livestream?: KickStream | null;
  previous_livestreams?: KickStream[];
  playback_url?: string;
  recent_categories?: Array<{ id: number; name: string; slug: string }>;
  banner_image?: { url?: string } | null;
}

function pickThumb(t: KickStream["thumbnail"]): string | undefined {
  if (!t) return undefined;
  if (typeof t === "string") return t;
  return t.src ?? t.url ?? undefined;
}

function mapStream(s: KickStream): NetLiveRoom | undefined {
  const slug = s.channel?.slug ?? s.slug;
  if (!slug) return undefined;
  return {
    platform: "kick",
    roomId: slug,
    title: s.session_title ?? slug,
    uname: s.channel?.user?.username ?? slug,
    avatar: s.channel?.user?.profile_pic,
    cover: pickThumb(s.thumbnail),
    online: s.viewer_count ?? 0,
    category: s.categories?.[0]?.name,
    live: !!s.is_live,
    link: `https://kick.com/${slug}`,
  };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await scriptFetch(url, {
    method: "GET",
    headers: COMMON_HEADERS,
    timeout: 25_000,
    http2: true,
  });
  if (!res.ok) throw new Error(`Kick HTTP ${res.status}`);
  return res.json<T>();
}

/* ─────────────── 推荐 ─────────────── */

async function getRecommend(
  page: number,
  _pageSize: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const url = `https://kick.com/api/v2/featured-livestreams/en?page=${page}`;
  const data = await getJson<KickStream[] | { data?: KickStream[] }>(url);
  const arr = Array.isArray(data) ? data : data?.data ?? [];
  const list = arr.map(mapStream).filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: arr.length >= 20 };
}

/* ─────────────── 分类 ─────────────── */

interface KickCategory {
  id: number;
  name: string;
  slug: string;
  banner?: { url?: string } | null;
}

async function getCategories(): Promise<NetLiveCategory[]> {
  try {
    const data = await getJson<KickCategory[] | { data?: KickCategory[] }>(
      "https://kick.com/api/v1/categories"
    );
    const arr = Array.isArray(data) ? data : data?.data ?? [];
    return arr.slice(0, 40).map((c) => ({
      id: c.slug,
      name: c.name,
      cover: c.banner?.url ?? undefined,
    }));
  } catch {
    return [];
  }
}

async function getCategoryRooms(
  categoryId: string,
  page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const url = `https://kick.com/api/v2/categories/${encodeURIComponent(categoryId)}/livestreams?page=${page}`;
  const data = await getJson<KickStream[] | { data?: KickStream[] }>(url);
  const arr = Array.isArray(data) ? data : data?.data ?? [];
  const list = arr.map(mapStream).filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: arr.length >= 20 };
}

/* ─────────────── 搜索 ─────────────── */

interface KickSearchChannel {
  id: number;
  slug: string;
  user?: { username?: string; profile_pic?: string };
  is_live?: boolean;
  livestream?: KickStream | null;
}

async function search(
  keyword: string,
  _page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const url = `https://kick.com/api/v2/channels/search?searched_word=${encodeURIComponent(keyword)}`;
  const data = await getJson<
    KickSearchChannel[] | { data?: KickSearchChannel[] }
  >(url);
  const arr = Array.isArray(data) ? data : data?.data ?? [];
  const list: NetLiveRoom[] = arr.map((c) => ({
    platform: "kick",
    roomId: c.slug,
    title: c.livestream?.session_title ?? c.user?.username ?? c.slug,
    uname: c.user?.username ?? c.slug,
    avatar: c.user?.profile_pic,
    cover: pickThumb(c.livestream?.thumbnail),
    online: c.livestream?.viewer_count ?? 0,
    live: !!c.is_live || !!c.livestream,
    link: `https://kick.com/${c.slug}`,
  }));
  return { list, hasMore: false };
}

/* ─────────────── 房间详情 + resolve ─────────────── */

async function fetchChannel(slug: string): Promise<KickChannel> {
  return getJson<KickChannel>(
    `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`
  );
}

async function getRoomDetail(roomId: string): Promise<NetLiveRoom> {
  const ch = await fetchChannel(roomId);
  const ls = ch.livestream;
  return {
    platform: "kick",
    roomId: ch.slug ?? roomId,
    title: ls?.session_title ?? ch.user?.username ?? ch.slug ?? roomId,
    uname: ch.user?.username ?? ch.slug,
    avatar: ch.user?.profile_pic,
    cover: pickThumb(ls?.thumbnail),
    online: ls?.viewer_count ?? 0,
    category: ls?.categories?.[0]?.name ?? ch.recent_categories?.[0]?.name,
    introduction: ch.user?.bio,
    live: !!ls?.is_live,
    link: `https://kick.com/${ch.slug ?? roomId}`,
  };
}

async function getLiveStatus(roomId: string): Promise<boolean> {
  try {
    const ch = await fetchChannel(roomId);
    return !!ch.livestream?.is_live;
  } catch {
    return false;
  }
}

async function resolve(roomId: string): Promise<NetLiveStream> {
  const ch = await fetchChannel(roomId);
  const url = ch.playback_url ?? ch.livestream?.playback_url;
  if (!url) throw new Error("Kick 未返回 playback_url（房间未开播）");
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

export const kickAdapter: NetLiveAdapter = {
  platform: "kick",
  getRecommend,
  search,
  resolve,
  getCategories,
  getCategoryRooms,
  getRoomDetail,
  getLiveStatus,
};
