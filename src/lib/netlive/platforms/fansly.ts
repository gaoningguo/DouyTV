/**
 * Fansly Live (fansly.com) —— OnlyFans 竞品 sub-based 平台,内置直播功能。
 *
 * 真实 API(2026-05 用户实测抓包确认,匿名可用):
 *
 *   ─── 直播 listing(主端点!) ───
 *   GET https://apiv3.fansly.com/api/v1/contentdiscovery/livesuggestions
 *       ?limit=N&offset=M&ngsw-bypass=true
 *
 *   只需 plain headers(User-Agent / Origin / Referer / Accept-Language)。
 *   **不要**带 fansly-client-id / ts / check / session-id —— 这些是登录态安全 header,
 *   匿名访问带上反而被识别可疑流量返回空。
 *
 *   响应:{ success, response: { accounts: [{
 *     id, username, displayName, avatar, banner, about,
 *     followCount, subscriberCount, accountMediaLikes,
 *     streaming: {
 *       channel: {
 *         id, accountId, playbackUrl,  // ← AWS IVS HLS URL 直接给!
 *         status,  // 2 = 在播
 *         stream: { title, status, viewerCount, startedAt, ... }
 *       }
 *     }
 *   }] } }
 *
 *   一次请求拿到房间列表 + 流 URL + 标题 + 观众数 + 头像 —— 不需二次查 account/channel。
 *
 *   ─── username → numeric id(resolve 单条 / search 用) ───
 *   GET /api/v1/account?usernames={user}&ngsw-bypass=true
 *
 *   ─── 单房间流(resolve fallback,不在 listing cache 时用) ───
 *   GET /api/v1/streaming/channel/{room_id}?ngsw-bypass=true
 *
 * Node fetch(undici)被 Fansly TLS 指纹屏蔽(ConnectTimeout),Tauri ureq 没问题。
 */
import { createPlatformFetch } from "@/lib/netlive/scriptFetch";
const scriptFetch = createPlatformFetch("fansly");
import {
  type NetLiveAdapter,
  type NetLiveRoom,
  type NetLiveStream,
} from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const REFERER = "https://fansly.com/";
const ORIGIN = "https://fansly.com";

const PLAIN_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Referer: REFERER,
  Origin: ORIGIN,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

/* ─────────────── types ─────────────── */

interface FlImageLocation {
  locationId?: string;
  location?: string;
}
interface FlImageVariant {
  width?: number;
  height?: number;
  locations?: FlImageLocation[];
}
interface FlImage {
  variants?: FlImageVariant[];
  locations?: FlImageLocation[];
}

interface FlStreamInner {
  id?: string;
  channelId?: string;
  title?: string;
  status?: number; // 2 = live
  viewerCount?: number;
  startedAt?: number;
}
interface FlChannel {
  id?: string;
  accountId?: string;
  playbackUrl?: string;
  chatRoomId?: string;
  status?: number; // 2 = live
  stream?: FlStreamInner;
}
interface FlStreaming {
  accountId?: string;
  channel?: FlChannel;
}

interface FlAccount {
  id?: string;
  username?: string;
  displayName?: string;
  about?: string;
  followCount?: number;
  subscriberCount?: number;
  accountMediaLikes?: number;
  avatar?: FlImage;
  banner?: FlImage;
  streaming?: FlStreaming;
}

interface FlLiveSuggestionsResp {
  success?: boolean;
  response?: {
    accounts?: FlAccount[];
  };
}

interface FlAccountResp {
  success?: boolean;
  response?: FlAccount[];
}

interface FlChannelOnlyResp {
  success?: boolean;
  response?: {
    stream?: { status?: number; access?: boolean; playbackUrl?: string };
  };
}

/* ─────────────── 缓存 ─────────────── */

interface PageCache {
  at: number;
  accounts: FlAccount[];
}
const pageCache = new Map<string, PageCache>(); // key=`${offset}@${limit}`
const PAGE_TTL_MS = 60_000;

// 全平台 account by id —— resolve 时 cache 命中直接用 playbackUrl,避免二次请求
const accountById = new Map<string, { at: number; acc: FlAccount }>();
const ACCOUNT_TTL_MS = 60_000;

// username → numeric id(resolve 输入 username 时用)
const usernameToId = new Map<string, string>();

/* ─────────────── helpers ─────────────── */

function pickAvatarUrl(acc: FlAccount): string | undefined {
  const variants = acc.avatar?.variants ?? [];
  // 优先 width>=200 的变体(列表卡片够清晰),按宽度升序
  const sorted = [...variants]
    .filter((v) => v.locations?.[0]?.location)
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  for (const v of sorted) {
    if ((v.width ?? 0) >= 200) return v.locations?.[0]?.location;
  }
  return sorted[0]?.locations?.[0]?.location;
}

