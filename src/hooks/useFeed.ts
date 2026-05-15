import { useCallback, useEffect, useRef, useState } from "react";
import { useScriptStore } from "@/stores/scripts";
import { useLibraryStore } from "@/stores/library";
import {
  callDetail,
  callRecommend,
  callResolvePlayUrl,
} from "@/source-script/runtime";
import type {
  ScriptDescriptor,
  ScriptEpisode,
} from "@/source-script/types";
import type { MediaItem } from "@/types/media";
import { rankAndShuffle } from "@/lib/recommend";

async function vodToMediaItem(
  script: ScriptDescriptor,
  vod: { id: string; title: string; poster?: string; year?: string; desc?: string; vod_remarks?: string; type_name?: string; vod_class?: string },
  sourceId?: string
): Promise<MediaItem | undefined> {
  try {
    const detail = await callDetail(script, { id: vod.id, sourceId });
    const playback = detail.playbacks?.[0];
    const ep: ScriptEpisode | undefined = playback?.episodes?.[0];
    if (!playback || !ep) return undefined;
    const playUrl = typeof ep === "string" ? ep : ep.playUrl;
    const needResolve =
      typeof ep === "string" ? true : ep.needResolve !== false;

    let resolved = { url: playUrl, type: "auto" as const, headers: {} };
    if (needResolve) {
      const r = await callResolvePlayUrl(script, {
        playUrl,
        sourceId: playback.sourceId,
        episodeIndex: 0,
      });
      resolved = { url: r.url, type: (r.type ?? "auto") as "auto", headers: r.headers ?? {} };
    }

    return {
      id: `${script.key}:${vod.id}`,
      kind: "video",
      title: vod.title,
      poster: vod.poster,
      url: resolved.url,
      streamType: resolved.type,
      headers: resolved.headers,
      year: vod.year,
      description: vod.desc,
      remarks: vod.vod_remarks,
      typeName: vod.type_name || vod.vod_class,
      sourceId: playback.sourceId,
      sourceName: playback.sourceName,
      episodes: playback.episodes,
      episodesTitles: playback.episodes_titles,
      currentEpisodeIndex: 0,
      scriptKey: script.key,
      vodId: vod.id,
    };
  } catch (e) {
    console.warn(`[useFeed] resolve failed for ${vod.id}`, e);
    return undefined;
  }
}

