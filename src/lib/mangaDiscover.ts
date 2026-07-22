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

/** 榜单/分类用的地区枚举(对齐 B站 ranking 分组)。 */
export type RankArea = "JP" | "CN" | "KO";

/**
 * 分类页目录条目 —— 首页 SSR 各分区去重聚合而来(classify 官方接口需 gaia WASM
 * 签名,拿不到全量目录,只能用免签名的首页数据组本地目录做筛选)。
 */
export interface ClassifyComic {
  id: string;
  title: string;
  cover: string;
  author?: string;
  /** 题材标签(用于「题材」筛选行)。 */
  styles: string[];
  /** 地区(来自榜单分组:日/国/韩;非榜单来源未知)。 */
  area?: RankArea;
  finished?: boolean;
  /** 人气(fans,用于排序)。 */
  fans?: number;
  /** 话数。 */
  total?: number;
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
  /** 分类页目录:各分区去重聚合(约 150~180 部,带 题材/地区/进度/人气)。 */
  catalog: ClassifyComic[];
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

/** BiliComic → 分类目录条目(area 来自榜单分组:日/国/韩)。 */
function comicToClassify(c: BiliComic, area?: RankArea): ClassifyComic | null {
  if (c.comic_id == null || !c.title) return null;
  const styles =
    (c.tags?.length
      ? c.tags
      : c.styles?.map((s) => s.name).filter((x): x is string => !!x)) || [];
  const fansN = Number(c.fans);
  return {
    id: String(c.comic_id),
    title: c.title,
    cover: c.vertical_cover || "",
    author: (c.author || []).filter(Boolean).join(" / ") || undefined,
    styles,
    area,
    finished: !!c.is_finish,
    fans: Number.isFinite(fansN) && fansN > 0 ? fansN : undefined,
    total: typeof c.total === "number" && c.total > 0 ? c.total : undefined,
  };
}

/** 目录去重合并:榜单地区更权威,题材取并集,人气/话数补空。 */
function mergeCatalog(map: Map<string, ClassifyComic>, c: ClassifyComic): void {
  const existing = map.get(c.id);
  if (!existing) {
    map.set(c.id, { ...c, styles: [...c.styles] });
    return;
  }
  if (c.area && !existing.area) existing.area = c.area;
  for (const s of c.styles) if (!existing.styles.includes(s)) existing.styles.push(s);
  if (existing.fans == null && c.fans != null) existing.fans = c.fans;
  if (existing.total == null && c.total != null) existing.total = c.total;
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

  // 分类目录:从原始 comic 数组(带 fans/styles/is_finish)去重聚合,榜单分组带上地区。
  const catalogMap = new Map<string, ClassifyComic>();
  const pushCatalog = (list: unknown, area?: RankArea) => {
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      const item = comicToClassify(raw as BiliComic, area);
      if (item) mergeCatalog(catalogMap, item);
    }
  };
  // 榜单先入(带地区),再补其它分区。
  pushCatalog(rk.JP, "JP");
  pushCatalog(rk.CN, "CN");
  pushCatalog(rk.KO, "KO");
  const hs = data.hotSeller as { firstGroup?: unknown; secondGroup?: unknown } | undefined;
  const ih = data.internetHot as { firstGroup?: unknown; secondGroup?: unknown } | undefined;
  const cc = data.completedComic as { firstGroup?: unknown; secondGroup?: unknown } | undefined;
  pushCatalog(hs?.firstGroup);
  pushCatalog(hs?.secondGroup);
  pushCatalog(ih?.firstGroup);
  pushCatalog(ih?.secondGroup);
  pushCatalog(cc?.firstGroup);
  pushCatalog(cc?.secondGroup);
  const catalog = [...catalogMap.values()];

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
    catalog,
  };
  writeCache(result);
  return result;
}

