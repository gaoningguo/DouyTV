/**
 * 共享播放解析 hook —— 从 Play.tsx 抽出，供全屏播放页和详情页内嵌播放器共用。
 *
 * 输入 script + detail + 当前线路/集索引，负责：
 *   取 playback.episodes[epIdx] → 按 needResolve 决定是否 callResolvePlayUrl
 *   → 组装出 VideoPlayer 需要的 MediaItem（含选集元数据）。
 *
 * 走 playbackPrefetch 缓存：预取命中时同步上屏，跳过「RESOLVING」等待（丝滑切换）。
 * 切线路 / 切集 / 切视频（scriptKey|vodId 变）都会重新解析。
 */
import { useEffect, useState } from "react";
import type { ScriptDescriptor, ScriptDetailResult } from "@/source-script/types";
import type { MediaItem } from "@/types/media";
import { getResolved, peekResolved } from "@/lib/playbackPrefetch";

interface UsePlaybackArgs {
  script?: ScriptDescriptor;
  detail?: ScriptDetailResult;
  scriptKey: string;
  vodId: string;
  pbIdx: number;
  epIdx: number;
}

interface UsePlaybackResult {
  item?: MediaItem;
  resolving: boolean;
  resolveError?: string;
}

export function usePlayback({
  script,
  detail,
  scriptKey,
  vodId,
  pbIdx,
  epIdx,
}: UsePlaybackArgs): UsePlaybackResult {
  const [item, setItem] = useState<MediaItem | undefined>(undefined);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | undefined>(undefined);

  const playback = detail?.playbacks[pbIdx];
  const episode = playback?.episodes[epIdx];

  useEffect(() => {
    if (!script || !playback || episode === undefined) return;
    let aborted = false;
    const playUrl = typeof episode === "string" ? episode : episode.playUrl;
    const needResolve =
      typeof episode === "string" ? true : episode.needResolve !== false;
    const resolveArgs = {
      playUrl,
      sourceId: playback.sourceId,
      episodeIndex: epIdx,
    };

    // 组装 MediaItem —— 拿到解析结果后统一走这里。
    const buildItem = (resolved: {
      url: string;
      type?: "auto" | "mp4" | "hls" | "dash" | "flv";
      headers?: Record<string, string>;
    }): MediaItem => ({
      id: `${scriptKey}:${vodId}`,
      kind: "video",
      title: detail?.title || vodId,
      poster: detail?.poster,
      url: resolved.url,
      streamType: resolved.type ?? "auto",
      headers: resolved.headers ?? {},
      sourceId: playback.sourceId,
      sourceName: playback.sourceName,
      episodes: playback.episodes,
      episodesTitles: playback.episodes_titles,
      currentEpisodeIndex: epIdx,
      scriptKey,
      vodId,
    });

    // 不需要解析的直接上屏。
    if (!needResolve) {
      setItem(buildItem({ url: playUrl, type: "auto", headers: {} }));
      setResolving(false);
      setResolveError(undefined);
      return () => {
        aborted = true;
      };
    }

    // 1) 预取缓存命中 → 同步上屏，跳过 RESOLVING（丝滑切换的关键）。
    const cached = peekResolved(script, resolveArgs);
    if (cached) {
      setItem(buildItem(cached));
      setResolving(false);
      setResolveError(undefined);
      return () => {
        aborted = true;
      };
    }

    setResolving(true);
    setResolveError(undefined);

    // 2) 走 getResolved：命中在途预取则复用，否则解析并写缓存。
    getResolved(script, resolveArgs)
      .then((resolved) => {
        if (aborted) return;
        setItem(buildItem(resolved));
      })
      .catch((e) => {
        if (!aborted) setResolveError((e as Error)?.message ?? String(e));
      })
      .finally(() => {
        if (!aborted) setResolving(false);
      });

    return () => {
      aborted = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script?.key, vodId, pbIdx, epIdx, detail?.title]);

  return { item, resolving, resolveError };
}
