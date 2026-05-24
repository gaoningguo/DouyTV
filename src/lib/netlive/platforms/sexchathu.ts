/**
 * SexChatHU (sexchat.hu) —— 匈牙利 AdultPerformerNetwork 旗下成人 cam。
 *
 * 真实可用 API(2026-05 curl 验证,匿名免登,无地理墙):
 *
 *   - 列表:服务端每次只返 ~35 个 room 的 *随机子集*,看似无分页,实际是
 *     服务端 rotate。要"拿全":并行多次请求 + 多 subpath endpoint 然后 union by perfid。
 *     实测同 endpoint 重复 5 次 union 可达 ~45 unique;`/babes` + `/babes/all` +
 *     `/babes/list` + `/babes/full` 并行一次 union 也 ~42-50 unique(各 subpath 是
 *     真路由不是别名,但返回的池是 *重叠* 的)。
 *
 *     候选 endpoint(都返同形 JSON array,差异只在 random subset):
 *       /ajax/api/roomList/babes
 *       /ajax/api/roomList/babes/all       —— 倾向多返 offline(各种含 offline 排序)
 *       /ajax/api/roomList/babes/list
 *       /ajax/api/roomList/babes/full
 *
 *     **stub aliases(都返同一个 6 元素子集,不要用)**:
 *       /ajax/api/roomList/all  /online  /free  /girls  /men  /couple  /women
 *
 *     **伪分页(server 完全忽略,只 rotate)**:
 *       ?page=N  ?offset=N  ?limit=N
 *
 *   - **每条 room 的 HLS URL 会过期**(几分钟级),所以 resolve 时不能复用 listing
 *     里缓存的 URL,必须重新拉单房间端点拿 fresh URL。
 *
 *   - 单房间端点:`/ajax/api/roomList/babes/{perfid}` —— 服务端用 perfid 作 rotation
 *     seed,返一个 ~30-35 行的数组,**通常包含 perfid 对应的 room**(若该主播 currently
 *     online)。是唯一近似 single-room lookup 的端点。其他常见 single-room 命名
 *     (chat-api/getRoom / getRoom / room/{id} ...)全是 SPA HTML fallback。
 *
 *   - status 字段(onlinestatus):
 *     "free" → 公开直播可看
 *     "offline" → 主播离线
 *     "vip" / "group" / "priv" → 私密展示,匿名拉不到画面 (响应里 `modeSpecific.main`
 *       字段直接缺失,只有 `price`,所以 vip 永远没 HLS URL)
 *
 *   - HLS URL 是 protocol-relative(`//hls.stream-...`),前置 `https:`。
 *
 *   - roomId 用 screenname (用户名)。pagedCache rooms Map 保存 perfid 反查表,
 *     resolve 时通过 screenname → cached.perfid → /babes/{perfid} 拿 fresh state。
 */
import { createPlatformFetch } from "@/lib/netlive/scriptFetch";
const scriptFetch = createPlatformFetch("sexchathu");
import type {
  NetLiveAdapter,
  NetLiveRoom,
  NetLiveStream,
} from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const REFERER = "https://sexchat.hu/";

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Referer: REFERER,
  Accept: "application/json, text/plain, */*",
};

// 2 个 endpoint 并行,平衡:`/babes` 标准 + `/babes/all` 倾向多 offline。
// 实测从 4 → 2 个,平均每轮 unique 从 ~45 → ~40(只少几个),HTTP 请求量减半,
// 显著降低被上游/代理限流的概率(用户报过 HTTP 500 from upstream)。
const LIST_ENDPOINTS = [
  "https://sexchat.hu/ajax/api/roomList/babes",
  "https://sexchat.hu/ajax/api/roomList/babes/all",
] as const;

interface ScuRoomRaw {
  perfid?: number | string;
  screenname?: string;
  onlinestatus?: string;
  snapshotid?: string;
  snapshotid_big?: string;
  roomimgid?: string;
  weight?: string;
  primarycat?: string;
  languages?: string[];
  onlineparams?: {
    publicData?: {
      roomid?: string;
      primaryCat?: string;
      streamQuality?: { resolution?: string };
    };
    modeSpecific?: {
      main?: { hls?: { address?: string } };
    };
    screenName?: string;
  };
}

function ensureHttps(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

async function fetchEndpoint(url: string): Promise<ScuRoomRaw[]> {
  // 单次 retry —— sexchat.hu / 上游 apn2 偶尔 5xx,加一次小延迟重试明显降低空结果率
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await scriptFetch(url, {
        method: "GET",
        headers: COMMON_HEADERS,
        timeout: 30_000,
        http2: true,
      });
      if (res.ok) return await res.json<ScuRoomRaw[]>();
      if (res.status < 500) return []; // 4xx 直接放弃,不 retry
    } catch {
      /* 网络层错,继续 retry */
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
  }
  return [];
}

