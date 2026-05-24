/**
 * Bigo Live 直播 adapter —— 全球热门社交/热舞直播平台（新加坡，YY 旗下）。
 */

import { createPlatformFetch } from "@/lib/netlive/scriptFetch";
const scriptFetch = createPlatformFetch("bigo");

import type {
  NetLiveAdapter,
  NetLiveCategory,
  NetLiveRoom,
  NetLiveStream,
} from "../types";

import { NetLiveListUnsupportedError } from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const REFERER = "https://www.bigo.tv/";

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Referer: REFERER,
  Origin: "https://www.bigo.tv",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

const HTML_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Referer: REFERER,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

interface BgRoom {
  room_id?: string | number;
  bigo_id?: string | number;
  alias?: string;
  nick_name?: string;
  user_name?: string;
  room_topic?: string;

  cover_url?: string;
  big_url?: string;
  pic?: string;

  cover_l?: string;
  cover_m?: string;

  data1?: string;

  data2?: {
    gender?: string;
    bigUrl?: string;
  };

  user_count?: number;
  audience?: number;

  country?: string;
  language?: string;
  tag?: string;

  uid?: string | number;

  avatar_url?: string;
  avatar?: string;
}

interface BgListResp {
  code?: number;

  data?: {
    resCode?: string;

    data?: BgRoom[];

    list?: BgRoom[];

    rooms?: BgRoom[];
  };

  msg?: string;
}

function mapRoom(r: any): NetLiveRoom | undefined {
  const id =
    r.bigo_id ??
    r.uid ??
    r.alias ??
    r.room_id;

  if (id === undefined || id === null) {
    return undefined;
  }

  const slug = String(id);

  return {
    platform: "bigo",

    roomId: slug,

    title:
      r.room_topic ??
      r.nick_name ??
      r.user_name ??
      r.alias ??
      slug,

    uname:
      r.nick_name ??
      r.user_name ??
      r.alias ??
      slug,

    avatar:
      r.avatar_url ??
      r.avatar ??
      r.data1,

    cover:
      r.cover_l ??
      r.cover_m ??
      r.big_url ??
      r.cover_url ??
      r.pic ??
      r.data2?.bigUrl,

    online:
      r.user_count ??
      r.audience ??
      0,

    category:
      r.tag ??
      r.country ??
      r.language,

    live: true,

    link: `https://www.bigo.tv/${slug}`,
  };
}

async function postJson<T>(
  url: string,
  body: unknown
): Promise<T> {
  const res = await scriptFetch(url, {
    method: "POST",

    headers: {
      ...COMMON_HEADERS,
      "Content-Type": "application/json",
    },

    json: body,

    timeout: 25000,

    http2: true,
  });

  if (!res.ok) {
    throw new Error(`Bigo HTTP ${res.status}`);
  }

  return res.json<T>();
}

async function getJson<T>(
  url: string
): Promise<T> {
  const res = await scriptFetch(url, {
    method: "GET",

    headers: COMMON_HEADERS,

    timeout: 25000,

    http2: true,
  });

  if (!res.ok) {
    throw new Error(`Bigo HTTP ${res.status}`);
  }

  return res.json<T>();
}

async function fetchHtml(
  url: string
): Promise<string> {
  const res = await scriptFetch(url, {
    method: "GET",

    headers: HTML_HEADERS,

    timeout: 25000,

    http2: true,
  });

  if (!res.ok) {
    throw new Error(`Bigo HTTP ${res.status}`);
  }

  return res.text();
}