/** 官方筛选项(AllLabel 接口,免签名)。id + name 原样保留。 */
export interface MangaLabelOption {
  id: number;
  name: string;
}
export interface MangaLabels {
  styles: MangaLabelOption[];
  areas: MangaLabelOption[];
  status: MangaLabelOption[];
  orders: MangaLabelOption[];
  prices: MangaLabelOption[];
}

const LABELS_URL = "https://manga.bilibili.com/twirp/comic.v1.Comic/AllLabel?device=pc&platform=web";
const LABELS_CACHE_KEY = "douytv:manga-labels-cache";
let labelsMemory: { expiresAt: number; value: MangaLabels } | null = null;

/**
 * 抓 B站漫画分类页官方筛选项 —— comic.v1.Comic/AllLabel(免 gaia 签名,POST 空体即可)。
 * 返回官方原样的 题材 / 地区 / 进度 / 排序 / 收费 枚举(id + name),不自己编。
 * localStorage 缓存 24h(筛选项极少变)。
 */
export async function fetchMangaLabels(): Promise<MangaLabels> {
  if (labelsMemory && labelsMemory.expiresAt > Date.now()) return labelsMemory.value;
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(LABELS_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { expiresAt: number; value: MangaLabels };
        if (parsed.expiresAt > Date.now()) {
          labelsMemory = parsed;
          return parsed.value;
        }
      }
    } catch {
      // 忽略
    }
  }
  const res = await scriptFetch(LABELS_URL, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Referer: BILI_MANGA_REFERER,
      "Content-Type": "application/json",
    },
    body: "{}",
    timeout: 15_000,
  });
  if (!res.ok) throw new Error(`B站筛选项返回 HTTP ${res.status}`);
  const json = (await res.json()) as {
    code?: number;
    data?: Partial<MangaLabels>;
  };
  if (json.code !== 0 || !json.data) throw new Error("B站筛选项数据缺失");
  const pick = (list?: MangaLabelOption[]): MangaLabelOption[] =>
    Array.isArray(list)
      ? list.filter((o) => o && typeof o.id === "number" && !!o.name)
      : [];
  const value: MangaLabels = {
    styles: pick(json.data.styles),
    areas: pick(json.data.areas),
    status: pick(json.data.status),
    orders: pick(json.data.orders),
    prices: pick(json.data.prices),
  };
  labelsMemory = { expiresAt: Date.now() + 24 * 60 * 60 * 1000, value };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LABELS_CACHE_KEY, JSON.stringify(labelsMemory));
    } catch {
      // 忽略配额
    }
  }
  return value;
}

/** 高能排行的一个榜(对应 B站 ranking 页的 tab)。 */
export interface MangaRankTab {
  id: number;
  name: string;
  desc?: string;
}

export interface MangaRankPage {
  /** 全部榜 tab(新作/男生/女生/国漫/日漫/韩漫/宝藏/完结/原创…)。 */
  tabs: MangaRankTab[];
  /** 默认选中的榜 id。 */
  defaultId: number;
  /** 当前榜的条目(~50,带排名序)。 */
  list: DiscoverItem[];
}

const RANK_URL = (id: number) =>
  `https://manga.bilibili.com/ranking/${id}?from=manga_homepage_ranking`;
const RANK_CACHE_PREFIX = "douytv:manga-rank-cache";
const RANK_TTL_MS = 30 * 60 * 1000;
const rankMemory = new Map<number, { expiresAt: number; value: MangaRankPage }>();

/**
 * 抓 B站漫画高能排行页 —— /ranking/{id}(SSR 预渲染,免签名)。
 * data.rankInfo.list = 榜 tab 列表;data.rankListInfo = 当前榜 ~50 条(带 last_rank 排名)。
 * 30min 缓存。点条目走用户源解析(与首页壳子一致)。
 */
