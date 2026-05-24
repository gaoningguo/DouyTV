/**
 * 17 Live (17.live) adapter
 *
 * 新版真实接口：
 *   GET https://wap-api.17app.co/api/v1/cells
 *
 * 示例：
 *   /api/v1/cells?count=10&cursor=&paging=1&region=SG&tab=hot_opt
 *
 * 直播流：
 *   stream.rtmpUrls[]
 *
 * roomId:
 *   userID
 */

import { createPlatformFetch } from "@/lib/netlive/scriptFetch";
const scriptFetch = createPlatformFetch("live17");
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
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

interface SvUser {
  userID?: string;
  openID?: string;
  displayName?: string;
  picture?: string;
  bio?: string;
}

interface SvRtmpUrl {
  provider?: number;
  streamType?: string;
  url?: string;

  urlLowQuality?: string;
  urlHighQuality?: string;

  url264?: string;

  urlLowBitrateHD?: string;
  urlQualityEnhancedHD?: string;
}

interface SvStream {
  userID?: string;

  status?: number;

  caption?: string;

  thumbnail?: string;
  coverPhoto?: string;

  viewerCount?: number;
  liveViewerCount?: number;

  liveStreamID?: number;

  userInfo?: SvUser;

  rtmpUrls?: SvRtmpUrl[];

  pullURLsInfo?: {
    rtmpURLs?: SvRtmpUrl[];
  };
}

interface SvCell {
  type?: number;
  stream?: SvStream;
}

interface SvCellsResp {
  cursor?: string;
  cells?: SvCell[];
}

function normalizeImage(url?: string): string | undefined {
  if (!url) return undefined;

  if (url.startsWith("http")) return url;

  return `https://cdn.17app.co/${url}`;
}

function mapStream(stream: SvStream): NetLiveRoom | undefined {
  const user = stream.userInfo;

  const roomId = user?.userID ?? stream.userID;

  if (!roomId) return undefined;

  return {
    platform: "live17",

    roomId,

    title:
      stream.caption ??
      user?.displayName ??
      user?.openID ??
      roomId,

    uname:
      user?.displayName ??
      user?.openID ??
      roomId,

    avatar: normalizeImage(user?.picture),

    cover:
      normalizeImage(stream.thumbnail) ??
      stream.coverPhoto,

    online:
      stream.liveViewerCount ??
      stream.viewerCount ??
      0,

    category: "17Live",

    live: stream.status === 2,

    link: `https://17.live/live/${roomId}`,
  };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await scriptFetch(url, {
    method: "GET",
    headers: COMMON_HEADERS,
    timeout: 25000,
    http2: true,
  });

  if (!res.ok) {
    throw new Error(`17Live HTTP ${res.status}`);
  }

  return res.json<T>();
}

/* ─────────────── 推荐 ─────────────── */

async function fetchCells(params: {
  tab?: string;
  cursor?: string;
  count?: number;
}): Promise<{
  list: NetLiveRoom[];
  cursor?: string;
  hasMore: boolean;
}> {
  const qs = new URLSearchParams({
    count: String(params.count ?? 20),
    cursor: params.cursor ?? "",
    paging: "1",
    region: "SG",
    tab: params.tab ?? "hot_opt",
  });

  const data = await getJson<SvCellsResp>(
    `https://wap-api.17app.co/api/v1/cells?${qs.toString()}`
  );

  const list: NetLiveRoom[] = [];

  for (const cell of data.cells ?? []) {
    if (cell.type !== 0) continue;

    if (!cell.stream) continue;

    const room = mapStream(cell.stream);

    if (room) {
      list.push(room);
    }
  }

  return {
    list,
    cursor: data.cursor,
    hasMore: !!data.cursor,
  };
}

async function getRecommend(
  page: number,
  pageSize: number
): Promise<{
  list: NetLiveRoom[];
  hasMore: boolean;
}> {
  /**
   * cells 是 cursor 分页
   * 这里简单处理：
   * page=1 正常
   * page>1 暂不支持
   */

  if (page > 1) {
    return {
      list: [],
      hasMore: false,
    };
  }

  const data = await fetchCells({
    tab: "hot_opt",
    count: Math.max(pageSize, 20),
  });

  return {
    list: data.list,
    hasMore: data.hasMore,
  };
}

/* ─────────────── 分类 ─────────────── */

