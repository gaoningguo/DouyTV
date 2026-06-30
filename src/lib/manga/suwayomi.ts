// Suwayomi 漫画 GraphQL 客户端 —— 移植自 MoonTVPlus src/lib/suwayomi.client.ts。
//
// 与原项目差异(Next.js server → Tauri client):
//   - Node `fetch`(无 CORS) → `readingFetchText`(走 Rust script_http_bytes,绕 CORS)
//   - Node `crypto` sha256 → crypto-js(同步,浏览器可用)
//   - 服务端 `/api/manga/image?path=` 代理 → 前端 `wrapImage`(dyproxy /proxy/image)
//   - 配置来自 manga store(localStorage)而非服务端 getConfig()
//
// Suwayomi 是用户自部署的服务,鉴权信息(basic/simple_login)只在本机内存 + IPC 流转。

import sha256 from "crypto-js/sha256";
import encBase64 from "crypto-js/enc-base64";
import encUtf8 from "crypto-js/enc-utf8";
import { readingFetchText } from "@/lib/reading/net";
import { wrapImage } from "@/lib/proxy";
import type {
  MangaChapter,
  MangaDetail,
  MangaRecommendResult,
  MangaRecommendType,
  MangaSearchFailure,
  MangaSearchItem,
  MangaSearchResult,
  MangaSource,
  SuwayomiConfig,
} from "./types";

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

interface ResolvedSuwayomiConfig {
  serverBaseUrl: string;
  serverUrl: string;
  authMode: "none" | "basic_auth" | "simple_login";
  username?: string;
  password?: string;
  defaultLang: string;
  sourceIds: string[];
  maxSources: number;
}

interface SessionCacheEntry {
  cookieHeader: string;
  expiresAt: number;
}

const SUWAYOMI_SESSION_TTL_MS = 25 * 60 * 1000;
const sessionCache = new Map<string, SessionCacheEntry>();

function btoaUtf8(input: string): string {
  // 浏览器 btoa 不支持非 latin1;用户名密码可能含非 ASCII,走 crypto-js 编码。
  return encBase64.stringify(encUtf8.parse(input));
}

function buildBasicAuthHeader(username: string, password: string): string {
  return `Basic ${btoaUtf8(`${username}:${password}`)}`;
}

function hashSimpleLoginPassword(password?: string): string {
  return sha256(password || "").toString();
}

function resolveConfig(config: SuwayomiConfig): ResolvedSuwayomiConfig {
  if (!config.serverUrl) {
    throw new Error("Suwayomi 未配置,请先在设置里填写服务地址");
  }
  const normalizedBaseUrl = config.serverUrl.replace(/\/$/, "");
  return {
    serverBaseUrl: normalizedBaseUrl,
    serverUrl: normalizedBaseUrl + "/api/graphql",
    authMode: config.authMode || "none",
    username: config.username || undefined,
    password: config.password || undefined,
    defaultLang: config.defaultLang || "zh",
    sourceIds: config.sourceIds || [],
    maxSources: config.maxSources || 10,
  };
}

function getSimpleLoginCacheKey(resolved: ResolvedSuwayomiConfig): string {
  return `${resolved.serverBaseUrl}|${resolved.username || ""}|${hashSimpleLoginPassword(
    resolved.password
  )}`;
}

function extractCookieHeader(headers: Record<string, string>): string | null {
  // readingFetch 返回的 headers 是小写键;set-cookie 可能被合并成一条
  const raw = headers["set-cookie"];
  if (!raw) return null;
  const cookies = raw
    .split(/,(?=\s*[^;,]+=)/)
    .map((item) => item.split(";", 1)[0]?.trim())
    .filter(Boolean) as string[];
  return cookies.length > 0 ? cookies.join("; ") : null;
}