function pickBannerUrl(acc: FlAccount): string | undefined {
  const variants = acc.banner?.variants ?? [];
  const sorted = [...variants]
    .filter((v) => v.locations?.[0]?.location)
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  // banner 一般做卡片 cover,宽屏取 width>=480
  for (const v of sorted) {
    if ((v.width ?? 0) >= 480) return v.locations?.[0]?.location;
  }
  return sorted[sorted.length - 1]?.locations?.[0]?.location;
}

function accountToRoom(acc: FlAccount): NetLiveRoom | undefined {
  if (!acc.id || !acc.username) return undefined;
  const ch = acc.streaming?.channel;
  const st = ch?.stream;
  const avatar = pickAvatarUrl(acc);
  const banner = pickBannerUrl(acc);
  return {
    platform: "fansly",
    roomId: acc.id,
    title: st?.title || acc.displayName || acc.username,
    uname: acc.displayName || acc.username,
    avatar,
    // 列表卡片用 banner(宽屏)更合适,fallback 头像
    cover: banner || avatar,
    online: st?.viewerCount ?? 0,
    category: "live",
    live: ch?.status === 2 && st?.status === 2,
    link: `https://fansly.com/${encodeURIComponent(acc.username)}`,
    introduction: acc.about,
  };
}

async function fetchLiveSuggestions(
  offset: number,
  limit: number,
): Promise<FlAccount[]> {
  const url =
    `https://apiv3.fansly.com/api/v1/contentdiscovery/livesuggestions` +
    `?limit=${limit}&offset=${offset}&ngsw-bypass=true`;
  const res = await scriptFetch(url, {
    method: "GET",
    headers: PLAIN_HEADERS,
    timeout: 25_000,
  });
  console.info(
    `[fansly] livesuggestions offset=${offset} limit=${limit} → status=${res.status}`,
  );
  if (!res.ok) {
    const text = await res.text();
    console.warn(`[fansly] livesuggestions body (first 300):`, text.slice(0, 300));
    throw new Error(`Fansly livesuggestions HTTP ${res.status}`);
  }
  const text = await res.text();
  console.info(`[fansly] livesuggestions body length: ${text.length}`);
  let data: FlLiveSuggestionsResp;
  try {
    data = JSON.parse(text);
  } catch (e) {
    console.error(
      `[fansly] livesuggestions JSON parse:`,
      e,
      text.slice(0, 200),
    );
    throw new Error(`Fansly livesuggestions JSON parse: ${(e as Error).message}`);
  }
  if (data.success !== true) {
    console.warn(`[fansly] success!=true, raw:`, text.slice(0, 200));
    throw new Error("Fansly livesuggestions success!=true");
  }
  const accounts = data.response?.accounts ?? [];
  console.info(`[fansly] livesuggestions ok, accounts=${accounts.length}`);
  // 缓存 account,resolve 时直接用 streaming.channel.playbackUrl
  const now = Date.now();
  for (const a of accounts) {
    if (a.id) accountById.set(a.id, { at: now, acc: a });
    if (a.username && a.id) {
      usernameToId.set(a.username.toLowerCase(), a.id);
    }
  }
  return accounts;
}

/* ─────────────── adapter API ─────────────── */

async function getRecommend(
  page: number,
  pageSize: number,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const ps = Math.max(1, Math.min(pageSize, 50));
  const offset = (Math.max(1, page) - 1) * ps;
  const key = `${offset}@${ps}`;
  const now = Date.now();
  const cached = pageCache.get(key);
  let accounts: FlAccount[];
  if (cached && now - cached.at < PAGE_TTL_MS) {
    accounts = cached.accounts;
  } else {
    accounts = await fetchLiveSuggestions(offset, ps);
    pageCache.set(key, { at: now, accounts });
  }
  const list = accounts
    .map(accountToRoom)
    .filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: accounts.length === ps };
}

async function search(
  keyword: string,
  _page: number,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const kw = keyword.trim();
  if (!kw) return { list: [], hasMore: false };
  // username 精确查
  const url = `https://apiv3.fansly.com/api/v1/account?usernames=${encodeURIComponent(kw)}&ngsw-bypass=true`;
  try {
    const res = await scriptFetch(url, {
      method: "GET",
      headers: PLAIN_HEADERS,
      timeout: 15_000,
    });
    if (!res.ok) return { list: [], hasMore: false };
    const data = await res.json<FlAccountResp>();
    const rooms: NetLiveRoom[] = [];
    const now = Date.now();
    for (const a of data.response ?? []) {
      if (!a.id || !a.username) continue;
      usernameToId.set(a.username.toLowerCase(), a.id);
      accountById.set(a.id, { at: now, acc: a });
      const room = accountToRoom(a);
      if (room) rooms.push(room);
    }
    return { list: rooms, hasMore: false };
  } catch {
    return { list: [], hasMore: false };
  }
}

