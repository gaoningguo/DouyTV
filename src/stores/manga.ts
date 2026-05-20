/**
 * Manga store — Suwayomi 服务配置 + 书架 + 阅读历史。
 */
import { create } from "zustand";
import { getDb, isSqlAvailable } from "@/lib/db";
import type {
  MangaHistoryRecord,
  MangaSearchItem,
  MangaShelfItem,
} from "@/lib/manga/types";

const URL_KEY = "douytv:manga-server-url";
const USER_KEY = "douytv:manga-username";
const PASS_KEY = "douytv:manga-password";

interface ShelfRow {
  source_id: string;
  manga_id: string;
  title: string;
  cover: string | null;
  author: string | null;
  status: string | null;
  last_chapter_id: string | null;
  last_chapter_name: string | null;
  saved_at: number;
}

interface HistoryRow {
  source_id: string;
  manga_id: string;
  chapter_id: string;
  chapter_name: string | null;
  page_index: number;
  page_count: number;
  updated_at: number;
}

function rowToShelf(r: ShelfRow): MangaShelfItem {
  return {
    sourceId: r.source_id,
    mangaId: r.manga_id,
    title: r.title,
    cover: r.cover ?? undefined,
    author: r.author ?? undefined,
    status: r.status ?? undefined,
    lastChapterId: r.last_chapter_id ?? undefined,
    lastChapterName: r.last_chapter_name ?? undefined,
    savedAt: r.saved_at,
  };
}

function rowToHistory(r: HistoryRow): MangaHistoryRecord {
  return {
    sourceId: r.source_id,
    mangaId: r.manga_id,
    chapterId: r.chapter_id,
    chapterName: r.chapter_name ?? undefined,
    pageIndex: r.page_index,
    pageCount: r.page_count,
    updatedAt: r.updated_at,
  };
}

interface MangaStore {
  serverUrl: string;
  username: string;
  password: string;

  shelf: MangaShelfItem[];
  history: MangaHistoryRecord[];
  hydrated: boolean;

  hydrate: () => Promise<void>;
  setServerUrl: (s: string) => void;
  setUsername: (s: string) => void;
  setPassword: (s: string) => void;

  addToShelf: (m: MangaSearchItem) => Promise<void>;
  removeFromShelf: (sourceId: string, mangaId: string) => Promise<void>;
  isOnShelf: (sourceId: string, mangaId: string) => boolean;
  updateShelfLastChapter: (
    sourceId: string,
    mangaId: string,
    chapterId: string,
    chapterName: string
  ) => Promise<void>;

  saveHistory: (rec: Omit<MangaHistoryRecord, "updatedAt">) => Promise<void>;
  getHistory: (sourceId: string, mangaId: string, chapterId: string) =>
    | MangaHistoryRecord
    | undefined;
}

async function sqlLoadShelf(): Promise<MangaShelfItem[]> {
  const db = await getDb();
  const rows = await db.select<ShelfRow[]>(
    "SELECT * FROM manga_shelf ORDER BY saved_at DESC"
  );
  return rows.map(rowToShelf);
}

async function sqlLoadHistory(): Promise<MangaHistoryRecord[]> {
  const db = await getDb();
  const rows = await db.select<HistoryRow[]>(
    "SELECT * FROM manga_history ORDER BY updated_at DESC LIMIT 500"
  );
  return rows.map(rowToHistory);
}

