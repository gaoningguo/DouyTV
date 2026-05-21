/**
 * 漫画源 store —— 与现有 Suwayomi mangaStore 完全独立。
 *
 * 持久化（全 localStorage）：
 *   - sources / shelf / progress
 *
 * 三种导入入口同 novelsource。
 */
import { create } from "zustand";
import type {
  MangaReadProgressV2,
  MangaShelfItemV2,
  MangaSourceV2,
  TachiyomiCatalogSource,
  TachiyomiExtension,
} from "@/lib/mangasources/types";
import {
  validateMangaSource,
  getMangaChapters,
} from "@/lib/mangasources/runtime";
import { loadSourceObjects, stripBom, parseLegadoLike } from "@/lib/sourceImport";

const SOURCES_KEY = "douytv:manga-sources-v2";
const SHELF_KEY = "douytv:manga-shelf-v2";
const PROGRESS_KEY = "douytv:manga-progress-v2";
const HEALTH_KEY = "douytv:manga-health-v2";
const LAST_CHAPTERS_KEY = "douytv:manga-last-chapters-v2";
const TACHIYOMI_KEY = "douytv:manga-tachiyomi-catalog-v2";

export interface MangaHealth {
  ok: boolean;
  message: string;
  sampleCount: number;
  checkedAt: number;
}

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function save<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("[mangasrc] persist failed", key, e);
  }
}

function mapToMangaSource(it: Record<string, unknown>): MangaSourceV2 | null {
  const name = (it.name as string | undefined) ?? (it.bookSourceName as string | undefined);
  const baseUrl = (it.baseUrl as string | undefined) ?? (it.bookSourceUrl as string | undefined);
  if (!name || !baseUrl) return null;
  return {
    id: genId("ms"),
    addedAt: Date.now(),
    enabled: it.enabled !== false,
    name,
    baseUrl,
    group: (it.group as string | undefined) ?? (it.bookSourceGroup as string | undefined),
    comment: (it.comment as string | undefined) ?? (it.bookSourceComment as string | undefined),
    header: it.header as string | undefined,
    searchUrl: it.searchUrl as string | undefined,
    exploreUrl: it.exploreUrl as string | undefined,
    ruleList: (it.ruleList as MangaSourceV2["ruleList"]) ?? undefined,
    ruleDetail: (it.ruleDetail as MangaSourceV2["ruleDetail"]) ?? undefined,
    ruleChapters: (it.ruleChapters as MangaSourceV2["ruleChapters"]) ?? undefined,
    rulePages: (it.rulePages as MangaSourceV2["rulePages"]) ?? undefined,
  };
}

/** 兼容旧导出 —— 直接解析 JSON 文本（不处理 sourceUrls wrap，遇到会抛错） */
export function parseMangaSourceJson(text: string): MangaSourceV2[] {
  const parsed = parseLegadoLike(stripBom(text));
  if (parsed.sourceUrls.length > 0) {
    throw new Error(
      `输入是 legado 订阅 wrap（含 sourceUrls）—— 请用「一键导入」按钮拉取`
    );
  }
  const out: MangaSourceV2[] = [];
  for (const it of parsed.sources) {
    const m = mapToMangaSource(it);
    if (m) out.push(m);
  }
  return out;
}

/**
 * 识别 Tachiyomi / Mihon 扩展条目。
 * 规范形态：`{ pkg: string, apk: string, sources: [{ id, name, baseUrl }] }`。
 * 不能在 DouyTV 内消费，但保存为"目录"展示给用户。
 */
function tryParseTachiyomi(
  it: Record<string, unknown>,
  fromRepo?: string
): TachiyomiExtension | null {
  const pkg = typeof it.pkg === "string" ? it.pkg : undefined;
  const apk = typeof it.apk === "string" ? it.apk : undefined;
  const name = typeof it.name === "string" ? it.name : undefined;
  const sources = Array.isArray(it.sources) ? it.sources : null;
  if (!pkg || !sources || !name) return null;
  const parsedSources: TachiyomiCatalogSource[] = [];
  for (const s of sources) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    const sid = o.id;
    const sname = o.name;
    if (typeof sname !== "string") continue;
    parsedSources.push({
      id: typeof sid === "string" || typeof sid === "number" ? String(sid) : pkg,
      name: sname,
      lang: typeof o.lang === "string" ? o.lang : undefined,
      baseUrl: typeof o.baseUrl === "string" ? o.baseUrl : undefined,
    });
  }
  if (parsedSources.length === 0) return null;
  return {
    name,
    pkg,
    apk,
    lang: typeof it.lang === "string" ? it.lang : undefined,
    version: typeof it.version === "string" ? it.version : undefined,
    nsfw: typeof it.nsfw === "number" ? it.nsfw !== 0 : Boolean(it.nsfw),
    sources: parsedSources,
    fromRepo,
    importedAt: Date.now(),
  };
}

