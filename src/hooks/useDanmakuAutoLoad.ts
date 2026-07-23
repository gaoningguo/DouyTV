/**
 * 弹幕自动加载 hook —— 全屏播放页 /play 和详情页内嵌播放器共用。
 *
 * 原本这段逻辑内联在 Play.tsx（约 60 行 state + effect + handler）。详情页也要接弹幕，
 * 于是抽成 hook 两边共用：
 *   1) 优先用上次的手动选择（loadDanmakuMemory by title）；
 *   2) 没记忆时 fallback searchAnime(title) 取第一个结果 + 当前集；
 *   3) 用户随时可在 DanmakuPanel 里换源（handleSelect）。
 *
 * 显示开关（danmakuVisible）跨视频跨重启持久化在 localStorage["douytv:player-danmaku-visible"]。
 */
import { useEffect, useMemo, useState } from "react";
import { useDanmakuStore } from "@/stores/danmaku";
import { loadDanmakuMemory } from "@/components/DanmakuPanel";
import {
  convertDanmakuFormat,
  getDanmakuById,
  getEpisodes,
  searchAnime,
} from "@/lib/danmaku/api";
import type { Danmu } from "artplayer-plugin-danmuku";
import type { DanmakuSelection } from "@/lib/danmaku/types";

const VISIBLE_KEY = "douytv:player-danmaku-visible";

function readVisible(): boolean {
  try {
    const v = localStorage.getItem(VISIBLE_KEY);
    return v == null ? true : v === "1" || v === "true";
  } catch {
    return true;
  }
}

export interface UseDanmakuAutoLoadResult {
  /** 弹幕数据，喂给 VideoPlayer.danmuComments */
  danmuComments: Danmu[];
  /** 当前弹幕选择（anime/episode），null = 未加载 */
  danmakuSelection: DanmakuSelection | null;
  /** 弹幕显示开关（持久化） */
  danmakuVisible: boolean;
  setDanmakuVisible: React.Dispatch<React.SetStateAction<boolean>>;
  /** 弹幕后端是否启用（store.enabled）—— 供 VideoPlayer.danmakuVisible 计算 */
  danmakuEnabled: boolean;
  /** 用于 DanmakuPanel 记忆/搜索的标题 */
  videoTitle: string;
  /** 用户在 DanmakuPanel 里手动选源后调用 */
  handleSelect: (selection: DanmakuSelection) => Promise<void>;
}

/**
 * @param title 视频标题（用于弹幕记忆/搜索）；通常传 detail?.title
 * @param fallbackTitle 标题缺省时的兜底（如 vodId）
 * @param epIdx 当前集索引
 */
export function useDanmakuAutoLoad(
  title: string | undefined,
  fallbackTitle: string,
  epIdx: number
): UseDanmakuAutoLoadResult {
  const danmakuStore = useDanmakuStore();
  const hydrateDanmaku = useDanmakuStore((s) => s.hydrate);

  const [danmakuSelection, setDanmakuSelection] =
    useState<DanmakuSelection | null>(null);
  const [danmuComments, setDanmuComments] = useState<Danmu[]>([]);
  const [danmakuVisible, setDanmakuVisible] = useState<boolean>(readVisible);

  useEffect(() => {
    hydrateDanmaku();
  }, [hydrateDanmaku]);

  useEffect(() => {
    try {
      localStorage.setItem(VISIBLE_KEY, danmakuVisible ? "1" : "0");
    } catch {
      /* private */
    }
  }, [danmakuVisible]);

  const videoTitle = useMemo(
    () => title || fallbackTitle,
    [title, fallbackTitle]
  );

  useEffect(() => {
    if (!danmakuStore.hydrated || !danmakuStore.autoLoad || !videoTitle) return;
    if (!danmakuStore.enabled) return;
    if (danmakuSelection) return;
    let cancelled = false;
    (async () => {
      const mem = loadDanmakuMemory(videoTitle);
      if (mem) {
        const comments = await getDanmakuById(mem.episodeId, videoTitle, epIdx, {
          animeId: mem.animeId,
          animeTitle: mem.animeTitle,
          episodeTitle: mem.episodeTitle,
        });
        if (cancelled) return;
        setDanmakuSelection({
          animeId: mem.animeId,
          episodeId: mem.episodeId,
          animeTitle: mem.animeTitle,
          episodeTitle: mem.episodeTitle,
          searchKeyword: mem.searchKeyword,
          danmakuCount: comments.length,
        });
        setDanmuComments(convertDanmakuFormat(comments));
        return;
      }
      // 没记忆：按标题搜，取第一个 anime + 当前集
      const sr = await searchAnime(videoTitle);
      if (cancelled || !sr.success || sr.animes.length === 0) return;
      const anime = sr.animes[0];
      const er = await getEpisodes(anime.animeId);
      if (cancelled || !er.success || er.bangumi.episodes.length === 0) return;
      const ep = er.bangumi.episodes[epIdx] ?? er.bangumi.episodes[0];
      const comments = await getDanmakuById(ep.episodeId, videoTitle, epIdx, {
        animeId: anime.animeId,
        animeTitle: anime.animeTitle,
        episodeTitle: ep.episodeTitle,
      });
      if (cancelled || comments.length === 0) return;
      setDanmakuSelection({
        animeId: anime.animeId,
        episodeId: ep.episodeId,
        animeTitle: anime.animeTitle,
        episodeTitle: ep.episodeTitle,
        danmakuCount: comments.length,
      });
      setDanmuComments(convertDanmakuFormat(comments));
    })();
    return () => {
      cancelled = true;
    };
  }, [
    danmakuStore.hydrated,
    danmakuStore.autoLoad,
    danmakuStore.enabled,
    videoTitle,
    epIdx,
    danmakuSelection,
  ]);

  const handleSelect = async (selection: DanmakuSelection) => {
    setDanmakuSelection(selection);
    const comments = await getDanmakuById(selection.episodeId, videoTitle, epIdx, {
      animeId: selection.animeId,
      animeTitle: selection.animeTitle,
      episodeTitle: selection.episodeTitle,
    });
    setDanmakuSelection({ ...selection, danmakuCount: comments.length });
    setDanmuComments(convertDanmakuFormat(comments));
    setDanmakuVisible(true);
  };

  return {
    danmuComments,
    danmakuSelection,
    danmakuVisible,
    setDanmakuVisible,
    danmakuEnabled: danmakuStore.enabled,
    videoTitle,
    handleSelect,
  };
}
