import {
  callGetSources,
  callRecommend,
  callSearch,
} from "@/source-script/runtime";
import type {
  ScriptDescriptor,
  ScriptSearchResult,
  ScriptSourceItem,
} from "@/source-script/types";
import type { SearchResult } from "@/hooks/useSearch";

export interface SourceCategoryBundle {
  script: ScriptDescriptor;
  categories: ScriptSourceItem[];
}

export interface SourceVideoResult extends ScriptSearchResult {
  rows: SearchResult[];
}

const SOURCE_CACHE_TTL_MS = 60 * 60 * 1000;
const STORAGE_PREFIX = "douytv:vod-source-discovery";

interface TimedCache<T> {
  key: string;
  expiresAt: number;
  value: T;
}

interface StoredBundle {
  scriptKey: string;
  categories: ScriptSourceItem[];
}

const sourceCategoryCache = new Map<string, TimedCache<ScriptSourceItem[]>>();
const sourceVideoCache = new Map<string, TimedCache<SourceVideoResult>>();
let duanjuBundleCache: TimedCache<SourceCategoryBundle[]> | undefined;
let duanjuRecommendCache: TimedCache<SearchResult[]> | undefined;

function hashString(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

function scriptSignature(script: ScriptDescriptor): string {
  const type = script.type ?? "script";
  const identity = [
    script.key,
    script.name,
    type,
    script.api ?? "",
    script.detail ?? "",
    script.ua ?? "",
    script.referer ?? "",
    script.updatedAt ?? "",
    script.installedAt ?? "",
    hashString(script.code ?? ""),
  ].join(":");
  return hashString(identity);
}

function enabledScriptsSignature(scripts: ScriptDescriptor[]): string {
  return scripts
    .filter((script) => script.enabled)
    .map((script) => `${script.key}:${scriptSignature(script)}`)
    .join("|");
}

function isFresh<T>(entry: TimedCache<T> | undefined): entry is TimedCache<T> {
  return !!entry && entry.expiresAt > Date.now();
}

function readStorage<T>(key: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as TimedCache<T>;
    if (!isFresh(parsed)) {
      window.localStorage.removeItem(key);
      return undefined;
    }
    return parsed.value;
  } catch {
    return undefined;
  }
}

function writeStorage<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    const entry: TimedCache<T> = {
      key,
      expiresAt: Date.now() + SOURCE_CACHE_TTL_MS,
      value,
    };
    window.localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // localStorage can be full or unavailable in private contexts.
  }
}

export function isDuanjuTypeName(typeName: string): boolean {
  const normalized = typeName.toLowerCase();
  return (
    normalized.includes("短剧") ||
    normalized.includes("短视频") ||
    normalized.includes("微短剧")
  );
}

export async function getSourceCategories(
  script: ScriptDescriptor
): Promise<ScriptSourceItem[]> {
  const cacheKey = `sources:${script.key}:${scriptSignature(script)}`;
  const memory = sourceCategoryCache.get(cacheKey);
  if (isFresh(memory)) return memory.value;

  const stored = readStorage<ScriptSourceItem[]>(`${STORAGE_PREFIX}:${cacheKey}`);
  if (stored) {
    sourceCategoryCache.set(cacheKey, {
      key: cacheKey,
      expiresAt: Date.now() + SOURCE_CACHE_TTL_MS,
      value: stored,
    });
    return stored;
  }

  const list = await callGetSources(script);
  const categories = list.length > 0 ? list : [{ id: "default", name: script.name }];
  sourceCategoryCache.set(cacheKey, {
    key: cacheKey,
    expiresAt: Date.now() + SOURCE_CACHE_TTL_MS,
    value: categories,
  });
  writeStorage(`${STORAGE_PREFIX}:${cacheKey}`, categories);
  return categories;
}

export async function getDuanjuSourceBundles(
  scripts: ScriptDescriptor[]
): Promise<SourceCategoryBundle[]> {
  const enabled = scripts.filter((script) => script.enabled);
  if (enabled.length === 0) return [];

  const cacheKey = `duanju:bundles:${enabledScriptsSignature(scripts)}`;
  if (isFresh(duanjuBundleCache) && duanjuBundleCache.key === cacheKey) {
    return duanjuBundleCache.value;
  }

  const stored = readStorage<StoredBundle[]>(`${STORAGE_PREFIX}:${cacheKey}`);
  if (stored) {
    const byKey = new Map(enabled.map((script) => [script.key, script]));
    const bundles = stored
      .map((item) => {
        const script = byKey.get(item.scriptKey);
        return script ? { script, categories: item.categories } : undefined;
      })
      .filter((item): item is SourceCategoryBundle => !!item);
    duanjuBundleCache = {
      key: cacheKey,
      expiresAt: Date.now() + SOURCE_CACHE_TTL_MS,
      value: bundles,
    };
    return bundles;
  }

  const checked = await Promise.allSettled(
    enabled.map(async (script) => {
      const categories = await getSourceCategories(script);
      const duanju = categories.filter((item) => isDuanjuTypeName(item.name));
      return duanju.length > 0 ? { script, categories: duanju } : undefined;
    })
  );

  const bundles = checked
    .map((item) => (item.status === "fulfilled" ? item.value : undefined))
    .filter((item): item is SourceCategoryBundle => !!item);
  duanjuBundleCache = {
    key: cacheKey,
    expiresAt: Date.now() + SOURCE_CACHE_TTL_MS,
    value: bundles,
  };
  writeStorage(
    `${STORAGE_PREFIX}:${cacheKey}`,
    bundles.map((bundle) => ({
      scriptKey: bundle.script.key,
      categories: bundle.categories,
    }))
  );
  return bundles;
}

