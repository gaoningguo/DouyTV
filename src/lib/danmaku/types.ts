/**
 * MoonTV/DanDanPlay 兼容的弹幕类型定义。
 * 直接对齐 MoonTVPlus/src/lib/danmaku/types.ts，方便用户复用 MoonTV 已部署的 danmu_api。
 */

export interface DanmakuSearchResponse {
  errorCode: number;
  success: boolean;
  errorMessage: string;
  animes: DanmakuAnime[];
}

export interface DanmakuAnime {
  animeId: number;
  bangumiId?: string;
  animeTitle: string;
  type: string;
  typeDescription: string;
  imageUrl?: string;
  startDate?: string;
  episodeCount?: number;
  rating?: number;
  source: string;
}

/** 弹幕原始数据（Bilibili XML 格式 / DanDanPlay v2 JSON 都解析成这个） */
export interface DanmakuComment {
  /** 属性串 "时间,类型,字体,颜色,时间戳,弹幕池,用户Hash,弹幕ID" */
  p: string;
  /** 文本 */
  m: string;
  /** 弹幕 ID（从 p 字段第 8 项提取） */
  cid: number;
}

export interface DanmakuCommentsResponse {
  count: number;
  comments: DanmakuComment[];
}

export interface DanmakuEpisode {
  episodeId: number;
  episodeTitle: string;
}

export interface DanmakuBangumi {
  bangumiId: string;
  animeTitle: string;
  imageUrl?: string;
  episodes: DanmakuEpisode[];
}

export interface DanmakuEpisodesResponse {
  errorCode: number;
  success: boolean;
  errorMessage: string;
  bangumi: DanmakuBangumi;
}

export interface DanmakuMatch {
  episodeId: number;
  animeId: number;
  animeTitle: string;
  episodeTitle: string;
  type: string;
  typeDescription: string;
  shift: number;
}

export interface DanmakuMatchResponse {
  errorCode: number;
  success: boolean;
  errorMessage: string;
  isMatched: boolean;
  matches: DanmakuMatch[];
}

/** 用户在播放页选定的弹幕来源（用于持久化 / 自动加载） */
export interface DanmakuSelection {
  animeId: number;
  episodeId: number;
  animeTitle: string;
  episodeTitle: string;
  searchKeyword?: string;
  danmakuCount?: number;
}

/** 过滤规则：normal=字符串包含；regex=正则 */
export interface DanmakuFilterRule {
  enabled: boolean;
  type: "normal" | "regex";
  keyword: string;
}

export type DanmakuSourceType = "builtin" | "custom";
