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
  /**
   * 可选分组名 —— 用于点播页 BrowseSection 按 group 分行展示。
   * 典型值：「分类」（电影/电视剧/综艺/动漫）、「标签」（科幻/喜剧/恐怖）、「年份」（2024/2023）。
   * 不填默认归到 "分类" 分组。旧脚本（无 group 字段）兼容。
   */
  group?: string;
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
  /** 走 HTTP/2 客户端（reqwest+rustls） —— 给 live.douyin.com 这类强制 ALPN h2 的端点用。
   *  默认 false 走 ureq HTTP/1.1。 */
  http2?: boolean;
  /**
   * 显式覆盖代理:
   *   - `string` —— 用这个 URL 当代理(http:// 或 socks5://)
   *   - `null`   —— 强制直连,忽略全局 useProxyStore
   *   - `undefined`(默认) —— 跟随全局 `getActiveProxyUrl()`
   * 用于 NetLive 平台级 per-platform 代理覆盖,见 lib/netlive/scriptFetch.ts。
   */
  proxyOverride?: string | null;
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