async function loginWithSimpleAuth(
  resolved: ResolvedSuwayomiConfig,
  forceRefresh = false
): Promise<string> {
  if (!resolved.username || !resolved.password) {
    throw new Error("Suwayomi simple_login 缺少用户名或密码");
  }
  const cacheKey = getSimpleLoginCacheKey(resolved);
  const cached = sessionCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.cookieHeader;
  }

  const body = new URLSearchParams({
    user: resolved.username,
    pass: resolved.password,
  }).toString();

  const res = await readingFetchText(
    `${resolved.serverBaseUrl}/login.html?redirect=${encodeURIComponent("/api/graphql")}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    }
  );

  const cookieHeader = extractCookieHeader(res.headers);
  if (!cookieHeader) {
    throw new Error(`Suwayomi simple_login 登录失败: ${res.status}`);
  }
  sessionCache.set(cacheKey, {
    cookieHeader,
    expiresAt: Date.now() + SUWAYOMI_SESSION_TTL_MS,
  });
  return cookieHeader;
}

async function authHeaders(
  resolved: ResolvedSuwayomiConfig,
  forceSimpleLoginRefresh = false
): Promise<Record<string, string>> {
  if (resolved.authMode === "basic_auth") {
    if (!resolved.username || !resolved.password) {
      throw new Error("Suwayomi basic_auth 缺少用户名或密码");
    }
    return { Authorization: buildBasicAuthHeader(resolved.username, resolved.password) };
  }
  if (resolved.authMode === "simple_login") {
    return { Cookie: await loginWithSimpleAuth(resolved, forceSimpleLoginRefresh) };
  }
  return {};
}

function normalizeMangaStatus(status?: string): string | undefined {
  if (!status) return undefined;
  switch (status.trim().toUpperCase()) {
    case "ONGOING":
      return "连载中";
    case "COMPLETED":
    case "PUBLISHING_FINISHED":
      return "已完结";
    case "LICENSED":
      return "已授权";
    case "CANCELLED":
      return "已取消";
    case "ON_HIATUS":
      return "休刊中";
    case "UNKNOWN":
    case "UNRECOGNIZED":
      return undefined;
    default:
      return status;
  }
}

/**
 * Suwayomi 图片 URL 改写。原项目走服务端 /api/manga/image 代理(注入鉴权)。
 * 这里把相对路径补成 Suwayomi 服务器绝对 URL,再走 dyproxy /proxy/image(二进制透传 + CORS)。
 *
 * 注意:basic_auth 模式下 Suwayomi 图片端点需要 Authorization;dyproxy 当前只注入 UA/Referer。
 * 多数自部署 Suwayomi 把缩略图/页面图设为匿名可读,鉴权仅作用于 GraphQL。若用户开了 basic_auth
 * 且图片也要鉴权,后续可在 dyproxy image 端点支持自定义 header(留作增强项)。
 */
function buildImageUrl(resolved: ResolvedSuwayomiConfig, pathOrUrl: string): string {
  if (!pathOrUrl) return "";
  const abs = /^https?:\/\//i.test(pathOrUrl)
    ? pathOrUrl
    : `${resolved.serverBaseUrl}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
  return wrapImage(abs) || abs;
}

export class SuwayomiClient {
  private config: SuwayomiConfig;

  constructor(config: SuwayomiConfig) {
    this.config = config;
  }

