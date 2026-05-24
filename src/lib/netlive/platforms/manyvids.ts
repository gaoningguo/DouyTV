/**
 * ManyVids Live (manyvids.com / MV-Live) —— ManyVids 旗下成人 cam,Next.js 重写后
 * 架构整体迁移到 **Agora WebRTC SFU**。下面是 2026-05 实测的真实端点(均匿名可访问):
 *
 *   1) 列表:
 *      GET https://api.manyvids.com/live/creators
 *          ?sortBy=rank&limit=300&blockedCountry=Hong%20Kong&status=online
 *      返:{ creators: [{ user_id, guid, url_handle, display_name, avatar, portrait,
 *                        live_cover, live_status:"ONLINE", session_type:"PUBLIC",
 *                        session_url, rank, isAICreator, ... }],
 *            next_token: string|null }
 *      ⚠ CloudFront 按出口国家屏蔽 —— HK/DC IP 拿 403 HTML(本地代理走美国/欧洲住宅 OK)。
 *
 *   2) 单房间元信息(可选,拉详情用):
 *      GET https://api.manyvids.com/live/room/{user_id}
 *      返:{ user_id, creator_info{display_name,avatar}, room_topic, room_state,
 *            streaming_state, viewer_count, room_goal, tip_menu, private_config, ... }
 *      注意:这里只接受 **user_id(数字 ID)**,不接受 url_handle/guid。
 *
 *   3) 拉流 token:
 *      POST https://api.manyvids.com/live/room/{user_id}/joinChannel
 *      body: { "visibility": "PUBLIC" }
 *      返:{ sessUserId, roomId, meetingInfo: { channelId, rtc(Agora token,
 *            "007e..."), rtm, uid, expires } }
 *      → Agora WebRTC SFU。前端走 customType.agorartc 懒加载 agora-rtc-sdk-ng,
 *        client.join(appId, channelId, rtc, uid) → subscribe 远端 track。
 *
 *   ⛔ 旧文档里的 roompool.live.manyvids.com / player-settings / CloudFront-Policy
 *      流程已经全部废弃,roompool 域名返 404 + SNI cert mismatch。
 */
import { createPlatformFetch } from "@/lib/netlive/scriptFetch";
const scriptFetch = createPlatformFetch("manyvids");
import {
  type NetLiveAdapter,
  type NetLiveRoom,
  type NetLiveStream,
} from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const REFERER = "https://www.manyvids.com/live/online";

/**
 * Agora App ID —— ManyVids 全站共用一个 Agora project 的 appId,32 位 hex,
 * 不在 joinChannel 响应里(只给 token),从 cam 页面 lazy chunk `0b0.0dj9uz4p5.js`
 * 里提取(VidChat 产品全局配置常量,2026-05 抓到)。如果将来 ManyVids 旋转 appId,
 * Agora SDK 会报 "invalid app id" / "INVALID_VENDOR_KEY",重抓 cam 页面 lazy chunk 即可。
 */
const MANYVIDS_AGORA_APP_ID = "07af9cc5c9cd4cf7bf0b730a72997902";

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Referer: REFERER,
  Origin: "https://www.manyvids.com",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

interface MvCreator {
  user_id?: string;
  guid?: string;
  url_handle?: string;
  display_name?: string;
  avatar?: string;
  portrait?: string;
  live_cover?: string;
  live_status?: string; // "ONLINE" / ...
  session_type?: string; // "PUBLIC" / ...
  session_url?: string;
  rank?: number;
  isNewest?: boolean;
  isAICreator?: boolean;
}

interface MvListResp {
  creators?: MvCreator[];
  next_token?: string | null;
}

interface MvRoomInfo {
  user_id?: string;
  creator_info?: { display_name?: string; avatar?: string };
  room_topic?: string;
  room_state?: string;       // "ONLINE" / ...
  streaming_state?: string;  // "PUBLIC" / "PRIVATE" / ...
  viewer_count?: number;
}

interface MvJoinChannelResp {
  sessUserId?: string;
  roomId?: string;
  meetingInfo?: {
    isHost?: boolean;
    isMobile?: boolean;
    channelId?: string;
    rtc?: string;
    rtm?: string;
    uid?: number;
    expires?: number;
  };
  message?: string;
}

/* ─────────────── 列表缓存 ─────────────── */

const LIST_CACHE_TTL_MS = 30_000;
let listCache: { data: MvCreator[]; expiry: number } | null = null;

async function fetchAllOnline(): Promise<MvCreator[]> {
  if (listCache && listCache.expiry > Date.now()) return listCache.data;
  const url =
    "https://api.manyvids.com/live/creators" +
    "?sortBy=rank&limit=300&blockedCountry=Hong%20Kong&status=online";
  const res = await scriptFetch(url, {
    method: "GET",
    headers: COMMON_HEADERS,
    timeout: 30_000,
    http2: true,
  });
  if (!res.ok) throw new Error(`ManyVids HTTP ${res.status}`);
  const data = await res.json<MvListResp>();
  const creators = data.creators ?? [];
  listCache = { data: creators, expiry: Date.now() + LIST_CACHE_TTL_MS };
  return creators;
}

