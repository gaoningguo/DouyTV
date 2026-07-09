import { create } from "zustand";
import { getDb, isSqlAvailable } from "@/lib/db";
import {
  BOOK_SETTINGS_KEY,
  BOOK_SOURCES_KEY,
  BOOK_SUBSCRIPTIONS_KEY,
} from "@/lib/book/config";
import { legadoSubscriptionStore } from "@/lib/book/subscription-store";
import { BOOK_TTS_DEFAULTS } from "@/lib/book/tts";
import {
  bookItemKey,
  type BookReadRecord,
  type BookShelfItem,
  type BookSource,
  type LegadoSubscriptionMeta,
} from "@/lib/book/types";

// 小说模块 store。
//   - 手动书源(OPDS/Legado 单条) + Legado 订阅元数据 + 阅读/TTS 设置 → localStorage
//     (引擎 config.ts 直接读这些 key,store 只负责写)
//   - 书架 + 阅读记录 → SQLite(isSqlAvailable 时),否则 localStorage 兜底
// 与 library/manga store 一致:hydrate 时 merge 而非覆盖。

const SHELF_KEY = "douytv:book-shelf";
const RECORD_KEY = "douytv:book-records";
const RECORD_LIMIT = 200;

/** 阅读器 / TTS 用户设置(落 douytv:book-settings)。 */
export interface BookSettings {
  fontSize: number;
  lineHeight: number;
  /** 阅读主题。 */
  theme: "sepia" | "dark" | "paper";
  /** TTS 音色 shortName。 */
  ttsVoice: string;
  ttsRate: string;
  ttsPitch: string;
  ttsVolume: string;
}

export const DEFAULT_BOOK_SETTINGS: BookSettings = {
  fontSize: 18,
  lineHeight: 1.8,
  theme: "sepia",
  ttsVoice: BOOK_TTS_DEFAULTS.voice,
  ttsRate: BOOK_TTS_DEFAULTS.rate,
  ttsPitch: BOOK_TTS_DEFAULTS.pitch,
  ttsVolume: BOOK_TTS_DEFAULTS.volume,
};

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
    console.warn(`[book] localStorage persist failed: ${key}`, e);
  }
}

function loadSettings(): BookSettings {
  try {
    const raw = localStorage.getItem(BOOK_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_BOOK_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<BookSettings>;
    return { ...DEFAULT_BOOK_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_BOOK_SETTINGS };
  }
}

interface ShelfRow {
  source_id: string;
  source_name: string;
  book_id: string;
  title: string;
  author: string | null;
  cover: string | null;
  format: string | null;
  detail_href: string | null;
  acquisition_href: string | null;
  progress_percent: number | null;
  last_read_time: number | null;
  last_locator_type: string | null;
  last_locator_value: string | null;
  last_chapter_title: string | null;
  save_time: number;
}

interface RecordRow {
  source_id: string;
  source_name: string;
  book_id: string;
  title: string;
  author: string | null;
  cover: string | null;
  format: string;
  detail_href: string | null;
  acquisition_href: string | null;
  locator_type: string;
  locator_value: string;
  locator_href: string | null;
  locator_chapter_title: string | null;
  progress_percent: number;
  chapter_title: string | null;
  chapter_href: string | null;
  save_time: number;
}

function rowToShelf(r: ShelfRow): BookShelfItem {
  return {
    sourceId: r.source_id,
    sourceName: r.source_name,
    bookId: r.book_id,
    title: r.title,
    author: r.author ?? undefined,
    cover: r.cover ?? undefined,
    format: (r.format as BookShelfItem["format"]) ?? undefined,
    detailHref: r.detail_href ?? undefined,
    acquisitionHref: r.acquisition_href ?? undefined,
    progressPercent: r.progress_percent ?? undefined,
    lastReadTime: r.last_read_time ?? undefined,
    lastLocatorType: (r.last_locator_type as BookShelfItem["lastLocatorType"]) ?? undefined,
    lastLocatorValue: r.last_locator_value ?? undefined,
    lastChapterTitle: r.last_chapter_title ?? undefined,
    saveTime: r.save_time,
  };
}

function rowToRecord(r: RecordRow): BookReadRecord {
  return {
    sourceId: r.source_id,
    sourceName: r.source_name,
    bookId: r.book_id,
    title: r.title,
    author: r.author ?? undefined,
    cover: r.cover ?? undefined,
    format: r.format as BookReadRecord["format"],
    detailHref: r.detail_href ?? undefined,
    acquisitionHref: r.acquisition_href ?? undefined,
    locator: {
      type: r.locator_type as BookReadRecord["locator"]["type"],
      value: r.locator_value,
      href: r.locator_href ?? undefined,
      chapterTitle: r.locator_chapter_title ?? undefined,
    },
    progressPercent: r.progress_percent,
    chapterTitle: r.chapter_title ?? undefined,
    chapterHref: r.chapter_href ?? undefined,
    saveTime: r.save_time,
  };
}

async function sqlUpsertShelf(item: BookShelfItem): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO book_shelf (source_id, source_name, book_id, title, author, cover, format, detail_href, acquisition_href, progress_percent, last_read_time, last_locator_type, last_locator_value, last_chapter_title, save_time) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
    [
      item.sourceId,
      item.sourceName,
      item.bookId,
      item.title,
      item.author ?? null,
      item.cover ?? null,
      item.format ?? null,
      item.detailHref ?? null,
      item.acquisitionHref ?? null,
      item.progressPercent ?? null,
      item.lastReadTime ?? null,
      item.lastLocatorType ?? null,
      item.lastLocatorValue ?? null,
      item.lastChapterTitle ?? null,
      item.saveTime,
    ]
  );
}

