/**
 * Legado 书源运行时 —— 用规则引擎执行多类查询。
 *
 *   - search(source, kw, page) → list of NovelBook
 *   - exploreCategories(source) → 分类节点列表（解析 exploreUrl 配置）
 *   - exploreBooks(source, cat, page) → 某分类下的书列表
 *   - getBookInfo(source, bookUrl) → 详情（含 tocUrl）
 *   - getToc(source, tocUrl) → 章节列表
 *   - getChapter(source, chapterUrl) → 正文文本
 *
 * 所有 HTTP 都过 scriptFetch，header 从 source.header (JSON 字符串) 解析。
 */
import * as cheerio from "cheerio";
import { scriptFetch } from "@/source-script/fetch";
import {
  applyGetTokens,
  extract,
  htmlSelectScope,
  jsonSelectScope,
  makeContext,
  makeHtmlContext,
  VarBag,
  type RuleContext,
} from "./rules";
import type {
  BookSourceV2,
  NovelBook,
  NovelChapter,
} from "./types";

function parseHeader(headerStr?: string): Record<string, string> {
  if (!headerStr) return {};
  try {
    const obj = JSON.parse(headerStr);
    if (obj && typeof obj === "object") {
      return Object.entries(obj).reduce<Record<string, string>>((acc, [k, v]) => {
        if (typeof v === "string") acc[k] = v;
        return acc;
      }, {});
    }
  } catch {
    /* ignore */
  }
  return {};
}

/** 相对 URL 解析（基准 = bookSourceUrl） */
export function resolveUrl(base: string, href: string): string {
  if (!href) return "";
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("//")) {
    const proto = /^(https?):/i.exec(base)?.[1] ?? "https";
    return `${proto}:${href}`;
  }
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

/** 替换 {{key}} {{page}} 等模板变量；同时把 @get:{k} 替换成 vars[k] */
function renderTemplate(
  tpl: string,
  vars: { key?: string; page?: number | string },
  bag?: VarBag
): string {
  let out = tpl;
  if (vars.key !== undefined) {
    out = out.replace(/\{\{\s*key\s*\}\}/g, encodeURIComponent(vars.key));
    out = out.replace(/searchKey/g, encodeURIComponent(vars.key));
  }
  if (vars.page !== undefined) {
    out = out.replace(/\{\{\s*page\s*\}\}/g, String(vars.page));
    out = out.replace(/searchPage/g, String(vars.page));
  }
  if (bag) out = applyGetTokens(out, bag);
  return out;
}

