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
  fillTemplate,
  readPath,
  tryParseJson,
  unwrapArray,
} from "./utils";

function varsFor(
  keyword: string,
  song: MusicSong | undefined,
  page: number,
  limit: number,
  quality: string
) {
  return {
    q: keyword,
    keyword,
    page,
    limit,
    quality,
    id: song?.id,
    songId: song?.id,
    title: song?.title,
    name: song?.title,
    artist: song?.artist,
    singer: song?.artist,
    platform: song?.platform,
    source: song?.platform,
    songmid: song?.songmid,
  };
}

async function requestJson(
  source: MusicSourceDescriptor,
  urlTemplate: string | undefined,
  method: "GET" | "POST" | undefined,
  bodyTemplate: string | undefined,
  values: Record<string, string | number | undefined>
): Promise<unknown> {
  if (!urlTemplate) throw new Error("聚合源缺少接口地址");
  const url = fillTemplate(urlTemplate, values);
  const init =
    method === "POST"
      ? {
          method: "POST",
          headers: source.headers,
          timeout: 15000,
          ...(bodyTemplate
            ? (() => {
                const body = fillTemplate(bodyTemplate, values, false);
                const json = tryParseJson(body);
                return json === undefined ? { body } : { json };
              })()
            : {}),
        }
      : {
          headers: source.headers,
          timeout: 15000,
        };
  const res = await scriptFetch(url, init);
  if (!res.ok) throw new Error((await res.text()) || `请求失败 ${res.status}`);
  return res.json<unknown>();
}

function pickString(item: unknown, paths: Array<string | undefined>): string | undefined {
  for (const path of paths) {
    const value = asString(readPath(item, path));
    if (value) return value;
  }
  return undefined;
}

function normalizeAggregateSong(
  source: MusicSourceDescriptor,
  item: unknown
): MusicSong | null {
  const map = source.fieldMap ?? {};
  const id = pickString(item, [map.id, "id", "songId", "songmid", "mid", "hash"]);
  const title = pickString(item, [map.title, "title", "name", "songName"]);
  if (!id || !title) return null;
  const durationText = pickString(item, [
    map.durationText,
    "durationText",
    "interval",
    "duration",
  ]);
  const durationSec =
    asNumber(readPath(item, map.durationSec)) ??
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
    platform: pickString(item, [map.platform, "source", "platform"]),
    songmid: pickString(item, [map.songmid, "songmid", "mid"]),
    directUrl: pickString(item, [map.url, "url", "playUrl", "src"]),
    lrcUrl: pickString(item, [map.lrc, "lrcUrl"]),
    trcUrl: pickString(item, [map.tlyric, "trcUrl", "tlyricUrl"]),
    raw: item,
  };
}

export async function searchAggregate(
  source: MusicSourceDescriptor,
  keyword: string,
  page: number,
  limit: number
): Promise<MusicSearchResult> {
  const payload = await requestJson(
    source,
    source.searchUrl,
    source.searchMethod,
    source.searchBodyTemplate,
    varsFor(keyword, undefined, page, limit, "320k")
  );
  const list = unwrapArray<unknown>(payload, source.itemPath)
    .map((item) => normalizeAggregateSong(source, item))
    .filter((item): item is MusicSong => !!item);
  return {
    list,
    page,
    limit,
    hasMore: list.length >= limit,
  };
}

function normalizeLyric(payload: unknown): MusicLyricResult {
  const record = asRecord(payload);
  const data = asRecord(record?.data) ?? record;
  return {
    lyric: asString(data?.lyric) || asString(data?.lrc) || "",
    tlyric: asString(data?.tlyric) || asString(data?.trc),
  };
}

export async function resolveAggregate(
  source: MusicSourceDescriptor,
  song: MusicSong,
  quality: MusicQuality
): Promise<MusicPlayResult> {
  let directUrl = song.directUrl;
  let lyric: MusicLyricResult = { lyric: "" };
  if (!directUrl && source.playUrl) {
    const payload = await requestJson(
      source,
      source.playUrl,
      source.playMethod,
      source.playBodyTemplate,
      varsFor("", song, 1, 1, quality)
    );
    const record = asRecord(payload);
    const data = asRecord(record?.data) ?? record;
    directUrl =
      asString(readPath(data, source.fieldMap?.url)) ||
      asString(data?.url) ||
      asString(data?.playUrl) ||
      asString(data?.src);
  }
  if (source.lyricUrl) {
    try {
      const payload = await requestJson(
        source,
        source.lyricUrl,
        source.lyricMethod,
        source.lyricBodyTemplate,
        varsFor("", song, 1, 1, quality)
      );
      lyric = normalizeLyric(payload);
    } catch {
      lyric = { lyric: "" };
    }
  }
  if (!directUrl) throw new Error("聚合源没有返回播放地址");
  return {
    url: directUrl,
    directUrl,
    quality,
    headers: source.headers,
    lyric: lyric.lyric,
    tlyric: lyric.tlyric,
  };
}
