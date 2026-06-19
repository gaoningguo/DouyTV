import { create } from "zustand";
import { scanMusicFolder, type MusicSong } from "@/lib/music";

/**
 * 本地音乐 store。只持久化扫描过的文件夹路径(避免 base64 封面撑爆 localStorage),
 * 曲目内存态:进入本地页时按文件夹重扫。对齐 CyreneMusic「scannedFolders」思路。
 */
const FOLDERS_KEY = "douytv:music-local-folders";

interface MusicLocalStore {
  folders: string[];
  tracks: MusicSong[];
  scanning: boolean;
  error: string | null;
  hydrated: boolean;
  hydrate: () => void;
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

async function scanFolders(folders: string[]): Promise<MusicSong[]> {
  const settled = await Promise.allSettled(folders.map((dir) => scanMusicFolder(dir)));
  const all = settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  return dedupeByPath(all).sort((a, b) => a.title.localeCompare(b.title, "zh"));
}

export const useMusicLocalStore = create<MusicLocalStore>((set, get) => ({
  folders: [],
  tracks: [],
  scanning: false,
  error: null,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    set({ folders: loadFolders(), hydrated: true });
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
