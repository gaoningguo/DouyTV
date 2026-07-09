// Legado 书源订阅存储 —— 移植自 MoonTVPlus src/lib/legado/subscription-store.ts。
//
// 与原项目差异(Next.js server → Tauri client):
//   - Node `crypto.createHash('sha1')` → legado-crypto 的 sha1Hex
//   - 服务端 `fetch`(无 CORS) → readingFetchText(走 script_http_bytes)
//   - `db.getGlobalValue/...`(订阅按 chunk 存 KV) → SQLite 表 book_subscription_sources
//   - `validateProxyUrlServerSide`(SSRF) → 简单 isHttpUrl
//
// 订阅内容(一个 JSON 数组,可能上千个书源、几 MB~几十 MB)以「一条书源一行」
// 存进 SQLite(migration v7 的 book_subscription_sources)。localStorage 每 origin
// 只有 ~5MB 配额,大订阅会静默 QuotaExceeded,重启后显示 0 源 —— 故不再用 localStorage 分片。
// 非 Tauri(浏览器 dev)下无 SQLite,只保留内存缓存并 warn,刷新即失效。

import { getDb, isSqlAvailable } from "@/lib/db";
import { sha1Hex } from "./legado-crypto";
import { readingFetchText } from "@/lib/reading/net";
import type {
  BookSource,
  LegadoBookSourceRule,
  LegadoSubscriptionMeta,
} from "./types";

const MAX_BYTES = 20 * 1024 * 1024;
/** 单条 multi-row INSERT 的行数上限(每行 3 个占位符,SQLite 默认变量上限 999)。 */
const INSERT_BATCH = 200;
const sourcesCache = new Map<string, BookSource[]>();
const sourcesLoadPromises = new Map<string, Promise<BookSource[]>>();

interface SourceRow {
  source_json: string;
}

function stableId(input: string): string {
  return sha1Hex(input).slice(0, 16);
}

function subscriptionId(url: string, name?: string): string {
  return `legado_sub_${stableId(`${name || ""}|${url}`)}`;
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

/** 提取任意抛出物的可读信息。Tauri IPC 失败抛的是字符串而非 Error,
 *  直接 (e as Error).message 会得到 undefined —— 用它兜底。 */
export function errText(e: unknown): string {
  if (e instanceof Error) return e.message || String(e);
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
}

async function fetchSubscriptionText(
  url: string
): Promise<{ text: string; etag?: string; lastModified?: string }> {
  if (!isHttpUrl(url)) throw new Error("订阅地址未通过安全校验");
  let res;
  try {
    res = await readingFetchText(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
        Accept: "application/json,text/plain,*/*",
      },
    });
  } catch (e) {
    throw new Error(`订阅请求失败: ${errText(e)}`);
  }
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

/** 把一个订阅的全部书源写进 SQLite:先清空该订阅旧行,再分批 INSERT。写失败抛错。 */
async function writeSourcesToSql(
  id: string,
  sources: BookSource[]
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM book_subscription_sources WHERE subscription_id = $1",
    [id]
  );
  for (let start = 0; start < sources.length; start += INSERT_BATCH) {
    const batch = sources.slice(start, start + INSERT_BATCH);
    const placeholders: string[] = [];
    const values: (string | number)[] = [];
    batch.forEach((source, offset) => {
      const base = offset * 3;
      placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
      values.push(id, start + offset, JSON.stringify(source));
    });
    await db.execute(
      `INSERT INTO book_subscription_sources (subscription_id, seq, source_json) VALUES ${placeholders.join(
        ", "
      )}`,
      values
    );
  }
}

async function readSourcesFromSql(id: string): Promise<BookSource[]> {
  const db = await getDb();
  const rows = await db.select<SourceRow[]>(
    "SELECT source_json FROM book_subscription_sources WHERE subscription_id = $1 ORDER BY seq ASC",
    [id]
  );
  const out: BookSource[] = [];
  for (const row of rows) {
    try {
      out.push(JSON.parse(row.source_json) as BookSource);
    } catch {
      /* skip corrupt row */
    }
  }
  return out;
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
    const { text } = await fetchSubscriptionText(url);
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

    if (isSqlAvailable()) {
      // 写失败必须抛错(不能像 localStorage 版那样静默丢数据)。
      await writeSourcesToSql(id, sources);
    } else {
      console.warn(
        "[legado-sub] SQLite 不可用(非 Tauri 环境),订阅仅存内存,刷新后失效"
      );
    }
    sourcesLoadPromises.delete(id);
    sourcesCache.set(id, sources);
    const updatedAt = Date.now();
    return {
      id,
      name,
      url,
      enabled: true,
      sourceCount: sources.length,
      lastSyncAt: updatedAt,
      lastSuccessAt: updatedAt,
      lastError: "",
    };
  },

  getSources(id: string): Promise<BookSource[]> {
    const cached = sourcesCache.get(id);
    if (cached) return Promise.resolve(cached);

    const pending = sourcesLoadPromises.get(id);
    if (pending) return pending;

    if (!isSqlAvailable()) return Promise.resolve([]);

    const promise = readSourcesFromSql(id)
      .then((sources) => {
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

  async delete(id: string): Promise<void> {
    sourcesLoadPromises.delete(id);
    sourcesCache.delete(id);
    if (!isSqlAvailable()) return;
    const db = await getDb();
    await db.execute(
      "DELETE FROM book_subscription_sources WHERE subscription_id = $1",
      [id]
    );
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