const PRESET_CATEGORIES: NetLiveCategory[] = [
  {
    id: "hot_opt",
    name: "热门",
  },
  {
    id: "nearby_opt",
    name: "附近",
  },
  {
    id: "follow_opt",
    name: "关注",
  },
];

async function getCategories(): Promise<NetLiveCategory[]> {
  return PRESET_CATEGORIES;
}

async function getCategoryRooms(
  categoryId: string,
  page: number
): Promise<{
  list: NetLiveRoom[];
  hasMore: boolean;
}> {
  if (page > 1) {
    return {
      list: [],
      hasMore: false,
    };
  }

  const data = await fetchCells({
    tab: categoryId,
    count: 20,
  });

  return {
    list: data.list,
    hasMore: data.hasMore,
  };
}

/* ─────────────── 搜索 ─────────────── */

async function search(
  keyword: string,
  _page: number
): Promise<{
  list: NetLiveRoom[];
  hasMore: boolean;
}> {
  /**
   * 17Live 公开搜索接口已基本废
   * 临时方案：
   * 热门流里过滤
   */

  const data = await fetchCells({
    tab: "hot_opt",
    count: 50,
  });

  const kw = keyword.toLowerCase();

  const list = data.list.filter((r) => {
    return (
      r.title?.toLowerCase().includes(kw) ||
      r.uname?.toLowerCase().includes(kw)
    );
  });

  return {
    list,
    hasMore: false,
  };
}

/* ─────────────── detail ─────────────── */

async function fetchRoom(roomId: string): Promise<SvStream | null> {
  const data = await fetchCells({
    tab: "hot_opt",
    count: 50,
  });

  for (const room of data.list) {
    if (room.roomId === roomId) {
      const cells = await getJson<SvCellsResp>(
        "https://wap-api.17app.co/api/v1/cells?count=50&cursor=&paging=1&region=SG&tab=hot_opt"
      );

      for (const cell of cells.cells ?? []) {
        if (cell.stream?.userInfo?.userID === roomId) {
          return cell.stream;
        }
      }
    }
  }

  return null;
}

async function getRoomDetail(
  roomId: string
): Promise<NetLiveRoom> {
  const stream = await fetchRoom(roomId);

  if (!stream) {
    throw new Error(`17Live 房间 ${roomId} 未找到`);
  }

  const room = mapStream(stream);

  if (!room) {
    throw new Error(`17Live 房间 ${roomId} 解析失败`);
  }

  return room;
}

async function getLiveStatus(
  roomId: string
): Promise<boolean> {
  const stream = await fetchRoom(roomId);

  return stream?.status === 2;
}

/* ─────────────── resolve ─────────────── */

function flvToHls(url: string): string {
  if (url.includes("wansu")) {
    return url.replace(".flv", "/playlist.m3u8");
  }

  return url
    .replace("pull-rtmp", "pull-hls")
    .replace(".flv", ".m3u8");
}

async function resolve(
  roomId: string
): Promise<NetLiveStream> {
  const stream = await fetchRoom(roomId);

  if (!stream) {
    throw new Error(`17Live 房间 ${roomId} 未找到`);
  }

  if (stream.status !== 2) {
    throw new Error("17Live 未开播");
  }

  const urls =
    stream.pullURLsInfo?.rtmpURLs ??
    stream.rtmpUrls ??
    [];

  if (urls.length === 0) {
    throw new Error("17Live 未返回流地址");
  }

  const best =
    urls.find((v) => !!v.urlQualityEnhancedHD) ??
    urls[0];

  const flvUrl =
    best.urlQualityEnhancedHD ??
    best.urlHighQuality ??
    best.url ??
    best.urlLowQuality;

  if (!flvUrl) {
    throw new Error("17Live FLV 地址为空");
  }

  const hlsUrl = flvToHls(flvUrl);

  const alternatives = urls
    .map((v) => {
      const u =
        v.urlQualityEnhancedHD ??
        v.urlHighQuality ??
        v.url;

      if (!u) return null;

      return {
        qn: String(v.provider ?? "auto"),
        label: `线路 ${v.provider ?? "auto"}`,
        url: flvToHls(u),
      };
    })
    .filter(
      (
        v
      ): v is {
        qn: string;
        label: string;
        url: string;
      } => !!v
    );

  return {
    url: hlsUrl,

    streamType: "hls",

    qn: "origin",

    qnLabel: "原画",

    alternatives,

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