export async function fetchMangaRanking(id = 1): Promise<MangaRankPage> {
  const mem = rankMemory.get(id);
  if (mem && mem.expiresAt > Date.now()) return mem.value;
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(`${RANK_CACHE_PREFIX}:${id}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { expiresAt: number; value: MangaRankPage };
        if (parsed.expiresAt > Date.now()) {
          rankMemory.set(id, parsed);
          return parsed.value;
        }
      }
    } catch {
      // 忽略
    }
  }
  const res = await scriptFetch(RANK_URL(id), {
    method: "GET",
    headers: { "User-Agent": UA, Referer: BILI_MANGA_REFERER },
    timeout: 15_000,
  });
  if (!res.ok) throw new Error(`B站排行返回 HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(
    /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!m) throw new Error("B站排行页结构变化(未找到内联数据)");
  let root: unknown;
  try {
    root = JSON.parse(m[1]);
  } catch {
    throw new Error("B站排行页数据解析失败");
  }
  const data = (root as { data?: Record<string, unknown> })?.data;
  if (!data) throw new Error("B站排行页数据缺失");
  const rankInfo = (data.rankInfo || {}) as { list?: unknown; default_id?: number };
  const tabs: MangaRankTab[] = Array.isArray(rankInfo.list)
    ? (rankInfo.list as Array<{ id?: number; name?: string; description?: string }>)
        .filter((t) => t && typeof t.id === "number" && !!t.name)
        .map((t) => ({ id: t.id as number, name: t.name as string, desc: t.description }))
    : [];
  const list = mapList<BiliComic>(data.rankListInfo, mapRankComic);
  const value: MangaRankPage = {
    tabs,
    defaultId: typeof rankInfo.default_id === "number" ? rankInfo.default_id : id,
    list,
  };
  rankMemory.set(id, { expiresAt: Date.now() + RANK_TTL_MS, value });
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(
        `${RANK_CACHE_PREFIX}:${id}`,
        JSON.stringify({ expiresAt: Date.now() + RANK_TTL_MS, value })
      );
    } catch {
      // 忽略配额
    }
  }
  return value;
}

// ─── 聚合目录(分类页数据源)──────────────────────────────
// B站真实分类查询接口 ClassPage 需 gaia WASM 签名(浏览器外复现不了),这里改为
// 把所有免签名来源的真实数据聚合成一个更大的本地目录:首页各分区 + 9 个官方榜
// (各 ~50 条)去重,约 350+ 部,带 题材/地区/进度/人气。分类页在其上本地筛选 + 分批加载。

/** 9 个官方榜的 id → 地区(仅国/日/韩榜能确定地区,其它榜条目地区未知)。 */
const RANK_ID_AREA: Record<number, RankArea | undefined> = {
  1: "CN", // 国漫榜
  0: "JP", // 日漫榜
  2: "KO", // 韩漫榜
};
/** 聚合目录要抓的榜 id(9 个官方榜)。 */
const CATALOG_RANK_IDS = [7, 11, 12, 1, 0, 2, 5, 13, 33];

const CATALOG_CACHE_KEY = "douytv:manga-catalog-cache";
const CATALOG_TTL_MS = 60 * 60 * 1000;
let catalogMemory: { expiresAt: number; value: ClassifyComic[] } | null = null;

/** 抓单个榜页,取原始 comic 数组(rankListInfo)。失败返 []。 */
async function fetchRankRawComics(id: number): Promise<{ comics: BiliComic[]; area?: RankArea }> {
  try {
    const res = await scriptFetch(RANK_URL(id), {
      method: "GET",
      headers: { "User-Agent": UA, Referer: BILI_MANGA_REFERER },
      timeout: 15_000,
    });
    if (!res.ok) return { comics: [] };
    const html = await res.text();
    const m = html.match(
      /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/
    );
    if (!m) return { comics: [] };
    const data = (JSON.parse(m[1]) as { data?: Record<string, unknown> })?.data;
    const list = data?.rankListInfo;
    return {
      comics: Array.isArray(list) ? (list as BiliComic[]) : [],
      area: RANK_ID_AREA[id],
    };
  } catch {
    return { comics: [] };
  }
}

