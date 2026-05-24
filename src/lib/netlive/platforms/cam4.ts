/**
 * Cam4 (cam4.com) —— GraphQL `getGenderPreferencePageData` listing(2026-05 用户实测抓包确认)。
 *
 * 真实 API:
 *
 *   POST https://cam4.com/graph?operation=getGenderPreferencePageData&ssr=false
 *   Content-Type: application/json
 *   Body: { operationName, variables: { input: { orderBy, filters, gender, cursor: {first, offset} }, keys }, query }
 *
 *   响应:data.broadcasts.{ total, items[] },每条 BroadcastItem 含:
 *     - username (string,直播间 slug)
 *     - country (ISO2 国家码)
 *     - profileImageURL (头像)
 *     - preview.src (HLS URL)、preview.poster (封面)、preview.sourceType ("hls")
 *     - viewers (number)
 *     - showType ("PUBLIC_SHOW" 公开 / "PRIVATE_SHOW" 私密)
 *     - broadcastType ("female"/"male_female_group"/"trans" 等)
 *     - gender ("female"/"male"/...)
 *     - tags[] (含 name/slug/i18nValue)
 *
 * 重要:每条 BroadcastItem 直接带 preview.src(HLS m3u8)—— 不需要 streamInfo
 * 二次请求。`resolve` 时如果是 listing 已缓存命中,可直接复用;否则单条 GraphQL
 * 查一遍同 endpoint 拿。
 *
 * 分页:variables.input.cursor.offset 增加 60。total 字段可知总数。
 * 分类:variables.input.gender 取 "female"/"male"/"male_female"/"trans"。
 */

import { createPlatformFetch } from "@/lib/netlive/scriptFetch";
const scriptFetch = createPlatformFetch("cam4");

import type {
  NetLiveAdapter,
  NetLiveCategory,
  NetLiveRoom,
  NetLiveStream,
} from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const REFERER = "https://www.cam4.com/";
const ORIGIN = "https://www.cam4.com";
const GRAPH_URL = "https://cam4.com/graph?operation=getGenderPreferencePageData&ssr=false";

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Referer: REFERER,
  Origin: ORIGIN,
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Content-Type": "application/json",
};

/* ─────────────── types ─────────────── */

interface C4Tag {
  name?: string;
  slug?: string;
  i18nValue?: string;
}

interface C4Broadcast {
  id?: string;
  username?: string;
  country?: string;
  gender?: string;
  viewers?: number;
  broadcastType?: string;
  showType?: string;
  sexualOrientation?: string;
  profileImageURL?: string;
  tags?: C4Tag[];
  preview?: {
    sourceType?: string;
    src?: string;
    poster?: string;
    orientation?: string;
  };
}

interface C4GraphResp {
  data?: {
    broadcasts?: {
      total?: number;
      items?: C4Broadcast[];
    };
  };
  errors?: Array<{ message?: string }>;
}

/** Cam4 gender 取值。 */
type C4Gender = "female" | "male" | "male_female" | "trans";

/* ─────────────── GraphQL query(原文照搬用户抓包,改动需重新抓) ─────────────── */

