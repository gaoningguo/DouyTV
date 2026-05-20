/**
 * MusicApi-V2 backend —— 从之前的 lib/music/client.ts 迁出，保留接口不变。
 */
import { scriptFetch } from "@/source-script/fetch";
import type {
  MusicPlaylistDetail,
  MusicQuality,
  MusicSong,
  MusicSource,
  MusicToplist,
} from "../types";
import type {
  BackendSearchArgs,
  BackendSearchResult,
  MusicApiBackend,
  MusicBackendRuntime,
} from "./types";

interface ApiEnvelope<T> {
  code?: number;
  msg?: string;
  message?: string;
  data?: T;
  list?: unknown;
}

function buildUrl(
  base: string,
  path: string,
  query: Record<string, string | number | undefined>
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") sp.set(k, String(v));
  }
  const qs = sp.toString();
  return `${base.replace(/\/+$/, "")}${path}${qs ? `?${qs}` : ""}`;
}

function pickList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.list)) return obj.list;
    if (Array.isArray(obj.data)) return obj.data;
    if (Array.isArray(obj.songs)) return obj.songs;
    if (Array.isArray(obj.tracks)) return obj.tracks;
    if (Array.isArray(obj.items)) return obj.items;
  }
  return [];
}

function normalizeSong(
  raw: Record<string, unknown>,
  source: MusicSource
): MusicSong | undefined {
  const id =
    (raw.id as string | number | undefined) ??
    (raw.songId as string | number | undefined) ??
    (raw.songmid as string | number | undefined);
  if (id === undefined || id === null) return undefined;
  const name = (raw.name as string | undefined) ?? (raw.title as string | undefined);
  if (!name) return undefined;
  const artist = Array.isArray(raw.artists)
    ? (raw.artists as Array<{ name?: string }>)
        .map((a) => a?.name)
        .filter(Boolean)
        .join(" / ")
    : (raw.artist as string | undefined) ??
      (raw.singer as string | undefined) ??
      (raw.singers as string | undefined);
  return {
    songId: String(id),
    source,
    songmid: raw.songmid as string | undefined,
    name,
    artist: artist || undefined,
    album:
      (raw.album as string | undefined) ??
      ((raw.album as { name?: string } | undefined) as { name?: string } | undefined)?.name,
    cover:
      (raw.cover as string | undefined) ??
      (raw.pic as string | undefined) ??
      (raw.picUrl as string | undefined) ??
      (raw.albumPic as string | undefined),
    durationSec:
      (raw.duration as number | undefined) ??
      (raw.durationSec as number | undefined) ??
      (typeof raw.dt === "number" ? raw.dt / 1000 : undefined),
    durationText: raw.durationText as string | undefined,
    hash: raw.hash as string | undefined,
    copyrightId: raw.copyrightId as string | undefined,
    albumId: raw.albumId as string | undefined,
    lrcUrl: raw.lrcUrl as string | undefined,
    mrcUrl: raw.mrcUrl as string | undefined,
    trcUrl: raw.trcUrl as string | undefined,
  };
}

export function createMusicApiRuntime(
  cfg: MusicApiBackend,
  defaultPlatform: MusicSource
): MusicBackendRuntime {
  const baseUrl = cfg.baseUrl.replace(/\/+$/, "");
  if (!baseUrl) throw new Error("MusicApi-V2 服务地址未配置");

  async function search(args: BackendSearchArgs): Promise<BackendSearchResult> {
    const url = buildUrl(baseUrl, "/v1/search", {
      platform: defaultPlatform,
      keyword: args.keyword,
      page: args.page,
      pageSize: args.pageSize,
      limit: args.pageSize,
    });
    const res = await scriptFetch(url, { method: "GET", timeout: 30_000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json<ApiEnvelope<unknown>>();
    const rawList = pickList(body.data ?? body);
    const list = rawList
      .map((r) => normalizeSong(r as Record<string, unknown>, defaultPlatform))
      .filter((s): s is MusicSong => !!s);
    const totalRaw = (body.data as { total?: number } | undefined)?.total;
    return {
      list,
      total: typeof totalRaw === "number" ? totalRaw : list.length,
      page: args.page,
      pageSize: args.pageSize,
    };
  }

  async function getToplists(): Promise<MusicToplist[]> {
    const url = buildUrl(baseUrl, "/v1/toplists", { platform: defaultPlatform });
    const res = await scriptFetch(url, { method: "GET", timeout: 30_000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json<ApiEnvelope<unknown>>();
    const items = pickList(body.data ?? body);
    return items
      .map((r): MusicToplist | undefined => {
        const it = r as Record<string, unknown>;
        const id = it.id ?? it.toplistId ?? it.rankId;
        const name = it.name ?? it.title;
        if (id === undefined || !name) return undefined;
        return {
          id: String(id),
          name: String(name),
          cover: (it.cover as string | undefined) ?? (it.pic as string | undefined),
          description: it.description as string | undefined,
          updateFrequency: it.updateFrequency as string | undefined,
        };
      })
      .filter((x): x is MusicToplist => !!x);
  }

  async function fetchDetail(
    path: string,
    id: string
  ): Promise<MusicPlaylistDetail> {
    const url = buildUrl(baseUrl, `${path}/${encodeURIComponent(id)}`, {
      platform: defaultPlatform,
    });
    const res = await scriptFetch(url, { method: "GET", timeout: 30_000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json<ApiEnvelope<unknown>>();
    const data = (body.data ?? body) as Record<string, unknown>;
    const songs = pickList(data)
      .map((r) => normalizeSong(r as Record<string, unknown>, defaultPlatform))
      .filter((s): s is MusicSong => !!s);
    return {
      id,
      name: (data.name as string | undefined) ?? "歌单",
      cover: (data.cover as string | undefined) ?? (data.pic as string | undefined),
      description: data.description as string | undefined,
      creator: data.creator as string | undefined,
      songs,
    };
  }

  async function parse(song: MusicSong, quality: MusicQuality) {
    if (!cfg.token) throw new Error("MusicApi-V2 token 未配置（解析必须）");
    const url = `${baseUrl}/v1/parse`;
    const res = await scriptFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": cfg.token,
      },
      json: { platform: song.source, ids: [song.songId], quality },
      timeout: 30_000,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json<ApiEnvelope<unknown>>();
    if (body.code !== undefined && body.code !== 0) {
      throw new Error(body.message || body.msg || "解析失败");
    }
    const list = pickList(
      (body.data as { data?: unknown })?.data ?? body.data ?? body
    );
    const first = list[0] as Record<string, unknown> | undefined;
    if (!first || !first.url) {
      throw new Error("未返回可用播放地址（可能版权限制或会员歌曲）");
    }
    return {
      url: String(first.url),
      cached: first.cached === true,
    };
  }

  async function fetchLyrics(song: MusicSong) {
    if (!song.lrcUrl) return "";
    const res = await scriptFetch(song.lrcUrl, {
      method: "GET",
      timeout: 15_000,
    });
    if (!res.ok) return "";
    return res.text();
  }

  return {
    kind: "musicapi",
    capabilities: {
      search: true,
      parse: true,
      lyrics: true,
      toplists: true,
      playlists: true,
      albums: false,
      artists: false,
      recommendSheets: false,
      comments: false,
      hotSearch: false,
      multiTypeSearch: false,
    },
    search,
    parse,
    getToplists,
    getToplistDetail: (id) => fetchDetail("/v1/toplist", id),
    getPlaylistDetail: (id) => fetchDetail("/v1/playlist", id),
    fetchLyrics,
  };
}
