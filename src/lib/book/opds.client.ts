/* eslint-disable @typescript-eslint/no-explicit-any */
// OPDS Atom feed 目录客户端 —— 移植自 MoonTVPlus src/lib/opds.client.ts。
//
// 与原项目差异(Next.js server → Tauri client),仅换 Node/server 原语,解析逻辑不变:
//   - XML 解析 `xml2js`(嵌套对象) → `cheerio` xmlMode(DOM/选择器)。
//     整条 feed 解析管线(parseFeed/parseEntry/parseLinks)改成走 cheerio DOM,
//     产出与原来完全一致的 ParsedFeed / ParsedFeedEntry / ParsedFeedLink 形状。
//   - Node `fetch` + AbortController → `readingFetchText`(走 Rust script_http_bytes,
//     绕 CORS,自动按 charset 解码)。
//   - Basic Auth `Buffer.from().toString('base64')` → `b64encode`(浏览器可用,支持非 ASCII)。
//   - 封面代理 `/api/books/file?...` 服务端路由 → 前端 `wrapImage`(dyproxy /proxy/image)。
//   - 配置来自 book config(localStorage)而非服务端 getConfig()/env。

import * as cheerio from 'cheerio';
import { readingFetchText } from '@/lib/reading/net';
import { wrapImage } from '@/lib/proxy';
import { b64encode } from './legado-crypto';
import { resolveOpdsSources } from './config';
import type {
  BookAcquisitionLink,
  BookCatalogResult,
  BookDetail,
  BookListItem,
  BookSearchFailure,
  BookSearchResult,
  BookSource,
  BookSourceCapabilities,
} from './types';

interface ResolvedOPDSConfig {
  enabled: boolean;
  sources: BookSource[];
  cacheTTL: number;
}

interface ParsedFeedLink {
  href: string;
  rel?: string;
  type?: string;
  title?: string;
}

interface ParsedFeedEntry {
  id: string;
  title: string;
  author?: string;
  summary?: string;
  content?: string;
  language?: string;
  published?: string;
  updated?: string;
  categories: string[];
  links: ParsedFeedLink[];
}

interface ParsedFeed {
  title: string;
  subtitle?: string;
  id?: string;
  links: ParsedFeedLink[];
  entries: ParsedFeedEntry[];
}

const DEFAULT_TIMEOUT_MS = 20000;
const feedCache = new Map<string, { expiresAt: number; data: ParsedFeed }>();
const sourceCapabilityCache = new Map<string, { expiresAt: number; data: BookSourceCapabilities }>();
const SOURCE_CAPABILITY_SUCCESS_TTL_MS = 6 * 60 * 60 * 1000;
const SOURCE_CAPABILITY_FAILURE_TTL_MS = 30 * 1000;

