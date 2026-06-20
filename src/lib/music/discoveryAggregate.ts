/**
 * 发现类页面的多源聚合层 —— 把「所有启用源」的榜单/歌单/热搜合并去重并标记来源,
 * 详情请求按 summary.sourceId 路由回原源。我们是聚合平台,发现页不应只依赖单一源。
 *
 * 各源能力:
 *  - lx-server      : 榜单(getMusicBoards)/歌单广场(getAllMusicSonglists)/标签/热搜(全平台)
 *  - netease-api    : 排行榜(getNeteaseToplists)/推荐歌单(getNeteasePersonalized)/热搜(getNeteaseHotSearch)
 *                     external 真数据、builtin 受 -462 限制时该源贡献空(不报错)
 *  - cyrene/local/plugin : 不参与发现(仅搜索/播放)
 */
import {
  getAllMusicSonglists,
  getAllMusicSonglistTags,
  getMusicBoards,
  getMusicBoardSongs,
  getMusicHotSearch,
  getMusicSonglistDetail,
} from "./discovery";
import {
  getNeteaseHotSearch,
  getNeteasePersonalized,
  getNeteasePlaylistSongs,
  getNeteaseToplists,
} from "./neteaseApi";
import type {
  MusicDiscoveryBoard,
  MusicHotSearchItem,
  MusicPlatform,
  MusicSong,
  MusicSongListSummary,
  MusicSongListTags,
  MusicSourceDescriptor,
} from "./types";
import { normalizeMusicPlatform } from "./types";

function dedupeBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyOf(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function settledValues<T>(results: PromiseSettledResult<T[]>[]): T[] {
  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}

/** 聚合所有启用源的榜单。LX 出多平台榜单;网易出排行榜(承载为 board)。 */
export async function getMusicBoardsAggregated(
  sources: MusicSourceDescriptor[]
): Promise<MusicDiscoveryBoard[]> {
  const results = await Promise.allSettled(
    sources.map(async (source): Promise<MusicDiscoveryBoard[]> => {
      if (source.kind === "lx-server") {
        const data = await getMusicBoards(source, "kw");
        return data.list.map((board) => ({ ...board, sourceId: source.id }));
      }
      if (source.kind === "netease-api") {
        const toplists = await getNeteaseToplists(source);
        return toplists.map((item) => ({
          id: item.id,
          name: item.name,
          source: "wy" as MusicPlatform,
          cover: item.pic,
          sourceId: source.id,
        }));
      }
      return [];
    })
  );
  return dedupeBy(
    settledValues(results),
    (board) => `${board.sourceId}:${board.source}:${board.id}`
  );
}

/** 按 board.sourceId 路由回原源取榜单歌曲。 */
export async function getBoardSongsRouted(
  sources: MusicSourceDescriptor[],
  board: MusicDiscoveryBoard,
  page = 1
): Promise<MusicSong[]> {
  const source =
    sources.find((s) => s.id === board.sourceId) ??
    sources.find((s) => s.kind === "lx-server");
  if (!source) return [];
  if (source.kind === "netease-api") {
    // 网易榜单本质是歌单,详情走 playlist。
    return getNeteasePlaylistSongs(source, board.id, 100);
  }
  const data = await getMusicBoardSongs(source, board.source, board.id, page);
  return data.list;
}
// AGG_PART2

/** 聚合所有启用源的歌单广场。LX 出多平台歌单;网易出推荐歌单。 */
export async function getSonglistsAggregated(
  sources: MusicSourceDescriptor[],
  tagId = "",
  sortId = "hot",
  page = 1
): Promise<MusicSongListSummary[]> {
  const results = await Promise.allSettled(
    sources.map(async (source): Promise<MusicSongListSummary[]> => {
      if (source.kind === "lx-server") {
        const data = await getAllMusicSonglists(source, tagId, sortId, page);
        return data.list.map((item) => ({ ...item, sourceId: source.id }));
      }
      if (source.kind === "netease-api") {
        // 网易推荐歌单仅首页(无标签分页);仅第一页贡献,避免翻页重复。
        if (page > 1) return [];
        return getNeteasePersonalized(source, 24);
      }
      return [];
    })
  );
  return dedupeBy(
    settledValues(results),
    (item) => `${item.sourceId ?? item.source}:${item.id}`
  );
}

/** 聚合所有 LX 源的歌单标签(网易推荐歌单无标签维度,不参与)。 */
export async function getSonglistTagsAggregated(
  sources: MusicSourceDescriptor[]
): Promise<MusicSongListTags> {
  const lx = sources.filter((s) => s.kind === "lx-server");
  if (lx.length === 0) return { groups: [], hotTags: [], sortList: [] };
  const results = await Promise.allSettled(lx.map((s) => getAllMusicSonglistTags(s)));
  const tags = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  return {
    groups: tags.flatMap((t) => t.groups),
    hotTags: dedupeBy(tags.flatMap((t) => t.hotTags), (t) => t.name || t.id),
    sortList: dedupeBy(tags.flatMap((t) => t.sortList), (t) => t.name || t.id),
  };
}

/** 按 summary.sourceId 路由回原源取歌单详情歌曲。 */
export async function getSonglistDetailRouted(
  sources: MusicSourceDescriptor[],
  summary: MusicSongListSummary,
  page = 1
): Promise<MusicSong[]> {
  const source =
    (summary.sourceId && sources.find((s) => s.id === summary.sourceId)) ||
    sources.find((s) => s.kind === "lx-server") ||
    sources.find((s) => s.kind === "netease-api");
  if (!source) return [];
  if (source.kind === "netease-api") {
    return getNeteasePlaylistSongs(source, summary.id, 100);
  }
  const platform = normalizeMusicPlatform(String(summary.source)) || "wy";
  const detail = await getMusicSonglistDetail(source, platform, summary.id, page);
  return detail.list;
}

/** 聚合所有启用源的热搜关键词。 */
export async function getHotSearchAggregated(
  sources: MusicSourceDescriptor[]
): Promise<MusicHotSearchItem[]> {
  const results = await Promise.allSettled(
    sources.map(async (source): Promise<MusicHotSearchItem[]> => {
      if (source.kind === "lx-server") {
        return getMusicHotSearch(source, "mg");
      }
      if (source.kind === "netease-api") {
        const words = await getNeteaseHotSearch(source, 10);
        return words.map((keyword) => ({ keyword, name: keyword, source: "wy" }));
      }
      return [];
    })
  );
  return dedupeBy(settledValues(results), (item) => item.keyword.trim().toLowerCase());
}
