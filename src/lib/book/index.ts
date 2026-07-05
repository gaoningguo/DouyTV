// 小说模块统一入口 —— UI 通过这里访问书源引擎。
//
// MoonTVPlus 的 UI 走 /api/books/* 服务端路由。DouyTV 无服务端,UI 直接调这里的函数,
// 内部转发到 bookProvider(opds/legado 分发)与 legadoClient(章节/正文,OPDS 走文件流)。
// 章节型(Legado)与文件型(OPDS epub/pdf)两条阅读路径都在此聚合。

import { bookProvider } from "./provider";
import { legadoClient } from "./legado.client";
import type {
  BookChapter,
  BookChapterContent,
  BookDetail,
  BookSearchResult,
  BookSource,
} from "./types";

export * from "./types";
export { bookProvider } from "./provider";

/** 是否配置了任何启用的书源。 */
export async function isBookConfigured(): Promise<boolean> {
  const sources = await bookProvider.getSources().catch(() => []);
  return sources.length > 0;
}

export function getBookSources(): Promise<BookSource[]> {
  return bookProvider.getSources();
}

export function searchBooks(q: string, sourceId?: string): Promise<BookSearchResult> {
  return bookProvider.searchBooks(q, sourceId);
}

export function getBookDetail(
  sourceId: string,
  href: string,
  fallback?: Partial<BookDetail>
): Promise<BookDetail> {
  return bookProvider.getBookDetail(sourceId, href, fallback);
}

/** 章节型书源(Legado)：拿目录。href 为目录页地址。 */
export function getBookChapters(
  sourceId: string,
  tocHref: string
): Promise<BookChapter[]> {
  return legadoClient.getChapters(sourceId, tocHref);
}

/** 章节型书源(Legado)：拿正文。 */
export function getBookChapterContent(
  sourceId: string,
  chapterHref: string,
  tocHref?: string
): Promise<BookChapterContent> {
  return legadoClient.getChapterContent(sourceId, chapterHref, tocHref);
}

/** 取首选下载/阅读源(章节 or epub/pdf 文件)。 */
export function getPreferredAcquisition(
  sourceId: string,
  href: string
): Promise<{ format: "epub" | "pdf" | "chapters"; href: string }> {
  return bookProvider.getPreferredAcquisition(sourceId, href);
}