function sanitizeXmlForParsing(xml: string): string {
  return xml
    .replace(/^\uFEFF/, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/&(?!(?:#\d+|#x[a-fA-F0-9]+|amp|lt|gt|quot|apos);)/g, '&amp;');
}

// cheerio xmlMode 加载,失败时先 sanitize 再重试(替代原 parseXmlWithFallback)。
function loadXml(xml: string): cheerio.CheerioAPI {
  try {
    return cheerio.load(xml, { xmlMode: true });
  } catch (error) {
    const sanitizedXml = sanitizeXmlForParsing(xml);
    if (sanitizedXml === xml) throw error;
    return cheerio.load(sanitizedXml, { xmlMode: true });
  }
}

// 取元素 tagName(小写)。cheerio xmlMode 保留命名空间前缀(如 dc:language),这里统一小写比较。
function tagOf(el: any): string {
  return String((el && (el.tagName || el.name)) || '').toLowerCase();
}

// feed/entry 的直接子元素里,按 tagNames 的偏好顺序返回首个非空文本。
// 对应 xml2js 里的 `entry.language?.[0] || entry['dc:language']?.[0]` 这类偏好回退。
// 命名空间标签(dc:language / dc:issued)靠 tagName 比较匹配,不用选择器转义。
function childText($: cheerio.CheerioAPI, el: any, tagNames: string[]): string {
  for (const tag of tagNames) {
    const wanted = tag.toLowerCase();
    let found = '';
    $(el)
      .children()
      .each((_i, child) => {
        if (found) return;
        if (tagOf(child) === wanted) {
          const text = $(child).text().trim();
          if (text) found = text;
        }
      });
    if (found) return found;
  }
  return '';
}

// 直接子元素中 tag 名匹配的元素列表(仅一层,不递归)。
function childrenNamed($: cheerio.CheerioAPI, el: any, tag: string): any[] {
  const wanted = tag.toLowerCase();
  const out: any[] = [];
  $(el)
    .children()
    .each((_i, child) => {
      if (tagOf(child) === wanted) out.push(child);
    });
  return out;
}

// <author><name>…</name></author>,兼容 <author>纯文本</author>。
function authorText($: cheerio.CheerioAPI, el: any): string {
  const authors = childrenNamed($, el, 'author');
  for (const a of authors) {
    const nameText = childText($, a, ['name']);
    if (nameText) return nameText;
    const own = $(a).text().trim();
    if (own) return own;
  }
  return '';
}

function normalizeUrl(base: string, href?: string): string {
  if (!href) return base;
  return new URL(href, base).toString();
}

function mapFormat(type: string): 'epub' | 'pdf' | null {
  const lower = type.toLowerCase();
  if (lower.includes('epub')) return 'epub';
  if (lower.includes('pdf')) return 'pdf';
  return null;
}

function isAcquisitionRel(rel?: string): boolean {
  return !!rel && rel.includes('opds-spec.org/acquisition');
}

function isNavigationRel(rel?: string): boolean {
  return rel === 'subsection' || rel === 'collection' || rel === 'start';
}

function isNavigationLink(link: ParsedFeedLink): boolean {
  const type = (link.type || '').toLowerCase();
  return isNavigationRel(link.rel) || type.includes('kind=navigation') || (type.includes('opds-catalog') && !isAcquisitionRel(link.rel));
}

function isCoverRel(rel?: string): boolean {
  if (!rel) return false;
  const normalized = rel.toLowerCase();
  return normalized.includes('opds-spec.org/cover')
    || normalized.includes('opds-spec.org/image')
    || normalized.includes('image/thumbnail')
    || normalized === 'thumbnail'
    || normalized === 'cover';
}

function isImageType(type?: string): boolean {
  return !!type && type.toLowerCase().startsWith('image/');
}

function pickCoverLink(links: ParsedFeedLink[]): string | undefined {
  const thumbnail = links.find((link) => {
    const rel = (link.rel || '').toLowerCase();
    return rel.includes('thumbnail') && (isCoverRel(link.rel) || isImageType(link.type));
  });
  const cover = thumbnail
    || links.find((link) => isCoverRel(link.rel))
    || links.find((link) => isImageType(link.type) && !isAcquisitionRel(link.rel));
  return cover?.href;
}

function pickDetailHref(links: ParsedFeedLink[]): string | undefined {
  const preferred = links.find((link) => link.rel === 'alternate' && (link.type || '').includes('atom+xml'))
    || links.find((link) => link.rel === 'self' && (link.type || '').includes('atom+xml'))
    || links.find((link) => isNavigationLink(link));
  return preferred?.href;
}

function extractAcquisitionLinks(entry: ParsedFeedEntry): BookAcquisitionLink[] {
  return entry.links
    .filter((link) => isAcquisitionRel(link.rel) || mapFormat(link.type || '') !== null)
    .map((link) => ({
      rel: link.rel || 'http://opds-spec.org/acquisition',
      type: link.type || 'application/octet-stream',
      href: link.href,
      title: link.title,
      isIndirect: !!link.rel?.includes('indirect'),
    }));
}

function isLikelyNavigationEntry(entry: ParsedFeedEntry): boolean {
  const hasAcquisition = extractAcquisitionLinks(entry).length > 0;
  const hasNavigationLink = entry.links.some((link) => isNavigationLink(link));
  return hasNavigationLink && !hasAcquisition;
}

function mapEntryToItem(source: BookSource, entry: ParsedFeedEntry): BookListItem {
  const acquisitionLinks = extractAcquisitionLinks(entry);

  return {
    id: entry.id || pickDetailHref(entry.links) || acquisitionLinks[0]?.href || entry.title,
    sourceId: source.id,
    sourceName: source.name,
    title: entry.title || '未命名电子书',
    author: entry.author,
    // coverHref 在解析阶段已 normalize 成绝对地址;封面走 wrapImage(dyproxy /proxy/image)绕防盗链。
    cover: (() => { const coverHref = pickCoverLink(entry.links); return coverHref ? (wrapImage(coverHref) || coverHref) : undefined; })(),
    summary: entry.summary || entry.content || undefined,
    language: entry.language,
    published: entry.published,
    updated: entry.updated,
    tags: entry.categories,
    detailHref: pickDetailHref(entry.links),
    acquisitionLinks,
  };
}

function mapEntryToDetail(source: BookSource, entry: ParsedFeedEntry): BookDetail {
  const item = mapEntryToItem(source, entry);
  return {
    ...item,
    categories: entry.categories,
    navigation: entry.links
      .filter((link) => isNavigationRel(link.rel))
      .map((link) => ({ title: link.title || entry.title, href: link.href, rel: link.rel, type: link.type })),
  };
}

async function resolveOPDSConfig(): Promise<ResolvedOPDSConfig> {
  // resolveOpdsSources 已按 type/enabled/legado 过滤,DouyTV 无服务端开关,默认启用。
  return {
    enabled: true,
    cacheTTL: 10 * 60 * 1000,
    sources: await resolveOpdsSources(),
  };
}

function buildHeaders(source: BookSource): Record<string, string> {
  if (source.authMode === 'basic' && source.username) {
    return {
      Authorization: `Basic ${b64encode(`${source.username}:${source.password || ''}`)}`,
    };
  }
  if (source.authMode === 'header' && source.headerName && source.headerValue) {
    return {
      [source.headerName]: source.headerValue,
    };
  }
  return {};
}

async function fetchText(url: string, headers: Record<string, string>): Promise<string> {
  const res = await readingFetchText(url, { headers, timeout: DEFAULT_TIMEOUT_MS });
  if (!res.ok) throw new Error(`请求失败: ${res.status}`);
  return res.text;
}

function parseLinks($: cheerio.CheerioAPI, els: any[], baseUrl: string): ParsedFeedLink[] {
  return els
    .map((el) => ({
      href: normalizeUrl(baseUrl, $(el).attr('href')),
      rel: $(el).attr('rel'),
      type: $(el).attr('type'),
      title: $(el).attr('title'),
    }))
    .filter((item) => !!item.href);
}

function parseEntry($: cheerio.CheerioAPI, el: any, baseUrl: string): ParsedFeedEntry {
  return {
    id: childText($, el, ['id']),
    title: childText($, el, ['title']),
    author: authorText($, el),
    summary: childText($, el, ['summary']),
    content: childText($, el, ['content']),
    language: childText($, el, ['language', 'dc:language']),
    published: childText($, el, ['published', 'dc:issued']),
    updated: childText($, el, ['updated']),
    categories: childrenNamed($, el, 'category')
      .map((item) => $(item).attr('label') || $(item).attr('term') || '')
      .filter(Boolean),
    links: parseLinks($, childrenNamed($, el, 'link'), baseUrl),
  };
}

function parseFeed(xml: string, baseUrl: string): ParsedFeed {
  const $ = loadXml(xml);
  const feedEl = $('feed').first();

  if (feedEl.length) {
    const feedNode = feedEl[0];
    return {
      title: childText($, feedNode, ['title']) || '电子书目录',
      subtitle: childText($, feedNode, ['subtitle']),
      id: childText($, feedNode, ['id']),
      links: parseLinks($, childrenNamed($, feedNode, 'link'), baseUrl),
      entries: childrenNamed($, feedNode, 'entry').map((entry) => parseEntry($, entry, baseUrl)),
    };
  }

  // 裸 <entry> 当作单条目 feed(对应原 parsed.entry 分支)。
  const entryEl = $('entry').first();
  if (!entryEl.length) throw new Error('无法解析 OPDS feed');
  return {
    title: '电子书目录',
    subtitle: '',
    id: '',
    links: [],
    entries: [parseEntry($, entryEl[0], baseUrl)],
  };
}

function fillSearchTermsTemplate(template: string, keyword: string) {
  const encoded = encodeURIComponent(keyword);
  const replaced = template
    .replace(/\{searchTerms[^}]*\}/g, encoded)
    .replace(/\{count[^}]*\}/g, '20')
    .replace(/\{startIndex[^}]*\}/g, '0')
    .replace(/\{startPage[^}]*\}/g, '1')
    .replace(/\{language[^}]*\}/g, '')
    .replace(/\{inputEncoding[^}]*\}/g, 'UTF-8')
    .replace(/\{outputEncoding[^}]*\}/g, 'UTF-8')
    .replace(/\{source[^}]*\}/g, '')
    .replace(/\{[^}]+\}/g, '');

  try {
    const url = new URL(replaced);
    const toDelete: string[] = [];
    url.searchParams.forEach((value, key) => {
      if (!value || value === 'undefined' || value === 'null') toDelete.push(key);
    });
    toDelete.forEach((key) => url.searchParams.delete(key));
    return url.toString();
  } catch {
    return replaced
      .replace(/[?&](?:[^=]+)=(&|$)/g, '$1')
      .replace(/[?&]$/, '');
  }
}

