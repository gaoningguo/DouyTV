import { lxGet, normalizeLxSong } from "./lxServer";
import type {
  MusicDiscoveryBoard,
  MusicHotSearchItem,
  MusicPlatform,
  MusicSong,
  MusicSongListDetail,
  MusicSongListSummary,
  MusicSongListTag,
  MusicSongListTags,
  MusicSourceDescriptor,
} from "./types";
import { MUSIC_PLATFORMS, normalizeMusicPlatform } from "./types";
import { asNumber, asRecord, asString, unwrapArray } from "./utils";

const BOARD_FALLBACKS: MusicPlatform[] = ["kg", "kw", "tx", "wy", "mg"];
const HOT_FALLBACKS: MusicPlatform[] = ["mg", "kw", "tx", "wy", "kg"];
const DISCOVERY_PLATFORMS: MusicPlatform[] = MUSIC_PLATFORMS.map((item) => item.id);

function uniquePlatforms(primary: MusicPlatform, fallbacks: MusicPlatform[]) {
  return [primary, ...fallbacks].filter(
    (item, index, arr) => arr.indexOf(item) === index
  );
}

function assertLxSource(source: MusicSourceDescriptor) {
  if (source.kind !== "lx-server") {
    throw new Error("当前音乐发现页需要 LX Music API Server 源");
  }
}

function sourceOrDefault(value: string | undefined, fallback: MusicPlatform): MusicPlatform {
  return normalizeMusicPlatform(value) || fallback;
}

function normalizeBoard(item: unknown, source: MusicPlatform): MusicDiscoveryBoard | null {
  const record = asRecord(item);
  if (!record) return null;
  const id = asString(record.bangid) || asString(record.id);
  const name = asString(record.name) || asString(record.title);
  if (!id || !name) return null;
  return {
    id,
    name,
    source,
    cover:
      asString(record.img) ||
      asString(record.pic) ||
      asString(record.cover) ||
      asString(record.coverImgUrl),
  };
}

function normalizeTag(item: unknown): MusicSongListTag | null {
  if (typeof item === "string") return { id: item, name: item };
  const record = asRecord(item);
  if (!record) return null;
  const name =
    asString(record.name) ||
    asString(record.label) ||
    asString(record.title) ||
    asString(record.tagName);
  const id =
    asString(record.id) ||
    asString(record.tagId) ||
    asString(record.value) ||
    name;
  return id && name ? { id, name } : null;
}

function normalizeTagList(input: unknown): MusicSongListTag[] {
  if (!Array.isArray(input)) return [];
  return input.map(normalizeTag).filter((item): item is MusicSongListTag => !!item);
}

