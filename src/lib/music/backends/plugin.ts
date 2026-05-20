/**
 * 客户端 JS 音乐插件 backend —— 支持两种主流形态自动识别：
 *
 *   1. MusicFreePlugin (CommonJS): module.exports = { platform, search, getMediaSource, getLyric, ... }
 *      参考 maotoumao/MusicFreePlugins。注入 axios shim。
 *
 *   2. LX-Music-Desktop 用户源 (event-bus): 通过 globalThis.lx 注册 EVENT_NAMES.request 处理器，
 *      send(EVENT_NAMES.inited, {sources}) 上报支持的平台。
 *      参考 lyswhut/lx-music-desktop > docs/扩展.md。
 *      DouyTV 只用其 parse + lyric 能力（LX 源没有 search）。
 *
 * 检测启发：源码含 `globalThis.lx`、`EVENT_NAMES`、`send(EVENT_NAMES.inited` 任一 → LX；
 * 否则按 MusicFree 处理。
 */
import { scriptFetch } from "@/source-script/fetch";
import { useMusicStore } from "@/stores/music";
import * as cheerio from "cheerio";
import type {
  IRecommendSheet,
  IRecommendSheetTag,
  IRecommendSheetTagGroup,
  MusicAlbum,
  MusicArtistWorksResult,
  MusicComment,
  MusicQuality,
  MusicSong,
  MusicSource,
} from "../types";
import type {
  BackendSearchArgs,
  BackendSearchResult,
  MusicBackendRuntime,
  PluginBackend,
} from "./types";

/* ───────────────── 共享 axios shim ───────────────── */

interface AxiosLikeResponse<T> {
  data: T;
  status: number;
  headers: Record<string, string>;
}

function makeAxiosShim() {
  async function request<T = unknown>(
    method: string,
    url: string,
    opts: {
      headers?: Record<string, string>;
      data?: unknown;
      params?: Record<string, string | number>;
      responseType?: "json" | "text" | "arraybuffer";
      timeout?: number;
    } = {}
  ): Promise<AxiosLikeResponse<T>> {
    let finalUrl = url;
    if (opts.params) {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.params)) sp.set(k, String(v));
      finalUrl += (url.includes("?") ? "&" : "?") + sp.toString();
    }
    const res = await scriptFetch(finalUrl, {
      method,
      headers: opts.headers,
      body: typeof opts.data === "string" ? opts.data : undefined,
      json:
        typeof opts.data === "object" && opts.data !== null ? opts.data : undefined,
      timeout: opts.timeout ?? 30_000,
    });
    let data: unknown;
    if (opts.responseType === "text") data = await res.text();
    else if (opts.responseType === "arraybuffer") {
      const u8 = await res.bytes();
      data = u8.buffer;
    } else {
      try {
        data = await res.json();
      } catch {
        data = await res.text();
      }
    }
    return { data: data as T, status: res.status, headers: res.headers };
  }
  const fn = (cfg: { method?: string; url: string } & Record<string, unknown>) =>
    request(cfg.method ?? "GET", cfg.url, cfg as Parameters<typeof request>[2]);
  return Object.assign(fn, {
    get: <T = unknown>(url: string, opts?: Parameters<typeof request>[2]) =>
      request<T>("GET", url, opts ?? {}),
    post: <T = unknown>(url: string, data?: unknown, opts?: Parameters<typeof request>[2]) =>
      request<T>("POST", url, { ...(opts ?? {}), data }),
    put: <T = unknown>(url: string, data?: unknown, opts?: Parameters<typeof request>[2]) =>
      request<T>("PUT", url, { ...(opts ?? {}), data }),
    delete: <T = unknown>(url: string, opts?: Parameters<typeof request>[2]) =>
      request<T>("DELETE", url, opts ?? {}),
  });
}

/* ───────────────── MusicFreePlugin ───────────────── */

function makeQsShim() {
  return {
    stringify: (obj: Record<string, unknown>): string => {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(obj)) {
        if (v === undefined || v === null) continue;
        sp.set(k, String(v));
      }
      return sp.toString();
    },
    parse: (str: string): Record<string, string> => {
      const sp = new URLSearchParams(str.replace(/^\?/, ""));
      const out: Record<string, string> = {};
      sp.forEach((v, k) => {
        out[k] = v;
      });
      return out;
    },
  };
}