async function sqlDeleteShelf(sourceId: string, bookId: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM book_shelf WHERE source_id = $1 AND book_id = $2",
    [sourceId, bookId]
  );
}

async function sqlUpsertRecord(record: BookReadRecord): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO book_records (source_id, source_name, book_id, title, author, cover, format, detail_href, acquisition_href, locator_type, locator_value, locator_href, locator_chapter_title, progress_percent, chapter_title, chapter_href, save_time) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)",
    [
      record.sourceId,
      record.sourceName,
      record.bookId,
      record.title,
      record.author ?? null,
      record.cover ?? null,
      record.format,
      record.detailHref ?? null,
      record.acquisitionHref ?? null,
      record.locator.type,
      record.locator.value,
      record.locator.href ?? null,
      record.locator.chapterTitle ?? null,
      record.progressPercent,
      record.chapterTitle ?? null,
      record.chapterHref ?? null,
      record.saveTime,
    ]
  );
  await db.execute(
    "DELETE FROM book_records WHERE (source_id, book_id) IN (SELECT source_id, book_id FROM book_records ORDER BY save_time DESC LIMIT -1 OFFSET $1)",
    [RECORD_LIMIT]
  );
}

async function sqlClearRecords(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM book_records");
}

async function sqlLoadAll(): Promise<{
  shelf: BookShelfItem[];
  records: BookReadRecord[];
}> {
  const db = await getDb();
  const shelf = await db.select<ShelfRow[]>(
    "SELECT * FROM book_shelf ORDER BY save_time DESC"
  );
  const records = await db.select<RecordRow[]>(
    "SELECT * FROM book_records ORDER BY save_time DESC LIMIT $1",
    [RECORD_LIMIT]
  );
  return { shelf: shelf.map(rowToShelf), records: records.map(rowToRecord) };
}

function mergeShelf(
  local: BookShelfItem[],
  loaded: BookShelfItem[]
): BookShelfItem[] {
  const map = new Map<string, BookShelfItem>();
  for (const s of loaded) map.set(bookItemKey(s.sourceId, s.bookId), s);
  for (const s of local) {
    const key = bookItemKey(s.sourceId, s.bookId);
    const ex = map.get(key);
    if (!ex || s.saveTime > ex.saveTime) map.set(key, s);
  }
  return Array.from(map.values()).sort((a, b) => b.saveTime - a.saveTime);
}

function mergeRecords(
  local: BookReadRecord[],
  loaded: BookReadRecord[]
): BookReadRecord[] {
  const map = new Map<string, BookReadRecord>();
  for (const r of loaded) map.set(bookItemKey(r.sourceId, r.bookId), r);
  for (const r of local) {
    const key = bookItemKey(r.sourceId, r.bookId);
    const ex = map.get(key);
    if (!ex || r.saveTime > ex.saveTime) map.set(key, r);
  }
  return Array.from(map.values())
    .sort((a, b) => b.saveTime - a.saveTime)
    .slice(0, RECORD_LIMIT);
}

interface BookStore {
  sources: BookSource[];
  subscriptions: LegadoSubscriptionMeta[];
  settings: BookSettings;
  shelf: BookShelfItem[];
  records: BookReadRecord[];
  hydrated: boolean;
  hydrate: () => Promise<void>;

