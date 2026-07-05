import { create } from "zustand";
import { getDb, isSqlAvailable } from "@/lib/db";
import {
  DEFAULT_SUWAYOMI_CONFIG,
  mangaItemKey,
  type MangaReadRecord,
  type MangaShelfItem,
  type SuwayomiConfig,
} from "@/lib/manga/types";

// 漫画模块 store。
//   - Suwayomi 连接配置(serverUrl/鉴权/默认语言/限定源) → localStorage(可离线改)
//   - 书架 + 阅读历史 → SQLite(isSqlAvailable 时),否则 localStorage 兜底
// 与 library store 一致:hydrate 时 merge 而非覆盖,避免 hydrate 前的用户操作被冲掉。

const CONFIG_KEY = "douytv:manga-config";
const SHELF_KEY = "douytv:manga-shelf";
const HISTORY_KEY = "douytv:manga-history";
const HISTORY_LIMIT = 100;

function loadArr<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function saveArr<T>(key: string, arr: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(arr));
  } catch (e) {
    console.warn(`[manga] localStorage persist failed: ${key}`, e);
  }
}

function loadConfig(): SuwayomiConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_SUWAYOMI_CONFIG };
    const parsed = JSON.parse(raw) as Partial<SuwayomiConfig>;
    return { ...DEFAULT_SUWAYOMI_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_SUWAYOMI_CONFIG };
  }
}

function saveConfig(config: SuwayomiConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch (e) {
    console.warn("[manga] config persist failed", e);
  }
}

interface ShelfRow {
  source_id: string;
  source_name: string;
  manga_id: string;
  title: string;
  cover: string;
  description: string | null;
  author: string | null;
  status: string | null;
  last_chapter_id: string | null;
  last_chapter_name: string | null;
  save_time: number;
}

interface HistoryRow {
  source_id: string;
  source_name: string;
  manga_id: string;
  chapter_id: string;
  chapter_name: string;
  title: string;
  cover: string;
  page_index: number;
  page_count: number;
  save_time: number;
}

function rowToShelf(r: ShelfRow): MangaShelfItem {
  return {
    sourceId: r.source_id,
    sourceName: r.source_name,
    mangaId: r.manga_id,
    title: r.title,
    cover: r.cover,
    description: r.description ?? undefined,
    author: r.author ?? undefined,
    status: r.status ?? undefined,
    lastChapterId: r.last_chapter_id ?? undefined,
    lastChapterName: r.last_chapter_name ?? undefined,
    saveTime: r.save_time,
  };
}

function rowToHistory(r: HistoryRow): MangaReadRecord {
  return {
    sourceId: r.source_id,
    sourceName: r.source_name,
    mangaId: r.manga_id,
    chapterId: r.chapter_id,
    chapterName: r.chapter_name,
    title: r.title,
    cover: r.cover,
    pageIndex: r.page_index,
    pageCount: r.page_count,
    saveTime: r.save_time,
  };
}

async function sqlUpsertShelf(item: MangaShelfItem): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO manga_shelf (source_id, source_name, manga_id, title, cover, description, author, status, last_chapter_id, last_chapter_name, save_time) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [
      item.sourceId,
      item.sourceName,
      item.mangaId,
      item.title,
      item.cover,
      item.description ?? null,
      item.author ?? null,
      item.status ?? null,
      item.lastChapterId ?? null,
      item.lastChapterName ?? null,
      item.saveTime,
    ]
  );
}

async function sqlDeleteShelf(sourceId: string, mangaId: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM manga_shelf WHERE source_id = $1 AND manga_id = $2",
    [sourceId, mangaId]
  );
}

async function sqlUpsertHistory(record: MangaReadRecord): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO manga_history (source_id, source_name, manga_id, chapter_id, chapter_name, title, cover, page_index, page_count, save_time) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
    [
      record.sourceId,
      record.sourceName,
      record.mangaId,
      record.chapterId,
      record.chapterName,
      record.title,
      record.cover,
      record.pageIndex,
      record.pageCount,
      record.saveTime,
    ]
  );
  await db.execute(
    "DELETE FROM manga_history WHERE (source_id, manga_id) IN (SELECT source_id, manga_id FROM manga_history ORDER BY save_time DESC LIMIT -1 OFFSET $1)",
    [HISTORY_LIMIT]
  );
}

async function sqlLoadAll(): Promise<{
  shelf: MangaShelfItem[];
  history: MangaReadRecord[];
}> {
  const db = await getDb();
  const shelf = await db.select<ShelfRow[]>(
    "SELECT * FROM manga_shelf ORDER BY save_time DESC"
  );
  const history = await db.select<HistoryRow[]>(
    "SELECT * FROM manga_history ORDER BY save_time DESC LIMIT $1",
    [HISTORY_LIMIT]
  );
  return { shelf: shelf.map(rowToShelf), history: history.map(rowToHistory) };
}

function mergeShelf(
  local: MangaShelfItem[],
  loaded: MangaShelfItem[]
): MangaShelfItem[] {
  const map = new Map<string, MangaShelfItem>();
  for (const s of loaded) map.set(mangaItemKey(s.sourceId, s.mangaId), s);
  for (const s of local) {
    const key = mangaItemKey(s.sourceId, s.mangaId);
    const ex = map.get(key);
    if (!ex || s.saveTime > ex.saveTime) map.set(key, s);
  }
  return Array.from(map.values()).sort((a, b) => b.saveTime - a.saveTime);
}