async function resolveSearchTargetUrl(source: BookSource, q: string): Promise<string> {
  if (source.searchTemplate) {
    return fillSearchTermsTemplate(source.searchTemplate, q);
  }

  const rootFeed = await getFeed(source);
  const searchLink = rootFeed.links.find((link) => link.rel === 'search');
  if (!searchLink?.href) throw new Error('该书源不支持搜索');

  if ((searchLink.type || '').toLowerCase().includes('opensearchdescription+xml')) {
    const xml = await fetchText(searchLink.href, buildHeaders(source));
    const $ = loadXml(xml);
    // OpenSearchDescription 里的 <Url template="…" type="…">,兼容命名空间前缀,按 tagName 收集。
    const urlNodes: any[] = [];
    $('*').each((_i, el) => {
      if (tagOf(el) === 'url') urlNodes.push(el);
    });
    const preferred = urlNodes.find((el) => ($(el).attr('type') || '').toLowerCase().includes('atom+xml')) || urlNodes[0];
    const template = preferred ? $(preferred).attr('template') : undefined;
    if (!template) throw new Error('未找到搜索模板');
    return fillSearchTermsTemplate(normalizeUrl(searchLink.href, template), q);
  }

  return searchLink.href.includes('{searchTerms}')
    ? searchLink.href.replace('{searchTerms}', encodeURIComponent(q))
    : `${searchLink.href}${searchLink.href.includes('?') ? '&' : '?'}q=${encodeURIComponent(q)}`;
}

