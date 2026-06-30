/**
 * 发现类页面的多源聚合层 —— 把「所有启用源」的榜单/歌单/热搜合并去重并标记来源，
 * 详情请求按 summary.sourceId 路由回原源。我们是聚合平台，发现页不应只依赖单一源。
 *
 * 本层为纯编排：各源的发现能力由 discoveryProviders.ts 的 provider 注册表提供，
 * 这里只遍历「具备该能力的源」、合并去重、按 sourceId 路由详情。新增源只需写 provider。
 */
import {
  discoveryProviderOf,
  type DiscoveryProvider,
} from "./discoveryProviders";
import type {
  MusicDiscoveryBoard,
  MusicHotSearchItem,
  MusicSong,
  MusicSongListSummary,
  MusicSongListTags,
  MusicSourceDescriptor,
} from "./types";

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

/** 遍历「具备某能力」的源并收集其 provider，过滤掉不支持该能力的源。 */
function providersWith<K extends keyof DiscoveryProvider>(
  sources: MusicSourceDescriptor[],
  capability: K
): Array<{ source: MusicSourceDescriptor; provider: DiscoveryProvider }> {
  const out: Array<{ source: MusicSourceDescriptor; provider: DiscoveryProvider }> = [];
  for (const source of sources) {
    const provider = discoveryProviderOf(source);
    if (provider && provider[capability]) out.push({ source, provider });
  }
  return out;
}

/** 找回产出某 board/summary 的源（按 sourceId），再调它 provider 的详情能力。 */
function findRouted(
  sources: MusicSourceDescriptor[],
  sourceId: string | undefined
): { source: MusicSourceDescriptor; provider: DiscoveryProvider } | undefined {
  const source = sourceId ? sources.find((s) => s.id === sourceId) : undefined;
  if (source) {
    const provider = discoveryProviderOf(source);
    if (provider) return { source, provider };
  }
  return undefined;
}

/** 聚合所有启用源的榜单。 */
export async function getMusicBoardsAggregated(
  sources: MusicSourceDescriptor[]
): Promise<MusicDiscoveryBoard[]> {
  const results = await Promise.allSettled(
    providersWith(sources, "boards").map(({ source, provider }) =>
      provider.boards!(source)
    )
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
  const routed =
    findRouted(sources, board.sourceId) ??
    providersWith(sources, "boardSongs")[0];
  if (!routed?.provider.boardSongs) return [];
  return routed.provider.boardSongs(routed.source, board, page);
}

/** 聚合所有启用源的歌单广场。 */
export async function getSonglistsAggregated(
  sources: MusicSourceDescriptor[],
  tagId = "",
  sortId = "hot",
  page = 1
): Promise<MusicSongListSummary[]> {
  const results = await Promise.allSettled(
    providersWith(sources, "songlists").map(({ source, provider }) =>
      provider.songlists!(source, tagId, sortId, page)
    )
  );
  return dedupeBy(
    settledValues(results),
    (item) => `${item.sourceId ?? item.source}:${item.id}`
  );
}

/** 聚合所有启用源的歌单标签。 */
export async function getSonglistTagsAggregated(
  sources: MusicSourceDescriptor[]
): Promise<MusicSongListTags> {
  const entries = providersWith(sources, "tags");
  if (entries.length === 0) return { groups: [], hotTags: [], sortList: [] };
  const results = await Promise.allSettled(
    entries.map(({ source, provider }) => provider.tags!(source))
  );
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
  const routed =
    findRouted(sources, summary.sourceId) ??
    providersWith(sources, "songlistDetail")[0];
  if (!routed?.provider.songlistDetail) return [];
  return routed.provider.songlistDetail(routed.source, summary, page);
}

/** 聚合所有启用源的热搜关键词。 */
export async function getHotSearchAggregated(
  sources: MusicSourceDescriptor[]
): Promise<MusicHotSearchItem[]> {
  const results = await Promise.allSettled(
    providersWith(sources, "hotSearch").map(({ source, provider }) =>
      provider.hotSearch!(source)
    )
  );
  return dedupeBy(settledValues(results), (item) =>
    item.keyword.trim().toLowerCase()
  );
}
