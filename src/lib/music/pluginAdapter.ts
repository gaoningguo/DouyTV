import { scriptFetch } from "@/source-script/fetch";
import type {
  MusicLyricResult,
  MusicPlayResult,
  MusicQuality,
  MusicSearchResult,
  MusicSong,
  MusicSourceDescriptor,
} from "./types";
import { parseDurationToSec } from "./types";
import {
  asNumber,
  asRecord,
  asString,
  readPath,
  unwrapArray,
} from "./utils";

type PluginObject = Record<string, unknown>;
type PluginFunction = (...args: unknown[]) => unknown | Promise<unknown>;

const pluginCache = new Map<string, PluginObject>();

function transformExports(code: string): string {
  return code
    .replace(/export\s+default\s+/g, "module.exports = ")
    .replace(/export\s+const\s+(\w+)\s*=/g, "exports.$1 =")
    .replace(/export\s+function\s+(\w+)\s*\(/g, "exports.$1 = function $1(");
}

async function fetchLike(url: string, init?: RequestInit) {
  const headers: Record<string, string> = {};
  init?.headers &&
    new Headers(init.headers).forEach((value, key) => {
      headers[key] = value;
    });
  const res = await scriptFetch(url, {
    method: init?.method,
    headers,
    body: typeof init?.body === "string" ? init.body : undefined,
    timeout: 15000,
  });
  return {
    ok: res.ok,
    status: res.status,
    headers: res.headers,
    url: res.url,
    text: res.text,
    json: res.json,
  };
}

async function axiosLike(configOrUrl: string | Record<string, unknown>) {
  const config =
    typeof configOrUrl === "string" ? { url: configOrUrl } : configOrUrl;
  const url = asString(config.url);
  if (!url) throw new Error("missing url");
  const headers = asRecord(config.headers) as Record<string, string> | undefined;
  const method = asString(config.method) || "GET";
  const data = config.data ?? config.body;
  const res = await scriptFetch(url, {
    method,
    headers,
    json: data && typeof data === "object" ? data : undefined,
    body: typeof data === "string" ? data : undefined,
    timeout: asNumber(config.timeout) ?? 15000,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return {
    data: parsed,
    status: res.status,
    headers: res.headers,
    request: { responseURL: res.url },
  };
}

axiosLike.get = (url: string, config?: Record<string, unknown>) =>
  axiosLike({ ...(config ?? {}), url, method: "GET" });
axiosLike.post = (
  url: string,
  data?: unknown,
  config?: Record<string, unknown>
) => axiosLike({ ...(config ?? {}), url, data, method: "POST" });

function requireLike(name: string): unknown {
  if (name === "axios") return axiosLike;
  if (name === "crypto-js" || name === "crypto") return {};
  throw new Error(`插件依赖 ${name} 暂未内置`);
}

function loadPlugin(source: MusicSourceDescriptor): PluginObject {
  const cacheKey = `${source.id}:${source.updatedAt ?? 0}`;
  const cached = pluginCache.get(cacheKey);
  if (cached) return cached;
  if (!source.code?.trim()) throw new Error("插件源码为空");

  const module = { exports: {} as PluginObject };
  const exports = module.exports;
  const code = transformExports(source.code);
  const runner = new Function(
    "module",
    "exports",
    "fetch",
    "axios",
    "request",
    "require",
    "console",
    `${code}\n;return module.exports && Object.keys(module.exports).length ? module.exports : exports;`
  ) as (
    module: { exports: PluginObject },
    exports: PluginObject,
    fetch: typeof fetchLike,
    axios: typeof axiosLike,
    request: typeof axiosLike,
    require: typeof requireLike,
    console: Console
  ) => unknown;
  const exported = runner(
    module,
    exports,
    fetchLike,
    axiosLike,
    axiosLike,
    requireLike,
    console
  );
  const plugin = asRecord(exported) ?? asRecord(module.exports);
  if (!plugin) throw new Error("插件没有导出可用对象");
  pluginCache.set(cacheKey, plugin);
  return plugin;
}

function methodOf(plugin: PluginObject, names: string[]): PluginFunction | undefined {
  for (const name of names) {
    const fn = plugin[name];
    if (typeof fn === "function") return fn as PluginFunction;
  }
  return undefined;
}

async function callSearch(fn: PluginFunction, keyword: string, page: number, limit: number) {
  const attempts: unknown[][] = [
    [keyword, page, limit],
    [keyword, page, "music"],
    [keyword, page, "song"],
    [{ keyword, page, limit }],
    [{ query: keyword, page, limit }],
    [{ keyword, page, type: "music", limit }],
    [keyword, { page, limit }],
  ];
  let lastError: unknown;
  for (const args of attempts) {
    try {
      const payload = await fn(...args);
      if (unwrapArray(payload).length > 0 || asRecord(payload)) return payload;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error("插件搜索没有返回结果");
}

function pickString(item: unknown, paths: Array<string | undefined>): string | undefined {
  for (const path of paths) {
    const value = asString(readPath(item, path));
    if (value) return value;
  }
  return undefined;
}

function normalizePluginSong(
  source: MusicSourceDescriptor,
  item: unknown
): MusicSong | null {
  const map = source.fieldMap ?? {};
  const id = pickString(item, [
    map.id,
    "id",
    "songId",
    "musicId",
    "songmid",
    "mid",
    "hash",
  ]);
  const title = pickString(item, [
    map.title,
    "title",
    "name",
    "songName",
    "musicName",
  ]);
  if (!id || !title) return null;
  const durationText = pickString(item, [
    map.durationText,
    "durationText",
    "interval",
    "duration",
  ]);
  const durationSec =
    asNumber(readPath(item, map.durationSec)) ??
    asNumber(readPath(item, "duration")) ??
    parseDurationToSec(durationText);
  return {
    id,
    sourceId: source.id,
    sourceName: source.name,
    title,
    artist:
      pickString(item, [map.artist, "artist", "singer", "author"]) || "未知歌手",
    album: pickString(item, [map.album, "album", "albumName"]),
    cover: pickString(item, [map.cover, "cover", "pic", "img", "artwork"]),
    durationText,
    durationSec,
    platform: pickString(item, [map.platform, "source", "platform"]) || source.id,
    songmid: pickString(item, [map.songmid, "songmid", "mid"]),
    directUrl: pickString(item, [map.url, "url", "playUrl", "src"]),
    lrcUrl: pickString(item, [map.lrc, "lrcUrl"]),
    trcUrl: pickString(item, [map.tlyric, "trcUrl", "tlyricUrl"]),
    raw: item,
  };
}

export async function searchPlugin(
  source: MusicSourceDescriptor,
  keyword: string,
  page: number,
  limit: number
): Promise<MusicSearchResult> {
  const plugin = loadPlugin(source);
  const search = methodOf(plugin, [
    "search",
    "musicSearch",
    "searchMusic",
    "searchSongs",
    "searchSong",
    "getSearch",
    "getSearchMusic",
    "getMusicList",
  ]);
  if (!search) throw new Error("插件没有提供搜索方法");
  const payload = await callSearch(search, keyword, page, limit);
  const list = unwrapArray<unknown>(payload, source.itemPath)
    .map((item) => normalizePluginSong(source, item))
    .filter((item): item is MusicSong => !!item);
  return {
    list,
    page,
    limit,
    hasMore: list.length >= limit,
  };
}

async function callResolve(
  fn: PluginFunction,
  song: MusicSong,
  quality: MusicQuality
): Promise<unknown> {
  const attempts: unknown[][] = [
    [song.raw ?? song, quality],
    [song, quality],
    [{ ...song, quality }],
    [song.id, quality],
  ];
  let lastError: unknown;
  for (const args of attempts) {
    try {
      const payload = await fn(...args);
      if (payload) return payload;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error("插件没有返回播放地址");
}

function normalizePlayPayload(payload: unknown): string | undefined {
  if (typeof payload === "string") return payload;
  const record = asRecord(payload);
  const data = asRecord(record?.data) ?? record;
  return (
    asString(data?.url) ||
    asString(data?.playUrl) ||
    asString(data?.src) ||
    asString(data?.file)
  );
}

function normalizeLyric(payload: unknown): MusicLyricResult {
  if (typeof payload === "string") return { lyric: payload };
  const record = asRecord(payload);
  const data = asRecord(record?.data) ?? record;
  return {
    lyric: asString(data?.lyric) || asString(data?.lrc) || "",
    tlyric: asString(data?.tlyric) || asString(data?.trc),
  };
}

export async function resolvePlugin(
  source: MusicSourceDescriptor,
  song: MusicSong,
  quality: MusicQuality
): Promise<MusicPlayResult> {
  const plugin = loadPlugin(source);
  const resolver = methodOf(plugin, [
    "getMediaSource",
    "getMusicUrl",
    "getMusicSource",
    "getMusicInfo",
    "getSongUrl",
    "musicUrl",
    "playUrl",
    "resolve",
    "getUrl",
  ]);
  let directUrl = song.directUrl;
  if (!directUrl) {
    if (!resolver) throw new Error("插件没有提供播放地址方法");
    directUrl = normalizePlayPayload(await callResolve(resolver, song, quality));
  }
  if (!directUrl) throw new Error("插件没有返回播放地址");

  let lyric: MusicLyricResult = { lyric: "" };
  const lyricMethod = methodOf(plugin, [
    "getLyric",
    "lyric",
    "getMusicLyric",
    "getLyricContent",
  ]);
  if (lyricMethod) {
    try {
      lyric = normalizeLyric(await callResolve(lyricMethod, song, quality));
    } catch {
      lyric = { lyric: "" };
    }
  }
  return {
    url: directUrl,
    directUrl,
    quality,
    lyric: lyric.lyric,
    tlyric: lyric.tlyric,
  };
}