function mergeFromRawObjects(
  rawList: Array<Record<string, unknown>>,
  get: () => MangaSourceStore,
  set: (patch: Partial<MangaSourceStore>) => void,
  fromRepo?: string
): { ok: boolean; added: number; tachiyomi: number; message?: string } {
  const parsed: MangaSourceV2[] = [];
  const tachiyomiExts: TachiyomiExtension[] = [];
  for (const it of rawList) {
    // 优先识别 Tachiyomi 形态（pkg + apk + sources[]）—— 不可在 DouyTV 内消费，
    // 但保留为只读目录展示，避免直接报"缺 name/baseUrl"。
    const tachi = tryParseTachiyomi(it, fromRepo);
    if (tachi) {
      tachiyomiExts.push(tachi);
      continue;
    }
    const m = mapToMangaSource(it);
    if (m) parsed.push(m);
  }
  // 即便 parsed 为空，只要识别到 Tachiyomi 也算 ok（用户能在目录页看到结果）
  if (parsed.length === 0 && tachiyomiExts.length === 0) {
    return {
      ok: false,
      added: 0,
      tachiyomi: 0,
      message: "没有有效漫画源（每条都缺 name / baseUrl，也不是 Tachiyomi 格式）",
    };
  }
  // 合并 Tachiyomi 目录（按 pkg 去重）
  if (tachiyomiExts.length > 0) {
    const existingPkgs = new Set(get().tachiyomiCatalog.map((e) => e.pkg));
    const mergedCatalog = [...get().tachiyomiCatalog];
    for (const ext of tachiyomiExts) {
      if (existingPkgs.has(ext.pkg)) {
        const idx = mergedCatalog.findIndex((e) => e.pkg === ext.pkg);
        if (idx >= 0) mergedCatalog[idx] = ext;
      } else {
        mergedCatalog.push(ext);
        existingPkgs.add(ext.pkg);
      }
    }
    save(TACHIYOMI_KEY, mergedCatalog);
    set({ tachiyomiCatalog: mergedCatalog });
  }
  const existing = new Map(get().sources.map((s) => [s.baseUrl, s.id]));
  const merged = [...get().sources];
  let added = 0;
  for (const item of parsed) {
    const dupId = existing.get(item.baseUrl);
    if (dupId) {
      const idx = merged.findIndex((s) => s.id === dupId);
      if (idx >= 0) {
        merged[idx] = { ...item, id: dupId, addedAt: merged[idx].addedAt };
        continue;
      }
    }
    merged.push(item);
    added++;
  }
  save(SOURCES_KEY, merged);
  set({ sources: merged });
  const tachi = tachiyomiExts.length;
  const msg =
    tachi > 0
      ? `成功 ${added} 个漫画源；另识别到 ${tachi} 个 Tachiyomi 扩展（需 Suwayomi 才能实际抓取，已存为只读目录）`
      : undefined;
  return { ok: true, added, tachiyomi: tachi, message: msg };
}

interface MangaSourceStore {
  sources: MangaSourceV2[];
  shelf: MangaShelfItemV2[];
  progress: MangaReadProgressV2[];
  health: Record<string, MangaHealth>;
  /** mangaId → 最近一次拉到的章节总数；用于和 shelf 的 lastReadChapterIndex 比对识别"有更新" */
  lastChapters: Record<string, number>;
  /** 页面字节缓存 —— 进入章节时按 chapterId 缓存图片 URL/Blob URL，关闭 app 清空 */
  pageCache: Map<string, string[]>;
  /** Tachiyomi/Mihon 扩展索引目录（只读，需 Suwayomi 才能实际抓取） */
  tachiyomiCatalog: TachiyomiExtension[];
  hydrated: boolean;

  hydrate: () => void;

