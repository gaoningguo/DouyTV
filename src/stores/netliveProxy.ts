/**
 * NetLive per-platform 代理覆盖 store。
 *
 * 全局 `useProxyStore` 是三档总开关(auto / manual / off),适用于整个 app 的网络请求。
 * 但用户对网络直播的实际需求是混合的:
 *   - 国内平台(B站/斗鱼/虎牙/抖音/快手/网易CC)直连最快
 *   - 海外平台(Twitch/YouTube/Stripchat/CamSoda/PandaTV...)必须走代理
 * 每次切换都跑设置页改 mode 很烦,所以这里给每个 NetLive 平台一份独立的二态覆盖。
 *
 * 解析优先级:
 *   1. 用户在 tab 上设置的 override(如有)
 *   2. 平台 meta 上的 defaultProxy(国别推荐值)
 *   3. 兜底 "direct"
 *
 * 全局代理为 off 时,即使平台 effective="proxy",resolveProxyForPlatform 也会回落
 * 到 bypass=true(无代理可用 → 直连),UI 会把 tab 的代理图标降级显示提示用户。
 */
import { create } from "zustand";
import {
  NETLIVE_PLATFORMS,
  type NetLivePlatformId,
} from "@/lib/netlive/types";
import { getActiveProxyUrl } from "./proxy";

const STORAGE_KEY = "douytv:netlive-proxy-overrides";

export type NetliveProxyMode = "proxy" | "direct";

interface NetliveProxyStore {
  overrides: Partial<Record<NetLivePlatformId, NetliveProxyMode>>;
  hydrated: boolean;
  hydrate: () => void;
  /** 用户在 tab UI 上选的覆盖。传 null 撤销 → 恢复 meta defaultProxy。 */
  setOverride: (platform: NetLivePlatformId, value: NetliveProxyMode | null) => void;
}

function loadFromStorage(): Partial<Record<NetLivePlatformId, NetliveProxyMode>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Partial<Record<NetLivePlatformId, NetliveProxyMode>> = {};
    for (const p of NETLIVE_PLATFORMS) {
      const v = (parsed as Record<string, unknown>)[p.id];
      if (v === "proxy" || v === "direct") out[p.id] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function persistToStorage(
  overrides: Partial<Record<NetLivePlatformId, NetliveProxyMode>>,
) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    /* private mode */
  }
}

export const useNetliveProxyStore = create<NetliveProxyStore>((set, get) => ({
  overrides: {},
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    set({ overrides: loadFromStorage(), hydrated: true });
  },
  setOverride: (platform, value) => {
    const next = { ...get().overrides };
    if (value === null) {
      delete next[platform];
    } else {
      next[platform] = value;
    }
    persistToStorage(next);
    set({ overrides: next });
  },
}));

/* ─────────────── 非 React 同步 API ─────────────── */

function metaFor(platform: NetLivePlatformId): NetliveProxyMode {
  const m = NETLIVE_PLATFORMS.find((p) => p.id === platform);
  return m?.defaultProxy ?? "direct";
}

/** 当前生效的模式(已合并 override / meta default)。 */
export function getEffectiveMode(platform: NetLivePlatformId): NetliveProxyMode {
  const override = useNetliveProxyStore.getState().overrides[platform];
  return override ?? metaFor(platform);
}

/** UI 用:平台 meta 上的推荐默认值。 */
export function getDefaultMode(platform: NetLivePlatformId): NetliveProxyMode {
  return metaFor(platform);
}

/**
 * 解析到具体的代理行为。供 scriptFetch / wrapWithProxy 用。
 *
 * - effective="direct"  → 返回 `{ bypass: true }`,网络层强制不走任何代理
 * - effective="proxy"   → 返回 `{ proxyUrl: <全局激活代理> }`
 *   - 如果全局 mode=off / 没配代理 URL → 回落 `{ bypass: true }`(没代理可用 → 直连)
 *     UI 应该在这种状态下提示用户配代理。
 */
export function resolveProxyForPlatform(platform: NetLivePlatformId): {
  proxyUrl?: string;
  bypass: boolean;
} {
  const mode = getEffectiveMode(platform);
  if (mode === "direct") return { bypass: true };
  const url = getActiveProxyUrl();
  if (!url) return { bypass: true };
  return { proxyUrl: url, bypass: false };
}