function dedupeBy<T>(items: T[], keyOf: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyOf(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeHotSearchPayload(
  payload: unknown,
  fallbackSource: MusicPlatform
): MusicHotSearchItem[] {
  const record = asRecord(payload);
  const payloadSource =
    sourceOrDefault(asString(record?.source), fallbackSource) || fallbackSource;
  const rawList = Array.isArray(payload) ? payload : record?.list;
  if (!Array.isArray(rawList)) return [];
  return rawList
    .map((item): MusicHotSearchItem | null => {
      if (typeof item === "string") {
        return { keyword: item, name: item, artist: "", source: payloadSource };
      }
      const row = asRecord(item);
      if (!row) return null;
      const keyword =
        asString(row.name) || asString(row.keyword) || asString(row.word) || "";
      if (!keyword) return null;
      return {
        keyword,
        name: keyword,
        artist: asString(row.singer) || asString(row.artist) || "",
        source: asString(row.source) || payloadSource,
      };
    })
    .filter((item): item is MusicHotSearchItem => !!item);
}

function normalizeSongListSummary(
  item: unknown,
  fallbackSource: MusicPlatform
): MusicSongListSummary | null {
  const record = asRecord(item);
  if (!record) return null;
  const id =
    asString(record.id) ||
    asString(record.songlistId) ||
    asString(record.listId) ||
    asString(record.dissid);
  const name =
    asString(record.name) ||
    asString(record.title) ||
    asString(record.dissname) ||
    "未命名歌单";
  if (!id) return null;
  const creator = asRecord(record.creator);
  return {
    id,
    name,
    source: asString(record.source) || fallbackSource,
    pic:
      asString(record.img) ||
      asString(record.cover) ||
      asString(record.pic) ||
      asString(record.coverImgUrl) ||
      asString(record.logo),
    author:
      asString(record.author) ||
      asString(creator?.nickname) ||
      asString(record.uname) ||
      asString(record.username),
    desc: asString(record.desc) || asString(record.description),
    playCount:
      asString(record.play_count) ||
      asString(record.playCount) ||
      asString(record.listencnt) ||
      asString(record.visitnum) ||
      asNumber(record.play_count) ||
      asNumber(record.playCount),
    total:
      asNumber(record.total) ||
      asNumber(record.trackCount) ||
      asNumber(record.songCount) ||
      asString(record.total),
    updateFrequency:
      asString(record.updateFrequency) ||
      asString(record.update_frequency) ||
      asString(record.time),
  };
}

function normalizeSongListInfo(payload: unknown): Record<string, unknown> {
  const record = asRecord(payload);
  const data = asRecord(record?.data);
  return (
    asRecord(record?.info) ||
    asRecord(data?.info) ||
    asRecord(data?.data) ||
    {}
  );
}

export async function getMusicBoards(
  source: MusicSourceDescriptor,
  platform: MusicPlatform = "kw"
): Promise<{ source: MusicPlatform; list: MusicDiscoveryBoard[]; errors: string[] }> {
  assertLxSource(source);
  const errors: string[] = [];
  const settled = await Promise.allSettled(
    uniquePlatforms(platform, BOARD_FALLBACKS).map(async (candidate) => {
      try {
        const payload = await lxGet<unknown>(
          source,
          `/api/music/leaderboard/boards?source=${candidate}`
        );
        return unwrapArray<unknown>(payload)
          .map((item) => normalizeBoard(item, candidate))
          .filter((item): item is MusicDiscoveryBoard => !!item);
      } catch (error) {
        errors.push(
          `${candidate}: ${error instanceof Error ? error.message : String(error)}`
        );
        return [];
      }
    })
  );
  const list = dedupeBy(
    settled.flatMap((item) => (item.status === "fulfilled" ? item.value : [])),
    (item) => `${item.source}:${item.id}`
  );
  return { source: platform, list, errors };
}

export async function getMusicBoardSongs(
  source: MusicSourceDescriptor,
  platform: MusicPlatform,
  boardId: string,
  page = 1
): Promise<{ board: { id: string }; list: MusicSong[]; total: number; page: number }> {
  assertLxSource(source);
  if (!boardId) throw new Error("缺少榜单 ID");
  const payload = await lxGet<unknown>(
    source,
    `/api/music/leaderboard/list?source=${platform}&bangid=${encodeURIComponent(
      boardId
    )}&page=${page}`
  );
  const record = asRecord(payload);
  const data = asRecord(record?.data);
  const dataData = asRecord(data?.data);
  const list = unwrapArray<unknown>(payload)
    .map((item) =>
      normalizeLxSong(source, item as Parameters<typeof normalizeLxSong>[1], platform)
    )
    .filter((item): item is MusicSong => !!item);
  return {
    board: { id: boardId },
    list,
    total:
      asNumber(record?.total) ??
      asNumber(data?.total) ??
      asNumber(dataData?.total) ??
      list.length,
    page,
  };
}

export async function getMusicSonglists(
  source: MusicSourceDescriptor,
  platform: MusicPlatform = "wy",
  tagId = "",
  sortId = "hot",
  page = 1
): Promise<{
  source: MusicPlatform;
  page: number;
  tagId: string;
  sortId: string;
  total: number;
  limit: number;
  list: MusicSongListSummary[];
}> {
  assertLxSource(source);
  const payload = await lxGet<unknown>(
    source,
    `/api/music/songList/list?source=${platform}&tagId=${encodeURIComponent(
      tagId
    )}&sortId=${encodeURIComponent(sortId)}&page=${page}`
  );
  const record = asRecord(payload);
  const data = asRecord(record?.data);
  const list = unwrapArray<unknown>(payload)
    .map((item) => normalizeSongListSummary(item, platform))
    .filter((item): item is MusicSongListSummary => !!item);
  return {
    source: platform,
    page,
    tagId,
    sortId,
    total: asNumber(record?.total) ?? asNumber(data?.total) ?? list.length,
    limit: asNumber(record?.limit) ?? asNumber(data?.limit) ?? list.length,
    list,
  };
}

export async function getMusicSonglistDetail(
  source: MusicSourceDescriptor,
  platform: MusicPlatform,
  id: string,
  page = 1
): Promise<MusicSongListDetail> {
  assertLxSource(source);
  if (!id) throw new Error("缺少歌单 ID");
  const payload = await lxGet<unknown>(
    source,
    `/api/music/songList/detail?source=${platform}&id=${encodeURIComponent(
      id
    )}&page=${page}`
  );
  const record = asRecord(payload);
  const list = unwrapArray<unknown>(payload)
    .map((item) =>
      normalizeLxSong(source, item as Parameters<typeof normalizeLxSong>[1], platform)
    )
    .filter((item): item is MusicSong => !!item);
  return {
    info: normalizeSongListInfo(payload),
    list,
    page: asNumber(record?.page) ?? page,
    total: asNumber(record?.total) ?? list.length,
    limit: asNumber(record?.limit) ?? list.length,
  };
}

export async function getMusicSonglistTags(
  source: MusicSourceDescriptor,
  platform: MusicPlatform = "wy"
): Promise<MusicSongListTags> {
  assertLxSource(source);
  const payload = await lxGet<unknown>(
    source,
    `/api/music/songList/tags?source=${platform}`
  );
  const record = asRecord(payload);
  return {
    groups: Array.isArray(record?.tags) ? record.tags : [],
    hotTags: normalizeTagList(record?.hotTag),
    sortList: normalizeTagList(record?.sortList),
  };
}

export async function getAllMusicSonglistTags(
  source: MusicSourceDescriptor
): Promise<MusicSongListTags> {
  assertLxSource(source);
  const settled = await Promise.allSettled(
    DISCOVERY_PLATFORMS.map((platform) => getMusicSonglistTags(source, platform))
  );
  const fulfilled = settled.flatMap((item) =>
    item.status === "fulfilled" ? [item.value] : []
  );
  return {
    groups: fulfilled.flatMap((item) => item.groups),
    hotTags: dedupeBy(
      fulfilled.flatMap((item) => item.hotTags),
      (item) => item.name || item.id
    ),
    sortList: dedupeBy(
      fulfilled.flatMap((item) => item.sortList),
      (item) => item.name || item.id
    ),
  };
}

export async function getAllMusicSonglists(
  source: MusicSourceDescriptor,
  tagId = "",
  sortId = "hot",
  page = 1
): Promise<{
  source: "all";
  page: number;
  tagId: string;
  sortId: string;
  total: number;
  limit: number;
  list: MusicSongListSummary[];
}> {
  assertLxSource(source);
  const settled = await Promise.allSettled(
    DISCOVERY_PLATFORMS.map((platform) =>
      getMusicSonglists(source, platform, tagId, sortId, page)
    )
  );
  const fulfilled = settled.flatMap((item) =>
    item.status === "fulfilled" ? [item.value] : []
  );
  const list = dedupeBy(
    fulfilled.flatMap((item) => item.list),
    (item) => `${item.source}:${item.id}`
  );
  return {
    source: "all",
    page,
    tagId,
    sortId,
    total: fulfilled.reduce((sum, item) => sum + item.total, 0) || list.length,
    limit: fulfilled.reduce((sum, item) => sum + item.limit, 0) || list.length,
    list,
  };
}

export async function getMusicHotSearch(
  source: MusicSourceDescriptor,
  platform: MusicPlatform = "mg"
): Promise<MusicHotSearchItem[]> {
  assertLxSource(source);
  const settled = await Promise.allSettled(
    uniquePlatforms(platform, HOT_FALLBACKS).map(async (candidate) => {
      try {
        const payload = await lxGet<unknown>(
          source,
          `/api/music/hotSearch?source=${candidate}`
        );
        return normalizeHotSearchPayload(payload, candidate);
      } catch {
        return [];
      }
    })
  );
  return dedupeBy(
    settled.flatMap((item) => (item.status === "fulfilled" ? item.value : [])),
    (item) => item.keyword.trim().toLowerCase()
  );
}