function mapRoom(c: MvCreator): NetLiveRoom | undefined {
  const handle = c.url_handle;
  if (!handle) return undefined;
  const name = c.display_name || handle;
  return {
    platform: "manyvids",
    roomId: handle,
    title: name,
    uname: name,
    avatar: c.avatar || c.portrait,
    cover: c.live_cover || c.portrait,
    live: (c.live_status || "").toUpperCase() === "ONLINE",
    link: c.session_url || `https://www.manyvids.com/live/cam/${encodeURIComponent(handle)}`,
  };
}

async function fetchRoomCreator(handle: string): Promise<MvCreator | undefined> {
  try {
    const all = await fetchAllOnline();
    const key = handle.toLowerCase();
    return all.find(
      (c) =>
        (c.url_handle || "").toLowerCase() === key ||
        (c.display_name || "").toLowerCase() === key,
    );
  } catch {
    return undefined;
  }
}

async function fetchRoomInfo(userId: string): Promise<MvRoomInfo | undefined> {
  try {
    const res = await scriptFetch(
      `https://api.manyvids.com/live/room/${encodeURIComponent(userId)}`,
      { method: "GET", headers: COMMON_HEADERS, timeout: 20_000, http2: true },
    );
    if (!res.ok) return undefined;
    return res.json<MvRoomInfo>();
  } catch {
    return undefined;
  }
}

async function joinChannel(userId: string): Promise<MvJoinChannelResp> {
  const res = await scriptFetch(
    `https://api.manyvids.com/live/room/${encodeURIComponent(userId)}/joinChannel`,
    {
      method: "POST",
      headers: { ...COMMON_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ visibility: "PUBLIC" }),
      timeout: 20_000,
      http2: true,
    },
  );
  if (!res.ok) throw new Error(`ManyVids joinChannel HTTP ${res.status}`);
  return res.json<MvJoinChannelResp>();
}

/* ─────────────── 推荐 ─────────────── */

async function getRecommend(
  page: number,
  pageSize: number,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const all = await fetchAllOnline();
  const size = Math.max(pageSize, 1);
  const start = (Math.max(page, 1) - 1) * size;
  const slice = all.slice(start, start + size);
  const list = slice
    .map(mapRoom)
    .filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: start + size < all.length };
}

/* ─────────────── 详情 ─────────────── */

async function getRoomDetail(roomId: string): Promise<NetLiveRoom> {
  const c = await fetchRoomCreator(roomId);
  if (!c) throw new Error(`ManyVids 主播 ${roomId} 当前不在线或不存在`);
  const base = mapRoom(c);
  if (!base) throw new Error(`ManyVids 主播 ${roomId} 数据异常`);
  const info = c.user_id ? await fetchRoomInfo(c.user_id) : undefined;
  return {
    ...base,
    title: info?.room_topic || base.title,
    online: info?.viewer_count,
    introduction: info?.room_topic,
  };
}

/* ─────────────── resolve ─────────────── */

async function resolve(roomId: string): Promise<NetLiveStream> {
  if (!MANYVIDS_AGORA_APP_ID) {
    throw new Error(
      "ManyVids 拉流缺少 Agora App ID —— 见 manyvids.ts 顶部 MANYVIDS_AGORA_APP_ID 注释,从浏览器 DevTools 抓后填入",
    );
  }
  const c = await fetchRoomCreator(roomId);
  if (!c) throw new Error(`ManyVids 主播 ${roomId} 当前不在线或不存在`);
  if ((c.live_status || "").toUpperCase() !== "ONLINE") {
    throw new Error(`ManyVids 主播 ${roomId} 状态 ${c.live_status}`);
  }
  if (!c.user_id) throw new Error(`ManyVids 主播 ${roomId} 缺少 user_id`);

  const jc = await joinChannel(c.user_id);
  const info = jc.meetingInfo;
  if (!info?.channelId || !info?.rtc || typeof info?.uid !== "number") {
    throw new Error(
      `ManyVids joinChannel 返回异常: ${jc.message || JSON.stringify(jc).slice(0, 200)}`,
    );
  }

  return {
    url: `agora-rtc://${info.channelId}`, // sentinel,ArtPlayer customType 分发用
    streamType: "agora-rtc",
    referer: REFERER,
    ua: UA,
    agora: {
      appId: MANYVIDS_AGORA_APP_ID,
      channelId: info.channelId,
      token: info.rtc,
      uid: info.uid,
      // ArtPlayer customType.agorartc 每次 attach 会调一次,拿全新 token + uid。
      // 解决 React StrictMode 双 mount + 生产切回同房间时 server 端旧 connection 未释放
      // 撞 UID_CONFLICT 的问题。channelId 实测每次同 host 都不变,但仍按 server 当次值用。
      refresh: async () => {
        const fresh = await joinChannel(c.user_id!);
        const m = fresh.meetingInfo;
        if (!m?.channelId || !m?.rtc || typeof m?.uid !== "number") {
          throw new Error(`ManyVids refresh joinChannel 返回异常: ${fresh.message || ""}`);
        }
        return { channelId: m.channelId, token: m.rtc, uid: m.uid };
      },
    },
  };
}

async function getLiveStatus(roomId: string): Promise<boolean> {
  const c = await fetchRoomCreator(roomId);
  return (c?.live_status || "").toUpperCase() === "ONLINE";
}

export const manyvidsAdapter: NetLiveAdapter = {
  platform: "manyvids",
  getRecommend,
  resolve,
  getLiveStatus,
  getRoomDetail,
};
