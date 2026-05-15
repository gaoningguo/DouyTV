/**
 * MoonTV-compatible source script protocol type definitions.
 *
 * 严格按照 MoonTVPlus/SOURCE_SCRIPT.md 的协议设计，
 * 便于用户直接迁移现有 MoonTV 脚本到 DouyTV。
 */

export interface ScriptMeta {
  name: string;
  author?: string;
  version?: string;
  description?: string;
}

export interface ScriptSourceItem {
  id: string;
  name: string;
}

export interface ScriptVodItem {
  id: string;
  title: string;
  poster?: string;
  year?: string;
  desc?: string;
  type_name?: string;
  douban_id?: number;
  vod_remarks?: string;
}

export interface ScriptSearchResult {
  list: ScriptVodItem[];
  page: number;
  pageCount: number;
  total: number;
}

export type ScriptEpisode =
  | string
  | {
      playUrl: string;
      needResolve?: boolean;
      title?: string;
    };

export interface ScriptPlayback {
  sourceId: string;
  sourceName: string;
  episodes: ScriptEpisode[];
  episodes_titles?: string[];
}

export interface ScriptDetailResult extends ScriptVodItem {
  playbacks: ScriptPlayback[];
}

export interface ScriptResolveResult {
  url: string;
  type?: "auto" | "mp4" | "hls" | "dash" | "flv";
  headers?: Record<string, string>;
}

export interface ScriptFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  query?: Record<string, string | number | boolean | undefined | null>;
  json?: unknown;
  timeout?: number;
}

export interface ScriptFetchResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  ok: boolean;
  text: () => Promise<string>;
  json: <T = unknown>() => Promise<T>;
  bytes: () => Promise<Uint8Array>;
}

export interface ScriptRequestAPI {
  get: (url: string, init?: ScriptFetchInit) => Promise<ScriptFetchResponse>;
  getJson: <T = unknown>(url: string, init?: ScriptFetchInit) => Promise<T>;
  getHtml: (url: string, init?: ScriptFetchInit) => Promise<string>;
  post: (url: string, init?: ScriptFetchInit) => Promise<ScriptFetchResponse>;
}

export interface ScriptCache {
  get: <T = unknown>(key: string) => Promise<T | undefined>;
  set: (key: string, value: unknown, ttlSec?: number) => Promise<void>;
  del: (key: string) => Promise<void>;
}

export interface ScriptLog {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface ScriptUtils {
  buildUrl: (base: string, query?: Record<string, unknown>) => string;
  joinUrl: (base: string, path: string) => string;
  randomUA: () => string;
  sleep: (ms: number) => Promise<void>;
  base64Encode: (s: string) => string;
  base64Decode: (s: string) => string;
  now: () => number;
}

export interface ScriptConfigAPI {
  get: (key: string) => unknown;
  require: (key: string) => unknown;
  all: () => Record<string, unknown>;
}

export interface ScriptRuntimeInfo {
  scriptKey: string;
  sourceId?: string;
}

/**
 * Loaded cheerio API surface — re-exposed as a callable function.
 * 与 cheerio.CheerioAPI 兼容，但避免直接引用，保留 unknown 类型让脚本自由使用。
 */
export type ScriptCheerioAPI = unknown;

export interface ScriptContext {
  fetch: (url: string, init?: ScriptFetchInit) => Promise<ScriptFetchResponse>;
  request: ScriptRequestAPI;
  html: { load: (html: string) => ScriptCheerioAPI };
  cache: ScriptCache;
  log: ScriptLog;
  utils: ScriptUtils;
  config: ScriptConfigAPI;
  runtime: ScriptRuntimeInfo;
}

export interface ScriptModule {
  meta?: ScriptMeta;
  getSources?: (ctx: ScriptContext) => Promise<ScriptSourceItem[]>;
  search?: (
    ctx: ScriptContext,
    args: { keyword: string; page: number; sourceId?: string }
  ) => Promise<ScriptSearchResult>;
  recommend?: (
    ctx: ScriptContext,
    args: { page: number; sourceId?: string }
  ) => Promise<ScriptSearchResult>;
  detail?: (
    ctx: ScriptContext,
    args: { id: string; sourceId?: string }
  ) => Promise<ScriptDetailResult>;
  resolvePlayUrl?: (
    ctx: ScriptContext,
    args: { playUrl: string; sourceId?: string; episodeIndex?: number }
  ) => Promise<ScriptResolveResult>;
}

/**
 * 持久化到 localStorage / 后端的脚本描述符。
 * 支持两种源类型：
 *  - type='script' (或省略): MoonTV 兼容的 JS 脚本，`code` 字段必填
 *  - type='cms': MoonTV CMS V10 协议（?ac=videolist&wd= / &ids=），`api` 字段必填
 */
export interface ScriptDescriptor {
  key: string;
  name: string;
  description?: string;
  enabled: boolean;
  /** 源类型，省略时按 'script' 处理（向后兼容） */
  type?: "script" | "cms";
  /** JS 脚本代码，type=script 时必填 */
  code?: string;
  /** CMS API base URL，type=cms 时必填，如 https://example.com/api.php/provider/vod */
  api?: string;
  /** CMS 详情页 URL（可选） */
  detail?: string;
  /** 标记需要通过代理访问（用于防盗链） */
  proxyMode?: boolean;
  /** CMS / 脚本的自定义 User-Agent */
  ua?: string;
  /** CMS / 脚本的自定义 Referer */
  referer?: string;
  config?: Record<string, unknown>;
  installedAt?: number;
  updatedAt?: number;
}
