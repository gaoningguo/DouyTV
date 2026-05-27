/**
 * 网络直播插件订阅 store —— 从 GitHub 仓库 / 任意 URL 自动下载插件并定时刷新。
 *
 * 用户添加一个订阅源（GitHub 仓库地址或 index.json URL），store 会：
 *   1. 规范化 URL → raw content 地址
 *   2. 拉取 index.json 获取插件清单
 *   3. 逐个下载 .js 文件并注册到 useExternalPluginStore
 *   4. 每 12 小时自动刷新（boot-time TTL 检查）
 */
import { create } from "zustand";
import { useExternalPluginStore } from "./netliveExternalPlugins";
import type { NetLivePluginDescriptor } from "@/lib/netlive/external/types";

const STORAGE_KEY = "douytv:netlive-plugin-subscriptions";
const REFRESH_TTL_MS = 12 * 3600 * 1000;

export interface PluginSubscription {
  id: string;
  name: string;
  url: string;
  rawBaseUrl: string;
  autoRefresh: boolean;
  lastFetchedAt?: number;
  pluginCount?: number;
  error?: string;
}

interface PluginIndexEntry {
  id: string;
  label: string;
  version?: string;
  adult?: boolean;
  defaultProxy?: string;
  file: string;
}

interface PluginSubscriptionState {
  subscriptions: PluginSubscription[];
  refreshing: Set<string>;
  hydrated: boolean;
  hydrate: () => void;
  bootRefresh: () => void;
  add: (url: string, name?: string) => Promise<void>;
  remove: (id: string) => void;
  refresh: (id: string) => Promise<void>;
  refreshAll: () => Promise<void>;
  setAutoRefresh: (id: string, v: boolean) => void;
}

function nanoid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function persist(subs: PluginSubscription[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(subs));
  } catch {}
}

function loadFromStorage(): PluginSubscription[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as PluginSubscription[];
  } catch {
    return [];
  }
}

export function normalizePluginSourceUrl(input: string): { indexUrl: string; baseUrl: string } {
  let url = input.trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }

  const ghMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+)\/(.+?))?(?:\/)?$/);
  if (ghMatch) {
    const [, user, repo, branch, path] = ghMatch;
    const b = branch || "main";
    const p = path ? `${path}/` : "dist/";
    return {
      indexUrl: `https://raw.githubusercontent.com/${user}/${repo}/${b}/${p}index.json`,
      baseUrl: `https://raw.githubusercontent.com/${user}/${repo}/${b}/${p}`,
    };
  }

  const rawGhMatch = url.match(/^(https?:\/\/raw\.githubusercontent\.com\/.+\/)([^/]+)$/);
  if (rawGhMatch && rawGhMatch[2] === "index.json") {
    return { indexUrl: url, baseUrl: rawGhMatch[1] };
  }

  if (url.endsWith("/")) {
    return { indexUrl: url + "index.json", baseUrl: url };
  }
  if (url.endsWith("index.json") || url.endsWith(".json")) {
    const base = url.substring(0, url.lastIndexOf("/") + 1);
    return { indexUrl: url, baseUrl: base };
  }
  return { indexUrl: url + "/index.json", baseUrl: url + "/" };
}

async function fetchText(url: string): Promise<string> {
  try {
    const { scriptFetch } = await import("@/source-script/fetch");
    const res = await scriptFetch(url, { timeout: 30_000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  } catch {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }
}

async function doRefresh(sub: PluginSubscription): Promise<{ count: number }> {
  const indexText = await fetchText(sub.rawBaseUrl + "index.json");
  const entries = JSON.parse(indexText) as PluginIndexEntry[];
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("index.json 为空或格式错误");
  }

  const pluginStore = useExternalPluginStore.getState();
  let count = 0;

  for (const entry of entries) {
    if (!entry.id || !entry.file) continue;
    try {
      const code = await fetchText(sub.rawBaseUrl + entry.file);
      const desc: NetLivePluginDescriptor = {
        key: `sub:${sub.id}:${entry.id}`,
        name: entry.label || entry.id,
        code,
        enabled: true,
        installedAt: Date.now(),
      };
      pluginStore.add(desc);
      count++;
    } catch (e) {
      console.warn(`[plugin-sub] 下载 ${entry.file} 失败:`, e);
    }
  }
  return { count };
}

export const usePluginSubscriptionStore = create<PluginSubscriptionState>((set, get) => ({
  subscriptions: [],
  refreshing: new Set(),
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    set({ subscriptions: loadFromStorage(), hydrated: true });
  },

  bootRefresh: () => {
    const now = Date.now();
    for (const sub of get().subscriptions) {
      if (!sub.autoRefresh) continue;
      if (sub.lastFetchedAt && now - sub.lastFetchedAt < REFRESH_TTL_MS) continue;
      get().refresh(sub.id).catch(() => {});
    }
  },

  add: async (url, name) => {
    const { indexUrl, baseUrl } = normalizePluginSourceUrl(url);
    const id = nanoid();
    const sub: PluginSubscription = {
      id,
      name: name || new URL(indexUrl).hostname,
      url: indexUrl,
      rawBaseUrl: baseUrl,
      autoRefresh: true,
    };
    const subs = [...get().subscriptions, sub];
    persist(subs);
    set({ subscriptions: subs });
    await get().refresh(id);
  },

  remove: (id) => {
    const pluginStore = useExternalPluginStore.getState();
    const prefix = `sub:${id}:`;
    for (const p of pluginStore.plugins) {
      if (p.key.startsWith(prefix)) pluginStore.remove(p.key);
    }
    const subs = get().subscriptions.filter((s) => s.id !== id);
    persist(subs);
    set({ subscriptions: subs });
  },

  refresh: async (id) => {
    const sub = get().subscriptions.find((s) => s.id === id);
    if (!sub) return;
    const refreshing = new Set(get().refreshing);
    refreshing.add(id);
    set({ refreshing });

    try {
      const { count } = await doRefresh(sub);
      const subs = get().subscriptions.map((s) =>
        s.id === id ? { ...s, lastFetchedAt: Date.now(), pluginCount: count, error: undefined } : s
      );
      persist(subs);
      set({ subscriptions: subs });
    } catch (e) {
      const subs = get().subscriptions.map((s) =>
        s.id === id ? { ...s, error: (e as Error).message } : s
      );
      persist(subs);
      set({ subscriptions: subs });
    } finally {
      const r = new Set(get().refreshing);
      r.delete(id);
      set({ refreshing: r });
    }
  },

  refreshAll: async () => {
    for (const sub of get().subscriptions) {
      await get().refresh(sub.id);
    }
  },

  setAutoRefresh: (id, v) => {
    const subs = get().subscriptions.map((s) =>
      s.id === id ? { ...s, autoRefresh: v } : s
    );
    persist(subs);
    set({ subscriptions: subs });
  },
}))
