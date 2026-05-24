/**
 * Trovo 直播 adapter —— 2026 可用稳定版
 *
 * 推荐：
 *   live_PcHomePageV2Service_GetPcMoreFeeds
 *
 * 搜索：
 *   search_SearchService_Search
 *
 * 详情：
 *   live_LiveReaderService_GetLiveInfo
 */

import { createPlatformFetch } from "@/lib/netlive/scriptFetch";
const scriptFetch = createPlatformFetch("trovo");

import type {
  NetLiveAdapter,
  NetLiveCategory,
  NetLiveRoom,
  NetLiveStream,
} from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const REFERER = "https://trovo.live/";

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,

  Referer: REFERER,

  Origin: "https://trovo.live",

  Accept: "application/json, text/plain, */*",

  "Content-Type": "application/json",

  "Accept-Language": "en-US,en;q=0.9",

  // 非常重要
  "Accept-Encoding": "identity",
};

/* ───────────────────────────────────────────── */

async function safeJson<T>(res: Response): Promise<T> {
  const text = await res.text();

  if (!text || !text.trim()) {
    throw new Error("Trovo 返回空响应");
  }

  // gzip 未解压
  if (text.charCodeAt(0) === 0x1f) {
    throw new Error(
      "Trovo 返回 gzip 压缩数据（fetch 未自动解压）"
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(
      `Trovo JSON 解析失败: ${(e as Error).message}\n` +
        `响应前200字符:\n${text.slice(0, 200)}`
    );
  }
}

function generateQid(): string {
  const bytes = new Uint8Array(8);

  crypto.getRandomValues(bytes);

  let s = "";

  for (const b of bytes) {
    s += b.toString(16).padStart(2, "0");
  }

  return s.toUpperCase();
}

/* ───────────────────────────────────────────── */
/* 推荐列表 */
/* ───────────────────────────────────────────── */

interface TvFeedItem {
  resultType?: string;

  liveInfo?: {
    userInfo?: {
      uid?: number;

      nickName?: string;

      faceUrl?: string;

      userName?: string;

      countryCode?: string;
    };

    categoryInfo?: {
      id?: string;

      name?: string;

      shortName?: string;
    };

    programInfo?: {
      programID?: string;

      title?: string;

      coverUrl?: string;

      streamInfo?: Array<{
        playUrl?: string;

        desc?: string;

        bitrate?: number;
      }>;
    };

    channelInfo?: {
      channelID?: number;

      viewers?: number;

      title?: string;
    };

    spaceInfo?: {
      roomID?: number;
    };
  };
}

interface TvFeedResp {
  data?: {
    live_PcHomePageV2Service_GetPcMoreFeeds?: {
      feeds?: {
        feeds?: TvFeedItem[];
      };
    };
  };
}

function mapFeedRoom(
  item: TvFeedItem
): NetLiveRoom | undefined {

  const live = item.liveInfo;

  if (!live) return undefined;

  const user = live.userInfo;

  const channel = live.channelInfo;

  const program = live.programInfo;

  const category = live.categoryInfo;

  const slug = user?.userName;

  if (!slug) return undefined;

  return {
    platform: "trovo",

    roomId: slug,

    title:
      channel?.title ||
      program?.title ||
      user?.nickName ||
      slug,

    uname:
      user?.nickName ||
      slug,

    avatar:
      user?.faceUrl,

    cover:
      program?.coverUrl,

    online:
      channel?.viewers ?? 0,

    category:
      category?.shortName ||
      category?.name,

    live: true,

    link: `https://trovo.live/s/${slug}`,
  };
}

async function getRecommend(
  page: number,
  pageSize: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {

  const limit = Math.max(pageSize, 20);

  const offset = Math.max(
    0,
    (page - 1) * limit
  );

  const qid = generateQid();

  const url =
    `https://api-web.trovo.live/graphql` +
    `?chunk=1` +
    `&reqms=${Date.now()}` +
    `&qid=${qid}` +
    `&cli=4` +
    `&from=%2Flive` +
    `&locale=en-US`;

  const body = [
    {
      operationName:
        "live_PcHomePageV2Service_GetPcMoreFeeds",

      variables: {
        params: {
          pageSize: limit,

          currPage: page,

          offset,
        },
      },
    },
  ];

  const res = await scriptFetch(url, {
    method: "POST",

    headers: COMMON_HEADERS,

    body: JSON.stringify(body),

    timeout: 25000,

    http2: true,
  });

  if (!res.ok) {
    throw new Error(`Trovo HTTP ${res.status}`);
  }

  const arr = await safeJson<TvFeedResp[]>(res);

  const feeds =
    arr?.[0]
      ?.data
      ?.live_PcHomePageV2Service_GetPcMoreFeeds
      ?.feeds
      ?.feeds ?? [];

  const list = feeds
    .map(mapFeedRoom)
    .filter(
      (r): r is NetLiveRoom => !!r
    );

  return {
    list,
    hasMore: feeds.length >= limit,
  };
}

/* ───────────────────────────────────────────── */
/* 分类 */
/* ───────────────────────────────────────────── */

const PRESET_CATEGORIES: NetLiveCategory[] = [
  { id: "Just Chatting", name: "聊天" },

  { id: "Music", name: "音乐" },

  { id: "PUBG", name: "PUBG" },

  { id: "VALORANT", name: "Valorant" },

  { id: "Minecraft", name: "Minecraft" },

  { id: "League of Legends", name: "LoL" },

  { id: "CS2", name: "CS2" },

  { id: "GTA V", name: "GTA V" },
];

async function getCategories(): Promise<
  NetLiveCategory[]
> {
  return PRESET_CATEGORIES;
}

async function getCategoryRooms(
  categoryId: string,
  page: number
): Promise<{
  list: NetLiveRoom[];
  hasMore: boolean;
}> {
  return search(categoryId, page);
}

/* ───────────────────────────────────────────── */
/* 搜索 */
/* ───────────────────────────────────────────── */

interface TvSearchStreamer {
  userInfo?: {
    uid?: number;

    userName?: string;

    nickName?: string;

    faceUrl?: string;
  };

  programInfo?: {
    title?: string;

    coverUrl?: string;
  };

  categoryInfo?: {
    shortName?: string;

    name?: string;
  };

  channelInfo?: {
    viewers?: number;
  };

  isLive?: number;
}

interface TvSearchResp {
  data?: {
    search_SearchService_Search?: {
      streamerData?: {
        streamerInfos?: TvSearchStreamer[];
      };
    };
  };
}

async function search(
  keyword: string,
  page: number
): Promise<{
  list: NetLiveRoom[];
  hasMore: boolean;
}> {

  const pageSize = 20;

  const offset = Math.max(
    0,
    (page - 1) * pageSize
  );

  const qid = generateQid();

  const url =
    `https://api-web.trovo.live/graphql` +
    `?qid=${qid}`;

  const body = [
    {
      operationName:
        "search_SearchService_Search",

      variables: {
        params: {
          query: keyword,

          limit: pageSize,

          offset,
        },
      },
    },
  ];

  const res = await scriptFetch(url, {
    method: "POST",

    headers: COMMON_HEADERS,

    body: JSON.stringify(body),

    timeout: 25000,

    http2: true,
  });

  if (!res.ok) {
    throw new Error(`Trovo HTTP ${res.status}`);
  }

  const arr =
    await safeJson<TvSearchResp[]>(res);

  const streamers =
    arr?.[0]
      ?.data
      ?.search_SearchService_Search
      ?.streamerData
      ?.streamerInfos ?? [];

  const list: NetLiveRoom[] = [];

  const seen = new Set<string>();

  for (const s of streamers) {

    const slug = s.userInfo?.userName;

    if (!slug) continue;

    if (seen.has(slug)) continue;

    seen.add(slug);

    list.push({
      platform: "trovo",

      roomId: slug,

      title:
        s.programInfo?.title ||
        s.userInfo?.nickName ||
        slug,

      uname:
        s.userInfo?.nickName ||
        slug,

      avatar:
        s.userInfo?.faceUrl,

      cover:
        s.programInfo?.coverUrl,

      online:
        s.channelInfo?.viewers ?? 0,

      category:
        s.categoryInfo?.shortName ||
        s.categoryInfo?.name,

      live:
        s.isLive === 1,

      link:
        `https://trovo.live/s/${slug}`,
    });
  }

  return {
    list,
    hasMore:
      streamers.length >= pageSize,
  };
}

/* ───────────────────────────────────────────── */
/* 房间详情 */
/* ───────────────────────────────────────────── */

interface TvGqlLiveInfo {
  streamerInfo: {
    userName: string;

    nickName?: string;

    faceUrl?: string;
  };

  categoryInfo: {
    shortName?: string;

    name?: string;
  };

  programInfo: {
    title?: string;

    coverUrl?: string;

    streamInfo?: Array<{
      desc?: string;

      playUrl?: string;

      bitrate?: number;
    }>;
  };

  watchedNum?: number;

  isLive?: number;
}

interface TvGqlEnvelope {
  data?: {
    live_LiveReaderService_GetLiveInfo?: TvGqlLiveInfo;
  };

  errors?: Array<{
    message: string;
  }>;
}

async function fetchGraphQLLive(
  userName: string
): Promise<TvGqlLiveInfo | null> {

  const qid = generateQid();

  const body = [
    {
      operationName:
        "live_LiveReaderService_GetLiveInfo",

      variables: {
        params: {
          userName,
        },
      },
    },
  ];

  const res = await scriptFetch(
    `https://api-web.trovo.live/graphql?qid=${qid}`,
    {
      method: "POST",

      headers: COMMON_HEADERS,

      body: JSON.stringify(body),

      timeout: 25000,

      http2: true,
    }
  );

  if (!res.ok) {
    throw new Error(
      `Trovo GraphQL HTTP ${res.status}`
    );
  }

  const arr =
    await safeJson<TvGqlEnvelope[]>(res);

  if (!Array.isArray(arr)) {
    throw new Error(
      "Trovo GraphQL 返回格式错误"
    );
  }

  const env = arr[0];

  if (env?.errors?.length) {
    throw new Error(
      env.errors
        .map((e) => e.message)
        .join("; ")
    );
  }

  return (
    env?.data
      ?.live_LiveReaderService_GetLiveInfo ??
    null
  );
}

function mapGqlLive(
  g: TvGqlLiveInfo,
  slug: string
): NetLiveRoom {

  return {
    platform: "trovo",

    roomId: slug,

    title:
      g.programInfo?.title ||
      slug,

    uname:
      g.streamerInfo?.nickName ||
      slug,

    avatar:
      g.streamerInfo?.faceUrl,

    cover:
      g.programInfo?.coverUrl,

    online:
      g.watchedNum ?? 0,

    category:
      g.categoryInfo?.shortName ||
      g.categoryInfo?.name,

    live:
      g.isLive === 1,

    link:
      `https://trovo.live/s/${slug}`,
  };
}

async function getRoomDetail(
  roomId: string
): Promise<NetLiveRoom> {

  const g =
    await fetchGraphQLLive(roomId);

  if (!g) {
    throw new Error(
      `Trovo 房间 ${roomId} 未找到`
    );
  }

  return mapGqlLive(g, roomId);
}

async function getLiveStatus(
  roomId: string
): Promise<boolean> {

  try {
    const g =
      await fetchGraphQLLive(roomId);

    return g?.isLive === 1;
  } catch {
    return false;
  }
}

/* ───────────────────────────────────────────── */
/* resolve */
/* ───────────────────────────────────────────── */

async function resolve(
  roomId: string
): Promise<NetLiveStream> {

  const g =
    await fetchGraphQLLive(roomId);

  if (!g) {
    throw new Error(
      `Trovo 房间 ${roomId} 未找到`
    );
  }

  if (g.isLive !== 1) {
    throw new Error("Trovo 未开播");
  }

  const streams =
    g.programInfo?.streamInfo ?? [];

  if (streams.length === 0) {
    throw new Error(
      "Trovo streamInfo 为空"
    );
  }

  const variants = streams
    .filter((s) => !!s.playUrl)
    .map((s) => {

      let url = s.playUrl!;

      if (url.startsWith("//")) {
        url = `https:${url}`;
      }

      url = url.replace(
        ".flv?",
        ".m3u8?"
      );

      return {
        qn:
          s.desc ||
          String(s.bitrate ?? 0),

        label:
          s.desc ||
          `${s.bitrate ?? 0}kbps`,

        bitrate:
          s.bitrate ?? 0,

        url,
      };
    });

  if (variants.length === 0) {
    throw new Error(
      "Trovo 无可用流"
    );
  }

  variants.sort(
    (a, b) =>
      (b.bitrate ?? 0) -
      (a.bitrate ?? 0)
  );

  const best = variants[0];

  return {
    url: best.url,

    streamType: "hls",

    qn: best.qn,

    qnLabel: best.label,

    alternatives:
      variants.length > 1
        ? variants.map((v) => ({
            qn: v.qn,

            label: v.label,

            url: v.url,
          }))
        : undefined,

    referer: REFERER,

    ua: UA,
  };
}

/* ───────────────────────────────────────────── */
/* 导出 */
/* ───────────────────────────────────────────── */

export const trovoAdapter: NetLiveAdapter = {

  platform: "trovo",

  getRecommend,

  search,

  resolve,

  getCategories,

  getCategoryRooms,

  getRoomDetail,

  getLiveStatus,
};