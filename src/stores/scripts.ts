import { create } from "zustand";
import { BUILTIN_SCRIPTS } from "@/source-script/builtin";
import type { ScriptDescriptor } from "@/source-script/types";
import { validateDescriptor } from "@/source-script/runtime";

const STORAGE_KEY = "douytv:scripts";

interface ScriptStore {
  scripts: ScriptDescriptor[];
  hydrated: boolean;
  hydrate: () => void;
  install: (script: ScriptDescriptor) => void;
  uninstall: (key: string) => void;
  toggle: (key: string) => void;
  update: (key: string, patch: Partial<ScriptDescriptor>) => void;
  /** 批量启用 / 停用 — 单次 persist，避免循环 toggle 多次写 localStorage */
  toggleMany: (keys: string[], enabled: boolean) => void;
  /** 批量卸载 */
  uninstallMany: (keys: string[]) => void;
  importFromJson: (json: string) => ScriptDescriptor | undefined;
  enabled: () => ScriptDescriptor[];
}

function persist(scripts: ScriptDescriptor[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scripts));
  } catch (e) {
    console.warn("[scripts] persist failed", e);
  }
}

function loadStored(): ScriptDescriptor[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((d): d is ScriptDescriptor => validateDescriptor(d));
  } catch {
    return [];
  }
}

export const useScriptStore = create<ScriptStore>((set, get) => ({
  scripts: [],
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    const stored = loadStored();
    const storedKeys = new Set(stored.map((s) => s.key));
    const builtinsToInject = BUILTIN_SCRIPTS.filter(
      (b) => !storedKeys.has(b.key)
    ).map((b) => ({ ...b, installedAt: Date.now() }));
    const all = [...stored, ...builtinsToInject];
    set({ scripts: all, hydrated: true });
    if (builtinsToInject.length > 0) persist(all);
  },
  install: (script) => {
    const now = Date.now();
    const all = [
      ...get().scripts.filter((s) => s.key !== script.key),
      {
        ...script,
        installedAt: script.installedAt ?? now,
        updatedAt: now,
      },
    ];
    set({ scripts: all });
    persist(all);
  },
  uninstall: (key) => {
    const all = get().scripts.filter((s) => s.key !== key);
    set({ scripts: all });
    persist(all);
  },
  toggle: (key) => {
    const all = get().scripts.map((s) =>
      s.key === key ? { ...s, enabled: !s.enabled, updatedAt: Date.now() } : s
    );
    set({ scripts: all });
    persist(all);
  },
  toggleMany: (keys, enabled) => {
    const set_ = new Set(keys);
    const now = Date.now();
    const all = get().scripts.map((s) =>
      set_.has(s.key) ? { ...s, enabled, updatedAt: now } : s
    );
    set({ scripts: all });
    persist(all);
  },
  uninstallMany: (keys) => {
    const set_ = new Set(keys);
    const all = get().scripts.filter((s) => !set_.has(s.key));
    set({ scripts: all });
    persist(all);
  },
  update: (key, patch) => {
    const all = get().scripts.map((s) =>
      s.key === key ? { ...s, ...patch, updatedAt: Date.now() } : s
    );
    set({ scripts: all });
    persist(all);
  },
  importFromJson: (json) => {
    try {
      const obj = JSON.parse(json);
      if (!validateDescriptor(obj)) {
        throw new Error("invalid script descriptor: missing key/name/code");
      }
      const desc: ScriptDescriptor = {
        key: obj.key,
        name: obj.name,
        description: obj.description,
        enabled: obj.enabled ?? true,
        code: obj.code,
        config: obj.config,
      };
      get().install(desc);
      return desc;
    } catch (e) {
      console.error("[scripts] import failed", e);
      return undefined;
    }
  },
  enabled: () => get().scripts.filter((s) => s.enabled),
}));