  importByUrl: (url: string) => Promise<{ ok: boolean; added: number; tachiyomi?: number; message?: string }>;
  importByText: (text: string) => Promise<{ ok: boolean; added: number; tachiyomi?: number; message?: string }>;
  addManual: (source: Omit<MangaSourceV2, "id" | "addedAt">) => MangaSourceV2;
  updateSource: (id: string, patch: Partial<MangaSourceV2>) => void;
  removeSource: (id: string) => void;
  toggleEnabled: (id: string) => void;
  clearAll: () => void;
  /** 清空 Tachiyomi 扩展索引目录 */
  clearTachiyomiCatalog: () => void;
  /** 从 Tachiyomi 目录里移除单个扩展（按 pkg） */
  removeTachiyomiExtension: (pkg: string) => void;

  addToShelf: (item: MangaShelfItemV2) => void;
  removeFromShelf: (id: string) => void;
  isOnShelf: (id: string) => boolean;

  saveProgress: (rec: MangaReadProgressV2) => void;
  getProgress: (mangaId: string) => MangaReadProgressV2 | undefined;

  /** 健康检查 */
  validateOne: (id: string) => Promise<MangaHealth | undefined>;
  validateAll: (concurrency?: number) => Promise<void>;

  /** 检测书架里的漫画是否"有更新"（新章节数 > 已读 chapter index + 1）—— 返回 mangaId 集合 */
  checkUpdates: () => Promise<Set<string>>;
  /** 标记最新章节数（getMangaChapters 后调用） */
  noteChapterCount: (mangaId: string, count: number) => void;
  /** 是否有更新（基于 lastChapters + shelf 进度计算，纯客户端推断） */
  hasUpdate: (mangaId: string) => boolean;

  /** 内存图片 URL 缓存 —— 仅用于离线预下载 / 后续 IndexedDB 化预留 */
  cachePages: (chapterId: string, urls: string[]) => void;
  getCachedPages: (chapterId: string) => string[] | undefined;
  clearPageCache: () => void;
}

