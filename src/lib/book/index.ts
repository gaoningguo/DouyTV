// 小说模块统一入口 —— UI 通过这里访问书源引擎。
//
// MoonTVPlus 的 UI 走 /api/books/* 服务端路由。DouyTV 无服务端,UI 直接调这里的函数,
// 内部转发到 bookProvider(opds/legado 分发)与 legadoClient(章节/正文,OPDS 走文件流)。
// 章节型(Legado)与文件型(OPDS epub/pdf)两条阅读路径都在此聚合。

import { bookProvider } from "./provider";
import { legadoClient } from "./legado.client";
import { readingFetchBytes } from "@/lib/reading/net";
import type {
  BookCatalogResult,
  BookChapter,
  BookChapterContent,
  BookDetail,
  BookListItem,
  BookSearchFailure,
  BookSearchResult,
  BookSource,
} from "./types";
import { b64encode } from "./legado-crypto";

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

/** 流式多源搜索(结果增量刷新 + 完成进度)。等价 MoonTVPlus 的 fluid search。 */
export function searchBooksStream(
  q: string,
  handlers: {
    onStart?: (total: number) => void;
    onSourceResult?: (
      source: BookSource,
      results: BookListItem[],
      done: number,
      total: number
    ) => void;
    onSourceError?: (
      failure: BookSearchFailure,
      done: number,
      total: number
    ) => void;
  },
  sourceId?: string
): Promise<BookSearchResult> {
  return bookProvider.searchBooksStream(q, handlers, sourceId);
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

/** 目录 / 发现浏览(OPDS 导航树 + Legado explore 分类)。 */
export function getBookCatalog(
  sourceId: string,
  href?: string
): Promise<BookCatalogResult> {
  return bookProvider.getCatalog(sourceId, href);
}

export interface BookFileResult {
  bytes: Uint8Array;
  mimeType: string;
}

/**
 * 下载 epub/pdf 文件字节(带书源鉴权)。对标 MoonTVPlus 的 /api/books/file。
 * 走 readingFetchBytes(Rust script_http_bytes,绕 CORS,32MB 上限);
 * 大于上限的 epub 会失败,由上层提示。
 */
export async function getBookFileBytes(
  sourceId: string,
  fileUrl: string,
  onProgress?: (received: number, total: number | null) => void
): Promise<BookFileResult> {
  const source = await bookProvider.getSourceById(sourceId);
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
  };
  if (source.authMode === "basic" && source.username) {
    headers.Authorization = `Basic ${b64encode(`${source.username}:${source.password || ""}`)}`;
  } else if (source.authMode === "header" && source.headerName && source.headerValue) {
    headers[source.headerName] = source.headerValue;
  }
  const res = await readingFetchBytes(fileUrl, { headers });
  if (!res.ok) throw new Error(`文件下载失败: ${res.status}`);
  // script_http_bytes 一次性返回完整字节,无法真正流式;这里给个完成回调保持 UI 契约。
  onProgress?.(res.bytes.length, res.bytes.length);
  return {
    bytes: res.bytes,
    mimeType: res.headers["content-type"] || "application/octet-stream",
  };
}

/** 供 provider 外部按 id 取源(下载鉴权用)。 */
export function getBookSourceById(sourceId: string): Promise<BookSource> {
  return bookProvider.getSourceById(sourceId);
}
