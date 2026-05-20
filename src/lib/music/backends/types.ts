/**
 * 多种音乐后端的抽象。每种 backend 有不同的配置形态，但都遵守相同的运行时 contract
 * （src/lib/music/api.ts 里的 dispatcher）。
 *
 * - musicapi: 用户自部署的 MusicApi-V2 / 兼容 fork（HTTP + X-API-Key）
 * - lxmusic:  lx-music-api-server（HTTP，LX-Music 生态）
 * - plugin:   MusicFreePlugin 形态的纯 JS 插件，运行在 `new Function` 沙盒
 * - builtin:  内置 lx-music musicSdk，无需外部服务即可搜索/榜单/歌词；
 *             URL 解析回落到 musicapi/lxmusic/plugin 中第一个 enabled 的 backend
 *
 * 同一时间只有一个 backend 处于 active，由 `activeBackendId` 选定。每个 backend 都
 * 可以 enabled/disabled，方便保留多套配置但临时切换。
 */
import type {
  MusicAlbumDetail,
  MusicArtist,
  MusicArtistWorksResult,
  MusicComment,
  MusicQuality,
  MusicSearchType,
  MusicSong,
  IRecommendSheet,
  IRecommendSheetTagsResult,
} from "../types";

export type MusicBackendKind = "musicapi" | "lxmusic" | "plugin" | "builtin";

export const MUSIC_BACKEND_LABELS: Record<MusicBackendKind, string> = {
  musicapi: "MusicApi-V2",
  lxmusic: "LX-Music Server",
  plugin: "MusicFree 插件",
  builtin: "内置音乐源",
};

interface MusicBackendBase {
  id: string;
  name: string;
  enabled: boolean;
  addedAt: number;
}

export interface MusicApiBackend extends MusicBackendBase {
  kind: "musicapi";
  baseUrl: string;
  /** 部分部署支持 X-API-Key 鉴权 / 部分允许匿名 */
  token: string;
}

export interface LxMusicBackend extends MusicBackendBase {
  kind: "lxmusic";
  /** 例如 http://192.168.1.10:1233 */
  baseUrl: string;
  /** lx-music-api-server 启动时配置的 auth key（HTTP Header `X-LX-AUTH`） */
  authKey: string;
}

export interface PluginBackend extends MusicBackendBase {
  kind: "plugin";
  /** 插件源码（JS） */
  code: string;
  /** 远端拉取地址（用于"更新"按钮） */
  sourceUrl?: string;
  /** 插件自报版本（meta.version），方便比较 */
  version?: string;
  /** 插件覆盖的平台标识，仅用于 UI 展示 */
  platform?: string;
}

export interface BuiltinBackend extends MusicBackendBase {
  kind: "builtin";
}

export type MusicBackend =
  | MusicApiBackend
  | LxMusicBackend
  | PluginBackend
  | BuiltinBackend;

export interface BackendSearchArgs {
  keyword: string;
  page: number;
  pageSize: number;
  type?: MusicSearchType;
}

export interface BackendSearchResult {
  list: MusicSong[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 每种 backend 实现这个接口。dispatcher 在调用前会把 backend 实例传入。
 * 除 `search` / `parse` 外都是可选 —— UI 用 `capabilities` 判断是否渲染入口。
 */
export interface MusicBackendRuntime {
  kind: MusicBackendKind;
  capabilities: {
    search: boolean;
    parse: boolean;
    lyrics: boolean;
    toplists: boolean;
    playlists: boolean;
    albums: boolean;
    artists: boolean;
    recommendSheets: boolean;
    comments: boolean;
    /** 是否提供热门搜索词 */
    hotSearch: boolean;
    /** 是否支持除 'music' 之外的搜索类型 */
    multiTypeSearch: boolean;
  };

  /** 用户变量 schema（仅 plugin backend 提供，供 settings UI 渲染表单） */
  userVariablesSchema?: Array<{ key: string; name?: string; hint?: string }>;

  search(args: BackendSearchArgs): Promise<BackendSearchResult>;
  searchAlbums?(args: BackendSearchArgs): Promise<{ list: MusicAlbumDetail[]; isEnd?: boolean }>;
  searchArtists?(args: BackendSearchArgs): Promise<{ list: MusicArtist[]; isEnd?: boolean }>;
  searchSheets?(args: BackendSearchArgs): Promise<{ list: IRecommendSheet[]; isEnd?: boolean }>;

  parse(
    song: MusicSong,
    quality: MusicQuality
  ): Promise<{ url: string; cached?: boolean; headers?: Record<string, string> }>;

  getToplists?(): Promise<Array<{ id: string; name: string; cover?: string; description?: string }>>;
  getToplistDetail?(id: string, page?: number): Promise<{
    id: string;
    name: string;
    cover?: string;
    description?: string;
    songs: MusicSong[];
    isEnd?: boolean;
  }>;
  getPlaylistDetail?(id: string, page?: number): Promise<{
    id: string;
    name: string;
    cover?: string;
    description?: string;
    creator?: string;
    songs: MusicSong[];
    isEnd?: boolean;
  }>;

  getAlbumDetail?(albumId: string, page?: number): Promise<MusicAlbumDetail>;
  getArtistDetail?(artistId: string): Promise<MusicArtist>;
  getArtistWorks?<T extends "music" | "album">(
    artistId: string,
    page: number,
    type: T
  ): Promise<MusicArtistWorksResult<T>>;

  getRecommendSheetTags?(): Promise<IRecommendSheetTagsResult>;
  getRecommendSheetsByTag?(
    tagId: string,
    page?: number
  ): Promise<{ list: IRecommendSheet[]; isEnd?: boolean }>;

  getMusicComments?(
    song: MusicSong,
    page?: number
  ): Promise<{ list: MusicComment[]; isEnd?: boolean }>;

  /** 拉歌词文本（已是 LRC 文本格式）。不支持时返回空串。 */
  fetchLyrics?(song: MusicSong): Promise<string>;
  /** 拉译文歌词（LRC 文本，按时间码对齐 rawLrc）。可空。 */
  fetchTranslatedLyrics?(song: MusicSong): Promise<string>;

  /** 元信息查询（补全 cover / album / artistId 等） */
  getMusicInfo?(song: MusicSong): Promise<Partial<MusicSong>>;

  /** 把分享链接 / 网页 URL 导入为歌单的歌曲列表 */
  importMusicSheet?(urlLike: string): Promise<MusicSong[]>;
  importMusicItem?(urlLike: string): Promise<MusicSong | null>;

  /** 热门搜索词 */
  getHotSearch?(): Promise<string[]>;
}
