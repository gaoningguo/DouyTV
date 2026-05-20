/**
 * 书源（小说源）store —— 与 OPDS 的 BooksStore 完全独立。
 *
 * 持久化：
 *  - sources / lastUpdateTime → localStorage (`douytv:novel-sources`)
 *  - shelf / 进度 → 暂存 localStorage（数据小，避免 SQLite migration）
 *
 * 三种导入入口：
 *  - importByUrl(url) —— 一键导入：URL 拉取 JSON 数组（legado 导出格式）
 *  - importByText(text) —— 手动粘贴：文本框 JSON
 *  - addManual(source) —— 自定义编辑器：表单填字段
 */
import { create } from "zustand";
import type {
  BookSourceV2,
  NovelReadProgress,
  NovelShelfItem,
} from "@/lib/booksources/types";
import { scriptFetch } from "@/source-script/fetch";
import { validateSource } from "@/lib/booksources/runtime";

const SOURCES_KEY = "douytv:novel-sources";
const SHELF_KEY = "douytv:novel-shelf";
const PROGRESS_KEY = "douytv:novel-progress";
const BOOKMARKS_KEY = "douytv:novel-bookmarks";
const HEALTH_KEY = "douytv:novel-health";

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
    console.warn("[novelsrc] persist failed", key, e);
  }
}

