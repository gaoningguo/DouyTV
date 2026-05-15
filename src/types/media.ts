import type { ScriptEpisode } from "@/source-script/types";

export type MediaKind = "video" | "live" | "manga" | "book";

export interface MediaItem {
  id: string;
  kind: MediaKind;
  title: string;
  poster?: string;
  url: string;
  streamType?: "auto" | "mp4" | "hls" | "dash" | "flv";
  headers?: Record<string, string>;
  duration?: number;
  sourceId?: string;
  sourceName?: string;
  author?: string;
  description?: string;
  year?: string;
  remarks?: string;
  /** 类型标签（用于推荐 type_match） */
  typeName?: string;

  // —— 合集 / 选集相关（仅 video kind 在 VideoFeed 内使用） ——
  /** 该合集的所有集（来自 detail.playbacks[0].episodes） */
  episodes?: ScriptEpisode[];
  /** 集标题列表，缺省时回落到 "第N集" */
  episodesTitles?: string[];
  /** 当前正在播放的集索引，默认 0 */
  currentEpisodeIndex?: number;
  /** 用于回查 detail / 重 resolve */
  scriptKey?: string;
  vodId?: string;
}

export interface PlayProgress {
  itemId: string;
  position: number;
  duration: number;
  updatedAt: number;
}
