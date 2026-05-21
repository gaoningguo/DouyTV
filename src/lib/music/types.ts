/**
 * Music 域类型。
 *
 * **关键**：`MusicSource` 是 `string` 别名而非字面量联合 —— builtin/plugin backend
 * 可声明任意 platform id（如插件的 `plugin:netease-cloud`、`bilibili-audio` 等），
 * 不能限制成内置 5 个平台。UI 选项的默认 5 项还是用 `MUSIC_SOURCES` 常量数组。
 */

export type MusicSource = string;

export const MUSIC_SOURCES: { id: MusicSource; label: string }[] = [
  { id: "wy", label: "网易云" },
  { id: "tx", label: "QQ 音乐" },
  { id: "kw", label: "酷我" },
  { id: "kg", label: "酷狗" },
  { id: "mg", label: "咪咕" },
];

export type MusicQuality = "128k" | "192k" | "320k" | "flac";

export const MUSIC_QUALITIES: { id: MusicQuality; label: string }[] = [
  { id: "128k", label: "标准 128k" },
  { id: "192k", label: "较高 192k" },
  { id: "320k", label: "高品 320k" },
  { id: "flac", label: "无损 FLAC" },
];

export type MusicRepeatMode = "single" | "list" | "shuffle";

export const MUSIC_REPEAT_MODES: { id: MusicRepeatMode; label: string }[] = [
  { id: "list", label: "列表循环" },
  { id: "single", label: "单曲循环" },
  { id: "shuffle", label: "随机播放" },
];

export type MusicSearchType = "music" | "album" | "artist" | "sheet";

export const MUSIC_SEARCH_TYPES: { id: MusicSearchType; label: string }[] = [
  { id: "music", label: "歌曲" },
  { id: "sheet", label: "歌单" },
  { id: "album", label: "专辑" },
  { id: "artist", label: "歌手" },
];

export interface MusicSong {
  songId: string;
  source: MusicSource;
  songmid?: string;
  name: string;
  artist?: string;
  album?: string;
  /** 歌手 ID（点击进入 ArtistDetail） */
  artistId?: string;
  /** 专辑 ID（点击进入 AlbumDetail） */
  albumId?: string;
  cover?: string;
  durationSec?: number;
  durationText?: string;
  hash?: string;
  copyrightId?: string;
  /** 歌词文件 URL */
  lrcUrl?: string;
  /** 多行歌词 URL */
  mrcUrl?: string;
  /** 翻译歌词 URL */
  trcUrl?: string;
  /** 已知该平台支持的音质等级（部分平台会返回） */
  qualities?: MusicQuality[];
}

export interface MusicResolvedSong extends MusicSong {
  url: string;
  quality: MusicQuality;
  /** 服务端标记 OpenList 缓存 */
  cached?: boolean;
  /** 解析阶段需要的额外 header */
  headers?: Record<string, string>;
}

export interface MusicSearchResult {
  list: MusicSong[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MusicToplist {
  id: string;
  source?: MusicSource;
  name: string;
  cover?: string;
  description?: string;
  updateFrequency?: string;
}

export interface MusicPlaylistDetail {
  id: string;
  source?: MusicSource;
  name: string;
  cover?: string;
  description?: string;
  creator?: string;
  /** 播放次数，仅在线歌单有 */
  playCount?: number;
  songs: MusicSong[];
  /** 分页：是否到底 */
  isEnd?: boolean;
}

export interface MusicAlbum {
  id: string;
  source: MusicSource;
  name: string;
  cover?: string;
  description?: string;
  artist?: string;
  artistId?: string;
  publishDate?: string;
  songCount?: number;
}

export interface MusicAlbumDetail extends MusicAlbum {
  songs: MusicSong[];
  isEnd?: boolean;
}

export interface MusicArtist {
  id: string;
  source: MusicSource;
  name: string;
  avatar?: string;
  description?: string;
  worksNum?: number;
  albumNum?: number;
  fans?: number;
}

export interface MusicArtistWorksResult<T extends MusicSearchType> {
  type: T;
  list: T extends "music" ? MusicSong[] : T extends "album" ? MusicAlbum[] : never;
  isEnd?: boolean;
}

export interface MusicComment {
  id: string;
  user: string;
  avatar?: string;
  content: string;
  /** 时间戳（毫秒） */
  publishedAt?: number;
  likeCount?: number;
  /** 父评论（楼中楼）— 只展示一层 */
  reply?: Pick<MusicComment, "user" | "content">;
}

export interface IRecommendSheetTag {
  id: string;
  name: string;
}

export interface IRecommendSheetTagGroup {
  title: string;
  tags: IRecommendSheetTag[];
}

export interface IRecommendSheetTagsResult {
  pinned: IRecommendSheetTag[];
  groups: IRecommendSheetTagGroup[];
}

export interface IRecommendSheet {
  id: string;
  source: MusicSource;
  name: string;
  cover?: string;
  description?: string;
  playCount?: number;
  creator?: string;
}

export interface MusicHistoryRecord extends MusicSong {
  positionSec: number;
  lastPlayedAt: number;
  playCount: number;
}

export interface MusicPlaylistRecord {
  id: string;
  name: string;
  description?: string;
  cover?: string;
  songCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface MusicFavoriteRecord extends MusicSong {
  favoritedAt: number;
}

export interface MusicLyricLine {
  /** 秒 */
  time: number;
  text: string;
  /** 翻译（可选） */
  translation?: string;
}

/** 完整解析后的歌词（含可能的翻译） */
export interface MusicLyric {
  raw: string;
  lines: MusicLyricLine[];
  hasTranslation: boolean;
  /** offset 标签（秒）— LRC 中的 [offset:N] */
  offsetSec: number;
}
