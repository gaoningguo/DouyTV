// 漫画模块类型 —— 移植自 MoonTVPlus src/lib/manga.types.ts。
// 后端是外部 Suwayomi 服务(GraphQL),本项目做 GraphQL 客户端 + 图片代理。

export interface MangaSource {
  id: string;
  name: string;
  lang?: string;
  displayName?: string;
}

export interface MangaSearchItem {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  cover: string;
  description?: string;
  author?: string;
  status?: string;
  artist?: string;
  genre?: string;
}

export interface MangaSearchFailure {
  sourceId: string;
  sourceName: string;
  error: string;
}

export interface MangaSearchResult {
  results: MangaSearchItem[];
  failedSources: MangaSearchFailure[];
}

export type MangaRecommendType = "POPULAR" | "LATEST";

export interface MangaRecommendResult {
  mangas: MangaSearchItem[];
  hasNextPage: boolean;
}

export interface MangaChapter {
  id: string;
  mangaId: string;
  name: string;
  chapterNumber?: number;
  scanlator?: string;
  isRead?: boolean;
  isDownloaded?: boolean;
  pageCount?: number;
  uploadDate?: number;
}

export interface MangaDetail extends MangaSearchItem {
  chapters: MangaChapter[];
}

export interface MangaShelfItem {
  title: string;
  cover: string;
  sourceId: string;
  sourceName: string;
  mangaId: string;
  saveTime: number;
  description?: string;
  author?: string;
  status?: string;
  lastChapterId?: string;
  lastChapterName?: string;
}

export interface MangaReadRecord {
  title: string;
  cover: string;
  sourceId: string;
  sourceName: string;
  mangaId: string;
  chapterId: string;
  chapterName: string;
  pageIndex: number;
  pageCount: number;
  saveTime: number;
}

/**
 * Suwayomi 服务连接配置(对应 MoonTVPlus 的 SuwayomiConfig)。
 * 存在 manga store(localStorage),由用户在设置里填。
 */
export interface SuwayomiConfig {
  enabled: boolean;
  serverUrl: string;
  authMode: "none" | "basic_auth" | "simple_login";
  username?: string;
  password?: string;
  defaultLang: string;
  /** 限定可用源 id(空 = 全部)。 */
  sourceIds: string[];
  maxSources: number;
}

export const DEFAULT_SUWAYOMI_CONFIG: SuwayomiConfig = {
  enabled: false,
  serverUrl: "",
  authMode: "none",
  username: "",
  password: "",
  defaultLang: "zh",
  sourceIds: [],
  maxSources: 10,
};

export function mangaItemKey(sourceId: string, mangaId: string): string {
  return `${sourceId}:${mangaId}`;
}