export const useMangaStore = create<MangaStore>((set, get) => ({
  serverUrl: "",
  username: "",
  password: "",
  shelf: [],
  history: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      set({
        serverUrl: localStorage.getItem(URL_KEY) || "",
        username: localStorage.getItem(USER_KEY) || "",
        password: localStorage.getItem(PASS_KEY) || "",
      });
    } catch {
      /* private */
    }
    if (isSqlAvailable()) {
      try {
        const [shelf, history] = await Promise.all([sqlLoadShelf(), sqlLoadHistory()]);
        set({ shelf, history });
      } catch (e) {
        console.error("[manga] hydrate sql failed", e);
      }
    }
    set({ hydrated: true });
  },

  setServerUrl: (s) => {
    try {
      localStorage.setItem(URL_KEY, s);
    } catch {
      /* private */
    }
    set({ serverUrl: s });
  },
  setUsername: (s) => {
    try {
      localStorage.setItem(USER_KEY, s);
    } catch {
      /* private */
    }
    set({ username: s });
  },
  setPassword: (s) => {
    try {
      localStorage.setItem(PASS_KEY, s);
    } catch {
      /* private */
    }
    set({ password: s });
  },

  addToShelf: async (m) => {
    const rec: MangaShelfItem = {
      sourceId: m.sourceId,
      mangaId: m.id,
      title: m.title,
      cover: m.cover,
      author: m.author,
      status: m.status,
      savedAt: Date.now(),
    };
    if (isSqlAvailable()) {
      try {
        const db = await getDb();
        await db.execute(
          `INSERT OR REPLACE INTO manga_shelf
           (source_id, manga_id, title, cover, author, status, last_chapter_id, last_chapter_name, saved_at)
           VALUES ($1,$2,$3,$4,$5,$6,
             (SELECT last_chapter_id FROM manga_shelf WHERE source_id=$1 AND manga_id=$2),
             (SELECT last_chapter_name FROM manga_shelf WHERE source_id=$1 AND manga_id=$2),
             $7)`,
          [
            rec.sourceId,
            rec.mangaId,
            rec.title,
            rec.cover ?? null,
            rec.author ?? null,
            rec.status ?? null,
            rec.savedAt,
          ]
        );
      } catch (e) {
        console.error("[manga] addToShelf sql failed", e);
      }
    }
    set((s) => ({
      shelf: [rec, ...s.shelf.filter((x) => !(x.sourceId === rec.sourceId && x.mangaId === rec.mangaId))],
    }));
  },

  removeFromShelf: async (sourceId, mangaId) => {
    if (isSqlAvailable()) {
      try {
        const db = await getDb();
        await db.execute(
          "DELETE FROM manga_shelf WHERE source_id = $1 AND manga_id = $2",
          [sourceId, mangaId]
        );
      } catch (e) {
        console.error("[manga] removeFromShelf sql failed", e);
      }
    }
    set((s) => ({
      shelf: s.shelf.filter((x) => !(x.sourceId === sourceId && x.mangaId === mangaId)),
    }));
  },

  isOnShelf: (sourceId, mangaId) =>
    get().shelf.some((s) => s.sourceId === sourceId && s.mangaId === mangaId),

  updateShelfLastChapter: async (sourceId, mangaId, chapterId, chapterName) => {
    if (!isSqlAvailable()) return;
    try {
      const db = await getDb();
      await db.execute(
        "UPDATE manga_shelf SET last_chapter_id = $3, last_chapter_name = $4 WHERE source_id = $1 AND manga_id = $2",
        [sourceId, mangaId, chapterId, chapterName]
      );
      set((s) => ({
        shelf: s.shelf.map((x) =>
          x.sourceId === sourceId && x.mangaId === mangaId
            ? { ...x, lastChapterId: chapterId, lastChapterName: chapterName }
            : x
        ),
      }));
    } catch (e) {
      console.error("[manga] updateShelfLastChapter sql failed", e);
    }
  },

  saveHistory: async (rec) => {
    const full: MangaHistoryRecord = { ...rec, updatedAt: Date.now() };
    if (isSqlAvailable()) {
      try {
        const db = await getDb();
        await db.execute(
          `INSERT OR REPLACE INTO manga_history
           (source_id, manga_id, chapter_id, chapter_name, page_index, page_count, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            full.sourceId,
            full.mangaId,
            full.chapterId,
            full.chapterName ?? null,
            full.pageIndex,
            full.pageCount,
            full.updatedAt,
          ]
        );
      } catch (e) {
        console.error("[manga] saveHistory sql failed", e);
      }
    }
    set((s) => ({
      history: [
        full,
        ...s.history.filter(
          (h) =>
            !(
              h.sourceId === full.sourceId &&
              h.mangaId === full.mangaId &&
              h.chapterId === full.chapterId
            )
        ),
      ].slice(0, 500),
    }));
  },

  getHistory: (sourceId, mangaId, chapterId) =>
    get().history.find(
      (h) => h.sourceId === sourceId && h.mangaId === mangaId && h.chapterId === chapterId
    ),
}));
