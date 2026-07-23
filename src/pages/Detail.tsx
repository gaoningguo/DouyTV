import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useDetail } from "@/hooks/useDetail";
import { usePlayback } from "@/hooks/usePlayback";
import { usePlaybackPrefetch } from "@/hooks/usePlaybackPrefetch";
import { useDanmakuAutoLoad } from "@/hooks/useDanmakuAutoLoad";
import { useViewport } from "@/hooks/useViewport";
import { useLibraryStore } from "@/stores/library";
import { useVodAssetsStore } from "@/stores/vodAssets";
import { useVodBrowseStore } from "@/stores/vodBrowse";
import { resumeVodDownload, startVodDownload } from "@/lib/vodDownload";
import { wrapImage } from "@/lib/proxy";
import VideoPlayer from "@/components/VideoPlayer";
import { readAutoNext } from "@/components/VideoPlayer/ArtPlayerHost";
import DanmakuPanel from "@/components/DanmakuPanel";
import SourceSwitcher from "@/components/SourceSwitcher";
import {
  IconArrowLeft,
  IconHeart,
  IconHeartFill,
  IconFilm,
  IconCheck,
  IconAntenna,
  IconBookmark,
  IconBookmarkFill,
  IconDownload,
  IconDanmaku,
  IconShare,
} from "@/components/Icon";

