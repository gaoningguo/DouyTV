/**
 * Suwayomi-Server REST client.
 *
 * 协议：https://github.com/Suwayomi/Suwayomi-Server
 * 端点：
 *   GET /api/v1/source/list?lang=
 *   GET /api/v1/source/{id}/popular/{page}
 *   GET /api/v1/source/{id}/latest/{page}
 *   GET /api/v1/source/{id}/quick-search?searchTerm=&pageNum=
 *   GET /api/v1/manga/{id}/full           ← 详情 + 章节（合一接口）
 *   GET /api/v1/manga/{id}/chapters       ← 仅章节
 *   GET /api/v1/chapter/{id}/pages        ← 分镜图 URL 数组
 *   GET /api/v1/manga/{id}/thumbnail      ← 封面（直接是图片）
 *
 * 鉴权：可选 Basic Auth（用户在 Suwayomi 启用时）
 */
import { scriptFetch } from "@/source-script/fetch";
import { useMangaStore } from "@/stores/manga";
import { wrapImage } from "@/lib/proxy";
import type {
  MangaChapter,
  MangaDetail,
  MangaRecommendResult,
  MangaSearchItem,
  MangaSource,
} from "./types";

interface Cfg {
  base: string;
  headers: Record<string, string>;
}

function cfg(): Cfg {
  const s = useMangaStore.getState();
  const base = (s.serverUrl || "").replace(/\/+$/, "");
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (s.username) {
    headers.Authorization = `Basic ${btoa(`${s.username}:${s.password ?? ""}`)}`;
  }
  return { base, headers };
}

export function isMangaConfigured(): boolean {
  return !!cfg().base;
}

/**
 * 把 Suwayomi 服务端返回的相对路径补成完整 URL，并通过 dyproxy 包一层。
 * （SuwayomiServer 自部署常用自签证书 / 内网 IP，dyproxy 也帮忙绕 CORS。）
 */
export function resolveImage(relativeOrAbsolute: string | undefined): string | undefined {
  if (!relativeOrAbsolute) return undefined;
  const { base } = cfg();
  let abs = relativeOrAbsolute;
  if (!/^https?:\/\//i.test(abs)) {
    abs = `${base}${abs.startsWith("/") ? "" : "/"}${abs}`;
  }
  return wrapImage(abs);
}

