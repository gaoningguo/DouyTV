/**
 * 漫画发现源 —— B站漫画首页壳子的 推荐 / 畅销 / 全网热 / 完结 / 榜单。
 *
 * 数据来源:manga.bilibili.com 首页(SSR 预渲染,manga-pc-ssr)。整页数据内联在
 * <script type="application/json"> 里,一次抓取即可拿到全部分区,完全免签名——
 * 不碰带 gaia WASM 签名(m2)的 ClassPage 接口。字段比 ClassPage 更全(粉丝数 / 排名 / 最新话)。
 *
 * 走 scriptFetch(Tauri 下 Rust ureq 绕 CORS + 跟随全局代理),localStorage 1h 缓存。
 */
import { scriptFetch } from "@/source-script/fetch";
import type { DiscoverItem } from "./discover";

const HOME = "https://manga.bilibili.com/";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
/** B站漫画封面 / 图片统一带这个 Referer 防盗链。 */
export const BILI_MANGA_REFERER = "https://manga.bilibili.com/";
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_KEY = "douytv:manga-discover-cache:home";

/** 题材分类 chip(带 B站 style id,用于跳转/展示)。 */
export interface MangaCategory {
  id: number;
  name: string;
}

/** banner 卡(封面墙一格)。 */
export interface BannerCard {
  img: string;
  /** 大卡浮层(single_card_info):上方 eyebrow(card_sub_title)。 */
  eyebrow?: string;
  /** 大卡浮层主标题(card_title)。 */
  mainTitle?: string;
  /** 67px 黑条:小缩略图 / 漫画名 / 题材标签 + 颜色 / 推荐语。 */
  thumb?: string;
  comicTitle?: string;
  tag?: string;
  tagColor?: string;
  recommendation?: string;
  /** 用于点击解析的标题(comic_title 优先),活动位可能为空。 */
  resolveTitle?: string;
  /** 关联漫画 id(可能为空=纯活动位)。 */
  comicIds: number[];
}

/** 首页解出的全部分区(归一化后)。 */
export interface MangaHomeData {
  /** 顶部 banner 封面墙:每屏 8 卡(big×2 + 堆叠对×3),共 3 屏。 */
  banner: BannerCard[][];
  /** 头部题材分类 chips(14 个)。 */
  categories: MangaCategory[];
  /** 为你推荐(横版大图 + 简介,做列表 + 右侧大图)。 */
  recommendation: DiscoverItem[];
  /** 畅销热门。 */
  hotSeller: DiscoverItem[];
  /** 全网热议。 */
  internetHot: DiscoverItem[];
  /** 完结佳作。 */
  completed: DiscoverItem[];
  /** 高能排行:日漫 / 国漫 / 韩漫,各 ~50。 */
  ranking: { JP: DiscoverItem[]; CN: DiscoverItem[]; KO: DiscoverItem[] };
}

interface CacheEntry {
  expiresAt: number;
  value: MangaHomeData;
}
let memoryCache: CacheEntry | null = null;

function readCache(): MangaHomeData | undefined {
  if (memoryCache && memoryCache.expiresAt > Date.now()) return memoryCache.value;
  memoryCache = null;
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (parsed.expiresAt <= Date.now()) {
      window.localStorage.removeItem(CACHE_KEY);
      return undefined;
    }
    memoryCache = parsed;
    return parsed.value;
  } catch {
    return undefined;
  }
}

function writeCache(value: MangaHomeData): void {
  const entry: CacheEntry = { expiresAt: Date.now() + CACHE_TTL_MS, value };
  memoryCache = entry;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // 忽略配额失败
  }
}

/** 榜单 / 畅销 / 完结类的漫画条目(comic_id 系列)。 */
interface BiliComic {
  comic_id?: number;
  title?: string;
  author?: string[];
  vertical_cover?: string;
  is_finish?: number;
  last_short_title?: string;
  styles?: Array<{ name?: string }>;
  fans?: string;
  last_rank?: number;
  total?: number;
  /** 状态标签(畅销指数 / 人热议中,空则不显示)。 */
  text?: string;
  /** 题材标签(封面叠层用,优先于 styles)。 */
  tags?: string[];
}