  private async graphqlRequest<T>(
    query: string,
    variables?: Record<string, unknown>,
    operationName?: string
  ): Promise<T> {
    const resolved = resolveConfig(this.config);
    const exec = async (forceRefresh: boolean) => {
      const headers = {
        "Content-Type": "application/json",
        ...(await authHeaders(resolved, forceRefresh)),
      };
      return readingFetchText(resolved.serverUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables, operationName }),
      });
    };

    let res = await exec(false);
    if (res.status === 401 && resolved.authMode === "simple_login") {
      res = await exec(true);
    }
    if (!res.ok) {
      throw new Error(`Suwayomi 请求失败: ${res.status}`);
    }
    let data: GraphQLResponse<T>;
    try {
      data = JSON.parse(res.text) as GraphQLResponse<T>;
    } catch {
      throw new Error("Suwayomi 返回非 JSON 响应");
    }
    if (data.errors?.length) {
      throw new Error(data.errors.map((item) => item.message || "Unknown error").join("; "));
    }
    if (!data.data) {
      throw new Error("Suwayomi 返回空数据");
    }
    return data.data;
  }

  async getSources(lang?: string): Promise<MangaSource[]> {
    const resolved = resolveConfig(this.config);
    const query = `
      query GetSources {
        sources {
          nodes { id name lang displayName }
        }
      }
    `;
    const data = await this.graphqlRequest<{
      sources?: {
        nodes?: Array<{ id: string; name?: string; lang?: string; displayName?: string }>;
      };
    }>(query);

    const nodes = data.sources?.nodes || [];
    const filtered = nodes.filter((item) => !lang || item.lang === lang);
    const scoped =
      resolved.sourceIds.length > 0
        ? filtered.filter((item) => resolved.sourceIds.includes(String(item.id)))
        : filtered;
    return scoped.map((item) => ({
      id: String(item.id),
      name: item.name || item.displayName || String(item.id),
      lang: item.lang,
      displayName: item.displayName,
    }));
  }

  async getSearchSources(
    sourceId?: string
  ): Promise<Array<{ id: string; displayName?: string; name?: string }>> {
    const resolved = resolveConfig(this.config);
    if (sourceId) {
      const matched = (await this.getSources()).find((item) => item.id === sourceId);
      return [
        {
          id: sourceId,
          displayName: matched?.displayName || matched?.name || sourceId,
          name: matched?.name || matched?.displayName || sourceId,
        },
      ];
    }
    try {
      return (await this.getSources(resolved.defaultLang)).slice(0, resolved.maxSources);
    } catch (error) {
      if (resolved.sourceIds.length === 0) throw error;
      return resolved.sourceIds.slice(0, resolved.maxSources).map((id) => ({
        id,
        displayName: id,
        name: id,
      }));
    }
  }

  async searchMangaSource(
    keyword: string,
    source: { id: string; displayName?: string; name?: string },
    page = 1
  ): Promise<{ source: typeof source; results: MangaSearchItem[] }> {
    const resolved = resolveConfig(this.config);
    const query = `
      mutation GET_SOURCE_MANGAS_FETCH($input: FetchSourceMangaInput!) {
        fetchSourceManga(input: $input) {
          mangas { id title thumbnailUrl sourceId description author artist genre status }
        }
      }
    `;
    const data = await this.graphqlRequest<{
      fetchSourceManga?: {
        mangas?: Array<{
          id: string | number;
          title?: string;
          thumbnailUrl?: string;
          sourceId?: string | number;
          description?: string;
          author?: string;
          artist?: string;
          genre?: string;
          status?: string;
        }>;
      };
    }>(query, { input: { type: "SEARCH", source: source.id, query: keyword, page } }, "GET_SOURCE_MANGAS_FETCH");

    const seen = new Set<string>();
    const sourceName = source.displayName || source.name || String(source.id);
    const results = (data.fetchSourceManga?.mangas || [])
      .filter((manga) => {
        const key = `${source.id}:${manga.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((manga) => ({
        id: String(manga.id),
        sourceId: String(manga.sourceId || source.id),
        sourceName,
        title: manga.title || "未命名漫画",
        cover: buildImageUrl(resolved, manga.thumbnailUrl || ""),
        description: manga.description,
        author: manga.author,
        artist: manga.artist,
        genre: manga.genre,
        status: normalizeMangaStatus(manga.status),
      }));
    return { source, results };
  }

  async searchManga(keyword: string, sourceId?: string, page = 1): Promise<MangaSearchResult> {
    const sources = await this.getSearchSources(sourceId);
    const results: MangaSearchItem[] = [];
    const failedSources: MangaSearchFailure[] = [];
    const seen = new Set<string>();

    const perSource = await Promise.all(
      sources.map(async (source) => {
        try {
          return await this.searchMangaSource(keyword, source, page);
        } catch (error) {
          const message = error instanceof Error ? error.message : "未知错误";
          failedSources.push({
            sourceId: String(source.id),
            sourceName: source.displayName || source.name || String(source.id),
            error: message,
          });
          return { source, results: [] as MangaSearchItem[] };
        }
      })
    );

    for (const { results: sourceResults } of perSource) {
      for (const manga of sourceResults) {
        const key = `${manga.sourceId}:${manga.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(manga);
      }
    }
    return { results, failedSources };
  }

  async getRecommendedManga(
    sourceId: string,
    type: MangaRecommendType = "POPULAR",
    page = 1
  ): Promise<MangaRecommendResult> {
    if (!sourceId) return { mangas: [], hasNextPage: false };
    const resolved = resolveConfig(this.config);
    const query = `
      fragment MANGA_BASE_FIELDS on MangaType {
        id title thumbnailUrl sourceId description author artist genre status
      }
      mutation GET_SOURCE_MANGAS_FETCH($input: FetchSourceMangaInput!) {
        fetchSourceManga(input: $input) {
          hasNextPage
          mangas { ...MANGA_BASE_FIELDS }
        }
      }
    `;
    const sources = await this.getSources();
    const matchedSource = sources.find((item) => item.id === sourceId);
    const data = await this.graphqlRequest<{
      fetchSourceManga?: {
        hasNextPage?: boolean;
        mangas?: Array<{
          id: string | number;
          title?: string;
          thumbnailUrl?: string;
          sourceId?: string | number;
          description?: string;
          author?: string;
          artist?: string;
          genre?: string;
          status?: string;
        }>;
      };
    }>(query, { input: { type, source: sourceId, page } }, "GET_SOURCE_MANGAS_FETCH");

    return {
      hasNextPage: Boolean(data.fetchSourceManga?.hasNextPage),
      mangas: (data.fetchSourceManga?.mangas || []).map((manga) => ({
        id: String(manga.id),
        sourceId: String(manga.sourceId || sourceId),
        sourceName: matchedSource?.displayName || matchedSource?.name || sourceId,
        title: manga.title || "未命名漫画",
        cover: buildImageUrl(resolved, manga.thumbnailUrl || ""),
        description: manga.description,
        author: manga.author,
        artist: manga.artist,
        genre: manga.genre,
        status: normalizeMangaStatus(manga.status),
      })),
    };
  }

  async getChapters(mangaId: string): Promise<MangaChapter[]> {
    const mutation = `
      mutation GET_MANGA_CHAPTERS_FETCH($input: FetchChaptersInput!) {
        fetchChapters(input: $input) {
          chapters { id mangaId name chapterNumber scanlator isRead isDownloaded pageCount uploadDate }
        }
      }
    `;
    const data = await this.graphqlRequest<{
      fetchChapters?: {
        chapters?: Array<{
          id: string | number;
          mangaId?: string | number;
          name?: string;
          chapterNumber?: number;
          scanlator?: string;
          isRead?: boolean;
          isDownloaded?: boolean;
          pageCount?: number;
          uploadDate?: number;
        }>;
      };
    }>(mutation, { input: { mangaId: Number(mangaId) || mangaId } }, "GET_MANGA_CHAPTERS_FETCH");

    return (data.fetchChapters?.chapters || []).map((chapter) => ({
      id: String(chapter.id),
      mangaId: String(chapter.mangaId || mangaId),
      name: chapter.name || "未命名章节",
      chapterNumber: chapter.chapterNumber,
      scanlator: chapter.scanlator,
      isRead: chapter.isRead,
      isDownloaded: chapter.isDownloaded,
      pageCount: chapter.pageCount,
      uploadDate: chapter.uploadDate,
    }));
  }

  async getMangaDetail(input: {
    mangaId: string;
    sourceId: string;
    title?: string;
    cover?: string;
    sourceName?: string;
    description?: string;
    author?: string;
    status?: string;
  }): Promise<MangaDetail> {
    const resolved = resolveConfig(this.config);
    const chapters = await this.getChapters(input.mangaId);

    let metadata: Partial<MangaSearchItem> = {
      id: input.mangaId,
      sourceId: input.sourceId,
      sourceName: input.sourceName || input.sourceId,
      title: input.title || "漫画详情",
      cover: input.cover || "",
      description: input.description,
      author: input.author,
      status: input.status,
    };

    const detailQuery = `
      query MangaDetail($id: LongString!) {
        manga(id: $id) {
          id title thumbnailUrl sourceId description author artist genre status
        }
      }
    `;
    try {
      const detailData = await this.graphqlRequest<{
        manga?: {
          id: string | number;
          title?: string;
          thumbnailUrl?: string;
          sourceId?: string | number;
          description?: string;
          author?: string;
          artist?: string;
          genre?: string;
          status?: string;
        };
      }>(detailQuery, { id: input.mangaId }, "MangaDetail");

      if (detailData.manga) {
        metadata = {
          id: String(detailData.manga.id),
          sourceId: String(detailData.manga.sourceId || input.sourceId),
          sourceName: input.sourceName || input.sourceId,
          title: detailData.manga.title || metadata.title || "漫画详情",
          cover: detailData.manga.thumbnailUrl || input.cover || "",
          description: detailData.manga.description || metadata.description,
          author: detailData.manga.author || metadata.author,
          artist: detailData.manga.artist,
          genre: detailData.manga.genre,
          status:
            normalizeMangaStatus(detailData.manga.status) ||
            normalizeMangaStatus(metadata.status),
        };
      }
    } catch {
      // 某些 Suwayomi 版本不支持 manga(id) 直查,降级用外部参数 + 章节信息
    }

    return {
      id: metadata.id || input.mangaId,
      sourceId: metadata.sourceId || input.sourceId,
      sourceName: metadata.sourceName || input.sourceId,
      title: metadata.title || "漫画详情",
      cover: buildImageUrl(resolved, metadata.cover || ""),
      description: metadata.description,
      author: metadata.author,
      artist: metadata.artist,
      genre: metadata.genre,
      status: normalizeMangaStatus(metadata.status),
      chapters,
    };
  }

  async getChapterPages(chapterId: string): Promise<string[]> {
    const resolved = resolveConfig(this.config);
    const mutation = `
      mutation GET_CHAPTER_PAGES_FETCH($input: FetchChapterPagesInput!) {
        fetchChapterPages(input: $input) { pages }
      }
    `;
    const data = await this.graphqlRequest<{
      fetchChapterPages?: { pages?: string[] };
    }>(mutation, { input: { chapterId: Number(chapterId) || chapterId } }, "GET_CHAPTER_PAGES_FETCH");
    return (data.fetchChapterPages?.pages || []).map((item) => buildImageUrl(resolved, item));
  }
}

/** 用当前 manga store 配置临时构造 client(配置随时可改,不做单例)。 */
export function createSuwayomiClient(config: SuwayomiConfig): SuwayomiClient {
  return new SuwayomiClient(config);
}