const GRAPH_QUERY = `query getGenderPreferencePageData($input: BroadcastsInput, $keys: [String!]) {
  i18n {
    id
    values: translate(keys: $keys)
    __typename
  }
  user {
    id
    accessControl {
      id
      isLogged
      isGuest
      isGold
      isSFWMode
      __typename
    }
    isBroadcastApproved
    savedFilters {
      id
      name
      gender
      filters {
        id
        name
        category
        slug
        i18nKey
        i18nValue
        __typename
      }
      __typename
    }
    userModals {
      action
      count
      dateAdded
      modalType
      updatedAt
      __typename
    }
    __typename
  }
  appData {
    id
    banner {
      id
      isVisible
      title
      titleColor
      body
      bodyColor
      backgroundURL
      actionURL
      __typename
    }
    __typename
  }
  broadcasts(input: $input) {
    total
    items {
      ... on BroadcastItem {
        id
        username
        country
        sexualOrientation
        profileImageURL
        preview {
          sourceType
          src
          poster
          orientation
          __typename
        }
        viewers
        verified
        broadcastType
        showType
        hasNewBroadcasterBadge
        hasLiveTouchBadge
        hasBoostBadge
        hasDailyAwardBadge
        hasViewerCountBadge
        realCountry
        gender
        tags {
          name
          slug
          i18nKey
          i18nValue
          __typename
        }
        __typename
      }
      __typename
    }
    order {
      name
      i18nKey
      i18nValue
      value
      __typename
    }
    filterCategories {
      id
      name
      i18nKey
      i18nValue
      __typename
    }
    filters {
      id
      category
      i18nValue
      name
      slug
      __typename
    }
    tags {
      name
      slug
      i18nValue
      __typename
    }
    __typename
  }
}`;

// i18n keys 直接照搬抓包样本,服务端只用来填 i18n 字符串,影响不大但保险
const GRAPH_KEYS = [
  "directory.tab.female",
  "profile.profile.gender.female",
  "metatags.metatags.female.h1",
  "directory.h1.title.female.top",
];

async function fetchGraph(
  gender: C4Gender,
  offset: number,
  first: number,
): Promise<{ items: C4Broadcast[]; total: number }> {
  const body = {
    operationName: "getGenderPreferencePageData",
    variables: {
      input: {
        orderBy: "trending",
        filters: [],
        gender,
        cursor: { first, offset },
      },
      keys: GRAPH_KEYS,
    },
    query: GRAPH_QUERY,
  };

  const res = await scriptFetch(GRAPH_URL, {
    method: "POST",
    headers: COMMON_HEADERS,
    body: JSON.stringify(body),
    timeout: 25_000,
    http2: true,
  });
  if (!res.ok) throw new Error(`Cam4 graph HTTP ${res.status}`);
  const text = await res.text();
  if (!text.trim()) throw new Error("Cam4 graph 返回空 body");
  let json: C4GraphResp;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(
      `Cam4 graph JSON 解析失败: ${(e as Error).message} - ${text.slice(0, 200)}`,
    );
  }
  if (json.errors?.length) {
    throw new Error(`Cam4 graph errors: ${json.errors.map((e) => e.message).join(",")}`);
  }
  return {
    items: json.data?.broadcasts?.items ?? [],
    total: json.data?.broadcasts?.total ?? 0,
  };
}

/* ─────────────── mapper ─────────────── */

function mapRoom(x: C4Broadcast): NetLiveRoom | undefined {
  const slug = x.username;
  if (!slug) return undefined;
  return {
    platform: "cam4",
    roomId: slug,
    title:
      x.tags
        ?.map((t) => t.i18nValue || t.name)
        .filter(Boolean)
        .slice(0, 3)
        .join(", ") || slug,
    uname: slug,
    avatar: x.profileImageURL,
    cover: x.preview?.poster || x.profileImageURL,
    online: x.viewers ?? 0,
    category: x.broadcastType || x.gender,
    live: x.showType === "PUBLIC_SHOW",
    link: `https://www.cam4.com/${encodeURIComponent(slug)}`,
  };
}

/* ─────────────── 缓存(短期,用于 resolve 命中 listing 拿 preview.src) ─────────────── */

interface CacheEntry {
  at: number;
  items: C4Broadcast[];
}
const cache = new Map<string, CacheEntry>(); // key = `${gender}@${offset}`
const CACHE_TTL_MS = 60_000;

function cacheKey(gender: C4Gender, offset: number) {
  return `${gender}@${offset}`;
}

async function fetchPage(
  gender: C4Gender,
  offset: number,
  first: number,
): Promise<{ items: C4Broadcast[]; total: number }> {
  const key = cacheKey(gender, offset);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return { items: cached.items, total: -1 };
  }
  const res = await fetchGraph(gender, offset, first);
  cache.set(key, { at: now, items: res.items });
  return res;
}