/** 推荐位条目(id 系列,带简介 / 横版封面)。 */
interface BiliRecoComic {
  id?: number;
  title?: string;
  evaluate?: string;
  vertical_cover?: string;
  horizontal_cover?: string;
  tags?: string[];
}

function fansLabel(fans?: string): string | undefined {
  const n = Number(fans);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿人气`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万人气`;
  return `${n}人气`;
}

/** 分区类型 → 状态行文案(照 B站):畅销指数/人热议中/完结共N话。 */
type SectionKind = "hot" | "net" | "finished";

function metaFor(c: BiliComic, kind: SectionKind): DiscoverItem["metaSegs"] {
  const fans = (c.fans || "").trim();
  if (kind === "hot") {
    // "畅销指数 <数字金>"
    if (!c.text || !fans) return undefined;
    return [{ text: c.text }, { text: fans, gold: true }];
  }
  if (kind === "net") {
    // "<数字金>人热议中"
    if (!fans) return undefined;
    return [{ text: fans, gold: true }, { text: c.text || "人热议中" }];
  }
  // finished: "完结 · 共 N 话"
  const segs: NonNullable<DiscoverItem["metaSegs"]> = [];
  if (c.is_finish) segs.push({ text: "完结" });
  if (typeof c.total === "number" && c.total > 0) segs.push({ text: `共 ${c.total} 话` });
  return segs.length ? segs : undefined;
}

function mapComic(c: BiliComic, kind: SectionKind): DiscoverItem | null {
  if (c.comic_id == null || !c.title) return null;
  const genre = c.tags?.length
    ? c.tags
    : c.styles?.map((s) => s.name).filter((x): x is string => !!x);
  return {
    id: String(c.comic_id),
    title: c.title,
    cover: c.vertical_cover || "",
    author: (c.author || []).filter(Boolean).join(" / ") || undefined,
    cat: (genre || []).slice(0, 2).join(" ") || undefined,
    finished: !!c.is_finish,
    episodes: typeof c.total === "number" && c.total > 0 ? c.total : undefined,
    metaSegs: metaFor(c, kind),
  };
}

function mapReco(c: BiliRecoComic): DiscoverItem | null {
  if (c.id == null || !c.title) return null;
  return {
    id: String(c.id),
    title: c.title,
    cover: c.vertical_cover || c.horizontal_cover || "",
    wide: c.horizontal_cover || c.vertical_cover || "",
    cat: (c.tags || []).filter(Boolean).slice(0, 2).join(" ") || undefined,
    desc: c.evaluate || undefined,
  };
}

function mapList<T>(list: unknown, fn: (x: T) => DiscoverItem | null): DiscoverItem[] {
  if (!Array.isArray(list)) return [];
  return list.map((x) => fn(x as T)).filter((x): x is DiscoverItem => x !== null);
}

/** 合并 firstGroup + secondGroup(B站把畅销/热门拆两组)。 */
function mergeGroups(section: unknown, kind: SectionKind): DiscoverItem[] {
  const s = section as { firstGroup?: unknown; secondGroup?: unknown } | undefined;
  if (!s) return [];
  const map = (list: unknown) =>
    Array.isArray(list)
      ? list.map((x) => mapComic(x as BiliComic, kind)).filter((x): x is DiscoverItem => x !== null)
      : [];
  const seen = new Set<string>();
  return [...map(s.firstGroup), ...map(s.secondGroup)].filter((it) =>
    seen.has(it.id) ? false : (seen.add(it.id), true)
  );
}

/** 榜单条目:用 fans 当热度(人气)。 */
function mapRankComic(c: BiliComic): DiscoverItem | null {
  const item = mapComic(c, "net");
  if (!item) return null;
  item.metaSegs = undefined;
  item.meta = fansLabel(c.fans);
  return item;
}