export default function Detail() {
  const params = useParams();
  const navigate = useNavigate();
  const { isDesktop } = useViewport();
  const scriptKey = decodeURIComponent(params.scriptKey ?? "");
  const vodId = decodeURIComponent(params.vodId ?? "");

  const { detail, loading, error, script } = useDetail(scriptKey, vodId);
  const hydrate = useLibraryStore((s) => s.hydrate);
  const isFavorite = useLibraryStore((s) => s.isFavorite);
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);
  const upsertHistory = useLibraryStore((s) => s.upsertHistory);
  const history = useLibraryStore((s) => s.history);
  const hydrateVodAssets = useVodAssetsStore((s) => s.hydrate);
  const isWatchLater = useVodAssetsStore((s) => s.isWatchLater);
  const toggleWatchLater = useVodAssetsStore((s) => s.toggleWatchLater);
  const downloads = useVodAssetsStore((s) => s.downloads);
  const addDownloadTask = useVodAssetsStore((s) => s.addDownloadTask);

  // 同级视频列表（源站寻片那份）—— 左列 / 移动端底部
  const browseResults = useVodBrowseStore((s) => s.results);
  const browseHasMore = useVodBrowseStore((s) => s.hasMore);
  const browseLoading = useVodBrowseStore((s) => s.loading);
  const loadMoreBrowse = useVodBrowseStore((s) => s.loadMore);

  const [pbIdx, setPbIdx] = useState(0);
  const [epIdx, setEpIdx] = useState(0);
  const [showSourceSwitcher, setShowSourceSwitcher] = useState(false);
  const [showDanmakuPanel, setShowDanmakuPanel] = useState(false);
  const [buttonPulse, setButtonPulse] = useState<string | undefined>(undefined);
  // 当前视频在同级列表里对应的 DOM，进页后自动滚到可见位置。
  const currentRowRef = useRef<HTMLButtonElement | null>(null);

  const itemId = `${scriptKey}:${vodId}`;
  const hist = history.find((h) => h.itemId === itemId);

  useEffect(() => {
    hydrate();
    hydrateVodAssets();
  }, [hydrate, hydrateVodAssets]);

  // 列表为空（用户没从源站寻片进来）→ 用当前源第一分类拉一页填充，保证左列不空。
  useEffect(() => {
    if (!script) return;
    if (useVodBrowseStore.getState().results.length === 0) {
      useVodBrowseStore.getState().pickScript(script.key);
    }
  }, [script?.key]);

  // 切视频（换 params）时重置线路，并按历史续播集初始化 epIdx。
  useEffect(() => {
    setPbIdx(0);
    const h = useLibraryStore.getState().history.find((x) => x.itemId === itemId);
    setEpIdx(h && !h.completed ? h.episodeIndex : 0);
  }, [scriptKey, vodId]);

  // 进页 / 切视频后，把当前视频那一项滚到列表可见位置（居中）。
  useEffect(() => {
    if (browseResults.length === 0) return;
    const t = window.setTimeout(() => {
      currentRowRef.current?.scrollIntoView({ block: "center", behavior: "auto" });
    }, 60);
    return () => window.clearTimeout(t);
  }, [itemId, browseResults.length]);

  const safePbIdx = detail ? Math.min(pbIdx, detail.playbacks.length - 1) : 0;
  const playback = detail?.playbacks[safePbIdx];
  const totalEps = playback?.episodes.length ?? 0;
  const safeEpIdx = Math.min(epIdx, Math.max(0, totalEps - 1));

  // 解析播放地址（共享 hook）
  const { item, resolving, resolveError } = usePlayback({
    script,
    detail,
    scriptKey,
    vodId,
    pbIdx: safePbIdx,
    epIdx: safeEpIdx,
  });

  // 预取下一集/下一条（接近结尾时后台预解析，切换丝滑）
  const maybePrefetch = usePlaybackPrefetch({
    script,
    detail,
    vodId,
    pbIdx: safePbIdx,
    epIdx: safeEpIdx,
    browseResults,
  });

  // 弹幕自动加载（共享 hook）
  const {
    danmuComments,
    danmakuSelection,
    danmakuVisible,
    setDanmakuVisible,
    danmakuEnabled,
    videoTitle,
    handleSelect: handleDanmakuAutoSelect,
  } = useDanmakuAutoLoad(detail?.title, vodId, safeEpIdx);

  const isFav = isFavorite(itemId);
  const isLater = isWatchLater(itemId);
  const watchedEpisodes = useMemo<Set<number>>(
    () => new Set(hist?.episodesWatched ?? []),
    [hist?.episodesWatched]
  );
  const continueFrom =
    hist && hist.episodeIndex === safeEpIdx && !hist.completed
      ? hist.position
      : undefined;

  const downloadTask = downloads.find(
    (task) =>
      task.itemId === itemId &&
      task.playbackIndex === safePbIdx &&
      task.episodeIndex === safeEpIdx
  );
  const isDownloadBusy = downloadTask?.status === "downloading" || downloadTask?.status === "queued";
  const isDownloadDone = downloadTask?.status === "done";
  const downloadLabel = isDownloadBusy
    ? `下载中 ${Math.round(downloadTask?.progress ?? 0)}%`
    : isDownloadDone
    ? "已下载"
    : downloadTask?.status === "error"
    ? "重试下载"
    : downloadTask?.status === "paused"
    ? "继续下载"
    : downloadTask
    ? "继续下载"
    : "下载本集";

  const pulseButton = (key: string) => {
    setButtonPulse(key);
    window.setTimeout(() => {
      setButtonPulse((current) => (current === key ? undefined : current));
    }, 420);
  };

  const handleFavorite = () => {
    if (!detail) return;
    pulseButton("favorite");
    toggleFavorite({
      id: itemId,
      kind: "video",
      title: detail.title,
      url: "",
      poster: detail.poster,
      sourceName: script?.name,
    });
  };

  const handleWatchLater = () => {
    if (!detail) return;
    pulseButton("watchLater");
    toggleWatchLater({
      itemId,
      scriptKey,
      vodId,
      title: detail.title,
      poster: detail.poster,
      sourceName: script?.name,
    });
  };

  const handleDownload = async () => {
    if (!script || !detail || !playback || playback.episodes.length === 0) return;
    pulseButton("download");
    const episode = playback.episodes[safeEpIdx];
    if (episode === undefined) return;
    const taskId = addDownloadTask({
      itemId,
      scriptKey,
      vodId,
      title: detail.title,
      poster: detail.poster,
      sourceName: playback.sourceName || script.name,
      playbackIndex: safePbIdx,
      episodeIndex: safeEpIdx,
      episodeTitle: playback.episodes_titles?.[safeEpIdx] || `第${safeEpIdx + 1}集`,
    });
    const task = useVodAssetsStore.getState().downloads.find((row) => row.id === taskId);
    if (!task) return;
    await resumeVodDownload(task.id);
    await startVodDownload({
      task,
      script,
      episode,
      sourceId: playback.sourceId,
    });
  };

  const handleShare = async () => {
    if (!detail) return;
    const epTitle = playback?.episodes_titles?.[safeEpIdx] || `第${safeEpIdx + 1}集`;
    const text = `${detail.title} ${epTitle}`;
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: detail.title, text, url });
      } catch {
        /* user cancelled */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* ignore */
    }
  };

  const goPrevEpisode = () => {
    if (safeEpIdx > 0) setEpIdx(safeEpIdx - 1);
  };
  const goNextEpisode = () => {
    if (safeEpIdx + 1 < totalEps) setEpIdx(safeEpIdx + 1);
  };
  // 跳到同级列表里的下一个视频（末集 / 单集播完时用）。
  const goNextItem = () => {
    const idx = browseResults.findIndex(
      (row) => `${row.scriptKey}:${row.vod.id}` === itemId
    );
    const next = idx >= 0 ? browseResults[idx + 1] : browseResults[0];
    if (!next) return;
    navigate(
      `/detail/${encodeURIComponent(next.scriptKey)}/${encodeURIComponent(next.vod.id)}`,
      { replace: true }
    );
  };
  // 自动连播：有下一集先切集，否则（末集/单集）跳列表下一个视频。
  const handleAutoNext = () => {
    if (safeEpIdx + 1 < totalEps) goNextEpisode();
    else goNextItem();
  };

  // ── 加载 / 错误态 ─────────────────────────────────────────
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
          返回点播
        </Link>
      </div>
    );
  }

  // ── 播放区 ────────────────────────────────────────────────
  const playerArea = (
    <div
      className="w-full bg-black shrink-0 relative"
      style={{ aspectRatio: "16 / 9", maxHeight: isDesktop ? "62vh" : undefined }}
    >
      {resolveError ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
          <p className="font-mono text-[10px] tracking-[0.25em] text-ember mb-2">
            PLAYBACK ERROR
          </p>
          <p className="text-sm text-cream-dim mb-4 max-w-xs">{resolveError}</p>
          {detail.playbacks.length > 1 && (
            <button
              type="button"
              onClick={() => setShowSourceSwitcher(true)}
              className="px-4 py-2 rounded-full text-xs font-display font-semibold tap glow-ember"
              style={{ background: "var(--ember)", color: "var(--ink)" }}
            >
              换个线路
            </button>
          )}
        </div>
      ) : resolving || !item ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="signal-bars" style={{ height: 24 }}>
            <span></span>
            <span></span>
            <span></span>
          </div>
          <p className="mt-5 font-mono text-[10px] tracking-[0.25em] text-cream-faint">
            RESOLVING SIGNAL…
          </p>
        </div>
      ) : (
        <VideoPlayer
          key={item.id}
          item={item}
          active
          loop={false}
          muted={false}
          controls
          startPosition={continueFrom}
          danmuComments={danmuComments}
          danmakuVisible={danmakuVisible && danmakuEnabled}
          onPrevEpisode={safeEpIdx > 0 ? goPrevEpisode : undefined}
          onNextEpisode={safeEpIdx + 1 < totalEps ? goNextEpisode : undefined}
          onRequestSwitchSource={
            detail.playbacks.length > 1 ? () => setShowSourceSwitcher(true) : undefined
          }
          onProgress={(pos, dur) => {
            if (!item) return;
            upsertHistory(item, {
              position: pos,
              duration: dur,
              episodeIndex: safeEpIdx,
            });
            maybePrefetch(pos, dur);
          }}
          onEnded={() => {
            // 自动连播：有下一集切集，否则（末集/单集）跳列表下一个视频。
            if (readAutoNext()) handleAutoNext();
          }}
        />
      )}
    </div>
  );

  // ── 简介 + 操作 + 选集 ───────────────────────────────────────
  const infoArea = (
    <div className="p-4 space-y-6">
      <div>
        <div className="flex items-start gap-3">
          <h1 className="flex-1 font-display text-lg font-extrabold text-cream leading-tight">
            {detail.title}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {detail.year && <span className="chip-ch">{detail.year}</span>}
          {detail.type_name && <span className="chip-ch">{detail.type_name}</span>}
          <span className="font-mono text-[10px] text-cream-faint ml-1">
            @ {script?.name || scriptKey}
          </span>
        </div>

        {/* 操作按钮 */}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleFavorite}
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
            onClick={handleWatchLater}
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
          {detail.playbacks.length > 0 && (
            <button
              type="button"
              onClick={() => setShowSourceSwitcher(true)}
              className="px-3 py-1.5 rounded-full text-xs font-display font-semibold tap flex items-center gap-1.5 text-cream"
              style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
              title="切换线路 / 测速 / 跨脚本换源"
            >
              <IconAntenna size={13} />
              换源 / 测速
            </button>
          )}
          <button
            type="button"
            onClick={() => setDanmakuVisible((v) => !v)}
            className="px-3 py-1.5 rounded-full text-xs font-display font-semibold tap flex items-center gap-1.5"
            style={{
              background: "var(--ink-2)",
              border: `1px solid ${
                danmakuVisible && danmuComments.length > 0
                  ? "var(--ember)"
                  : "var(--cream-line)"
              }`,
              color:
                danmakuVisible && danmuComments.length > 0
                  ? "var(--ember)"
                  : "var(--cream)",
            }}
            title={danmuComments.length > 0 ? "弹幕开关" : "未加载弹幕"}
          >
            <IconDanmaku size={13} />
            弹幕
          </button>
          <button
            type="button"
            onClick={() => setShowDanmakuPanel(true)}
            className="px-3 py-1.5 rounded-full text-xs font-display font-semibold tap flex items-center gap-1.5 text-cream"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          >
            {danmakuSelection?.episodeTitle ? (
              <span className="line-clamp-1 max-w-[120px]">
                {danmakuSelection.episodeTitle}
              </span>
            ) : (
              "选择弹幕"
            )}
          </button>
          {playback && (
            <button
              type="button"
              disabled={isDownloadBusy || isDownloadDone}
              onClick={() => void handleDownload()}
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
          <button
            type="button"
            onClick={() => void handleShare()}
            className="px-3 py-1.5 rounded-full text-xs font-display font-semibold tap flex items-center gap-1.5 text-cream"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          >
            <IconShare size={13} />
            分享
          </button>
        </div>
      </div>

      {detail.desc && (
        <div>
          <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
            SYNOPSIS
          </p>
          <p className="text-xs text-cream-dim leading-relaxed whitespace-pre-line">
            {detail.desc}
          </p>
        </div>
      )}

      {detail.playbacks.length > 1 && (
        <div>
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
                    ? { background: "var(--ember)", color: "var(--ink)" }
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
              {String(playback.episodes.length).padStart(2, "0")} TOTAL · @
              {playback.sourceName}
            </p>
          </div>
          <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
            {playback.episodes.map((_ep, i) => {
              const title = playback.episodes_titles?.[i] || `第${i + 1}集`;
              const isPlaying = i === safeEpIdx;
              const isWatched = watchedEpisodes.has(i);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setEpIdx(i)}
                  className="relative px-2 py-3 rounded-lg text-xs text-center tap transition-all"
                  style={
                    isPlaying
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
                  {isWatched && !isPlaying && (
                    <span
                      className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center"
                      style={{ background: "var(--phosphor)", color: "var(--ink)" }}
                    >
                      <IconCheck size={10} />
                    </span>
                  )}
                  <span className="block font-mono text-[10px] opacity-60 leading-none mb-1">
                    CH {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="block line-clamp-1 text-[11px]">{title}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  // ── 同级视频列表 ──────────────────────────────────────────
  const listArea = (
    <div className="p-3 space-y-2">
      <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint px-1 pt-1">
        PLAYLIST
      </p>
      {browseResults.length === 0 ? (
        <p className="text-xs text-cream-faint px-1 py-4">
          {browseLoading ? "加载中…" : "暂无同级列表"}
        </p>
      ) : (
        <>
          {browseResults.map((row) => {
            const rowId = `${row.scriptKey}:${row.vod.id}`;
            const isCurrent = rowId === itemId;
            return (
              <button
                key={rowId}
                ref={isCurrent ? currentRowRef : undefined}
                type="button"
                onClick={() => {
                  if (isCurrent) return;
                  navigate(
                    `/detail/${encodeURIComponent(row.scriptKey)}/${encodeURIComponent(row.vod.id)}`,
                    { replace: true }
                  );
                }}
                className="w-full flex gap-3 rounded-lg overflow-hidden p-2 text-left tap"
                style={{
                  background: isCurrent ? "var(--ember-soft)" : "var(--ink-2)",
                  border: `1px solid ${isCurrent ? "var(--ember)" : "var(--cream-line)"}`,
                }}
              >
                <div
                  className="w-14 h-20 shrink-0 rounded overflow-hidden scanlines relative"
                  style={{ background: "var(--ink-3)" }}
                >
                  {row.vod.poster ? (
                    <img
                      src={wrapImage(row.vod.poster, row.vod.poster_headers)}
                      className="w-full h-full object-cover"
                      alt={row.vod.title}
                      loading="lazy"
                    />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center text-cream-faint">
                      <IconFilm size={20} />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <p
                    className="text-sm font-display line-clamp-2"
                    style={{ color: isCurrent ? "var(--ember)" : "var(--cream)" }}
                  >
                    {row.vod.title}
                  </p>
                  <p className="font-mono text-[10px] text-cream-faint mt-1 line-clamp-1">
                    {isCurrent ? "正在播放" : `@${row.scriptName}`}
                    {row.vod.year && ` · ${row.vod.year}`}
                  </p>
                </div>
              </button>
            );
          })}
          {browseHasMore && (
            <div className="pt-1 flex justify-center">
              <button
                type="button"
                onClick={() => void loadMoreBrowse()}
                disabled={browseLoading}
                className="px-5 py-2 rounded-full text-xs font-display font-semibold tap disabled:opacity-50"
                style={{
                  background: "var(--ink-2)",
                  border: "1px solid var(--cream-line)",
                  color: "var(--cream)",
                }}
              >
                {browseLoading ? "加载中..." : "加载更多"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );

  const backButton = (
    <button
      type="button"
      onClick={() => navigate(-1)}
      className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream shrink-0"
      style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
      aria-label="返回"
    >
      <IconArrowLeft size={16} />
    </button>
  );

  return (
    <div
      className="h-full bg-ink text-cream flex flex-col overflow-hidden"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      {isDesktop ? (
        <div className="flex-1 min-h-0 flex">
          {/* 左列：上播放 + 下简介 */}
          <section className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-center gap-2 p-3">
              {backButton}
              <p className="font-display text-sm font-bold text-cream line-clamp-1">
                {detail.title}
              </p>
            </div>
            {playerArea}
            <div className="flex-1 min-h-0 overflow-y-auto">{infoArea}</div>
          </section>
          {/* 右列：同级列表 */}
          <aside
            className="w-72 shrink-0 overflow-y-auto"
            style={{ borderLeft: "1px solid var(--cream-line)" }}
          >
            {listArea}
          </aside>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="flex items-center gap-2 p-3">
            {backButton}
            <p className="font-display text-sm font-bold text-cream line-clamp-1">
              {detail.title}
            </p>
          </div>
          {playerArea}
          {infoArea}
          <div style={{ borderTop: "1px solid var(--cream-line)" }}>{listArea}</div>
        </div>
      )}

      <DanmakuPanel
        open={showDanmakuPanel}
        videoTitle={videoTitle}
        currentEpisodeIndex={safeEpIdx}
        currentSelection={danmakuSelection}
        onSelect={(s) => {
          setShowDanmakuPanel(false);
          void handleDanmakuAutoSelect(s);
        }}
        onClose={() => setShowDanmakuPanel(false)}
      />

      <SourceSwitcher
        open={showSourceSwitcher}
        playbacks={detail.playbacks}
        currentIndex={safePbIdx}
        episodeIndex={safeEpIdx}
        script={script}
        videoTitle={detail.title}
        onPick={(newPbIdx) => {
          setShowSourceSwitcher(false);
          setPbIdx(newPbIdx);
        }}
        onPickCrossScript={(newScriptKey, newVodId) => {
          setShowSourceSwitcher(false);
          navigate(
            `/detail/${encodeURIComponent(newScriptKey)}/${encodeURIComponent(newVodId)}`,
            { replace: true }
          );
        }}
        onClose={() => setShowSourceSwitcher(false)}
      />
    </div>
  );
}
