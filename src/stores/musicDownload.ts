import { create } from "zustand";
import { isTauri } from "@/lib/proxy";
import { musicSongKey, type MusicSong } from "@/lib/music";

export type MusicDownloadStatus =
  | "pending"
  | "downloading"
  | "done"
  | "error"
  | "paused";

export interface MusicDownloadItem {
  taskId: string;
  songKey: string;
  title: string;
  artist: string;
  cover?: string;
  status: MusicDownloadStatus;
  progress: number; // 0..100
  downloaded: number;
  total?: number;
  path?: string;
  message?: string;
  createdAt: number;
}

interface RustProgress {
  task_id: string;
  status: string;
  progress: number;
  downloaded: number;
  total?: number;
  path?: string;
  message?: string;
}

interface MusicDownloadStore {
  items: MusicDownloadItem[];
  hydrated: boolean;
  hydrate: () => void;
  /** 已下载（done）的离线库。 */
  completed: () => MusicDownloadItem[];
  isDownloaded: (song: MusicSong) => boolean;
  enqueue: (song: MusicSong, url: string, headers?: Record<string, string>, proxyUrl?: string) => Promise<void>;
  remove: (taskId: string) => void;
  clearFinished: () => void;
}

const STORAGE_KEY = "douytv:music-downloads";

function loadItems(): MusicDownloadItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(items: MusicDownloadItem[]) {
  try {
    // 只持久化已完成的（离线库）；进行中的任务进程退出即失效。
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(items.filter((item) => item.status === "done"))
    );
  } catch {
    /* ignore */
  }
}

let listenerBound = false;

export const useMusicDownloadStore = create<MusicDownloadStore>((set, get) => ({
  items: [],
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    set({ items: loadItems(), hydrated: true });
    // 绑定 Rust 进度事件（仅一次）。
    if (isTauri && !listenerBound) {
      listenerBound = true;
      void (async () => {
        const { listen } = await import("@tauri-apps/api/event");
        await listen<RustProgress>("vod-download-progress", (event) => {
          const p = event.payload;
          const items = get().items;
          const idx = items.findIndex((item) => item.taskId === p.task_id);
          if (idx < 0) return; // 不是音乐任务（视频下载共用同一事件名）
          const next = [...items];
          next[idx] = {
            ...next[idx],
            status: (p.status as MusicDownloadStatus) ?? next[idx].status,
            progress: p.progress ?? next[idx].progress,
            downloaded: p.downloaded ?? next[idx].downloaded,
            total: p.total ?? next[idx].total,
            path: p.path ?? next[idx].path,
            message: p.message ?? next[idx].message,
          };
          set({ items: next });
          if (p.status === "done") persist(next);
        });
      })();
    }
  },
  completed: () => get().items.filter((item) => item.status === "done"),
  isDownloaded: (song) => {
    const key = musicSongKey(song);
    return get().items.some((item) => item.songKey === key && item.status === "done");
  },
  enqueue: async (song, url, headers, proxyUrl) => {
    const key = musicSongKey(song);
    // 已下载过或正在下载就跳过。
    if (get().items.some((item) => item.songKey === key && (item.status === "done" || item.status === "downloading"))) {
      return;
    }
    const taskId = `music-dl-${key}-${Date.now().toString(36)}`;
    const item: MusicDownloadItem = {
      taskId,
      songKey: key,
      title: song.title,
      artist: song.artist,
      cover: song.cover,
      status: "pending",
      progress: 0,
      downloaded: 0,
      createdAt: Date.now(),
    };
    set({ items: [item, ...get().items] });

    if (!isTauri) {
      // 浏览器回退：直接触发 <a download>。
      const link = document.createElement("a");
      link.href = url;
      link.download = `${song.artist} - ${song.title}.mp3`.replace(/[\\/:*?"<>|]+/g, "_");
      document.body.appendChild(link);
      link.click();
      link.remove();
      const next = get().items.map((it) =>
        it.taskId === taskId ? { ...it, status: "done" as const, progress: 100 } : it
      );
      set({ items: next });
      return;
    }

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("music_download", {
        req: {
          task_id: taskId,
          url,
          headers: headers ?? {},
          title: song.title,
          artist: song.artist,
          download_dir: null,
          proxy_url: proxyUrl ?? null,
        },
      });
    } catch (error) {
      const next = get().items.map((it) =>
        it.taskId === taskId
          ? { ...it, status: "error" as const, message: String(error) }
          : it
      );
      set({ items: next });
    }
  },
  remove: (taskId) => {
    const next = get().items.filter((item) => item.taskId !== taskId);
    set({ items: next });
    persist(next);
  },
  clearFinished: () => {
    const next = get().items.filter(
      (item) => item.status === "downloading" || item.status === "pending"
    );
    set({ items: next });
    persist(next);
  },
}));
