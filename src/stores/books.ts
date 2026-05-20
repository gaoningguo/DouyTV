/**
 * Books store — 多 OPDS 源管理 + 书架 + 阅读进度。
 *
 * 持久化：
 *  - 源列表 → localStorage（用户配置，少量数据，频繁全量改）
 *  - 书架 / 进度 → SQLite (book_shelf, book_progress)
 */
import { create } from "zustand";
import { getDb, isSqlAvailable } from "@/lib/db";
import type {
  BookAcquisitionLink,
  BookListItem,
  BookProgressRecord,
  BookShelfItem,
  BookSource,
} from "@/lib/books/types";

const SOURCES_KEY = "douytv:book-sources";

interface ShelfRow {
  source_id: string;
  book_id: string;
  title: string;
  author: string | null;
  cover: string | null;
  summary: string | null;
  acquisition_links: string;
  saved_at: number;
}

interface ProgressRow {
  source_id: string;
  book_id: string;
  locator_type: string;
  locator_value: string;
  chapter_title: string | null;
  percent: number;
  updated_at: number;
}

function rowToShelf(r: ShelfRow): BookShelfItem {
  let acquisitionLinks: BookAcquisitionLink[] = [];
  try {
    const parsed = JSON.parse(r.acquisition_links);
    if (Array.isArray(parsed)) acquisitionLinks = parsed as BookAcquisitionLink[];
  } catch {
    /* ignore */
  }
  return {
    sourceId: r.source_id,
    bookId: r.book_id,
    title: r.title,
    author: r.author ?? undefined,
    cover: r.cover ?? undefined,
    summary: r.summary ?? undefined,
    acquisitionLinks,
    savedAt: r.saved_at,
  };
}

function rowToProgress(r: ProgressRow): BookProgressRecord {
  return {
    sourceId: r.source_id,
    bookId: r.book_id,
    locatorType: r.locator_type as BookProgressRecord["locatorType"],
    locatorValue: r.locator_value,
    chapterTitle: r.chapter_title ?? undefined,
    percent: r.percent,
    updatedAt: r.updated_at,
  };
}

interface BooksStore {
  sources: BookSource[];
  shelf: BookShelfItem[];
  progress: BookProgressRecord[];
  hydrated: boolean;

  hydrate: () => Promise<void>;

  // 源管理
  addSource: (s: Omit<BookSource, "id" | "addedAt">) => void;
  updateSource: (id: string, patch: Partial<BookSource>) => void;
  removeSource: (id: string) => void;

  // 书架
  addToShelf: (item: BookListItem) => Promise<void>;
  removeFromShelf: (sourceId: string, bookId: string) => Promise<void>;
  isOnShelf: (sourceId: string, bookId: string) => boolean;

  // 进度
  saveProgress: (rec: Omit<BookProgressRecord, "updatedAt">) => Promise<void>;
  getProgress: (sourceId: string, bookId: string) => BookProgressRecord | undefined;
}

function loadSources(): BookSource[] {
  try {
    const raw = localStorage.getItem(SOURCES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as BookSource[]) : [];
  } catch {
    return [];
  }
}

function persistSources(sources: BookSource[]) {
  try {
    localStorage.setItem(SOURCES_KEY, JSON.stringify(sources));
  } catch (e) {
    console.warn("[books] persist sources failed", e);
  }
}

async function sqlLoadShelf(): Promise<BookShelfItem[]> {
  const db = await getDb();
  const rows = await db.select<ShelfRow[]>(
    "SELECT * FROM book_shelf ORDER BY saved_at DESC"
  );
  return rows.map(rowToShelf);
}

async function sqlLoadProgress(): Promise<BookProgressRecord[]> {
  const db = await getDb();
  const rows = await db.select<ProgressRow[]>(
    "SELECT * FROM book_progress ORDER BY updated_at DESC"
  );
  return rows.map(rowToProgress);
}

export const useBooksStore = create<BooksStore>((set, get) => ({
  sources: [],
  shelf: [],
  progress: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const sources = loadSources();
    set({ sources });
    if (isSqlAvailable()) {
      try {
        const [shelf, progress] = await Promise.all([sqlLoadShelf(), sqlLoadProgress()]);
        set({ shelf, progress });
      } catch (e) {
        console.error("[books] hydrate sql failed", e);
      }
    }
    set({ hydrated: true });
  },

  addSource: (s) => {
    const id = `bk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const next: BookSource = { ...s, id, enabled: s.enabled ?? true, addedAt: Date.now() };
    const all = [...get().sources, next];
    persistSources(all);
    set({ sources: all });
  },

  updateSource: (id, patch) => {
    const all = get().sources.map((s) => (s.id === id ? { ...s, ...patch } : s));
    persistSources(all);
    set({ sources: all });
  },

  removeSource: (id) => {
    const all = get().sources.filter((s) => s.id !== id);
    persistSources(all);
    set({ sources: all });
  },

  addToShelf: async (item) => {
    const rec: BookShelfItem = {
      sourceId: item.sourceId,
      bookId: item.id,
      title: item.title,
      author: item.author,
      cover: item.cover,
      summary: item.summary,
      acquisitionLinks: item.acquisitionLinks,
      savedAt: Date.now(),
    };
    if (isSqlAvailable()) {
      try {
        const db = await getDb();
        await db.execute(
          `INSERT OR REPLACE INTO book_shelf
           (source_id, book_id, title, author, cover, summary, acquisition_links, saved_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            rec.sourceId,
            rec.bookId,
            rec.title,
            rec.author ?? null,
            rec.cover ?? null,
            rec.summary ?? null,
            JSON.stringify(rec.acquisitionLinks),
            rec.savedAt,
          ]
        );
      } catch (e) {
        console.error("[books] addToShelf sql failed", e);
      }
    }
    set((s) => ({
      shelf: [rec, ...s.shelf.filter((b) => !(b.sourceId === rec.sourceId && b.bookId === rec.bookId))],
    }));
  },

  removeFromShelf: async (sourceId, bookId) => {
    if (isSqlAvailable()) {
      try {
        const db = await getDb();
        await db.execute(
          "DELETE FROM book_shelf WHERE source_id = $1 AND book_id = $2",
          [sourceId, bookId]
        );
      } catch (e) {
        console.error("[books] removeFromShelf sql failed", e);
      }
    }
    set((s) => ({
      shelf: s.shelf.filter((b) => !(b.sourceId === sourceId && b.bookId === bookId)),
    }));
  },

  isOnShelf: (sourceId, bookId) =>
    get().shelf.some((b) => b.sourceId === sourceId && b.bookId === bookId),

  saveProgress: async (rec) => {
    const full: BookProgressRecord = { ...rec, updatedAt: Date.now() };
    if (isSqlAvailable()) {
      try {
        const db = await getDb();
        await db.execute(
          `INSERT OR REPLACE INTO book_progress
           (source_id, book_id, locator_type, locator_value, chapter_title, percent, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            full.sourceId,
            full.bookId,
            full.locatorType,
            full.locatorValue,
            full.chapterTitle ?? null,
            full.percent,
            full.updatedAt,
          ]
        );
      } catch (e) {
        console.error("[books] saveProgress sql failed", e);
      }
    }
    set((s) => ({
      progress: [
        full,
        ...s.progress.filter(
          (p) => !(p.sourceId === full.sourceId && p.bookId === full.bookId)
        ),
      ],
    }));
  },

  getProgress: (sourceId, bookId) =>
    get().progress.find((p) => p.sourceId === sourceId && p.bookId === bookId),
}));
