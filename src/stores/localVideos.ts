import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface LocalVideo {
  path: string;
  name: string;
  size: number;
  modified: number;
  extension: string;
}

const ROOT_KEY = "douytv:local-root";

interface LocalStore {
  root: string;
  videos: LocalVideo[];
  loading: boolean;
  error?: string;
  setRoot: (root: string) => void;
  scan: (dir?: string, maxDepth?: number) => Promise<void>;
  hydrate: () => void;
}

export const useLocalStore = create<LocalStore>((set, get) => ({
  root: "",
  videos: [],
  loading: false,
  error: undefined,
  hydrate: () => {
    if (get().root) return;
    try {
      const stored = localStorage.getItem(ROOT_KEY);
      if (stored) {
        set({ root: stored });
        // 自动扫一次（异步，不阻塞 hydrate）
        void get().scan(stored).catch(() => {});
      }
    } catch {}
  },
  setRoot: (root) => {
    set({ root });
    try {
      localStorage.setItem(ROOT_KEY, root);
    } catch {}
  },
  scan: async (dir, maxDepth) => {
    const target = dir ?? get().root;
    if (!target) {
      set({ error: "请先输入要扫描的目录路径" });
      return;
    }
    set({ loading: true, error: undefined });
    try {
      const videos = await invoke<LocalVideo[]>("scan_local_videos", {
        dir: target,
        maxDepth: maxDepth ?? 4,
      });
      set({ videos, root: target, loading: false });
      try {
        localStorage.setItem(ROOT_KEY, target);
      } catch {}
    } catch (e) {
      set({ error: String(e), loading: false, videos: [] });
    }
  },
}));