/* ─────────────── 推荐 ─────────────── */

async function getRecommend(
  page: number,
  pageSize: number,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const p = Math.max(1, page);
  const ps = Math.max(1, Math.min(pageSize, 60));
  const offset = (p - 1) * ps;
  const { items, total } = await fetchPage("female", offset, ps);
  const list = items.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
  const realTotal = total > 0 ? total : offset + list.length + (list.length === ps ? 1 : 0);
  return { list, hasMore: offset + list.length < realTotal };
}

/* ─────────────── 分类 ─────────────── */

const PRESET_CATEGORIES: NetLiveCategory[] = [
  { id: "female", name: "女性" },
  { id: "male", name: "男性" },
  { id: "male_female", name: "情侣/组合" },
  { id: "trans", name: "TS" },
];

async function getCategories(): Promise<NetLiveCategory[]> {
  return PRESET_CATEGORIES;
}

function categoryToGender(categoryId: string): C4Gender {
  switch (categoryId) {
    case "male":
      return "male";
    case "male_female":
    case "couple":
      return "male_female";
    case "trans":
      return "trans";
    default:
      return "female";
  }
}

async function getCategoryRooms(
  categoryId: string,
  page: number,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const gender = categoryToGender(categoryId);
  const pageSize = 60;
  const p = Math.max(1, page);
  const offset = (p - 1) * pageSize;
  const { items, total } = await fetchPage(gender, offset, pageSize);
  const list = items.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
  const realTotal = total > 0 ? total : offset + list.length + (list.length === pageSize ? 1 : 0);
  return { list, hasMore: offset + list.length < realTotal };
}

/* ─────────────── 搜索 ─────────────── */

async function search(
  keyword: string,
  page: number,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  // Cam4 GraphQL 没暴露 search keyword 入口(filters 数组是预定义类别)
  // 退而求其次:拉 1 页 female + 1 页 male,在 username/tag 上 substring 过滤
  const kw = keyword.trim().toLowerCase();
  if (!kw) return { list: [], hasMore: false };
  const [f, m] = await Promise.all([
    fetchPage("female", 0, 60),
    fetchPage("male", 0, 60),
  ]);
  const all = [...f.items, ...m.items];
  const matched = all.filter((x) => {
    if (x.username?.toLowerCase().includes(kw)) return true;
    return (
      x.tags?.some((t) =>
        (t.slug || t.name || "").toLowerCase().includes(kw),
      ) ?? false
    );
  });
  const pageSize = 20;
  const start = (Math.max(1, page) - 1) * pageSize;
  const slice = matched.slice(start, start + pageSize);
  return {
    list: slice.map(mapRoom).filter((r): r is NetLiveRoom => !!r),
    hasMore: start + pageSize < matched.length,
  };
}

/* ─────────────── room detail ─────────────── */

function findInCache(slug: string): C4Broadcast | undefined {
  const lower = slug.toLowerCase();
  for (const e of cache.values()) {
    const hit = e.items.find((x) => x.username?.toLowerCase() === lower);
    if (hit) return hit;
  }
  return undefined;
}

async function getRoomDetail(roomId: string): Promise<NetLiveRoom> {
  const hit = findInCache(roomId);
  if (hit) {
    const room = mapRoom(hit);
    if (room) return room;
  }
  // 缓存没命中 —— 走 listing 第一页 female 找一下;再没找到就拼骨架
  try {
    const { items } = await fetchPage("female", 0, 60);
    const found = items.find((x) => x.username?.toLowerCase() === roomId.toLowerCase());
    if (found) {
      const room = mapRoom(found);
      if (room) return room;
    }
  } catch {
    /* ignore */
  }
  return {
    platform: "cam4",
    roomId,
    title: roomId,
    uname: roomId,
    live: await getLiveStatus(roomId),
    link: `https://www.cam4.com/${encodeURIComponent(roomId)}`,
  };
}