function makeHeShim() {
  const NAMED = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
  } as Record<string, string>;
  return {
    decode: (str: string): string => {
      if (typeof str !== "string") return "";
      return str
        .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(+code))
        .replace(/&#x([0-9a-fA-F]+);/g, (_m, code) => String.fromCharCode(parseInt(code, 16)))
        .replace(/&[a-z]+;/g, (m) => NAMED[m] ?? m);
    },
    encode: (str: string): string => {
      if (typeof str !== "string") return "";
      return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    },
  };
}

/**
 * 给 MusicFreePlugin 的 require() 提供 Node 风格依赖。仅提供常用包；
 * 缺失的包 require 时直接 throw —— 让插件作者知道哪个依赖未实现。
 */
function makeRequireShim(axios: ReturnType<typeof makeAxiosShim>) {
  const packages: Record<string, unknown> = {
    cheerio,
    axios,
    qs: makeQsShim(),
    he: makeHeShim(),
  };
  return (name: string): unknown => {
    const pkg = packages[name];
    if (pkg === undefined) {
      throw new Error(
        `MusicFreePlugin 依赖了未提供的 npm 包: ${name}（DouyTV 仅内置 cheerio/axios/qs/he）`
      );
    }
    return pkg;
  };
}

interface MusicFreePluginUserVariable {
  key: string;
  name?: string;
  hint?: string;
}

interface MusicFreePlugin {
  platform: string;
  version?: string;
  /** 用户可配置变量（cookie/key 等） */
  userVariables?: MusicFreePluginUserVariable[];
  /** 默认搜索类型 */
  defaultSearchType?: "music" | "album" | "artist" | "sheet";
  /** 支持的搜索类型 */
  supportedSearchType?: Array<"music" | "album" | "artist" | "sheet">;
  /** 远程更新 URL */
  srcUrl?: string;
  /** 提示文案 */
  hints?: Record<string, string[]>;
  /** 主键（用于 musicItem 去重） */
  primaryKey?: string[];
  /** 缓存控制 */
  cacheControl?: "cache" | "no-cache" | "no-store";
  search?: (
    keyword: string,
    page: number,
    type: string
  ) => Promise<{ isEnd?: boolean; data?: Array<Record<string, unknown>> }>;
  getMediaSource?: (
    musicItem: Record<string, unknown>,
    quality: string
  ) => Promise<{ url: string; headers?: Record<string, string> }>;
  getLyric?: (
    musicItem: Record<string, unknown>
  ) => Promise<{ rawLrc?: string; translation?: string }>;
  getMusicInfo?: (
    musicItem: Record<string, unknown>
  ) => Promise<Partial<Record<string, unknown>> | null>;
  getAlbumInfo?: (
    albumItem: Record<string, unknown>,
    page: number
  ) => Promise<{
    isEnd?: boolean;
    albumItem?: Record<string, unknown>;
    musicList?: Array<Record<string, unknown>>;
  } | null>;
  getArtistWorks?: <T extends "music" | "album">(
    artistItem: Record<string, unknown>,
    page: number,
    type: T
  ) => Promise<{ isEnd?: boolean; data?: Array<Record<string, unknown>> }>;
  getTopLists?: () => Promise<
    Array<{ title?: string; data?: Array<Record<string, unknown>> }>
  >;
  getTopListDetail?: (
    topList: Record<string, unknown>,
    page?: number
  ) => Promise<{
    title?: string;
    musicList?: Array<Record<string, unknown>>;
    isEnd?: boolean;
  }>;
  getMusicSheetInfo?: (
    sheet: Record<string, unknown>,
    page: number
  ) => Promise<{
    sheetItem?: Record<string, unknown>;
    musicList?: Array<Record<string, unknown>>;
    isEnd?: boolean;
  }>;
  getRecommendSheetTags?: () => Promise<{
    pinned?: Array<Record<string, unknown>>;
    data?: Array<{ title?: string; data?: Array<Record<string, unknown>> }>;
  }>;
  getRecommendSheetsByTag?: (
    tag: Record<string, unknown>,
    page?: number
  ) => Promise<{ isEnd?: boolean; data?: Array<Record<string, unknown>> }>;
  getMusicComments?: (
    musicItem: Record<string, unknown>,
    page?: number
  ) => Promise<{ isEnd?: boolean; data?: Array<Record<string, unknown>> }>;
  importMusicSheet?: (urlLike: string) => Promise<Array<Record<string, unknown>> | null>;
  importMusicItem?: (urlLike: string) => Promise<Record<string, unknown> | null>;
}

