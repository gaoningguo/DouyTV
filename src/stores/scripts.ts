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
  /**
   * 批量装载 descriptor 数组（多 .js 文件导入用）—— 校验每项，单次 persist。
   * 返回 { added, failed }。
   */
  installMany: (candidates: unknown[]) => { added: number; failed: number };
  /**
   * 批量导入 — 接受 JSON 数组 [desc, ...] 或对象 { scripts:[...] }。
   * 返回 { added, failed }。单次 persist。
   */
  importManyFromJson: (json: string) => { added: number; failed: number };
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
  installMany: (candidates) => {
    let added = 0;
    let failed = 0;
    const now = Date.now();
    const map = new Map(get().scripts.map((s) => [s.key, s]));
    for (const obj of candidates) {
      if (!validateDescriptor(obj)) {
        failed++;
        continue;
      }
      const d = obj as ScriptDescriptor;
      const existing = map.get(d.key);
      map.set(d.key, {
        key: d.key,
        name: d.name,
        description: d.description,
        enabled: d.enabled ?? existing?.enabled ?? true,
        type: d.type,
        code: d.code,
        api: d.api,
        detail: d.detail,
        proxyMode: d.proxyMode,
        ua: d.ua,
        referer: d.referer,
        config: d.config,
        installedAt: existing?.installedAt ?? now,
        updatedAt: now,
      });
      added++;
    }
    if (added > 0) {
      const all = Array.from(map.values());
      set({ scripts: all });
      persist(all);
    }
    return { added, failed };
  },
  importManyFromJson: (json) => {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch (e) {
      console.error("[scripts] batch import: invalid JSON", e);
      return { added: 0, failed: 0 };
    }
    // 接受: 顶层数组 / { scripts:[...] } / 单个 descriptor 对象。
    let arr: unknown[] = [];
    if (Array.isArray(raw)) arr = raw;
    else if (raw && typeof raw === "object" && Array.isArray((raw as { scripts?: unknown[] }).scripts))
      arr = (raw as { scripts: unknown[] }).scripts;
    else if (raw && typeof raw === "object") arr = [raw];
    return get().installMany(arr);
  },
  enabled: () => get().scripts.filter((s) => s.enabled),
}));
