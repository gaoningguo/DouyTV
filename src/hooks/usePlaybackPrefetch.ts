/**
 * 播放预取 hook —— 让「下一集 / 下一条」切换丝滑。
 *
 * 播放接近结尾时（剩余 < 阈值），后台预解析下一目标的播放地址：
 *   - 有下一集 → 预解析同视频下一集（prefetchEpisode）；
 *   - 末集 / 单集 → 预取列表里下一条视频的 detail + 其首个可播线路首集（prefetchItem）。
 * 切过去时 usePlayback / useDetail 直接命中缓存，跳过「RESOLVING」等待。
 *
 * 用法：把返回的 maybePrefetch 放进 VideoPlayer 的 onProgress 里调。
 */
import { useCallback, useRef } from "react";
import { useScriptStore } from "@/stores/scripts";
import type { ScriptDescriptor, ScriptDetailResult } from "@/source-script/types";
import type { SearchResult } from "@/hooks/useSearch";
import { prefetchEpisode, prefetchItem } from "@/lib/playbackPrefetch";

// 剩余时间小于这个值就开始预取下一目标（秒）。给足网络解析 + 首段缓冲的时间。
const PREFETCH_LEAD_SEC = 75;

interface Args {
  script?: ScriptDescriptor;
  detail?: ScriptDetailResult;
  vodId: string;
  pbIdx: number;
  epIdx: number;
  /** 同级列表（末集/单集时用来定位下一条视频）。 */
  browseResults: SearchResult[];
}

export function usePlaybackPrefetch({
  script,
  detail,
  vodId,
  pbIdx,
  epIdx,
  browseResults,
}: Args): (position: number, duration: number) => void {
  // 每个 (vodId|pbIdx|epIdx) 只触发一次预取，避免 onProgress 高频重复调。
  const firedRef = useRef<string>("");

  return useCallback(
    (position: number, duration: number) => {
      if (!script || !detail || duration <= 0) return;
      if (duration - position > PREFETCH_LEAD_SEC) return;
      const fireKey = `${vodId}|${pbIdx}|${epIdx}`;
      if (firedRef.current === fireKey) return;
      firedRef.current = fireKey;

      const playback = detail.playbacks[pbIdx];
      if (!playback) return;
      const totalEps = playback.episodes.length;

      // 有下一集 → 预解析下一集。
      if (epIdx + 1 < totalEps) {
        prefetchEpisode(script, playback, epIdx + 1);
        return;
      }

      // 末集 / 单集 → 预取列表下一条视频（detail + 首集）。
      if (browseResults.length === 0) return;
      const itemId = `${script.key}:${vodId}`;
      const idx = browseResults.findIndex(
        (row) => `${row.scriptKey}:${row.vod.id}` === itemId
      );
      const next = idx >= 0 ? browseResults[idx + 1] : undefined;
      if (!next) return;
      const nextDesc = useScriptStore
        .getState()
        .scripts.find((s) => s.key === next.scriptKey);
      if (!nextDesc) return;
      prefetchItem(nextDesc, next.vod.id);
    },
    [script, detail, vodId, pbIdx, epIdx, browseResults]
  );
}
