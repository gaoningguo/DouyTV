// Legado 书源订阅存储 —— 移植自 MoonTVPlus src/lib/legado/subscription-store.ts。
//
// 与原项目差异(Next.js server → Tauri client):
//   - Node `crypto.createHash('sha1')` → legado-crypto 的 sha1Hex
//   - 服务端 `fetch`(无 CORS) → readingFetchText(走 script_http_bytes)
//   - `db.getGlobalValue/setGlobalValue/deleteGlobalValue`(订阅按 chunk 存 KV) → localStorage
//   - `validateProxyUrlServerSide`(SSRF) → 简单 isHttpUrl
//
// 订阅内容(一个 JSON 数组,可能上千个书源)按 CHUNK_SIZE 切块存进 localStorage,
// manifest 记录块数,读取时拼回。这样单条 localStorage value 不会超限。

import { sha1Hex } from "./legado-crypto";
import { readingFetchText } from "@/lib/reading/net";
import type {
  BookSource,
  LegadoBookSourceRule,
  LegadoSubscriptionMeta,
} from "./types";

interface StoredManifest {
  id: string;
  name: string;
  url: string;
  hash: string;
  sourceCount: number;
  chunkCount: number;
  updatedAt: number;
  etag?: string;
  lastModified?: string;
}

const CHUNK_SIZE = 100;
const MAX_BYTES = 20 * 1024 * 1024;
const sourcesCache = new Map<string, BookSource[]>();
const sourcesLoadPromises = new Map<string, Promise<BookSource[]>>();

function stableId(input: string): string {
  return sha1Hex(input).slice(0, 16);
}

function subscriptionId(url: string, name?: string): string {
  return `legado_sub_${stableId(`${name || ""}|${url}`)}`;
}

function manifestKey(id: string): string {
  return `douytv:legado-sub:${id}:manifest`;
}

function chunkKey(id: string, index: number): string {
  return `douytv:legado-sub:${id}:chunk:${index}`;
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

function getLs(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setLs(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    console.warn(`[legado-sub] localStorage persist failed: ${key}`, e);
  }
}

function delLs(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

async function fetchSubscriptionText(
  url: string
): Promise<{ text: string; etag?: string; lastModified?: string }> {
  if (!isHttpUrl(url)) throw new Error("订阅地址未通过安全校验");
  const res = await readingFetchText(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
      Accept: "application/json,text/plain,*/*",
    },
  });
  if (!res.ok) throw new Error(`订阅请求失败: ${res.status}`);
  if (res.text.length > MAX_BYTES) throw new Error("订阅内容过大");
  return {
    text: res.text,
    etag: res.headers["etag"] || undefined,
    lastModified: res.headers["last-modified"] || undefined,
  };
}

function extractRuleList(input: unknown): LegadoBookSourceRule[] {
  if (Array.isArray(input)) {
    return input.filter((item) => item && typeof item === "object");
  }
  if (!input || typeof input !== "object") return [];
  const obj = input as Record<string, unknown>;
  for (const key of ["data", "sources", "bookSources", "items", "list"]) {
    if (Array.isArray(obj[key])) {
      return (obj[key] as unknown[]).filter(
        (item) => item && typeof item === "object"
      ) as LegadoBookSourceRule[];
    }
  }
  return [input as LegadoBookSourceRule];
}

function normalizeRule(
  rule: LegadoBookSourceRule,
  subId: string,
  index: number
): BookSource | null {
  const name = rule.bookSourceName || `Legado 书源 ${index + 1}`;
  const url = rule.bookSourceUrl || "";
  if (!url) return null;
  return {
    id: `legado_${stableId(`${subId}|${name}|${url}|${index}`)}`,
    name,
    type: "legado",
    url,
    enabled: rule.enabled !== false,
    authMode: "none",
    username: "",
    password: "",
    headerName: "",
    headerValue: "",
    searchTemplate: "",
    preferFormat: ["epub"],
    language: "",
    legado: rule,
    subscriptionId: subId,
  };
}