async function getRoomId(username: string): Promise<string | null> {
  const cached = usernameToId.get(username.toLowerCase());
  if (cached) return cached;
  const res = await scriptFetch(
    `https://apiv3.fansly.com/api/v1/account?usernames=${encodeURIComponent(username)}&ngsw-bypass=true`,
    { method: "GET", headers: PLAIN_HEADERS, timeout: 20_000 },
  );
  if (!res.ok) return null;
  const data = await res.json<FlAccountResp>();
  for (const a of data.response ?? []) {
    if (a.username?.toLowerCase() === username.toLowerCase() && a.id) {
      usernameToId.set(a.username.toLowerCase(), a.id);
      accountById.set(a.id, { at: Date.now(), acc: a });
      return a.id;
    }
  }
  return null;
}

async function fetchChannel(
  roomId: string,
): Promise<{ status?: number; access?: boolean; playbackUrl?: string } | null> {
  const res = await scriptFetch(
    `https://apiv3.fansly.com/api/v1/streaming/channel/${encodeURIComponent(roomId)}?ngsw-bypass=true`,
    { method: "GET", headers: PLAIN_HEADERS, timeout: 20_000 },
  );
  if (!res.ok) return null;
  const data = await res.json<FlChannelOnlyResp>();
  if (data.success !== true) return null;
  return data.response?.stream ?? null;
}

async function resolve(roomId: string): Promise<NetLiveStream> {
  // username → numeric id
  let chId = roomId;
  if (!/^\d+$/.test(roomId)) {
    const found = await getRoomId(roomId);
    if (!found) throw new Error(`Fansly 用户 ${roomId} 不存在`);
    chId = found;
  }
  // 关键:**永远** 走 streaming/channel/{id} 拉 stream.playbackUrl(带 JWT token,
  // TTL ~10s)。listing 响应里 channel.playbackUrl 是无 token base URL,会 403。
  // 也不能 cache —— token 几秒就过期,player 拉到时已经失效。
  const stream = await fetchChannel(chId);
  if (!stream) throw new Error(`Fansly 主播 ${roomId} 拉不到 stream`);
  if (stream.status !== 2)
    throw new Error(`Fansly 主播 ${roomId} 不在线 (status=${stream.status})`);
  if (stream.access !== true || !stream.playbackUrl) {
    throw new Error(`Fansly 主播 ${roomId} 需订阅(private)`);
  }
  if (!stream.playbackUrl.includes("token=")) {
    console.warn(
      `[fansly] resolve got playbackUrl without token (will 403): ${stream.playbackUrl.slice(0, 80)}`,
    );
  }
  return {
    url: stream.playbackUrl,
    streamType: "hls",
    qn: "auto",
    qnLabel: "自适应",
    referer: REFERER,
    ua: UA,
  };
}

async function getLiveStatus(roomId: string): Promise<boolean> {
  try {
    let chId = roomId;
    if (!/^\d+$/.test(roomId)) {
      const found = await getRoomId(roomId);
      if (!found) return false;
      chId = found;
    }
    const cached = accountById.get(chId);
    if (cached && Date.now() - cached.at < ACCOUNT_TTL_MS) {
      return cached.acc.streaming?.channel?.status === 2;
    }
    const s = await fetchChannel(chId);
    return s?.status === 2 && s?.access === true;
  } catch {
    return false;
  }
}

async function getRoomDetail(roomId: string): Promise<NetLiveRoom> {
  let chId = roomId;
  if (!/^\d+$/.test(roomId)) {
    const found = await getRoomId(roomId);
    if (found) chId = found;
  }
  const cached = accountById.get(chId);
  if (cached && Date.now() - cached.at < ACCOUNT_TTL_MS) {
    const room = accountToRoom(cached.acc);
    if (room) return room;
  }
  // cache miss → batch account 拿主播信息
  const res = await scriptFetch(
    `https://apiv3.fansly.com/api/v1/account?ids=${encodeURIComponent(chId)}&ngsw-bypass=true`,
    { method: "GET", headers: PLAIN_HEADERS, timeout: 15_000 },
  );
  if (res.ok) {
    const data = await res.json<FlAccountResp>();
    for (const a of data.response ?? []) {
      if (a.id) {
        accountById.set(a.id, { at: Date.now(), acc: a });
        const room = accountToRoom(a);
        if (room) return room;
      }
    }
  }
  return {
    platform: "fansly",
    roomId,
    title: roomId,
    uname: roomId,
    live: await getLiveStatus(roomId),
    link: `https://fansly.com/${encodeURIComponent(roomId)}`,
  };
}

export const fanslyAdapter: NetLiveAdapter = {
  platform: "fansly",
  getRecommend,
  search,
  resolve,
  getRoomDetail,
  getLiveStatus,
};
