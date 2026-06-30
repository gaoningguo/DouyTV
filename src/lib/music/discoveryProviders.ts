/**
 * 发现页「能力 provider 注册表」—— 每种源声明它支持的发现能力，聚合层只遍历
 * 「具备该能力的源」并合并去重。取代此前散落各聚合函数的 `if (source.kind===...)` 链。
 *
 * 设计：
 *  - 每个 provider 按 MusicSourceKind 注册，能力可选（不支持的能力不实现）。
 *  - 列表能力签名统一；musicSdk provider 内部再遍历六平台聚合（它本身就是多平台源）。
 *  - 详情路由（board/songlist → 歌曲）也由 provider 自己实现，聚合层按 sourceId 找回原源。
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
  getNeteaseToplistDetail,
} from "./neteaseApi";
import { getOmniToplists } from "./cyreneApi";
import {
  getMusicSdkBoards,
  getMusicSdkBoardSongs,
  getMusicSdkHotSearch,
  getMusicSdkSonglistDetail,
  getMusicSdkSonglistTags,
  getMusicSdkSonglists,
  musicSdkSourcePlatforms,
} from "./musicSdkSource";
import type { MusicSdkPlatform } from "./sdk/index-sdk";
import type {
  MusicDiscoveryBoard,
  MusicHotSearchItem,
  MusicPlatform,
  MusicSong,
  MusicSongListSummary,
  MusicSongListTags,
  MusicSourceDescriptor,
  MusicSourceKind,
} from "./types";
import { normalizeMusicPlatform } from "./types";

/** 一个源的发现能力集合；未实现的能力即该源不支持。 */
export interface DiscoveryProvider {
  /** 榜单列表（每榜一张卡，board.id 为详情请求所需 id）。 */
  boards?(source: MusicSourceDescriptor): Promise<MusicDiscoveryBoard[]>;
  /** 榜单歌曲（board 来自本源的 boards）。 */
  boardSongs?(
    source: MusicSourceDescriptor,
    board: MusicDiscoveryBoard,
    page: number
  ): Promise<MusicSong[]>;
  /** 歌单广场列表。 */
  songlists?(
    source: MusicSourceDescriptor,
    tagId: string,
    sortId: string,
    page: number
  ): Promise<MusicSongListSummary[]>;
  /** 歌单详情曲目（summary 来自本源的 songlists）。 */
  songlistDetail?(
    source: MusicSourceDescriptor,
    summary: MusicSongListSummary,
    page: number
  ): Promise<MusicSong[]>;
  /** 歌单分类标签。 */
  tags?(source: MusicSourceDescriptor): Promise<MusicSongListTags>;
  /** 热搜关键词。 */
  hotSearch?(source: MusicSourceDescriptor): Promise<MusicHotSearchItem[]>;
}

// ───────────────────────── lx-server ─────────────────────────
const lxServerProvider: DiscoveryProvider = {
  async boards(source) {
    const data = await getMusicBoards(source, "kw");
    return data.list.map((board) => ({ ...board, sourceId: source.id }));
  },
  async boardSongs(source, board, page) {
    const data = await getMusicBoardSongs(source, board.source, board.id, page);
    return data.list;
  },
  async songlists(source, tagId, sortId, page) {
    const data = await getAllMusicSonglists(source, tagId, sortId, page);
    return data.list.map((item) => ({ ...item, sourceId: source.id }));
  },
  async songlistDetail(source, summary, page) {
    const platform = normalizeMusicPlatform(String(summary.source)) || "wy";
    const detail = await getMusicSonglistDetail(source, platform, summary.id, page);
    return detail.list;
  },
  async tags(source) {
    return getAllMusicSonglistTags(source);
  },
  async hotSearch(source) {
    return getMusicHotSearch(source, "mg");
  },
};

// ───────────────────────── netease-api ─────────────────────────
const neteaseProvider: DiscoveryProvider = {
  async boards(source) {
    // /toplist/detail 一次拿全部榜单(含封面/摘要更全)；取空回退 /toplist。
    let toplists = await getNeteaseToplistDetail(source).catch(() => []);
    if (toplists.length === 0) toplists = await getNeteaseToplists(source);
    return toplists.map((item) => ({
      id: item.id,
      name: item.name,
      source: "wy" as MusicPlatform,
      cover: item.pic,
      sourceId: source.id,
    }));
  },
  async boardSongs(source, board) {
    // 网易榜单本质是歌单，详情走 playlist。
    return getNeteasePlaylistSongs(source, board.id, 100);
  },
  async songlists(source, _tagId, _sortId, page) {
    // 网易推荐歌单仅首页(无标签分页)；仅第一页贡献，避免翻页重复。
    if (page > 1) return [];
    return getNeteasePersonalized(source, 24);
  },
  async songlistDetail(source, summary) {
    return getNeteasePlaylistSongs(source, summary.id, 100);
  },
  // 网易推荐歌单无标签维度，不实现 tags。
  async hotSearch(source) {
    const words = await getNeteaseHotSearch(source, 10);
    return words.map((keyword) => ({ keyword, name: keyword, source: "wy" }));
  },
};

