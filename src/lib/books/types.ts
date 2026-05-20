/**
 * Books types — 对齐 MoonTVPlus/src/lib/book.types.ts 的核心字段。
 * 只保留 DouyTV MVP 实际使用的子集。
 */

export type BookAuthMode = "none" | "basic" | "header";

export interface BookSource {
  id: string;
  name: string;
  url: string;
  enabled?: boolean;
  authMode?: BookAuthMode;
  username?: string;
  password?: string;
  headerName?: string;
  headerValue?: string;
  /** 搜索模板（OPDS searchTemplate href）— 没有则禁用搜索 */
  searchTemplate?: string;
  preferFormat?: Array<"epub" | "pdf">;
  language?: string;
  /** 添加时间 */
  addedAt?: number;
}

export interface BookAcquisitionLink {
  rel: string;
  type: string;
  href: string;
  title?: string;
}

export interface BookNavLink {
  title: string;
  href: string;
  rel?: string;
  type?: string;
}

export interface BookListItem {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  author?: string;
  cover?: string;
  summary?: string;
  language?: string;
  published?: string;
  detailHref?: string;
  acquisitionLinks: BookAcquisitionLink[];
}

export interface BookCatalogResult {
  sourceId: string;
  sourceName: string;
  title: string;
  subtitle?: string;
  href: string;
  entries: BookListItem[];
  navigation: BookNavLink[];
  nextHref?: string;
  previousHref?: string;
}

export interface BookSearchResult {
  results: BookListItem[];
}

export interface BookProgressRecord {
  sourceId: string;
  bookId: string;
  locatorType: "epub-cfi" | "pdf-page" | "href";
  locatorValue: string;
  chapterTitle?: string;
  percent: number;
  updatedAt: number;
}

export interface BookShelfItem {
  sourceId: string;
  bookId: string;
  title: string;
  author?: string;
  cover?: string;
  summary?: string;
  acquisitionLinks: BookAcquisitionLink[];
  savedAt: number;
}