function compileMusicFree(code: string, opts?: { pluginId?: string }): MusicFreePlugin {
  const axios = makeAxiosShim();
  const require_ = makeRequireShim(axios);
  const sandbox = {
    module: { exports: {} as MusicFreePlugin },
    exports: {} as MusicFreePlugin,
    axios,
    require_,
  };
  const env = {
    getUserVariables: () => {
      if (!opts?.pluginId) return {};
      try {
        const state = useMusicStore.getState() as {
          pluginUserVariables?: Record<string, Record<string, string>>;
        };
        return state.pluginUserVariables?.[opts.pluginId] ?? {};
      } catch {
        return {};
      }
    },
    get userVariables(): Record<string, string> {
      return this.getUserVariables();
    },
    os: "web" as const,
    lang: "zh-CN",
    appVersion: "1.0.0",
  };
  const processShim = {
    platform: "web",
    version: "1.0.0",
    env,
  };
  const fn = new Function(
    "module",
    "exports",
    "axios",
    "require",
    "env",
    "process",
    "URL",
    '"use strict";\n' +
      code +
      "\nreturn module.exports && Object.keys(module.exports).length ? module.exports : exports;"
  );
  const result = fn(
    sandbox.module,
    sandbox.exports,
    sandbox.axios,
    sandbox.require_,
    env,
    processShim,
    URL
  ) as MusicFreePlugin;
  if (!result || typeof result !== "object") {
    throw new Error("MusicFree 插件必须导出对象 (module.exports = {...})");
  }
  if (!result.platform) throw new Error("MusicFree 插件缺少 platform 字段");
  return result;
}

/* ───────────────── LX-Music-Desktop script ───────────────── */

const LX_EVENT_NAMES = {
  inited: "inited",
  request: "request",
  updateAlert: "updateAlert",
} as const;

type LxAction = "musicUrl" | "lyric" | "pic" | "musicInfo" | "songList";

interface LxSourceInfo {
  name?: string;
  type?: string; // "music"
  actions?: LxAction[];
  qualitys?: string[];
}

interface LxInitedPayload {
  status?: boolean;
  message?: string;
  openDevTools?: boolean;
  sources?: Record<string, LxSourceInfo>;
}

type LxRequestHandler = (req: {
  source: string;
  action: LxAction;
  info: Record<string, unknown>;
}) => unknown | Promise<unknown>;

interface LxRuntime {
  inited: LxInitedPayload | null;
  requestHandler: LxRequestHandler | null;
  /** 触发一次请求，返回 handler 的结果 */
  invoke: (
    source: string,
    action: LxAction,
    info: Record<string, unknown>
  ) => Promise<unknown>;
}