/** 解析 legado 书源 JSON —— 支持单对象 / 数组 / 嵌套 `{rule:..., book:...}` 等常见 wrap */
export function parseLegadoJson(text: string): BookSourceV2[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON 解析失败: ${(e as Error).message}`);
  }
  const arr = Array.isArray(raw) ? raw : [raw];
  const out: BookSourceV2[] = [];
  const now = Date.now();
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    const name = it.bookSourceName as string | undefined;
    const url = it.bookSourceUrl as string | undefined;
    if (!name || !url) continue;
    out.push({
      id: genId("nv"),
      addedAt: now,
      enabled: it.enabled !== false,
      bookSourceName: name,
      bookSourceUrl: url,
      bookSourceType: it.bookSourceType as number | undefined,
      bookSourceGroup: it.bookSourceGroup as string | undefined,
      bookSourceComment: it.bookSourceComment as string | undefined,
      header: it.header as string | undefined,
      searchUrl: it.searchUrl as string | undefined,
      exploreUrl: it.exploreUrl as string | undefined,
      lastUpdateTime: it.lastUpdateTime as number | undefined,
      ruleSearch: (it.ruleSearch as BookSourceV2["ruleSearch"]) ?? undefined,
      ruleBookInfo: (it.ruleBookInfo as BookSourceV2["ruleBookInfo"]) ?? undefined,
      ruleToc: (it.ruleToc as BookSourceV2["ruleToc"]) ?? undefined,
      ruleContent: (it.ruleContent as BookSourceV2["ruleContent"]) ?? undefined,
      ruleExplore: (it.ruleExplore as BookSourceV2["ruleExplore"]) ?? undefined,
    });
  }
  return out;
}

interface NovelSourceStore {
  sources: BookSourceV2[];
  shelf: NovelShelfItem[];
  progress: NovelReadProgress[];
  bookmarks: Record<string, NovelBookmark[]>; // bookId → list
  health: Record<string, SourceHealth>;       // sourceId → 最近一次健康检查结果
  hydrated: boolean;

  hydrate: () => void;

  importByUrl: (url: string) => Promise<{ ok: boolean; added: number; message?: string }>;
  importByText: (text: string) => { ok: boolean; added: number; message?: string };
  addManual: (source: Omit<BookSourceV2, "id" | "addedAt">) => BookSourceV2;
  updateSource: (id: string, patch: Partial<BookSourceV2>) => void;
  removeSource: (id: string) => void;
  toggleEnabled: (id: string) => void;
  clearAll: () => void;

  addToShelf: (item: NovelShelfItem) => void;
  removeFromShelf: (id: string) => void;
  isOnShelf: (id: string) => boolean;

  saveProgress: (rec: NovelReadProgress) => void;
  getProgress: (bookId: string) => NovelReadProgress | undefined;

  /** 书签 —— 段落级，跨会话保留 */
  addBookmark: (b: NovelBookmark) => void;
  removeBookmark: (bookId: string, id: string) => void;
  getBookmarks: (bookId: string) => NovelBookmark[];

  /** 健康检查 —— 跑一次 validateSource，写入 health */
  validateOne: (id: string) => Promise<SourceHealth | undefined>;
  validateAll: (concurrency?: number) => Promise<void>;

  /** 一键写回 ruleContent.replaceRegex —— 替换规则编辑器用 */
  saveReplaceRegex: (sourceId: string, rule: string) => void;
}

export interface NovelBookmark {
  /** 自己生成的 ID（用于删除） */
  id: string;
  bookId: string;
  chapterIndex: number;
  /** 章节标题（snapshot，避免 chapter 列表变化后丢上下文） */
  chapterTitle: string;
  /** 段落 index（NovelRead 把内容按 \n 切段后的 0-based 序号；为空表示整章书签） */
  paragraphIndex?: number;
  /** 摘抄片段（前 120 字） */
  excerpt?: string;
  createdAt: number;
}

export interface SourceHealth {
  ok: boolean;
  message: string;
  sampleCount: number;
  checkedAt: number;
}

export const useNovelSourceStore = create<NovelSourceStore>((set, get) => ({
  sources: [],
  shelf: [],
  progress: [],
  bookmarks: {},
  health: {},
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    set({
      sources: load<BookSourceV2[]>(SOURCES_KEY, []),
      shelf: load<NovelShelfItem[]>(SHELF_KEY, []),
      progress: load<NovelReadProgress[]>(PROGRESS_KEY, []),
      bookmarks: load<Record<string, NovelBookmark[]>>(BOOKMARKS_KEY, {}),
      health: load<Record<string, SourceHealth>>(HEALTH_KEY, {}),
      hydrated: true,
    });
  },

  importByUrl: async (url) => {
    try {
      const res = await scriptFetch(url, { method: "GET", timeout: 30_000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      return get().importByText(text);
    } catch (e) {
      return { ok: false, added: 0, message: (e as Error).message ?? String(e) };
    }
  },

  importByText: (text) => {
    try {
      const parsed = parseLegadoJson(text);
      if (parsed.length === 0) {
        return { ok: false, added: 0, message: "JSON 中没有有效书源（缺 bookSourceName/Url）" };
      }
      // 按 bookSourceUrl 去重 —— 同名再导入则覆盖
      const existingByUrl = new Map(get().sources.map((s) => [s.bookSourceUrl, s.id]));
      const merged = [...get().sources];
      let added = 0;
      for (const item of parsed) {
        const dupId = existingByUrl.get(item.bookSourceUrl);
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
      return { ok: true, added };
    } catch (e) {
      return { ok: false, added: 0, message: (e as Error).message ?? String(e) };
    }
  },

  addManual: (input) => {
    const full: BookSourceV2 = {
      ...input,
      id: genId("nv"),
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

  addToShelf: (item) => {
    const next = [
      item,
      ...get().shelf.filter((s) => s.id !== item.id),
    ];
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
      ...get().progress.filter((p) => p.bookId !== rec.bookId),
    ];
    save(PROGRESS_KEY, next);
    set({ progress: next });
  },

  getProgress: (bookId) => get().progress.find((p) => p.bookId === bookId),

  /* ─────── 书签 ─────── */
  addBookmark: (b) => {
    const all = { ...get().bookmarks };
    const list = all[b.bookId] ?? [];
    // 同章节同段落去重
    const dup = list.find(
      (x) => x.chapterIndex === b.chapterIndex && x.paragraphIndex === b.paragraphIndex
    );
    if (dup) return;
    all[b.bookId] = [b, ...list];
    save(BOOKMARKS_KEY, all);
    set({ bookmarks: all });
  },

  removeBookmark: (bookId, id) => {
    const all = { ...get().bookmarks };
    const list = all[bookId];
    if (!list) return;
    all[bookId] = list.filter((b) => b.id !== id);
    save(BOOKMARKS_KEY, all);
    set({ bookmarks: all });
  },

  getBookmarks: (bookId) => get().bookmarks[bookId] ?? [],

  /* ─────── 健康检查 ─────── */
  validateOne: async (id) => {
    const src = get().sources.find((s) => s.id === id);
    if (!src) return undefined;
    const r = await validateSource(src);
    const rec: SourceHealth = {
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
    const next: Record<string, SourceHealth> = { ...get().health };
    const workers = Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
      while (i < ids.length) {
        const idx = i++;
        const id = ids[idx];
        const src = get().sources.find((s) => s.id === id);
        if (!src) continue;
        try {
          const r = await validateSource(src);
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
        // 每完一个就同步一次 store，UI 能渐进显示
        save(HEALTH_KEY, next);
        set({ health: { ...next } });
      }
    });
    await Promise.all(workers);
  },

  /* ─────── 替换规则即时写回 ─────── */
  saveReplaceRegex: (sourceId, rule) => {
    const next = get().sources.map((s) =>
      s.id === sourceId
        ? {
            ...s,
            ruleContent: { ...(s.ruleContent ?? {}), replaceRegex: rule },
          }
        : s
    );
    save(SOURCES_KEY, next);
    set({ sources: next });
  },
}));
