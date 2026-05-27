import { create } from "zustand";
import { scriptFetch } from "@/source-script/fetch";
import {
  applyConfigFile,
  parseConfigFile,
  type ApplyResult,
} from "@/lib/configFile";

const STORAGE_KEY = "douytv:config-subscriptions";
const LEGACY_URL_KEY = "douytv:config-subscription-url";
const LEGACY_UPDATED_KEY = "douytv:config-subscription-updated";
const LEGACY_AUTO_KEY = "douytv:config-subscription-auto";
const REFRESH_INTERVAL_MS = 24 * 3600 * 1000;

export interface ConfigSubscription {
  id: string;
  name: string;
  url: string;
  autoUpdate: boolean;
  updatedAt?: number;
  lastResult?: ApplyResult;
  error?: string;
}

interface ConfigSubStore {
  subscriptions: ConfigSubscription[];
  refreshing: Set<string>;
  loading: boolean;
  hydrated: boolean;
  hydrate: () => void;
  add: (name: string, url: string, autoUpdate?: boolean) => Promise<void>;
  remove: (id: string) => void;
  refresh: (id: string) => Promise<ApplyResult>;
  refreshAll: () => Promise<void>;
  setAutoUpdate: (id: string, auto: boolean) => void;
  importJson: (text: string) => Promise<ApplyResult>;
  // Legacy compat
  url: string;
  autoUpdate: boolean;
  updatedAt?: number;
  error?: string;
  lastResult?: ApplyResult;
  setUrl: (url: string, autoUpdate?: boolean) => void;
  clear: () => void;
}

function nanoid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function persist(subs: ConfigSubscription[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(subs)); } catch {}
}

function loadFromStorage(): ConfigSubscription[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as ConfigSubscription[];
  } catch {}
  // Migrate legacy single-subscription
  try {
    const url = localStorage.getItem(LEGACY_URL_KEY);
    if (url) {
      const auto = localStorage.getItem(LEGACY_AUTO_KEY) === "true";
      const u = localStorage.getItem(LEGACY_UPDATED_KEY);
      const sub: ConfigSubscription = {
        id: nanoid(), name: new URL(url).hostname, url, autoUpdate: auto,
        updatedAt: u ? Number(u) : undefined,
      };
      localStorage.removeItem(LEGACY_URL_KEY);
      localStorage.removeItem(LEGACY_UPDATED_KEY);
      localStorage.removeItem(LEGACY_AUTO_KEY);
      persist([sub]);
      return [sub];
    }
  } catch {}
  return [];
}

async function doRefresh(sub: ConfigSubscription): Promise<ApplyResult> {
  const res = await scriptFetch(sub.url, { timeout: 30_000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const cfg = parseConfigFile(text);
  return applyConfigFile(cfg);
}

export const useConfigSubStore = create<ConfigSubStore>((set, get) => ({
  subscriptions: [],
  refreshing: new Set(),
  loading: false,
  hydrated: false,
  url: "",
  autoUpdate: false,

  hydrate: () => {
    if (get().hydrated) return;
    const subs = loadFromStorage();
    const first = subs[0];
    set({
      subscriptions: subs, hydrated: true,
      url: first?.url ?? "", autoUpdate: first?.autoUpdate ?? false,
      updatedAt: first?.updatedAt, lastResult: first?.lastResult,
    });
    for (const sub of subs) {
      if (!sub.autoUpdate || !sub.url) continue;
      if (sub.updatedAt && Date.now() - sub.updatedAt < REFRESH_INTERVAL_MS) continue;
      get().refresh(sub.id).catch(() => {});
    }
  },

  add: async (name, url, autoUpdate = true) => {
    const id = nanoid();
    const sub: ConfigSubscription = { id, name: name || new URL(url).hostname, url, autoUpdate };
    const subs = [...get().subscriptions, sub];
    persist(subs);
    set({ subscriptions: subs });
    await get().refresh(id);
  },

  remove: (id) => {
    const subs = get().subscriptions.filter((s) => s.id !== id);
    persist(subs);
    set({ subscriptions: subs });
  },

  refresh: async (id) => {
    const sub = get().subscriptions.find((s) => s.id === id);
    if (!sub) throw new Error("订阅不存在");
    const refreshing = new Set(get().refreshing);
    refreshing.add(id);
    set({ refreshing, loading: true });
    try {
      const result = await doRefresh(sub);
      const subs = get().subscriptions.map((s) =>
        s.id === id ? { ...s, updatedAt: Date.now(), lastResult: result, error: undefined } : s
      );
      persist(subs);
      set({ subscriptions: subs, loading: false, lastResult: result });
      return result;
    } catch (e) {
      const msg = (e as Error).message;
      const subs = get().subscriptions.map((s) =>
        s.id === id ? { ...s, error: msg } : s
      );
      persist(subs);
      set({ subscriptions: subs, loading: false, error: msg });
      throw e;
    } finally {
      const r = new Set(get().refreshing);
      r.delete(id);
      set({ refreshing: r });
    }
  },

  refreshAll: async () => {
    for (const sub of get().subscriptions) {
      await get().refresh(sub.id).catch(() => {});
    }
  },

  setAutoUpdate: (id, auto) => {
    const subs = get().subscriptions.map((s) =>
      s.id === id ? { ...s, autoUpdate: auto } : s
    );
    persist(subs);
    set({ subscriptions: subs });
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

  // Legacy compat
  setUrl: (url, autoUpdate) => {
    const subs = get().subscriptions;
    if (subs.length === 0 && url) {
      get().add("默认订阅", url, autoUpdate);
    } else if (subs.length > 0) {
      const updated = subs.map((s, i) => i === 0 ? { ...s, url, autoUpdate: autoUpdate ?? s.autoUpdate } : s);
      persist(updated);
      set({ subscriptions: updated, url });
    }
  },
  clear: () => {
    persist([]);
    set({ subscriptions: [], url: "", autoUpdate: false, updatedAt: undefined, lastResult: undefined });
  },
}));