  // --- 书源(手动) ---
  addSource: (source: BookSource) => void;
  updateSource: (id: string, patch: Partial<BookSource>) => void;
  removeSource: (id: string) => void;
  toggleSource: (id: string) => void;

  // --- Legado 订阅 ---
  syncSubscription: (input: { name?: string; url: string }) => Promise<void>;
  removeSubscription: (id: string) => void;
  toggleSubscription: (id: string) => void;

  // --- 设置 ---
  setSettings: (patch: Partial<BookSettings>) => void;

  // --- 书架 / 阅读记录 ---
  isOnShelf: (sourceId: string, bookId: string) => boolean;
  toggleShelf: (item: BookShelfItem) => void;
  upsertRecord: (record: BookReadRecord) => void;
  getRecord: (sourceId: string, bookId: string) => BookReadRecord | undefined;
  clearRecords: () => void;
}

function persistSources(sources: BookSource[]): void {
  saveArr(BOOK_SOURCES_KEY, sources);
}

function persistSubscriptions(subs: LegadoSubscriptionMeta[]): void {
  saveArr(BOOK_SUBSCRIPTIONS_KEY, subs);
}

/**
 * hydrate 期间(await SQL 迁移可达数百 ms)用户可能已 addSource/syncSubscription。
 * 结束时的 set 必须与内存态 merge、而非用开头的 localStorage 快照覆盖,否则刚导入的源被清掉
 * (localStorage 已存,所以重启后又出现——正是"导入后收缩页 0 源"的现象)。
 * 内存态(in-flight)优先:按 id 去重,st 里已有的覆盖 loaded。
 */
function mergeById<T extends { id: string }>(inflight: T[], loaded: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of loaded) map.set(item.id, item);
  for (const item of inflight) map.set(item.id, item); // in-flight wins
  return Array.from(map.values());
}

// hydrate 去重:并发调用(Book.tsx + BookSourcesHub 都会触发)只跑一次。
let hydratePromise: Promise<void> | null = null;