/** 抓 B站漫画首页,解析内联 SSR JSON → 全部分区。 */
export async function fetchMangaHome(): Promise<MangaHomeData> {
  const cached = readCache();
  if (cached) return cached;

  const res = await scriptFetch(HOME, {
    method: "GET",
    headers: { "User-Agent": UA, Referer: BILI_MANGA_REFERER },
    timeout: 15_000,
  });
  if (!res.ok) throw new Error(`B站漫画返回 HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(
    /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!m) throw new Error("B站漫画首页结构变化(未找到内联数据)");
  let root: unknown;
  try {
    root = JSON.parse(m[1]);
  } catch {
    throw new Error("B站漫画首页数据解析失败");
  }
  const data = (root as { data?: Record<string, unknown> })?.data;
  if (!data || typeof data !== "object") {
    throw new Error("B站漫画首页数据缺失");
  }
  const rk = (data.ranking || {}) as Record<string, unknown>;
  const rawCats = (data.hotCategory as { styles?: unknown })?.styles;
  const rawBanner = Array.isArray(data.banner) ? (data.banner as Array<{ list?: unknown }>) : [];

  // 先算各区块(banner 堆叠位要从这些真实封面里借填充)。
  const recommendation = mapList<BiliRecoComic>(
    (data.recommendation as { comics?: unknown })?.comics,
    mapReco
  );
  const hotSeller = mergeGroups(data.hotSeller, "hot");
  const internetHot = mergeGroups(data.internetHot, "net");
  const completed = mergeGroups(data.completedComic, "finished");

  // 填充池:真实漫画封面(去重),用于补 banner 每屏堆叠位的空格。
  const fillPool: BannerCard[] = [];
  const fillSeen = new Set<string>();
  for (const it of [...hotSeller, ...completed, ...internetHot, ...recommendation]) {
    if (!it.cover || fillSeen.has(it.id)) continue;
    fillSeen.add(it.id);
    fillPool.push({ img: it.cover, resolveTitle: it.title, comicIds: [] });
  }
  let fillIdx = 0;
  const nextFill = (): BannerCard | null => {
    if (fillPool.length === 0) return null;
    const c = fillPool[fillIdx % fillPool.length];
    fillIdx++;
    return c;
  };

  // banner:每屏取真实大卡(有 img 的),空堆叠位用填充池补齐到 8 格。
  const banner: BannerCard[][] = rawBanner
    .map((slide) => {
      const list = Array.isArray(slide?.list) ? slide.list : [];
      const bigs: BannerCard[] = [];
      for (const it of list) {
        const c = (it as { card?: Record<string, unknown> })?.card;
        if (!c || typeof c.img_url !== "string") continue;
        const sci = c.single_card_info as
          | {
              card_title?: string;
              card_sub_title?: string;
              recommendation?: string;
              sub_img_urls?: string[];
              tag?: string;
              tag_color?: string;
              comic_title?: string;
            }
          | null;
        bigs.push({
          img: c.img_url,
          eyebrow: sci?.card_sub_title || undefined,
          mainTitle: sci?.card_title || undefined,
          thumb: sci?.sub_img_urls?.[0] || undefined,
          comicTitle: sci?.comic_title || undefined,
          tag: sci?.tag || undefined,
          tagColor: sci?.tag_color || undefined,
          recommendation: sci?.recommendation || undefined,
          resolveTitle: sci?.comic_title || sci?.card_title || undefined,
          comicIds: Array.isArray(c.comic_ids) ? (c.comic_ids as number[]) : [],
        });
      }
      if (bigs.length === 0) return [];
      // 组装 8 格:[大卡0, 填, 填, 大卡1(或填), 填, 填, 填, 填]
      const big0 = bigs[0];
      const big1 = bigs[1] || nextFill() || big0;
      const cell = (): BannerCard => nextFill() || big0;
      return [big0, cell(), cell(), big1, cell(), cell(), cell(), cell()];
    })
    .filter((s) => s.length > 0);

  const result: MangaHomeData = {
    banner,
    categories: Array.isArray(rawCats)
      ? (rawCats as MangaCategory[]).filter((c) => c && c.id != null && c.name)
      : [],
    recommendation,
    hotSeller,
    internetHot,
    completed,
    ranking: {
      JP: mapList<BiliComic>(rk.JP, mapRankComic),
      CN: mapList<BiliComic>(rk.CN, mapRankComic),
      KO: mapList<BiliComic>(rk.KO, mapRankComic),
    },
  };
  writeCache(result);
  return result;
}