function mergeHistory(
  local: MangaReadRecord[],
  loaded: MangaReadRecord[]
): MangaReadRecord[] {
  const map = new Map<string, MangaReadRecord>();
  for (const h of loaded) map.set(mangaItemKey(h.sourceId, h.mangaId), h);
  for (const h of local) {
    const key = mangaItemKey(h.sourceId, h.mangaId);
    const ex = map.get(key);
    if (!ex || h.saveTime > ex.saveTime) map.set(key, h);
  }
  return Array.from(map.values())
    .sort((a, b) => b.saveTime - a.saveTime)
    .slice(0, HISTORY_LIMIT);
}

interface MangaStore {
  config: SuwayomiConfig;
  shelf: MangaShelfItem[];
  history: MangaReadRecord[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setConfig: (patch: Partial<SuwayomiConfig>) => void;
  isOnShelf: (sourceId: string, mangaId: string) => boolean;
  toggleShelf: (item: MangaShelfItem) => void;
  upsertHistory: (record: MangaReadRecord) => void;
  getHistory: (sourceId: string, mangaId: string) => MangaReadRecord | undefined;
  clearHistory: () => void;
}

async function sqlClearHistory(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM manga_history");
}

export const useMangaStore = create<MangaStore>((set, get) => ({
  config: DEFAULT_SUWAYOMI_CONFIG,
  shelf: [],
  history: [],
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return;
    const config = loadConfig();
    if (isSqlAvailable()) {
      try {
        const localShelf = loadArr<MangaShelfItem>(SHELF_KEY);
        const localHistory = loadArr<MangaReadRecord>(HISTORY_KEY);
        // 一次性迁移旧 localStorage 数据到 SQLite
        if (localShelf.length || localHistory.length) {
          for (const s of localShelf) await sqlUpsertShelf(s).catch(() => {});
          for (const h of localHistory)
            await sqlUpsertHistory(h).catch(() => {});
          localStorage.removeItem(SHELF_KEY);
          localStorage.removeItem(HISTORY_KEY);
        }
        const { shelf, history } = await sqlLoadAll();
        set((st) => ({
          config,
          shelf: mergeShelf(st.shelf, shelf),
          history: mergeHistory(st.history, history),
          hydrated: true,
        }));
        return;
      } catch (e) {
        console.error("[manga] SQL hydrate failed, fallback localStorage", e);
      }
    }
    set((st) => ({
      config,
      shelf: mergeShelf(st.shelf, loadArr<MangaShelfItem>(SHELF_KEY)),
      history: mergeHistory(st.history, loadArr<MangaReadRecord>(HISTORY_KEY)),
      hydrated: true,
    }));
  },
  setConfig: (patch) => {
    const next = { ...get().config, ...patch };
    set({ config: next });
    saveConfig(next);
  },
  isOnShelf: (sourceId, mangaId) =>
    get().shelf.some(
      (s) => s.sourceId === sourceId && s.mangaId === mangaId
    ),
  toggleShelf: (item) => {
    const on = get().isOnShelf(item.sourceId, item.mangaId);
    if (on) {
      const next = get().shelf.filter(
        (s) => !(s.sourceId === item.sourceId && s.mangaId === item.mangaId)
      );
      set({ shelf: next });
      if (isSqlAvailable()) {
        void sqlDeleteShelf(item.sourceId, item.mangaId).catch((e) =>
          console.error("[manga] sqlDeleteShelf", e)
        );
      } else {
        saveArr(SHELF_KEY, next);
      }
    } else {
      const record: MangaShelfItem = { ...item, saveTime: Date.now() };
      const next = [record, ...get().shelf];
      set({ shelf: next });
      if (isSqlAvailable()) {
        void sqlUpsertShelf(record).catch((e) =>
          console.error("[manga] sqlUpsertShelf", e)
        );
      } else {
        saveArr(SHELF_KEY, next);
      }
    }
  },
  upsertHistory: (record) => {
    const merged: MangaReadRecord = { ...record, saveTime: Date.now() };
    const next = [
      merged,
      ...get().history.filter(
        (h) => !(h.sourceId === record.sourceId && h.mangaId === record.mangaId)
      ),
    ].slice(0, HISTORY_LIMIT);
    set({ history: next });
    if (isSqlAvailable()) {
      void sqlUpsertHistory(merged).catch((e) =>
        console.error("[manga] sqlUpsertHistory", e)
      );
    } else {
      saveArr(HISTORY_KEY, next);
    }
  },
  getHistory: (sourceId, mangaId) =>
    get().history.find(
      (h) => h.sourceId === sourceId && h.mangaId === mangaId
    ),
  clearHistory: () => {
    set({ history: [] });
    if (isSqlAvailable()) {
      void sqlClearHistory().catch((e) =>
        console.error("[manga] sqlClearHistory", e)
      );
    } else {
      saveArr(HISTORY_KEY, []);
    }
  },
}));
