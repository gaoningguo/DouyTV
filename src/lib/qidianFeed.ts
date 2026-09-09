/**
 * 起点榜单源(第三方 GitHub 开源仓库)—— 每日畅销榜 + 完本收藏榜。
 *
 * 起点官网(www.qidian.com)挂在腾讯 Chaos VM 反爬后,纯 HTTP 抓不到、也无法在
 * 浏览器外复现签名。开源项目 dylan-byte-max/novel-tracker 用 Playwright 无头浏览器
 * 每天跑一次爬虫,把结果以干净 JSON 发布到 GitHub CDN。我们直接消费这份公开数据:
 * 真起点数据、真起点封面、零反爬。第三方依赖 —— 抓取失败静默跳过(首页有番茄/QQ 兜底)。
 *
 * 走 scriptFetch(Tauri 下 Rust ureq 绕 CORS + 跟随全局代理),localStorage 6h 缓存。
 */
import { scriptFetch } from "@/source-script/fetch";
import type { DiscoverItem } from "./discover";

const CDN =
  "https://raw.githubusercontent.com/dylan-byte-max/novel-tracker/main/data/qidian";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_PREFIX = "douytv:qidian-feed-cache";

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

/** 仓库发布的起点书条目。 */
interface QidianFeedBook {
  rank?: number;
  book_id?: string;
  book_name?: string;
  author?: string;
  all_tags?: string[];
  primary_tag?: string;
  abstract?: string;
  status?: string;
  thumb_url?: string;
}

function toItem(raw: QidianFeedBook): DiscoverItem | null {
  const id = raw.book_id != null ? String(raw.book_id) : "";
  if (!id || !raw.book_name) return null;
  const tags = (raw.all_tags || []).filter(Boolean);
  return {
    id,
    title: raw.book_name,
    cover: raw.thumb_url || "",
    author: raw.author || undefined,
    cat: (tags.length ? tags : raw.primary_tag ? [raw.primary_tag] : []).slice(0, 2).join(" ") || undefined,
    desc: raw.abstract && raw.abstract !== "暂无简介" ? raw.abstract : undefined,
    finished: raw.status?.includes("完") ? true : undefined,
  };
}

async function fetchFeed(file: string, cacheKey: string, limit: number): Promise<DiscoverItem[]> {
  const cached = readCache<DiscoverItem[]>(cacheKey);
  if (cached) return cached;
  // http2: true —— 走 reqwest(而非 ureq)。ureq 的 rustls 对部分服务端的 TLS
  // 握手/重协商行为会报 "tls connection init failed: unexpected end of file"
  // (见 nudetik.js / sharesome.js 同类处理)。GitHub CDN 支持 ALPN h2。
  const res = await scriptFetch(`${CDN}/${file}`, {
    method: "GET",
    http2: true,
    timeout: 15_000,
  });
  if (!res.ok) throw new Error(`起点榜单返回 HTTP ${res.status}`);
  const json = JSON.parse(await res.text()) as { books?: unknown };
  const books = Array.isArray(json.books) ? (json.books as QidianFeedBook[]) : [];
  const items = books
    .map(toItem)
    .filter((x): x is DiscoverItem => x !== null)
    .slice(0, limit);
  if (items.length === 0) throw new Error("起点榜单数据缺失");
  writeCache(cacheKey, items);
  return items;
}

/** 起点每日畅销榜(50 本)。 */
export function fetchQidianSellRank(limit = 50): Promise<DiscoverItem[]> {
  return fetchFeed("latest.json", `sell:${limit}`, limit);
}

/** 起点完本收藏榜(仓库有 960 本,默认取前 60)。 */
export function fetchQidianFinishRank(limit = 60): Promise<DiscoverItem[]> {
  return fetchFeed("collection.json", `finish:${limit}`, limit);
}

/** 起点榜单类型(首页 tab)。 */
export type QidianFeedTab = "sell" | "finish";

export const QIDIAN_FEED_TABS: Array<{ key: QidianFeedTab; label: string }> = [
  { key: "sell", label: "畅销榜" },
  { key: "finish", label: "完本收藏榜" },
];

/** 按 tab 拉榜单(首页榜单区共用)。 */
export function fetchQidianFeed(tab: QidianFeedTab, limit?: number): Promise<DiscoverItem[]> {
  return tab === "finish" ? fetchQidianFinishRank(limit) : fetchQidianSellRank(limit);
}
