import type { ScriptCache } from "./types";

interface CacheEntry {
  value: unknown;
  expiresAt?: number;
}

const PREFIX = "douytv:script-cache:";

function k(scriptKey: string, key: string) {
  return `${PREFIX}${scriptKey}:${key}`;
}

export function createCache(scriptKey: string): ScriptCache {
  return {
    async get<T = unknown>(key: string) {
      try {
        const raw = localStorage.getItem(k(scriptKey, key));
        if (!raw) return undefined;
        const entry = JSON.parse(raw) as CacheEntry;
        if (entry.expiresAt && Date.now() > entry.expiresAt) {
          localStorage.removeItem(k(scriptKey, key));
          return undefined;
        }
        return entry.value as T;
      } catch {
        return undefined;
      }
    },
    async set(key: string, value: unknown, ttlSec?: number) {
      try {
        const entry: CacheEntry = { value };
        if (ttlSec && ttlSec > 0) entry.expiresAt = Date.now() + ttlSec * 1000;
        localStorage.setItem(k(scriptKey, key), JSON.stringify(entry));
      } catch (e) {
        console.warn("[script-cache] set failed", scriptKey, key, e);
      }
    },
    async del(key: string) {
      localStorage.removeItem(k(scriptKey, key));
    },
  };
}