function readManifest(id: string): StoredManifest | null {
  const raw = getLs(manifestKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredManifest;
  } catch {
    return null;
  }
}

function readSourcesFromLs(id: string): BookSource[] {
  const manifest = readManifest(id);
  if (!manifest) return [];
  const chunks: BookSource[] = [];
  for (let index = 0; index < manifest.chunkCount; index += 1) {
    const raw = getLs(chunkKey(id, index));
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) chunks.push(...(parsed as BookSource[]));
    } catch {
      /* skip corrupt chunk */
    }
  }
  return chunks;
}

export const legadoSubscriptionStore = {
  makeId: subscriptionId,

  async sync(input: {
    id?: string;
    name?: string;
    url: string;
  }): Promise<LegadoSubscriptionMeta> {
    const url = input.url.trim();
    if (!url) throw new Error("订阅 URL 不能为空");
    const id = input.id || subscriptionId(url, input.name);
    const name = input.name?.trim() || "Legado 订阅";
    const previous = readManifest(id);
    const { text, etag, lastModified } = await fetchSubscriptionText(url);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("订阅内容不是合法 JSON");
    }
    const rules = extractRuleList(parsed);
    const sources = rules
      .map((rule, index) => normalizeRule(rule, id, index))
      .filter((item): item is BookSource => !!item);
    if (sources.length === 0) throw new Error("订阅内没有识别到有效 Legado 书源");

    const chunkCount = Math.ceil(sources.length / CHUNK_SIZE);
    const hash = sha1Hex(JSON.stringify(sources));
    for (let index = 0; index < chunkCount; index += 1) {
      setLs(
        chunkKey(id, index),
        JSON.stringify(sources.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE))
      );
    }
    if (previous && previous.chunkCount > chunkCount) {
      for (let index = chunkCount; index < previous.chunkCount; index += 1) {
        delLs(chunkKey(id, index));
      }
    }
    const manifest: StoredManifest = {
      id,
      name,
      url,
      hash,
      sourceCount: sources.length,
      chunkCount,
      updatedAt: Date.now(),
      etag,
      lastModified,
    };
    setLs(manifestKey(id), JSON.stringify(manifest));
    sourcesLoadPromises.delete(id);
    sourcesCache.set(id, sources);
    return {
      id,
      name,
      url,
      enabled: true,
      sourceCount: sources.length,
      lastSyncAt: manifest.updatedAt,
      lastSuccessAt: manifest.updatedAt,
      lastError: "",
    };
  },

  getSources(id: string): Promise<BookSource[]> {
    const cached = sourcesCache.get(id);
    if (cached) return Promise.resolve(cached);

    const pending = sourcesLoadPromises.get(id);
    if (pending) return pending;

    const promise = Promise.resolve()
      .then(() => {
        const sources = readSourcesFromLs(id);
        sourcesCache.set(id, sources);
        sourcesLoadPromises.delete(id);
        return sources;
      })
      .catch((error) => {
        sourcesLoadPromises.delete(id);
        throw error;
      });
    sourcesLoadPromises.set(id, promise);
    return promise;
  },

  async getSourcesForSubscriptions(
    subscriptions: LegadoSubscriptionMeta[] = []
  ): Promise<BookSource[]> {
    const enabled = subscriptions.filter((item) => item.enabled !== false);
    const groups = await Promise.all(enabled.map((item) => this.getSources(item.id)));
    return groups.flat().filter((source) => source.enabled !== false);
  },

  delete(id: string): void {
    sourcesLoadPromises.delete(id);
    sourcesCache.delete(id);
    const manifest = readManifest(id);
    if (manifest) {
      for (let index = 0; index < manifest.chunkCount; index += 1) {
        delLs(chunkKey(id, index));
      }
    }
    delLs(manifestKey(id));
  },

  clearCache(id?: string): void {
    if (id) {
      sourcesLoadPromises.delete(id);
      sourcesCache.delete(id);
      return;
    }
    sourcesLoadPromises.clear();
    sourcesCache.clear();
  },
};