export async function getSources(lang = "zh"): Promise<MangaSource[]> {
  const { base, headers } = cfg();
  if (!base) throw new Error("Suwayomi 服务地址未配置");
  const url = `${base}/api/v1/source/list?lang=${encodeURIComponent(lang)}`;
  const res = await scriptFetch(url, { method: "GET", headers, timeout: 30_000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const arr = await res.json<unknown[]>();
  if (!Array.isArray(arr)) return [];
  return arr.map((r) => {
    const it = r as Record<string, unknown>;
    return {
      id: String(it.id),
      name: String(it.name ?? "未知"),
      lang: it.lang as string | undefined,
      displayName: it.displayName as string | undefined,
      iconUrl: (it.iconUrl as string | undefined) ?? undefined,
    };
  });
}

function normalizeMangaList(
  raw: unknown,
  sourceId: string,
  sourceName: string
): { items: MangaSearchItem[]; hasNextPage: boolean } {
  const obj = raw as Record<string, unknown>;
  const mangaList = (obj.mangaList ?? obj.mangas ?? obj.list ?? []) as unknown[];
  const hasNextPage = Boolean(obj.hasNextPage ?? obj.has_more ?? false);
  const items = (Array.isArray(mangaList) ? mangaList : [])
    .map((m): MangaSearchItem | undefined => {
      const it = m as Record<string, unknown>;
      const id = it.id ?? it.mangaId;
      const title = it.title ?? it.name;
      if (id === undefined || !title) return undefined;
      const thumbnailUrl =
        (it.thumbnailUrl as string | undefined) ?? (it.thumbnail_url as string | undefined);
      return {
        id: String(id),
        sourceId,
        sourceName,
        title: String(title),
        cover: resolveImage(thumbnailUrl) ?? "",
        description: it.description as string | undefined,
        author: it.author as string | undefined,
        status: it.status as string | undefined,
        artist: it.artist as string | undefined,
        genre: Array.isArray(it.genre) ? (it.genre as string[]).join(", ") : (it.genre as string | undefined),
      };
    })
    .filter((x): x is MangaSearchItem => !!x);
  return { items, hasNextPage };
}

export async function getRecommend(
  source: MangaSource,
  type: "POPULAR" | "LATEST",
  page = 1
): Promise<MangaRecommendResult> {
  const { base, headers } = cfg();
  if (!base) throw new Error("Suwayomi 服务地址未配置");
  const path = type === "POPULAR" ? "popular" : "latest";
  const url = `${base}/api/v1/source/${encodeURIComponent(source.id)}/${path}/${page}`;
  const res = await scriptFetch(url, { method: "GET", headers, timeout: 30_000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json<unknown>();
  const { items, hasNextPage } = normalizeMangaList(body, source.id, source.name);
  return { mangas: items, hasNextPage };
}

export async function searchManga(
  source: MangaSource,
  keyword: string,
  page = 1
): Promise<MangaRecommendResult> {
  const { base, headers } = cfg();
  if (!base) throw new Error("Suwayomi 服务地址未配置");
  const url = `${base}/api/v1/source/${encodeURIComponent(source.id)}/quick-search?searchTerm=${encodeURIComponent(
    keyword
  )}&pageNum=${page}`;
  const res = await scriptFetch(url, { method: "GET", headers, timeout: 30_000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json<unknown>();
  const { items, hasNextPage } = normalizeMangaList(body, source.id, source.name);
  return { mangas: items, hasNextPage };
}

export async function getMangaDetail(mangaId: string): Promise<MangaDetail> {
  const { base, headers } = cfg();
  if (!base) throw new Error("Suwayomi 服务地址未配置");
  const url = `${base}/api/v1/manga/${encodeURIComponent(mangaId)}/full`;
  const res = await scriptFetch(url, { method: "GET", headers, timeout: 30_000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const obj = (await res.json<unknown>()) as Record<string, unknown>;
  const sourceId = String(obj.sourceId ?? "");
  const sourceName = String(obj.sourceName ?? obj.source ?? "");
  const chaptersRaw = (obj.chapters ?? []) as unknown[];
  const chapters: MangaChapter[] = (Array.isArray(chaptersRaw) ? chaptersRaw : [])
    .map((c): MangaChapter | undefined => {
      const it = c as Record<string, unknown>;
      const id = it.id;
      const name = (it.name as string | undefined) ?? (it.title as string | undefined);
      if (id === undefined || !name) return undefined;
      return {
        id: String(id),
        mangaId,
        name,
        chapterNumber: it.chapterNumber as number | undefined,
        scanlator: it.scanlator as string | undefined,
        isRead: it.isRead as boolean | undefined,
        isDownloaded: it.isDownloaded as boolean | undefined,
        pageCount: it.pageCount as number | undefined,
        uploadDate: it.uploadDate as number | undefined,
      };
    })
    .filter((x): x is MangaChapter => !!x);

  return {
    id: mangaId,
    sourceId,
    sourceName,
    title: String(obj.title ?? ""),
    cover: resolveImage(obj.thumbnailUrl as string | undefined) ?? "",
    description: obj.description as string | undefined,
    author: obj.author as string | undefined,
    status: obj.status as string | undefined,
    artist: obj.artist as string | undefined,
    genre: Array.isArray(obj.genre) ? (obj.genre as string[]).join(", ") : (obj.genre as string | undefined),
    chapters,
  };
}

export async function getChapterPages(chapterId: string): Promise<string[]> {
  const { base, headers } = cfg();
  if (!base) throw new Error("Suwayomi 服务地址未配置");
  const url = `${base}/api/v1/chapter/${encodeURIComponent(chapterId)}/pages`;
  const res = await scriptFetch(url, { method: "GET", headers, timeout: 30_000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json<unknown>();
  // Suwayomi 返回结构可能是 { pages: ["...", "..."] } 或直接数组
  const list = Array.isArray(body)
    ? body
    : (body as { pages?: unknown[] }).pages ?? [];
  return (Array.isArray(list) ? list : [])
    .map((p) => {
      if (typeof p === "string") return p;
      if (p && typeof p === "object") {
        const url = (p as { url?: string; src?: string }).url ?? (p as { src?: string }).src;
        if (typeof url === "string") return url;
      }
      return null;
    })
    .filter((u): u is string => !!u)
    .map((u) => resolveImage(u) ?? u);
}
