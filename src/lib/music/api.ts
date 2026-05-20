/**
 * 音乐 backend 调度层 —— 所有 UI 层调用都过这里。dispatcher 根据 store 里 active backend
 * 实例化对应 runtime，再代理调用。
 *
 * 这一层稳定了 UI 与具体协议之间的边界：将来加新 backend，只需在 backends/ 下新加一个
 * runtime + 在 store 类型里扩展 kind，UI 不动。
 *
 * **builtin backend 的 fallback 链**：builtin 自身不解析 URL（lx-music musicSdk 本身也不解析），
 * 当 active 是 builtin 时，parse 会走第一个 enabled 的 musicapi/lxmusic/plugin backend；
 * 都没有则抛 "需要配置 URL 解析后端" 错误，UI 引导去设置页。
 */
import { useMusicStore } from "@/stores/music";
import { createMusicApiRuntime } from "./backends/musicapi";
import { createLxMusicRuntime } from "./backends/lxmusic";
import { createPluginRuntime } from "./backends/plugin";
import { createBuiltinRuntime } from "./backends/builtin";
import type { MusicBackend, MusicBackendRuntime } from "./backends/types";
import type {
  IRecommendSheet,
  IRecommendSheetTagsResult,
  MusicAlbumDetail,
  MusicArtist,
  MusicArtistWorksResult,
  MusicComment,
  MusicPlaylistDetail,
  MusicQuality,
  MusicResolvedSong,
  MusicSearchResult,
  MusicSearchType,
  MusicSong,
  MusicSource,
  MusicToplist,
} from "./types";

function getActiveBackend(): MusicBackend {
  const s = useMusicStore.getState();
  const active = s.backends.find((b) => b.id === s.activeBackendId && b.enabled);
  if (!active) {
    const fallback = s.backends.find((b) => b.enabled);
    if (!fallback) {
      throw new Error("尚未配置音乐后端 —— 去 设置 · 音乐 添加一个");
    }
    return fallback;
  }
  return active;
}

function createRuntime(backend: MusicBackend, platform: MusicSource): MusicBackendRuntime {
  switch (backend.kind) {
    case "musicapi":
      return createMusicApiRuntime(backend, platform);
    case "lxmusic":
      return createLxMusicRuntime(backend, platform);
    case "plugin":
      return createPluginRuntime(backend);
    case "builtin":
      return createBuiltinRuntime(backend, platform);
  }
}

function runtime(): MusicBackendRuntime {
  const backend = getActiveBackend();
  const platform = useMusicStore.getState().defaultPlatform;
  return createRuntime(backend, platform);
}

/** 找一个可以解析 URL 的 backend（builtin 自己不能解析，回落到其他类型） */
function parseRuntime(songSource: MusicSource): MusicBackendRuntime {
  const s = useMusicStore.getState();
  const active = s.backends.find((b) => b.id === s.activeBackendId && b.enabled);
  if (active && active.kind !== "builtin") {
    return createRuntime(active, songSource);
  }
  // builtin → 找第一个 enabled 的非 builtin
  const fallback = s.backends.find((b) => b.enabled && b.kind !== "builtin");
  if (!fallback) {
    throw new Error("当前后端不支持 URL 解析 — 需配置 MusicApi/LX-Music Server/MusicFree 插件");
  }
  return createRuntime(fallback, songSource);
}

export function hasMusicBackend(): boolean {
  const s = useMusicStore.getState();
  return s.backends.some((b) => b.enabled);
}

export function getActiveBackendInfo(): {
  kind: MusicBackend["kind"];
  name: string;
  capabilities: MusicBackendRuntime["capabilities"];
} | null {
  try {
    const b = getActiveBackend();
    const rt = createRuntime(b, useMusicStore.getState().defaultPlatform);
    return { kind: b.kind, name: b.name, capabilities: rt.capabilities };
  } catch {
    return null;
  }
}

/** 任意 backend id 的 capability —— 给设置页徽章用，不切换 active。 */
export function getBackendCapabilities(
  backendId: string
): MusicBackendRuntime["capabilities"] | null {
  const s = useMusicStore.getState();
  const b = s.backends.find((x) => x.id === backendId);
  if (!b) return null;
  try {
    const rt = createRuntime(b, s.defaultPlatform);
    return rt.capabilities;
  } catch {
    return null;
  }
}