export function useFeed() {
  const scripts = useScriptStore((s) => s.scripts);
  const hydrated = useScriptStore((s) => s.hydrated);
  const hydrate = useScriptStore((s) => s.hydrate);

  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const inFlight = useRef(false);
  const seedRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!hydrated) hydrate();
  }, [hydrated, hydrate]);

  const enabled = scripts.filter((s) => s.enabled);
  const enabledKey = enabled.map((s) => s.key).join("|");

  const loadPage = useCallback(
    async (p: number, replace: boolean) => {
      if (inFlight.current) return;
      if (enabled.length === 0) {
        setItems([]);
        setHasMore(false);
        return;
      }
      inFlight.current = true;
      setLoading(true);
      setError(undefined);
      // reload 时换 seed；loadMore 沿用同 seed
      if (replace) seedRef.current = Date.now();
      try {
        const recommendResults = await Promise.all(
          enabled.map(async (script) => {
            try {
              const r = await callRecommend(script, { page: p });
              return { script, vods: r.list };
            } catch (e) {
              console.warn(`[useFeed] recommend failed: ${script.key}`, e);
              return { script, vods: [] };
            }
          })
        );

        const all: Array<{
          script: ScriptDescriptor;
          vod: {
            id: string;
            title: string;
            poster?: string;
            year?: string;
            desc?: string;
            vod_remarks?: string;
            type_name?: string;
            vod_class?: string;
          };
        }> = [];
        for (const { script, vods } of recommendResults) {
          for (const vod of vods) all.push({ script, vod });
        }

        const libState = useLibraryStore.getState();
        // 流式 resolve：第一个完成的 item 立即 setItems → loading 结束 → 用户立刻看到视频
        // 后续 resolve 完成的 push 进去；全部完成后用 rankAndShuffle 重排
        if (replace) setItems([]);
        let firstShown = false;
        const collected: MediaItem[] = [];
        await Promise.all(
          all.map(async ({ script, vod }) => {
            const item = await vodToMediaItem(script, vod);
            if (!item) return;
            if (libState.isCompleted(item.id)) return;
            collected.push(item);
            if (!firstShown) {
              firstShown = true;
              setItems((prev) => (replace ? [item] : [...prev, item]));
              setLoading(false);
            } else {
              setItems((prev) =>
                prev.some((p) => p.id === item.id) ? prev : [...prev, item]
              );
            }
          })
        );

        // 全部 resolve 完后做最终排序
        const ranked = rankAndShuffle(collected, {
          history: libState.history,
          scripts: useScriptStore.getState().scripts,
          seed: seedRef.current ^ p,
          debug: import.meta.env.DEV,
        });
        if (ranked.length > 0) {
          setItems((prev) => {
            // 保留 prev 中第一个（用户可能正在看）的位置不变；其它按 rank 重排
            if (!replace) {
              // loadMore: 追加 — 旧 items + ranked 中没出现的
              const existing = new Set(prev.map((it) => it.id));
              const fresh = ranked.filter((it) => !existing.has(it.id));
              return [...prev, ...fresh];
            }
            if (prev.length === 0) return ranked;
            const first = prev[0];
            const rest = ranked.filter((it) => it.id !== first.id);
            return [first, ...rest];
          });
        }
        setPage(p);
        setHasMore(collected.length > 0);
      } catch (e) {
        setError((e as Error).message ?? String(e));
      } finally {
        setLoading(false);
        inFlight.current = false;
      }
    },
    [enabled, enabledKey]
  );

  useEffect(() => {
    if (hydrated) {
      loadPage(1, true);
    }
  }, [hydrated, enabledKey]);

  return {
    items,
    loading,
    error,
    hasMore,
    loadMore: () => {
      if (hasMore && !loading) loadPage(page + 1, false);
    },
    reload: () => loadPage(1, true),
    /**
     * 切换合集中的某一集 — InteractionBar 选集 sheet 调。
     * 重新 resolvePlayUrl 拿到该集的真实 url，更新 items[i] 触发 VideoPlayer 重载。
     */
    changeEpisode: async (itemId: string, episodeIndex: number) => {
      const item = items.find((it) => it.id === itemId);
      if (!item || !item.episodes || !item.scriptKey) return;
      const ep = item.episodes[episodeIndex];
      if (!ep) return;
      const script = useScriptStore
        .getState()
        .scripts.find((s) => s.key === item.scriptKey);
      if (!script) return;
      const playUrl = typeof ep === "string" ? ep : ep.playUrl;
      const needResolve =
        typeof ep === "string" ? true : ep.needResolve !== false;
      let resolved: { url: string; type: MediaItem["streamType"]; headers: Record<string, string> } = {
        url: playUrl,
        type: "auto",
        headers: {},
      };
      if (needResolve) {
        const r = await callResolvePlayUrl(script, {
          playUrl,
          sourceId: item.sourceId,
          episodeIndex,
        });
        resolved = {
          url: r.url,
          type: (r.type ?? "auto") as MediaItem["streamType"],
          headers: r.headers ?? {},
        };
      }
      setItems((prev) =>
        prev.map((it) =>
          it.id === itemId
            ? {
                ...it,
                url: resolved.url,
                streamType: resolved.type,
                headers: resolved.headers,
                currentEpisodeIndex: episodeIndex,
              }
            : it
        )
      );
    },
    /**
     * 视频无法播放时重新解析 — 走一次 callResolvePlayUrl 拿可能不同的 URL。
     * 一些源每次 resolve 返回不同 token / CDN 节点 → 解决临时失效问题。
     */
    reresolveItem: async (itemId: string) => {
      const item = items.find((it) => it.id === itemId);
      if (!item || !item.episodes || !item.scriptKey) return;
      const epIdx = item.currentEpisodeIndex ?? 0;
      const ep = item.episodes[epIdx];
      if (!ep) return;
      const script = useScriptStore
        .getState()
        .scripts.find((s) => s.key === item.scriptKey);
      if (!script) return;
      const playUrl = typeof ep === "string" ? ep : ep.playUrl;
      const needResolve =
        typeof ep === "string" ? true : ep.needResolve !== false;
      if (!needResolve) return; // 静态 URL 无法重解析
      const r = await callResolvePlayUrl(script, {
        playUrl,
        sourceId: item.sourceId,
        episodeIndex: epIdx,
      });
      setItems((prev) =>
        prev.map((it) =>
          it.id === itemId
            ? {
                ...it,
                url: r.url,
                streamType: (r.type ?? "auto") as MediaItem["streamType"],
                headers: r.headers ?? {},
              }
            : it
        )
      );
    },
  };
}