async function fetchText(
  source: BookSourceV2,
  url: string,
  init: { method?: string; body?: string } = {}
): Promise<string> {
  const headers = parseHeader(source.header);
  const res = await scriptFetch(url, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
    timeout: 30_000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

function bookIdOf(sourceId: string, url: string): string {
  return `${sourceId}::${url}`;
}

function chapterIdOf(bookId: string, url: string): string {
  return `${bookId}::${url}`;
}

/* ─────────────── Search ─────────────── */

export async function searchBooks(
  source: BookSourceV2,
  keyword: string,
  page = 1
): Promise<NovelBook[]> {
  if (!source.searchUrl || !source.ruleSearch?.bookList) {
    return [];
  }
  const vars = new VarBag();
  // legado searchUrl 形态：URL,{"method":"POST", ...}  支持简单分离
  const { url, method, body } = parseSearchUrl(
    renderTemplate(source.searchUrl, { key: keyword, page }, vars),
    source
  );
  const finalUrl = resolveUrl(source.bookSourceUrl, url);
  const text = await fetchText(source, finalUrl, { method, body });
  return parseBookList(source, text, finalUrl, vars);
}

function parseSearchUrl(
  raw: string,
  source: BookSourceV2
): { url: string; method?: string; body?: string } {
  // legado searchUrl 形如 "https://x?q={{key}},{\"method\":\"POST\",\"body\":\"k={{key}}\"}"
  const commaIdx = raw.indexOf(",");
  if (commaIdx > 0 && raw[commaIdx + 1] === "{") {
    const urlPart = raw.slice(0, commaIdx).trim();
    try {
      const opts = JSON.parse(raw.slice(commaIdx + 1));
      return {
        url: urlPart,
        method: typeof opts.method === "string" ? opts.method : undefined,
        body: typeof opts.body === "string" ? opts.body : undefined,
      };
    } catch {
      /* fall through */
    }
  }
  return { url: raw };
  void source;
}

function parseBookList(
  source: BookSourceV2,
  text: string,
  baseUrl: string,
  vars: VarBag
): NovelBook[] {
  const rs = source.ruleSearch;
  if (!rs?.bookList) return [];
  const ctx = makeContext(text, { vars, baseUrl });
  const out: NovelBook[] = [];
  if (ctx.kind === "html") {
    const scopes = htmlSelectScope(rs.bookList, ctx.$, ctx.root, vars);
    for (const scope of scopes) {
      const sub: RuleContext = {
        kind: "html",
        $: ctx.$,
        root: scope,
        vars,
        baseUrl,
      };
      const name = extract(rs.name, sub);
      const bookUrl = extract(rs.bookUrl, sub);
      if (!name || !bookUrl) continue;
      const fullUrl = resolveUrl(baseUrl, bookUrl);
      out.push({
        id: bookIdOf(source.id, fullUrl),
        sourceId: source.id,
        url: fullUrl,
        name,
        author: extract(rs.author, sub) || undefined,
        cover: resolveUrl(baseUrl, extract(rs.coverUrl, sub)) || undefined,
        intro: extract(rs.intro, sub) || undefined,
        kind: extract(rs.kind, sub) || undefined,
        lastChapter: extract(rs.lastChapter, sub) || undefined,
        wordCount: extract(rs.wordCount, sub) || undefined,
      });
    }
  } else {
    const items = jsonSelectScope(rs.bookList, ctx.data, vars);
    for (const item of items) {
      const sub: RuleContext = { kind: "json", data: item, vars, baseUrl };
      const name = extract(rs.name, sub);
      const bookUrl = extract(rs.bookUrl, sub);
      if (!name || !bookUrl) continue;
      const fullUrl = resolveUrl(baseUrl, bookUrl);
      out.push({
        id: bookIdOf(source.id, fullUrl),
        sourceId: source.id,
        url: fullUrl,
        name,
        author: extract(rs.author, sub) || undefined,
        cover: resolveUrl(baseUrl, extract(rs.coverUrl, sub)) || undefined,
        intro: extract(rs.intro, sub) || undefined,
      });
    }
  }
  return out;
}

/* ─────────────── Book Info ─────────────── */

export async function getBookInfo(
  source: BookSourceV2,
  bookUrl: string
): Promise<{ book: NovelBook; tocUrl: string }> {
  const vars = new VarBag();
  const text = await fetchText(source, bookUrl);
  const ctx = makeContext(text, { vars, baseUrl: bookUrl });
  const ri = source.ruleBookInfo ?? {};
  // legado 兼容：ruleBookInfo.init 是一个"预跑"规则，副作用通常是 @put: 写 vars
  if (ri.init) extract(ri.init, ctx);
  const name = extract(ri.name, ctx);
  const tocUrlRaw = extract(ri.tocUrl, ctx);
  const tocUrl = tocUrlRaw ? resolveUrl(bookUrl, tocUrlRaw) : bookUrl;
  const book: NovelBook = {
    id: bookIdOf(source.id, bookUrl),
    sourceId: source.id,
    url: bookUrl,
    name: name || "（未命名）",
    author: extract(ri.author, ctx) || undefined,
    cover: resolveUrl(bookUrl, extract(ri.coverUrl, ctx)) || undefined,
    intro: extract(ri.intro, ctx) || undefined,
    kind: extract(ri.kind, ctx) || undefined,
    lastChapter: extract(ri.lastChapter, ctx) || undefined,
    wordCount: extract(ri.wordCount, ctx) || undefined,
  };
  return { book, tocUrl };
}

/* ─────────────── Toc ─────────────── */

export async function getToc(
  source: BookSourceV2,
  tocUrl: string,
  maxPages = 5
): Promise<NovelChapter[]> {
  const rt = source.ruleToc;
  if (!rt?.chapterList) return [];
  const vars = new VarBag();
  const out: NovelChapter[] = [];
  let url = tocUrl;
  let visited = 0;
  let lastIndex = 0;
  while (url && visited < maxPages) {
    const text = await fetchText(source, url);
    const ctx = makeContext(text, { vars, baseUrl: url });
    const baseUrl = url;
    const bookId = bookIdOf(source.id, tocUrl);
    if (ctx.kind === "html") {
      const scopes = htmlSelectScope(rt.chapterList, ctx.$, ctx.root, vars);
      for (const scope of scopes) {
        const sub: RuleContext = {
          kind: "html",
          $: ctx.$,
          root: scope,
          vars,
          baseUrl,
        };
        const title = extract(rt.chapterName, sub);
        const chapterUrl = extract(rt.chapterUrl, sub);
        if (!title || !chapterUrl) continue;
        const fullUrl = resolveUrl(baseUrl, chapterUrl);
        out.push({
          id: chapterIdOf(bookId, fullUrl),
          bookId,
          index: lastIndex++,
          title,
          url: fullUrl,
          isVolume: !!extract(rt.isVolume, sub),
          isVip: !!extract(rt.isVip, sub),
        });
      }
    } else {
      const items = jsonSelectScope(rt.chapterList, ctx.data, vars);
      for (const item of items) {
        const sub: RuleContext = { kind: "json", data: item, vars, baseUrl };
        const title = extract(rt.chapterName, sub);
        const chapterUrl = extract(rt.chapterUrl, sub);
        if (!title || !chapterUrl) continue;
        const fullUrl = resolveUrl(baseUrl, chapterUrl);
        out.push({
          id: chapterIdOf(bookId, fullUrl),
          bookId,
          index: lastIndex++,
          title,
          url: fullUrl,
        });
      }
    }
    const next = extract(rt.nextTocUrl, ctx);
    if (!next) break;
    url = resolveUrl(baseUrl, next);
    visited++;
  }
  return out;
}

/* ─────────────── Chapter content ─────────────── */

export async function getChapterContent(
  source: BookSourceV2,
  chapterUrl: string,
  maxPages = 5
): Promise<string> {
  const rc = source.ruleContent;
  if (!rc?.content) return "";
  const vars = new VarBag();
  let url = chapterUrl;
  const segments: string[] = [];
  let visited = 0;
  while (url && visited < maxPages) {
    const text = await fetchText(source, url);
    const ctx = makeContext(text, { vars, baseUrl: url });
    const raw = extract(rc.content, ctx);
    const cleaned = cleanContent(raw, rc.replaceRegex);
    if (cleaned) segments.push(cleaned);
    const next = extract(rc.nextContentUrl, ctx);
    if (!next) break;
    url = resolveUrl(url, next);
    visited++;
  }
  return segments.join("\n\n");
}

function cleanContent(raw: string, replaceRegex?: string): string {
  if (!raw) return "";
  // 一些规则提取 `@html` 会带 tag，简单转纯文本
  let text = raw;
  if (text.includes("<")) {
    const $ = cheerio.load(`<div>${text}</div>`);
    text = $("div")
      .first()
      .text()
      .replace(/\s+\n/g, "\n")
      .trim();
    void makeHtmlContext;
  }
  if (replaceRegex) {
    // 形态 ##regex## 或 ##regex##repl##
    const segments = replaceRegex.split("##").filter((s) => s.length > 0);
    for (let i = 0; i + 1 <= segments.length; i += 2) {
      const pattern = segments[i];
      const repl = segments[i + 1] ?? "";
      try {
        text = text.replace(new RegExp(pattern, "g"), repl);
      } catch {
        /* invalid regex */
      }
    }
  }
  // 段落整理：连续 3+ 换行压成 2 行
  text = text.replace(/\n{3,}/g, "\n\n");
  return text;
}

/* ─────────────── Explore（探索 / 分类） ─────────────── */

export interface ExploreCategory {
  /** 显示名 */
  title: string;
  /** 模板 URL（含 {{page}} 占位） */
  url: string;
  /** 可选分组 */
  group?: string;
}

/**
 * legado exploreUrl 有两种常见格式：
 *
 *   1) line 形式（每行 "标题::URL"，标题可带分组前缀 "分组::标题::URL"）：
 *      ```
 *      玄幻::https://x/cat/1
 *      都市奇幻::都市::https://x/cat/2
 *      ```
 *   2) JSON 数组：`[{"title":"...","url":"...","group":"..."}]`
 */
export function parseExploreCategories(source: BookSourceV2): ExploreCategory[] {
  const raw = source.exploreUrl?.trim();
  if (!raw) return [];
  // JSON 优先
  if (raw.startsWith("[")) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        const out: ExploreCategory[] = [];
        for (const it of arr) {
          if (!it || typeof it !== "object") continue;
          const o = it as Record<string, unknown>;
          const title = typeof o.title === "string" ? o.title : "";
          const url = typeof o.url === "string" ? o.url : "";
          if (!title || !url) continue;
          const cat: ExploreCategory = { title, url };
          if (typeof o.group === "string") cat.group = o.group;
          out.push(cat);
        }
        return out;
      }
    } catch {
      /* fall through */
    }
  }
  // line 形式
  const out: ExploreCategory[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split("::");
    if (parts.length === 2) {
      out.push({ title: parts[0].trim(), url: parts[1].trim() });
    } else if (parts.length >= 3) {
      // 第一段是分组，第二段是标题，剩余 join 回来作为 URL（防止 URL 里也有 ::）
      out.push({
        group: parts[0].trim(),
        title: parts[1].trim(),
        url: parts.slice(2).join("::").trim(),
      });
    }
  }
  return out;
}

