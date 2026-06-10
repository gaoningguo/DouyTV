/**
 * 豆瓣热门推荐 —— 用于点播页未输入关键词时的发现入口。
 *
 * 接口：豆瓣 j/search_subjects 公开端点。Tauri 下走 scriptFetch（Rust ureq）
 * 绕 CORS；浏览器 dev 直接 fetch（豆瓣本身不带 CORS header，可能挂）。
 */
import { scriptFetch } from "@/source-script/fetch";

export type DoubanKind = "movie" | "tv";

export interface DoubanItem {
  id: string;
  title: string;
  cover: string;
  poster?: string;
  rate: string; // 豆瓣评分字符串
  url?: string;
  year?: string;
  /** kind，方便后续逻辑识别（接口未返回，这里塞入） */
  kind: DoubanKind;
}

interface RawDoubanResponse {
  subjects: Array<{
    id: string;
    title: string;
    cover: string;
    rate: string;
    url: string;
  }>;
}

const DOUBAN_BASE = "https://movie.douban.com/j/search_subjects";
const DOUBAN_REXXAR_HOSTS = [
  "https://m.douban.cmliussss.net",
  "https://m.douban.cmliussss.com",
  "https://m.douban.com",
];
const DOUBAN_MOVIE_HOSTS = [
  "https://movie.douban.cmliussss.net",
  "https://movie.douban.cmliussss.com",
  "https://movie.douban.com",
];
const DOUBAN_CACHE_TTL_MS = 60 * 60 * 1000;
const DOUBAN_STORAGE_PREFIX = "douytv:douban-cache";

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const memoryCache = new Map<string, CacheEntry<unknown>>();

function isCacheFresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  return !!entry && entry.expiresAt > Date.now();
}

function readCache<T>(key: string): T | undefined {
  const memory = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (isCacheFresh(memory)) return memory.value;
  if (memory) memoryCache.delete(key);

  if (typeof window === "undefined") return undefined;
  const storageKey = `${DOUBAN_STORAGE_PREFIX}:${key}`;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (!isCacheFresh(parsed)) {
      window.localStorage.removeItem(storageKey);
      return undefined;
    }
    memoryCache.set(key, parsed);
    return parsed.value;
  } catch {
    return undefined;
  }
}