async function getFeed(source: BookSource, href?: string): Promise<ParsedFeed> {
  const target = normalizeUrl(source.url, href || source.url);
  const cacheKey = `${source.id}|${target}`;
  const cached = feedCache.get(cacheKey);
  const { cacheTTL } = await resolveOPDSConfig();
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const xml = await fetchText(target, buildHeaders(source));
  const data = parseFeed(xml, target);
  feedCache.set(cacheKey, { data, expiresAt: Date.now() + cacheTTL });
  return data;
}

async function getSourceById(sourceId: string): Promise<BookSource> {
  const config = await resolveOPDSConfig();
  const source = config.sources.find((item) => item.id === sourceId);
  if (!source) throw new Error('未找到对应的 OPDS 书源');
  return source;
}

async function detectCapabilities(source: BookSource): Promise<BookSourceCapabilities> {
  const cached = sourceCapabilityCache.get(source.id);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.data;

  try {
    const feed = await getFeed(source);
    const searchLink = feed.links.find((link) => link.rel === 'search');
    const navigationEntries = feed.entries.filter((entry) => isLikelyNavigationEntry(entry));
    const bookEntries = feed.entries.filter((entry) => !isLikelyNavigationEntry(entry));
    const acquisitionTypes = Array.from(new Set(bookEntries.flatMap((entry) => entry.links
      .map((link) => mapFormat(link.type || ''))
      .filter(Boolean) as string[])));
    const navigationCount = feed.links.filter((link) => isNavigationRel(link.rel)).length + navigationEntries.length;
    const entryCount = bookEntries.length;

    const data: BookSourceCapabilities = {
      searchSupported: !!searchLink || !!source.searchTemplate,
      catalogSupported: navigationCount > 0 || entryCount > 0,
      searchMode: searchLink ? 'opds' : source.searchTemplate ? 'template' : 'disabled',
      catalogMode: navigationCount > 0 ? 'navigation' : entryCount > 0 ? 'flat' : 'disabled',
      acquisitionTypes,
      lastCheckedAt: now,
    };

    sourceCapabilityCache.set(source.id, { data, expiresAt: now + SOURCE_CAPABILITY_SUCCESS_TTL_MS });
    return data;
  } catch (error) {
    const failureData: BookSourceCapabilities = {
      searchSupported: !!source.searchTemplate,
      catalogSupported: false,
      searchMode: source.searchTemplate ? 'template' : 'disabled',
      catalogMode: 'disabled',
      acquisitionTypes: [],
      lastCheckedAt: now,
      lastError: (error as Error).message,
    };

    if (cached?.data && !cached.data.lastError) {
      sourceCapabilityCache.set(source.id, { data: cached.data, expiresAt: now + SOURCE_CAPABILITY_FAILURE_TTL_MS });
      return cached.data;
    }

    sourceCapabilityCache.set(source.id, { data: failureData, expiresAt: now + SOURCE_CAPABILITY_FAILURE_TTL_MS });
    return failureData;
  }
}

