/**
 * lx-music-api-server backend。
 *
 * 参考 lyswhut/lx-music-api-server 默认 HTTP 路由（v2.x 起）：
 *   POST {base}/url/{source}/{songId}/{quality}   → 拉取播放 URL
 *   POST {base}/lyric/{source}/{songId}            → 歌词 (lrc 字段)
 *   POST {base}/pic/{source}/{songId}              → 封面 URL
 *   POST {base}/search?source=&keyword=&page=      → （可选，部分 build 启用）
 *   POST {base}/info/{source}/{songId}             → 元数据
 *
 * 鉴权：Header `X-LX-AUTH` = SHA256(authKey + timestamp) 或固定 token，本实现按"固定 token"
 * 处理（也就是把用户填的 authKey 原样塞进 header，多数轻量部署够用）。
 *
 * **限制**：上游 server 视 build 不同，可能没有 /search、/toplist —— DouyTV 在 capabilities
 * 里关闭这些功能，UI 自适应隐藏。
 */
import { scriptFetch } from "@/source-script/fetch";
import type { MusicQuality, MusicSong, MusicSource } from "../types";
import type {
  BackendSearchArgs,
  BackendSearchResult,
  LxMusicBackend,
  MusicBackendRuntime,
} from "./types";

const LX_QUALITY_MAP: Record<MusicQuality, string> = {
  "128k": "128k",
  "192k": "192k",
  "320k": "320k",
  flac: "flac",
};

function lxHeaders(cfg: LxMusicBackend): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.authKey) h["X-LX-AUTH"] = cfg.authKey;
  return h;
}

interface LxStdResponse<T> {
  code?: number;
  msg?: string;
  message?: string;
  data?: T;
}

export function createLxMusicRuntime(
  cfg: LxMusicBackend,
  defaultPlatform: MusicSource
): MusicBackendRuntime {
  const baseUrl = cfg.baseUrl.replace(/\/+$/, "");
  if (!baseUrl) throw new Error("LX-Music server 地址未配置");

  async function postJson<T>(path: string, body?: unknown): Promise<T> {
    const res = await scriptFetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: lxHeaders(cfg),
      json: body ?? {},
      timeout: 30_000,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = await res.json<LxStdResponse<T>>();
    if (parsed.code !== undefined && parsed.code !== 0 && parsed.code !== 200) {
      throw new Error(parsed.message || parsed.msg || `LX code ${parsed.code}`);
    }
    return parsed.data as T;
  }

  async function search(args: BackendSearchArgs): Promise<BackendSearchResult> {
    // /search 端点在 lx-music-api-server "完整版" build 才有。失败时抛错给 UI 处理。
    const data = await postJson<{
      list?: Array<Record<string, unknown>>;
      total?: number;
    }>("/search", {
      source: defaultPlatform,
      keyword: args.keyword,
      page: args.page,
      limit: args.pageSize,
    });
    const list: MusicSong[] = (data?.list ?? [])
      .map((r): MusicSong | undefined => {
        const id =
          (r.songId as string | number | undefined) ??
          (r.id as string | number | undefined) ??
          (r.songmid as string | number | undefined) ??
          (r.hash as string | undefined);
        if (id === undefined || id === null) return undefined;
        const name = r.name as string | undefined;
        if (!name) return undefined;
        const singer = Array.isArray(r.singer)
          ? (r.singer as Array<{ name?: string }>)
              .map((s) => s?.name)
              .filter(Boolean)
              .join(" / ")
          : (r.singer as string | undefined);
        return {
          songId: String(id),
          source: defaultPlatform,
          name,
          artist: singer,
          album: (r.albumName as string | undefined) ?? (r.album as string | undefined),
          cover: (r.img as string | undefined) ?? (r.pic as string | undefined),
          songmid: r.songmid as string | undefined,
          hash: r.hash as string | undefined,
          albumId: r.albumId as string | undefined,
          durationSec:
            typeof r.interval === "number" ? (r.interval as number) : undefined,
        };
      })
      .filter((s): s is MusicSong => !!s);
    return {
      list,
      total: data?.total ?? list.length,
      page: args.page,
      pageSize: args.pageSize,
    };
  }

  async function parse(song: MusicSong, quality: MusicQuality) {
    const q = LX_QUALITY_MAP[quality] ?? "320k";
    // 标准端点：POST /url/{source}/{id}/{quality}，body 可空
    const url = `${baseUrl}/url/${encodeURIComponent(song.source)}/${encodeURIComponent(song.songId)}/${q}`;
    const res = await scriptFetch(url, {
      method: "POST",
      headers: lxHeaders(cfg),
      json: {},
      timeout: 30_000,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = await res.json<LxStdResponse<string | { url: string }>>();
    if (parsed.code !== undefined && parsed.code !== 0 && parsed.code !== 200) {
      throw new Error(parsed.message || parsed.msg || `LX code ${parsed.code}`);
    }
    const data = parsed.data;
    const playUrl =
      typeof data === "string" ? data : data?.url ?? "";
    if (!playUrl) throw new Error("LX server 未返回播放地址");
    return { url: playUrl };
  }

  async function fetchLyrics(song: MusicSong): Promise<string> {
    try {
      const url = `${baseUrl}/lyric/${encodeURIComponent(song.source)}/${encodeURIComponent(song.songId)}`;
      const res = await scriptFetch(url, {
        method: "POST",
        headers: lxHeaders(cfg),
        json: {},
        timeout: 15_000,
      });
      if (!res.ok) return "";
      const parsed = await res.json<LxStdResponse<{ lyric?: string }>>();
      return parsed.data?.lyric ?? "";
    } catch {
      return "";
    }
  }

  return {
    kind: "lxmusic",
    // 默认 build 不带榜单 / 歌单详情；用户用增强 build 可手动改这里
    capabilities: {
      search: true,
      parse: true,
      lyrics: true,
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