function writeCache<T>(key: string, value: T): void {
  const entry: CacheEntry<T> = {
    expiresAt: Date.now() + DOUBAN_CACHE_TTL_MS,
    value,
  };
  memoryCache.set(key, entry);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${DOUBAN_STORAGE_PREFIX}:${key}`, JSON.stringify(entry));
  } catch {
    // Ignore quota and private-mode failures.
  }
}

interface RawDoubanRecentHotResponse {
  total?: number;
  items?: Array<{
    id: string;
    title: string;
    card_subtitle?: string;
    year?: string;
    type?: string;
    pic?: {
      large?: string;
      normal?: string;
    };
    rating?: {
      value?: number;
    };
  }>;
}

interface RawDoubanRecommendResponse {
  total?: number;
  items?: Array<{
    id: string;
    title: string;
    year?: string;
    type?: string;
    pic?: {
      large?: string;
      normal?: string;
    };
    rating?: {
      value?: number;
    };
  }>;
}

export interface BangumiCalendarDay {
  weekday: {
    en: string;
  };
  items: Array<{
    id: number;
    name: string;
    name_cn?: string;
    air_date?: string;
    rating?: {
      score?: number;
    };
    images?: {
      large?: string;
      common?: string;
      medium?: string;
      small?: string;
      grid?: string;
    };
  }>;
}

async function requestJsonWithFallback<T>(
  urls: string[],
  errorPrefix: string
): Promise<T> {
  const cacheKey = `json:${urls[0] ?? ""}`;
  const cached = readCache<T>(cacheKey);
  if (cached) return cached;

  let lastError: unknown;
  for (const url of urls) {
    try {
      const res = await scriptFetch(url, {
        method: "GET",
        headers: {
          Referer: "https://movie.douban.com/",
          Accept: "application/json, text/plain, */*",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        },
        timeout: 10_000,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json<T>();
      writeCache(cacheKey, data);
      return data;
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`${errorPrefix}: ${(lastError as Error)?.message ?? String(lastError)}`);
}

function pickYear(...values: Array<string | undefined>): string {
  for (const value of values) {
    const year = value?.match(/\d{4}/)?.[0];
    if (year) return year;
  }
  return "";
}

function toDoubanItem(
  item: {
    id: string;
    title: string;
    card_subtitle?: string;
    year?: string;
    type?: string;
    pic?: { large?: string; normal?: string };
    rating?: { value?: number };
  },
  kind: DoubanKind
): DoubanItem {
  const poster = item.pic?.normal || item.pic?.large || "";
  return {
    id: item.id,
    title: item.title,
    cover: poster,
    poster,
    rate: item.rating?.value ? item.rating.value.toFixed(1) : "",
    year: pickYear(item.year, item.card_subtitle),
    kind,
  };
}

/**
 * 拉豆瓣热门 / 分类视频列表。
 *
 * @param kind   movie | tv
 * @param tag    豆瓣的"标签"（热门 / 最新 / 经典 / 美剧 / 日剧…）
 * @param limit  每页大小（默认 20）
 * @param start  起始偏移（分页用，0/20/40 …）
 */
export async function fetchDoubanList(
  kind: DoubanKind,
  tag: string = "热门",
  limit: number = 20,
  start: number = 0
): Promise<DoubanItem[]> {
  const cacheKey = `list:${kind}:${tag}:${limit}:${start}`;
  const cached = readCache<DoubanItem[]>(cacheKey);
  if (cached) return cached;

  const url = `${DOUBAN_BASE}?type=${kind}&tag=${encodeURIComponent(
    tag
  )}&sort=recommend&page_limit=${limit}&page_start=${start}`;
  const res = await scriptFetch(url, {
    method: "GET",
    headers: {
      Referer: "https://movie.douban.com/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    },
    timeout: 10_000,
  });
  if (!res.ok) throw new Error(`豆瓣返回 HTTP ${res.status}`);
  const text = await res.text();
  let parsed: RawDoubanResponse;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("豆瓣返回非 JSON（可能被反爬）");
  }
  const items = (parsed.subjects ?? []).map((s) => ({
    id: s.id,
    title: s.title,
    cover: s.cover,
    poster: s.cover,
    rate: s.rate,
    url: s.url,
    kind,
  }));
  writeCache(cacheKey, items);
  return items;
}

export async function fetchDoubanRecentHot({
  kind,
  category,
  type,
  limit = 20,
  start = 0,
}: {
  kind: DoubanKind;
  category: string;
  type: string;
  limit?: number;
  start?: number;
}): Promise<DoubanItem[]> {
  const qs = new URLSearchParams({
    start: String(start),
    limit: String(limit),
    category,
    type,
  });
  const urls = DOUBAN_REXXAR_HOSTS.map(
    (host) => `${host}/rexxar/api/v2/subject/recent_hot/${kind}?${qs.toString()}`
  );
  const data = await requestJsonWithFallback<RawDoubanRecentHotResponse>(
    urls,
    "获取豆瓣 recent_hot 失败"
  );
  return (data.items ?? []).map((item) => toDoubanItem(item, kind));
}

export async function fetchDoubanRecommends({
  kind,
  category = "",
  format = "",
  region = "",
  year = "",
  platform = "",
  label = "",
  sort = "",
  limit = 20,
  start = 0,
}: {
  kind: DoubanKind;
  category?: string;
  format?: string;
  region?: string;
  year?: string;
  platform?: string;
  label?: string;
  sort?: string;
  limit?: number;
  start?: number;
}): Promise<DoubanItem[]> {
  const clean = (value: string) => (value === "all" || value === "全部" ? "" : value);
  const nextCategory = clean(category);
  const nextFormat = clean(format);
  const selectedCategories: Record<string, string> = { 类型: nextCategory };
  if (nextFormat) selectedCategories["形式"] = nextFormat;
  if (region) selectedCategories["地区"] = clean(region);

  const tags = [
    nextCategory,
    !nextCategory ? nextFormat : "",
    clean(label),
    clean(region),
    clean(year),
    clean(platform),
  ].filter(Boolean);

  const qs = new URLSearchParams({
    refresh: "0",
    start: String(start),
    count: String(limit),
    selected_categories: JSON.stringify(selectedCategories),
    uncollect: "false",
    score_range: "0,10",
    tags: tags.join(","),
  });
  const normalizedSort = clean(sort);
  if (normalizedSort && normalizedSort !== "T") qs.set("sort", normalizedSort);

  const urls = DOUBAN_REXXAR_HOSTS.map(
    (host) => `${host}/rexxar/api/v2/${kind}/recommend?${qs.toString()}`
  );
  const data = await requestJsonWithFallback<RawDoubanRecommendResponse>(
    urls,
    "获取豆瓣 recommend 失败"
  );
  return (data.items ?? [])
    .filter((item) => item.type === "movie" || item.type === "tv")
    .map((item) => toDoubanItem(item, kind));
}

export async function fetchMoonDoubanList({
  kind,
  tag,
  limit = 20,
  start = 0,
}: {
  kind: DoubanKind;
  tag: string;
  limit?: number;
  start?: number;
}): Promise<DoubanItem[]> {
  const qs = new URLSearchParams({
    type: kind,
    tag,
    sort: "recommend",
    page_limit: String(limit),
    page_start: String(start),
  });
  const urls = DOUBAN_MOVIE_HOSTS.map((host) => `${host}/j/search_subjects?${qs.toString()}`);
  const data = await requestJsonWithFallback<RawDoubanResponse>(
    urls,
    "获取豆瓣 search_subjects 失败"
  );
  return (data.subjects ?? []).map((s) => ({
    id: s.id,
    title: s.title,
    cover: s.cover,
    poster: s.cover,
    rate: s.rate,
    url: s.url,
    kind,
  }));
}

export async function fetchBangumiCalendar(): Promise<BangumiCalendarDay[]> {
  const cacheKey = "bangumi:calendar";
  const cached = readCache<BangumiCalendarDay[]>(cacheKey);
  if (cached) return cached;

  const res = await scriptFetch("https://api.bgm.tv/calendar", {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    },
    timeout: 10_000,
  });
  if (!res.ok) throw new Error(`Bangumi 返回 HTTP ${res.status}`);
  const data = await res.json<BangumiCalendarDay[]>();
  writeCache(cacheKey, data);
  return data;
}

export async function fetchTodayBangumi(): Promise<DoubanItem[]> {
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const today = weekdays[new Date().getDay()];
  const calendar = await fetchBangumiCalendar();
  const day = calendar.find((item) => item.weekday.en === today);
  return (day?.items ?? [])
    .filter((item) => item.images)
    .map((item) => {
      const cover =
        item.images?.large ||
        item.images?.common ||
        item.images?.medium ||
        item.images?.small ||
        item.images?.grid ||
        "";
      return {
        id: String(item.id),
        title: item.name_cn || item.name,
        cover,
        poster: cover,
        rate: item.rating?.score ? item.rating.score.toFixed(1) : "",
        year: item.air_date?.split("-")?.[0] || "",
        kind: "tv" as const,
      };
    });
}

export async function fetchMoonHomeRecommendations(
  kind: DoubanKind,
  tag: string,
  limit = 24
): Promise<DoubanItem[]> {
  if (kind === "movie") {
    return fetchDoubanRecentHot({
      kind: "movie",
      category: tag || "热门",
      type: "全部",
      limit,
      start: 0,
    });
  }
  if (tag === "综艺") {
    return fetchDoubanRecentHot({
      kind: "tv",
      category: "show",
      type: "show",
      limit,
      start: 0,
    });
  }
  const tvTypeMap: Record<string, string> = {
    全部: "tv",
    国产: "tv_domestic",
    欧美: "tv_american",
    日本: "tv_japanese",
    韩国: "tv_korean",
    动漫: "tv_animation",
    纪录片: "tv_documentary",
  };
  return fetchDoubanRecentHot({
    kind: "tv",
    category: "tv",
    type: tvTypeMap[tag] || "tv",
    limit,
    start: 0,
  });
}

/** MoonTV 首页/豆瓣页常用标签预设 */
export const MOVIE_TAGS = ["热门", "最新", "豆瓣高分", "冷门佳片"];
export const TV_TAGS = ["全部", "国产", "欧美", "日本", "韩国", "动漫", "纪录片", "综艺"];