// ───────────────────────── cyrene-aggregate（OmniParse omni）─────────────────────────
// OmniParse /toplists 的歌曲是内联返回的(无可二次拉取的 board id)，按 board.id 缓存，
// 详情请求命中即回放，不再重复请求后端。
const omniBoardSongsCache = new Map<string, MusicSong[]>();

const cyreneProvider: DiscoveryProvider = {
  async boards(source) {
    const toplists = await getOmniToplists(source);
    return toplists.map((entry, idx) => {
      const id = `omni:${idx}:${entry.name}`;
      omniBoardSongsCache.set(`${source.id}:${id}`, entry.list);
      return {
        id,
        name: entry.name,
        source: "wy" as MusicPlatform,
        cover: entry.list[0]?.cover,
        sourceId: source.id,
      };
    });
  },
  async boardSongs(source, board) {
    return omniBoardSongsCache.get(`${source.id}:${board.id}`) ?? [];
  },
  // OmniParse 无歌单广场/标签/热搜端点，仅榜单。
};

// ───────────────────────── musicsdk（六平台内置 SDK）─────────────────────────
// musicSdk 本身是多平台源：provider 内部遍历启用平台聚合。
const musicSdkProvider: DiscoveryProvider = {
  async boards(source) {
    const platforms = musicSdkSourcePlatforms(source);
    return platforms.flatMap((platform) => getMusicSdkBoards(source, platform));
  },
  async boardSongs(source, board, page) {
    // board.source 是平台 id，board.id 是 bangid。
    const platform = (normalizeMusicPlatform(String(board.source)) ||
      "kw") as MusicSdkPlatform;
    return getMusicSdkBoardSongs(source, platform, board.id, page);
  },
  async songlists(source, tagId, sortId, page) {
    const platforms = musicSdkSourcePlatforms(source);
    const settled = await Promise.allSettled(
      platforms.map((platform) =>
        getMusicSdkSonglists(source, platform, sortId, tagId, page)
      )
    );
    return settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  },
  async songlistDetail(source, summary, page) {
    const platform = (normalizeMusicPlatform(String(summary.source)) ||
      "wy") as MusicSdkPlatform;
    return getMusicSdkSonglistDetail(source, platform, summary.id, page);
  },
  async tags(source) {
    // 各平台标签合并（聚合层再去重）。取启用平台的首个有标签的平台即可，避免标签爆炸；
    // 这里合并全部，去重交聚合层。
    const platforms = musicSdkSourcePlatforms(source);
    const settled = await Promise.allSettled(
      platforms.map((platform) => getMusicSdkSonglistTags(platform))
    );
    const all = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    return {
      groups: all.flatMap((t) => t.groups),
      hotTags: all.flatMap((t) => t.hotTags),
      sortList: all.flatMap((t) => t.sortList),
    };
  },
  async hotSearch(source) {
    const platforms = musicSdkSourcePlatforms(source);
    const settled = await Promise.allSettled(
      platforms.map((platform) => getMusicSdkHotSearch(platform))
    );
    return settled.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  },
};

/** 按源类型查 provider。未注册（local/plugin-js/aggregate-http）= 不参与发现。 */
const PROVIDERS: Partial<Record<MusicSourceKind, DiscoveryProvider>> = {
  "lx-server": lxServerProvider,
  "netease-api": neteaseProvider,
  "cyrene-aggregate": cyreneProvider,
  musicsdk: musicSdkProvider,
};

export function discoveryProviderOf(
  source: MusicSourceDescriptor
): DiscoveryProvider | undefined {
  // cyrene 仅 omni 模式有列表能力（tunehub/lx 仅播放）。
  if (source.kind === "cyrene-aggregate" && (source.cyreneMode ?? "omni") !== "omni") {
    return undefined;
  }
  return PROVIDERS[source.kind];
}
