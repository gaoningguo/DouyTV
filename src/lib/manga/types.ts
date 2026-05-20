/**
 * Manga types — 对齐 MoonTVPlus/src/lib/manga.types.ts。
 * Suwayomi-Server (Tachidesk) 的实体子集。
 */

export interface MangaSource {
  id: string;
  name: string;
  lang?: string;
  displayName?: string;
  iconUrl?: string;
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
  sourceId: string;
  mangaId: string;
  title: string;
  cover?: string;
  author?: string;
  status?: string;
  lastChapterId?: string;
  lastChapterName?: string;
  savedAt: number;
}

export interface MangaHistoryRecord {
  sourceId: string;
  mangaId: string;
  chapterId: string;
  chapterName?: string;
  pageIndex: number;
  pageCount: number;
  updatedAt: number;
}
