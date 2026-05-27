/**
 * 网络直播 store —— 收藏房间 + 当前选中平台 + 历史浏览 + 平台健康状态。
 * 房间数据是实时拉的，不持久化 —— store 只管 UI 状态。
 */
import { create } from "zustand";
import {
  NETLIVE_PLATFORMS,
  type NetLivePlatformId,
  type NetLiveRoom,
} from "@/lib/netlive/types";
import { getAdapter, listSupportedPlatforms } from "@/lib/netlive/registry";

const FAV_KEY = "douytv:netlive-favorites";
const ACTIVE_PLATFORM_KEY = "douytv:netlive-active-platform";
const HISTORY_KEY = "douytv:netlive-history";
const HEALTH_KEY = "douytv:netlive-health";
const ADULT_KEY = "douytv:netlive-adult-enabled";
const HISTORY_CAP = 50;

export interface NetLiveHealth {
  ok: boolean;
  ts: number;
  msg?: string;
}

interface NetLiveStore {
  activePlatform: NetLivePlatformId;
  favorites: NetLiveRoom[];
  history: NetLiveRoom[];
  health: Partial<Record<NetLivePlatformId, NetLiveHealth>>;
  checking: boolean;
  /** 是否启用 18+ 成人内容平台（chaturbate / stripchat）—— 默认 OFF */
  adultEnabled: boolean;
  hydrated: boolean;
  hydrate: () => void;
  setActivePlatform: (p: NetLivePlatformId) => void;
  toggleFavorite: (room: NetLiveRoom) => void;
  isFavorite: (platform: NetLivePlatformId, roomId: string) => boolean;
  noteVisit: (room: NetLiveRoom) => void;
  clearHistory: () => void;
  checkAll: () => Promise<void>;
  setAdultEnabled: (v: boolean) => void;
}

function isValidPlatform(id: string): boolean {
  return NETLIVE_PLATFORMS.some((p) => p.id === id) || listSupportedPlatforms().includes(id);
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function persistJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("[netlive] persist failed", key, e);
  }
}

export const useNetLiveStore = create<NetLiveStore>((set, get) => ({
  activePlatform: "bilibili",
  favorites: [],
  history: [],
  health: {},
  checking: false,
  adultEnabled: false,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    try {
      const ap = localStorage.getItem(ACTIVE_PLATFORM_KEY);
      const activePlatform: NetLivePlatformId =
        ap && isValidPlatform(ap)
          ? ap
          : (listSupportedPlatforms()[0] ?? "bilibili");
      const favorites = loadJson<NetLiveRoom[]>(FAV_KEY, []);
      const history = loadJson<NetLiveRoom[]>(HISTORY_KEY, []);
      const health = loadJson<NetLiveStore["health"]>(HEALTH_KEY, {});
      const adultEnabled =
        localStorage.getItem(ADULT_KEY) === "1";
      set({
        activePlatform,
        favorites: Array.isArray(favorites) ? favorites : [],
        history: Array.isArray(history) ? history : [],
        health: typeof health === "object" && health ? health : {},
        adultEnabled,
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },

  setActivePlatform: (p) => {
    try {
      localStorage.setItem(ACTIVE_PLATFORM_KEY, p);
    } catch {
      /* ignore */
    }
    set({ activePlatform: p });
  },

  toggleFavorite: (room) => {
    const all = get().favorites;
    const idx = all.findIndex(
      (r) => r.platform === room.platform && r.roomId === room.roomId
    );
    let next: NetLiveRoom[];
    if (idx >= 0) {
      next = all.filter((_, i) => i !== idx);
    } else {
      next = [room, ...all];
    }
    persistJson(FAV_KEY, next);
    set({ favorites: next });
  },

  isFavorite: (platform, roomId) =>
    get().favorites.some(
      (r) => r.platform === platform && r.roomId === roomId
    ),

  noteVisit: (room) => {
    const all = get().history;
    const filtered = all.filter(
      (r) => !(r.platform === room.platform && r.roomId === room.roomId)
    );
    const next = [room, ...filtered].slice(0, HISTORY_CAP);
    persistJson(HISTORY_KEY, next);
    set({ history: next });
  },

  clearHistory: () => {
    persistJson(HISTORY_KEY, []);
    set({ history: [] });
  },

  checkAll: async () => {
    if (get().checking) return;
    set({ checking: true });
    const platforms = listSupportedPlatforms();
    const adult = get().adultEnabled;
    const filtered = adult
      ? platforms
      : platforms.filter(
          (p) => !NETLIVE_PLATFORMS.find((m) => m.id === p)?.adult
        );
    const next: NetLiveStore["health"] = { ...get().health };
    // 串行而不是并行 —— 多数平台同 IP 高频请求容易触发风控
    for (const p of filtered) {
      try {
        const adapter = await getAdapter(p);
        await adapter.getRecommend(1, 3);
        next[p] = { ok: true, ts: Date.now() };
      } catch (e) {
        next[p] = {
          ok: false,
          ts: Date.now(),
          msg: (e as Error).message ?? String(e),
        };
      }
      // 进度可见：每检测一个平台就刷新一次 UI
      persistJson(HEALTH_KEY, next);
      set({ health: { ...next } });
    }
    set({ checking: false });
  },

  setAdultEnabled: (v) => {
    try {
      localStorage.setItem(ADULT_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
    // 若关闭且当前正停在成人平台，切回 B 站
    const current = get().activePlatform;
    const isAdultCurrent = !!NETLIVE_PLATFORMS.find(
      (m) => m.id === current
    )?.adult;
    if (!v && isAdultCurrent) {
      try {
        localStorage.setItem(ACTIVE_PLATFORM_KEY, "bilibili");
      } catch {
        /* ignore */
      }
      set({ adultEnabled: v, activePlatform: "bilibili" });
      return;
    }
    set({ adultEnabled: v });
  },
}));
