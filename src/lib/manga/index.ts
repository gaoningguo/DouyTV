// 漫画模块统一入口 —— 用传入的 SuwayomiConfig 构造 Suwayomi 客户端并转发调用。
//
// MoonTVPlus 的 UI 走 /api/manga/* 服务端路由(路由内 new SuwayomiClient(getConfig()))。
// DouyTV 没有服务端,UI 直接调这里的函数。为避免 lib 与 zustand store 耦合,
// config 由调用方(页面从 useMangaStore 读)显式传入,lib 只负责现造 client 转发。

import { createSuwayomiClient } from "./suwayomi";
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

export * from "./types";

function client(config: SuwayomiConfig) {
  if (!config.enabled || !config.serverUrl) {
    throw new Error("漫画未启用,请先在设置里配置 Suwayomi 服务地址");
  }
  return createSuwayomiClient(config);
}

export function isMangaConfigured(config: SuwayomiConfig): boolean {
  return !!config.enabled && !!config.serverUrl;
}

export function getMangaSources(
  config: SuwayomiConfig,
  lang?: string
): Promise<MangaSource[]> {
  return client(config).getSources(lang);
}

export function searchManga(
  config: SuwayomiConfig,
  keyword: string,
  sourceId?: string,
  page = 1
): Promise<MangaSearchResult> {
  return client(config).searchManga(keyword, sourceId, page);
}

/** 流式多源搜索 —— 等价 MoonTVPlus SSE fluid search,纯前端逐源回调。 */
export function searchMangaStream(
  config: SuwayomiConfig,
  keyword: string,
  handlers: {
    onStart?: (total: number) => void;
    onSourceResult?: (
      source: { id: string; displayName?: string; name?: string },
      results: MangaSearchItem[],
      done: number,
      total: number
    ) => void;
    onSourceError?: (
      failure: MangaSearchFailure,
      done: number,
      total: number
    ) => void;
  },
  sourceId?: string,
  page = 1
): Promise<MangaSearchResult> {
  return client(config).searchMangaStream(keyword, handlers, sourceId, page);
}

export function getRecommendedManga(
  config: SuwayomiConfig,
  sourceId: string,
  type: MangaRecommendType = "POPULAR",
  page = 1
): Promise<MangaRecommendResult> {
  return client(config).getRecommendedManga(sourceId, type, page);
}

/** 全源聚合推荐流 —— 首页信息流用(逐源增量回调)。 */
export function getAggregatedRecommendStream(
  config: SuwayomiConfig,
  handlers: {
    onStart?: (total: number) => void;
    onSourceResult?: (
      source: { id: string; displayName?: string; name?: string },
      mangas: MangaSearchItem[],
      hasNextPage: boolean,
      done: number,
      total: number
    ) => void;
    onSourceError?: (
      failure: MangaSearchFailure,
      done: number,
      total: number
    ) => void;
  },
  type: MangaRecommendType = "POPULAR",
  page = 1
): Promise<{ mangas: MangaSearchItem[]; failedSources: MangaSearchFailure[] }> {
  return client(config).getAggregatedRecommendStream(handlers, type, page);
}

export function getMangaDetail(
  config: SuwayomiConfig,
  input: {
    mangaId: string;
    sourceId: string;
    title?: string;
    cover?: string;
    sourceName?: string;
    description?: string;
    author?: string;
    status?: string;
  }
): Promise<MangaDetail> {
  return client(config).getMangaDetail(input);
}

export function getMangaChapters(
  config: SuwayomiConfig,
  mangaId: string
): Promise<MangaChapter[]> {
  return client(config).getChapters(mangaId);
}

export function getMangaChapterPages(
  config: SuwayomiConfig,
  chapterId: string
): Promise<string[]> {
  return client(config).getChapterPages(chapterId);
}