export async function getOPDSConfig() {
  return resolveOPDSConfig();
}

export class OPDSClient {
  async getSources(): Promise<BookSource[]> {
    const config = await resolveOPDSConfig();
    if (!config.enabled) return [];
    const withCapabilities = await Promise.all(config.sources.map(async (source) => ({
      ...source,
      capabilities: await detectCapabilities(source),
    })));
    return withCapabilities;
  }

  async getCatalog(sourceId: string, href?: string): Promise<BookCatalogResult> {
    const source = await getSourceById(sourceId);
    return this.getCatalogFromSource(source, href);
  }

  async getCatalogFromSource(source: BookSource, href?: string): Promise<BookCatalogResult & { searchHref?: string }> {
    const feed = await getFeed(source, href);
    const navigationEntries = feed.entries.filter((entry) => isLikelyNavigationEntry(entry));
    const bookEntries = feed.entries.filter((entry) => !isLikelyNavigationEntry(entry));
    return {
      sourceId: source.id,
      sourceName: source.name,
      title: feed.title,
      subtitle: feed.subtitle,
      href: normalizeUrl(source.url, href || source.url),
      entries: bookEntries.map((entry) => mapEntryToItem(source, entry)),
      navigation: [
        ...feed.links
          .filter((link) => isNavigationLink(link) && link.rel !== 'next' && link.rel !== 'previous' && !!(link.title || '').trim())
          .map((link) => ({
            title: (link.title || '').trim(),
            href: link.href,
            rel: link.rel,
            type: link.type,
          })),
        ...navigationEntries
          .map((entry) => ({
            title: (entry.title || '').trim(),
            href: pickDetailHref(entry.links) || entry.links.find((link) => isNavigationLink(link))?.href || '',
            rel: entry.links.find((link) => isNavigationLink(link))?.rel,
            type: entry.links.find((link) => isNavigationLink(link))?.type,
          }))
          .filter((item) => !!item.href && !!item.title && item.title !== '目录'),
      ],
      nextHref: feed.links.find((link) => link.rel === 'next')?.href,
      previousHref: feed.links.find((link) => link.rel === 'previous')?.href,
      searchHref: feed.links.find((link) => link.rel === 'search')?.href,
    };
  }