/* ─────────────── live status ─────────────── */

async function getLiveStatus(roomId: string): Promise<boolean> {
  // 优先用 cache(listing 命中即代表 live)
  if (findInCache(roomId)) return true;
  // 退而求其次:hu.cam4.com REST per-user(StreaMonitor 路径)
  try {
    const info = await scriptFetch(
      `https://hu.cam4.com/rest/v1.0/profile/${encodeURIComponent(roomId)}/info`,
      {
        method: "GET",
        headers: COMMON_HEADERS,
        timeout: 15_000,
        http2: true,
      },
    );
    if (!info.ok) return false;
    const data = (await info.json<{ online?: boolean }>()) ?? {};
    return data.online === true;
  } catch {
    return false;
  }
}

/* ─────────────── resolve ─────────────── */

async function resolve(roomId: string): Promise<NetLiveStream> {
  // 路径 1:listing cache 命中,直接用 preview.src
  const hit = findInCache(roomId);
  if (hit?.preview?.src) {
    if (hit.showType && hit.showType !== "PUBLIC_SHOW") {
      throw new Error(`Cam4 主播 ${roomId} 当前 ${hit.showType}(非公开)`);
    }
    return {
      url: hit.preview.src,
      streamType: "hls",
      qn: "auto",
      qnLabel: "自适应",
      referer: REFERER,
      ua: UA,
    };
  }

  // 路径 2:cache 没命中,在 female / male 两种 gender listing 各拉一页找一下
  for (const g of ["female", "male", "male_female", "trans"] as C4Gender[]) {
    try {
      const { items } = await fetchPage(g, 0, 60);
      const found = items.find((x) => x.username?.toLowerCase() === roomId.toLowerCase());
      if (found?.preview?.src) {
        return {
          url: found.preview.src,
          streamType: "hls",
          qn: "auto",
          qnLabel: "自适应",
          referer: REFERER,
          ua: UA,
        };
      }
    } catch {
      /* try next gender */
    }
  }

  // 路径 3:fallback 走 StreaMonitor 路径(hu.cam4.com profile/streamInfo)
  const info = await scriptFetch(
    `https://hu.cam4.com/rest/v1.0/profile/${encodeURIComponent(roomId)}/info`,
    { method: "GET", headers: COMMON_HEADERS, timeout: 15_000, http2: true },
  );
  if (info.status === 403) throw new Error(`Cam4 主播 ${roomId} 受限(地区/国家)`);
  if (!info.ok) throw new Error(`Cam4 info HTTP ${info.status}`);
  const infoData = (await info.json<{ online?: boolean }>()) ?? {};
  if (!infoData.online) throw new Error(`Cam4 主播 ${roomId} 不在线`);

  const stream = await scriptFetch(
    `https://hu.cam4.com/rest/v1.0/profile/${encodeURIComponent(roomId)}/streamInfo`,
    { method: "GET", headers: COMMON_HEADERS, timeout: 20_000, http2: true },
  );
  if (stream.status === 204) throw new Error(`Cam4 主播 ${roomId} 离线`);
  if (!stream.ok) throw new Error(`Cam4 streamInfo HTTP ${stream.status}`);
  const sd = (await stream.json<{ cdnURL?: string }>()) ?? {};
  if (!sd.cdnURL) throw new Error("Cam4 未返回 cdnURL");
  return {
    url: sd.cdnURL,
    streamType: "hls",
    qn: "auto",
    qnLabel: "自适应",
    referer: REFERER,
    ua: UA,
  };
}

/* ─────────────── export ─────────────── */

export const cam4Adapter: NetLiveAdapter = {
  platform: "cam4",
  getRecommend,
  search,
  resolve,
  getCategories,
  getCategoryRooms,
  getRoomDetail,
  getLiveStatus,
};