export async function searchMusic(
  keyword: string,
  _platform: MusicSource,
  page = 1,
  pageSize = 20
): Promise<MusicSearchResult> {
  const rt = runtime();
  return rt.search({ keyword, page, pageSize, type: "music" });
}

export async function searchMusicMultiType(
  keyword: string,
  page: number,
  pageSize: number,
  type: MusicSearchType
): Promise<{
  songs?: MusicSong[];
  albums?: MusicAlbumDetail[];
  artists?: MusicArtist[];
  sheets?: IRecommendSheet[];
  isEnd?: boolean;
}> {
  const rt = runtime();
  if (type === "music") {
    const r = await rt.search({ keyword, page, pageSize, type });
    return {
      songs: r.list,
      isEnd: r.list.length < pageSize,
    };
  }
  if (type === "album") {
    if (!rt.searchAlbums) return { albums: [], isEnd: true };
    const r = await rt.searchAlbums({ keyword, page, pageSize, type });
    return { albums: r.list, isEnd: r.isEnd };
  }
  if (type === "artist") {
    if (!rt.searchArtists) return { artists: [], isEnd: true };
    const r = await rt.searchArtists({ keyword, page, pageSize, type });
    return { artists: r.list, isEnd: r.isEnd };
  }
  if (!rt.searchSheets) return { sheets: [], isEnd: true };
  const r = await rt.searchSheets({ keyword, page, pageSize, type });
  return { sheets: r.list, isEnd: r.isEnd };
}

export async function getToplists(_platform: MusicSource): Promise<MusicToplist[]> {
  const rt = runtime();
  if (!rt.getToplists) return [];
  return rt.getToplists();
}

export async function getToplistDetail(
  _platform: MusicSource,
  id: string,
  page?: number
): Promise<MusicPlaylistDetail> {
  const rt = runtime();
  if (!rt.getToplistDetail) throw new Error("当前后端不支持榜单详情");
  return rt.getToplistDetail(id, page);
}

export async function getPlaylistDetail(
  _platform: MusicSource,
  id: string,
  page?: number
): Promise<MusicPlaylistDetail> {
  const rt = runtime();
  if (!rt.getPlaylistDetail) throw new Error("当前后端不支持歌单详情");
  return rt.getPlaylistDetail(id, page);
}

export async function getAlbumDetail(
  _platform: MusicSource,
  albumId: string,
  page?: number
): Promise<MusicAlbumDetail> {
  const rt = runtime();
  if (!rt.getAlbumDetail) throw new Error("当前后端不支持专辑详情");
  return rt.getAlbumDetail(albumId, page);
}

export async function getArtistDetail(
  _platform: MusicSource,
  artistId: string
): Promise<MusicArtist> {
  const rt = runtime();
  if (!rt.getArtistDetail) throw new Error("当前后端不支持歌手详情");
  return rt.getArtistDetail(artistId);
}

export async function getArtistWorks<T extends "music" | "album">(
  _platform: MusicSource,
  artistId: string,
  page: number,
  type: T
): Promise<MusicArtistWorksResult<T>> {
  const rt = runtime();
  if (!rt.getArtistWorks) throw new Error("当前后端不支持歌手作品");
  return rt.getArtistWorks(artistId, page, type);
}

export async function getRecommendSheetTags(): Promise<IRecommendSheetTagsResult> {
  const rt = runtime();
  if (!rt.getRecommendSheetTags) return { pinned: [], groups: [] };
  return rt.getRecommendSheetTags();
}

export async function getRecommendSheetsByTag(
  tagId: string,
  page = 1
): Promise<{ list: IRecommendSheet[]; isEnd?: boolean }> {
  const rt = runtime();
  if (!rt.getRecommendSheetsByTag) return { list: [], isEnd: true };
  return rt.getRecommendSheetsByTag(tagId, page);
}

export async function getMusicComments(
  song: MusicSong,
  page = 1
): Promise<{ list: MusicComment[]; isEnd?: boolean }> {
  const rt = runtime();
  if (!rt.getMusicComments) return { list: [], isEnd: true };
  return rt.getMusicComments(song, page);
}

