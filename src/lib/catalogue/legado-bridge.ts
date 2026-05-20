/**
 * legado-bridge —— 把 legado JSON 源（book / manga）包装成统一的 CatalogueSourceModule。
 *
 * 当前实现复用 `booksources/runtime.ts` 与 `mangasources/runtime.ts` 已有的工作流，
 * 等 PR2/3 完成 UI 迁移后，runtime.ts 本身将被 registry 通过该 bridge 间接调用。
 */
import type { BookSourceV2, NovelChapter } from "@/lib/booksources/types";
import type {
  MangaSourceV2,
  MangaChapter,
  MangaDetail,
} from "@/lib/mangasources/types";
import {
  searchBooks,
  getBookInfo,
  getToc,
  getChapterContent,
} from "@/lib/booksources/runtime";
import {
  searchManga,
  exploreManga,
  getMangaDetail,
  getMangaChapters,
  getMangaPages,
} from "@/lib/mangasources/runtime";
import type {
  CatalogueCtx,
  CatalogueItem,
  CatalogueMeta,
  CatalogueSourceModule,
  CatalogueUnit,
} from "./types";

/* ───────────────── Book bridge ───────────────── */

export function legadoBookBridge(
  source: BookSourceV2,
  meta: CatalogueMeta
): CatalogueSourceModule {
  return {
    meta,

    search: async (_ctx, query, page) => {
      const list = await searchBooks(source, query, page);
      return {
        list: list.map<CatalogueItem>((b) => ({
          id: b.url,
          title: b.name,
          subtitle: b.author,
          cover: b.cover,
          tags: b.kind ? [b.kind] : undefined,
          badge: b.lastChapter,
          meta: { url: b.url, wordCount: b.wordCount, intro: b.intro },
        })),
        hasMore: list.length > 0,
      };
    },

    detail: async (_ctx, itemUrl) => {
      const { book, tocUrl } = await getBookInfo(source, itemUrl);
      return {
        id: book.url,
        title: book.name,
        subtitle: book.author,
        cover: book.cover,
        description: book.intro,
        author: book.author,
        genre: book.kind ? [book.kind] : undefined,
        badge: book.lastChapter,
        meta: { tocUrl, wordCount: book.wordCount },
      };
    },

    units: async (_ctx, detail) => {
      const tocUrl =
        (detail.meta?.tocUrl as string | undefined) ?? detail.id;
      const chapters: NovelChapter[] = await getToc(source, tocUrl);
      return chapters.map<CatalogueUnit>((c) => ({
        id: c.url,
        title: c.title,
        index: c.index,
        url: c.url,
        badge: c.isVip ? "VIP" : c.isVolume ? "卷" : undefined,
      }));
    },

    unitContent: async (_ctx, unit) => {
      const text = await getChapterContent(source, unit.url ?? unit.id);
      return { kind: "text", text };
    },
  };
}

/* ───────────────── Manga bridge ───────────────── */

export function legadoMangaBridge(
  source: MangaSourceV2,
  meta: CatalogueMeta
): CatalogueSourceModule {
  return {
    meta,

    popular: async (_ctx, page) => {
      const list = await exploreManga(source, page);
      return {
        list: list.map<CatalogueItem>((m) => ({
          id: m.url,
          title: m.name,
          subtitle: m.author,
          cover: m.cover,
          badge: m.status,
        })),
        hasMore: list.length > 0,
      };
    },

    search: async (_ctx, query, page) => {
      const list = await searchManga(source, query, page);
      return {
        list: list.map<CatalogueItem>((m) => ({
          id: m.url,
          title: m.name,
          subtitle: m.author,
          cover: m.cover,
          badge: m.status,
        })),
        hasMore: list.length > 0,
      };
    },

    detail: async (_ctx, itemUrl) => {
      const det: MangaDetail = await getMangaDetail(source, itemUrl);
      return {
        id: det.url,
        title: det.name,
        subtitle: det.author,
        cover: det.cover,
        description: det.intro,
        author: det.author,
        status: det.status,
        genre: det.kind ? [det.kind] : undefined,
        meta: { chaptersUrl: det.chaptersUrl },
      };
    },

    units: async (_ctx, detail) => {
      const chaptersUrl =
        (detail.meta?.chaptersUrl as string | undefined) ?? detail.id;
      const chapters: MangaChapter[] = await getMangaChapters(
        source,
        chaptersUrl
      );
      return chapters.map<CatalogueUnit>((c) => ({
        id: c.url,
        title: c.title,
        index: c.index,
        url: c.url,
        date: c.date,
      }));
    },

    unitContent: async (_ctx, unit) => {
      const urls = await getMangaPages(source, unit.url ?? unit.id);
      return { kind: "images", urls };
    },
  };
}

/* ───────────────── meta 构造 helper ───────────────── */

export function bookSourceToMeta(s: BookSourceV2): CatalogueMeta {
  return {
    id: s.id,
    name: s.bookSourceName,
    baseUrl: s.bookSourceUrl,
    category: "book",
    group: s.bookSourceGroup,
    comment: s.bookSourceComment,
  };
}

export function mangaSourceToMeta(s: MangaSourceV2): CatalogueMeta {
  return {
    id: s.id,
    name: s.name,
    baseUrl: s.baseUrl,
    category: "manga",
    group: s.group,
    comment: s.comment,
  };
}

/** 检查 CatalogueCtx 出现位置（防止 unused 警告） */
export type { CatalogueCtx };
