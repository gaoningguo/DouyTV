/**
 * listen1 源 backend —— 适配 listen1 (Listen1 / listen1-chrome-extension / listen1-mobile) 系生态的 JS 源。
 *
 * listen1 协议在不同 fork 中差异较大，本实现按"最大公约数"做：
 *
 *   1. 沙盒 eval 源码，期望源码注册一个 provider 对象（多种习惯位置都试一遍）：
 *        - module.exports = { search, lyric, parse_url, get_track, ... }
 *        - globalThis.l1 = { ... }
 *        - return { ... } （IIFE/match 形态）
 *   2. 调用 `provider.search(keyword, page) → Promise<Track[]>` 或老式
 *        `provider.search({ keyword, curpage, type, callback })`（兼容回调形态）。
 *   3. 调用 `provider.bootstrap_track(track) / parse_url(...) → Promise<url>` 拿播放 URL。
 *   4. 调用 `provider.lyric(track) → Promise<{ lyric }>` 拿歌词；不存在则返回空。
 *
 * 不支持的能力（榜单 / 歌单详情 / 专辑 / 艺人）在本端 throw "listen1 backend 未实现 X"，
 * UI 通过 capabilities 关闭入口避免触发。
 *
 * 注：仅做框架适配，不同 listen1 fork 的兼容性差异大；遇到不工作的源建议用「MusicFree 插件」backend
 * 或自托管 NCM。
 */
import { scriptFetch } from "@/source-script/fetch";
import type { MusicQuality, MusicSong } from "../types";
import type {
  BackendSearchArgs,
  BackendSearchResult,
  Listen1Backend,
  MusicBackendRuntime,
} from "./types";

interface Listen1Track {
  id?: string | number;
  title?: string;
  name?: string;
  artist?: string | Array<{ name?: string }>;
  artists?: Array<{ name?: string }>;
  artist_id?: string;
  album?: string;
  album_id?: string;
  img_url?: string;
  cover?: string;
  source?: string;
  source_url?: string;
  url?: string;
  duration?: number;
  lyric?: string;
}

interface Listen1Provider {
  search?:
    | ((keyword: string, page: number) => Promise<Listen1Track[] | { result?: Listen1Track[]; total?: number }>)
    | ((args: {
        keyword: string;
        curpage?: number;
        type?: string;
        callback?: (data: { result?: Listen1Track[]; total?: number }) => void;
      }) => unknown);
  bootstrap_track?: (track: Listen1Track) => Promise<{ url?: string } | string>;
  parse_url?: (track: Listen1Track) => Promise<{ url?: string } | string>;
  lyric?: (track: Listen1Track) => Promise<{ lyric?: string } | string>;
  // 其它能力暂不消费
  [k: string]: unknown;
}

function callbackToPromise<T>(
  invoke: (cb: (data: T) => void) => void
): Promise<T> {
  return new Promise((resolve, reject) => {
    let done = false;
    const cb = (data: T) => {
      if (done) return;
      done = true;
      resolve(data);
    };
    try {
      invoke(cb);
    } catch (e) {
      done = true;
      reject(e);
    }
  });
}

function toMusicSong(t: Listen1Track, fallbackSource: string): MusicSong | null {
  const id = t.id;
  const name = t.title ?? t.name;
  if (id === undefined || !name) return null;
  const artist = Array.isArray(t.artist)
    ? t.artist.map((a) => a?.name).filter(Boolean).join(" / ")
    : t.artist ?? t.artists?.map((a) => a?.name).filter(Boolean).join(" / ");
  return {
    songId: String(id),
    source: (t.source ?? fallbackSource) as MusicSong["source"],
    name,
    artist: artist || undefined,
    album: t.album,
    albumId: t.album_id,
    cover: t.img_url ?? t.cover,
    durationSec:
      typeof t.duration === "number"
        ? t.duration > 1000
          ? Math.floor(t.duration / 1000)
          : t.duration
        : undefined,
  };
}

