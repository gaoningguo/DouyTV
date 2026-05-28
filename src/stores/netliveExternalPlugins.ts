/**
 * 外部网络直播插件管理 store。
 *
 * 职责：
 *   - 持久化插件描述符到 localStorage
 *   - hydrate 时编译已启用的插件并注册到 registry
 *   - 提供 add / remove / enable / disable / update 操作
 */
import { create } from "zustand";
import type { NetLivePluginDescriptor } from "@/lib/netlive/external/types";
import { compileExternalPlugin } from "@/lib/netlive/external/runtime";
import { registerPlugin } from "@/lib/netlive/registry";
import { setNetLivePlatforms, type NetLivePlatformMeta } from "@/lib/netlive/types";

const STORAGE_KEY = "douytv:netlive-external-plugins";

interface ExternalPluginState {
  plugins: NetLivePluginDescriptor[];
  hydrated: boolean;
  hydrate: () => void;
  add: (desc: NetLivePluginDescriptor) => void;
  remove: (key: string) => void;
  enable: (key: string) => void;
  disable: (key: string) => void;
  updateCode: (key: string, code: string) => void;
  batchEnable: (keys: string[]) => void;
  batchDisable: (keys: string[]) => void;
  batchRemove: (keys: string[]) => void;
}

const unregisterMap = new Map<string, () => void>();

function persist(plugins: NetLivePluginDescriptor[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plugins));
  } catch {
    // quota exceeded — silent
  }
}

function loadFromStorage(): NetLivePluginDescriptor[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as NetLivePluginDescriptor[];
  } catch {
    return [];
  }
}

function tryRegister(desc: NetLivePluginDescriptor) {
  if (!desc.enabled || !desc.code) return;
  try {
    const plugin = compileExternalPlugin(desc);
    const unregister = registerPlugin(plugin);
    unregisterMap.set(desc.key, unregister);
  } catch (e) {
    console.error(`[netlive-ext] 编译插件 "${desc.name}" 失败:`, e);
  }
}

function syncPlatformMetas(plugins: NetLivePluginDescriptor[]) {
  const metas: NetLivePlatformMeta[] = [];
  for (const p of plugins) {
    if (!p.enabled || !p.code) continue;
    try {
      const fn = new Function('"use strict";\n' + p.code);
      const mod = fn();
      if (mod?.manifest?.id && mod?.manifest?.label) {
        metas.push({
          id: mod.manifest.id,
          label: mod.manifest.label,
          adult: mod.manifest.adult,
          defaultProxy: mod.manifest.defaultProxy,
        });
      }
    } catch {}
  }
  setNetLivePlatforms(metas);
}

function tryUnregister(key: string) {
  const unreg = unregisterMap.get(key);
  if (unreg) {
    unreg();
    unregisterMap.delete(key);
  }
}

let hydrateReadyResolve: (() => void) | null = null;
export const hydrateReady: Promise<void> = new Promise((r) => { hydrateReadyResolve = r; });

export const useExternalPluginStore = create<ExternalPluginState>((set, get) => ({
  plugins: [],
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    const plugins = loadFromStorage();
    for (const p of plugins) tryRegister(p);
    syncPlatformMetas(plugins);
    set({ plugins, hydrated: true });
    hydrateReadyResolve?.();
  },

  add: (desc) => {
    const plugins = [...get().plugins.filter((p) => p.key !== desc.key), desc];
    persist(plugins);
    tryRegister(desc);
    syncPlatformMetas(plugins);
    set({ plugins });
  },

  remove: (key) => {
    tryUnregister(key);
    const plugins = get().plugins.filter((p) => p.key !== key);
    persist(plugins);
    syncPlatformMetas(plugins);
    set({ plugins });
  },

  enable: (key) => {
    const plugins = get().plugins.map((p) =>
      p.key === key ? { ...p, enabled: true } : p
    );
    persist(plugins);
    const desc = plugins.find((p) => p.key === key);
    if (desc) tryRegister(desc);
    syncPlatformMetas(plugins);
    set({ plugins });
  },

  disable: (key) => {
    tryUnregister(key);
    const plugins = get().plugins.map((p) =>
      p.key === key ? { ...p, enabled: false } : p
    );
    persist(plugins);
    syncPlatformMetas(plugins);
    set({ plugins });
  },

  updateCode: (key, code) => {
    tryUnregister(key);
    const plugins = get().plugins.map((p) =>
      p.key === key ? { ...p, code, updatedAt: Date.now() } : p
    );
    persist(plugins);
    const desc = plugins.find((p) => p.key === key);
    if (desc?.enabled) tryRegister(desc);
    set({ plugins });
  },

  batchEnable: (keys) => {
    const keySet = new Set(keys);
    const plugins = get().plugins.map((p) =>
      keySet.has(p.key) ? { ...p, enabled: true } : p
    );
    persist(plugins);
    for (const p of plugins) {
      if (keySet.has(p.key) && p.enabled) tryRegister(p);
    }
    syncPlatformMetas(plugins);
    set({ plugins });
  },

  batchDisable: (keys) => {
    for (const k of keys) tryUnregister(k);
    const keySet = new Set(keys);
    const plugins = get().plugins.map((p) =>
      keySet.has(p.key) ? { ...p, enabled: false } : p
    );
    persist(plugins);
    syncPlatformMetas(plugins);
    set({ plugins });
  },

  batchRemove: (keys) => {
    for (const k of keys) tryUnregister(k);
    const keySet = new Set(keys);
    const plugins = get().plugins.filter((p) => !keySet.has(p.key));
    persist(plugins);
    syncPlatformMetas(plugins);
    set({ plugins });
  },
}));
