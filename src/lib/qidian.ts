/**
 * 起点中文网发现源 —— 小说首页壳子的 推荐 / 榜单 / 完结 数据。
 *
 * 数据来源:移动站 m.qidian.com。桌面站 www.qidian.com 挂在 JS 反爬探针(probe.js)后,
 * 纯 HTTP 抓不到;移动站是 vite-plugin-ssr 应用,数据直接内联在页面的
 * <script id="vite-plugin-ssr_pageContext" type="application/json"> 里,解析这个 blob
 * 即可,零接口猜测、零签名。
 *
 * 走 scriptFetch(Tauri 下 Rust ureq 绕 CORS + 跟随全局代理),localStorage 1h 缓存。
 */
import { scriptFetch } from "@/source-script/fetch";
import type { DiscoverItem, DiscoverSection } from "./discover";

const BASE = "https://m.qidian.com";
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1";
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_PREFIX = "douytv:qidian-cache";

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const memoryCache = new Map<string, CacheEntry<unknown>>();

function readCache<T>(key: string): T | undefined {
  const mem = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (mem && mem.expiresAt > Date.now()) return mem.value;
  if (mem) memoryCache.delete(key);
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(`${CACHE_PREFIX}:${key}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (parsed.expiresAt <= Date.now()) {
      window.localStorage.removeItem(`${CACHE_PREFIX}:${key}`);
      return undefined;
    }
    memoryCache.set(key, parsed);
    return parsed.value;
  } catch {
    return undefined;
  }
}

function writeCache<T>(key: string, value: T): void {
  const entry: CacheEntry<T> = { expiresAt: Date.now() + CACHE_TTL_MS, value };
  memoryCache.set(key, entry);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${CACHE_PREFIX}:${key}`, JSON.stringify(entry));
  } catch {
    // 忽略配额 / 隐私模式失败
  }
}

/** 封面:起点书籍封面 CDN,按 bid 拼(300px)。 */
export function qidianCover(bid: string): string {
  return `https://bookcover.yuewen.com/qdbimg/349573/${bid}/300`;
}

/** 拉 m.qidian.com 某页,提取内联的 pageData。 */
async function fetchPageData(path: string): Promise<Record<string, unknown>> {
  const res = await scriptFetch(`${BASE}${path}`, {
    method: "GET",
    headers: { "User-Agent": UA, Referer: `${BASE}/` },
    timeout: 15_000,
  });
  if (!res.ok) throw new Error(`起点返回 HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(
    /<script id="vite-plugin-ssr_pageContext"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!m) throw new Error("起点页面结构变化(未找到 pageContext)");
  let ctx: unknown;
  try {
    ctx = JSON.parse(m[1]);
  } catch {
    throw new Error("起点 pageContext 解析失败");
  }
  const pageData = (ctx as { pageProps?: { pageData?: unknown }; pageContext?: { pageProps?: { pageData?: unknown } } })
    ?.pageContext?.pageProps?.pageData;
  if (!pageData || typeof pageData !== "object") {
    throw new Error("起点 pageData 缺失");
  }
  return pageData as Record<string, unknown>;
}

/** 起点原始书条目(各页字段略有差异,取交集)。 */
interface QidianRawBook {
  bid?: string | number;
  bName?: string;
  bAuth?: string;
  cat?: string;
  subCat?: string;
  desc?: string;
  cnt?: string;
  rankCnt?: string;
}

function toItem(raw: QidianRawBook): DiscoverItem | null {
  const bid = raw.bid != null ? String(raw.bid) : "";
  if (!bid || !raw.bName) return null;
  return {
    id: bid,
    title: raw.bName,
    cover: qidianCover(bid),
    author: raw.bAuth || undefined,
    cat: raw.subCat || raw.cat || undefined,
    desc: raw.desc || undefined,
    meta: raw.rankCnt || raw.cnt || undefined,
  };
}

function mapList(list: unknown): DiscoverItem[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((x) => toItem(x as QidianRawBook))
    .filter((x): x is DiscoverItem => x !== null);
}

/**
 * 首页推荐 —— m.qidian.com/ 的 popNovel(热门) + recRank(推荐榜) + limitFree(限免)。
 * 合并去重,取前 count 条。
 */
export async function fetchQidianRecommend(count = 24): Promise<DiscoverItem[]> {
  const cacheKey = `recommend:${count}`;
  const cached = readCache<DiscoverItem[]>(cacheKey);
  if (cached) return cached;
  const pd = await fetchPageData("/");
  const merged = [
    ...mapList(pd.popNovel),
    ...mapList(pd.recRank),
    ...mapList(pd.hotRank),
    ...mapList(pd.limitFree),
  ];
  const seen = new Set<string>();
  const items = merged
    .filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)))
    .slice(0, count);
  writeCache(cacheKey, items);
  return items;
}

/** 榜单类型 → m.qidian.com/rank/{key} 的 URL 段(实测有效 slug)。 */
export const QIDIAN_RANKS: Array<{ key: string; label: string }> = [
  { key: "yuepiao", label: "月票榜" },
  { key: "hotsales", label: "畅销榜" },
  { key: "newbook", label: "新书榜" },
  { key: "update", label: "更新榜" },
  { key: "rec", label: "推荐榜" },
];

/**
 * 榜单详情 —— m.qidian.com/rank/{rankKey} 的 records[](单榜完整列表,含分页 filters)。
 * 我们只取首页的 records(约 20 条),够首页壳子展示。
 */
export async function fetchQidianRank(
  rankKey: string,
  count = 20
): Promise<DiscoverItem[]> {
  const cacheKey = `rank:${rankKey}:${count}`;
  const cached = readCache<DiscoverItem[]>(cacheKey);
  if (cached) return cached;
  const pd = await fetchPageData(`/rank/${encodeURIComponent(rankKey)}`);
  const items = mapList(pd.records).slice(0, count);
  writeCache(cacheKey, items);
  return items;
}

/**
 * 完结精选 —— m.qidian.com/finish 的 classic(经典) + bestSell(畅销) + ds(打赏)。
 */
export async function fetchQidianFinished(count = 24): Promise<DiscoverItem[]> {
  const cacheKey = `finished:${count}`;
  const cached = readCache<DiscoverItem[]>(cacheKey);
  if (cached) return cached;
  const pd = await fetchPageData("/finish");
  const merged = [
    ...mapList(pd.bestSell),
    ...mapList(pd.classic),
    ...mapList(pd.ds),
  ];
  const seen = new Set<string>();
  const items = merged
    .filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)))
    .slice(0, count);
  writeCache(cacheKey, items);
  return items;
}

/** 发现区分区 key(小说)。 */
export type QidianDiscoverTab = "recommend" | "rank" | "finished";

/** 便捷:按 tab 拉整块分区(榜单 tab 返回默认月票榜)。 */
export async function fetchQidianSection(
  tab: QidianDiscoverTab,
  rankKey = "yuepiao"
): Promise<DiscoverSection> {
  if (tab === "recommend") {
    return { key: "recommend", label: "推荐", items: await fetchQidianRecommend() };
  }
  if (tab === "finished") {
    return { key: "finished", label: "完结", items: await fetchQidianFinished() };
  }
  const label = QIDIAN_RANKS.find((r) => r.key === rankKey)?.label || "榜单";
  return { key: `rank:${rankKey}`, label, items: await fetchQidianRank(rankKey) };
}

