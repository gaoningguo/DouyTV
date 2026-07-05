// 漫画模块统一入口 —— 用当前 manga store 配置构造 Suwayomi 客户端并转发调用。
//
// MoonTVPlus 的 UI 走 /api/manga/* 服务端路由(路由内 new SuwayomiClient(getConfig()))。
// DouyTV 没有服务端,UI 直接调这里的函数,内部用 manga store 的 SuwayomiConfig 现造 client。

import { useMangaStore } from "@/stores/manga";
import { createSuwayomiClient } from "./suwayomi";
import type {
  MangaChapter,
  MangaDetail,
  MangaRecommendResult,
  MangaRecommendType,
  MangaSearchResult,
  MangaSource,
} from "./types";

export * from "./types";

function client() {
  const config = useMangaStore.getState().config;
  if (!config.enabled || !config.serverUrl) {
    throw new Error("漫画未启用,请先在设置里配置 Suwayomi 服务地址");
  }
  return createSuwayomiClient(config);
}

export function isMangaConfigured(): boolean {
  const config = useMangaStore.getState().config;
  return !!config.enabled && !!config.serverUrl;
}

export function getMangaSources(lang?: string): Promise<MangaSource[]> {
  return client().getSources(lang);
}

export function searchManga(
  keyword: string,
  sourceId?: string,
  page = 1
): Promise<MangaSearchResult> {
  return client().searchManga(keyword, sourceId, page);
}

export function getRecommendedManga(
  sourceId: string,
  type: MangaRecommendType = "POPULAR",
  page = 1
): Promise<MangaRecommendResult> {
  return client().getRecommendedManga(sourceId, type, page);
}

export function getMangaDetail(input: {
  mangaId: string;
  sourceId: string;
  title?: string;
  cover?: string;
  sourceName?: string;
  description?: string;
  author?: string;
  status?: string;
}): Promise<MangaDetail> {
  return client().getMangaDetail(input);
}

export function getMangaChapters(mangaId: string): Promise<MangaChapter[]> {
  return client().getChapters(mangaId);
}

export function getMangaChapterPages(chapterId: string): Promise<string[]> {
  return client().getChapterPages(chapterId);
}