  async getSearchSources(sourceId?: string): Promise<BookSource[]> {
    return sourceId ? [await getSourceById(sourceId)] : (await resolveOPDSConfig()).sources;
  }

  async searchBooksSource(q: string, source: BookSource): Promise<{ source: BookSource; results: BookListItem[] }> {
    const targetUrl = await resolveSearchTargetUrl(source, q);
    if (!targetUrl) throw new Error('未配置可用的搜索地址');
    const feed = await getFeed(source, targetUrl);
    return { source, results: feed.entries.map((entry) => mapEntryToItem(source, entry)) };
  }

  async searchBooks(q: string, sourceId?: string): Promise<BookSearchResult> {
    const sources = await this.getSearchSources(sourceId);
    const results: BookListItem[] = [];
    const failedSources: BookSearchFailure[] = [];

    await Promise.all(sources.map(async (source) => {
      try {
        const sourceResult = await this.searchBooksSource(q, source);
        results.push(...sourceResult.results);
      } catch (error) {
        failedSources.push({ sourceId: source.id, sourceName: source.name, error: (error as Error).message });
      }
    }));

    return { results, failedSources };
  }

  async getBookDetail(sourceId: string, href: string, fallback?: Partial<BookDetail>): Promise<BookDetail> {
    const source = await getSourceById(sourceId);
    if (!href) {
      if (!fallback?.title) throw new Error('缺少详情链接');
      return {
        id: fallback.id || `${sourceId}:${fallback.title}`,
        sourceId,
        sourceName: source.name,
        title: fallback.title,
        author: fallback.author,
        cover: fallback.cover,
        summary: fallback.summary,
        acquisitionLinks: fallback.acquisitionLinks || [],
        detailHref: fallback.detailHref,
        tags: fallback.tags,
        categories: fallback.categories,
        navigation: fallback.navigation || [],
      } as BookDetail;
    }

    const feed = await getFeed(source, href);
    const entry = feed.entries[0];
    if (!entry) {
      if (fallback?.title) {
        return {
          id: fallback.id || href,
          sourceId,
          sourceName: source.name,
          title: fallback.title,
          author: fallback.author,
          cover: fallback.cover,
          summary: fallback.summary,
          acquisitionLinks: fallback.acquisitionLinks || [],
          detailHref: href,
          tags: fallback.tags,
          categories: fallback.categories,
          navigation: fallback.navigation || [],
        } as BookDetail;
      }
      throw new Error('详情页没有可用书籍条目');
    }

    const detail = mapEntryToDetail(source, entry);
    return {
      ...detail,
      detailHref: href,
      summary: detail.summary || feed.subtitle || fallback?.summary,
      acquisitionLinks: detail.acquisitionLinks.length > 0 ? detail.acquisitionLinks : fallback?.acquisitionLinks || [],
      cover: detail.cover || fallback?.cover,
    };
  }

  async getPreferredAcquisition(sourceId: string, href: string): Promise<{ format: 'epub' | 'pdf'; href: string }> {
    const detail = await this.getBookDetail(sourceId, href);
    const preferred = detail.acquisitionLinks
      .map((item) => ({ ...item, format: mapFormat(item.type || '') }))
      .find((item) => item.format === 'epub' || item.format === 'pdf');
    if (!preferred?.format) {
      throw new Error('当前书籍没有可在线阅读的 EPUB/PDF 资源');
    }
    return { format: preferred.format, href: preferred.href };
  }

  async getSourceById(sourceId: string): Promise<BookSource> {
    return getSourceById(sourceId);
  }
}

export const opdsClient = new OPDSClient();
