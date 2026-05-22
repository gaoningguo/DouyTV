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
  // 多套已知 endpoint 兜底（Kick 频繁改版，命名不一致）
  const candidates = [
    `https://kick.com/api/v2/featured-livestreams/en?page=${page}`,
    `https://kick.com/featured-livestreams/en?page=${page}`,
    `https://kick.com/stream/livestreams/en?page=${page}&limit=24`,
  ];
  for (const url of candidates) {
    try {
      const data = await getJson<KickStream[] | { data?: KickStream[] }>(url);
      const arr = Array.isArray(data) ? data : data?.data ?? [];
      if (arr.length > 0) {
        const list = arr.map(mapStream).filter((r): r is NetLiveRoom => !!r);
        return { list, hasMore: arr.length >= 20 };
      }
    } catch {
      /* try next */
    }
  }
  return { list: [], hasMore: false };
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
  // Kick 的 category livestreams endpoint 在不同版本下叫法不一，按已知顺序兜底
  const candidates = [
    `https://kick.com/api/v2/categories/${encodeURIComponent(categoryId)}/livestreams?page=${page}`,
    `https://kick.com/api/v2/categories/${encodeURIComponent(categoryId)}/streams?page=${page}`,
    `https://kick.com/api/v1/categories/${encodeURIComponent(categoryId)}/livestreams?page=${page}`,
    `https://kick.com/stream/livestreams/en?category=${encodeURIComponent(categoryId)}&page=${page}&limit=24`,
  ];
  for (const url of candidates) {
    try {
      const data = await getJson<KickStream[] | { data?: KickStream[] }>(url);
      const arr = Array.isArray(data) ? data : data?.data ?? [];
      if (arr.length > 0) {
        const list = arr.map(mapStream).filter((r): r is NetLiveRoom => !!r);
        return { list, hasMore: arr.length >= 20 };
      }
    } catch {
      /* try next */
    }
  }
  return { list: [], hasMore: false };
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
  // 抓 master m3u8 提取各清晰度 variant，用户能手动切；不抓的话默认 hls.js ABR
  // 可能停在低码率 → 看着很糊
  const alternatives = await fetchMasterAlternatives(url).catch(() => []);
  const top = alternatives[0];
  // 默认用最高码率的 single-variant URL，避免 hls.js ABR 起步太低
  // master URL 仍然作为 alternatives[0] 用户可手动 "auto" 回去
  const defaultUrl = top?.url ?? url;
  const alts = alternatives.length > 1
    ? [
        { qn: "auto", label: "自适应", url },
        ...alternatives,
      ]
    : undefined;
  return {
    url: defaultUrl,
    streamType: "hls",
    qn: top?.qn ?? "auto",
    qnLabel: top?.label ?? "自适应",
    alternatives: alts,
    referer: REFERER,
    ua: UA,
  };
}

/**
 * 抓 master m3u8 解析 `#EXT-X-STREAM-INF` 抽 variant。
 * 与 Twitch 同款逻辑，按 BANDWIDTH 倒序排，最高清晰度排第一便于默认选。
 */
async function fetchMasterAlternatives(
  masterUrl: string
): Promise<Array<{ qn: string; label: string; url: string }>> {
  const res = await scriptFetch(masterUrl, {
    method: "GET",
    headers: { "User-Agent": UA, Referer: REFERER },
    timeout: 15_000,
    http2: true,
  });
  if (!res.ok) return [];
  const text = await res.text();
  const lines = text.split("\n");
  const variants: Array<{
    bw: number;
    qn: string;
    label: string;
    url: string;
  }> = [];
  let pendingInf: string | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      pendingInf = line;
      continue;
    }
    if (pendingInf && line && !line.startsWith("#")) {
      const bwM = pendingInf.match(/BANDWIDTH=([0-9]+)/);
      const resM = pendingInf.match(/RESOLUTION=([0-9x]+)/);
      const frM = pendingInf.match(/FRAME-RATE=([0-9.]+)/);
      const bw = bwM ? parseInt(bwM[1], 10) : 0;
      const resolution = resM ? resM[1] : "?";
      const fr = frM ? Math.round(parseFloat(frM[1])) : 0;
      // label 形如 "1920x1080@60" 或 "1280x720"
      const heightM = resolution.match(/x([0-9]+)/);
      const heightLabel = heightM
        ? `${heightM[1]}p${fr > 30 ? fr : ""}`
        : resolution;
      const absUrl = line.startsWith("http")
        ? line
        : new URL(line, masterUrl).toString();
      variants.push({
        bw,
        qn: heightLabel || `${variants.length}`,
        label: heightLabel || resolution,
        url: absUrl,
      });
      pendingInf = null;
    }
  }
  // BANDWIDTH 倒序：最高码率默认排第一
  variants.sort((a, b) => b.bw - a.bw);
  return variants.map(({ qn, label, url }) => ({ qn, label, url }));
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
