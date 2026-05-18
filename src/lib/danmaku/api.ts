/**
 * DanDanPlay / danmu_api 兼容的弹幕 API 客户端。
 *
 * 全部走 `scriptFetch` 而非 `window.fetch` —— 这样 Windows WebView2 / Android WebView
 * 不会因为 CORS preflight 阻塞，且统一走用户设置的系统代理（与源脚本一致）。
 *
 * 与 MoonTV 的差异：
 *  - MoonTV 在 Next.js 后端做了一层 /api/danmaku/* 代理，本端没有 Node 服务，所以
 *    `scriptFetch` 直接打弹幕后端 — Tauri Rust HTTP 同样能绕 CORS。
 *  - DouyTV 不做 Cookie 透传（弹幕后端不需要鉴权 cookie）。
 *
 * Comment 转换：DanDanPlay 的 p 字段第二项 1=滚动 / 4=底部 / 5=顶部，
 * 这里映射到 artplayer-plugin-danmuku 的 mode 0/2/1。
 */
import { scriptFetch } from "@/source-script/fetch";
import { useDanmakuStore } from "@/stores/danmaku";
import {
  getDanmakuFromCache,
  saveDanmakuToCache,
} from "./cache";
import { getDanmakuApiBaseUrl } from "./config";
import { parseXmlDanmaku, parseJsonDanmaku } from "./xml-parser";
import type {
  DanmakuComment,
  DanmakuEpisodesResponse,
  DanmakuMatchResponse,
  DanmakuSearchResponse,
} from "./types";
import type { Danmu } from "artplayer-plugin-danmuku";

function currentApiBase(): string {
  const s = useDanmakuStore.getState();
  return getDanmakuApiBaseUrl({
    sourceType: s.sourceType,
    apiBase: s.apiBase,
    token: s.token,
  });
}

export async function searchAnime(keyword: string): Promise<DanmakuSearchResponse> {
  try {
    const base = currentApiBase();
    const url = `${base}/api/v2/search/anime?keyword=${encodeURIComponent(keyword)}`;
    const res = await scriptFetch(url, { method: "GET", timeout: 30_000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json<DanmakuSearchResponse>();
  } catch (e) {
    return {
      errorCode: -1,
      success: false,
      errorMessage: e instanceof Error ? e.message : "搜索失败",
      animes: [],
    };
  }
}

export async function matchAnime(fileName: string): Promise<DanmakuMatchResponse> {
  try {
    const base = currentApiBase();
    const url = `${base}/api/v2/match`;
    const res = await scriptFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      json: { fileName },
      timeout: 30_000,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json<DanmakuMatchResponse>();
  } catch (e) {
    return {
      errorCode: -1,
      success: false,
      errorMessage: e instanceof Error ? e.message : "匹配失败",
      isMatched: false,
      matches: [],
    };
  }
}

export async function getEpisodes(animeId: number): Promise<DanmakuEpisodesResponse> {
  try {
    const base = currentApiBase();
    const url = `${base}/api/v2/bangumi/${animeId}`;
    const res = await scriptFetch(url, { method: "GET", timeout: 30_000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json<DanmakuEpisodesResponse>();
  } catch (e) {
    return {
      errorCode: -1,
      success: false,
      errorMessage: e instanceof Error ? e.message : "获取失败",
      bangumi: { bangumiId: "", animeTitle: "", episodes: [] },
    };
  }
}

/**
 * 通过 episodeId 拿弹幕，带 title+episodeIndex 时优先走缓存。
 *
 * danmu_api 返回 XML 或 JSON：format=xml 走 parseXmlDanmaku；
 * 某些后端会忽略 format 参数直接返回 JSON `{count, comments:[{cid,p,m}]}`,
 * 这种情况下我们用 parseJsonDanmaku fallback。
 */
export async function getDanmakuById(
  episodeId: number,
  title?: string,
  episodeIndex?: number,
  metadata?: {
    animeId?: number;
    animeTitle?: string;
    episodeTitle?: string;
  }
): Promise<DanmakuComment[]> {
  if (title && episodeIndex !== undefined && episodeIndex >= 0) {
    const cached = await getDanmakuFromCache(title, episodeIndex);
    if (cached) return cached.comments;
  }

  try {
    const base = currentApiBase();
    const url = `${base}/api/v2/comment/${episodeId}?format=xml`;
    const res = await scriptFetch(url, {
      method: "GET",
      headers: { Accept: "application/xml, text/xml, application/json, */*" },
      timeout: 120_000,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    let comments: DanmakuComment[];
    const trimmed = body.trimStart();
    if (trimmed.startsWith("<")) {
      comments = parseXmlDanmaku(body);
    } else {
      try {
        const parsed = JSON.parse(body) as { comments?: unknown[] };
        comments = parseJsonDanmaku(parsed.comments ?? []);
      } catch {
        comments = [];
      }
    }

    if (
      comments.length > 0 &&
      title &&
      episodeIndex !== undefined &&
      episodeIndex >= 0
    ) {
      void saveDanmakuToCache(title, episodeIndex, comments, {
        episodeId,
        animeId: metadata?.animeId,
        animeTitle: metadata?.animeTitle,
        episodeTitle: metadata?.episodeTitle,
      });
    }
    return comments;
  } catch (e) {
    console.error("[danmaku] getDanmakuById failed", e);
    return [];
  }
}

/**
 * DanDanPlay p 格式 → artplayer-plugin-danmuku Danmu。
 * p 字段：`time,type,fontSize,color,timestamp,pool,userHash,cid`
 * type: 1=滚动, 4=底部, 5=顶部 → mode: 0=滚动, 2=底部, 1=顶部
 */
export function convertDanmakuFormat(comments: DanmakuComment[]): Danmu[] {
  return comments.map((c) => {
    const parts = c.p.split(",");
    const time = parseFloat(parts[0]) || 0;
    const type = parseInt(parts[1], 10) || 1;
    const colorValue = parseInt(parts[3], 10) || 16777215;
    const color = `#${colorValue.toString(16).padStart(6, "0")}`;
    let mode: 0 | 1 | 2 = 0;
    if (type === 5) mode = 1;
    else if (type === 4) mode = 2;
    return {
      text: c.m,
      time,
      color,
      border: false,
      mode,
    };
  });
}