function loadListen1Provider(code: string): Listen1Provider {
  const moduleObj: { exports: Listen1Provider } = { exports: {} };
  const globals: Record<string, unknown> = {
    l1: undefined,
    listen1: undefined,
    provider: undefined,
  };
  // 简易 fetch shim（listen1 chrome 扩展用 $.ajax / fetch，这里只覆盖 fetch）
  const fetchShim = async (url: string, init?: RequestInit) => {
    const res = await scriptFetch(url, {
      method: (init?.method as string) ?? "GET",
      headers: (init?.headers as Record<string, string>) ?? undefined,
      body: typeof init?.body === "string" ? init.body : undefined,
      timeout: 30_000,
    });
    return {
      ok: res.ok,
      status: res.status,
      text: () => res.text(),
      json: () => res.json(),
    };
  };
  try {
    // eslint-disable-next-line no-new-func
    const factory = new Function(
      "module",
      "exports",
      "globalThis",
      "fetch",
      "console",
      code + "\n;return module.exports || globalThis.l1 || globalThis.listen1 || globalThis.provider;"
    );
    const ret = factory(
      moduleObj,
      moduleObj.exports,
      globals as unknown,
      fetchShim,
      console
    ) as Listen1Provider | undefined;
    const provider =
      ret ??
      moduleObj.exports ??
      (globals.l1 as Listen1Provider | undefined) ??
      (globals.listen1 as Listen1Provider | undefined) ??
      (globals.provider as Listen1Provider | undefined);
    if (!provider || typeof provider !== "object") {
      throw new Error("listen1 源未导出 provider（期望 module.exports / globalThis.l1 / 直接 return）");
    }
    return provider;
  } catch (e) {
    throw new Error(`listen1 源加载失败：${(e as Error).message}`);
  }
}

export function createListen1Runtime(cfg: Listen1Backend): MusicBackendRuntime {
  if (!cfg.code) throw new Error("listen1 源代码为空");
  const provider = loadListen1Provider(cfg.code);

  async function search(args: BackendSearchArgs): Promise<BackendSearchResult> {
    if (typeof provider.search !== "function") {
      throw new Error("listen1 源未实现 search()");
    }
    let raw: Listen1Track[] | { result?: Listen1Track[]; total?: number } | undefined;
    try {
      // 试 promise 形态：search(keyword, page)
      const fn = provider.search as (
        ...a: unknown[]
      ) => Promise<Listen1Track[] | { result?: Listen1Track[]; total?: number }> | unknown;
      const maybe = fn(args.keyword, args.page);
      if (maybe && typeof (maybe as Promise<unknown>).then === "function") {
        raw = (await (maybe as Promise<typeof raw>)) ?? undefined;
      } else if (typeof maybe === "object" && maybe !== null) {
        raw = maybe as typeof raw;
      } else {
        // 回退到回调形态：search({ keyword, curpage, callback })
        raw = await callbackToPromise<{ result?: Listen1Track[]; total?: number }>(
          (cb) => {
            const fn2 = provider.search as (a: {
              keyword: string;
              curpage?: number;
              callback: typeof cb;
            }) => unknown;
            fn2({ keyword: args.keyword, curpage: args.page, callback: cb });
          }
        );
      }
    } catch (e) {
      throw new Error(`listen1 search 失败：${(e as Error).message}`);
    }
    const tracks = Array.isArray(raw)
      ? raw
      : (raw && Array.isArray((raw as { result?: Listen1Track[] }).result)
          ? (raw as { result: Listen1Track[] }).result
          : []);
    const total = Array.isArray(raw)
      ? raw.length
      : (raw as { total?: number })?.total ?? tracks.length;
    const list = tracks
      .map((t) => toMusicSong(t, "wy"))
      .filter((x): x is MusicSong => !!x);
    return {
      list,
      total,
      page: args.page,
      pageSize: args.pageSize,
    };
  }

  async function parse(song: MusicSong, _quality: MusicQuality) {
    const fn = provider.parse_url ?? provider.bootstrap_track;
    if (typeof fn !== "function") {
      throw new Error("listen1 源未实现 parse_url / bootstrap_track");
    }
    const track: Listen1Track = {
      id: song.songId,
      title: song.name,
      artist: song.artist,
      album: song.album,
      source: song.source,
    };
    const ret = await (fn as (t: Listen1Track) => Promise<{ url?: string } | string>)(track);
    const url = typeof ret === "string" ? ret : ret?.url;
    if (!url) throw new Error("listen1 源未返回播放 URL");
    return { url };
  }

  async function fetchLyrics(song: MusicSong): Promise<string> {
    if (typeof provider.lyric !== "function") return "";
    try {
      const ret = await provider.lyric({
        id: song.songId,
        title: song.name,
        artist: song.artist,
        source: song.source,
      });
      return typeof ret === "string" ? ret : ret?.lyric ?? "";
    } catch {
      return "";
    }
  }

  return {
    kind: "listen1",
    capabilities: {
      search: typeof provider.search === "function",
      parse: typeof (provider.parse_url ?? provider.bootstrap_track) === "function",
      lyrics: typeof provider.lyric === "function",
      toplists: false,
      playlists: false,
      albums: false,
      artists: false,
      recommendSheets: false,
      comments: false,
      hotSearch: false,
      multiTypeSearch: false,
    },
    search,
    parse,
    fetchLyrics,
  };
}