export async function getMusicInfo(song: MusicSong): Promise<Partial<MusicSong>> {
  const rt = runtime();
  if (!rt.getMusicInfo) return {};
  return rt.getMusicInfo(song);
}

export async function importMusicSheet(urlLike: string): Promise<MusicSong[]> {
  const rt = runtime();
  if (!rt.importMusicSheet) throw new Error("当前后端不支持导入歌单");
  return rt.importMusicSheet(urlLike);
}

export async function getHotSearch(): Promise<string[]> {
  const rt = runtime();
  if (!rt.getHotSearch) return [];
  return rt.getHotSearch();
}

export async function parseSong(
  song: MusicSong,
  quality: MusicQuality
): Promise<MusicResolvedSong> {
  const rt = parseRuntime(song.source);
  const r = await rt.parse(song, quality);
  return {
    ...song,
    url: r.url,
    quality,
    cached: r.cached,
    headers: r.headers,
  };
}

export async function fetchLyrics(song: MusicSong): Promise<string> {
  const rt = runtime();
  if (!rt.fetchLyrics) return "";
  try {
    return await rt.fetchLyrics(song);
  } catch {
    return "";
  }
}

export async function fetchTranslatedLyrics(song: MusicSong): Promise<string> {
  const rt = runtime();
  if (!rt.fetchTranslatedLyrics) return "";
  try {
    return await rt.fetchTranslatedLyrics(song);
  } catch {
    return "";
  }
}

/** 聚合搜索：fan-out 到所有 enabled 的 backend 并合并结果（按 backend 分段返回） */
export async function searchAggregated(
  keyword: string,
  page: number,
  pageSize: number
): Promise<Array<{ backendId: string; backendName: string; list: MusicSong[]; error?: string }>> {
  const s = useMusicStore.getState();
  const enabledBackends = s.backends.filter((b) => b.enabled);
  const platform = s.defaultPlatform;
  const tasks = enabledBackends.map(async (b) => {
    try {
      const rt = createRuntime(b, platform);
      const r = await rt.search({ keyword, page, pageSize });
      return { backendId: b.id, backendName: b.name, list: r.list };
    } catch (e) {
      return {
        backendId: b.id,
        backendName: b.name,
        list: [],
        error: (e as Error).message ?? String(e),
      };
    }
  });
  return Promise.all(tasks);
}

const LRC_LINE_RE = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]([^\n\r]*)/g;
const LRC_OFFSET_RE = /\[offset:\s*(-?\d+)\s*\]/i;

export function parseLyrics(text: string): Array<{ time: number; text: string }> {
  const out: Array<{ time: number; text: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = LRC_LINE_RE.exec(text)) !== null) {
    const min = parseInt(m[1], 10) || 0;
    const sec = parseInt(m[2], 10) || 0;
    const ms = m[3] ? parseInt(m[3].padEnd(3, "0"), 10) : 0;
    const time = min * 60 + sec + ms / 1000;
    const lyric = (m[4] || "").trim();
    if (lyric) out.push({ time, text: lyric });
  }
  LRC_LINE_RE.lastIndex = 0;
  out.sort((a, b) => a.time - b.time);
  return out;
}

/** LRC offset 标签 — `[offset:-200]` 表示歌词整体提前 200ms */
export function parseLyricOffset(text: string): number {
  const m = LRC_OFFSET_RE.exec(text);
  if (!m) return 0;
  return (parseInt(m[1], 10) || 0) / 1000;
}

/** 合并 rawLrc + translation：同时间行加 translation 字段 */
export function mergeLyricsWithTranslation(
  raw: string,
  translation: string
): Array<{ time: number; text: string; translation?: string }> {
  const rawLines = parseLyrics(raw);
  if (!translation) return rawLines;
  const trans = parseLyrics(translation);
  const transMap = new Map<number, string>();
  for (const t of trans) {
    transMap.set(Math.round(t.time * 100), t.text);
  }
  return rawLines.map((l) => {
    const key = Math.round(l.time * 100);
    const tr = transMap.get(key);
    return tr ? { ...l, translation: tr } : l;
  });
}