async function fetchAll(): Promise<ScuRoomRaw[]> {
  // 4 个 endpoint 并行拉,union by perfid(fallback screenname)
  const lists = await Promise.all(LIST_ENDPOINTS.map(fetchEndpoint));
  if (lists.every((l) => l.length === 0)) {
    // 全失败 → 走一次直接调用拿真实 HTTP 错(给上层观测)
    const res = await scriptFetch(LIST_ENDPOINTS[0], {
      method: "GET",
      headers: COMMON_HEADERS,
      timeout: 30_000,
      http2: true,
    });
    if (!res.ok) throw new Error(`SexChatHU HTTP ${res.status}`);
    return await res.json<ScuRoomRaw[]>();
  }
  const seen = new Set<string>();
  const merged: ScuRoomRaw[] = [];
  for (const list of lists) {
    for (const room of list) {
      const key = String(room.perfid ?? room.screenname ?? "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(room);
    }
  }
  return merged;
}

/**
 * onlinestatus → 显示策略:
 *   free                          → live=true(可点 可播)
 *   vip / group / priv / hidden   → live=false(灰显)+ category 标 "🔒 私密直播中"
 *   offline                       → live=false(灰显)+ 不改 category
 *   其他未知                      → 按 offline 处理
 *
 * 之前隐藏 vip 是因为点击会失败,但导致列表只剩 4-9 条 UX 更差。现策略:
 * 显示 vip 但 live=false(card 灰显不可点 + badge),用户看到"完整阵容"
 * 又不会误点失败。
 */
function statusKind(status: string | undefined): "free" | "offline" | "private" {
  const s = (status ?? "").toLowerCase();
  if (s === "free") return "free";
  if (s === "offline") return "offline";
  return "private";
}

function mapRoom(r: ScuRoomRaw): NetLiveRoom | undefined {
  const screen = r.screenname || r.onlineparams?.screenName;
  if (!screen) return undefined;
  const kind = statusKind(r.onlinestatus);
  const primaryCat = r.onlineparams?.publicData?.primaryCat || r.primarycat;
  const category =
    kind === "private" ? `🔒 私密直播中` : primaryCat;
  return {
    platform: "sexchathu",
    roomId: screen,
    title: screen,
    uname: screen,
    cover: ensureHttps(r.snapshotid_big || r.snapshotid),
    online: 0,
    category,
    // 仅 free 状态匿名可拉流。其他状态(vip/group/priv/offline)live=false,
    // UI 上 card 会灰显,用户看到但点不进失败页。
    live: kind === "free",
    link: r.perfid
      ? `https://sexchat.hu/mypage/${r.perfid}/${encodeURIComponent(screen)}/chat`
      : `https://sexchat.hu/`,
  };
}

/* ─────────────── 推荐 ─────────────── */

function statusOrder(status: string | undefined): number {
  // 排序权重:free(可看) → private(私密直播中,有画面但拉不到) → offline(没在播)
  switch (statusKind(status)) {
    case "free":
      return 0;
    case "private":
      return 1;
    default:
      return 2;
  }
}

/**
 * 分页累积态。服务端列表是 random subset,要"拉穷":
 *  - page=1 → 重置 rooms Map,跑一轮 union(4 endpoint 并行),返新 ~45 room,hasMore=true
 *  - page=N (N>1) → 又跑一轮 union,perfid 去重,返新 ~5-15 room,hasMore=true
 *  - 直到某轮 union 一个新 room 都没拿到 → exhausted=true,hasMore=false
 *
 * **rooms Map 同时是 resolve 时的 perfid 反查表** —— resolve(screenname) 时拿到 perfid
 * 再去 `/babes/{perfid}` 拉 fresh state(listing 里的 HLS URL 会过期)。
 *
 * 软上限:page>=15 强制 hasMore=false(60 个 HTTP 请求,典型池子已尽)
 * TTL:state 闲置 5 分钟自动失效,下次按 page=1 处理(避免长尾 stale)
 */
let pagedCache: {
  rooms: Map<string, ScuRoomRaw>; // perfid (字符串) → room
  exhausted: boolean;
  lastUpdate: number;
} | null = null;

const PAGED_CACHE_TTL_MS = 5 * 60 * 1000;
const PAGED_SOFT_LIMIT = 15;

function roomKey(r: ScuRoomRaw): string {
  return String(r.perfid ?? r.screenname ?? "");
}

/** 从 pagedCache 按 screenname(或 perfid)反查最近一次 listing 见过的 room */
function findCachedRoom(roomId: string): ScuRoomRaw | undefined {
  if (!pagedCache) return undefined;
  // 优先 perfid 精确匹配(roomId 是数字时)
  if (/^\d+$/.test(roomId)) {
    const direct = pagedCache.rooms.get(roomId);
    if (direct) return direct;
  }
  // 否则按 screenname 大小写不敏感
  const lower = roomId.toLowerCase();
  for (const r of pagedCache.rooms.values()) {
    if ((r.screenname ?? "").toLowerCase() === lower) return r;
  }
  return undefined;
}

/**
 * `/ajax/api/roomList/babes/{perfid}` —— 服务端用 perfid 作 rotation seed,
 * 返一个 ~30-35 行的数组,**通常包含 perfid 对应的 room**(若该主播 currently online)。
 * 是 sexchat.hu 唯一近似 "single-room lookup" 的端点。
 *
 * 实测:
 *   - online (free / vip):响应里能找到该 perfid,自带 fresh HLS URL
 *   - offline:可能能找到(status=offline,无 HLS),也可能根本不在响应里
 */
async function fetchRoomByPerfid(
  perfid: string | number,
): Promise<ScuRoomRaw | undefined> {
  const arr = await fetchEndpoint(
    `https://sexchat.hu/ajax/api/roomList/babes/${perfid}`,
  );
  const target = String(perfid);
  return arr.find((r) => String(r.perfid) === target);
}

async function getRecommend(
  page: number,
  _pageSize: number,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const now = Date.now();
  const stale =
    !pagedCache || now - pagedCache.lastUpdate > PAGED_CACHE_TTL_MS;
  if (page === 1 || stale) {
    pagedCache = { rooms: new Map(), exhausted: false, lastUpdate: now };
  }
  if (pagedCache!.exhausted) {
    return { list: [], hasMore: false };
  }

  const fresh = await fetchAll();
  const newRooms: ScuRoomRaw[] = [];
  for (const r of fresh) {
    const key = roomKey(r);
    if (!key) continue;
    if (!pagedCache!.rooms.has(key)) {
      pagedCache!.rooms.set(key, r);
      newRooms.push(r);
    }
  }
  pagedCache!.lastUpdate = now;

  // 池子见底:这轮一个新 room 都没拿到
  if (newRooms.length === 0) {
    pagedCache!.exhausted = true;
    return { list: [], hasMore: false };
  }

  const sorted = newRooms.sort(
    (a, b) => statusOrder(a.onlinestatus) - statusOrder(b.onlinestatus),
  );
  const list = sorted.map(mapRoom).filter((r): r is NetLiveRoom => !!r);

  // 软上限:page>=15 强制 hasMore=false(60 个 HTTP 请求,典型池子已尽)
  const hasMore = page < PAGED_SOFT_LIMIT;
  return { list, hasMore };
}

/* ─────────────── 搜索 ─────────────── */

async function search(
  keyword: string,
  _page: number,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const arr = await fetchAll();
  const kw = keyword.toLowerCase();
  const list = arr
    .filter((r) => (r.screenname ?? "").toLowerCase().includes(kw))
    .sort((a, b) => statusOrder(a.onlinestatus) - statusOrder(b.onlinestatus))
    .map(mapRoom)
    .filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: false };
}

