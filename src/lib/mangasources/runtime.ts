/**
 * JSON 漫画源运行时 —— 复用 booksources 的规则引擎（CSS/JsonPath/regex）。
 *
 *   - search(source, kw, page)        → MangaItem[]
 *   - explore(source, page)           → MangaItem[]
 *   - getDetail(source, url)          → MangaDetail (含 chaptersUrl)
 *   - getChapters(source, chaptersUrl) → MangaChapter[]
 *   - getPages(source, chapterUrl)    → image URL[]
 */
import { scriptFetch } from "@/source-script/fetch";
import {
  applyGetTokens,
  extract,
  htmlSelectScope,
  jsonSelectScope,
  makeContext,
  VarBag,
  type RuleContext,
} from "@/lib/booksources/rules";
import { resolveUrl } from "@/lib/booksources/runtime";
import type {
  MangaChapter,
  MangaDetail,
  MangaItem,
  MangaSourceV2,
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

function renderTemplate(
  tpl: string,
  vars: { key?: string; page?: number | string },
  bag?: VarBag
): string {
  let out = tpl;
  if (vars.key !== undefined) {
    out = out.replace(/\{\{\s*key\s*\}\}/g, encodeURIComponent(vars.key));
  }
  if (vars.page !== undefined) {
    out = out.replace(/\{\{\s*page\s*\}\}/g, String(vars.page));
  }
  if (bag) out = applyGetTokens(out, bag);
  return out;
}

async function fetchText(
  source: MangaSourceV2,
  url: string
): Promise<string> {
  const headers = parseHeader(source.header);
  const res = await scriptFetch(url, {
    method: "GET",
    headers,
    timeout: 30_000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

function mangaIdOf(sourceId: string, url: string): string {
  return `${sourceId}::${url}`;
}

function chapterIdOf(mangaId: string, url: string): string {
  return `${mangaId}::${url}`;
}

function parseMangaList(
  source: MangaSourceV2,
  text: string,
  baseUrl: string,
  vars: VarBag
): MangaItem[] {
  const rule = source.ruleList;
  if (!rule?.items) return [];
  const ctx = makeContext(text, { vars, baseUrl });
  const out: MangaItem[] = [];
  if (ctx.kind === "html") {
    const scopes = htmlSelectScope(rule.items, ctx.$, ctx.root, vars);
    for (const scope of scopes) {
      const sub: RuleContext = {
        kind: "html",
        $: ctx.$,
        root: scope,
        vars,
        baseUrl,
      };
      const name = extract(rule.name, sub);
      const url = extract(rule.url, sub);
      if (!name || !url) continue;
      const fullUrl = resolveUrl(baseUrl, url);
      out.push({
        id: mangaIdOf(source.id, fullUrl),
        sourceId: source.id,
        url: fullUrl,
        name,
        cover: resolveUrl(baseUrl, extract(rule.cover, sub)) || undefined,
        author: extract(rule.author, sub) || undefined,
        status: extract(rule.status, sub) || undefined,
      });
    }
  } else {
    const items = jsonSelectScope(rule.items, ctx.data, vars);
    for (const item of items) {
      const sub: RuleContext = { kind: "json", data: item, vars, baseUrl };
      const name = extract(rule.name, sub);
      const url = extract(rule.url, sub);
      if (!name || !url) continue;
      const fullUrl = resolveUrl(baseUrl, url);
      out.push({
        id: mangaIdOf(source.id, fullUrl),
        sourceId: source.id,
        url: fullUrl,
        name,
        cover: resolveUrl(baseUrl, extract(rule.cover, sub)) || undefined,
        author: extract(rule.author, sub) || undefined,
        status: extract(rule.status, sub) || undefined,
      });
    }
  }
  return out;
}

export async function searchManga(
  source: MangaSourceV2,
  keyword: string,
  page = 1
): Promise<MangaItem[]> {
  if (!source.searchUrl) return [];
  const vars = new VarBag();
  const url = resolveUrl(
    source.baseUrl,
    renderTemplate(source.searchUrl, { key: keyword, page }, vars)
  );
  const text = await fetchText(source, url);
  return parseMangaList(source, text, url, vars);
}

export async function exploreManga(
  source: MangaSourceV2,
  page = 1
): Promise<MangaItem[]> {
  if (!source.exploreUrl) return [];
  const vars = new VarBag();
  const url = resolveUrl(
    source.baseUrl,
    renderTemplate(source.exploreUrl, { page }, vars)
  );
  const text = await fetchText(source, url);
  return parseMangaList(source, text, url, vars);
}

export async function getMangaDetail(
  source: MangaSourceV2,
  mangaUrl: string
): Promise<MangaDetail> {
  const vars = new VarBag();
  const text = await fetchText(source, mangaUrl);
  const ctx = makeContext(text, { vars, baseUrl: mangaUrl });
  const rd = source.ruleDetail ?? {};
  const chaptersRaw = extract(rd.chaptersUrl, ctx);
  const chaptersUrl = chaptersRaw ? resolveUrl(mangaUrl, chaptersRaw) : mangaUrl;
  const name = extract(rd.name, ctx) || "（未命名）";
  return {
    id: mangaIdOf(source.id, mangaUrl),
    sourceId: source.id,
    url: mangaUrl,
    name,
    author: extract(rd.author, ctx) || undefined,
    cover: resolveUrl(mangaUrl, extract(rd.cover, ctx)) || undefined,
    intro: extract(rd.intro, ctx) || undefined,
    status: extract(rd.status, ctx) || undefined,
    kind: extract(rd.kind, ctx) || undefined,
    chaptersUrl,
  };
}

export async function getMangaChapters(
  source: MangaSourceV2,
  chaptersUrl: string,
  maxPages = 5
): Promise<MangaChapter[]> {
  const rule = source.ruleChapters;
  if (!rule?.items) return [];
  const vars = new VarBag();
  const mangaId = mangaIdOf(source.id, chaptersUrl);
  const out: MangaChapter[] = [];
  let url = chaptersUrl;
  let visited = 0;
  let idx = 0;
  while (url && visited < maxPages) {
    const text = await fetchText(source, url);
    const ctx = makeContext(text, { vars, baseUrl: url });
    if (ctx.kind === "html") {
      const scopes = htmlSelectScope(rule.items, ctx.$, ctx.root, vars);
      for (const scope of scopes) {
        const sub: RuleContext = {
          kind: "html",
          $: ctx.$,
          root: scope,
          vars,
          baseUrl: url,
        };
        const title = extract(rule.title, sub);
        const chapterUrl = extract(rule.url, sub);
        if (!title || !chapterUrl) continue;
        const fullUrl = resolveUrl(url, chapterUrl);
        out.push({
          id: chapterIdOf(mangaId, fullUrl),
          mangaId,
          index: idx++,
          title,
          url: fullUrl,
          date: extract(rule.date, sub) || undefined,
        });
      }
    } else {
      const items = jsonSelectScope(rule.items, ctx.data, vars);
      for (const item of items) {
        const sub: RuleContext = {
          kind: "json",
          data: item,
          vars,
          baseUrl: url,
        };
        const title = extract(rule.title, sub);
        const chapterUrl = extract(rule.url, sub);
        if (!title || !chapterUrl) continue;
        const fullUrl = resolveUrl(url, chapterUrl);
        out.push({
          id: chapterIdOf(mangaId, fullUrl),
          mangaId,
          index: idx++,
          title,
          url: fullUrl,
        });
      }
    }
    const next = extract(rule.nextUrl, ctx);
    if (!next) break;
    url = resolveUrl(url, next);
    visited++;
  }
  return out;
}

export async function getMangaPages(
  source: MangaSourceV2,
  chapterUrl: string,
  maxPages = 10
): Promise<string[]> {
  const rule = source.rulePages;
  if (!rule?.items) return [];
  const vars = new VarBag();
  const out: string[] = [];
  let url = chapterUrl;
  let visited = 0;
  while (url && visited < maxPages) {
    const text = await fetchText(source, url);
    const ctx = makeContext(text, { vars, baseUrl: url });
    if (ctx.kind === "html") {
      const scopes = htmlSelectScope(rule.items, ctx.$, ctx.root, vars);
      for (const scope of scopes) {
        const sub: RuleContext = {
          kind: "html",
          $: ctx.$,
          root: scope,
          vars,
          baseUrl: url,
        };
        const img = rule.imageUrl
          ? extract(rule.imageUrl, sub)
          : extract("img@src", sub);
        if (img) out.push(resolveUrl(url, img));
      }
    } else {
      const items = jsonSelectScope(rule.items, ctx.data, vars);
      for (const item of items) {
        const sub: RuleContext = {
          kind: "json",
          data: item,
          vars,
          baseUrl: url,
        };
        const img = rule.imageUrl ? extract(rule.imageUrl, sub) : "";
        if (!img && typeof item === "string") {
          out.push(resolveUrl(url, item));
        } else if (img) {
          out.push(resolveUrl(url, img));
        }
      }
    }
    const next = extract(rule.nextUrl, ctx);
    if (!next) break;
    url = resolveUrl(url, next);
    visited++;
  }
  return out;
}

/* ─────────────── Explore（漫画分类） ─────────────── */

export interface MangaExploreCategory {
  title: string;
  url: string;
  group?: string;
}

/** 漫画源 exploreUrl 沿用 legado 同款两种格式：line "标题::URL" 或 JSON 数组。 */
export function parseMangaExploreCategories(
  source: MangaSourceV2
): MangaExploreCategory[] {
  const raw = source.exploreUrl?.trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        const out: MangaExploreCategory[] = [];
        for (const it of arr) {
          if (!it || typeof it !== "object") continue;
          const o = it as Record<string, unknown>;
          const title = typeof o.title === "string" ? o.title : "";
          const url = typeof o.url === "string" ? o.url : "";
          if (!title || !url) continue;
          const cat: MangaExploreCategory = { title, url };
          if (typeof o.group === "string") cat.group = o.group;
          out.push(cat);
        }
        return out;
      }
    } catch {
      /* fall through */
    }
  }
  const out: MangaExploreCategory[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const parts = t.split("::");
    if (parts.length === 2) {
      out.push({ title: parts[0].trim(), url: parts[1].trim() });
    } else if (parts.length >= 3) {
      out.push({
        group: parts[0].trim(),
        title: parts[1].trim(),
        url: parts.slice(2).join("::").trim(),
      });
    }
  }
  return out;
}

/** 按分类拉漫画列表 —— 复用 ruleList */
export async function exploreCategoryMangas(
  source: MangaSourceV2,
  category: MangaExploreCategory,
  page = 1
): Promise<MangaItem[]> {
  if (!category.url || !source.ruleList?.items) return [];
  const vars = new VarBag();
  const tpl = category.url
    .replace(/\{\{\s*page\s*\}\}/g, String(page))
    .replace(/searchPage/g, String(page));
  const url = resolveUrl(source.baseUrl, tpl);
  const text = await fetchText(source, url);
  return parseMangaList(source, text, url, vars);
}

/* ─────────────── 源健康检查 ─────────────── */

export async function validateMangaSource(
  source: MangaSourceV2,
  probeKeyword = "海贼"
): Promise<{ ok: boolean; message: string; sampleCount: number }> {
  try {
    if (!source.searchUrl && !source.exploreUrl) {
      return { ok: false, message: "无 searchUrl/exploreUrl", sampleCount: 0 };
    }
    if (source.searchUrl) {
      const list = await searchManga(source, probeKeyword, 1);
      if (list.length === 0) {
        return { ok: false, message: "搜索返回 0 条", sampleCount: 0 };
      }
      return {
        ok: true,
        message: `搜索命中 ${list.length} 条`,
        sampleCount: list.length,
      };
    }
    const list = await exploreManga(source, 1);
    if (list.length === 0) {
      return { ok: false, message: "explore 返回 0 条", sampleCount: 0 };
    }
    return {
      ok: true,
      message: `explore 命中 ${list.length} 条`,
      sampleCount: list.length,
    };
  } catch (e) {
    return {
      ok: false,
      message: (e as Error).message ?? String(e),
      sampleCount: 0,
    };
  }
}
