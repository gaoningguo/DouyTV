import { create } from "zustand";
import type { MediaItem } from "@/types/media";
import { getDb, isSqlAvailable } from "@/lib/db";

export interface FavoriteRecord {
  itemId: string;
  scriptKey: string;
  vodId: string;
  title: string;
  poster?: string;
  sourceName?: string;
  addedAt: number;
}

export interface HistoryRecord {
  itemId: string;
  scriptKey: string;
  vodId: string;
  title: string;
  poster?: string;
  sourceName?: string;
  episodeIndex: number;
  position: number;
  duration: number;
  completed: boolean;
  /** 该合集中已看完的所有集（completed=true 时把 episodeIndex 加进去） */
  episodesWatched: number[];
  updatedAt: number;
}

interface LibraryStore {
  favorites: FavoriteRecord[];
  history: HistoryRecord[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  isFavorite: (itemId: string) => boolean;
  toggleFavorite: (item: MediaItem) => void;
  upsertHistory: (
    item: MediaItem,
    update: { position: number; duration: number; episodeIndex?: number }
  ) => void;
  isCompleted: (itemId: string) => boolean;
  clearHistory: () => void;
}

const FAV_KEY = "douytv:favorites";
const HIST_KEY = "douytv:history";
const HISTORY_LIMIT = 500;
const COMPLETION_RATIO = 0.95;

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

function saveArr<T>(key: string, arr: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(arr));
  } catch (e) {
    console.warn(`[library] localStorage persist failed: ${key}`, e);
  }
}

function splitItemId(itemId: string): { scriptKey: string; vodId: string } {
  const idx = itemId.indexOf(":");
  if (idx < 0) return { scriptKey: "", vodId: itemId };
  return { scriptKey: itemId.slice(0, idx), vodId: itemId.slice(idx + 1) };
}

interface FavoriteRow {
  item_id: string;
  script_key: string;
  vod_id: string;
  title: string;
  poster: string | null;
  source_name: string | null;
  added_at: number;
}

interface HistoryRow {
  item_id: string;
  script_key: string;
  vod_id: string;
  title: string;
  poster: string | null;
  source_name: string | null;
  episode_index: number;
  position: number;
  duration: number;
  completed: number;
  episodes_watched: string;
  updated_at: number;
}

function rowToFavorite(r: FavoriteRow): FavoriteRecord {
  return {
    itemId: r.item_id,
    scriptKey: r.script_key,
    vodId: r.vod_id,
    title: r.title,
    poster: r.poster ?? undefined,
    sourceName: r.source_name ?? undefined,
    addedAt: r.added_at,
  };
}

function rowToHistory(r: HistoryRow): HistoryRecord {
  let watched: number[] = [];
  try {
    const parsed = JSON.parse(r.episodes_watched ?? "[]");
    if (Array.isArray(parsed)) {
      watched = parsed.filter((n) => typeof n === "number");
    }
  } catch {
    /* legacy / malformed - default empty */
  }
  return {
    itemId: r.item_id,
    scriptKey: r.script_key,
    vodId: r.vod_id,
    title: r.title,
    poster: r.poster ?? undefined,
    sourceName: r.source_name ?? undefined,
    episodeIndex: r.episode_index,
    position: r.position,
    duration: r.duration,
    completed: r.completed === 1,
    episodesWatched: watched,
    updatedAt: r.updated_at,
  };
}

async function sqlUpsertFavorite(f: FavoriteRecord): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO favorites (item_id, script_key, vod_id, title, poster, source_name, added_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [
      f.itemId,
      f.scriptKey,
      f.vodId,
      f.title,
      f.poster ?? null,
      f.sourceName ?? null,
      f.addedAt,
    ]
  );
}

async function sqlDeleteFavorite(itemId: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM favorites WHERE item_id = $1", [itemId]);
}

async function sqlUpsertHistory(h: HistoryRecord): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT OR REPLACE INTO history (item_id, script_key, vod_id, title, poster, source_name, episode_index, position, duration, completed, episodes_watched, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    [
      h.itemId,
      h.scriptKey,
      h.vodId,
      h.title,
      h.poster ?? null,
      h.sourceName ?? null,
      h.episodeIndex,
      h.position,
      h.duration,
      h.completed ? 1 : 0,
      JSON.stringify(h.episodesWatched),
      h.updatedAt,
    ]
  );
  // 超出 HISTORY_LIMIT 时删除最老的
  await db.execute(
    "DELETE FROM history WHERE item_id IN (SELECT item_id FROM history ORDER BY updated_at DESC LIMIT -1 OFFSET $1)",
    [HISTORY_LIMIT]
  );
}

async function sqlClearHistory(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM history");
}

async function sqlLoadAll(): Promise<{
  favorites: FavoriteRecord[];
  history: HistoryRecord[];
}> {
  const db = await getDb();
  const favs = await db.select<FavoriteRow[]>(
    "SELECT * FROM favorites ORDER BY added_at DESC"
  );
  const hist = await db.select<HistoryRow[]>(
    "SELECT * FROM history ORDER BY updated_at DESC LIMIT $1",
    [HISTORY_LIMIT]
  );
  return {
    favorites: favs.map(rowToFavorite),
    history: hist.map(rowToHistory),
  };
}

/** 把 localStorage 旧数据搬到 SQLite（只在首次发现时执行）。 */
async function migrateLegacy(): Promise<void> {
  const oldFavs = loadArr<FavoriteRecord>(FAV_KEY);
  const oldHist = loadArr<HistoryRecord>(HIST_KEY);
  if (oldFavs.length === 0 && oldHist.length === 0) return;
  try {
    for (const f of oldFavs) await sqlUpsertFavorite(f);
    for (const h of oldHist) await sqlUpsertHistory(h);
    localStorage.removeItem(FAV_KEY);
    localStorage.removeItem(HIST_KEY);
    console.info(
      `[library] migrated ${oldFavs.length} favorites + ${oldHist.length} history rows to SQLite`
    );
  } catch (e) {
    console.error("[library] legacy migration failed (keep localStorage):", e);
  }
}