/* ─────────────── resolve ─────────────── */

async function resolve(roomId: string): Promise<NetLiveStream> {
  // 1. 拿 perfid:先查 pagedCache(listing 时缓存的),没有再 fallback fetchAll 搜
  let cached = findCachedRoom(roomId);
  if (!cached) {
    const arr = await fetchAll();
    cached = arr.find(
      (r) => (r.screenname ?? "").toLowerCase() === roomId.toLowerCase(),
    );
    if (!cached) {
      throw new Error(`SexChatHU 未找到主播 ${roomId}(可能已离线)`);
    }
  }
  if (!cached.perfid) {
    throw new Error(`SexChatHU ${roomId} 缺 perfid,无法 resolve`);
  }

  // 2. 拉 fresh state —— listing 里的 HLS URL 会随时间过期,必须重新拉
  const fresh = await fetchRoomByPerfid(cached.perfid);
  if (!fresh) {
    // 单房间端点也找不到 —— 主播确实下线了
    throw new Error(`SexChatHU 主播 ${roomId} 已下线`);
  }

  const status = (fresh.onlinestatus ?? "").toLowerCase();
  if (status !== "free") {
    throw new Error(
      `SexChatHU 主播 ${roomId} 状态 ${status}(私密/离线,匿名无画面)`,
    );
  }
  const hls = ensureHttps(fresh.onlineparams?.modeSpecific?.main?.hls?.address);
  if (!hls) throw new Error(`SexChatHU ${roomId} 无 HLS URL(状态 free 但无流)`);
  return {
    url: hls,
    streamType: "hls",
    qn: "auto",
    qnLabel: "自适应",
    referer: REFERER,
    ua: UA,
  };
}

async function getLiveStatus(roomId: string): Promise<boolean> {
  try {
    const cached = findCachedRoom(roomId);
    if (cached?.perfid) {
      // 有 perfid → 走单房间端点拿 fresh state
      const fresh = await fetchRoomByPerfid(cached.perfid);
      return (fresh?.onlinestatus ?? "").toLowerCase() === "free";
    }
    // 没缓存 → fallback union
    const arr = await fetchAll();
    const found = arr.find(
      (r) => (r.screenname ?? "").toLowerCase() === roomId.toLowerCase(),
    );
    return (found?.onlinestatus ?? "").toLowerCase() === "free";
  } catch {
    return false;
  }
}

/* ─────────────── 导出 ─────────────── */

export const sexchathuAdapter: NetLiveAdapter = {
  platform: "sexchathu",
  getRecommend,
  search,
  resolve,
  getLiveStatus,
};
