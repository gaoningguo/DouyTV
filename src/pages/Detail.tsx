import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useDetail } from "@/hooks/useDetail";
import { useLibraryStore } from "@/stores/library";
import { useVodAssetsStore } from "@/stores/vodAssets";
import { resumeVodDownload, startVodDownload } from "@/lib/vodDownload";
import SourceSwitcher from "@/components/SourceSwitcher";
import {
  IconArrowLeft,
  IconHeart,
  IconHeartFill,
  IconPlay,
  IconFilm,
  IconClock,
  IconCheck,
  IconAntenna,
  IconBookmark,
  IconBookmarkFill,
  IconDownload,
} from "@/components/Icon";

export default function Detail() {
  const params = useParams();
  const navigate = useNavigate();
  const scriptKey = decodeURIComponent(params.scriptKey ?? "");
  const vodId = decodeURIComponent(params.vodId ?? "");

  const { detail, loading, error, script } = useDetail(scriptKey, vodId);
  const hydrate = useLibraryStore((s) => s.hydrate);
  const isFavorite = useLibraryStore((s) => s.isFavorite);
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);
  const history = useLibraryStore((s) => s.history);
  const hydrateVodAssets = useVodAssetsStore((s) => s.hydrate);
  const isWatchLater = useVodAssetsStore((s) => s.isWatchLater);
  const toggleWatchLater = useVodAssetsStore((s) => s.toggleWatchLater);
  const downloads = useVodAssetsStore((s) => s.downloads);
  const addDownloadTask = useVodAssetsStore((s) => s.addDownloadTask);

  const [pbIdx, setPbIdx] = useState(0);
  const [showSourceSwitcher, setShowSourceSwitcher] = useState(false);
  const [buttonPulse, setButtonPulse] = useState<string | undefined>(undefined);

  useEffect(() => {
    hydrate();
    hydrateVodAssets();
  }, [hydrate, hydrateVodAssets]);

  useEffect(() => {
    setPbIdx(0);
  }, [scriptKey, vodId]);

  const itemId = `${scriptKey}:${vodId}`;
  const isFav = isFavorite(itemId);
  const isLater = isWatchLater(itemId);
  const hist = history.find((h) => h.itemId === itemId);
  // 已看完的集索引集合 — 给选集网格加 ✓ 标记
  const watchedEpisodes = useMemo<Set<number>>(
    () => new Set(hist?.episodesWatched ?? []),
    [hist?.episodesWatched]
  );

  if (loading && !detail) {
    return (
      <div className="min-h-screen bg-ink text-cream flex items-center justify-center">
        <div className="signal-bars" style={{ height: 24 }}>
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="min-h-screen bg-ink text-cream p-4 flex flex-col items-center justify-center">
        <p className="font-mono text-[10px] tracking-[0.25em] text-ember mb-2">
          LOAD ERROR
        </p>
        <p className="text-sm text-cream-dim mb-5 text-center">
          {error || "加载失败"}
        </p>
        <Link
          to="/search"
          className="px-5 py-2.5 rounded-full text-xs font-display font-semibold tap"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
            color: "var(--cream)",
          }}
        >
          返回搜索
        </Link>
      </div>
    );
  }

  const safePbIdx = Math.min(pbIdx, detail.playbacks.length - 1);
  const playback = detail.playbacks[safePbIdx];
  const firstEpisodeTitle = playback?.episodes_titles?.[0] || "第1集";
  const downloadTask = downloads.find(
    (task) =>
      task.itemId === itemId &&
      task.playbackIndex === safePbIdx &&
      task.episodeIndex === 0
  );
  const hasDownloadTask = Boolean(downloadTask);
  const isDownloadBusy = downloadTask?.status === "downloading";
  const isDownloadDone = downloadTask?.status === "done";
  const downloadLabel = isDownloadBusy
    ? `下载中 ${Math.round(downloadTask?.progress ?? 0)}%`
    : isDownloadDone
    ? "已下载"
    : downloadTask?.status === "error"
    ? "重试下载"
    : downloadTask?.status === "paused"
    ? "继续下载"
    : hasDownloadTask
    ? "继续下载"
    : "加入下载";
  const pulseButton = (key: string) => {
    setButtonPulse(key);
    window.setTimeout(() => {
      setButtonPulse((current) => (current === key ? undefined : current));
    }, 420);
  };
  const startFirstEpisodeDownload = async () => {
    if (!playback || !script || playback.episodes.length === 0) return;
    pulseButton("download");
    const taskId = addDownloadTask({
      itemId,
      scriptKey,
      vodId,
      title: detail.title,
      poster: detail.poster,
      sourceName: playback.sourceName || script?.name,
      playbackIndex: safePbIdx,
      episodeIndex: 0,
      episodeTitle: firstEpisodeTitle,
    });
    const task = useVodAssetsStore
      .getState()
      .downloads.find((row) => row.id === taskId);
    const freshTask =
      task ??
      useVodAssetsStore
        .getState()
        .downloads.find(
          (row) =>
            row.itemId === itemId &&
            row.playbackIndex === safePbIdx &&
            row.episodeIndex === 0
        );
    if (!freshTask) return;
    await resumeVodDownload(freshTask.id);
    await startVodDownload({
      task: freshTask,
      script,
      episode: playback.episodes[0],
      sourceId: playback.sourceId,
    });
  };

  return (
    /* /detail 在 hideNav 里 → App.tsx 跳过 safe-area，此页面自己处理 */
    <div
      className="min-h-screen bg-ink text-cream"
      style={{
        paddingTop: "calc(env(safe-area-inset-top) + 16px)",
        paddingLeft: "calc(env(safe-area-inset-left) + 16px)",
        paddingRight: "calc(env(safe-area-inset-right) + 16px)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 24px)",
      }}
    >
      <div className="flex items-center gap-3 mb-5">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
        >
          <IconArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[9px] tracking-[0.25em] text-cream-faint">
            DETAILS
          </p>
          <h1 className="font-display text-base font-bold line-clamp-1 tracking-tight">
            {detail.title}
          </h1>
        </div>
      </div>

      <div className="flex gap-3 mb-6">
        <div
          className="w-24 h-32 rounded-lg overflow-hidden shrink-0 scanlines"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
        >
          {detail.poster ? (
            <img
              src={detail.poster}
              className="w-full h-full object-cover"
              alt={detail.title}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-cream-faint">
              <IconFilm size={36} />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          <p className="text-base font-display font-bold line-clamp-2 leading-tight">
            {detail.title}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {detail.year && (
              <span className="chip-ch">{detail.year}</span>
            )}
            {detail.type_name && (
              <span className="chip-ch">{detail.type_name}</span>
            )}
          </div>
          <p className="font-mono text-[10px] text-cream-faint mt-2">
            @ {script?.name || scriptKey}
          </p>
          <div className="mt-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                pulseButton("favorite");
                toggleFavorite({
                  id: itemId,
                  kind: "video",
                  title: detail.title,
                  url: "",
                  poster: detail.poster,
                  sourceName: script?.name,
                });
              }}
              className={`detail-action-button px-3 py-1.5 rounded-full text-xs font-display font-semibold tap flex items-center gap-1.5 ${
                buttonPulse === "favorite" ? "detail-action-pop" : ""
              }`}
              style={
                isFav
                  ? {
                      background: "var(--ember)",
                      color: "var(--ink)",
                      boxShadow: "0 8px 20px -8px rgba(255,107,53,0.45)",
                    }
                  : {
                      background: "var(--ink-2)",
                      border: "1px solid var(--cream-line)",
                      color: "var(--cream)",
                    }
              }
            >
              {isFav ? <IconHeartFill size={13} /> : <IconHeart size={13} />}
              {isFav ? "已收藏" : "收藏"}
            </button>
            <button
              type="button"
              onClick={() => {
                pulseButton("watchLater");
                toggleWatchLater({
                  itemId,
                  scriptKey,
                  vodId,
                  title: detail.title,
                  poster: detail.poster,
                  sourceName: script?.name,
                });
              }}
              className={`detail-action-button px-3 py-1.5 rounded-full text-xs font-display font-semibold tap flex items-center gap-1.5 ${
                buttonPulse === "watchLater" ? "detail-action-pop" : ""
              }`}
              style={
                isLater
                  ? {
                      background: "rgba(124,255,178,0.14)",
                      border: "1px solid rgba(124,255,178,0.32)",
                      color: "var(--phosphor)",
                    }
                  : {
                      background: "var(--ink-2)",
                      border: "1px solid var(--cream-line)",
                      color: "var(--cream)",
                    }
              }
            >
              {isLater ? <IconBookmarkFill size={13} /> : <IconBookmark size={13} />}
              {isLater ? "已稍后" : "稍后观看"}
            </button>
            {hist && (
              <Link
                to={`/play/${encodeURIComponent(scriptKey)}/${encodeURIComponent(vodId)}/${safePbIdx}/${hist.episodeIndex}`}
                className="px-3 py-1.5 rounded-full text-xs font-display font-semibold tap flex items-center gap-1.5 text-cream"
                style={{
                  background: "var(--ink-2)",
                  border: "1px solid var(--cream-line)",
                }}
              >
                <IconClock size={13} />
                继续 · 第{hist.episodeIndex + 1}集
              </Link>
            )}
            {playback && (
              <button
                type="button"
                onClick={() => setShowSourceSwitcher(true)}
                className="px-3 py-1.5 rounded-full text-xs font-display font-semibold tap flex items-center gap-1.5 text-cream"
                style={{
                  background: "var(--ink-2)",
                  border: "1px solid var(--cream-line)",
                }}
                title="切换线路 / 测速 / 跨脚本换源"
              >
                <IconAntenna size={13} />
                换源 / 测速
              </button>
            )}
            {playback && (
              <button
                type="button"
                disabled={isDownloadBusy || isDownloadDone}
                onClick={() => void startFirstEpisodeDownload()}
                className={`detail-action-button px-3 py-1.5 rounded-full text-xs font-display font-semibold tap flex items-center gap-1.5 disabled:opacity-70 ${
                  buttonPulse === "download" ? "detail-action-pop" : ""
                }`}
                style={
                  isDownloadBusy || isDownloadDone
                    ? {
                        background: "rgba(124,255,178,0.14)",
                        border: "1px solid rgba(124,255,178,0.32)",
                        color: "var(--phosphor)",
                      }
                    : {
                        background: "var(--ink-2)",
                        border: "1px solid var(--cream-line)",
                        color: "var(--cream)",
                  }
                }
              >
                {isDownloadDone ? <IconCheck size={13} /> : <IconDownload size={13} />}
                {downloadLabel}
              </button>
            )}
            {playback && (
              <Link
                to={`/play/${encodeURIComponent(scriptKey)}/${encodeURIComponent(vodId)}/${safePbIdx}/0`}
                className="px-3 py-1.5 rounded-full text-xs font-display font-semibold tap flex items-center gap-1.5 glow-ember"
                style={{ background: "var(--ember)", color: "var(--ink)" }}
              >
                <IconPlay size={13} />
                开始播放
              </Link>
            )}
          </div>
        </div>
      </div>

      {detail.desc && (
        <div className="mb-6">
          <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
            SYNOPSIS
          </p>
          <p className="text-xs text-cream-dim leading-relaxed whitespace-pre-line">
            {detail.desc}
          </p>
        </div>
      )}

      {detail.playbacks.length > 1 && (
        <div className="mb-4">
          <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
            LINE · SOURCE
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 no-scrollbar">
            {detail.playbacks.map((pb, i) => (
              <button
                key={`${pb.sourceId}:${i}`}
                type="button"
                onClick={() => setPbIdx(i)}
                className="shrink-0 px-3 py-1.5 rounded-full text-xs font-display font-semibold tap whitespace-nowrap"
                style={
                  i === safePbIdx
                    ? {
                        background: "var(--ember)",
                        color: "var(--ink)",
                      }
                    : {
                        background: "var(--ink-2)",
                        border: "1px solid var(--cream-line)",
                        color: "var(--cream)",
                      }
                }
              >
                {pb.sourceName} · {pb.episodes.length}
              </button>
            ))}
          </div>
        </div>
      )}

      {playback && (
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
              EPISODES
            </p>
            <p className="font-mono text-[10px] text-cream-dim">
              {String(playback.episodes.length).padStart(2, "0")} TOTAL · @{playback.sourceName}
            </p>
          </div>
          <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
            {playback.episodes.map((_ep, epIdx) => {
              const title =
                playback.episodes_titles?.[epIdx] || `第${epIdx + 1}集`;
              const isWatching =
                hist?.episodeIndex === epIdx && !hist.completed;
              const isWatched = watchedEpisodes.has(epIdx);
              return (
                <Link
                  key={epIdx}
                  to={`/play/${encodeURIComponent(scriptKey)}/${encodeURIComponent(vodId)}/${safePbIdx}/${epIdx}`}
                  className="relative px-2 py-3 rounded-lg text-xs text-center tap transition-all"
                  style={
                    isWatching
                      ? {
                          background: "var(--ember)",
                          color: "var(--ink)",
                          boxShadow: "0 0 0 1px rgba(255,107,53,0.4)",
                        }
                      : isWatched
                      ? {
                          background: "var(--ink-2)",
                          border: "1px solid rgba(124,255,178,0.35)",
                          color: "var(--cream-dim)",
                        }
                      : {
                          background: "var(--ink-2)",
                          border: "1px solid var(--cream-line)",
                          color: "var(--cream)",
                        }
                  }
                >
                  {isWatched && !isWatching && (
                    <span
                      className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center"
                      style={{
                        background: "var(--phosphor)",
                        color: "var(--ink)",
                      }}
                    >
                      <IconCheck size={10} />
                    </span>
                  )}
                  <span className="block font-mono text-[10px] opacity-60 leading-none mb-1">
                    CH {String(epIdx + 1).padStart(2, "0")}
                  </span>
                  <span className="block line-clamp-1 text-[11px]">{title}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* 换源 / 跨脚本测速 */}
      <SourceSwitcher
        open={showSourceSwitcher}
        playbacks={detail.playbacks}
        currentIndex={safePbIdx}
        episodeIndex={hist?.episodeIndex ?? 0}
        script={script}
        videoTitle={detail.title}
        onPick={(newPbIdx) => {
          setShowSourceSwitcher(false);
          setPbIdx(newPbIdx);
        }}
        onPickCrossScript={(newScriptKey, newVodId) => {
          setShowSourceSwitcher(false);
          // 跨脚本：跳转到该脚本对应视频的 Detail
          navigate(
            `/detail/${encodeURIComponent(newScriptKey)}/${encodeURIComponent(newVodId)}`
          );
        }}
        onClose={() => setShowSourceSwitcher(false)}
      />
    </div>
  );
}
