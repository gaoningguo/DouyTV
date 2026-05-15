import { create } from "zustand";
import { scriptFetch } from "@/source-script/fetch";
import {
  applyConfigFile,
  parseConfigFile,
  type ApplyResult,
} from "@/lib/configFile";

const URL_KEY = "douytv:config-subscription-url";
const UPDATED_KEY = "douytv:config-subscription-updated";
const AUTO_KEY = "douytv:config-subscription-auto";
const REFRESH_INTERVAL_MS = 24 * 3600 * 1000;

interface ConfigSubStore {
  url: string;
  autoUpdate: boolean;
  updatedAt?: number;
  loading: boolean;
  error?: string;
  lastResult?: ApplyResult;
  hydrated: boolean;
  hydrate: () => void;
  setUrl: (url: string, autoUpdate?: boolean) => void;
  setAutoUpdate: (auto: boolean) => void;
  refresh: () => Promise<ApplyResult>;
  importJson: (text: string) => Promise<ApplyResult>;
  clear: () => void;
}

export const useConfigSubStore = create<ConfigSubStore>((set, get) => ({
  url: "",
  autoUpdate: false,
  loading: false,
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    let url = "";
    let autoUpdate = false;
    let updatedAt: number | undefined;
    try {
      url = localStorage.getItem(URL_KEY) || "";
      autoUpdate = localStorage.getItem(AUTO_KEY) === "true";
      const u = localStorage.getItem(UPDATED_KEY);
      updatedAt = u ? Number(u) : undefined;
    } catch {
      /* ignore */
    }
    set({ url, autoUpdate, updatedAt, hydrated: true });

    // 自动刷新条件：开启了自动 + URL 非空 + 超过 TTL
    if (
      autoUpdate &&
      url &&
      (!updatedAt || Date.now() - updatedAt > REFRESH_INTERVAL_MS)
    ) {
      void get().refresh().catch(() => {});
    }
  },
  setUrl: (url, autoUpdate) => {
    try {
      if (url) localStorage.setItem(URL_KEY, url);
      else localStorage.removeItem(URL_KEY);
      if (autoUpdate !== undefined) {
        localStorage.setItem(AUTO_KEY, autoUpdate ? "true" : "false");
      }
    } catch {}
    set((s) => ({
      url,
      autoUpdate: autoUpdate ?? s.autoUpdate,
    }));
  },
  setAutoUpdate: (auto) => {
    try {
      localStorage.setItem(AUTO_KEY, auto ? "true" : "false");
    } catch {}
    set({ autoUpdate: auto });
  },
  refresh: async () => {
    const { url } = get();
    if (!url) throw new Error("订阅 URL 未设置");
    set({ loading: true, error: undefined });
    try {
      const res = await scriptFetch(url, { timeout: 30_000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const cfg = parseConfigFile(text);
      const result = await applyConfigFile(cfg);
      const updatedAt = Date.now();
      try {
        localStorage.setItem(UPDATED_KEY, String(updatedAt));
      } catch {}
      set({ updatedAt, loading: false, lastResult: result });
      return result;
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      set({ loading: false, error: msg });
      throw e;
    }
  },
  importJson: async (text) => {
    set({ loading: true, error: undefined });
    try {
      const cfg = parseConfigFile(text);
      const result = await applyConfigFile(cfg);
      set({ loading: false, lastResult: result });
      return result;
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      set({ loading: false, error: msg });
      throw e;
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(URL_KEY);
      localStorage.removeItem(UPDATED_KEY);
      localStorage.removeItem(AUTO_KEY);
    } catch {}
    set({ url: "", autoUpdate: false, updatedAt: undefined, lastResult: undefined });
  },
}));
