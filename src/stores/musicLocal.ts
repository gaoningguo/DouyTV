import { create } from "zustand";
import {
  extractMusicMetadata,
  listMusicFiles,
  scanMusicFolder,
  type MusicSong,
} from "@/lib/music";
import {
  deleteFolder as dbDeleteFolder,
  deleteTracksByPath,
  loadCachedMtimes,
  loadCachedTracks,
  upsertTracks,
} from "@/lib/music/localMusicDb";
import { isSqlAvailable } from "@/lib/db";

/**
 * 本地音乐 store。
 *
 * 持久化:文件夹路径存 localStorage;曲目缓存落 SQLite(local_tracks 表)。
 * 进页流程:hydrate 先从 SQLite 秒读已缓存曲目,再后台按 mtime 增量补扫——
 * 只对新增/变更的文件调 Rust 解析标签,删除消失的文件,避免每次全量重扫。
 * 非 Tauri / SQL 不可用时退回内存态 + 全量扫描(旧行为)。
 */
const FOLDERS_KEY = "douytv:music-local-folders";

interface MusicLocalStore {
  folders: string[];
  tracks: MusicSong[];
  scanning: boolean;
  error: string | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  addFolder: (dir: string) => Promise<number>;
  removeFolder: (dir: string) => Promise<void>;
  rescan: () => Promise<void>;
}

function loadFolders(): string[] {
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveFolders(folders: string[]) {
  try {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
  } catch {
    /* ignore */
  }
}

function dedupeByPath(tracks: MusicSong[]): MusicSong[] {
  const seen = new Set<string>();
  return tracks.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

function sortTracks(tracks: MusicSong[]): MusicSong[] {
  return [...tracks].sort((a, b) => a.title.localeCompare(b.title, "zh"));
}

/**
 * 增量扫描一个文件夹:列文件(快) → 跟缓存的 mtime diff → 只解析新增/变更文件 →
 * upsert 入库 + 删除消失文件 → 返回该文件夹最新曲目。
 */
async function incrementalScanFolder(folder: string): Promise<MusicSong[]> {
  const [files, cachedMtimes] = await Promise.all([
    listMusicFiles(folder),
    loadCachedMtimes(folder),
  ]);

  const currentPaths = new Set(files.map((f) => f.filePath));
  // 需要(重新)解析的文件:新增的 or mtime 变了的。
  const toParse = files
    .filter((f) => {
      const cached = cachedMtimes.get(f.filePath);
      return cached === undefined || cached !== f.mtime;
    })
    .map((f) => f.filePath);
  // 缓存里有但磁盘上没了的文件:删除。
  const toDelete = [...cachedMtimes.keys()].filter((p) => !currentPaths.has(p));

  if (toParse.length > 0) {
    const parsed = await extractMusicMetadata(toParse);
    await upsertTracks(folder, parsed);
  }
  if (toDelete.length > 0) {
    await deleteTracksByPath(toDelete);
  }

  return loadCachedTracks(folder);
}

/** 全量扫描(无 SQL 缓存时的兜底)。 */
async function fullScanFolders(folders: string[]): Promise<MusicSong[]> {
  const settled = await Promise.allSettled(folders.map((dir) => scanMusicFolder(dir)));
  const all = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  return sortTracks(dedupeByPath(all));
}

/** 增量扫描所有文件夹并汇总。 */
async function incrementalScanFolders(folders: string[]): Promise<MusicSong[]> {
  const settled = await Promise.allSettled(folders.map(incrementalScanFolder));
  const all = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  return sortTracks(dedupeByPath(all));
}

async function scanFolders(folders: string[]): Promise<MusicSong[]> {
  if (isSqlAvailable()) return incrementalScanFolders(folders);
  return fullScanFolders(folders);
}

export const useMusicLocalStore = create<MusicLocalStore>((set, get) => ({
  folders: [],
  tracks: [],
  scanning: false,
  error: null,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const folders = loadFolders();
    set({ folders, hydrated: true });
    // 先从 SQLite 秒读已缓存曲目(进页立即有内容)。
    if (folders.length > 0 && isSqlAvailable()) {
      try {
        const cached = await Promise.all(folders.map(loadCachedTracks));
        const tracks = sortTracks(dedupeByPath(cached.flat()));
        if (tracks.length > 0) set({ tracks });
      } catch {
        /* 读缓存失败不致命,后续 rescan 会补 */
      }
    }
  },

  addFolder: async (dir) => {
    const folders = get().folders.includes(dir) ? get().folders : [...get().folders, dir];
    set({ folders, scanning: true, error: null });
    saveFolders(folders);
    try {
      const tracks = await scanFolders(folders);
      set({ tracks, scanning: false });
      return tracks.length;
    } catch (e) {
      set({ scanning: false, error: e instanceof Error ? e.message : "扫描失败" });
      return 0;
    }
  },

  removeFolder: async (dir) => {
    const folders = get().folders.filter((f) => f !== dir);
    set({ folders });
    saveFolders(folders);
    await dbDeleteFolder(dir).catch(() => undefined);
    set({ scanning: true });
    try {
      set({ tracks: await scanFolders(folders), scanning: false });
    } catch {
      set({ scanning: false });
    }
  },

  rescan: async () => {
    const folders = get().folders;
    if (folders.length === 0) {
      set({ tracks: [] });
      return;
    }
    set({ scanning: true, error: null });
    try {
      set({ tracks: await scanFolders(folders), scanning: false });
    } catch (e) {
      set({ scanning: false, error: e instanceof Error ? e.message : "扫描失败" });
    }
  },
}));
