import { scriptFetch } from "@/source-script/fetch";
import { buildLxMusicStreamUrl } from "@/lib/proxy";
import type {
  MusicLyricResult,
  MusicPlayResult,
  MusicPlatform,
  MusicQuality,
  MusicSearchResult,
  MusicSong,
  MusicSourceDescriptor,
} from "./types";
import {
  MUSIC_PLATFORMS,
  normalizeMusicQuality,
  normalizeMusicPlatform,
  parseDurationToSec,
} from "./types";
import { asRecord, asString, cleanBaseUrl, unwrapArray } from "./utils";

interface LxServerSong {
  id?: string | number;
  songId?: string | number;
  name?: string;
  singer?: string;
  artist?: string;
  source?: string;
  interval?: string;
  albumName?: string;
  album?: string;
  img?: string;
  cover?: string;
  pic?: string;
  songmid?: string | number;
  hash?: string | number;
  copyrightId?: string | number;
  albumId?: string | number;
  lrcUrl?: string;
  mrcUrl?: string;
  trcUrl?: string;
}

function headersFor(source: MusicSourceDescriptor): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(source.headers ?? {}),
  };
  if (source.token) headers["x-user-token"] = source.token;
  return headers;
}

export async function lxGet<T>(source: MusicSourceDescriptor, path: string): Promise<T> {
  const base = cleanBaseUrl(source.baseUrl);
  if (!base) throw new Error("请先配置 LX Music API Server 地址");
  const res = await scriptFetch(`${base}${path}`, {
    headers: headersFor(source),
    timeout: 15000,
  });
  if (!res.ok) throw new Error((await res.text()) || `请求失败 ${res.status}`);
  return res.json<T>();
}

async function lxPost<T>(
  source: MusicSourceDescriptor,
  path: string,
  body: unknown
): Promise<T> {
  const base = cleanBaseUrl(source.baseUrl);
  if (!base) throw new Error("请先配置 LX Music API Server 地址");
  const res = await scriptFetch(`${base}${path}`, {
    method: "POST",
    json: body,
    headers: headersFor(source),
    timeout: 15000,
  });
  if (!res.ok) throw new Error((await res.text()) || `请求失败 ${res.status}`);
  return res.json<T>();
}

function sourcePlatforms(source: MusicSourceDescriptor): MusicPlatform[] {
  if (source.defaultPlatform && source.defaultPlatform !== "all") {
    return [source.defaultPlatform];
  }
  const configured = (source.platforms ?? [])
    .map((item) => normalizeMusicPlatform(item))
    .filter(Boolean) as MusicPlatform[];
  return configured.length > 0
    ? configured
    : MUSIC_PLATFORMS.map((item) => item.id);
}

export function normalizeLxSong(
  source: MusicSourceDescriptor,
  input: LxServerSong,
  fallbackPlatform?: MusicPlatform
): MusicSong | null {
  const platform = normalizeMusicPlatform(input.source) || fallbackPlatform || "kw";
  const rawId = asString(input.songId) || asString(input.id);
  const songmid = asString(input.songmid);
  const id = rawId || (songmid ? `${platform}_${songmid}` : "");
  const title = (input.name || "").trim();
  const artist = (input.artist || input.singer || "").trim();
  if (!id || !title) return null;
  const durationText = input.interval;
  return {
    id,
    sourceId: source.id,
    sourceName: source.name,
    title,
    artist: artist || "未知歌手",
    album: input.album || input.albumName || undefined,
    cover: input.cover || input.pic || input.img || undefined,
    durationText,
    durationSec: parseDurationToSec(durationText),
    platform,
    songmid,
    hash: asString(input.hash),
    copyrightId: asString(input.copyrightId),
    albumId: asString(input.albumId),
    lrcUrl: input.lrcUrl,
    mrcUrl: input.mrcUrl,
    trcUrl: input.trcUrl,
    raw: input,
  };
}

export async function searchLxServer(
  source: MusicSourceDescriptor,
  keyword: string,
  page: number,
  limit: number
): Promise<MusicSearchResult> {
  const platforms = sourcePlatforms(source);
  if (platforms.length === 0) {
    return { list: [], page, limit, hasMore: false };
  }
  const chunks = await Promise.all(
    platforms.map(async (platform) => {
      const query = new URLSearchParams({
        name: keyword,
        source: platform,
        page: String(page),
        limit: String(limit),
      });
      const payload = await lxGet<unknown>(
        source,
        `/api/music/search?${query.toString()}`
      );
      return unwrapArray<LxServerSong>(payload)
        .map((item) => normalizeLxSong(source, item, platform))
        .filter((item): item is MusicSong => !!item);
    })
  );
  const list = chunks.flat().slice(0, limit * Math.max(1, platforms.length));
  return {
    list,
    page,
    limit,
    hasMore: chunks.some((items) => items.length >= limit),
  };
}