export const useMangaSourceStore = create<MangaSourceStore>((set, get) => ({
  sources: [],
  shelf: [],
  progress: [],
  health: {},
  lastChapters: {},
  pageCache: new Map(),
  tachiyomiCatalog: [],
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    set({
      sources: load<MangaSourceV2[]>(SOURCES_KEY, []),
      shelf: load<MangaShelfItemV2[]>(SHELF_KEY, []),
      progress: load<MangaReadProgressV2[]>(PROGRESS_KEY, []),
      health: load<Record<string, MangaHealth>>(HEALTH_KEY, {}),
      lastChapters: load<Record<string, number>>(LAST_CHAPTERS_KEY, {}),
      tachiyomiCatalog: load<TachiyomiExtension[]>(TACHIYOMI_KEY, []),
      hydrated: true,
    });
  },

  importByUrl: async (url) => {
    try {
      const raw = await loadSourceObjects(url);
      return mergeFromRawObjects(raw, get, set, url);
    } catch (e) {
      return { ok: false, added: 0, message: (e as Error).message ?? String(e) };
    }
  },

  importByText: async (text) => {
    try {
      const raw = await loadSourceObjects(text);
      return mergeFromRawObjects(raw, get, set);
    } catch (e) {
      return { ok: false, added: 0, message: (e as Error).message ?? String(e) };
    }
  },

  addManual: (input) => {
    const full: MangaSourceV2 = {
      ...input,
      id: genId("ms"),
      addedAt: Date.now(),
    };
    const next = [full, ...get().sources];
    save(SOURCES_KEY, next);
    set({ sources: next });
    return full;
  },

  updateSource: (id, patch) => {
    const next = get().sources.map((s) =>
      s.id === id ? { ...s, ...patch, id, addedAt: s.addedAt } : s
    );
    save(SOURCES_KEY, next);
    set({ sources: next });
  },

  removeSource: (id) => {
    const next = get().sources.filter((s) => s.id !== id);
    save(SOURCES_KEY, next);
    set({ sources: next });
  },

  toggleEnabled: (id) => {
    const next = get().sources.map((s) =>
      s.id === id ? { ...s, enabled: !s.enabled } : s
    );
    save(SOURCES_KEY, next);
    set({ sources: next });
  },

  clearAll: () => {
    save(SOURCES_KEY, []);
    set({ sources: [] });
  },

  clearTachiyomiCatalog: () => {
    save(TACHIYOMI_KEY, []);
    set({ tachiyomiCatalog: [] });
  },

  removeTachiyomiExtension: (pkg) => {
    const next = get().tachiyomiCatalog.filter((e) => e.pkg !== pkg);
    save(TACHIYOMI_KEY, next);
    set({ tachiyomiCatalog: next });
  },

  addToShelf: (item) => {
    const next = [item, ...get().shelf.filter((s) => s.id !== item.id)];
    save(SHELF_KEY, next);
    set({ shelf: next });
  },

  removeFromShelf: (id) => {
    const next = get().shelf.filter((s) => s.id !== id);
    save(SHELF_KEY, next);
    set({ shelf: next });
  },

  isOnShelf: (id) => get().shelf.some((s) => s.id === id),

  saveProgress: (rec) => {
    const next = [
      rec,
      ...get().progress.filter((p) => p.mangaId !== rec.mangaId),
    ];
    save(PROGRESS_KEY, next);
    set({ progress: next });
  },

  getProgress: (mangaId) => get().progress.find((p) => p.mangaId === mangaId),

  /* ─── 健康检查 ─── */
  validateOne: async (id) => {
    const src = get().sources.find((s) => s.id === id);
    if (!src) return undefined;
    const r = await validateMangaSource(src);
    const rec: MangaHealth = {
      ok: r.ok,
      message: r.message,
      sampleCount: r.sampleCount,
      checkedAt: Date.now(),
    };
    const next = { ...get().health, [id]: rec };
    save(HEALTH_KEY, next);
    set({ health: next });
    return rec;
  },

  validateAll: async (concurrency = 4) => {
    const ids = get().sources.filter((s) => s.enabled).map((s) => s.id);
    let i = 0;
    const next: Record<string, MangaHealth> = { ...get().health };
    const workers = Array.from(
      { length: Math.min(concurrency, ids.length) },
      async () => {
        while (i < ids.length) {
          const idx = i++;
          const id = ids[idx];
          const src = get().sources.find((s) => s.id === id);
          if (!src) continue;
          try {
            const r = await validateMangaSource(src);
            next[id] = {
              ok: r.ok,
              message: r.message,
              sampleCount: r.sampleCount,
              checkedAt: Date.now(),
            };
          } catch (e) {
            next[id] = {
              ok: false,
              message: (e as Error).message ?? String(e),
              sampleCount: 0,
              checkedAt: Date.now(),
            };
          }
          save(HEALTH_KEY, next);
          set({ health: { ...next } });
        }
      }
    );
    await Promise.all(workers);
  },

  /* ─── 更新检测 ─── */
  noteChapterCount: (mangaId, count) => {
    const next = { ...get().lastChapters, [mangaId]: count };
    save(LAST_CHAPTERS_KEY, next);
    set({ lastChapters: next });
  },

  checkUpdates: async () => {
    const updated = new Set<string>();
    const shelf = get().shelf;
    const sources = get().sources;
    // 并发拉每本书的章节数（受 6 并发限）
    let i = 0;
    const concurrency = 6;
    const nextLastChapters: Record<string, number> = { ...get().lastChapters };
    const workers = Array.from(
      { length: Math.min(concurrency, shelf.length) },
      async () => {
        while (i < shelf.length) {
          const idx = i++;
          const item = shelf[idx];
          const src = sources.find((s) => s.id === item.sourceId);
          if (!src) continue;
          try {
            const chapters = await getMangaChapters(src, item.url);
            const count = chapters.length;
            nextLastChapters[item.id] = count;
            const lastRead = item.lastReadChapterIndex ?? -1;
            if (count > lastRead + 1) {
              updated.add(item.id);
            }
          } catch {
            /* skip failing */
          }
        }
      }
    );
    await Promise.all(workers);
    save(LAST_CHAPTERS_KEY, nextLastChapters);
    set({ lastChapters: nextLastChapters });
    return updated;
  },

  hasUpdate: (mangaId) => {
    const item = get().shelf.find((s) => s.id === mangaId);
    if (!item) return false;
    const total = get().lastChapters[mangaId];
    if (typeof total !== "number") return false;
    const lastRead = item.lastReadChapterIndex ?? -1;
    return total > lastRead + 1;
  },

  /* ─── 内存页面缓存 ─── */
  cachePages: (chapterId, urls) => {
    const m = new Map(get().pageCache);
    m.set(chapterId, urls);
    set({ pageCache: m });
  },

  getCachedPages: (chapterId) => get().pageCache.get(chapterId),

  clearPageCache: () => set({ pageCache: new Map() }),
}));