function extractInitState(
  html: string
): unknown | null {
  const m =
    html.match(
      /window\.__INIT_STATE__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/
    ) ||
    html.match(
      /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/
    );

  if (!m) {
    return null;
  }

  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/* ─────────────── 推荐 ─────────────── */

async function getRecommend(
  pageSize: number
): Promise<{
  list: NetLiveRoom[];
  hasMore: boolean;
}> {
  const limit = Math.max(pageSize, 24);

  const candidates = [
    `https://ta.bigo.tv/official_website/OInterfaceWeb/vedioList/5?fetchNum=${limit}`,
  ];

  const reasons: string[] = [];

  for (const url of candidates) {
    try {
      const data =
        await getJson<BgListResp>(url);

      console.log(
        "Bigo recommend raw:",
        data
      );

      const arr =
        data?.data?.data ??
        data?.data?.list ??
        data?.data?.rooms ??
        [];

      if (!Array.isArray(arr)) {
        reasons.push(
          `${url}: data 不是数组`
        );
        continue;
      }

      const list = arr
        .map(mapRoom)
        .filter(
          (r): r is NetLiveRoom => !!r
        );

      if (list.length > 0) {
        return {
          list,
          hasMore:
            arr.length >= limit,
        };
      }

      reasons.push(
        `${url}: 返回 0 条`
      );
    } catch (e) {
      reasons.push(
        `${url}: ${
          (e as Error).message ??
          String(e)
        }`
      );
    }
  }

  throw new NetLiveListUnsupportedError(
    "Bigo Live",
    reasons.join(" | ")
  );
}

/* ─────────────── 分类 ─────────────── */

const PRESET_CATEGORIES: NetLiveCategory[] =
  [
    { id: "0", name: "热门" },
    { id: "1", name: "热舞" },
    { id: "2", name: "颜值" },
    { id: "3", name: "唱见" },
    { id: "4", name: "脱口秀" },
    { id: "5", name: "派对" },
    { id: "6", name: "户外" },
    { id: "7", name: "游戏" },
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
  const limit = 24;

  const candidates = [
    `https://www.bigo.tv/oapi/v3/getNewListV2?page=${page}&size=${limit}&tabId=${encodeURIComponent(
      categoryId
    )}`,

    `https://ta.bigo.tv/official_website/studio/getNewListV3?page=${page}&pageSize=${limit}&tabId=${encodeURIComponent(
      categoryId
    )}`,
  ];

  for (const url of candidates) {
    try {
      const data =
        await getJson<BgListResp>(url);

      const arr =
        data?.data?.data ??
        data?.data?.list ??
        data?.data?.rooms ??
        [];

      if (
        Array.isArray(arr) &&
        arr.length > 0
      ) {
        const list = arr
          .map(mapRoom)
          .filter(
            (r): r is NetLiveRoom => !!r
          );

        return {
          list,
          hasMore:
            arr.length >= limit,
        };
      }
    } catch {
      // try next
    }
  }

  if (page === 1) {
    return getRecommend(limit);
  }

  return {
    list: [],
    hasMore: false,
  };
}

/* ─────────────── 搜索 ─────────────── */

interface BgSearchResp {
  data?: {
    list?: BgRoom[];
    users?: BgRoom[];
  };
}

async function search(
  keyword: string,
  _page: number
): Promise<{
  list: NetLiveRoom[];
  hasMore: boolean;
}> {
  try {
    const data =
      await postJson<BgSearchResp>(
        "https://ta.bigo.tv/official_website/studio/getSearchInfo",
        {
          keyword,
          page: 1,
          size: 30,
        }
      );

    const arr =
      data.data?.list ??
      data.data?.users ??
      [];

    const list = arr
      .map(mapRoom)
      .filter(
        (r): r is NetLiveRoom => !!r
      );

    return {
      list,
      hasMore: false,
    };
  } catch {
    return {
      list: [],
      hasMore: false,
    };
  }
}

/* ─────────────── 房间详情 ─────────────── */

interface BgPlayResp {
  data?: {
    hls_src?: string;

    roomId?: string;

    clientBigoId?: string;

    gameTitle?: string;

    roomTopic?: string;

    hls_url?: string;

    rtmp_url?: string;

    flv_url?: string;

    live?: number;

    big_url?: string;

    room_topic?: string;

    nick_name?: string;

    user_count?: number;

    avatar?: string;
  };

  code?: number;

  msg?: string;
}

async function fetchPlayInfo(
  roomId: string
): Promise<BgPlayResp> {
  const url =
    `https://ta.bigo.tv/official_website/studio/getInternalStudioInfo?siteId=${encodeURIComponent(
      roomId
    )}&verify=`;

  try {
    const res = await scriptFetch(
      url,
      {
        method: "POST",

        headers: {
          ...COMMON_HEADERS,
          "Content-Length": "0",
        },

        timeout: 25000,

        http2: true,
      }
    );

    if (!res.ok) {
      throw new Error(
        `Bigo HTTP ${res.status}`
      );
    }

    return res.json<BgPlayResp>();
  } catch {
    const html = await fetchHtml(
      `https://www.bigo.tv/${roomId}`
    );

    const state =
      extractInitState(html) as any;

    const ui =
      state?.pageStore
        ?.userInfoStore?.userInfo;

    if (!ui) {
      throw new Error(
        "Bigo 房间数据缺失"
      );
    }

    return {
      data: {
        hls_src: ui.live?.hls,

        big_url:
          ui.big_url ??
          ui.cover_url,

        room_topic:
          ui.room_topic,

        nick_name:
          ui.nick_name,

        user_count:
          ui.user_count,

        avatar:
          ui.avatar_url,
      },
    };
  }
}

async function getRoomDetail(
  roomId: string
): Promise<NetLiveRoom> {
  const info =
    await fetchPlayInfo(roomId);

  const d = info.data;

  if (!d) {
    throw new Error(
      `Bigo 房间 ${roomId} 未找到`
    );
  }

  return {
    platform: "bigo",

    roomId,

    title:
      d.roomTopic ??
      d.room_topic ??
      d.nick_name ??
      roomId,

    uname: d.nick_name,

    avatar: d.avatar,

    cover: d.big_url,

    online: d.user_count ?? 0,

    category: d.gameTitle,

    live: !!(
      d.hls_src ??
      d.hls_url
    ),

    link: `https://www.bigo.tv/${roomId}`,
  };
}

async function getLiveStatus(
  roomId: string
): Promise<boolean> {
  try {
    const info =
      await fetchPlayInfo(roomId);

    return !!(
      info.data?.hls_src ??
      info.data?.hls_url
    );
  } catch {
    return false;
  }
}

async function resolve(roomId: string): Promise<NetLiveStream> {
  const info = await fetchPlayInfo(roomId);

  const d = info.data;

  if (!d) {
    throw new Error(`Bigo 房间 ${roomId} 未找到`);
  }

  const url =
    d.hls_src ??
    d.hls_url ??
    d.flv_url ??
    d.rtmp_url;

  if (!url) {
    throw new Error("Bigo 未开播");
  }

  return {
    url,
    streamType: url.includes(".m3u8")
      ? "hls"
      : url.includes(".flv")
        ? "flv"
        : "mp4",

    qn: "auto",
    qnLabel: "原画",
  };
}

/* ─────────────── 导出 ─────────────── */

export const bigoAdapter: NetLiveAdapter =
  {
    platform: "bigo",

    getRecommend,

    search,

    resolve,

    getCategories,

    getCategoryRooms,

    getRoomDetail,

    getLiveStatus,
  };