function buildSongInfo(song: MusicSong) {
  const raw = asRecord(song.raw);
  const rawSource = asString(raw?.source);
  const rawSongmid = asString(raw?.songmid) || asString(raw?.mid);
  const songmid =
    rawSongmid || song.songmid || song.id.split("_").slice(1).join("_") || song.id;

  return {
    ...raw,
    id: song.id,
    songId: songmid,
    name: song.title,
    singer: song.artist,
    artist: song.artist,
    source: song.platform || rawSource || "kw",
    songmid,
    mid: songmid,
    hash: song.hash ?? raw?.hash,
    interval: song.durationText ?? raw?.interval,
    albumName: song.album ?? raw?.albumName,
    img: song.cover ?? raw?.img,
    copyrightId: song.copyrightId ?? raw?.copyrightId,
    albumId: song.albumId ?? raw?.albumId,
    lrcUrl: song.lrcUrl ?? raw?.lrcUrl,
    mrcUrl: song.mrcUrl ?? raw?.mrcUrl,
    trcUrl: song.trcUrl ?? raw?.trcUrl,
  };
}

function normalizeLyricPayload(payload: unknown): MusicLyricResult {
  const record = asRecord(payload);
  const data = asRecord(record?.data) ?? record;
  return {
    lyric: asString(data?.lyric) || asString(data?.lrc) || "",
    tlyric: asString(data?.tlyric) || asString(data?.trc),
  };
}

export async function fetchLxLyric(
  source: MusicSourceDescriptor,
  song: MusicSong
): Promise<MusicLyricResult> {
  const info = buildSongInfo(song);
  const query = new URLSearchParams();
  Object.entries(info).forEach(([key, value]) => {
    if (value !== undefined && value !== "") query.set(key, String(value));
  });
  try {
    const payload = await lxGet<unknown>(
      source,
      `/api/music/lyric?${query.toString()}`
    );
    return normalizeLyricPayload(payload);
  } catch {
    const payload = await lxPost<unknown>(source, "/api/music/lyric", {
      songInfo: info,
    });
    return normalizeLyricPayload(payload);
  }
}

export async function resolveLxServer(
  source: MusicSourceDescriptor,
  song: MusicSong,
  quality: MusicQuality,
  options: { stableStream?: boolean } = {}
): Promise<MusicPlayResult> {
  const serverQuality = normalizeMusicQuality(quality);
  let lyric: MusicLyricResult = { lyric: "" };
  try {
    lyric = await fetchLxLyric(source, song);
  } catch {
    lyric = { lyric: "" };
  }

  if (options.stableStream !== false) {
    const streamUrl = buildLxMusicStreamUrl({
      baseUrl: source.baseUrl,
      token: source.token,
      song: {
        id: song.id,
        title: song.title,
        artist: song.artist,
        platform: String(song.platform || ""),
        songmid: song.songmid,
        durationText: song.durationText,
        hash: song.hash,
        copyrightId: song.copyrightId,
        albumId: song.albumId,
        lrcUrl: song.lrcUrl,
        mrcUrl: song.mrcUrl,
        trcUrl: song.trcUrl,
      },
      quality: serverQuality,
      headers: source.headers,
    });
    if (streamUrl) {
      return {
        url: streamUrl,
        quality: serverQuality,
        lyric: lyric.lyric,
        tlyric: lyric.tlyric,
      };
    }
  }

  const payload = await lxPost<unknown>(source, "/api/music/url", {
    songInfo: buildSongInfo(song),
    quality: serverQuality,
  });
  const record = asRecord(payload);
  const data = asRecord(record?.data) ?? record;
  const directUrl = asString(data?.url);
  if (!directUrl) {
    throw new Error(asString(data?.error) || "获取播放地址失败");
  }
  return {
    url: directUrl,
    directUrl,
    quality: asString(data?.type) || serverQuality,
    lyric: lyric.lyric,
    tlyric: lyric.tlyric,
  };
}