function toRows(
  script: ScriptDescriptor,
  result: ScriptSearchResult
): SearchResult[] {
  return result.list.map((vod) => ({
    scriptKey: script.key,
    scriptName: script.name,
    vod,
  }));
}

export async function loadSourceCategoryVideos(
  script: ScriptDescriptor,
  categoryId: string,
  page: number
): Promise<SourceVideoResult> {
  const cacheKey = `videos:${script.key}:${scriptSignature(script)}:${categoryId || "default"}:${page}`;
  const memory = sourceVideoCache.get(cacheKey);
  if (isFresh(memory)) return memory.value;

  const stored = readStorage<SourceVideoResult>(`${STORAGE_PREFIX}:${cacheKey}`);
  if (stored) {
    sourceVideoCache.set(cacheKey, {
      key: cacheKey,
      expiresAt: Date.now() + SOURCE_CACHE_TTL_MS,
      value: stored,
    });
    return stored;
  }

  const result = await callRecommend(script, {
    page,
    sourceId: categoryId || undefined,
  });
  const value = {
    ...result,
    rows: toRows(script, result),
  };
  sourceVideoCache.set(cacheKey, {
    key: cacheKey,
    expiresAt: Date.now() + SOURCE_CACHE_TTL_MS,
    value,
  });
  writeStorage(`${STORAGE_PREFIX}:${cacheKey}`, value);
  return value;
}

export async function searchSourceVideos(
  script: ScriptDescriptor,
  keyword: string,
  page: number
): Promise<SourceVideoResult> {
  const cacheKey = `search:${script.key}:${scriptSignature(script)}:${keyword.trim()}:${page}`;
  const memory = sourceVideoCache.get(cacheKey);
  if (isFresh(memory)) return memory.value;

  const stored = readStorage<SourceVideoResult>(`${STORAGE_PREFIX}:${cacheKey}`);
  if (stored) {
    sourceVideoCache.set(cacheKey, {
      key: cacheKey,
      expiresAt: Date.now() + SOURCE_CACHE_TTL_MS,
      value: stored,
    });
    return stored;
  }

  const result = await callSearch(script, {
    keyword: keyword.trim(),
    page,
  });
  const value = {
    ...result,
    rows: toRows(script, result),
  };
  sourceVideoCache.set(cacheKey, {
    key: cacheKey,
    expiresAt: Date.now() + SOURCE_CACHE_TTL_MS,
    value,
  });
  writeStorage(`${STORAGE_PREFIX}:${cacheKey}`, value);
  return value;
}

export async function fetchDuanjuRecommendations(
  scripts: ScriptDescriptor[],
  limit = 20
): Promise<SearchResult[]> {
  const cacheKey = `duanju:recommend:${enabledScriptsSignature(scripts)}:${limit}`;
  if (isFresh(duanjuRecommendCache) && duanjuRecommendCache.key === cacheKey) {
    return duanjuRecommendCache.value.slice(0, limit);
  }

  const stored = readStorage<SearchResult[]>(`${STORAGE_PREFIX}:${cacheKey}`);
  if (stored) {
    duanjuRecommendCache = {
      key: cacheKey,
      expiresAt: Date.now() + SOURCE_CACHE_TTL_MS,
      value: stored,
    };
    return stored.slice(0, limit);
  }

  const bundles = await getDuanjuSourceBundles(scripts);
  for (const bundle of bundles) {
    for (const category of bundle.categories) {
      try {
        const result = await loadSourceCategoryVideos(bundle.script, category.id, 1);
        const rows = result.rows.filter((row) => row.vod.id && row.vod.title);
        if (rows.length > 0) {
          const value = rows.slice(0, limit);
          duanjuRecommendCache = {
            key: cacheKey,
            expiresAt: Date.now() + SOURCE_CACHE_TTL_MS,
            value,
          };
          writeStorage(`${STORAGE_PREFIX}:${cacheKey}`, value);
          return value;
        }
      } catch (e) {
        console.warn(`[duanju] ${bundle.script.key}:${category.id} failed`, e);
      }
    }
  }
  return [];
}