/**
 * 聚合目录 —— 首页各区 + 9 个官方榜的真实漫画,去重合并。全 B站真数据,零签名。
 * 内存 + localStorage 1h 缓存。分类页调它拿全量,再本地筛选 + 分批渲染。
 */
export async function fetchMangaCatalog(): Promise<ClassifyComic[]> {
  if (catalogMemory && catalogMemory.expiresAt > Date.now()) return catalogMemory.value;
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(CATALOG_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { expiresAt: number; value: ClassifyComic[] };
        if (parsed.expiresAt > Date.now()) {
          catalogMemory = parsed;
          return parsed.value;
        }
      }
    } catch {
      // 忽略
    }
  }

  const map = new Map<string, ClassifyComic>();

  // 1) 首页目录(已带各区 + 榜单地区)。
  try {
    const home = await fetchMangaHome();
    for (const c of home.catalog) mergeCatalog(map, c);
  } catch {
    // 首页失败不致命,继续抓榜。
  }

  // 2) 9 个榜(各 ~50 条),并发抓取,榜地区带上。
  const rankResults = await Promise.all(CATALOG_RANK_IDS.map((id) => fetchRankRawComics(id)));
  for (const { comics, area } of rankResults) {
    for (const raw of comics) {
      const item = comicToClassify(raw, area);
      if (item) mergeCatalog(map, item);
    }
  }

  const value = [...map.values()];
  catalogMemory = { expiresAt: Date.now() + CATALOG_TTL_MS, value };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(catalogMemory));
    } catch {
      // 忽略配额
    }
  }
  return value;
}

// ─── 真实分类查询(移动端 SSR pageContext,免签名)─────────────
// manga.bilibili.com/m/classify/index.pageContext.json?styles=&areas=&status=&orders=&prices=&special=
// 是移动端 vite-plugin-ssr 的数据端点(和起点同套路):按筛选参数返回真实匹配的漫画
// (data.firstDataList,每次首屏 15 条)+ 官方筛选项(data.tabListData)。gaia 只挡 twirp
// 的 ClassPage,这个 SSR 端点完全绕过,是真实、随筛选变化的官方数据。
// 单次只吐 15 条(翻页靠签名接口拿不到),这里合并 3 种排序(人气/更新/上架)去重加深到 ~40。

/** 分类筛选条件(官方 id,-1 = 全部;special/orders 默认 0)。 */
export interface MangaClassifyQuery {
  styles: number;
  areas: number;
  status: number;
  prices: number;
  special: number;
  /** 单排序抓取时用;mergeOrders 模式下忽略。 */
  orders?: number;
}

export interface MangaClassifyResult {
  list: ClassifyComic[];
  /** 端点内嵌的官方筛选项(与 AllLabel 同源,省一次请求)。 */
  labels: MangaLabels | null;
}

const CLASSIFY_SSR_BASE = "https://manga.bilibili.com/m/classify/index.pageContext.json";
/** 排序维度(合并这几种排序的结果去重,单筛选组合能从 15 加深到 ~40)。 */
const CLASSIFY_MERGE_ORDERS = [0, 1, 3];

/** SSR firstDataList 的原始条目。 */
interface SsrClassifyComic {
  season_id?: number;
  title?: string;
  vertical_cover?: string;
  is_finish?: number;
  total?: number;
  styles?: string[];
  author?: string[];
}

function ssrToClassify(c: SsrClassifyComic): ClassifyComic | null {
  if (c.season_id == null || !c.title) return null;
  return {
    id: String(c.season_id),
    title: c.title,
    cover: c.vertical_cover || "",
    author: (c.author || []).filter(Boolean).join(" / ") || undefined,
    styles: (c.styles || []).filter(Boolean),
    finished: !!c.is_finish,
    total: typeof c.total === "number" && c.total > 0 ? c.total : undefined,
  };
}