export const useBookStore = create<BookStore>((set, get) => ({
  sources: [],
  subscriptions: [],
  settings: DEFAULT_BOOK_SETTINGS,
  shelf: [],
  records: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    if (hydratePromise) return hydratePromise;
    hydratePromise = (async () => {
      const sources = loadArr<BookSource>(BOOK_SOURCES_KEY);
      const subscriptions = loadArr<LegadoSubscriptionMeta>(BOOK_SUBSCRIPTIONS_KEY);
      const settings = loadSettings();

      if (isSqlAvailable()) {
        try {
          const localShelf = loadArr<BookShelfItem>(SHELF_KEY);
          const localRecords = loadArr<BookReadRecord>(RECORD_KEY);
          if (localShelf.length || localRecords.length) {
            for (const s of localShelf) await sqlUpsertShelf(s).catch(() => {});
            for (const r of localRecords) await sqlUpsertRecord(r).catch(() => {});
            localStorage.removeItem(SHELF_KEY);
            localStorage.removeItem(RECORD_KEY);
          }
          const { shelf, records } = await sqlLoadAll();
          set((st) => ({
            sources: mergeById(st.sources, sources),
            subscriptions: mergeById(st.subscriptions, subscriptions),
            settings,
            shelf: mergeShelf(st.shelf, shelf),
            records: mergeRecords(st.records, records),
            hydrated: true,
          }));
          return;
        } catch (e) {
          console.error("[book] SQL hydrate failed, fallback localStorage", e);
        }
      }
      set((st) => ({
        sources: mergeById(st.sources, sources),
        subscriptions: mergeById(st.subscriptions, subscriptions),
        settings,
        shelf: mergeShelf(st.shelf, loadArr<BookShelfItem>(SHELF_KEY)),
        records: mergeRecords(st.records, loadArr<BookReadRecord>(RECORD_KEY)),
        hydrated: true,
      }));
    })();
    return hydratePromise;
  },

  addSource: (source) => {
    const next = [...get().sources.filter((s) => s.id !== source.id), source];
    set({ sources: next });
    persistSources(next);
  },
  updateSource: (id, patch) => {
    const next = get().sources.map((s) => (s.id === id ? { ...s, ...patch } : s));
    set({ sources: next });
    persistSources(next);
  },
  removeSource: (id) => {
    const next = get().sources.filter((s) => s.id !== id);
    set({ sources: next });
    persistSources(next);
  },
  toggleSource: (id) => {
    const next = get().sources.map((s) =>
      s.id === id ? { ...s, enabled: s.enabled === false } : s
    );
    set({ sources: next });
    persistSources(next);
  },

  syncSubscription: async (input) => {
    const existing = get().subscriptions.find(
      (s) => s.url === input.url.trim()
    );
    const meta = await legadoSubscriptionStore.sync({
      id: existing?.id,
      name: input.name,
      url: input.url,
    });
    const next = get().subscriptions.some((s) => s.id === meta.id)
      ? get().subscriptions.map((s) => (s.id === meta.id ? { ...s, ...meta } : s))
      : [...get().subscriptions, meta];
    set({ subscriptions: next });
    persistSubscriptions(next);
  },
  removeSubscription: (id) => {
    void legadoSubscriptionStore.delete(id).catch((e) =>
      console.error("[book] subscription delete", e)
    );
    const next = get().subscriptions.filter((s) => s.id !== id);
    set({ subscriptions: next });
    persistSubscriptions(next);
  },
  toggleSubscription: (id) => {
    const next = get().subscriptions.map((s) =>
      s.id === id ? { ...s, enabled: s.enabled === false } : s
    );
    set({ subscriptions: next });
    persistSubscriptions(next);
  },

  setSettings: (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    try {
      localStorage.setItem(BOOK_SETTINGS_KEY, JSON.stringify(next));
    } catch (e) {
      console.warn("[book] settings persist failed", e);
    }
  },

  isOnShelf: (sourceId, bookId) =>
    get().shelf.some((s) => s.sourceId === sourceId && s.bookId === bookId),
  toggleShelf: (item) => {
    const on = get().isOnShelf(item.sourceId, item.bookId);
    if (on) {
      const next = get().shelf.filter(
        (s) => !(s.sourceId === item.sourceId && s.bookId === item.bookId)
      );
      set({ shelf: next });
      if (isSqlAvailable()) {
        void sqlDeleteShelf(item.sourceId, item.bookId).catch((e) =>
          console.error("[book] sqlDeleteShelf", e)
        );
      } else {
        saveArr(SHELF_KEY, next);
      }
    } else {
      const record: BookShelfItem = { ...item, saveTime: Date.now() };
      const next = [record, ...get().shelf];
      set({ shelf: next });
      if (isSqlAvailable()) {
        void sqlUpsertShelf(record).catch((e) =>
          console.error("[book] sqlUpsertShelf", e)
        );
      } else {
        saveArr(SHELF_KEY, next);
      }
    }
  },
  upsertRecord: (record) => {
    const merged: BookReadRecord = { ...record, saveTime: Date.now() };
    const next = [
      merged,
      ...get().records.filter(
        (r) => !(r.sourceId === record.sourceId && r.bookId === record.bookId)
      ),
    ].slice(0, RECORD_LIMIT);
    set({ records: next });
    // 同步更新书架里该书的进度(若在架)
    const shelf = get().shelf.map((s) =>
      s.sourceId === record.sourceId && s.bookId === record.bookId
        ? {
            ...s,
            progressPercent: record.progressPercent,
            lastReadTime: merged.saveTime,
            lastLocatorType: record.locator.type,
            lastLocatorValue: record.locator.value,
            lastChapterTitle: record.chapterTitle,
          }
        : s
    );
    if (shelf.some((s) => s.sourceId === record.sourceId && s.bookId === record.bookId)) {
      set({ shelf });
      const updated = shelf.find(
        (s) => s.sourceId === record.sourceId && s.bookId === record.bookId
      );
      if (updated) {
        if (isSqlAvailable()) void sqlUpsertShelf(updated).catch(() => {});
        else saveArr(SHELF_KEY, shelf);
      }
    }
    if (isSqlAvailable()) {
      void sqlUpsertRecord(merged).catch((e) =>
        console.error("[book] sqlUpsertRecord", e)
      );
    } else {
      saveArr(RECORD_KEY, next);
    }
  },
  getRecord: (sourceId, bookId) =>
    get().records.find(
      (r) => r.sourceId === sourceId && r.bookId === bookId
    ),
  clearRecords: () => {
    set({ records: [] });
    if (isSqlAvailable()) {
      void sqlClearRecords().catch((e) =>
        console.error("[book] sqlClearRecords", e)
      );
    } else {
      saveArr(RECORD_KEY, []);
    }
  },
}));
