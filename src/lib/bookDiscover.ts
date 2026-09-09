/**
 * QQ阅读发现源 —— 小说首页壳子的 为你推荐 / 畅销 / 新书 / 完结 / 榜单 数据。
 *
 * 数据来源:book.qq.com(QQ阅读 PC 站,Nuxt SSR)。整页数据内联在
 * `window.__NUXT__=(function(...){return {...}})(...)` 里 —— 是压缩的自执行函数(非纯 JSON),
 * 但函数体除 `return` 外无任何全局引用,用 `new Function` 求值即可拿到全部分区,零接口猜测、零签名。
 * (项目已在 source-script/runtime.ts、legado.client.ts 大量使用同类 new Function 沙箱模式。)
 *
 * 数据比起点(m.qidian.com)更丰富:男频/女频/出版三大类 × 热门/新书/完结多榜 + 精选推荐。
 * 走 scriptFetch(Tauri 下 Rust ureq 绕 CORS + 跟随全局代理),localStorage 1h 缓存。
 */
import { scriptFetch } from "@/source-script/fetch";
import type { DiscoverItem } from "./discover";

const BASE = "https://book.qq.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
/** QQ阅读封面 / 图片统一带这个 Referer(与起点同 CDN,一般不防盗链,带上更稳)。 */
export const QQBOOK_REFERER = "https://book.qq.com/";
const CACHE_TTL_MS = 60 * 60 * 1000;
// v2: 首页数据结构从 flat(recommendation/hotSeller…)改为 groups[] 版式,旧缓存不兼容,提 key 版本失效。
const CACHE_PREFIX = "douytv:qqbook-cache-v2";

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

/** 封面:QQ阅读书籍封面 CDN,按 bid 拼(b_ 前缀,jpg)。实测有效。 */
export function qqbookCover(bid: string | number): string {
  const n = typeof bid === "number" ? bid : Number(bid);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `https://wfqqreader-1252317822.image.myqcloud.com/cover/${n % 1000}/${n}/b_${n}.jpg`;
}

/**
 * 抓 book.qq.com 某页,提取内联的 window.__NUXT__ 并求值 → 页面根数据对象。
 * NUXT 是压缩 IIFE(非 JSON),用 new Function 求值(函数体无全局引用,已实测安全)。
 */
async function fetchNuxt(path: string): Promise<Record<string, unknown>> {
  const res = await scriptFetch(`${BASE}${path}`, {
    method: "GET",
    headers: { "User-Agent": UA, Referer: QQBOOK_REFERER },
    timeout: 15_000,
    // book.qq.com 的 TLS 对 ureq(rustls)会 "unexpected end of file",走 reqwest(http2)。
    http2: true,
  });
  if (!res.ok) throw new Error(`QQ阅读返回 HTTP ${res.status}`);
  const html = await res.text();
  const start = html.indexOf("window.__NUXT__=");
  if (start < 0) throw new Error("QQ阅读页面结构变化(未找到 __NUXT__)");
  const scriptEnd = html.indexOf("</script>", start);
  if (scriptEnd < 0) throw new Error("QQ阅读页面结构变化(script 未闭合)");
  let blob = html.slice(start + "window.__NUXT__=".length, scriptEnd).trim();
  if (blob.endsWith(";")) blob = blob.slice(0, -1);
  let root: unknown;
  try {
    // eslint-disable-next-line no-new-func
    root = new Function(`"use strict";return (${blob})`)();
  } catch {
    throw new Error("QQ阅读 __NUXT__ 求值失败");
  }
  const data = (root as { data?: unknown[] })?.data;
  const first = Array.isArray(data) ? data[0] : undefined;
  if (!first || typeof first !== "object") {
    throw new Error("QQ阅读页面数据缺失");
  }
  return first as Record<string, unknown>;
}

/** QQ阅读原始书条目(首页 topData / rankData / 榜单 list 字段交集)。 */
interface QqRawBook {
  bid?: string | number;
  title?: string;
  author?: string;
  intro?: string;
  category3Name?: string;
  category2Name?: string;
  finished?: number;
  totalWords?: number;
  refCount?: string | number;
  lastChapterName?: string;
}

