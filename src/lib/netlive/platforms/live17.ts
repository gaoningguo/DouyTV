/**
 * 17 Live (17.live) 直播 adapter —— 台湾/日本/东南亚主流社交/热舞直播。
 *
 * 17Live 公开的几个稳定 endpoint：
 *   - 列表（POST）：`https://wap-api.17app.co/api/v1/lives/getStreamList`
 *     body: { categoryID, sourceTypes:[0,4], page, pageSize, hashtag }
 *   - 详情：`https://wap-api.17app.co/api/v1/lives/{userID-or-openID}/viewerInfo` (GET)
 *   - 旧 web：`https://17.live/api/v1/lives` 已废，会返 404/HTML
 *
 * 失败回退抓 web 主页 HTML 解析 `__NEXT_DATA__`。
 *
 * roomId = openID（slug）。
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
const REFERER = "https://17.live/";

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Referer: REFERER,
  Origin: "https://17.live",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,zh-TW;q=0.8,en;q=0.7",
};

interface SvLive {
  liveStreamID?: string;
  userID?: string;
  openID?: string;
  caption?: string;
  user?: {
    userID?: string;
    openID?: string;
    displayName?: string;
    picture?: string;
  };
  streamerInfo?: {
    liveStreamingURL?: string;
    liveStreamID?: string;
  };
  viewerCount?: number;
  totalViewCount?: number;
  thumbnail?: string;
  coverImg?: string;
  hashtag?: string;
  category?: string;
  status?: number;
  isStreamerLive?: boolean;
}

function mapLive(l: SvLive): NetLiveRoom | undefined {
  const openId = l.user?.openID ?? l.openID;
  const userId = l.user?.userID ?? l.userID;
  const slug = openId ?? userId;
  if (!slug) return undefined;
  return {
    platform: "live17",
    roomId: slug,
    title: l.caption ?? l.user?.displayName ?? slug,
    uname: l.user?.displayName,
    avatar: l.user?.picture,
    cover: l.thumbnail ?? l.coverImg,
    online: l.viewerCount ?? l.totalViewCount ?? 0,
    category: l.hashtag ?? l.category,
    live: l.isStreamerLive ?? l.status === 2,
    link: `https://17.live/live/${slug}`,
  };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await scriptFetch(url, {
    method: "GET",
    headers: COMMON_HEADERS,
    timeout: 25_000,
    http2: true,
  });
  if (!res.ok) throw new Error(`17Live HTTP ${res.status}`);
  return res.json<T>();
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await scriptFetch(url, {
    method: "POST",
    headers: { ...COMMON_HEADERS, "Content-Type": "application/json" },
    json: body,
    timeout: 25_000,
    http2: true,
  });
  if (!res.ok) throw new Error(`17Live HTTP ${res.status}`);
  return res.json<T>();
}

/* ─────────────── 推荐 ─────────────── */

interface SvListResp {
  lives?: SvLive[];
  hasNext?: boolean;
}

async function fetchLives(params: {
  category?: string;
  page: number;
  pageSize: number;
}): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  // 主路径：getStreamList POST 接口（多年稳定）
  const body = {
    categoryID: params.category && params.category !== "hot" ? params.category : "",
    sourceTypes: [0, 4],
    page: params.page,
    pageSize: params.pageSize,
    hashtag: "",
  };
  try {
    const data = await postJson<SvListResp>(
      "https://wap-api.17app.co/api/v1/lives/getStreamList",
      body
    );
    const arr = data.lives ?? [];
    if (arr.length > 0) {
      const list = arr.map(mapLive).filter((r): r is NetLiveRoom => !!r);
      return {
        list,
        hasMore: data.hasNext ?? arr.length >= params.pageSize,
      };
    }
  } catch {
    /* fall through */
  }
  // 回退：老 getRecommend(GET)
  try {
    const data = await getJson<SvListResp>(
      `https://wap-api.17app.co/api/v1/lives?page=${params.page}&pageSize=${params.pageSize}`
    );
    const arr = data.lives ?? [];
    const list = arr.map(mapLive).filter((r): r is NetLiveRoom => !!r);
    return {
      list,
      hasMore: data.hasNext ?? arr.length >= params.pageSize,
    };
  } catch {
    return { list: [], hasMore: false };
  }
}

