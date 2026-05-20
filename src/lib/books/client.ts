/**
 * OPDS client。所有 HTTP 走 scriptFetch（绕 CORS + 跟随系统代理）。
 * Basic Auth / Header Auth 在请求头里手动加 —— ureq 自动跟随重定向，cookies 不持久（OPDS 通常不依赖）。
 */
import { scriptFetch } from "@/source-script/fetch";
import { extractSearchTemplate, parseOpdsFeed, resolveHref } from "./opds";
import type {
  BookAcquisitionLink,
  BookCatalogResult,
  BookSearchResult,
  BookSource,
} from "./types";

function authHeaders(source: BookSource): Record<string, string> {
  if (source.authMode === "basic" && source.username) {
    const cred = btoa(`${source.username}:${source.password ?? ""}`);
    return { Authorization: `Basic ${cred}` };
  }
  if (source.authMode === "header" && source.headerName) {
    return { [source.headerName]: source.headerValue ?? "" };
  }
  return {};
}

/** 拉 OPDS feed → 解析为 catalog result。 */
export async function fetchCatalog(
  source: BookSource,
  href?: string
): Promise<BookCatalogResult> {
  const url = href || source.url;
  const res = await scriptFetch(url, {
    method: "GET",
    headers: { Accept: "application/atom+xml,application/xml,text/xml,*/*", ...authHeaders(source) },
    timeout: 30_000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  return parseOpdsFeed(xml, url, source);
}

/**
 * 搜索 — 优先用 source.searchTemplate（已含 {searchTerms} 占位的 URL）；
 * 没有就 fallback 用 source.url 拉一次 root feed 提取 OpenSearch template。
 */
export async function searchBooks(
  source: BookSource,
  keyword: string
): Promise<BookSearchResult> {
  let template = source.searchTemplate;
  if (!template) {
    // 拉 root feed 提取 search link
    const rootRes = await scriptFetch(source.url, {
      method: "GET",
      headers: { Accept: "application/atom+xml,application/xml,text/xml", ...authHeaders(source) },
      timeout: 30_000,
    });
    if (!rootRes.ok) throw new Error(`HTTP ${rootRes.status}`);
    const xml = await rootRes.text();
    template = extractSearchTemplate(xml, source.url);
    if (!template) {
      throw new Error("此 OPDS 源不支持搜索（无 {searchTerms} 模板）");
    }
  }
  const url = template.replace(/\{searchTerms\}/g, encodeURIComponent(keyword));
  const catalog = await fetchCatalog(source, url);
  return { results: catalog.entries };
}

/**
 * 拉取 EPUB / PDF 二进制。返回 ArrayBuffer。
 * 调用方可以用 Tauri fs 写到 appDataDir/books-cache/...，或直接喂给 epub.js。
 */
export async function downloadAcquisition(
  source: BookSource,
  link: BookAcquisitionLink
): Promise<ArrayBuffer> {
  const url = resolveHref(link.href, source.url);
  const res = await scriptFetch(url, {
    method: "GET",
    headers: { Accept: link.type || "*/*", ...authHeaders(source) },
    timeout: 120_000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = await res.bytes();
  // 拷贝出独立的 ArrayBuffer（bytes 的底层可能是 SharedArrayBuffer，epubjs 要 ArrayBuffer）
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}