/** 万字 / 万人 简短展示。 */
function wanLabel(n: number | undefined, unit: string): string | undefined {
  if (!Number.isFinite(n as number) || (n as number) <= 0) return undefined;
  const v = n as number;
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)}万${unit}`;
  return `${v}${unit}`;
}

function toItem(raw: QqRawBook): DiscoverItem | null {
  const bid = raw.bid != null ? String(raw.bid) : "";
  if (!bid || !raw.title) return null;
  const cat = raw.category3Name || raw.category2Name || undefined;
  return {
    id: bid,
    title: raw.title,
    cover: qqbookCover(bid),
    author: raw.author || undefined,
    cat,
    desc: raw.intro || undefined,
    finished: raw.finished === 1 ? true : raw.finished === 0 ? false : undefined,
    meta:
      wanLabel(typeof raw.totalWords === "number" ? raw.totalWords : undefined, "字") ||
      wanLabel(raw.refCount != null ? Number(raw.refCount) : undefined, "人推荐") ||
      undefined,
  };
}

function mapList(list: unknown): DiscoverItem[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((x) => toItem(x as QqRawBook))
    .filter((x): x is DiscoverItem => x !== null);
}

/** 去重(按 id 保序)。 */
function dedupe(items: DiscoverItem[]): DiscoverItem[] {
  const seen = new Set<string>();
  return items.filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)));
}

/** rankData 的一个大类(男生/女生/出版精选)原始结构。 */
interface QqRankGroup {
  title?: string;
  href?: string;
  columns?: Array<{
    name?: string;
    href?: string;
    id?: number;
    data?: { books?: unknown };
  }>;
}

/** 归一化后的榜单列(热门榜 / 新书榜 / 完结榜)。 */
export interface QqbookColumn {
  /** 列名(热门榜 / 新书榜 / 完结榜 / 新知榜)。 */
  name: string;
  /** 站内榜单页路径(/book-rank/male-sell 等),用于「查看更多」跳转。 */
  href: string;
  /** 该列榜单书(约 10 本,带排名序)。 */
  books: DiscoverItem[];
}

/**
 * 归一化后的一个精选大类(男生精选 / 女生精选 / 出版精选)。
 * 照 book.qq.com 版式:一行大封面(featured)+ 并排 3 个榜单列(columns)。
 */
export interface QqbookGroup {
  /** 大类 key(male/female/publish),用于跳榜单页。 */
  gender: QqRankGender;
  /** 大类标题(男生精选 等)。 */
  title: string;
  /** 站内大类页路径(/recommend/male)。 */
  href: string;
  /** 顶部一行大封面书(topData[i],约 6 本)。 */
  featured: DiscoverItem[];
  /** 并排 3 个榜单列(热门/新书/完结)。 */
  columns: QqbookColumn[];
}

/** QQ阅读首页归一化数据(照 book.qq.com 版式:banner + 3 个精选大类块)。 */
export interface QqbookHomeData {
  /** 3 个精选大类块(男生 / 女生 / 出版),各含 featured 行 + 3 榜单列。 */
  groups: QqbookGroup[];
}

/** 从大类 href(/recommend/male)推出 gender key。 */
function genderFromHref(href: string): QqRankGender {
  if (href.includes("female")) return "female";
  if (href.includes("publish")) return "publish";
  return "male";
}

/** 抓 book.qq.com 首页,解析 __NUXT__ → 精选大类块(保留 book.qq.com 版式结构)。 */
export async function fetchQqbookHome(): Promise<QqbookHomeData> {
  const cached = readCache<QqbookHomeData>("home");
  // 防御旧版缓存(扁平结构无 groups):命中即忽略,重新抓取。
  if (cached && Array.isArray(cached.groups)) return cached;

  const d = await fetchNuxt("/");
  const topData = Array.isArray(d.topData) ? (d.topData as unknown[]) : [];
  const rankData = Array.isArray(d.rankData) ? (d.rankData as QqRankGroup[]) : [];

  // rankData[i] 与 topData[i] 按索引对齐(同一大类:featured 行来自 topData,榜单列来自 rankData)。
  const groups: QqbookGroup[] = rankData
    .map((g, i) => {
      const href = g.href || "";
      const columns: QqbookColumn[] = (g.columns || [])
        .map((col) => ({
          name: col.name || "",
          href: col.href || "",
          books: dedupe(mapList(col.data?.books)),
        }))
        .filter((c) => c.name && c.books.length > 0);
      return {
        gender: genderFromHref(href),
        title: g.title || "",
        href,
        featured: dedupe(mapList(topData[i])),
        columns,
      };
    })
    .filter((g) => g.columns.length > 0 || g.featured.length > 0);

  const result: QqbookHomeData = { groups };
  writeCache("home", result);
  return result;
}

/** 榜单大类(对应 book.qq.com /book-rank/{gender}-{rank})。 */
export type QqRankGender = "male" | "female" | "publish";
export type QqRankKind = "sell" | "new" | "finish" | "knowledge";

/** 各大类可用的榜 tab(照 book.qq.com)。 */
export const QQ_RANK_TABS: Record<
  QqRankGender,
  Array<{ kind: QqRankKind; label: string }>
> = {
  male: [
    { kind: "sell", label: "热门榜" },
    { kind: "new", label: "新书榜" },
    { kind: "finish", label: "完结榜" },
  ],
  female: [
    { kind: "sell", label: "热门榜" },
    { kind: "new", label: "新书榜" },
    { kind: "finish", label: "完结榜" },
  ],
  publish: [
    { kind: "sell", label: "热门榜" },
    { kind: "new", label: "新书榜" },
    { kind: "knowledge", label: "新知榜" },
  ],
};

export const QQ_RANK_GENDERS: Array<{ key: QqRankGender; label: string }> = [
  { key: "male", label: "男生精选" },
  { key: "female", label: "女生精选" },
  { key: "publish", label: "出版精选" },
];

/**
 * 榜单"查看全部"页 —— /book-rank/{gender}-{rank} 的 data[0].list(约 20 本,带
 * category/finished/totalWords/refCount/lastChapterName)+ total。
 */
export async function fetchQqbookRank(
  gender: QqRankGender,
  kind: QqRankKind
): Promise<DiscoverItem[]> {
  const key = `rank:${gender}:${kind}`;
  const cached = readCache<DiscoverItem[]>(key);
  if (cached) return cached;
  const d = await fetchNuxt(`/book-rank/${gender}-${kind}`);
  const items = dedupe(mapList(d.list));
  writeCache(key, items);
  return items;
}