async function getRecommend(
  page: number,
  pageSize: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  return fetchLives({ page, pageSize: Math.max(pageSize, 24) });
}

/* ─────────────── 分类 ─────────────── */

const PRESET_CATEGORIES: NetLiveCategory[] = [
  { id: "hot", name: "热门" },
  { id: "dance", name: "热舞" },
  { id: "music", name: "唱见" },
  { id: "talk", name: "脱口秀" },
  { id: "outdoor", name: "户外" },
  { id: "foreign", name: "海外" },
  { id: "lifestyle", name: "生活" },
  { id: "game", name: "游戏" },
];

async function getCategories(): Promise<NetLiveCategory[]> {
  return PRESET_CATEGORIES;
}

async function getCategoryRooms(
  categoryId: string,
  page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  return fetchLives({ category: categoryId, page, pageSize: 24 });
}

/* ─────────────── 搜索 ─────────────── */

interface SvSearchResp {
  lives?: SvLive[];
  users?: Array<{ userID?: string; openID?: string; displayName?: string; picture?: string }>;
}

async function search(
  keyword: string,
  _page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  try {
    const data = await getJson<SvSearchResp>(
      `https://wap-api.17app.co/api/v1/search/global?term=${encodeURIComponent(keyword)}`
    );
    const arr = data.lives ?? [];
    const list = arr.map(mapLive).filter((r): r is NetLiveRoom => !!r);
    // 若 lives 为空，把用户列表也展示（视作未开播）
    if (list.length === 0 && data.users) {
      for (const u of data.users) {
        const slug = u.openID ?? u.userID;
        if (!slug) continue;
        list.push({
          platform: "live17",
          roomId: slug,
          title: u.displayName ?? slug,
          uname: u.displayName,
          avatar: u.picture,
          live: false,
          link: `https://17.live/live/${slug}`,
        });
      }
    }
    return { list, hasMore: false };
  } catch {
    return { list: [], hasMore: false };
  }
}

/* ─────────────── 房间详情 + resolve ─────────────── */

async function fetchLiveDetail(roomId: string): Promise<SvLive | null> {
  // 17Live 真实 detail endpoint：viewerInfo
  try {
    const data = await getJson<SvLive>(
      `https://wap-api.17app.co/api/v1/lives/${encodeURIComponent(roomId)}/viewerInfo`
    );
    if (data.streamerInfo || data.liveStreamID) return data;
    return data;
  } catch {
    /* fall through */
  }
  // 老 endpoint 兜底
  try {
    const data = await getJson<{ lives?: SvLive[] } & SvLive>(
      `https://wap-api.17app.co/api/v1/lives/${encodeURIComponent(roomId)}`
    );
    if (data.streamerInfo || data.liveStreamID) return data;
    if (data.lives && data.lives.length > 0) return data.lives[0];
    return data;
  } catch {
    return null;
  }
}

async function getRoomDetail(roomId: string): Promise<NetLiveRoom> {
  const info = await fetchLiveDetail(roomId);
  if (!info) throw new Error(`17Live 房间 ${roomId} 未找到`);
  const mapped = mapLive(info);
  if (mapped) return mapped;
  return {
    platform: "live17",
    roomId,
    title: roomId,
    uname: roomId,
    live: false,
    link: `https://17.live/live/${roomId}`,
  };
}

async function getLiveStatus(roomId: string): Promise<boolean> {
  const info = await fetchLiveDetail(roomId);
  return !!(info?.isStreamerLive ?? info?.status === 2);
}

async function resolve(roomId: string): Promise<NetLiveStream> {
  const info = await fetchLiveDetail(roomId);
  if (!info) throw new Error(`17Live 房间 ${roomId} 未找到`);
  const url = info.streamerInfo?.liveStreamingURL;
  if (!url) throw new Error("17Live 未返回 liveStreamingURL（房间未开播）");
  return {
    url,
    streamType: "hls",
    qn: "auto",
    qnLabel: "原画",
    referer: REFERER,
    ua: UA,
  };
}

/* ─────────────── 导出 ─────────────── */

export const live17Adapter: NetLiveAdapter = {
  platform: "live17",
  getRecommend,
  search,
  resolve,
  getCategories,
  getCategoryRooms,
  getRoomDetail,
  getLiveStatus,
};
