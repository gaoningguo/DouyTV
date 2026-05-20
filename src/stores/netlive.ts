/**
 * 网络直播 store —— 收藏房间 + 当前选中平台 + 用户最近浏览。
 * 房间数据是实时拉的，不持久化 —— store 只管 UI 状态。
 */
import { create } from "zustand";
import type {
  NetLivePlatformId,
  NetLiveRoom,
} from "@/lib/netlive/types";

const FAV_KEY = "douytv:netlive-favorites";
const ACTIVE_PLATFORM_KEY = "douytv:netlive-active-platform";

interface NetLiveStore {
  activePlatform: NetLivePlatformId;
  favorites: NetLiveRoom[];
  hydrated: boolean;
  hydrate: () => void;
  setActivePlatform: (p: NetLivePlatformId) => void;
  toggleFavorite: (room: NetLiveRoom) => void;
  isFavorite: (platform: NetLivePlatformId, roomId: string) => boolean;
}

function loadFavs(): NetLiveRoom[] {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as NetLiveRoom[]) : [];
  } catch {
    return [];
  }
}

function persistFavs(favorites: NetLiveRoom[]) {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(favorites));
  } catch (e) {
    console.warn("[netlive] persist favs failed", e);
  }
}

export const useNetLiveStore = create<NetLiveStore>((set, get) => ({
  activePlatform: "bilibili",
  favorites: [],
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    try {
      const ap = localStorage.getItem(ACTIVE_PLATFORM_KEY);
      const activePlatform: NetLivePlatformId =
        ap === "bilibili" || ap === "douyu" || ap === "huya" || ap === "twitch"
          ? ap
          : "bilibili";
      set({ activePlatform, favorites: loadFavs(), hydrated: true });
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
    persistFavs(next);
    set({ favorites: next });
  },
  isFavorite: (platform, roomId) =>
    get().favorites.some((r) => r.platform === platform && r.roomId === roomId),
}));