export async function exploreBooks(
  source: BookSourceV2,
  category: ExploreCategory,
  page = 1
): Promise<NovelBook[]> {
  if (!category.url) return [];
  // 探索列表也用 ruleExplore（若没有则回退 ruleSearch —— 大多数源只配 search）
  const rule = source.ruleExplore ?? source.ruleSearch;
  if (!rule?.bookList) return [];
  const vars = new VarBag();
  const rendered = renderTemplate(category.url, { page }, vars);
  const { url, method, body } = parseSearchUrl(rendered, source);
  const finalUrl = resolveUrl(source.bookSourceUrl, url);
  const text = await fetchText(source, finalUrl, { method, body });
  // 临时把 ruleSearch 指向 ruleExplore，复用 parseBookList
  const adapted: BookSourceV2 = { ...source, ruleSearch: rule };
  return parseBookList(adapted, text, finalUrl, vars);
}

/* ─────────────── 源健康检查（validateAll 用） ─────────────── */

/**
 * 用一个常见关键字探测源是否可用。返回 ok 与诊断字符串。
 * 不抛 —— 调用方仅看 result.ok。
 */
export async function validateSource(
  source: BookSourceV2,
  probeKeyword = "天龙八部"
): Promise<{ ok: boolean; message: string; sampleCount: number }> {
  try {
    if (!source.searchUrl) return { ok: false, message: "无 searchUrl", sampleCount: 0 };
    if (!source.ruleSearch?.bookList) {
      return { ok: false, message: "无 ruleSearch.bookList", sampleCount: 0 };
    }
    const list = await searchBooks(source, probeKeyword, 1);
    if (list.length === 0) {
      return { ok: false, message: "搜索返回 0 条", sampleCount: 0 };
    }
    return { ok: true, message: `命中 ${list.length} 条`, sampleCount: list.length };
  } catch (e) {
    return {
      ok: false,
      message: (e as Error).message ?? String(e),
      sampleCount: 0,
    };
  }
}
