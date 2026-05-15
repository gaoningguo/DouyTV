import { create } from "zustand";
import { scriptFetch } from "@/source-script/fetch";
import { useLiveStore } from "./live";

export interface LiveSubscription {
  id: string;
  name: string;
  url: string;
  /** 自动 24h 刷新 */
  autoRefresh: boolean;
  lastFetchedAt?: number;
  /** 上次刷新得到的频道数（仅展示） */
  channelCount?: number;
  error?: string;
}

const STORAGE_KEY = "douytv:live-subscriptions";
const REFRESH_TTL_MS = 24 * 3600 * 1000;

interface LiveSubStore {
  subscriptions: LiveSubscription[];
  hydrated: boolean;
  hydrate: () => void;
  add: (name: string, url: string, autoRefresh?: boolean) => Promise<void>;
  remove: (id: string) => void;
  refresh: (id: string) => Promise<void>;
  refreshAll: () => Promise<void>;
  setAutoRefresh: (id: string, auto: boolean) => void;
  /** App 启动时调用：对每条 autoRefresh=true 且超过 TTL 的订阅自动刷新 */
  bootRefresh: () => void;
}

function persist(subs: LiveSubscription[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(subs));
  } catch (e) {
    console.warn("[live-sub] persist failed", e);
  }
}

function load(): LiveSubscription[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LiveSubscription[]) : [];
  } catch {
    return [];
  }
}

async function fetchAndImport(sub: LiveSubscription): Promise<{ count: number }> {
  const res = await scriptFetch(sub.url, { timeout: 30_000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const liveStore = useLiveStore.getState();
  // 覆盖式刷新：先删该订阅的所有频道，再重新导入并打上 sourceId 标
  liveStore.removeBySourceId(sub.id);
  const count = liveStore.importM3U(text, {
    defaultCategory: sub.name,
    sourceId: sub.id,
  });
  return { count };
}

export const useLiveSubStore = create<LiveSubStore>((set, get) => ({
  subscriptions: [],
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    set({ subscriptions: load(), hydrated: true });
  },
  add: async (name, url, autoRefresh = true) => {
    const sub: LiveSubscription = {
      id: `sub-${Date.now()}`,
      name: name.trim(),
      url: url.trim(),
      autoRefresh,
    };
    const next = [...get().subscriptions, sub];
    set({ subscriptions: next });
    persist(next);
    try {
      await get().refresh(sub.id);
    } catch (e) {
      console.warn("[live-sub] initial refresh failed", e);
    }
  },
  remove: (id) => {
    const sub = get().subscriptions.find((s) => s.id === id);
    if (sub) useLiveStore.getState().removeBySourceId(sub.id);
    const next = get().subscriptions.filter((s) => s.id !== id);
    set({ subscriptions: next });
    persist(next);
  },
  refresh: async (id) => {
    const sub = get().subscriptions.find((s) => s.id === id);
    if (!sub) return;
    try {
      const { count } = await fetchAndImport(sub);
      const next = get().subscriptions.map((s) =>
        s.id === id
          ? {
              ...s,
              lastFetchedAt: Date.now(),
              channelCount: count,
              error: undefined,
            }
          : s
      );
      set({ subscriptions: next });
      persist(next);
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      const next = get().subscriptions.map((s) =>
        s.id === id ? { ...s, error: msg } : s
      );
      set({ subscriptions: next });
      persist(next);
      throw e;
    }
  },
  refreshAll: async () => {
    const subs = get().subscriptions;
    await Promise.all(
      subs.map((s) => get().refresh(s.id).catch(() => {}))
    );
  },
  setAutoRefresh: (id, auto) => {
    const next = get().subscriptions.map((s) =>
      s.id === id ? { ...s, autoRefresh: auto } : s
    );
    set({ subscriptions: next });
    persist(next);
  },
  bootRefresh: () => {
    const subs = get().subscriptions;
    const now = Date.now();
    for (const s of subs) {
      if (!s.autoRefresh) continue;
      if (s.lastFetchedAt && now - s.lastFetchedAt < REFRESH_TTL_MS) continue;
      void get()
        .refresh(s.id)
        .catch((e) => console.warn(`[live-sub] boot refresh ${s.name} failed`, e));
    }
  },
}));