/** 解析一次 SSR 响应 → firstDataList + tabListData(官方筛选项)。 */
function parseClassifySsr(json: unknown): { list: ClassifyComic[]; labels: MangaLabels | null } {
  const data = (json as { data?: Record<string, unknown> })?.data;
  if (!data) return { list: [], labels: null };
  const raw = Array.isArray(data.firstDataList) ? (data.firstDataList as SsrClassifyComic[]) : [];
  const list = raw.map(ssrToClassify).filter((x): x is ClassifyComic => x !== null);
  // tabListData 内嵌官方筛选项(去掉「全部」占位,统一由前端补)。
  const tld = data.tabListData as Record<string, MangaLabelOption[]> | undefined;
  const pick = (l?: MangaLabelOption[]) =>
    Array.isArray(l) ? l.filter((o) => o && typeof o.id === "number" && !!o.name && o.id !== -1) : [];
  const labels: MangaLabels | null = tld
    ? {
        styles: pick(tld.styles),
        areas: pick(tld.areas),
        status: pick(tld.status),
        orders: pick(tld.orders),
        prices: pick(tld.prices),
      }
    : null;
  return { list, labels };
}

async function fetchClassifyOnce(q: MangaClassifyQuery, order: number): Promise<{ list: ClassifyComic[]; labels: MangaLabels | null }> {
  const params = new URLSearchParams({
    status: String(q.status),
    areas: String(q.areas),
    styles: String(q.styles),
    orders: String(order),
    prices: String(q.prices),
    special: String(q.special),
  });
  const res = await scriptFetch(`${CLASSIFY_SSR_BASE}?${params.toString()}`, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
      Referer: "https://manga.bilibili.com/m/classify",
    },
    timeout: 15_000,
  });
  if (!res.ok) throw new Error(`B站分类返回 HTTP ${res.status}`);
  const json = JSON.parse(await res.text());
  return parseClassifySsr(json);
}

/**
 * 真实分类查询 —— 按筛选条件抓移动端 SSR,合并 3 种排序去重(~40 条真实数据)。
 * 返回匹配的漫画 + 端点内嵌的官方筛选项。5min 缓存(按筛选组合)。
 */
const classifyMemory = new Map<string, { expiresAt: number; value: MangaClassifyResult }>();
const CLASSIFY_TTL_MS = 5 * 60 * 1000;

export async function fetchMangaClassify(q: MangaClassifyQuery): Promise<MangaClassifyResult> {
  const primary = q.orders ?? 0;
  const key = `${q.styles}:${q.areas}:${q.status}:${q.prices}:${q.special}:${primary}`;
  const mem = classifyMemory.get(key);
  if (mem && mem.expiresAt > Date.now()) return mem.value;

  // 把选中的排序放在合并首位(去重保序 → 选中排序的名次主导列表顺序),再并上其它排序加深。
  const orders = [primary, ...CLASSIFY_MERGE_ORDERS.filter((o) => o !== primary)];
  // 并发抓多种排序,首个成功的响应取官方 labels;结果按 season_id 去重(保持首个排序顺序)。
  const settled = await Promise.allSettled(orders.map((o) => fetchClassifyOnce(q, o)));
  const map = new Map<string, ClassifyComic>();
  let labels: MangaLabels | null = null;
  let anyOk = false;
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    anyOk = true;
    if (!labels && r.value.labels) labels = r.value.labels;
    for (const c of r.value.list) if (!map.has(c.id)) map.set(c.id, c);
  }
  if (!anyOk) throw new Error("B站分类数据获取失败");
  const value: MangaClassifyResult = { list: [...map.values()], labels };
  classifyMemory.set(key, { expiresAt: Date.now() + CLASSIFY_TTL_MS, value });
  return value;
}

