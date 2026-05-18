/**
 * 弹幕缓存层（localStorage）。
 *
 * 键策略：
 *   - 主键 `douytv:danmaku:<sha-ish>` 存单条 episode 的 comments + 元信息
 *   - 索引键 `douytv:danmaku-index` 维护所有 key 的列表 + 时间戳，用于 stats 与清理
 *
 * 命中条件：title + episodeIndex 完全相同（与 MoonTV 一致 —— 这样切换合集线路也能命中）。
 * TTL：7 天。超时不删，但视为未命中 → 触发重新拉取并覆盖。
 */
import type { DanmakuComment } from "./types";

const KEY_PREFIX = "douytv:danmaku:";
const INDEX_KEY = "douytv:danmaku-index";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface CacheEntry {
  comments: DanmakuComment[];
  savedAt: number;
  animeId?: number;
  episodeId?: number;
  animeTitle?: string;
  episodeTitle?: string;
}

interface IndexEntry {
  key: string;
  title: string;
  episodeIndex: number;
  savedAt: number;
  count: number;
}

function entryKey(title: string, episodeIndex: number): string {
  // 简易 hash 防止 localStorage 键名太长 / 含特殊字符
  const safe = title.replace(/\s+/g, "_").slice(0, 80);
  return `${KEY_PREFIX}${safe}__ep${episodeIndex}`;
}

function loadIndex(): IndexEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as IndexEntry[]) : [];
  } catch {
    return [];
  }
}

function saveIndex(entries: IndexEntry[]) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(entries));
  } catch (e) {
    console.warn("[danmaku-cache] index save failed", e);
  }
}

export async function getDanmakuFromCache(
  title: string,
  episodeIndex: number
): Promise<{ comments: DanmakuComment[] } | null> {
  try {
    const key = entryKey(title, episodeIndex);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (Date.now() - entry.savedAt > TTL_MS) return null;
    return { comments: entry.comments ?? [] };
  } catch {
    return null;
  }
}

export async function saveDanmakuToCache(
  title: string,
  episodeIndex: number,
  comments: DanmakuComment[],
  meta: {
    animeId?: number;
    episodeId?: number;
    animeTitle?: string;
    episodeTitle?: string;
  } = {}
): Promise<void> {
  if (!title || episodeIndex < 0 || comments.length === 0) return;
  try {
    const key = entryKey(title, episodeIndex);
    const entry: CacheEntry = {
      comments,
      savedAt: Date.now(),
      ...meta,
    };
    localStorage.setItem(key, JSON.stringify(entry));
    const idx = loadIndex().filter((e) => e.key !== key);
    idx.push({
      key,
      title,
      episodeIndex,
      savedAt: entry.savedAt,
      count: comments.length,
    });
    saveIndex(idx);
  } catch (e) {
    // 大概率是 localStorage 配额满了 — 清掉最老的一半再试一次
    if (e instanceof DOMException && e.name === "QuotaExceededError") {
      const idx = loadIndex().sort((a, b) => a.savedAt - b.savedAt);
      const drop = idx.slice(0, Math.ceil(idx.length / 2));
      for (const d of drop) {
        try {
          localStorage.removeItem(d.key);
        } catch {
          /* ignore */
        }
      }
      saveIndex(idx.slice(Math.ceil(idx.length / 2)));
      // 不再重试，下次写入即可
    } else {
      console.warn("[danmaku-cache] save failed", e);
    }
  }
}

export async function clearAllDanmakuCache(): Promise<number> {
  const idx = loadIndex();
  let count = 0;
  for (const e of idx) {
    try {
      localStorage.removeItem(e.key);
      count++;
    } catch {
      /* ignore */
    }
  }
  saveIndex([]);
  return count;
}

export async function clearDanmakuCacheByTitle(title: string): Promise<number> {
  const idx = loadIndex();
  const toRemove = idx.filter((e) => e.title === title);
  for (const e of toRemove) {
    try {
      localStorage.removeItem(e.key);
    } catch {
      /* ignore */
    }
  }
  saveIndex(idx.filter((e) => e.title !== title));
  return toRemove.length;
}

export async function clearExpiredDanmakuCache(): Promise<number> {
  const idx = loadIndex();
  const now = Date.now();
  const expired = idx.filter((e) => now - e.savedAt > TTL_MS);
  for (const e of expired) {
    try {
      localStorage.removeItem(e.key);
    } catch {
      /* ignore */
    }
  }
  saveIndex(idx.filter((e) => now - e.savedAt <= TTL_MS));
  return expired.length;
}

export interface DanmakuCacheStats {
  entries: number;
  totalComments: number;
  approxBytes: number;
}

export function getDanmakuCacheStats(): DanmakuCacheStats {
  const idx = loadIndex();
  let bytes = 0;
  let total = 0;
  for (const e of idx) {
    try {
      const raw = localStorage.getItem(e.key);
      if (raw) bytes += raw.length;
      total += e.count;
    } catch {
      /* ignore */
    }
  }
  return { entries: idx.length, totalComments: total, approxBytes: bytes };
}