function compileLxScript(code: string): LxRuntime {
  const runtime: LxRuntime = {
    inited: null,
    requestHandler: null,
    invoke: async (source, action, info) => {
      if (!runtime.requestHandler) throw new Error("LX 源未注册 request 处理器");
      return Promise.resolve(runtime.requestHandler({ source, action, info }));
    },
  };

  const axios = makeAxiosShim();

  // request shim —— LX 脚本里调用 request(url, options) 拿 HTTP 响应
  const lxRequest = async (
    url: string,
    options: {
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
      form?: Record<string, string>;
      formData?: Record<string, string>;
      timeout?: number;
    } = {}
  ) => {
    const method = options.method ?? "GET";
    let body: string | undefined;
    let headers = { ...(options.headers ?? {}) };
    if (options.body && typeof options.body === "object") {
      body = JSON.stringify(options.body);
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
      }
    } else if (typeof options.body === "string") {
      body = options.body;
    } else if (options.form) {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(options.form)) sp.set(k, String(v));
      body = sp.toString();
      if (!headers["Content-Type"]) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
      }
    }
    const res = await scriptFetch(url, {
      method,
      headers,
      body,
      timeout: options.timeout ?? 30_000,
    });
    let parsedBody: unknown;
    const text = await res.text();
    try {
      parsedBody = JSON.parse(text);
    } catch {
      parsedBody = text;
    }
    return {
      statusCode: res.status,
      headers: res.headers,
      body: parsedBody,
      raw: text,
    };
  };

  // 事件总线 —— LX 脚本用 on/send 通信
  const listeners: Record<string, Array<(payload: unknown) => void>> = {};
  const send = (event: string, payload: unknown) => {
    if (event === LX_EVENT_NAMES.inited) {
      runtime.inited = payload as LxInitedPayload;
    }
    const subs = listeners[event];
    if (subs) for (const fn of subs) fn(payload);
  };
  const on = (event: string, handler: (payload: unknown) => void) => {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(handler);
    if (event === LX_EVENT_NAMES.request) {
      runtime.requestHandler = handler as unknown as LxRequestHandler;
    }
  };

  const lx = {
    EVENT_NAMES: LX_EVENT_NAMES,
    request: lxRequest,
    send,
    on,
    utils: {
      // LX 提供的小工具占位 —— 大多数源不用，遇到调用直接 noop / 透传
      crypto: {
        // 用得最多的是 aesEncrypt / md5 / rsaEncrypt，简化版无加密
        aesEncrypt: (data: string) => data,
        md5: (data: string) => data,
        rsaEncrypt: (data: string) => data,
        randomBytes: (n: number) => new Uint8Array(n),
      },
      buffer: {
        from: (s: string) => new TextEncoder().encode(s),
        bufToString: (b: ArrayBuffer | Uint8Array) =>
          new TextDecoder().decode(b instanceof ArrayBuffer ? new Uint8Array(b) : b),
      },
    },
    env: "ui",
    version: "2.0.0",
    currentScriptInfo: { name: "DouyTV LX runtime", description: "", version: "1.0" },
  };

  // 暴露 globalThis.lx 给 eval 出来的脚本
  const sandbox = {
    globalThis: { lx },
    axios,
    setTimeout,
    setInterval,
    clearTimeout,
    clearInterval,
  };

  const fn = new Function(
    "globalThis",
    "axios",
    "setTimeout",
    "setInterval",
    "clearTimeout",
    "clearInterval",
    '"use strict";\n' + code
  );
  try {
    fn(
      sandbox.globalThis,
      sandbox.axios,
      sandbox.setTimeout,
      sandbox.setInterval,
      sandbox.clearTimeout,
      sandbox.clearInterval
    );
  } catch (e) {
    throw new Error(`LX 脚本执行失败: ${(e as Error).message}`);
  }

  if (!runtime.inited) {
    throw new Error(
      "LX 脚本未上报 inited 事件（未调用 send(EVENT_NAMES.inited, ...)）"
    );
  }
  if (!runtime.requestHandler) {
    throw new Error(
      "LX 脚本未注册 request 处理器（未调用 on(EVENT_NAMES.request, ...)）"
    );
  }
  return runtime;
}

/* ───────────────── 格式识别 + 编译缓存 ───────────────── */

type PluginKind = "musicfree" | "lx";

interface CompiledMusicFree {
  kind: "musicfree";
  hash: string;
  plugin: MusicFreePlugin;
}
interface CompiledLx {
  kind: "lx";
  hash: string;
  runtime: LxRuntime;
}
type Compiled = CompiledMusicFree | CompiledLx;

const compiledCache = new Map<string, Compiled>();

