/**
 * OPDS Atom feed 解析。OPDS = Open Publication Distribution System，
 * 标准 Atom 1.0 + 几个专用 namespace。
 *
 * 参考：https://specs.opds.io/opds-1.2
 *
 * 解析策略：用 cheerio xmlMode 拉所有 <entry>，按 link@rel 区分：
 *  - "http://opds-spec.org/image" → cover URL
 *  - "http://opds-spec.org/acquisition" + type → 下载链接
 *  - "http://opds-spec.org/catalog" + rel="subsection" → 子目录
 *  - "self" / "next" / "previous" → 分页
 */
import * as cheerio from "cheerio";
import type {
  BookAcquisitionLink,
  BookCatalogResult,
  BookListItem,
  BookNavLink,
  BookSource,
} from "./types";

const REL_IMAGE = "http://opds-spec.org/image";
const REL_THUMB = "http://opds-spec.org/image/thumbnail";
const REL_ACQUIRE = "http://opds-spec.org/acquisition";
const REL_NAV_SUBSECTION = "subsection";
const REL_SEARCH = "search";

/** 把相对 href 解析为绝对 URL，base 用 feed self-link 或 source.url */
export function resolveHref(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

export function parseOpdsFeed(
  xml: string,
  feedUrl: string,
  source: BookSource
): BookCatalogResult {
  const $ = cheerio.load(xml, { xmlMode: true });

  const feedTitle = $("feed > title").first().text().trim() || source.name;
  const feedSubtitle = $("feed > subtitle").first().text().trim() || undefined;

  // 顶层导航 + 分页 link
  let nextHref: string | undefined;
  let previousHref: string | undefined;
  const navigation: BookNavLink[] = [];
  $("feed > link").each((_, el) => {
    const $l = $(el);
    const rel = $l.attr("rel") || "";
    const href = $l.attr("href");
    if (!href) return;
    const abs = resolveHref(href, feedUrl);
    if (rel === "next") nextHref = abs;
    else if (rel === "previous") previousHref = abs;
  });

  const entries: BookListItem[] = [];
  $("feed > entry").each((_, el) => {
    const $e = $(el);
    const id = $e.children("id").first().text().trim();
    const title = $e.children("title").first().text().trim();
    if (!id || !title) return;

    const author = $e.find("author > name").first().text().trim() || undefined;
    const summary =
      $e.children("summary").first().text().trim() ||
      $e.children("content").first().text().trim() ||
      undefined;
    const language = $e.find("dcterms\\:language").text().trim() || undefined;
    const published = $e.children("published").first().text().trim() || undefined;

    let cover: string | undefined;
    let thumbnail: string | undefined;
    let detailHref: string | undefined;
    let isSubsection = false;
    const links: BookAcquisitionLink[] = [];
    let subTitle: string | undefined;
    let subHref: string | undefined;

    $e.children("link").each((_, lel) => {
      const $l = $(lel);
      const rel = $l.attr("rel") || "";
      const type = $l.attr("type") || "";
      const href = $l.attr("href");
      if (!href) return;
      const abs = resolveHref(href, feedUrl);
      if (rel === REL_IMAGE) cover = abs;
      else if (rel === REL_THUMB) thumbnail = abs;
      else if (rel.startsWith(REL_ACQUIRE)) {
        links.push({ rel, type, href: abs, title: $l.attr("title") });
      } else if (rel === REL_NAV_SUBSECTION || type.includes("opds-catalog")) {
        // 导航条目 — 整个 entry 是一个分类入口
        isSubsection = true;
        subTitle = title;
        subHref = abs;
      } else if (rel === "alternate") {
        detailHref = abs;
      }
    });

    if (isSubsection && subHref && subTitle) {
      navigation.push({ title: subTitle, href: subHref, rel: REL_NAV_SUBSECTION });
      return;
    }

    if (links.length === 0 && !detailHref) {
      // 既没有下载链接也没有 alternate detail —— 跳过
      return;
    }

    entries.push({
      id,
      sourceId: source.id,
      sourceName: source.name,
      title,
      author,
      cover: cover || thumbnail,
      summary,
      language,
      published,
      detailHref,
      acquisitionLinks: links,
    });
  });

  return {
    sourceId: source.id,
    sourceName: source.name,
    title: feedTitle,
    subtitle: feedSubtitle,
    href: feedUrl,
    entries,
    navigation,
    nextHref,
    previousHref,
  };
}

/** 从 OPDS root feed 提取 OpenSearch URL template */
export function extractSearchTemplate(xml: string, feedUrl: string): string | undefined {
  const $ = cheerio.load(xml, { xmlMode: true });
  let template: string | undefined;
  $("feed > link").each((_, el) => {
    const $l = $(el);
    const rel = $l.attr("rel") || "";
    if (rel === REL_SEARCH) {
      const href = $l.attr("href");
      const type = $l.attr("type") || "";
      if (!href) return;
      // 直接是搜索模板，或是 OpenSearch description doc URL
      // OPDS 1.x 常用 application/atom+xml;profile=opds-catalog;kind=acquisition 的搜索
      // 我们简化：只保留可直接拼接的 {searchTerms} 模板
      if (href.includes("{searchTerms}")) {
        template = resolveHref(href, feedUrl);
      } else if (type.includes("opensearchdescription")) {
        // OpenSearch 描述文档需要二次解析，MVP 不做。记录 URL 让 UI 提示
        template = undefined;
      }
    }
  });
  return template;
}