/**
 * 把 SQL/localStorage 加载的数据合并进当前 in-memory state，而不是直接覆盖。
 *
 * 为什么：hydrate 是 async，用户可能在 hydrate 完成前就点了收藏 → state 已有
 * [item]。如果 hydrate 完成后 set({ favorites: sqlFavs }) 直接覆盖，用户刚加的
 * 那条会丢。合并时本地的优先（addedAt 大的覆盖），保证不丢失最新动作。
 */
function mergeFavorites(
  local: FavoriteRecord[],
  loaded: FavoriteRecord[]
): FavoriteRecord[] {
  const map = new Map<string, FavoriteRecord>();
  for (const f of loaded) map.set(f.itemId, f);
  for (const f of local) {
    const ex = map.get(f.itemId);
    if (!ex || f.addedAt > ex.addedAt) map.set(f.itemId, f);
  }
  return Array.from(map.values()).sort((a, b) => b.addedAt - a.addedAt);
}

function mergeHistory(
  local: HistoryRecord[],
  loaded: HistoryRecord[]
): HistoryRecord[] {
  const map = new Map<string, HistoryRecord>();
  for (const h of loaded) map.set(h.itemId, h);
  for (const h of local) {
    const ex = map.get(h.itemId);
    if (!ex || h.updatedAt > ex.updatedAt) map.set(h.itemId, h);
  }
  return Array.from(map.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, HISTORY_LIMIT);
}

export const useLibraryStore = create<LibraryStore>((set, get) => ({
  favorites: [],
  history: [],
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return;
    if (isSqlAvailable()) {
      try {
        await migrateLegacy();
        const { favorites, history } = await sqlLoadAll();
        set((s) => ({
          favorites: mergeFavorites(s.favorites, favorites),
          history: mergeHistory(s.history, history),
          hydrated: true,
        }));
        return;
      } catch (e) {
        console.error("[library] SQL hydrate failed, fallback to localStorage", e);
      }
    }
    set((s) => ({
      favorites: mergeFavorites(s.favorites, loadArr<FavoriteRecord>(FAV_KEY)),
      history: mergeHistory(s.history, loadArr<HistoryRecord>(HIST_KEY)),
      hydrated: true,
    }));
  },
  isFavorite: (itemId) => get().favorites.some((f) => f.itemId === itemId),
  toggleFavorite: (item) => {
    const { scriptKey, vodId } = splitItemId(item.id);
    const isFav = get().isFavorite(item.id);
    if (isFav) {
      const next = get().favorites.filter((f) => f.itemId !== item.id);
      set({ favorites: next });
      if (isSqlAvailable()) {
        void sqlDeleteFavorite(item.id).catch((e) =>
          console.error("[library] sqlDeleteFavorite", e)
        );
      } else {
        saveArr(FAV_KEY, next);
      }
    } else {
      const record: FavoriteRecord = {
        itemId: item.id,
        scriptKey,
        vodId,
        title: item.title,
        poster: item.poster,
        sourceName: item.sourceName,
        addedAt: Date.now(),
      };
      const next = [record, ...get().favorites];
      set({ favorites: next });
      if (isSqlAvailable()) {
        void sqlUpsertFavorite(record).catch((e) =>
          console.error("[library] sqlUpsertFavorite", e)
        );
      } else {
        saveArr(FAV_KEY, next);
      }
    }
  },
  upsertHistory: (item, update) => {
    const { scriptKey, vodId } = splitItemId(item.id);
    const completed =
      update.duration > 0 && update.position / update.duration >= COMPLETION_RATIO;
    const existing = get().history.find((h) => h.itemId === item.id);
    const newEpIdx = update.episodeIndex ?? existing?.episodeIndex ?? 0;
    // 合并已看完的集索引：existing 列表 ∪ 当前若 completed 则加入
    const watchedSet = new Set<number>(existing?.episodesWatched ?? []);
    if (completed) watchedSet.add(newEpIdx);
    const episodesWatched = Array.from(watchedSet).sort((a, b) => a - b);
    const merged: HistoryRecord = {
      itemId: item.id,
      scriptKey: existing?.scriptKey || scriptKey,
      vodId: existing?.vodId || vodId,
      title: item.title,
      poster: item.poster ?? existing?.poster,
      sourceName: item.sourceName ?? existing?.sourceName,
      episodeIndex: newEpIdx,
      position: update.position,
      duration: update.duration,
      completed: completed || existing?.completed || false,
      episodesWatched,
      updatedAt: Date.now(),
    };
    const next = [
      merged,
      ...get().history.filter((h) => h.itemId !== item.id),
    ].slice(0, HISTORY_LIMIT);
    set({ history: next });
    if (isSqlAvailable()) {
      void sqlUpsertHistory(merged).catch((e) =>
        console.error("[library] sqlUpsertHistory", e)
      );
    } else {
      saveArr(HIST_KEY, next);
    }
  },
  isCompleted: (itemId) =>
    get().history.some((h) => h.itemId === itemId && h.completed),
  clearHistory: () => {
    set({ history: [] });
    if (isSqlAvailable()) {
      void sqlClearHistory().catch((e) =>
        console.error("[library] sqlClearHistory", e)
      );
    } else {
      saveArr(HIST_KEY, []);
    }
  },
}));
