import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSearch, type SearchResult } from "@/hooks/useSearch";
import { useScriptStore } from "@/stores/scripts";
import { useLibraryStore } from "@/stores/library";
import { useSyncStore } from "@/stores/sync";
import {
  useVodAssetsStore,
  type DownloadTask,
  type WatchLaterRecord,
} from "@/stores/vodAssets";
import {
  openVodDownloadPath,
  pauseVodDownload,
  resumeVodDownload,
  startVodDownload,
} from "@/lib/vodDownload";
import {
  callDetail,
  callSearch,
} from "@/source-script/runtime";
import { appAlert, appConfirm } from "@/components/AppDialog";
import type { ScriptDescriptor, ScriptSourceItem } from "@/source-script/types";
import HotRecommendations from "@/components/HotRecommendations";
import {
  fetchDoubanRecentHot,
  fetchTodayBangumi,
  type DoubanItem,
} from "@/lib/douban";
import {
  fetchDuanjuRecommendations,
  getSourceCategories,
  loadSourceCategoryVideos,
  searchSourceVideos,
} from "@/lib/vodSourceDiscovery";
import { wrapImage } from "@/lib/proxy";
import {
  IconSearch,
  IconClose,
  IconFilm,
  IconRefresh,
  IconGrid,
  IconList,
  IconChevronLeft,
  IconChevronRight,
  IconBookmark,
  IconDownload,
  IconPlay,
  IconTrash,
  IconUpload,
  IconCheck,
  IconArtist,
  IconHome,
  IconAntenna,
} from "@/components/Icon";

/** 聚合 key 用：去空格 / 全角空格 / 括号 / 标点，保留汉字/字母/数字 */
function normalizeTitle(t: string): string {
  return t
    .replace(/[\s　]/g, "")
    .replace(/[()（）[\]【】{}「」『』<>《》]/g, "")
    .replace(/[^\w一-龥]/g, "");
}

function formatTime(sec: number): string {
  const safe = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s
      .toString()
      .padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value >= 10 || idx === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[idx]}`;
}

function formatSpeed(bytesPerSec?: number): string {
  if (!bytesPerSec || !Number.isFinite(bytesPerSec) || bytesPerSec <= 0) {
    return "0 B/s";
  }
  return `${formatBytes(bytesPerSec)}/s`;
}

function useHorizontalRail<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) {
      setCanLeft(false);
      setCanRight(false);
      return;
    }
    const max = el.scrollWidth - el.clientWidth;
    setCanLeft(el.scrollLeft > 2);
    setCanRight(max > 2 && el.scrollLeft < max - 2);
  }, []);

  useEffect(() => {
    const el = ref.current;
    update();
    if (!el) return;
    const onScroll = () => update();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", update);
    const raf = window.requestAnimationFrame(update);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", update);
      window.cancelAnimationFrame(raf);
    };
  }, [update]);

  const slide = useCallback((dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.82), behavior: "smooth" });
  }, []);

  return { ref, canLeft, canRight, update, slide };
}

/** 根据 type_name 推断电影/剧集 */
function inferType(r: SearchResult): "movie" | "tv" {
  const t = (r.vod.type_name || "").toLowerCase();
  if (t.includes("电影") || t.includes("movie")) return "movie";
  if (
    t.includes("剧") ||
    t.includes("动漫") ||
    t.includes("综艺") ||
    t.includes("anime")
  )
    return "tv";
  return "movie";
}

/** 聚合后的一组 */
interface AggGroup {
  key: string;
  title: string;
  year: string;
  poster?: string;
  remarks?: string;
  type: "movie" | "tv";
  results: SearchResult[];
}

function aggregateResults(results: SearchResult[]): AggGroup[] {
  const map = new Map<string, AggGroup>();
  const order: string[] = [];
  for (const r of results) {
    const type = inferType(r);
    const year = r.vod.year && /^\d{4}$/.test(r.vod.year) ? r.vod.year : "unknown";
    const k = `${normalizeTitle(r.vod.title)}|${type}|${year}`;
    let g = map.get(k);
    if (!g) {
      g = {
        key: k,
        title: r.vod.title,
        year,
        poster: r.vod.poster,
        remarks: r.vod.vod_remarks,
        type,
        results: [],
      };
      map.set(k, g);
      order.push(k);
    } else {
      if (!g.poster && r.vod.poster) g.poster = r.vod.poster;
      if (!g.remarks && r.vod.vod_remarks) g.remarks = r.vod.vod_remarks;
    }
    g.results.push(r);
  }
  return order.map((k) => map.get(k)!);
}

interface DirectVodTarget {
  href: string;
}

async function inspectScriptForRecommendedTitle(
  desc: ScriptDescriptor,
  title: string
): Promise<DirectVodTarget | null> {
  try {
    const result = await callSearch(desc, { keyword: title, page: 1 });
    const normalizedTitle = normalizeTitle(title);
    const candidates = result.list
      .filter((vod) => vod.id)
      .sort((a, b) => {
        const ae = normalizeTitle(a.title) === normalizedTitle ? 0 : 1;
        const be = normalizeTitle(b.title) === normalizedTitle ? 0 : 1;
        return ae - be;
      })
      .slice(0, 4);

    if (candidates.length === 0) return null;

    for (const vod of candidates) {
      try {
        const detail = await callDetail(desc, { id: vod.id });
        const playbackIdx = detail.playbacks.findIndex((pb) => pb.episodes.length > 0);
        if (playbackIdx >= 0) {
          return {
            href: `/play/${encodeURIComponent(desc.key)}/${encodeURIComponent(
              vod.id
            )}/${playbackIdx}/0`,
          };
        }
      } catch (e) {
        console.warn(`[vod-home] detail failed: ${desc.key}`, e);
      }
    }

    return null;
  } catch (e) {
    console.warn(`[vod-home] search failed: ${desc.key}`, e);
    return null;
  }
}

function resolveRecommendedTarget(
  title: string,
  scripts: ScriptDescriptor[]
): Promise<DirectVodTarget | null> {
  if (scripts.length === 0) return Promise.resolve(null);

  return new Promise((resolve) => {
    let pending = scripts.length;
    let settled = false;

    const finishOne = (target: DirectVodTarget | null) => {
      if (settled) return;
      if (target) {
        settled = true;
        resolve(target);
        return;
      }
      pending -= 1;
      if (pending === 0) {
        settled = true;
        resolve(null);
      }
    };

    scripts.forEach((script) => {
      void inspectScriptForRecommendedTitle(script, title).then(finishOne);
    });
  });
}

type ViewMode = "agg" | "all";
export type DisplayMode = "card" | "list";
type VodTab = "home" | "mine";
type VodMineView = "overview" | "history" | "favorites" | "downloads" | "watchLater" | "sync";

const VIEW_KEY = "douytv:search-view";
const DISPLAY_KEY = "douytv:search-display";
const BROWSE_SCRIPT_KEY = "douytv:browse-script";
const BROWSE_SOURCE_KEY = "douytv:browse-source";
const LAST_STATE_KEY = "douytv:search-last-state";
const VOD_HOME_SCROLL_KEY = "douytv:vod-home-scroll";
const VOD_HOME_CATEGORY_CACHE_TTL_MS = 60 * 60 * 1000;
const VOD_HOME_CATEGORY_CACHE_PREFIX = "douytv:vod-home-category";
const GUESS_CACHE_TTL_MS = 60 * 60 * 1000;
const GUESS_CACHE_PREFIX = "douytv:guess-you-like";

interface LastState {
  keyword: string;
  scrollY: number;
}

interface VodHomeCategoryCacheEntry {
  expiresAt: number;
  items: DoubanItem[];
}

interface GuessCacheEntry {
  expiresAt: number;
  items: SearchResult[];
}

const vodHomeCategoryCache = new Map<string, VodHomeCategoryCacheEntry>();
const guessYouLikeCache = new Map<string, GuessCacheEntry>();
let vodHomeScrollMemory = 0;

function readLastState(): LastState | null {
  try {
    const raw = sessionStorage.getItem(LAST_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.keyword === "string") {
      return {
        keyword: parsed.keyword,
        scrollY: typeof parsed.scrollY === "number" ? parsed.scrollY : 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function saveLastState(s: LastState) {
  try {
    sessionStorage.setItem(LAST_STATE_KEY, JSON.stringify(s));
  } catch {}
}

function clearLastState() {
  try {
    sessionStorage.removeItem(LAST_STATE_KEY);
  } catch {}
}

function readVodHomeScroll(): number {
  try {
    const raw = sessionStorage.getItem(VOD_HOME_SCROLL_KEY);
    if (raw) return Number(raw) || 0;
  } catch {}
  return vodHomeScrollMemory;
}

function saveVodHomeScroll(scrollTop: number) {
  vodHomeScrollMemory = scrollTop;
  try {
    sessionStorage.setItem(VOD_HOME_SCROLL_KEY, String(scrollTop));
  } catch {}
}

function hashText(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

function scriptListSignature(scripts: ScriptDescriptor[]): string {
  return scripts
    .filter((script) => script.enabled)
    .map((script) =>
      [
        script.key,
        script.type ?? "script",
        script.api ?? "",
        script.updatedAt ?? "",
        script.installedAt ?? "",
        hashText(script.code ?? ""),
      ].join(":")
    )
    .join("|");
}

function readVodHomeCategoryCache(key: string): DoubanItem[] | undefined {
  const memory = vodHomeCategoryCache.get(key);
  if (memory && memory.expiresAt > Date.now()) return memory.items;
  if (memory) vodHomeCategoryCache.delete(key);

  try {
    const raw = localStorage.getItem(`${VOD_HOME_CATEGORY_CACHE_PREFIX}:${key}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as VodHomeCategoryCacheEntry;
    if (!parsed || parsed.expiresAt <= Date.now()) {
      localStorage.removeItem(`${VOD_HOME_CATEGORY_CACHE_PREFIX}:${key}`);
      return undefined;
    }
    vodHomeCategoryCache.set(key, parsed);
    return parsed.items;
  } catch {
    return undefined;
  }
}

function writeVodHomeCategoryCache(key: string, items: DoubanItem[]) {
  const entry: VodHomeCategoryCacheEntry = {
    expiresAt: Date.now() + VOD_HOME_CATEGORY_CACHE_TTL_MS,
    items,
  };
  vodHomeCategoryCache.set(key, entry);
  try {
    localStorage.setItem(`${VOD_HOME_CATEGORY_CACHE_PREFIX}:${key}`, JSON.stringify(entry));
  } catch {}
}

function guessYouLikeCacheKey(parts: string[]): string {
  return hashText(parts.join("|"));
}