function hashCode(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

function detectKind(code: string): PluginKind {
  // 启发式：LX 脚本必然引用 globalThis.lx 或 EVENT_NAMES
  if (
    /globalThis\.lx\b/.test(code) ||
    /\bEVENT_NAMES\b/.test(code) ||
    /send\s*\(\s*['"]inited['"]/.test(code)
  ) {
    return "lx";
  }
  return "musicfree";
}

function compile(code: string, opts?: { pluginId?: string }): Compiled {
  const kind = detectKind(code);
  const hash = hashCode(code);
  if (kind === "lx") {
    return { kind: "lx", hash, runtime: compileLxScript(code) };
  }
  return { kind: "musicfree", hash, plugin: compileMusicFree(code, opts) };
}

function getCompiled(cfg: PluginBackend): Compiled {
  const cached = compiledCache.get(cfg.id);
  const h = hashCode(cfg.code);
  if (cached && cached.hash === h) return cached;
  const fresh = compile(cfg.code, { pluginId: cfg.id });
  compiledCache.set(cfg.id, fresh);
  return fresh;
}

/* ───────────────── Runtime 工厂 ───────────────── */

function normalizeMusicItem(
  raw: Record<string, unknown>,
  platform: string
): MusicSong | undefined {
  const id =
    (raw.id as string | number | undefined) ??
    (raw.songId as string | number | undefined) ??
    (raw.songmid as string | number | undefined) ??
    (raw.musicId as string | number | undefined);
  if (id === undefined || id === null) return undefined;
  const title = (raw.title as string | undefined) ?? (raw.name as string | undefined);
  if (!title) return undefined;
  return {
    songId: String(id),
    source: platform as MusicSource,
    name: title,
    artist: (raw.artist as string | undefined) ?? (raw.singer as string | undefined),
    album: (raw.album as string | undefined) ?? (raw.albumName as string | undefined),
    cover: (raw.artwork as string | undefined) ?? (raw.cover as string | undefined),
    durationSec: typeof raw.duration === "number" ? raw.duration : undefined,
  };
}

function toMusicFreeItem(song: MusicSong): Record<string, unknown> {
  return {
    id: song.songId,
    songId: song.songId,
    songmid: song.songmid,
    title: song.name,
    artist: song.artist,
    album: song.album,
    artwork: song.cover,
    duration: song.durationSec,
    platform: song.source,
  };
}

function toLxMusicInfo(song: MusicSong): Record<string, unknown> {
  // LX 脚本约定 musicInfo 含 songmid / hash / albumId / songId 等多种 id
  return {
    songId: song.songId,
    songmid: song.songmid ?? song.songId,
    hash: song.hash ?? song.songId,
    albumId: song.albumId,
    name: song.name,
    title: song.name,
    singer: song.artist,
    albumName: song.album,
    interval: song.durationSec,
    source: song.source,
  };
}

function buildMusicFreeRuntime(
  _cfg: PluginBackend,
  plugin: MusicFreePlugin
): MusicBackendRuntime {
  const platform = plugin.platform;
  return {
    kind: "plugin",
    capabilities: {
      search: !!plugin.search,
      parse: !!plugin.getMediaSource,
      lyrics: !!plugin.getLyric,
      toplists: !!plugin.getTopLists,
      playlists: !!plugin.getMusicSheetInfo,
      albums: !!plugin.getAlbumInfo,
      artists: !!plugin.getArtistWorks,
      recommendSheets: !!plugin.getRecommendSheetTags || !!plugin.getRecommendSheetsByTag,
      comments: !!plugin.getMusicComments,
      hotSearch: false,
      multiTypeSearch:
        Array.isArray(plugin.supportedSearchType) && plugin.supportedSearchType.length > 1,
    },
    userVariablesSchema: Array.isArray(plugin.userVariables)
      ? plugin.userVariables
          .filter((v) => v && typeof v.key === "string")
          .map((v) => ({ key: v.key, name: v.name, hint: v.hint }))
      : undefined,
    search: async (args: BackendSearchArgs): Promise<BackendSearchResult> => {
      if (!plugin.search) throw new Error("插件未实现 search()");
      const r = await plugin.search(args.keyword, args.page, "music");
      const list = (r.data ?? [])
        .map((m) => normalizeMusicItem(m, platform))
        .filter((s): s is MusicSong => !!s);
      return { list, total: list.length, page: args.page, pageSize: args.pageSize };
    },
    parse: async (song: MusicSong, quality: MusicQuality) => {
      if (!plugin.getMediaSource) throw new Error("插件未实现 getMediaSource()");
      const r = await plugin.getMediaSource(toMusicFreeItem(song), quality);
      if (!r?.url) throw new Error("插件未返回播放地址");
      return { url: r.url };
    },
    fetchLyrics: async (song: MusicSong) => {
      if (!plugin.getLyric) return "";
      try {
        const r = await plugin.getLyric(toMusicFreeItem(song));
        return r?.rawLrc ?? "";
      } catch {
        return "";
      }
    },
    getToplists: plugin.getTopLists
      ? async () => {
          const groups = (await plugin.getTopLists!()) ?? [];
          const out: Array<{ id: string; name: string; cover?: string }> = [];
          for (const g of groups) {
            for (const item of g.data ?? []) {
              const id =
                (item.id as string | undefined) ?? (item.title as string | undefined);
              const title = item.title as string | undefined;
              if (!id || !title) continue;
              out.push({
                id,
                name: title,
                cover:
                  (item.coverImg as string | undefined) ??
                  (item.cover as string | undefined),
              });
            }
          }
          return out;
        }
      : undefined,
    getToplistDetail: plugin.getTopListDetail
      ? async (id, page) => {
          const r = await plugin.getTopListDetail!({ id, title: id }, page);
          const songs = (r?.musicList ?? [])
            .map((m) => normalizeMusicItem(m, platform))
            .filter((s): s is MusicSong => !!s);
          return { id, name: r?.title ?? id, songs, isEnd: r?.isEnd };
        }
      : undefined,
    getPlaylistDetail: plugin.getMusicSheetInfo
      ? async (id, page) => {
          const r = await plugin.getMusicSheetInfo!({ id }, page ?? 1);
          const songs = (r?.musicList ?? [])
            .map((m) => normalizeMusicItem(m, platform))
            .filter((s): s is MusicSong => !!s);
          const sheetItem = (r?.sheetItem ?? {}) as Record<string, unknown>;
          return {
            id,
            name: (sheetItem.title as string | undefined) ?? id,
            cover:
              (sheetItem.coverImg as string | undefined) ??
              (sheetItem.cover as string | undefined) ??
              (sheetItem.artwork as string | undefined),
            description: sheetItem.description as string | undefined,
            creator: sheetItem.creator as string | undefined,
            songs,
            isEnd: r?.isEnd,
          };
        }
      : undefined,
    getAlbumDetail: plugin.getAlbumInfo
      ? async (albumId, page) => {
          const r = await plugin.getAlbumInfo!({ id: albumId }, page ?? 1);
          const songs = (r?.musicList ?? [])
            .map((m) => normalizeMusicItem(m, platform))
            .filter((s): s is MusicSong => !!s);
          const albumItem = (r?.albumItem ?? {}) as Record<string, unknown>;
          return {
            id: albumId,
            source: platform,
            name:
              (albumItem.title as string | undefined) ??
              (albumItem.name as string | undefined) ??
              "专辑",
            cover:
              (albumItem.artwork as string | undefined) ??
              (albumItem.cover as string | undefined) ??
              (albumItem.coverImg as string | undefined),
            artist:
              (albumItem.artist as string | undefined) ??
              (albumItem.singer as string | undefined),
            artistId:
              (albumItem.artistId as string | undefined) ??
              (albumItem.singerId as string | undefined),
            description: albumItem.description as string | undefined,
            publishDate: albumItem.publishDate as string | undefined,
            songs,
            isEnd: r?.isEnd,
          };
        }
      : undefined,
    getArtistWorks: plugin.getArtistWorks
      ? async (artistId, page, type) => {
          const r = await plugin.getArtistWorks!({ id: artistId }, page, type);
          if (type === "music") {
            const list = (r.data ?? [])
              .map((m) => normalizeMusicItem(m, platform))
              .filter((s): s is MusicSong => !!s);
            return { type, list, isEnd: r.isEnd } as MusicArtistWorksResult<typeof type>;
          }
          const list = (r.data ?? []).map((a): MusicAlbum => {
            const item = a as Record<string, unknown>;
            return {
              id:
                (item.id as string | undefined) ??
                (item.albumId as string | undefined) ??
                String(item.id ?? ""),
              source: platform,
              name:
                (item.title as string | undefined) ??
                (item.name as string | undefined) ??
                "未命名",
              cover:
                (item.artwork as string | undefined) ??
                (item.cover as string | undefined) ??
                (item.coverImg as string | undefined),
              artist: item.artist as string | undefined,
              artistId: item.artistId as string | undefined,
              publishDate: item.publishDate as string | undefined,
            };
          });
          return { type, list, isEnd: r.isEnd } as MusicArtistWorksResult<typeof type>;
        }
      : undefined,
    getRecommendSheetTags: plugin.getRecommendSheetTags
      ? async () => {
          const r = await plugin.getRecommendSheetTags!();
          const pinned: IRecommendSheetTag[] = (r?.pinned ?? [])
            .map((item) => {
              const it = item as Record<string, unknown>;
              const id = (it.id as string | undefined) ?? (it.title as string | undefined);
              const name = (it.title as string | undefined) ?? (it.name as string | undefined);
              if (!id || !name) return undefined;
              return { id, name };
            })
            .filter((x): x is IRecommendSheetTag => !!x);
          const groups: IRecommendSheetTagGroup[] = (r?.data ?? [])
            .map((g) => {
              const tags: IRecommendSheetTag[] = (g?.data ?? [])
                .map((item) => {
                  const it = item as Record<string, unknown>;
                  const id = (it.id as string | undefined) ?? (it.title as string | undefined);
                  const name = (it.title as string | undefined) ?? (it.name as string | undefined);
                  if (!id || !name) return undefined;
                  return { id, name };
                })
                .filter((x): x is IRecommendSheetTag => !!x);
              return { title: g?.title ?? "标签", tags };
            })
            .filter((g) => g.tags.length > 0);
          return { pinned, groups };
        }
      : undefined,
    getRecommendSheetsByTag: plugin.getRecommendSheetsByTag
      ? async (tagId, page) => {
          const r = await plugin.getRecommendSheetsByTag!({ id: tagId }, page ?? 1);
          const list: IRecommendSheet[] = (r?.data ?? [])
            .map((item): IRecommendSheet | undefined => {
              const it = item as Record<string, unknown>;
              const id =
                (it.id as string | undefined) ??
                (typeof it.id === "number" ? String(it.id) : undefined);
              const name =
                (it.title as string | undefined) ??
                (it.name as string | undefined);
              if (!id || !name) return undefined;
              return {
                id,
                source: platform,
                name,
                cover:
                  (it.artwork as string | undefined) ??
                  (it.coverImg as string | undefined) ??
                  (it.cover as string | undefined),
                description: it.description as string | undefined,
                playCount:
                  typeof it.playCount === "number" ? (it.playCount as number) : undefined,
                creator: it.creator as string | undefined,
              };
            })
            .filter((x): x is IRecommendSheet => !!x);
          return { list, isEnd: r?.isEnd };
        }
      : undefined,
    getMusicComments: plugin.getMusicComments
      ? async (song, page) => {
          const r = await plugin.getMusicComments!(toMusicFreeItem(song), page ?? 1);
          const list: MusicComment[] = (r?.data ?? [])
            .map((item): MusicComment | undefined => {
              const it = item as Record<string, unknown>;
              const id =
                (it.id as string | undefined) ??
                (it.commentId as string | undefined) ??
                (typeof it.id === "number" ? String(it.id) : undefined);
              const user =
                (it.nickName as string | undefined) ??
                (it.user as string | undefined) ??
                (it.name as string | undefined) ??
                "匿名";
              const content =
                (it.content as string | undefined) ??
                (it.comment as string | undefined) ??
                "";
              if (!id) return undefined;
              const reply = it.like as Record<string, unknown> | undefined;
              return {
                id,
                user,
                content,
                avatar: it.avatar as string | undefined,
                publishedAt: typeof it.timestamp === "number" ? (it.timestamp as number) : undefined,
                likeCount: typeof it.likeCount === "number" ? (it.likeCount as number) : undefined,
                reply: reply
                  ? {
                      user: (reply.user as string | undefined) ?? "",
                      content: (reply.content as string | undefined) ?? "",
                    }
                  : undefined,
              };
            })
            .filter((x): x is MusicComment => !!x);
          return { list, isEnd: r?.isEnd };
        }
      : undefined,
    fetchTranslatedLyrics: plugin.getLyric
      ? async (song) => {
          try {
            const r = await plugin.getLyric!(toMusicFreeItem(song));
            return r?.translation ?? "";
          } catch {
            return "";
          }
        }
      : undefined,
    getMusicInfo: plugin.getMusicInfo
      ? async (song) => {
          const r = await plugin.getMusicInfo!(toMusicFreeItem(song));
          if (!r) return {};
          const item = r as Record<string, unknown>;
          return {
            cover:
              (item.artwork as string | undefined) ??
              (item.cover as string | undefined),
            album: item.album as string | undefined,
            albumId: item.albumId as string | undefined,
            artistId: item.artistId as string | undefined,
            lrcUrl: item.lrc as string | undefined,
            durationSec:
              typeof item.duration === "number" ? (item.duration as number) : undefined,
          };
        }
      : undefined,
    importMusicSheet: plugin.importMusicSheet
      ? async (url) => {
          const r = await plugin.importMusicSheet!(url);
          return (r ?? [])
            .map((m) => normalizeMusicItem(m, platform))
            .filter((s): s is MusicSong => !!s);
        }
      : undefined,
    importMusicItem: plugin.importMusicItem
      ? async (url) => {
          const r = await plugin.importMusicItem!(url);
          if (!r) return null;
          return normalizeMusicItem(r, platform) ?? null;
        }
      : undefined,
  };
}

function buildLxRuntime(_cfg: PluginBackend, runtime: LxRuntime): MusicBackendRuntime {
  const sources = runtime.inited?.sources ?? {};
  const sourceIds = Object.keys(sources);
  const hasLyric = sourceIds.some((s) =>
    (sources[s]?.actions ?? []).includes("lyric")
  );

  return {
    kind: "plugin",
    capabilities: {
      search: false,
      parse: true,
      lyrics: hasLyric,
      toplists: false,
      playlists: false,
      albums: false,
      artists: false,
      recommendSheets: false,
      comments: false,
      hotSearch: false,
      multiTypeSearch: false,
    },
    search: async () => {
      throw new Error(
        "LX 源不支持搜索 —— 请用 MusicApi/LX-Server backend 搜索，切到此源仅做 URL 解析"
      );
    },
    parse: async (song, quality) => {
      const source = song.source;
      const sourceInfo = sources[source];
      if (!sourceInfo) {
        throw new Error(
          `LX 源未声明支持平台「${source}」（脚本仅声明: ${sourceIds.join(", ")}）`
        );
      }
      // type 形如 "128k" | "320k" | "flac" —— 与 MusicQuality 对齐
      const type = quality;
      const url = (await runtime.invoke(source, "musicUrl", {
        musicInfo: toLxMusicInfo(song),
        type,
      })) as string | undefined;
      if (!url || typeof url !== "string") {
        throw new Error("LX 源未返回 URL（可能版权限制 / 平台风控）");
      }
      return { url };
    },
    fetchLyrics: hasLyric
      ? async (song) => {
          try {
            const result = (await runtime.invoke(song.source, "lyric", {
              musicInfo: toLxMusicInfo(song),
            })) as { lyric?: string; tlyric?: string; lxlyric?: string } | string | undefined;
            if (!result) return "";
            if (typeof result === "string") return result;
            return result.lyric ?? "";
          } catch {
            return "";
          }
        }
      : undefined,
  };
}

export function createPluginRuntime(cfg: PluginBackend): MusicBackendRuntime {
  const compiled = getCompiled(cfg);
  if (compiled.kind === "lx") return buildLxRuntime(cfg, compiled.runtime);
  return buildMusicFreeRuntime(cfg, compiled.plugin);
}

/* ───────────────── 元信息探测（设置页添加时用） ───────────────── */

export function describePlugin(code: string): {
  platform: string;
  version?: string;
  format: PluginKind;
  sources?: string[];
  userVariables?: Array<{ key: string; name?: string; hint?: string }>;
  capabilities?: string[];
} {
  const kind = detectKind(code);
  if (kind === "lx") {
    const r = compileLxScript(code);
    const sourceIds = Object.keys(r.inited?.sources ?? {});
    return {
      platform: `lx:${sourceIds.join(",") || "?"}`,
      version: undefined,
      format: "lx",
      sources: sourceIds,
    };
  }
  const p = compileMusicFree(code);
  const caps: string[] = [];
  if (p.search) caps.push("搜索");
  if (p.getMediaSource) caps.push("解析");
  if (p.getLyric) caps.push("歌词");
  if (p.getTopLists) caps.push("榜单");
  if (p.getMusicSheetInfo) caps.push("歌单");
  if (p.getAlbumInfo) caps.push("专辑");
  if (p.getArtistWorks) caps.push("歌手");
  if (p.getRecommendSheetTags || p.getRecommendSheetsByTag) caps.push("推荐");
  if (p.getMusicComments) caps.push("评论");
  return {
    platform: p.platform,
    version: p.version,
    format: "musicfree",
    userVariables: Array.isArray(p.userVariables)
      ? p.userVariables.filter((v) => v && typeof v.key === "string")
      : undefined,
    capabilities: caps,
  };
}

/* ───────────────── 插件订阅列表（MusicFree myPlugins.json） ───────────────── */

export interface PluginListEntry {
  name: string;
  url: string;
  version?: string;
  description?: string;
}

/**
 * 解析 MusicFree 订阅 JSON 的两种常见 schema：
 *   1. { plugins: [{ name, url, version? }] }
 *   2. 直接 [{ name, url, version? }]
 */
export function parsePluginList(jsonText: string): PluginListEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("不是有效 JSON");
  }
  const raw =
    Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { plugins?: unknown[] }).plugins)
        ? (parsed as { plugins: unknown[] }).plugins
        : null;
  if (!raw) throw new Error("订阅 JSON 缺少 plugins 数组");
  const out: PluginListEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    const url = it.url as string | undefined;
    const name = (it.name as string | undefined) ?? (it.platform as string | undefined);
    if (!url || !name) continue;
    out.push({
      name,
      url,
      version: it.version as string | undefined,
      description: it.description as string | undefined,
    });
  }
  return out;
}
