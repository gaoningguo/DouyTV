import { create } from "zustand";

export interface WatchLaterRecord {
  itemId: string;
  scriptKey: string;
  vodId: string;
  title: string;
  poster?: string;
  sourceName?: string;
  addedAt: number;
}

export type DownloadTaskStatus = "queued" | "downloading" | "paused" | "done" | "error";

export interface DownloadTask {
  id: string;
  itemId: string;
  scriptKey: string;
  vodId: string;
  title: string;
  poster?: string;
  sourceName?: string;
  playbackIndex: number;
  episodeIndex: number;
  episodeTitle: string;
  url?: string;
  streamType?: string;
  headers?: Record<string, string>;
  status: DownloadTaskStatus;
  progress: number;
  downloadedBytes?: number;
  totalBytes?: number;
  speedBytesPerSec?: number;
  localPath?: string;
  message?: string;
  createdAt: number;
  updatedAt: number;
}

type WatchLaterInput = Omit<WatchLaterRecord, "addedAt">;
type DownloadTaskInput = Omit<
  DownloadTask,
  "id" | "status" | "progress" | "message" | "createdAt" | "updatedAt"
>;

interface VodAssetsStore {
  watchLater: WatchLaterRecord[];
  downloads: DownloadTask[];
  hydrated: boolean;
  hydrate: (force?: boolean) => void;
  isWatchLater: (itemId: string) => boolean;
  toggleWatchLater: (record: WatchLaterInput) => void;
  removeWatchLater: (itemId: string) => void;
  clearWatchLater: () => void;
  addDownloadTask: (task: DownloadTaskInput) => string;
  getDownloadTaskId: (
    itemId: string,
    playbackIndex: number,
    episodeIndex: number
  ) => string | undefined;
  removeDownloadTask: (id: string) => void;
  clearDownloads: () => void;
  updateDownloadTask: (
    id: string,
    patch: Partial<
      Pick<
        DownloadTask,
        | "url"
        | "streamType"
        | "headers"
        | "status"
        | "progress"
        | "downloadedBytes"
        | "totalBytes"
        | "speedBytesPerSec"
        | "localPath"
        | "message"
      >
    >
  ) => void;
}

const WATCH_LATER_KEY = "douytv:vod-watch-later";
const DOWNLOADS_KEY = "douytv:vod-downloads";

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
    console.warn(`[vod-assets] persist failed: ${key}`, e);
  }
}

function taskKey(task: Pick<DownloadTask, "itemId" | "playbackIndex" | "episodeIndex">) {
  return `${task.itemId}:${task.playbackIndex}:${task.episodeIndex}`;
}

function sortWatchLater(rows: WatchLaterRecord[]) {
  return rows.slice().sort((a, b) => b.addedAt - a.addedAt);
}

function sortDownloads(rows: DownloadTask[]) {
  return rows.slice().sort((a, b) => {
    const rank = (row: DownloadTask) => {
      if (row.status === "downloading") return 0;
      if (row.status === "queued") return 1;
      if (row.status === "paused") return 2;
      if (row.status === "error") return 3;
      return 4;
    };
    const rankDelta = rank(a) - rank(b);
    if (rankDelta !== 0) return rankDelta;
    return b.createdAt - a.createdAt;
  });
}

export const useVodAssetsStore = create<VodAssetsStore>((set, get) => ({
  watchLater: [],
  downloads: [],
  hydrated: false,

  hydrate: (force = false) => {
    if (get().hydrated && !force) return;
    set({
      watchLater: sortWatchLater(loadArr<WatchLaterRecord>(WATCH_LATER_KEY)),
      downloads: sortDownloads(loadArr<DownloadTask>(DOWNLOADS_KEY)),
      hydrated: true,
    });
  },

  isWatchLater: (itemId) =>
    get().watchLater.some((record) => record.itemId === itemId),

  toggleWatchLater: (record) => {
    const exists = get().isWatchLater(record.itemId);
    if (exists) {
      const next = get().watchLater.filter((row) => row.itemId !== record.itemId);
      set({ watchLater: next });
      saveArr(WATCH_LATER_KEY, next);
      return;
    }

    const next = sortWatchLater([
      {
        ...record,
        addedAt: Date.now(),
      },
      ...get().watchLater,
    ]);
    set({ watchLater: next });
    saveArr(WATCH_LATER_KEY, next);
  },

  removeWatchLater: (itemId) => {
    const next = get().watchLater.filter((row) => row.itemId !== itemId);
    set({ watchLater: next });
    saveArr(WATCH_LATER_KEY, next);
  },

  clearWatchLater: () => {
    set({ watchLater: [] });
    saveArr<WatchLaterRecord>(WATCH_LATER_KEY, []);
  },

  addDownloadTask: (task) => {
    const now = Date.now();
    const duplicateKey = taskKey(task);
    const existing = get().downloads.find((row) => taskKey(row) === duplicateKey);
    if (existing) {
      const next = sortDownloads([
        {
          ...existing,
          url: task.url ?? existing.url,
          streamType: task.streamType ?? existing.streamType,
          headers: task.headers ?? existing.headers,
          updatedAt: now,
        },
        ...get().downloads.filter((row) => row.id !== existing.id),
      ]);
      set({ downloads: next });
      saveArr(DOWNLOADS_KEY, next);
      return existing.id;
    }

    const id = `${duplicateKey}:${now}`;
    const next = sortDownloads([
      {
        ...task,
        id,
        status: "queued",
        progress: 0,
        createdAt: now,
        updatedAt: now,
      },
      ...get().downloads,
    ]);
    set({ downloads: next });
    saveArr(DOWNLOADS_KEY, next);
    return id;
  },

  getDownloadTaskId: (itemId, playbackIndex, episodeIndex) => {
    const key = taskKey({ itemId, playbackIndex, episodeIndex });
    return get().downloads.find((row) => taskKey(row) === key)?.id;
  },

  removeDownloadTask: (id) => {
    const next = get().downloads.filter((row) => row.id !== id);
    set({ downloads: next });
    saveArr(DOWNLOADS_KEY, next);
  },

  clearDownloads: () => {
    set({ downloads: [] });
    saveArr<DownloadTask>(DOWNLOADS_KEY, []);
  },

  updateDownloadTask: (id, patch) => {
    const progressPatchKeys = new Set([
      "progress",
      "downloadedBytes",
      "totalBytes",
      "speedBytesPerSec",
      "message",
    ]);
    const next = get().downloads.map((row) => {
      if (row.id !== id) return row;
      const statusChanged = patch.status !== undefined && patch.status !== row.status;
      const progressOnly = Object.keys(patch).every(
        (key) => key === "status" || progressPatchKeys.has(key)
      );
      return {
        ...row,
        ...patch,
        updatedAt: !statusChanged && progressOnly ? row.updatedAt : Date.now(),
      };
    });
    set({ downloads: sortDownloads(next) });
    saveArr(DOWNLOADS_KEY, sortDownloads(next));
  },
}));