function readGuessYouLikeCache(key: string): SearchResult[] | undefined {
  const memory = guessYouLikeCache.get(key);
  if (memory && memory.expiresAt > Date.now()) return memory.items;
  if (memory) guessYouLikeCache.delete(key);

  try {
    const raw = localStorage.getItem(`${GUESS_CACHE_PREFIX}:${key}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as GuessCacheEntry;
    if (!parsed || parsed.expiresAt <= Date.now()) {
      localStorage.removeItem(`${GUESS_CACHE_PREFIX}:${key}`);
      return undefined;
    }
    guessYouLikeCache.set(key, parsed);
    return parsed.items;
  } catch {
    return undefined;
  }
}

function writeGuessYouLikeCache(key: string, items: SearchResult[]) {
  const entry: GuessCacheEntry = {
    expiresAt: Date.now() + GUESS_CACHE_TTL_MS,
    items,
  };
  guessYouLikeCache.set(key, entry);
  try {
    localStorage.setItem(`${GUESS_CACHE_PREFIX}:${key}`, JSON.stringify(entry));
  } catch {}
}

function filterBlockedGuessRows(
  rows: SearchResult[] | undefined,
  blockedTitles: Set<string>
): SearchResult[] | undefined {
  if (!rows) return undefined;
  return rows.filter((row) => {
    const title = normalizeTitle(row.vod.title);
    return title && !blockedTitles.has(title);
  });
}

const GUESS_SEMANTIC_RULES: Array<{ term: string; patterns: string[] }> = [
  { term: "短剧", patterns: ["短剧", "微短", "逆袭", "赘婿", "霸总", "爽文"] },
  { term: "动漫", patterns: ["动漫", "动画", "番剧", "新番", "漫画"] },
  { term: "综艺", patterns: ["综艺", "真人秀", "脱口秀", "晚会"] },
  { term: "纪录片", patterns: ["纪录", "纪实", "自然", "人文"] },
  { term: "喜剧", patterns: ["喜剧", "搞笑", "欢乐"] },
  { term: "爱情", patterns: ["爱情", "恋爱", "甜宠", "都市"] },
  { term: "悬疑", patterns: ["悬疑", "推理", "探案", "谜案"] },
  { term: "犯罪", patterns: ["犯罪", "刑侦", "警匪", "扫黑"] },
  { term: "动作", patterns: ["动作", "武侠", "功夫", "格斗"] },
  { term: "科幻", patterns: ["科幻", "未来", "太空", "机甲"] },
  { term: "奇幻", patterns: ["奇幻", "玄幻", "仙侠", "魔法"] },
  { term: "恐怖", patterns: ["恐怖", "惊悚", "灵异"] },
  { term: "古装", patterns: ["古装", "宫廷", "穿越"] },
  { term: "美剧", patterns: ["美剧", "欧美", "美国"] },
  { term: "韩剧", patterns: ["韩剧", "韩国"] },
  { term: "日剧", patterns: ["日剧", "日本"] },
  { term: "国产剧", patterns: ["国产", "大陆", "内地"] },
];

interface GuessProfile {
  cacheParts: string[];
  blockedTitles: Set<string>;
  titleSeeds: string[];
  semanticTerms: string[];
  sourceKeys: string[];
  hasSignals: boolean;
}

function cleanGuessTitleSeed(title: string): string {
  return title
    .trim()
    .replace(/\[[^\]]*]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/（[^）]*）/g, "")
    .replace(/第[0-9一二三四五六七八九十百]+[季部集期]/g, "")
    .replace(/S\d+|EP?\d+/gi, "")
    .replace(/更新至.*$/g, "")
    .replace(/全\d+集.*$/g, "")
    .replace(/完结|高清|国语|粤语|中字|电影版/g, "")
    .trim();
}

function addWeighted(map: Map<string, number>, key: string | undefined, weight: number) {
  const value = key?.trim();
  if (!value) return;
  map.set(value, (map.get(value) ?? 0) + weight);
}

function rankedKeys(map: Map<string, number>, limit: number): string[] {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key)
    .slice(0, limit);
}

function addSemanticTerms(
  map: Map<string, number>,
  text: string | undefined,
  weight: number
) {
  if (!text) return;
  for (const rule of GUESS_SEMANTIC_RULES) {
    if (rule.patterns.some((pattern) => text.includes(pattern))) {
      addWeighted(map, rule.term, weight);
    }
  }
}

function buildGuessProfile({
  searchHistory,
  favorites,
  historyRecords,
  watchLater,
  downloads,
  scripts,
}: {
  searchHistory: string[];
  favorites: ReturnType<typeof useLibraryStore.getState>["favorites"];
  historyRecords: ReturnType<typeof useLibraryStore.getState>["history"];
  watchLater: WatchLaterRecord[];
  downloads: DownloadTask[];
  scripts: ScriptDescriptor[];
}): GuessProfile {
  const titleWeights = new Map<string, number>();
  const semanticWeights = new Map<string, number>();
  const sourceWeights = new Map<string, number>();
  const blockedTitles = new Set<string>();

  const addTitle = (title: string | undefined, weight: number, block = false) => {
    const seed = cleanGuessTitleSeed(title ?? "");
    if (!seed) return;
    addWeighted(titleWeights, seed, weight);
    addSemanticTerms(semanticWeights, seed, weight);
    if (block) {
      const normalized = normalizeTitle(seed);
      if (normalized) blockedTitles.add(normalized);
    }
  };

  searchHistory.slice(0, 8).forEach((kw, index) => {
    addTitle(kw, 9 - index, false);
    addSemanticTerms(semanticWeights, kw, 6 - Math.min(index, 4));
  });
  favorites.slice(0, 18).forEach((item, index) => {
    addTitle(item.title, 14 - Math.min(index, 8), true);
    addWeighted(sourceWeights, item.scriptKey, 8 - Math.min(index, 5));
    addSemanticTerms(semanticWeights, item.sourceName, 3);
  });
  historyRecords.slice(0, 24).forEach((item, index) => {
    const progressWeight =
      item.duration > 0 ? Math.min(4, Math.max(0, item.position / item.duration) * 4) : 0;
    addTitle(item.title, 10 - Math.min(index, 7) + progressWeight, true);
    addWeighted(sourceWeights, item.scriptKey, 6 - Math.min(index, 4) + progressWeight);
    addSemanticTerms(semanticWeights, item.sourceName, 2);
  });
  watchLater.slice(0, 18).forEach((item, index) => {
    addTitle(item.title, 12 - Math.min(index, 8), true);
    addWeighted(sourceWeights, item.scriptKey, 7 - Math.min(index, 5));
    addSemanticTerms(semanticWeights, item.sourceName, 3);
  });
  downloads.slice(0, 18).forEach((item, index) => {
    addTitle(item.title, 8 - Math.min(index, 6), true);
    addWeighted(sourceWeights, item.scriptKey, 5 - Math.min(index, 4));
    addSemanticTerms(semanticWeights, item.sourceName, 2);
  });

  const titleSeeds = rankedKeys(titleWeights, 6);
  const semanticTerms = rankedKeys(semanticWeights, 6);
  const sourceKeys = rankedKeys(sourceWeights, 5);
  return {
    cacheParts: [
      searchHistory.slice(0, 8).join(","),
      favorites.slice(0, 12).map((item) => `${item.itemId}:${item.addedAt}`).join(","),
      historyRecords.slice(0, 12).map((item) => `${item.itemId}:${item.updatedAt}`).join(","),
      watchLater.slice(0, 12).map((item) => `${item.itemId}:${item.addedAt}`).join(","),
      downloads.slice(0, 12).map((item) => `${item.itemId}:${item.updatedAt}`).join(","),
      scriptListSignature(scripts),
    ],
    blockedTitles,
    titleSeeds,
    semanticTerms,
    sourceKeys,
    hasSignals:
      searchHistory.length > 0 ||
      favorites.length > 0 ||
      historyRecords.length > 0 ||
      watchLater.length > 0 ||
      downloads.length > 0,
  };
}

function readViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "all" ? "all" : "agg";
  } catch {
    return "agg";
  }
}

function readDisplayMode(): DisplayMode {
  try {
    const v = localStorage.getItem(DISPLAY_KEY);
    return v === "list" ? "list" : "card";
  } catch {
    return "card";
  }
}

function readVodTab(): VodTab {
  return "home";
}

export default function Search() {
  const navigate = useNavigate();
  const [vodTab, setVodTabState] = useState<VodTab>(readVodTab);
  const [mineView, setMineView] = useState<VodMineView>("overview");
  const [searchOpen, setSearchOpen] = useState(false);
  const [showSourceBrowse, setShowSourceBrowse] = useState(false);
  const [input, setInput] = useState("");
  const [directPlayTitle, setDirectPlayTitle] = useState<string | undefined>(undefined);
  const [directPlayError, setDirectPlayError] = useState<string | undefined>(undefined);
  const {
    results,
    loading,
    error,
    keyword,
    page,
    search,
    history,
    removeHistory,
    clearHistory,
    totalScripts,
    completedScripts,
    fromCache,
  } = useSearch();
  const scripts = useScriptStore((s) => s.scripts);
  const hydrateScripts = useScriptStore((s) => s.hydrate);
  const enabledScripts = useMemo(() => scripts.filter((s) => s.enabled), [scripts]);
  const favorites = useLibraryStore((s) => s.favorites);
  const historyRecords = useLibraryStore((s) => s.history);
  const clearWatchHistory = useLibraryStore((s) => s.clearHistory);
  const hydrateLibrary = useLibraryStore((s) => s.hydrate);
  const watchLater = useVodAssetsStore((s) => s.watchLater);
  const downloads = useVodAssetsStore((s) => s.downloads);
  const hydrateVodAssets = useVodAssetsStore((s) => s.hydrate);
  const removeWatchLater = useVodAssetsStore((s) => s.removeWatchLater);
  const clearWatchLater = useVodAssetsStore((s) => s.clearWatchLater);
  const removeDownloadTask = useVodAssetsStore((s) => s.removeDownloadTask);
  const clearDownloadTasks = useVodAssetsStore((s) => s.clearDownloads);
  const updateDownloadTask = useVodAssetsStore((s) => s.updateDownloadTask);

  const [viewMode, setViewMode] = useState<ViewMode>(readViewMode);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(readDisplayMode);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    hydrateLibrary();
    hydrateScripts();
    hydrateVodAssets();
  }, [hydrateLibrary, hydrateScripts, hydrateVodAssets]);

  const setVodTab = (tab: VodTab) => {
    setVodTabState(tab);
    setSearchOpen(false);
    if (tab === "home") setMineView("overview");
  };

  const handleContentScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (!searchOpen && vodTab === "home") {
        saveVodHomeScroll(event.currentTarget.scrollTop);
      }
    },
    [searchOpen, vodTab]
  );

  useEffect(() => {
    if (searchOpen || vodTab !== "home") return;
    const target = readVodHomeScroll();
    if (target <= 0) return;

    const restore = () => {
      if (contentRef.current) contentRef.current.scrollTop = target;
    };
    const raf = window.requestAnimationFrame(restore);
    const timer = window.setTimeout(restore, 80);
    const lateTimer = window.setTimeout(restore, 220);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      window.clearTimeout(lateTimer);
    };
  }, [searchOpen, vodTab]);

  // 跨页面持久化：从详情/播放返回后恢复 keyword/results/scroll。
  // sessionStorage 寿命与 Tauri 进程一致；results 由 useSearch search-cache 回填。
  const keywordRef = useRef(keyword);
  keywordRef.current = keyword;
  const pendingScrollRef = useRef<number | null>(null);
  const restoredRef = useRef(false);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const last = readLastState();
    if (last && last.keyword) {
      setInput(last.keyword);
      void search(last.keyword);
      pendingScrollRef.current = last.scrollY;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const save = () => {
      const kw = keywordRef.current;
      if (kw) {
        saveLastState({ keyword: kw, scrollY: window.scrollY });
      } else {
        clearLastState();
      }
    };
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("pagehide", save);
      save();
    };
  }, []);

  useEffect(() => {
    if (pendingScrollRef.current == null) return;
    if (results.length === 0) return;
    const y = pendingScrollRef.current;
    pendingScrollRef.current = null;
    requestAnimationFrame(() => {
      window.scrollTo(0, y);
    });
  }, [results.length]);

  // ── 分类浏览状态（仅在 keyword 为空时显示） ──────────────────────────
  // 用户选了源后 callGetSources 拉子分类；选了子分类后 callRecommend 展示
  const [browseScriptKey, setBrowseScriptKey] = useState<string>(() => {
    try {
      return localStorage.getItem(BROWSE_SCRIPT_KEY) || "";
    } catch {
      return "";
    }
  });
  const [browseSourceId, setBrowseSourceId] = useState<string>(() => {
    try {
      return localStorage.getItem(BROWSE_SOURCE_KEY) || "";
    } catch {
      return "";
    }
  });
  const [browseSubSources, setBrowseSubSources] = useState<ScriptSourceItem[]>([]);
  const [browseSubLoading, setBrowseSubLoading] = useState(false);
  const [browseResults, setBrowseResults] = useState<SearchResult[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | undefined>(undefined);
  const [browsePage, setBrowsePage] = useState(1);
  const [browseHasMore, setBrowseHasMore] = useState(true);
  const [browseMode, setBrowseMode] = useState<"browse" | "search">("browse");
  const [browseSearchInput, setBrowseSearchInput] = useState("");
  const [browseSearchKeyword, setBrowseSearchKeyword] = useState("");

  useEffect(() => {
    if (browseScriptKey || enabledScripts.length === 0) return;
    const first = enabledScripts[0]?.key || "";
    if (!first) return;
    setBrowseScriptKey(first);
    try {
      localStorage.setItem(BROWSE_SCRIPT_KEY, first);
    } catch {}
  }, [browseScriptKey, enabledScripts]);

  // 选源变化后拉子分类，重置 sub source 选择
  useEffect(() => {
    if (!browseScriptKey) {
      setBrowseSubSources([]);
      return;
    }
    const desc = enabledScripts.find((s) => s.key === browseScriptKey);
    if (!desc) {
      setBrowseSubSources([]);
      return;
    }
    setBrowseSubLoading(true);
    let cancelled = false;
    getSourceCategories(desc)
      .then((list) => {
        if (cancelled) return;
        setBrowseSubSources(list);
        setBrowseResults([]);
        setBrowsePage(1);
        setBrowseHasMore(true);
        const first = list[0]?.id || "";
        if (first) {
          setBrowseSourceId(first);
          try {
            localStorage.setItem(BROWSE_SOURCE_KEY, first);
          } catch {}
        } else {
          setBrowseSourceId("");
          try {
            localStorage.removeItem(BROWSE_SOURCE_KEY);
          } catch {}
        }
      })
      .catch((e) => {
        if (!cancelled) {
          console.warn("[browse] getSources failed", e);
          setBrowseSubSources([]);
        }
      })
      .finally(() => {
        if (!cancelled) setBrowseSubLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [browseScriptKey, enabledScripts]);

  // 选了 script + sourceId 后按分类浏览；搜索模式只使用当前源和关键词。
  const loadBrowse = async (
    p: number,
    replace: boolean,
    mode: "browse" | "search" = browseMode,
    searchKeyword: string = browseSearchKeyword
  ) => {
    if (!browseScriptKey) return;
    if (mode === "browse" && !browseSourceId) return;
    if (mode === "search" && !searchKeyword.trim()) return;
    const desc = enabledScripts.find((s) => s.key === browseScriptKey);
    if (!desc) return;
    setBrowseLoading(true);
    setBrowseError(undefined);
    try {
      const r =
        mode === "search"
          ? await searchSourceVideos(desc, searchKeyword.trim(), p)
          : await loadSourceCategoryVideos(desc, browseSourceId, p);
      setBrowseResults((prev) => (replace ? r.rows : [...prev, ...r.rows]));
      setBrowsePage(p);
      setBrowseHasMore((r.page || p) < (r.pageCount || p));
    } catch (e) {
      setBrowseError((e as Error)?.message ?? String(e));
    } finally {
      setBrowseLoading(false);
    }
  };

  useEffect(() => {
    if (!keyword && browseMode === "browse" && browseScriptKey && browseSourceId) {
      void loadBrowse(1, true, "browse");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browseScriptKey, browseSourceId, keyword, browseMode]);

  const pickBrowseScript = (key: string) => {
    setBrowseScriptKey(key);
    setBrowseSourceId("");
    setBrowseResults([]);
    setBrowsePage(1);
    setBrowseHasMore(true);
    setBrowseMode("browse");
    setBrowseSearchKeyword("");
    try {
      localStorage.setItem(BROWSE_SCRIPT_KEY, key);
      localStorage.removeItem(BROWSE_SOURCE_KEY);
    } catch {}
  };

  const pickBrowseSubSource = (id: string) => {
    setBrowseSourceId(id);
    setBrowseResults([]);
    setBrowsePage(1);
    setBrowseHasMore(true);
    setBrowseMode("browse");
    try {
      localStorage.setItem(BROWSE_SOURCE_KEY, id);
    } catch {}
  };

  const submitBrowseSearch = () => {
    const kw = browseSearchInput.trim();
    if (!kw || !browseScriptKey) return;
    setBrowseMode("search");
    setBrowseSearchKeyword(kw);
    setBrowseResults([]);
    setBrowsePage(1);
    setBrowseHasMore(true);
    void loadBrowse(1, true, "search", kw);
  };

  const backToBrowseMode = () => {
    setBrowseMode("browse");
    setBrowseSearchKeyword("");
    setBrowseResults([]);
    setBrowsePage(1);
    setBrowseHasMore(true);
    if (browseScriptKey && browseSourceId) {
      void loadBrowse(1, true, "browse");
    }
  };

  // ── 搜索模式的聚合结果（无筛选，直接聚合）─────────────────────────
  const aggregated = useMemo(() => aggregateResults(results), [results]);
  const visibleCount = viewMode === "agg" ? aggregated.length : results.length;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchOpen(true);
    const kw = input.trim();
    if (!kw) {
      void search("");
      return;
    }
    search(kw);
  };

  const quickSearch = (kw: string) => {
    setInput(kw);
    setSearchOpen(true);
    search(kw);
  };

  useEffect(() => {
    if (searchOpen && input.trim() === "" && keyword) {
      void search("");
    }
  }, [input, keyword, search, searchOpen]);

  const openRecommendedTitle = async (title: string) => {
    const kw = title.trim();
    if (!kw || directPlayTitle) return;
    if (contentRef.current) saveVodHomeScroll(contentRef.current.scrollTop);
    setDirectPlayTitle(kw);
    setDirectPlayError(undefined);
    try {
      const target = await resolveRecommendedTarget(kw, enabledScripts);
      if (target) {
        navigate(target.href);
        return;
      }
      setDirectPlayError(`未找到可播放片源「${kw}」`);
      window.setTimeout(() => {
        setDirectPlayError((msg) => (msg === `未找到可播放片源「${kw}」` ? undefined : msg));
      }, 2600);
    } finally {
      setDirectPlayTitle(undefined);
    }
  };

  const toggleViewMode = () => {
    const next = viewMode === "agg" ? "all" : "agg";
    setViewMode(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {}
  };

  const setDisplay = (d: DisplayMode) => {
    setDisplayMode(d);
    try {
      localStorage.setItem(DISPLAY_KEY, d);
    } catch {}
  };

  const clearVodHistory = async () => {
    if (historyRecords.length === 0) return;
    if (!(await appConfirm("清空全部播放历史和继续观看记录？", { tone: "danger" }))) return;
    clearWatchHistory();
  };

  const clearVodWatchLater = async () => {
    if (watchLater.length === 0) return;
    if (!(await appConfirm("清空全部稍后观看记录？", { tone: "danger" }))) return;
    clearWatchLater();
  };

  const clearVodDownloads = async () => {
    if (downloads.length === 0) return;
    if (!(await appConfirm("清空全部下载任务？", { tone: "danger" }))) return;
    clearDownloadTasks();
  };

  const startVodDownloadTask = async (taskId: string) => {
    const task = useVodAssetsStore
      .getState()
      .downloads.find((row) => row.id === taskId);
    if (!task) return;
    const script = scripts.find((row) => row.key === task.scriptKey);
    if (!script) {
      updateDownloadTask(taskId, {
        status: "error",
        message: "找不到对应视频源",
      });
      return;
    }
    try {
      await resumeVodDownload(taskId);
      updateDownloadTask(taskId, {
        status: "downloading",
        progress: task.progress || 0,
        message: "准备下载",
      });
      const detail = await callDetail(script, { id: task.vodId });
      const playback =
        detail.playbacks[task.playbackIndex] ?? detail.playbacks[0];
      const episode =
        playback?.episodes[task.episodeIndex] ?? playback?.episodes[0];
      if (!playback || episode === undefined) {
        updateDownloadTask(taskId, {
          status: "error",
          message: "找不到可下载剧集",
        });
        return;
      }
      await startVodDownload({
        task,
        script,
        episode,
        sourceId: playback.sourceId,
      });
    } catch (e) {
      updateDownloadTask(taskId, {
        status: "error",
        message: (e as Error)?.message ?? String(e),
      });
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-ink text-cream">
      <div
        className="relative shrink-0 flex items-center justify-between gap-3 px-4 pt-4 pb-3 backdrop-blur-xl"
        style={{
          background: "rgba(14,15,17,0.92)",
          borderBottom: "1px solid var(--cream-line)",
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {searchOpen ? (
            <button
              type="button"
              onClick={() => setSearchOpen(false)}
              className="w-9 h-9 rounded-full flex items-center justify-center tap text-cream-dim hover:text-cream"
              style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
              aria-label="返回点播"
            >
              <IconChevronLeft size={16} />
            </button>
          ) : (
            <>
              <span className="rec-dot" />
              <span className="hidden sm:inline font-display text-sm font-extrabold text-cream">
                点播
              </span>
            </>
          )}
          {searchOpen && (
            <div className="min-w-0">
              <p className="font-display text-base font-extrabold text-cream">搜索</p>
              <p className="font-mono text-[10px] text-cream-faint">SEARCH VOD</p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!searchOpen && (
            <button
              type="button"
              onClick={() => setVodTab(vodTab === "mine" ? "home" : "mine")}
              className="w-10 h-10 rounded-full flex items-center justify-center tap text-cream-dim hover:text-ember"
              style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
              aria-label={vodTab === "mine" ? "返回首页" : "我的"}
              title={vodTab === "mine" ? "首页" : "我的"}
            >
              {vodTab === "mine" ? <IconHome size={16} /> : <IconArtist size={16} />}
            </button>
          )}
        </div>
      </div>

      {searchOpen && (
      <form
        onSubmit={onSubmit}
        className="shrink-0 flex items-center gap-2 px-4 py-3"
        style={{
          background: "rgba(14,15,17,0.78)",
          borderBottom: "1px solid var(--cream-line)",
        }}
      >
        <div
          className="search-field-shell flex-1 flex items-center gap-2 px-3 py-2 rounded-full"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
        >
          <IconSearch size={14} className="text-cream-faint" />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
            placeholder="搜索电影、剧集、综艺、动漫"
            className="search-field-input flex-1 bg-transparent text-sm outline-none text-cream placeholder:text-cream-faint"
          />
          {input && (
            <button
              type="button"
              onClick={() => setInput("")}
              className="text-cream-faint hover:text-cream tap p-0.5"
              aria-label="清除"
            >
              <IconClose size={14} />
            </button>
          )}
        </div>
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 rounded-full text-xs font-display font-semibold tracking-wider tap disabled:opacity-50"
          style={{ background: "var(--ember)", color: "var(--ink)" }}
        >
          搜索
        </button>
      </form>
      )}

      <div
        ref={contentRef}
        onScroll={handleContentScroll}
        className="flex-1 min-h-0 overflow-y-auto p-4"
        style={{ paddingBottom: "calc(var(--bottom-tab-h, 56px) + env(safe-area-inset-bottom) + 112px)" }}
      >

      {!searchOpen && vodTab === "home" && (
        <VodHome
          onPickTitle={(title) => void openRecommendedTitle(title)}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenSourceBrowse={() => setShowSourceBrowse(true)}
          onSearchCategory={(routeKey) => {
            if (contentRef.current) saveVodHomeScroll(contentRef.current.scrollTop);
            navigate(routeKey);
          }}
          scripts={enabledScripts}
          historyRecords={historyRecords}
          resolvingTitle={directPlayTitle}
          directPlayError={directPlayError}
          onClearHistory={clearVodHistory}
        />
      )}

      {!searchOpen && vodTab === "mine" && (
        <VodMine
          favorites={favorites}
          historyRecords={historyRecords}
          watchLater={watchLater}
          downloads={downloads}
          scriptsCount={enabledScripts.length}
          view={mineView}
          onViewChange={setMineView}
          onClearHistory={clearVodHistory}
          onRemoveWatchLater={removeWatchLater}
          onClearWatchLater={clearVodWatchLater}
          onRemoveDownload={removeDownloadTask}
          onClearDownloads={clearVodDownloads}
          onStartDownload={(id) => void startVodDownloadTask(id)}
        />
      )}

      {/* 历史紧贴搜索栏下方，仅未输入关键词时显示 */}
      {searchOpen && !keyword && history.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
              RECENT
            </p>
            <button
              type="button"
              onClick={clearHistory}
              className="text-[10px] text-cream-faint hover:text-cream-dim font-mono tracking-wider"
            >
              CLEAR
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {history.map((kw) => (
              <div
                key={kw}
                className="group flex items-center rounded-full overflow-hidden"
                style={{
                  background: "var(--ink-2)",
                  border: "1px solid var(--cream-line)",
                }}
              >
                <button
                  type="button"
                  onClick={() => quickSearch(kw)}
                  className="px-3 py-1.5 text-xs hover:bg-ink-3 text-cream tap"
                >
                  {kw}
                </button>
                <button
                  type="button"
                  onClick={() => removeHistory(kw)}
                  className="px-2 py-1.5 text-cream-faint hover:text-ember border-l"
                  style={{ borderColor: "var(--cream-line)" }}
                >
                  <IconClose size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* =================== 浏览模式（未输入关键词） =================== */}
      {searchOpen && !keyword && (
        <GuessYouLike
          searchHistory={history}
          favorites={favorites}
          historyRecords={historyRecords}
          watchLater={watchLater}
          downloads={downloads}
          scripts={enabledScripts}
        />
      )}

      {/* =================== 搜索模式（有关键词） =================== */}
      {searchOpen && keyword && (
        <>
          {/* 状态条 */}
          <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 font-mono text-[10px] tracking-wider text-cream-faint">
              <span className="text-cream">「{keyword}」</span>
              <span>·</span>
              {fromCache ? (
                <span className="text-phosphor">CACHED</span>
              ) : (
                <span>
                  {completedScripts}/{totalScripts} 源
                </span>
              )}
              <span>·</span>
              <span className="text-ember">{visibleCount} 结果</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => search(keyword, 1, { force: true })}
                disabled={loading}
                className="w-8 h-8 rounded-lg flex items-center justify-center tap text-cream-dim hover:text-cream disabled:opacity-50"
                style={{
                  background: "var(--ink-2)",
                  border: "1px solid var(--cream-line)",
                }}
                aria-label="刷新"
                title="忽略缓存重新搜索"
              >
                <IconRefresh size={14} className={loading ? "animate-spin" : ""} />
              </button>
              <button
                type="button"
                onClick={toggleViewMode}
                className="px-2.5 h-8 rounded-lg flex items-center gap-1.5 text-[11px] font-display tap"
                style={{
                  background: viewMode === "agg" ? "var(--ember-soft)" : "var(--ink-2)",
                  border: `1px solid ${
                    viewMode === "agg" ? "var(--ember)" : "var(--cream-line)"
                  }`,
                  color: viewMode === "agg" ? "var(--ember)" : "var(--cream-dim)",
                }}
              >
                聚合
              </button>
              <div
                className="flex rounded-lg overflow-hidden"
                style={{ border: "1px solid var(--cream-line)" }}
              >
                <button
                  type="button"
                  onClick={() => setDisplay("card")}
                  className="w-8 h-8 flex items-center justify-center tap"
                  style={{
                    background:
                      displayMode === "card" ? "var(--ember-soft)" : "var(--ink-2)",
                    color: displayMode === "card" ? "var(--ember)" : "var(--cream-dim)",
                  }}
                >
                  <IconGrid size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setDisplay("list")}
                  className="w-8 h-8 flex items-center justify-center tap"
                  style={{
                    background:
                      displayMode === "list" ? "var(--ember-soft)" : "var(--ink-2)",
                    color: displayMode === "list" ? "var(--ember)" : "var(--cream-dim)",
                    borderLeft: "1px solid var(--cream-line)",
                  }}
                >
                  <IconList size={14} />
                </button>
              </div>
            </div>
          </div>

          {loading && results.length === 0 && (
            <div className="flex items-center gap-3 text-cream-dim text-xs">
              <span className="signal-bars">
                <span></span>
                <span></span>
                <span></span>
              </span>
              <span className="font-mono tracking-wider">SEARCHING...</span>
            </div>
          )}
          {error && <p className="text-ember text-sm">{error}</p>}
          {!loading && !error && results.length === 0 && (
            <p className="text-cream-faint text-sm">没有匹配结果</p>
          )}

          {results.length > 0 && (
            <>
              {displayMode === "card" ? (
                <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2 mt-2">
                  {viewMode === "agg"
                    ? aggregated.map((g) => <CardAgg key={g.key} group={g} />)
                    : results.map((r) => (
                        <CardOne key={`${r.scriptKey}:${r.vod.id}`} r={r} />
                      ))}
                </div>
              ) : (
                <div className="space-y-2 mt-2">
                  {viewMode === "agg"
                    ? aggregated.map((g) => <ListAgg key={g.key} group={g} />)
                    : results.map((r) => (
                        <ListOne key={`${r.scriptKey}:${r.vod.id}`} r={r} />
                      ))}
                </div>
              )}
              <div className="mt-5 flex justify-center">
                <button
                  type="button"
                  onClick={() => search(keyword, page + 1)}
                  disabled={loading}
                  className="px-5 py-2 rounded-full text-xs font-display font-semibold tap disabled:opacity-50"
                  style={{
                    background: "var(--ink-2)",
                    border: "1px solid var(--cream-line)",
                    color: "var(--cream)",
                  }}
                >
                  {loading ? "加载中..." : `加载第 ${page + 1} 页`}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/* 历史已移到搜索栏下方 */}
      </div>
      {showSourceBrowse && (
        <SourceBrowseModal
          scripts={enabledScripts}
          browseScriptKey={browseScriptKey}
          browseSourceId={browseSourceId}
          browseSubSources={browseSubSources}
          browseSubLoading={browseSubLoading}
          browseResults={browseResults}
          browseLoading={browseLoading}
          browseError={browseError}
          browseHasMore={browseHasMore}
          browseMode={browseMode}
          browseSearchInput={browseSearchInput}
          browseSearchKeyword={browseSearchKeyword}
          setBrowseSearchInput={setBrowseSearchInput}
          submitBrowseSearch={submitBrowseSearch}
          backToBrowseMode={backToBrowseMode}
          pickBrowseScript={pickBrowseScript}
          pickBrowseSubSource={pickBrowseSubSource}
          loadMore={() => void loadBrowse(browsePage + 1, false)}
          displayMode={displayMode}
          setDisplay={setDisplay}
          onClose={() => setShowSourceBrowse(false)}
        />
      )}
    </div>
  );
}
function GuessYouLike({
  searchHistory,
  favorites,
  historyRecords,
  watchLater,
  downloads,
  scripts,
}: {
  searchHistory: string[];
  favorites: ReturnType<typeof useLibraryStore.getState>["favorites"];
  historyRecords: ReturnType<typeof useLibraryStore.getState>["history"];
  watchLater: WatchLaterRecord[];
  downloads: DownloadTask[];
  scripts: ScriptDescriptor[];
}) {
  const profile = useMemo(
    () =>
      buildGuessProfile({
        searchHistory,
        favorites,
        historyRecords,
        watchLater,
        downloads,
        scripts,
      }),
    [downloads, favorites, historyRecords, scripts, searchHistory, watchLater]
  );
  const cacheKey = guessYouLikeCacheKey(profile.cacheParts);
  const [items, setItems] = useState<SearchResult[]>(
    () => filterBlockedGuessRows(readGuessYouLikeCache(cacheKey), profile.blockedTitles) ?? []
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!profile.hasSignals || scripts.length === 0) {
      setItems([]);
      return;
    }

    let cancelled = false;
    const cached = filterBlockedGuessRows(
      readGuessYouLikeCache(cacheKey),
      profile.blockedTitles
    );
    const collected = cached ? [...cached] : [];
    setLoading(!cached?.length);
    setItems(collected);
    const seen = new Set<string>(
      collected.map((row) => normalizeTitle(row.vod.title)).filter(Boolean)
    );
    profile.blockedTitles.forEach((title) => seen.add(title));

    const preferredScripts = profile.sourceKeys
      .map((key) => scripts.find((script) => script.key === key))
      .filter((script): script is ScriptDescriptor => !!script);
    const fallbackScripts = [
      ...preferredScripts,
      ...scripts.filter((script) => !profile.sourceKeys.includes(script.key)),
    ].slice(0, 5);

    const pushRows = (rows: SearchResult[], limitPerJob: number) => {
      if (cancelled) return;
      setItems((prev) => {
        const next = [...prev];
        for (const row of rows.slice(0, limitPerJob)) {
          const key = normalizeTitle(row.vod.title);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          next.push(row);
          collected.push(row);
          if (next.length >= 18) break;
        }
        const trimmed = next.slice(0, 18);
        writeGuessYouLikeCache(cacheKey, trimmed);
        return trimmed;
      });
    };

    const sourceJobs = (preferredScripts.length > 0 ? preferredScripts : fallbackScripts)
      .slice(0, 4)
      .map(async (script) => {
        try {
          const result = await loadSourceCategoryVideos(script, "", 1);
          pushRows(result.rows, 8);
        } catch (e) {
          console.warn(`[guess:source] ${script.key} failed`, e);
        }
      });

    const semanticJobs = profile.semanticTerms.slice(0, 4).flatMap((term, index) =>
      fallbackScripts.slice(0, index < 2 ? 4 : 2).map(async (script) => {
        try {
          const result = await searchSourceVideos(script, term, 1);
          pushRows(result.rows, 5);
        } catch (e) {
          console.warn(`[guess:term] ${script.key}:${term} failed`, e);
        }
      })
    );

    const titleJobs = profile.titleSeeds.slice(0, 3).flatMap((seed) =>
      fallbackScripts.slice(0, 2).map(async (script) => {
        try {
          const result = await searchSourceVideos(script, seed, 1);
          pushRows(result.rows, 3);
        } catch (e) {
          console.warn(`[guess:title] ${script.key}:${seed} failed`, e);
        }
      })
    );

    const jobs = [...sourceJobs, ...semanticJobs, ...titleJobs];
    void Promise.allSettled(jobs).then(() => {
      if (!cancelled) {
        writeGuessYouLikeCache(cacheKey, collected.slice(0, 18));
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, profile, scripts]);

  if (!profile.hasSignals) {
    return (
      <EmptyStatePanel
        icon={<IconSearch size={26} />}
        title="还没有搜索记录"
        desc="搜索后会根据记录生成猜你喜欢。"
      />
    );
  }

  return (
    <section>
      <SectionTitle
        eyebrow="FOR YOU"
        title="猜你喜欢"
        action={loading ? "加载中" : `${items.length} 项`}
      />
      {items.length === 0 ? (
        <EmptyVodText>
          {loading ? "正在生成推荐..." : "暂无猜你喜欢内容"}
        </EmptyVodText>
      ) : (
        <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2">
          {items.map((item) => (
            <CardOne key={`${item.scriptKey}:${item.vod.id}`} r={item} />
          ))}
        </div>
      )}
    </section>
  );
}
function SourceBrowseModal({
  onClose,
  ...props
}: {
  scripts: ScriptDescriptor[];
  browseScriptKey: string;
  browseSourceId: string;
  browseSubSources: ScriptSourceItem[];
  browseSubLoading: boolean;
  browseResults: SearchResult[];
  browseLoading: boolean;
  browseError?: string;
  browseHasMore: boolean;
  browseMode: "browse" | "search";
  browseSearchInput: string;
  browseSearchKeyword: string;
  setBrowseSearchInput: (value: string) => void;
  submitBrowseSearch: () => void;
  backToBrowseMode: () => void;
  pickBrowseScript: (key: string) => void;
  pickBrowseSubSource: (id: string) => void;
  loadMore: () => void;
  displayMode: DisplayMode;
  setDisplay: (d: DisplayMode) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink text-cream animate-fade-in">
      <div
        className="shrink-0 flex items-center justify-between gap-3 px-4 pt-4 pb-3"
        style={{
          paddingTop: "calc(env(safe-area-inset-top) + 16px)",
          borderBottom: "1px solid var(--cream-line)",
          background: "rgba(14,15,17,0.94)",
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full grid place-items-center tap text-cream-dim hover:text-ember shrink-0"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            aria-label="Back"
          >
            <IconChevronLeft size={16} />
          </button>
          <span
            className="w-9 h-9 rounded-full grid place-items-center text-ember"
            style={{ background: "var(--ember-soft)", border: "1px solid rgba(255,107,53,0.3)" }}
          >
            <IconAntenna size={16} />
          </span>
          <div className="min-w-0">
            <p className="font-display text-base font-extrabold text-cream">源站寻片</p>
            <p className="font-mono text-[10px] text-cream-faint">按视频源浏览分类内容</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="hidden"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          aria-label="关闭按源搜索"
        >
          <IconClose size={16} />
        </button>
      </div>
      <div
        className="shrink-0 p-4"
        style={{
          background: "rgba(14,15,17,0.9)",
          borderBottom: "1px solid var(--cream-line)",
        }}
      >
        <div className="mx-auto w-full max-w-5xl">
          <BrowseFilters {...props} />
        </div>
      </div>
      <div
        className="flex-1 min-h-0 overflow-y-auto p-4"
        style={{ paddingBottom: "calc(var(--bottom-tab-h, 56px) + env(safe-area-inset-bottom) + 24px)" }}
      >
        <div className="mx-auto w-full max-w-6xl">
          <BrowseResults {...props} />
        </div>
      </div>
    </div>
  );
}

function VodHome({
  onPickTitle,
  onOpenSearch,
  onOpenSourceBrowse,
  onSearchCategory,
  scripts,
  historyRecords,
  resolvingTitle,
  directPlayError,
  onClearHistory,
}: {
  onPickTitle: (title: string) => void;
  onOpenSearch: () => void;
  onOpenSourceBrowse: () => void;
  onSearchCategory: (keyword: string) => void;
  scripts: ScriptDescriptor[];
  historyRecords: ReturnType<typeof useLibraryStore.getState>["history"];
  resolvingTitle?: string;
  directPlayError?: string;
  onClearHistory: () => void;
}) {
  return (
    <div className="space-y-7">
      <HotRecommendations
        onPickTitle={onPickTitle}
        variant="home"
        resolvingTitle={resolvingTitle}
        onOpenSearch={onOpenSearch}
        onOpenSourceBrowse={onOpenSourceBrowse}
      />
      {directPlayError && (
        <p className="-mt-4 text-[11px] font-mono text-ember">{directPlayError}</p>
      )}
      {historyRecords.length > 0 ? (
        <ContinueWatchingRow
          historyRecords={historyRecords.slice(0, 10)}
          onClear={onClearHistory}
        />
      ) : (
        <section>
          <SectionTitle eyebrow="HISTORY" title="最近观看" action="0" />
          <EmptyVodText>还没有播放历史，开始播放后会出现在这里。</EmptyVodText>
        </section>
      )}
      <VodCategoryRails
        onPickTitle={onPickTitle}
        onSearchCategory={onSearchCategory}
        scripts={scripts}
        resolvingTitle={resolvingTitle}
      />
    </div>
  );
}

const VOD_HOME_CATEGORIES: Array<{
  key: "hotMovies" | "hotDuanju" | "bangumiCalendar" | "hotTvShows" | "hotVarietyShows";
  title: string;
  eyebrow: string;
  label: string;
  href: string;
}> = [
  { key: "hotMovies", title: "热门电影", eyebrow: "MOVIES", label: "recent_hot · movie", href: "/douban?type=movie" },
  { key: "hotDuanju", title: "热播短剧", eyebrow: "SHORTS", label: "source · duanju", href: "/duanju" },
  { key: "bangumiCalendar", title: "新番放送", eyebrow: "ANIME", label: "Bangumi · today", href: "/douban?type=anime" },
  { key: "hotTvShows", title: "热门剧集", eyebrow: "SERIES", label: "recent_hot · tv", href: "/douban?type=tv" },
  { key: "hotVarietyShows", title: "热门综艺", eyebrow: "SHOWS", label: "recent_hot · show", href: "/douban?type=show" },
];

function vodHomeCategoryCacheKey(
  category: (typeof VOD_HOME_CATEGORIES)[number],
  scripts: ScriptDescriptor[]
): string {
  const suffix =
    category.key === "hotDuanju" ? `:${hashText(scriptListSignature(scripts))}` : "";
  return `${category.key}${suffix}`;
}

async function loadVodHomeCategoryItems(
  category: (typeof VOD_HOME_CATEGORIES)[number],
  scripts: ScriptDescriptor[]
): Promise<DoubanItem[]> {
  if (category.key === "hotMovies") {
    return fetchDoubanRecentHot({
      kind: "movie",
      category: "热门",
      type: "全部",
      limit: 18,
      start: 0,
    });
  }
  if (category.key === "hotTvShows") {
    return fetchDoubanRecentHot({
      kind: "tv",
      category: "tv",
      type: "tv",
      limit: 18,
      start: 0,
    });
  }
  if (category.key === "hotVarietyShows") {
    return fetchDoubanRecentHot({
      kind: "tv",
      category: "show",
      type: "show",
      limit: 18,
      start: 0,
    });
  }
  if (category.key === "bangumiCalendar") {
    return (await fetchTodayBangumi()).slice(0, 18);
  }
  const rows = await fetchDuanjuRecommendations(scripts, 18);
  return rows.map((row) => ({
    id: `${row.scriptKey}:${row.vod.id}`,
    title: row.vod.title,
    cover: row.vod.poster || "",
    poster: row.vod.poster || "",
    rate: "",
    year: row.vod.year,
    kind: "tv" as const,
  }));
}

function VodCategoryRails({
  onPickTitle,
  onSearchCategory,
  scripts,
  resolvingTitle,
}: {
  onPickTitle: (title: string) => void;
  onSearchCategory: (keyword: string) => void;
  scripts: ScriptDescriptor[];
  resolvingTitle?: string;
}) {
  return (
    <div className="space-y-7">
      {VOD_HOME_CATEGORIES.map((category) => (
        <VodCategoryRail
          key={category.key}
          category={category}
          onPickTitle={onPickTitle}
          onSearchCategory={onSearchCategory}
          scripts={scripts}
          resolvingTitle={resolvingTitle}
        />
      ))}
    </div>
  );
}

function VodCategoryRail({
  category,
  onPickTitle,
  onSearchCategory,
  scripts,
  resolvingTitle,
}: {
  category: (typeof VOD_HOME_CATEGORIES)[number];
  onPickTitle: (title: string) => void;
  onSearchCategory: (keyword: string) => void;
  scripts: ScriptDescriptor[];
  resolvingTitle?: string;
}) {
  const { ref: rowRef, canLeft, canRight, update, slide } = useHorizontalRail<HTMLDivElement>();
  const cacheKey = vodHomeCategoryCacheKey(category, scripts);
  const [items, setItems] = useState<DoubanItem[]>(
    () => readVodHomeCategoryCache(cacheKey) ?? []
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const cached = readVodHomeCategoryCache(cacheKey);
    if (cached) setItems(cached);
    else setItems([]);
    setLoading(!cached?.length);
    setError(undefined);
    loadVodHomeCategoryItems(category, scripts)
      .then((next) => {
        if (!cancelled) {
          writeVodHomeCategoryCache(cacheKey, next);
          setItems(next);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError((e as Error)?.message ?? String(e));
          if (!cached?.length) setItems([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, category, scripts]);

  useEffect(() => {
    const raf = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(raf);
  }, [items.length, update]);

  if (category.key === "hotDuanju" && !loading && !error && items.length === 0) {
    return null;
  }

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <p className="font-mono text-[10px] tracking-[0.22em] text-cream-faint">
            {category.eyebrow} · {category.label}
          </p>
          <h2 className="font-display text-lg font-extrabold text-cream">{category.title}</h2>
        </div>
        <button
          type="button"
          onClick={() => onSearchCategory(category.href)}
          className="inline-flex items-center gap-1 font-display text-xs text-cream-faint hover:text-ember tap transition-colors"
        >
          查看更多
          <IconChevronRight size={14} />
        </button>
      </div>
      {error && <p className="mb-2 text-[11px] font-mono text-ember">加载失败：{error}</p>}
      <div className="relative group">
        {canLeft && (
          <button
            type="button"
            onClick={() => slide(-1)}
            className="hidden md:grid absolute left-2 top-1/2 -translate-y-1/2 z-10 w-10 h-10 place-items-center rounded-full tap backdrop-blur-md text-cream opacity-0 group-hover:opacity-100 transition-opacity"
            style={{
              background: "rgba(14,15,17,0.72)",
              border: "1px solid rgba(242,232,213,0.22)",
              boxShadow: "0 10px 24px rgba(0,0,0,0.34)",
            }}
            aria-label={`${category.title} 上一屏`}
          >
            <IconChevronLeft size={17} />
          </button>
        )}
        <div
          ref={rowRef}
          className="flex gap-3 overflow-x-auto scrollbar-hide scroll-smooth pr-8"
        >
          {items.map((item) => (
            <button
              key={`${category.title}:${item.id}`}
              type="button"
              onClick={() => onPickTitle(item.title)}
              className="w-[7.5rem] sm:w-[8.5rem] md:w-36 shrink-0 text-left tap"
              title={`播放「${item.title}」`}
            >
              <div
                className="aspect-[3/4] rounded-lg overflow-hidden relative scanlines"
                style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
              >
                {item.cover ? (
                  <img
                    src={wrapImage(item.cover)}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                    alt={item.title}
                    loading="lazy"
                  />
                ) : (
                  <div className="absolute inset-0 grid place-items-center text-cream-faint">
                    <IconFilm size={28} />
                  </div>
                )}
                {item.rate && Number(item.rate) > 0 && (
                  <span
                    className="absolute top-1 right-1 font-mono text-[9px] px-1.5 py-0.5 rounded"
                    style={{
                      background: "rgba(14,15,17,0.85)",
                      color: "var(--ember)",
                      border: "1px solid rgba(255,107,53,0.3)",
                    }}
                  >
                    {item.rate}
                  </span>
                )}
                {resolvingTitle === item.title && (
                  <div className="absolute inset-0 grid place-items-center bg-black/45">
                    <span className="signal-bars" style={{ height: 18 }}>
                      <span></span>
                      <span></span>
                      <span></span>
                    </span>
                  </div>
                )}
              </div>
              <p className="mt-1.5 text-xs font-display font-semibold text-cream line-clamp-1">
                {item.title}
              </p>
            </button>
          ))}
          {loading && items.length === 0 && (
            <div className="h-40 flex items-center gap-2 text-[10px] font-mono text-cream-faint">
              <span className="signal-bars" style={{ height: 12 }}>
                <span></span>
                <span></span>
                <span></span>
              </span>
              加载中...
            </div>
          )}
        </div>
        {canRight && (
          <button
            type="button"
            onClick={() => slide(1)}
            className="hidden md:grid absolute right-2 top-1/2 -translate-y-1/2 z-10 w-10 h-10 place-items-center rounded-full tap backdrop-blur-md text-cream opacity-0 group-hover:opacity-100 transition-opacity"
            style={{
              background: "rgba(14,15,17,0.72)",
              border: "1px solid rgba(242,232,213,0.22)",
              boxShadow: "0 10px 24px rgba(0,0,0,0.34)",
            }}
            aria-label={`${category.title} 下一屏`}
          >
            <IconChevronRight size={17} />
          </button>
        )}
      </div>
    </section>
  );
}

function VodMine({
  favorites,
  historyRecords,
  watchLater,
  downloads,
  scriptsCount,
  view,
  onViewChange,
  onClearHistory,
  onRemoveWatchLater,
  onClearWatchLater,
  onRemoveDownload,
  onClearDownloads,
  onStartDownload,
}: {
  favorites: ReturnType<typeof useLibraryStore.getState>["favorites"];
  historyRecords: ReturnType<typeof useLibraryStore.getState>["history"];
  watchLater: WatchLaterRecord[];
  downloads: DownloadTask[];
  scriptsCount: number;
  view: VodMineView;
  onViewChange: (view: VodMineView) => void;
  onClearHistory: () => void;
  onRemoveWatchLater: (itemId: string) => void;
  onClearWatchLater: () => void;
  onRemoveDownload: (id: string) => void;
  onClearDownloads: () => void;
  onStartDownload: (id: string) => void;
}) {
  const totalWatchSeconds = historyRecords.reduce(
    (acc, h) => acc + (h.position || 0),
    0
  );
  const completedCount = historyRecords.filter((h) => h.completed).length;
  const recentHistory = historyRecords.slice(0, 30);

  if (view !== "overview") {
    return (
      <VodMineSubPage
        view={view}
        favorites={favorites}
        historyRecords={historyRecords}
        watchLater={watchLater}
        downloads={downloads}
        onBack={() => onViewChange("overview")}
        onClearHistory={onClearHistory}
        onRemoveWatchLater={onRemoveWatchLater}
        onClearWatchLater={onClearWatchLater}
        onRemoveDownload={onRemoveDownload}
        onClearDownloads={onClearDownloads}
        onStartDownload={onStartDownload}
      />
    );
  }

  return (
    <div className="space-y-7">
      <section
        className="relative overflow-hidden rounded-lg p-4"
        style={{
          background: "linear-gradient(135deg, rgba(255,107,53,0.14), rgba(124,255,178,0.08)), var(--ink-2)",
          border: "1px solid var(--cream-line)",
        }}
      >
        <div
          className="absolute right-0 top-0 w-32 h-32 rounded-full blur-3xl opacity-30"
          style={{ background: "var(--ember)", transform: "translate(32px,-48px)" }}
        />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.22em] text-cream-faint">
              VOD PROFILE
            </p>
            <h2 className="mt-1 font-display text-2xl font-extrabold text-cream">
              点播个人中心
            </h2>
            <p className="mt-2 text-xs text-cream-dim">
              收藏、历史、下载和稍后观看统一管理，已看完 {completedCount} 部，稍后 {watchLater.length} 部。
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="font-display text-2xl font-extrabold text-ember">
              {Math.floor(totalWatchSeconds / 3600)}h
            </p>
            <p className="font-mono text-[10px] text-cream-faint">观看时长</p>
          </div>
        </div>
        <div className="relative mt-5 space-y-2">
          <div className="flex justify-between font-mono text-[10px] text-cream-faint">
            <span>视频源启用</span>
            <span>{scriptsCount} 个</span>
          </div>
          <div className="h-1.5 rounded-full bg-ink-3 overflow-hidden">
            <div
              className="h-full bg-ember"
              style={{ width: `${Math.min(100, scriptsCount * 8)}%` }}
            />
          </div>
        </div>
      </section>

      <section>
        <SectionTitle eyebrow="PLAYLISTS" title="我的影单" action={`${watchLater.length} 稍后`} />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <PlaylistTile
            title="我的收藏"
            count={favorites.length}
            posters={favorites.map((f) => f.poster)}
            onClick={() => onViewChange("favorites")}
          />
          <PlaylistTile
            title="继续观看"
            count={historyRecords.length}
            posters={historyRecords.map((h) => h.poster)}
            onClick={() => onViewChange("history")}
          />
          <PlaylistTile
            title="稍后观看"
            count={watchLater.length}
            posters={watchLater.map((f) => f.poster)}
            onClick={() => onViewChange("watchLater")}
          />
          <PlaylistTile
            title="下载任务"
            count={downloads.length}
            posters={downloads.map((d) => d.poster)}
            onClick={() => onViewChange("downloads")}
          />
        </div>
      </section>

      <section>
        <SectionTitle
          eyebrow="HISTORY"
          title="播放历史"
          action={recentHistory.length > 0 ? "清空" : `${recentHistory.length}`}
          onAction={recentHistory.length > 0 ? onClearHistory : undefined}
        />
        {recentHistory.length === 0 ? (
          <EmptyVodText>还没有播放历史。</EmptyVodText>
        ) : (
          <HistoryList historyRecords={recentHistory} />
        )}
      </section>
    </div>
  );
}

function ContinueWatchingRow({
  historyRecords,
  onClear,
}: {
  historyRecords: ReturnType<typeof useLibraryStore.getState>["history"];
  onClear?: () => void;
}) {
  const { ref: rowRef, canLeft, canRight, update, slide } = useHorizontalRail<HTMLDivElement>();

  useEffect(() => {
    const raf = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(raf);
  }, [historyRecords.length, update]);

  return (
    <section>
      <SectionTitle
        eyebrow="CONTINUE"
        title="继续观看"
        action={historyRecords.length > 0 ? "清空" : `${historyRecords.length}`}
        onAction={historyRecords.length > 0 ? onClear : undefined}
      />
      <div className="relative group">
        {canLeft && (
          <button
            type="button"
            onClick={() => slide(-1)}
            className="hidden md:grid absolute left-2 top-1/2 -translate-y-1/2 z-10 w-10 h-10 place-items-center rounded-full tap backdrop-blur-md text-cream opacity-0 group-hover:opacity-100 transition-opacity"
            style={{
              background: "rgba(14,15,17,0.72)",
              border: "1px solid rgba(242,232,213,0.22)",
              boxShadow: "0 10px 24px rgba(0,0,0,0.34)",
            }}
            aria-label="继续观看上一屏"
          >
            <IconChevronLeft size={17} />
          </button>
        )}
        <div ref={rowRef} className="flex gap-3 overflow-x-auto scrollbar-hide scroll-smooth pr-8">
          {historyRecords.map((h) => {
            const ratio = h.duration > 0 ? h.position / h.duration : 0;
            const href = `/play/${encodeURIComponent(h.scriptKey)}/${encodeURIComponent(h.vodId)}/0/${h.episodeIndex}`;
            return (
              <Link
                key={h.itemId}
                to={href}
                className="w-64 shrink-0 rounded-lg overflow-hidden tap"
                style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
              >
                <div className="aspect-video relative scanlines" style={{ background: "var(--ink-3)" }}>
                  {h.poster ? (
                    <img src={h.poster} alt={h.title} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center text-cream-faint">
                      <IconFilm size={28} />
                    </div>
                  )}
                  <div className="absolute inset-0 grid place-items-center bg-black/28">
                    <span
                      className="w-11 h-11 rounded-full grid place-items-center"
                      style={{
                        background: "rgba(14,15,17,0.62)",
                        border: "1px solid var(--cream-line)",
                        color: "var(--ember)",
                      }}
                    >
                      <IconPlay size={18} />
                    </span>
                  </div>
                </div>
                <div className="h-1 bg-ink-3">
                  <div className="h-full bg-ember" style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                </div>
                <div className="p-2">
                  <p className="text-sm font-display font-semibold line-clamp-1">{h.title}</p>
                  <p className="font-mono text-[10px] text-cream-faint mt-0.5">
                    {formatTime(h.duration - h.position)} left
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
        {canRight && (
          <button
            type="button"
            onClick={() => slide(1)}
            className="hidden md:grid absolute right-2 top-1/2 -translate-y-1/2 z-10 w-10 h-10 place-items-center rounded-full tap backdrop-blur-md text-cream opacity-0 group-hover:opacity-100 transition-opacity"
            style={{
              background: "rgba(14,15,17,0.72)",
              border: "1px solid rgba(242,232,213,0.22)",
              boxShadow: "0 10px 24px rgba(0,0,0,0.34)",
            }}
            aria-label="继续观看下一屏"
          >
            <IconChevronRight size={17} />
          </button>
        )}
      </div>
    </section>
  );
}

function LibraryPosterCard({
  to,
  title,
  poster,
  meta,
  actionLabel,
  onAction,
}: {
  to: string;
  title: string;
  poster?: string;
  meta?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div
      className="rounded-lg overflow-hidden flex flex-col"
      style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
    >
      <Link to={to} className="flex-1 flex flex-col tap">
        <div className="aspect-[3/4] relative scanlines" style={{ background: "var(--ink-3)" }}>
          {poster ? (
            <img src={poster} alt={title} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-cream-faint">
              <IconFilm size={28} />
            </div>
          )}
        </div>
        <div className="p-2">
          <p className="text-xs font-display line-clamp-1">{title}</p>
          {meta && (
            <p className="font-mono text-[10px] text-cream-faint mt-0.5 line-clamp-1">
              @{meta}
            </p>
          )}
        </div>
      </Link>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mx-2 mb-2 h-7 rounded text-[10px] font-mono tap flex items-center justify-center gap-1 text-cream-faint hover:text-ember"
          style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
        >
          <IconTrash size={12} />
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function DownloadTaskList({
  downloads,
  onRemove,
  onStart,
  onPause,
}: {
  downloads: DownloadTask[];
  onRemove: (id: string) => void;
  onStart: (id: string) => void;
  onPause: (id: string) => void;
}) {
  const openDownloadedPath = async (path: string, reveal = false) => {
    try {
      await openVodDownloadPath(path, reveal);
    } catch (e) {
      void appAlert((e as Error)?.message ?? String(e), { title: "打开失败", tone: "warning" });
    }
  };

  const activeDownloads = downloads.filter((task) => task.status !== "done");
  const completedDownloads = downloads.filter((task) => task.status === "done");
  const [tab, setTab] = useState<"active" | "completed">(
    activeDownloads.length === 0 && completedDownloads.length > 0
      ? "completed"
      : "active"
  );

  useEffect(() => {
    if (tab === "active" && activeDownloads.length === 0 && completedDownloads.length > 0) {
      setTab("completed");
    }
    if (tab === "completed" && completedDownloads.length === 0 && activeDownloads.length > 0) {
      setTab("active");
    }
  }, [activeDownloads.length, completedDownloads.length, tab]);

  const renderTask = (task: DownloadTask) => {
    const status = downloadStatusMeta(task.status);
    const progress = Math.max(0, Math.min(100, task.progress));
    const isActive = task.status === "downloading" || task.status === "queued";
    const isComplete = task.status === "done";

    return (
      <div
        key={task.id}
        className="group rounded-lg p-2.5 flex items-center gap-3 transition-colors"
        style={{
          background: "rgba(32,31,31,0.72)",
          border: "1px solid var(--cream-line)",
        }}
      >
        <Link
          to={`/detail/${encodeURIComponent(task.scriptKey)}/${encodeURIComponent(task.vodId)}`}
          className="w-16 h-16 shrink-0 rounded-lg overflow-hidden scanlines relative tap"
          style={{ background: "var(--ink-3)" }}
        >
          {task.poster ? (
            <img
              src={task.poster}
              alt={task.title}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-cream-faint">
              <IconFilm size={22} />
            </div>
          )}
        </Link>
        <div className="flex-1 min-w-0 py-0.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-display font-semibold line-clamp-1 group-hover:text-ember transition-colors">
                {task.title}
              </p>
              <p className="font-mono text-[10px] text-cream-faint mt-0.5 line-clamp-1">
                {task.episodeTitle} · @{task.sourceName || task.scriptKey}
              </p>
            </div>
            <span
              className="shrink-0 px-2 py-1 rounded font-mono text-[9px]"
              style={{
                color: status.color,
                background: status.background,
                border: `1px solid ${status.border}`,
              }}
            >
              {isActive ? `${Math.round(progress)}% · ${formatSpeed(task.speedBytesPerSec)}` : status.label}
            </span>
          </div>
          <div className="mt-2 h-[2px] rounded-full bg-ink-3 overflow-hidden group-hover:h-1 transition-all">
            <div
              className="h-full rounded-full"
              style={{
                width: `${progress}%`,
                background: status.color,
                boxShadow:
                  task.status === "downloading"
                    ? `0 0 8px ${status.color}`
                    : undefined,
              }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="min-w-0 flex-1 font-mono text-[10px] text-cream-faint line-clamp-1">
              {task.localPath
                ? `${formatBytes(task.downloadedBytes ?? 0)} · ${task.localPath}`
                : task.status === "downloading"
                  ? `${task.message || "下载中"} · ${formatBytes(task.downloadedBytes ?? 0)} · ${formatSpeed(task.speedBytesPerSec)}`
                  : task.message || formatBytes(task.downloadedBytes ?? 0)}
            </p>
            <div className="shrink-0 flex items-center gap-1.5">
              {isActive && (
                <button
                  type="button"
                  onClick={() => onPause(task.id)}
                  className="w-8 h-8 rounded-full grid place-items-center tap"
                  style={{
                    background: "rgba(255,107,53,0.12)",
                    color: "var(--ember)",
                    border: "1px solid rgba(255,107,53,0.28)",
                  }}
                  aria-label="暂停"
                  title="暂停"
                >
                  <IconClose size={13} />
                </button>
              )}
              {!isComplete && !isActive && (
                <button
                  type="button"
                  onClick={() => onStart(task.id)}
                  className="w-8 h-8 rounded-full grid place-items-center tap"
                  style={{
                    background: "rgba(124,255,178,0.12)",
                    color: "var(--phosphor)",
                    border: "1px solid rgba(124,255,178,0.28)",
                  }}
                  aria-label={task.status === "paused" ? "继续" : "开始"}
                  title={task.status === "paused" ? "继续" : task.status === "error" ? "重试" : "开始"}
                >
                  <IconDownload size={13} />
                </button>
              )}
              {isComplete && task.localPath && (
                <button
                  type="button"
                  onClick={() => void openDownloadedPath(task.localPath!)}
                  className="w-8 h-8 rounded-full grid place-items-center tap"
                  style={{
                    background: "rgba(124,255,178,0.12)",
                    color: "var(--phosphor)",
                    border: "1px solid rgba(124,255,178,0.28)",
                  }}
                  aria-label="打开"
                  title="打开"
                >
                  <IconPlay size={13} />
                </button>
              )}
              {isComplete && task.localPath && (
                <button
                  type="button"
                  onClick={() => void openDownloadedPath(task.localPath!, true)}
                  className="w-8 h-8 rounded-full grid place-items-center tap text-cream"
                  style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
                  aria-label="定位"
                  title="定位"
                >
                  <IconDownload size={13} />
                </button>
              )}
              <Link
                to={`/detail/${encodeURIComponent(task.scriptKey)}/${encodeURIComponent(task.vodId)}`}
                className="w-8 h-8 rounded-full grid place-items-center tap text-cream"
                style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
                aria-label="详情"
                title="详情"
              >
                <IconPlay size={13} />
              </Link>
              <button
                type="button"
                onClick={() => onRemove(task.id)}
                className="w-8 h-8 rounded-full grid place-items-center tap text-cream-faint hover:text-ember"
                style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
                aria-label="删除"
                title="删除"
              >
                <IconTrash size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const visibleDownloads = tab === "active" ? activeDownloads : completedDownloads;
  const emptyText =
    tab === "active" ? "当前没有下载中的任务" : "当前没有已完成的任务";

  return (
    <div className="space-y-4">
      <div
        className="grid grid-cols-2 rounded-lg p-1"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
      >
        <button
          type="button"
          onClick={() => setTab("active")}
          className="rounded-md py-2 text-center font-mono text-[10px] tap transition-colors"
          style={{
            background: tab === "active" ? "var(--ink-3)" : "transparent",
            color: tab === "active" ? "var(--phosphor)" : "var(--cream-faint)",
            boxShadow: tab === "active" ? "0 0 14px rgba(124,255,178,0.16)" : undefined,
          }}
        >
          下载中 {activeDownloads.length}
        </button>
        <button
          type="button"
          onClick={() => setTab("completed")}
          className="rounded-md py-2 text-center font-mono text-[10px] tap transition-colors"
          style={{
            background: tab === "completed" ? "var(--ink-3)" : "transparent",
            color: tab === "completed" ? "var(--phosphor)" : "var(--cream-faint)",
            boxShadow: tab === "completed" ? "0 0 14px rgba(124,255,178,0.16)" : undefined,
          }}
        >
          已完成 {completedDownloads.length}
        </button>
      </div>

      {visibleDownloads.length > 0 ? (
        <section className="space-y-2">
          <SectionTitle
            eyebrow={tab === "active" ? "ACTIVE" : "COMPLETED"}
            title={tab === "active" ? "下载队列" : "已完成"}
            action={`${visibleDownloads.length}`}
          />
          {visibleDownloads.map(renderTask)}
        </section>
      ) : (
        <EmptyVodText>{emptyText}</EmptyVodText>
      )}
    </div>
  );

}

function downloadStatusMeta(status: DownloadTask["status"]) {
  if (status === "done") {
    return {
      label: "已完成",
      color: "var(--phosphor)",
      background: "rgba(124,255,178,0.12)",
      border: "rgba(124,255,178,0.28)",
    };
  }
  if (status === "downloading") {
    return {
      label: "下载中",
      color: "var(--phosphor)",
      background: "rgba(124,255,178,0.12)",
      border: "rgba(124,255,178,0.28)",
    };
  }
  if (status === "error") {
    return {
      label: "失败",
      color: "var(--ember)",
      background: "rgba(255,107,53,0.12)",
      border: "rgba(255,107,53,0.28)",
    };
  }
  if (status === "paused") {
    return {
      label: "已暂停",
      color: "var(--cream-dim)",
      background: "rgba(244,230,210,0.08)",
      border: "var(--cream-line)",
    };
  }
  return {
    label: "排队中",
    color: "var(--vhs)",
    background: "rgba(89,213,255,0.12)",
    border: "rgba(89,213,255,0.28)",
  };
}

function VodSyncPanel() {
  const baseUrl = useSyncStore((s) => s.baseUrl);
  const autoIntervalMin = useSyncStore((s) => s.autoIntervalMin);
  const lastSyncAt = useSyncStore((s) => s.lastSyncAt);
  const syncing = useSyncStore((s) => s.syncing);
  const lastError = useSyncStore((s) => s.lastError);
  const hydrateSync = useSyncStore((s) => s.hydrate);
  const testConnection = useSyncStore((s) => s.testConnection);
  const pushNow = useSyncStore((s) => s.pushNow);
  const pullNow = useSyncStore((s) => s.pullNow);
  const hydrateVodAssets = useVodAssetsStore((s) => s.hydrate);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | undefined>();

  useEffect(() => {
    hydrateSync();
  }, [hydrateSync]);

  const runTest = async () => {
    setMessage(undefined);
    const result = await testConnection();
    setMessage({
      ok: result.ok,
      text: result.ok ? "连接正常" : result.message ?? "连接失败",
    });
  };

  const runPush = async () => {
    setMessage(undefined);
    const result = await pushNow();
    setMessage({
      ok: result.ok,
      text: result.ok ? "点播数据已推送到 WebDAV" : result.message ?? "推送失败",
    });
  };

  const runPull = async () => {
    if (!(await appConfirm("拉取远端数据会覆盖本机 DouyTV 设置、脚本、订阅，确认继续？", { tone: "warning" }))) {
      return;
    }
    setMessage(undefined);
    const result = await pullNow();
    if (result.ok) hydrateVodAssets(true);
    setMessage({
      ok: result.ok,
      text: result.ok
        ? `已恢复 ${result.applied ?? 0} 项数据`
        : result.message ?? "拉取失败",
    });
  };

  return (
    <section className="space-y-3">
      <SectionTitle eyebrow="SYNC" title="同步备份" action={baseUrl ? "已配置" : "未配置"} />
      <div
        className="rounded-lg p-4"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
          <SyncInfoTile
            label="WebDAV"
            value={baseUrl ? "已配置" : "未配置"}
            tone={baseUrl ? "phosphor" : "cream"}
          />
          <SyncInfoTile
            label="自动推送"
            value={autoIntervalMin > 0 ? `${autoIntervalMin} 分钟` : "关闭"}
            tone={autoIntervalMin > 0 ? "vhs" : "cream"}
          />
          <SyncInfoTile
            label="最近同步"
            value={lastSyncAt ? new Date(lastSyncAt).toLocaleString() : "暂无"}
            tone="ember"
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Link
            to="/settings/sync"
            className="h-10 rounded-lg text-xs font-display font-semibold tap flex items-center justify-center gap-1.5 text-cream"
            style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
          >
            <IconRefresh size={14} />
            配置
          </Link>
          <button
            type="button"
            onClick={() => void runTest()}
            disabled={syncing || !baseUrl}
            className="h-10 rounded-lg text-xs font-display font-semibold tap flex items-center justify-center gap-1.5 disabled:opacity-45"
            style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
          >
            <IconCheck size={14} />
            测试
          </button>
          <button
            type="button"
            onClick={() => void runPush()}
            disabled={syncing || !baseUrl}
            className="h-10 rounded-lg text-xs font-display font-semibold tap flex items-center justify-center gap-1.5 disabled:opacity-45"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            <IconUpload size={14} />
            {syncing ? "处理中" : "推送"}
          </button>
          <button
            type="button"
            onClick={() => void runPull()}
            disabled={syncing || !baseUrl}
            className="h-10 rounded-lg text-xs font-display font-semibold tap flex items-center justify-center gap-1.5 disabled:opacity-45"
            style={{
              background: "rgba(89,213,255,0.14)",
              color: "var(--vhs)",
              border: "1px solid rgba(89,213,255,0.28)",
            }}
          >
            <IconDownload size={14} />
            拉取
          </button>
        </div>

        {(message || lastError) && (
          <p
            className="mt-3 p-2 rounded text-xs font-mono"
            style={
              message?.ok
                ? {
                    background: "rgba(124,255,178,0.12)",
                    color: "var(--phosphor)",
                    border: "1px solid rgba(124,255,178,0.25)",
                  }
                : {
                    background: "rgba(255,107,53,0.10)",
                    color: "var(--ember)",
                    border: "1px solid rgba(255,107,53,0.25)",
                  }
            }
          >
            {message?.text || lastError}
          </p>
        )}
      </div>
    </section>
  );
}

function SyncInfoTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ember" | "vhs" | "phosphor" | "cream";
}) {
  return (
    <div
      className="rounded-lg p-3 min-w-0"
      style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
    >
      <p className="font-mono text-[10px] text-cream-faint">{label}</p>
      <p
        className="mt-1 text-xs font-display font-semibold line-clamp-1"
        style={{ color: tone === "cream" ? "var(--cream)" : `var(--${tone})` }}
      >
        {value}
      </p>
    </div>
  );
}

function PlaylistTile({
  title,
  count,
  posters,
  onClick,
}: {
  title: string;
  count: number;
  posters: Array<string | undefined>;
  onClick: () => void;
}) {
  const visiblePosters = posters.filter(Boolean).slice(0, 4);
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[198px] sm:min-h-[210px] rounded-lg p-2 text-left tap flex flex-col justify-between overflow-hidden"
      style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
    >
      <div className="grid grid-cols-2 gap-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="aspect-square rounded overflow-hidden"
            style={{ background: "var(--ink-3)" }}
          >
            {visiblePosters[i] ? (
              <img
                src={visiblePosters[i]}
                alt=""
                className="w-full h-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full grid place-items-center text-cream-faint">
                <IconFilm size={16} />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="min-w-0">
        <p className="font-display text-sm font-semibold text-cream line-clamp-1">
          {title}
        </p>
        <p className="font-mono text-[10px] text-cream-faint">{count} 部视频</p>
      </div>
    </button>
  );
}

function VodMineSubPage({
  view,
  favorites,
  historyRecords,
  watchLater,
  downloads,
  onBack,
  onClearHistory,
  onRemoveWatchLater,
  onClearWatchLater,
  onRemoveDownload,
  onClearDownloads,
  onStartDownload,
}: {
  view: Exclude<VodMineView, "overview">;
  favorites: ReturnType<typeof useLibraryStore.getState>["favorites"];
  historyRecords: ReturnType<typeof useLibraryStore.getState>["history"];
  watchLater: WatchLaterRecord[];
  downloads: DownloadTask[];
  onBack: () => void;
  onClearHistory: () => void;
  onRemoveWatchLater: (itemId: string) => void;
  onClearWatchLater: () => void;
  onRemoveDownload: (id: string) => void;
  onClearDownloads: () => void;
  onStartDownload: (id: string) => void;
}) {
  const titleMap: Record<Exclude<VodMineView, "overview">, string> = {
    history: "播放历史",
    favorites: "我的收藏",
    downloads: "下载管理",
    watchLater: "稍后观看",
    sync: "同步备份",
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="w-9 h-9 rounded-full grid place-items-center tap text-cream"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          aria-label="返回"
        >
          <IconChevronLeft size={16} />
        </button>
        <div className="min-w-0">
          <p className="font-mono text-[10px] tracking-[0.22em] text-cream-faint">
            MY VOD
          </p>
          <h2 className="font-display text-xl font-extrabold text-cream">
            {titleMap[view]}
          </h2>
        </div>
      </div>

      {view === "history" && (
        <section>
          <SectionTitle
            eyebrow="HISTORY"
            title="全部播放历史"
            action={historyRecords.length > 0 ? "清空" : "0"}
            onAction={historyRecords.length > 0 ? onClearHistory : undefined}
          />
          {historyRecords.length === 0 ? (
            <EmptyVodText>还没有播放历史。</EmptyVodText>
          ) : (
            <HistoryList historyRecords={historyRecords} />
          )}
        </section>
      )}

      {view === "favorites" && (
        <section>
          <SectionTitle eyebrow="FAVORITES" title="我的收藏" action={`${favorites.length}`} />
          {favorites.length === 0 ? (
            <EmptyVodText>还没有收藏内容。</EmptyVodText>
          ) : (
            <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2">
              {favorites.map((f) => (
                <LibraryPosterCard
                  key={f.itemId}
                  to={`/detail/${encodeURIComponent(f.scriptKey)}/${encodeURIComponent(f.vodId)}`}
                  title={f.title}
                  poster={f.poster}
                  meta={f.sourceName}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {view === "watchLater" && (
        <section>
          <SectionTitle
            eyebrow="WATCH LATER"
            title="稍后观看"
            action={watchLater.length > 0 ? "清空" : "0"}
            onAction={watchLater.length > 0 ? onClearWatchLater : undefined}
          />
          {watchLater.length === 0 ? (
            <EmptyStatePanel
              icon={<IconBookmark size={26} />}
              title="还没有稍后观看"
              desc="在点播详情页点击稍后观看后，内容会出现在这里。"
            />
          ) : (
            <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2">
              {watchLater.map((f) => (
                <LibraryPosterCard
                  key={f.itemId}
                  to={`/detail/${encodeURIComponent(f.scriptKey)}/${encodeURIComponent(f.vodId)}`}
                  title={f.title}
                  poster={f.poster}
                  meta={f.sourceName}
                  actionLabel="移除"
                  onAction={() => onRemoveWatchLater(f.itemId)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {view === "downloads" && (
        <section>
          <SectionTitle
            eyebrow="DOWNLOADS"
            title="下载管理"
            action={downloads.length > 0 ? "清空" : "0"}
            onAction={downloads.length > 0 ? onClearDownloads : undefined}
          />
          {downloads.length === 0 ? (
            <EmptyStatePanel
              icon={<IconDownload size={26} />}
              title="还没有下载任务"
              desc="在点播详情页点击加入下载后，任务会出现在这里。"
            />
          ) : (
            <DownloadTaskList
              downloads={downloads}
              onRemove={onRemoveDownload}
              onStart={onStartDownload}
              onPause={(id) => void pauseVodDownload(id)}
            />
          )}
        </section>
      )}

      {view === "sync" && <VodSyncPanel />}
    </div>
  );
}

function HistoryList({
  historyRecords,
}: {
  historyRecords: ReturnType<typeof useLibraryStore.getState>["history"];
}) {
  return (
    <div className="space-y-2">
      {historyRecords.map((h) => {
        const ratio = h.duration > 0 ? Math.min(1, h.position / h.duration) : 0;
        return (
          <Link
            key={h.itemId}
            to={`/play/${encodeURIComponent(h.scriptKey)}/${encodeURIComponent(
              h.vodId
            )}/0/${h.episodeIndex}`}
            className="flex items-center gap-3 rounded-lg p-2 tap"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          >
            <div
              className="w-24 h-14 rounded overflow-hidden relative shrink-0 scanlines"
              style={{ background: "var(--ink-3)" }}
            >
              {h.poster ? (
                <img
                  src={h.poster}
                  alt={h.title}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center text-cream-faint">
                  <IconFilm size={22} />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-display font-semibold line-clamp-1">{h.title}</p>
              <p className="font-mono text-[10px] text-cream-faint mt-0.5">
                第{h.episodeIndex + 1} 集 · {formatTime(h.position)} /{" "}
                {formatTime(h.duration)}
              </p>
              <div className="mt-2 h-1 rounded-full bg-ink-3 overflow-hidden">
                <div className="h-full bg-ember" style={{ width: `${Math.round(ratio * 100)}%` }} />
              </div>
            </div>
            <span
              className="w-9 h-9 rounded-full grid place-items-center shrink-0"
              style={{
                background: "rgba(255,107,53,0.12)",
                color: "var(--ember)",
                border: "1px solid rgba(255,107,53,0.28)",
              }}
            >
              <IconPlay size={14} />
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function EmptyStatePanel({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div
      className="rounded-lg p-6 text-center"
      style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
    >
      <div
        className="mx-auto mb-3 w-12 h-12 rounded-full grid place-items-center"
        style={{
          background: "rgba(255,107,53,0.12)",
          color: "var(--ember)",
          border: "1px solid rgba(255,107,53,0.24)",
        }}
      >
        {icon}
      </div>
      <p className="font-display text-base font-bold text-cream">{title}</p>
      <p className="mt-2 text-sm text-cream-faint leading-relaxed">{desc}</p>
    </div>
  );
}

function SectionTitle({
  eyebrow,
  title,
  action,
  onAction,
}: {
  eyebrow: string;
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex items-end justify-between gap-3 mb-3">
      <div>
        <p className="font-mono text-[10px] tracking-[0.22em] text-cream-faint">{eyebrow}</p>
        <h2 className="font-display text-lg font-extrabold text-cream">{title}</h2>
      </div>
      {action &&
        (onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="font-mono text-[10px] text-cream-faint hover:text-ember tap"
          >
            {action}
          </button>
        ) : (
          <span className="font-mono text-[10px] text-cream-faint">{action}</span>
        ))}
    </div>
  );
}

function EmptyVodText({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-cream-faint">{children}</p>;
}

// =================== 浏览模式 ===================

type BrowseSectionProps = {
  scripts: ScriptDescriptor[];
  browseScriptKey: string;
  browseSourceId: string;
  browseSubSources: ScriptSourceItem[];
  browseSubLoading: boolean;
  browseResults: SearchResult[];
  browseLoading: boolean;
  browseError?: string;
  browseHasMore: boolean;
  browseMode: "browse" | "search";
  browseSearchInput: string;
  browseSearchKeyword: string;
  setBrowseSearchInput: (value: string) => void;
  submitBrowseSearch: () => void;
  backToBrowseMode: () => void;
  pickBrowseScript: (key: string) => void;
  pickBrowseSubSource: (id: string) => void;
  loadMore: () => void;
  displayMode: DisplayMode;
  setDisplay: (d: DisplayMode) => void;
};

function BrowseFilters({
  scripts,
  browseScriptKey,
  browseSourceId,
  browseSubSources,
  browseSubLoading,
  browseResults,
  browseLoading,
  browseMode,
  browseSearchInput,
  browseSearchKeyword,
  setBrowseSearchInput,
  submitBrowseSearch,
  backToBrowseMode,
  pickBrowseScript,
  pickBrowseSubSource,
  displayMode,
  setDisplay,
}: BrowseSectionProps) {
  if (scripts.length === 0) {
    return (
      <p className="text-cream-faint text-sm mt-2">
        还没有启用的视频源，请先到设置中启用点播源。
      </p>
    );
  }

  const subSourceGroups = browseSubSources.reduce<Record<string, ScriptSourceItem[]>>(
    (acc, s) => {
      const g = s.group || "其他";
      (acc[g] = acc[g] || []).push(s);
      return acc;
    },
    {}
  );
  const subSourceGroupKeys = Object.keys(subSourceGroups);

  return (
    <div className="space-y-2">
      <ChipRow
        label="源"
        value={browseScriptKey}
        options={[
          { value: "", label: "选择源" },
          ...scripts.map((s) => ({ value: s.key, label: s.name })),
        ]}
        onChange={pickBrowseScript}
      />
      {browseScriptKey && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitBrowseSearch();
          }}
          className="flex items-center gap-2 pl-12"
        >
          <div
            className="flex-1 flex items-center gap-2 px-3 py-2 rounded-full min-w-0"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          >
            <IconSearch size={14} className="text-cream-faint" />
            <input
              value={browseSearchInput}
              onChange={(e) => setBrowseSearchInput(e.target.value)}
              placeholder="搜索当前视频源..."
              className="flex-1 min-w-0 bg-transparent text-sm outline-none text-cream placeholder:text-cream-faint"
            />
          </div>
          <button
            type="submit"
            disabled={!browseSearchInput.trim()}
            className="px-3 h-9 rounded-full text-xs font-display font-semibold tap disabled:opacity-45"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            搜索
          </button>
        </form>
      )}
      {browseMode === "search" && browseSearchKeyword && (
        <div
          className="ml-12 flex items-center justify-between gap-3 rounded-lg px-3 py-2"
          style={{ background: "rgba(89,213,255,0.1)", border: "1px solid rgba(89,213,255,0.24)" }}
        >
          <p className="min-w-0 text-xs text-cream-dim">
            搜索结果：<span className="text-cream">{browseSearchKeyword}</span>
          </p>
          <button
            type="button"
            onClick={backToBrowseMode}
            className="shrink-0 text-[11px] font-display text-vhs hover:text-cream tap"
          >
            返回分类浏览
          </button>
        </div>
      )}
      {browseScriptKey && browseMode === "browse" && (
        <>
          {browseSubLoading ? (
            <div className="flex items-center gap-2 text-[10px] font-mono text-cream-faint pl-12">
              <span className="signal-bars" style={{ height: 10 }}>
                <span></span>
                <span></span>
                <span></span>
              </span>
              <span>正在加载分类</span>
            </div>
          ) : subSourceGroupKeys.length > 0 ? (
            subSourceGroupKeys.map((groupName) => (
              <ChipWrap
                key={groupName}
                label={groupName}
                value={browseSourceId}
                options={subSourceGroups[groupName].map((s) => ({
                  value: s.id,
                  label: s.name,
                }))}
                onChange={pickBrowseSubSource}
              />
            ))
          ) : (
            <p className="text-[10px] font-mono text-cream-faint pl-12">
              该源没有返回分类
            </p>
          )}
        </>
      )}

      {browseScriptKey && (browseMode === "search" || browseSourceId) && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="font-mono text-[10px] tracking-wider text-cream-faint">
            {browseLoading ? "加载中" : `${browseResults.length} 项`}
          </p>
          <div
            className="flex rounded-lg overflow-hidden"
            style={{ border: "1px solid var(--cream-line)" }}
          >
            <button
              type="button"
              onClick={() => setDisplay("card")}
              className="w-8 h-8 flex items-center justify-center tap"
              style={{
                background:
                  displayMode === "card" ? "var(--ember-soft)" : "var(--ink-2)",
                color: displayMode === "card" ? "var(--ember)" : "var(--cream-dim)",
              }}
            >
              <IconGrid size={14} />
            </button>
            <button
              type="button"
              onClick={() => setDisplay("list")}
              className="w-8 h-8 flex items-center justify-center tap"
              style={{
                background:
                  displayMode === "list" ? "var(--ember-soft)" : "var(--ink-2)",
                color: displayMode === "list" ? "var(--ember)" : "var(--cream-dim)",
                borderLeft: "1px solid var(--cream-line)",
              }}
            >
              <IconList size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BrowseResults({
  browseScriptKey,
  browseSourceId,
  browseResults,
  browseLoading,
  browseError,
  browseHasMore,
  browseMode,
  browseSearchKeyword,
  loadMore,
  displayMode,
}: BrowseSectionProps) {
  if (browseError) return <p className="text-ember text-sm">{browseError}</p>;
  if (browseMode === "search" && !browseSearchKeyword) {
    return <EmptyVodText>输入关键词后在当前源站内搜索。</EmptyVodText>;
  }
  if (!browseScriptKey || (browseMode === "browse" && !browseSourceId)) {
    return browseMode === "search" ? (
      <EmptyVodText>选择视频源后开始搜索。</EmptyVodText>
    ) : (
      <EmptyVodText>选择视频源和分类后开始浏览。</EmptyVodText>
    );
  }
  if (browseResults.length === 0) {
    return (
      <EmptyVodText>
        {browseLoading ? "正在加载内容..." : "当前分类暂时没有内容。"}
      </EmptyVodText>
    );
  }

  return (
    <>
      {displayMode === "card" ? (
        <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2">
          {browseResults.map((r) => (
            <CardOne key={`${r.scriptKey}:${r.vod.id}`} r={r} />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {browseResults.map((r) => (
            <ListOne key={`${r.scriptKey}:${r.vod.id}`} r={r} />
          ))}
        </div>
      )}
      {browseHasMore && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={browseLoading}
            className="px-5 py-2 rounded-full text-xs font-display font-semibold tap disabled:opacity-50"
            style={{
              background: "var(--ink-2)",
              border: "1px solid var(--cream-line)",
              color: "var(--cream)",
            }}
          >
            {browseLoading ? "加载中..." : "加载更多"}
          </button>
        </div>
      )}
    </>
  );
}

// =================== ChipRow / ChipWrap ===================

/** 横向滚动的胶囊行：单行，溢出可拖拽滚动。用于源列表。 */
function ChipRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] tracking-wider text-cream-faint w-10 shrink-0">
        {label}
      </span>
      <div
        className="flex-1 relative min-w-0"
        style={{
          maskImage:
            "linear-gradient(to right, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%)",
        }}
      >
        <div className="flex gap-1.5 overflow-x-auto vod-scroll-row pb-1 px-2">
          {options.map((o) => {
            const active = o.value === value;
            return (
              <button
                key={o.value || "__empty__"}
                type="button"
                onClick={() => onChange(o.value)}
                className="shrink-0 px-2.5 py-1 rounded-full text-[11px] font-display tap whitespace-nowrap transition-colors"
                style={{
                  background: active ? "var(--ember-soft)" : "var(--ink-2)",
                  border: `1px solid ${active ? "var(--ember)" : "var(--cream-line)"}`,
                  color: active ? "var(--ember)" : "var(--cream-dim)",
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 单行横向滚动的胶囊行：分类很多时不换行占高度。 */
function ChipWrap({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] tracking-wider text-cream-faint w-10 shrink-0">
        {label}
      </span>
      <div
        className="flex-1 relative min-w-0"
        style={{
          maskImage:
            "linear-gradient(to right, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%)",
        }}
      >
        <div className="flex gap-1.5 overflow-x-auto vod-scroll-row pb-1 px-2">
          {options.map((o) => {
            const active = o.value === value;
            return (
              <button
                key={o.value || "__empty__"}
                type="button"
                onClick={() => onChange(o.value)}
                className="shrink-0 px-2.5 py-1 rounded-full text-[11px] font-display tap whitespace-nowrap transition-colors"
                style={{
                  background: active ? "var(--ember-soft)" : "var(--ink-2)",
                  border: `1px solid ${active ? "var(--ember)" : "var(--cream-line)"}`,
                  color: active ? "var(--ember)" : "var(--cream-dim)",
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// =================== 卡片 ===================

function CardAgg({ group }: { group: AggGroup }) {
  const first = group.results[0];
  return (
    <Link
      to={`/detail/${encodeURIComponent(first.scriptKey)}/${encodeURIComponent(first.vod.id)}`}
      className="rounded-lg overflow-hidden flex flex-col tap"
      style={{
        background: "var(--ink-2)",
        border: "1px solid var(--cream-line)",
      }}
    >
      <div className="aspect-[3/4] relative scanlines" style={{ background: "var(--ink-3)" }}>
        {group.poster ? (
          <img
            src={group.poster}
            className="w-full h-full object-cover"
            alt={group.title}
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-cream-faint">
            <IconFilm size={32} />
          </div>
        )}
        {group.results.length > 1 && (
          <span
            className="absolute top-1 left-1 font-mono text-[9px] px-1.5 py-0.5 rounded tracking-wider"
            style={{
              background: "rgba(14,15,17,0.85)",
              color: "var(--phosphor)",
              border: "1px solid rgba(124,255,178,0.3)",
            }}
          >
            {group.results.length} 源
          </span>
        )}
        {group.remarks && (
          <span
            className="absolute bottom-1 right-1 font-mono text-[9px] px-1.5 py-0.5 rounded tracking-wider"
            style={{
              background: "rgba(14,15,17,0.85)",
              color: "var(--phosphor)",
              border: "1px solid rgba(124,255,178,0.2)",
            }}
          >
            {group.remarks}
          </span>
        )}
      </div>
      <div className="p-2">
        <p className="text-xs line-clamp-1 text-cream font-display">{group.title}</p>
        <p className="font-mono text-[10px] text-cream-faint mt-0.5 line-clamp-1">
          {group.year !== "unknown" ? group.year : ""}
          {group.type === "tv" && " · 剧集"}
        </p>
      </div>
    </Link>
  );
}

function CardOne({ r }: { r: SearchResult }) {
  return (
    <Link
      to={`/detail/${encodeURIComponent(r.scriptKey)}/${encodeURIComponent(r.vod.id)}`}
      className="rounded-lg overflow-hidden flex flex-col tap"
      style={{
        background: "var(--ink-2)",
        border: "1px solid var(--cream-line)",
      }}
    >
      <div className="aspect-[3/4] relative scanlines" style={{ background: "var(--ink-3)" }}>
        {r.vod.poster ? (
          <img
            src={r.vod.poster}
            className="w-full h-full object-cover"
            alt={r.vod.title}
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-cream-faint">
            <IconFilm size={32} />
          </div>
        )}
        {r.vod.vod_remarks && (
          <span
            className="absolute bottom-1 right-1 font-mono text-[9px] px-1.5 py-0.5 rounded tracking-wider"
            style={{
              background: "rgba(14,15,17,0.85)",
              color: "var(--phosphor)",
              border: "1px solid rgba(124,255,178,0.2)",
            }}
          >
            {r.vod.vod_remarks}
          </span>
        )}
      </div>
      <div className="p-2">
        <p className="text-xs line-clamp-1 text-cream font-display">{r.vod.title}</p>
        <p className="font-mono text-[10px] text-cream-faint mt-0.5 line-clamp-1">
          @{r.scriptName}
          {r.vod.year && ` · ${r.vod.year}`}
        </p>
      </div>
    </Link>
  );
}

function ListAgg({ group }: { group: AggGroup }) {
  const first = group.results[0];
  return (
    <Link
      to={`/detail/${encodeURIComponent(first.scriptKey)}/${encodeURIComponent(first.vod.id)}`}
      className="flex gap-3 rounded-lg overflow-hidden p-2 tap"
      style={{
        background: "var(--ink-2)",
        border: "1px solid var(--cream-line)",
      }}
    >
      <div
        className="w-20 h-28 shrink-0 rounded overflow-hidden scanlines relative"
        style={{ background: "var(--ink-3)" }}
      >
        {group.poster ? (
          <img
            src={group.poster}
            className="w-full h-full object-cover"
            alt={group.title}
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-cream-faint">
            <IconFilm size={24} />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        <p className="text-sm font-display font-semibold line-clamp-1 text-cream">
          {group.title}
        </p>
        <div className="flex items-center gap-2 flex-wrap mt-1">
          {group.year !== "unknown" && (
            <span className="font-mono text-[10px] text-cream-dim">{group.year}</span>
          )}
          {group.type === "tv" && (
            <span className="chip-ch" style={{ fontSize: 9 }}>
              剧集
            </span>
          )}
          {group.results.length > 1 && (
            <span
              className="font-mono text-[10px] px-1.5 rounded"
              style={{ color: "var(--phosphor)", border: "1px solid rgba(124,255,178,0.3)" }}
            >
              {group.results.length} 源
            </span>
          )}
          {group.remarks && (
            <span className="font-mono text-[10px] text-phosphor">{group.remarks}</span>
          )}
        </div>
        <p className="font-mono text-[10px] text-cream-faint mt-2 line-clamp-1">
          {group.results.map((r) => r.scriptName).join(" · ")}
        </p>
      </div>
    </Link>
  );
}

function ListOne({ r }: { r: SearchResult }) {
  return (
    <Link
      to={`/detail/${encodeURIComponent(r.scriptKey)}/${encodeURIComponent(r.vod.id)}`}
      className="flex gap-3 rounded-lg overflow-hidden p-2 tap"
      style={{
        background: "var(--ink-2)",
        border: "1px solid var(--cream-line)",
      }}
    >
      <div
        className="w-20 h-28 shrink-0 rounded overflow-hidden scanlines relative"
        style={{ background: "var(--ink-3)" }}
      >
        {r.vod.poster ? (
          <img
            src={r.vod.poster}
            className="w-full h-full object-cover"
            alt={r.vod.title}
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-cream-faint">
            <IconFilm size={24} />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        <p className="text-sm font-display font-semibold line-clamp-1 text-cream">
          {r.vod.title}
        </p>
        <div className="flex items-center gap-2 flex-wrap mt-1">
          {r.vod.year && <span className="font-mono text-[10px] text-cream-dim">{r.vod.year}</span>}
          {r.vod.vod_remarks && (
            <span className="font-mono text-[10px] text-phosphor">{r.vod.vod_remarks}</span>
          )}
          {r.vod.type_name && (
            <span className="font-mono text-[10px] text-cream-dim">{r.vod.type_name}</span>
          )}
        </div>
        <p className="font-mono text-[10px] text-cream-faint mt-2 line-clamp-1">
          @{r.scriptName}
        </p>
        {r.vod.desc && (
          <p className="text-[11px] text-cream-dim mt-1 line-clamp-2">{r.vod.desc}</p>
        )}
      </div>
    </Link>
  );
}
