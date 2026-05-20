import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useDetail } from "@/hooks/useDetail";
import { useLibraryStore } from "@/stores/library";
import { useDanmakuStore } from "@/stores/danmaku";
import { callResolvePlayUrl } from "@/source-script/runtime";
import VideoPlayer from "@/components/VideoPlayer";
import DanmakuPanel, {
  loadDanmakuMemory,
} from "@/components/DanmakuPanel";
import SourceSwitcher from "@/components/SourceSwitcher";
import { convertDanmakuFormat, getDanmakuById, getEpisodes, searchAnime } from "@/lib/danmaku/api";
import type { Danmu } from "artplayer-plugin-danmuku";
import type { DanmakuSelection } from "@/lib/danmaku/types";
import type { MediaItem } from "@/types/media";
import { IconArrowLeft, IconDanmaku, IconAntenna } from "@/components/Icon";

export default function Play() {
  const params = useParams();
  const navigate = useNavigate();
  const scriptKey = decodeURIComponent(params.scriptKey ?? "");
  const vodId = decodeURIComponent(params.vodId ?? "");
  const pbIdx = parseInt(params.playbackIdx ?? "0", 10);
  const epIdx = parseInt(params.epIdx ?? "0", 10);

  const { detail, script } = useDetail(scriptKey, vodId);
  const upsertHistory = useLibraryStore((s) => s.upsertHistory);
  const hydrate = useLibraryStore((s) => s.hydrate);
  const history = useLibraryStore((s) => s.history);
  const danmakuStore = useDanmakuStore();
  const hydrateDanmaku = useDanmakuStore((s) => s.hydrate);

  const [item, setItem] = useState<MediaItem | undefined>(undefined);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | undefined>(undefined);

  // 弹幕状态
  const [showDanmakuPanel, setShowDanmakuPanel] = useState(false);
  const [danmakuSelection, setDanmakuSelection] = useState<DanmakuSelection | null>(
    null
  );
  const [danmuComments, setDanmuComments] = useState<Danmu[]>([]);
  // 弹幕显示开关 — 跨视频跨重启持久化
  const [danmakuVisible, setDanmakuVisible] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem("douytv:player-danmaku-visible");
      return v == null ? true : v === "1" || v === "true";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(
        "douytv:player-danmaku-visible",
        danmakuVisible ? "1" : "0"
      );
    } catch {
      /* private */
    }
  }, [danmakuVisible]);

  // 换源 / 线路切换状态
  const [showSourceSwitcher, setShowSourceSwitcher] = useState(false);

  const playback = detail?.playbacks[pbIdx];
  const episode = playback?.episodes[epIdx];

  // 继续观看：当前视频 + 当前集 + 未完成 → 用 history.position 作为起播点
  const itemId = `${scriptKey}:${vodId}`;
  const continueFrom = history.find(
    (h) => h.itemId === itemId && h.episodeIndex === epIdx && !h.completed
  )?.position;

  useEffect(() => {
    hydrate();
    hydrateDanmaku();
  }, [hydrate, hydrateDanmaku]);

  // 自动加载上次选过的弹幕（按 title 记忆 + autoLoad 偏好）
  const videoTitle = useMemo(
    () => detail?.title || vodId,
    [detail?.title, vodId]
  );
  // 自动加载弹幕：
  //   1) 优先用上次的手动选择（loadDanmakuMemory by title）
  //   2) 没有记忆时 fallback 到 searchAnime(title) 取第一个结果 + 当前集
  //   3) 用户可随时点 "选择弹幕" 按钮在 DanmakuPanel 里换源
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

  const handleDanmakuSelect = async (selection: DanmakuSelection) => {
    setShowDanmakuPanel(false);
    setDanmakuSelection(selection);
    const comments = await getDanmakuById(
      selection.episodeId,
      videoTitle,
      epIdx,
      {
        animeId: selection.animeId,
        animeTitle: selection.animeTitle,
        episodeTitle: selection.episodeTitle,
      }
    );
    setDanmakuSelection({ ...selection, danmakuCount: comments.length });
    setDanmuComments(convertDanmakuFormat(comments));
    setDanmakuVisible(true);
  };

  const handlePickPlayback = (newPbIdx: number) => {
    setShowSourceSwitcher(false);
    if (newPbIdx === pbIdx) return;
    // 切换到新线路 —— 同集数 epIdx，组件根据 URL 重新解析
    navigate(
      `/play/${encodeURIComponent(scriptKey)}/${encodeURIComponent(vodId)}/${newPbIdx}/${epIdx}`,
      { replace: true }
    );
  };

  useEffect(() => {
    if (!script || !playback || episode === undefined) return;
    let aborted = false;
    const playUrl = typeof episode === "string" ? episode : episode.playUrl;
    const needResolve =
      typeof episode === "string" ? true : episode.needResolve !== false;

    setResolving(true);
    setResolveError(undefined);

    (async () => {
      try {
        let resolved: {
          url: string;
          type: "auto" | "mp4" | "hls" | "dash" | "flv";
          headers: Record<string, string>;
        } = { url: playUrl, type: "auto", headers: {} };
        if (needResolve) {
          const r = await callResolvePlayUrl(script, {
            playUrl,
            sourceId: playback.sourceId,
            episodeIndex: epIdx,
          });
          resolved = {
            url: r.url,
            type: (r.type ?? "auto") as typeof resolved.type,
            headers: r.headers ?? {},
          };
        }
        if (aborted) return;
        setItem({
          id: `${scriptKey}:${vodId}`,
          kind: "video",
          title: detail?.title || vodId,
          poster: detail?.poster,
          url: resolved.url,
          streamType: resolved.type,
          headers: resolved.headers,
          sourceId: playback.sourceId,
          sourceName: playback.sourceName,
        });
      } catch (e) {
        if (!aborted) setResolveError((e as Error)?.message ?? String(e));
      } finally {
        if (!aborted) setResolving(false);
      }
    })();

    return () => {
      aborted = true;
    };
  }, [script?.key, vodId, pbIdx, epIdx, detail?.title]);

  if (resolveError) {
    return (
      <div className="min-h-screen bg-ink text-cream p-4 flex flex-col items-center justify-center">
        <p className="font-mono text-[10px] tracking-[0.25em] text-ember mb-2">
          PLAYBACK ERROR
        </p>
        <p className="text-sm text-cream-dim mb-4 text-center max-w-xs">
          {resolveError}
        </p>
        <Link
          to={`/detail/${encodeURIComponent(scriptKey)}/${encodeURIComponent(vodId)}`}
          className="px-5 py-2.5 rounded-full text-xs font-display font-semibold tap"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
            color: "var(--cream)",
          }}
        >
          返回详情
        </Link>
      </div>
    );
  }

  if (resolving || !item) {
    return (
      <div className="min-h-screen bg-ink text-cream flex flex-col items-center justify-center">
        <div className="signal-bars" style={{ height: 24 }}>
          <span></span>
          <span></span>
          <span></span>
        </div>
        <p className="mt-5 font-mono text-[10px] tracking-[0.25em] text-cream-faint">
          RESOLVING SIGNAL…
        </p>
      </div>
    );
  }

  const epTitle =
    playback?.episodes_titles?.[epIdx] || `第${epIdx + 1}集`;
  const totalEps = playback?.episodes.length ?? 0;

  return (
    <div
      className="h-screen w-screen bg-black relative overflow-hidden"
      // iOS WKWebView 默认会把水平 swipe 当作"返回手势"、垂直 swipe 当作页面滚动，
      // 导致 ArtPlayer 内部的左右 seek / 上下音量・亮度 拿不到 touchmove。
      // 这里把整页 touch-action 关掉，全部交给 ArtPlayer 自己处理。
      style={{ touchAction: "none" }}
    >
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="absolute z-20 w-9 h-9 flex items-center justify-center rounded-full backdrop-blur-md tap"
        style={{
          top: "calc(env(safe-area-inset-top) + 16px)",
          left: "calc(env(safe-area-inset-left) + 16px)",
          background: "rgba(14,15,17,0.6)",
          border: "1px solid var(--cream-line)",
          color: "var(--cream)",
        }}
        aria-label="返回"
      >
        <IconArrowLeft size={16} />
      </button>

      {/* 弹幕开关 + 选源按钮 + 切线路 */}
      <div
        className="absolute z-20 flex items-center gap-2"
        style={{
          top: "calc(env(safe-area-inset-top) + 16px)",
          right: "calc(env(safe-area-inset-right) + 16px)",
        }}
      >
        <button
          type="button"
          onClick={() => setDanmakuVisible((v) => !v)}
          className="w-9 h-9 flex items-center justify-center rounded-full backdrop-blur-md tap"
          style={{
            background: "rgba(14,15,17,0.6)",
            border: `1px solid ${
              danmakuVisible && danmuComments.length > 0
                ? "var(--ember)"
                : "var(--cream-line)"
            }`,
            color:
              danmakuVisible && danmuComments.length > 0
                ? "var(--ember)"
                : "var(--cream-dim)",
          }}
          aria-label="弹幕开关"
          title={
            danmuComments.length > 0
              ? danmakuVisible
                ? "关闭弹幕"
                : "开启弹幕"
              : "未加载弹幕"
          }
        >
          <IconDanmaku size={16} />
        </button>
        <button
          type="button"
          onClick={() => setShowDanmakuPanel(true)}
          className="px-3 h-9 flex items-center gap-1.5 rounded-full backdrop-blur-md tap font-display text-xs"
          style={{
            background: "rgba(14,15,17,0.6)",
            border: "1px solid var(--cream-line)",
            color: "var(--cream)",
          }}
        >
          {danmakuSelection ? (
            <>
              <span
                className="rec-dot"
                style={{ width: 5, height: 5, background: "var(--phosphor)" }}
              />
              <span className="line-clamp-1 max-w-[100px]">
                {danmakuSelection.episodeTitle || "已选弹幕"}
              </span>
            </>
          ) : (
            "选择弹幕"
          )}
        </button>
        {(detail?.playbacks?.length ?? 0) > 1 && (
          <button
            type="button"
            onClick={() => setShowSourceSwitcher(true)}
            className="px-3 h-9 flex items-center gap-1.5 rounded-full backdrop-blur-md tap font-display text-xs"
            style={{
              background: "rgba(14,15,17,0.6)",
              border: "1px solid var(--cream-line)",
              color: "var(--cream)",
            }}
            title="切换线路 / 测速"
          >
            <IconAntenna size={14} />
            <span className="line-clamp-1 max-w-[80px]">
              {playback?.sourceName || `线路 ${pbIdx + 1}`}
            </span>
          </button>
        )}
      </div>

      <VideoPlayer
        item={item}
        active
        loop={false}
        muted={false}
        controls
        startPosition={continueFrom}
        danmuComments={danmuComments}
        danmakuVisible={danmakuVisible && danmakuStore.enabled}
        onPrevEpisode={
          epIdx > 0
            ? () =>
                navigate(
                  `/play/${encodeURIComponent(scriptKey)}/${encodeURIComponent(vodId)}/${pbIdx}/${epIdx - 1}`,
                  { replace: true }
                )
            : undefined
        }
        onNextEpisode={
          epIdx + 1 < totalEps
            ? () =>
                navigate(
                  `/play/${encodeURIComponent(scriptKey)}/${encodeURIComponent(vodId)}/${pbIdx}/${epIdx + 1}`,
                  { replace: true }
                )
            : undefined
        }
        onRequestSwitchSource={
          (detail?.playbacks?.length ?? 0) > 1
            ? () => setShowSourceSwitcher(true)
            : undefined
        }
        onProgress={(pos, dur) =>
          upsertHistory(item, {
            position: pos,
            duration: dur,
            episodeIndex: epIdx,
          })
        }
        onEnded={() => {
          if (epIdx + 1 < totalEps) {
            navigate(
              `/play/${encodeURIComponent(scriptKey)}/${encodeURIComponent(vodId)}/${pbIdx}/${epIdx + 1}`
            );
          }
        }}
      />

      <div
        className="absolute left-4 right-4 text-cream pointer-events-none"
        style={{
          bottom: "calc(env(safe-area-inset-bottom) + 24px)",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="chip-ch">
            CH {String(epIdx + 1).padStart(2, "0")}
            {totalEps > 1 && ` / ${String(totalEps).padStart(2, "0")}`}
          </span>
        </div>
        <p className="text-base font-display font-bold text-shadow line-clamp-1">
          {detail?.title}
        </p>
        <p className="text-[11px] text-cream-dim text-shadow mt-1">{epTitle}</p>
      </div>

      <DanmakuPanel
        open={showDanmakuPanel}
        videoTitle={videoTitle}
        currentEpisodeIndex={epIdx}
        currentSelection={danmakuSelection}
        onSelect={(s) => void handleDanmakuSelect(s)}
        onClose={() => setShowDanmakuPanel(false)}
      />

      <SourceSwitcher
        open={showSourceSwitcher}
        playbacks={detail?.playbacks ?? []}
        currentIndex={pbIdx}
        episodeIndex={epIdx}
        script={script}
        videoTitle={videoTitle}
        onPick={handlePickPlayback}
        onPickCrossScript={(newScriptKey, newVodId, newPbIdx) => {
          setShowSourceSwitcher(false);
          // 跨脚本切换：开新视频页（同集号尽量保留）
          navigate(
            `/play/${encodeURIComponent(newScriptKey)}/${encodeURIComponent(newVodId)}/${newPbIdx}/${epIdx}`
          );
        }}
        onClose={() => setShowSourceSwitcher(false)}
      />
    </div>
  );
}
