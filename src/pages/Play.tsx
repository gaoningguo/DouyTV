import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useDetail } from "@/hooks/useDetail";
import { usePlayback } from "@/hooks/usePlayback";
import { usePlaybackPrefetch } from "@/hooks/usePlaybackPrefetch";
import { useDanmakuAutoLoad } from "@/hooks/useDanmakuAutoLoad";
import { useLibraryStore } from "@/stores/library";
import { useVodAssetsStore } from "@/stores/vodAssets";
import { useVodBrowseStore } from "@/stores/vodBrowse";
import { useScriptStore } from "@/stores/scripts";
import { callDetail } from "@/source-script/runtime";
import { Sheet } from "@/components/Sheet";
import { wrapImage } from "@/lib/proxy";
import { appAlert } from "@/components/AppDialog";
import { resumeVodDownload, startVodDownload } from "@/lib/vodDownload";
import VideoPlayer from "@/components/VideoPlayer";
import { readAutoNext } from "@/components/VideoPlayer/ArtPlayerHost";
import DanmakuPanel from "@/components/DanmakuPanel";
import SourceSwitcher from "@/components/SourceSwitcher";
import {
  IconArrowLeft,
  IconDanmaku,
  IconAntenna,
  IconHeart,
  IconHeartFill,
  IconDownload,
  IconCheck,
  IconShare,
  IconList,
  IconFilm,
} from "@/components/Icon";

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
  const isFavorite = useLibraryStore((s) => s.isFavorite);
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);
  const hydrateVodAssets = useVodAssetsStore((s) => s.hydrate);
  const downloads = useVodAssetsStore((s) => s.downloads);
  const addDownloadTask = useVodAssetsStore((s) => s.addDownloadTask);

  // 解析播放地址（抽到共享 hook，详情页内嵌播放器也用）
  const { item, resolving, resolveError } = usePlayback({
    script,
    detail,
    scriptKey,
    vodId,
    pbIdx,
    epIdx,
  });

  // 弹幕自动加载（抽到共享 hook）
  const {
    danmuComments,
    danmakuSelection,
    danmakuVisible,
    setDanmakuVisible,
    danmakuEnabled,
    videoTitle,
    handleSelect: handleDanmakuAutoSelect,
  } = useDanmakuAutoLoad(detail?.title, vodId, epIdx);
  const [showDanmakuPanel, setShowDanmakuPanel] = useState(false);

  // 换源 / 线路切换状态
  const [showSourceSwitcher, setShowSourceSwitcher] = useState(false);

  // 播放列表抽屉 —— 读「源站寻片」列表，快速切下一个视频，直接开播。
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [openingId, setOpeningId] = useState<string | undefined>(undefined);
  const browseResults = useVodBrowseStore((s) => s.results);
  const browseHasMore = useVodBrowseStore((s) => s.hasMore);
  const browseLoading = useVodBrowseStore((s) => s.loading);
  const loadMoreBrowse = useVodBrowseStore((s) => s.loadMore);
  const allScripts = useScriptStore((s) => s.scripts);

  // 播放接近结尾时预取下一集 / 下一条，切换丝滑（放进 onProgress 调）。
  const maybePrefetch = usePlaybackPrefetch({
    script,
    detail,
    vodId,
    pbIdx,
    epIdx,
    browseResults,
  });

  // 抽屉里点一个视频：后台取详情第一条可播线路，直接跳到播放页开播（不进详情）。
  const openBrowseRow = async (row: (typeof browseResults)[number]) => {
    const rowId = `${row.scriptKey}:${row.vod.id}`;
    if (openingId) return;
    if (rowId === itemId) {
      setShowPlaylist(false);
      return;
    }
    const desc = allScripts.find((s) => s.key === row.scriptKey);
    if (!desc) return;
    setOpeningId(rowId);
    try {
      const d = await callDetail(desc, { id: row.vod.id });
      const playbackIdx = d.playbacks.findIndex((pb) => pb.episodes.length > 0);
      if (playbackIdx < 0) throw new Error("该视频没有可播放剧集");
      setShowPlaylist(false);
      navigate(
        `/play/${encodeURIComponent(row.scriptKey)}/${encodeURIComponent(row.vod.id)}/${playbackIdx}/0`
      );
    } catch (e) {
      void appAlert((e as Error)?.message ?? String(e), { tone: "warning" });
    } finally {
      setOpeningId(undefined);
    }
  };

  const playback = detail?.playbacks[pbIdx];
  const episode = playback?.episodes[epIdx];

  // 继续观看：当前视频 + 当前集 + 未完成 → 用 history.position 作为起播点
  const itemId = `${scriptKey}:${vodId}`;
  const isFav = isFavorite(itemId);
  const downloadTask = downloads.find(
    (task) =>
      task.itemId === itemId &&
      task.playbackIndex === pbIdx &&
      task.episodeIndex === epIdx
  );
  const isDownloadBusy = downloadTask?.status === "downloading" || downloadTask?.status === "queued";
  const isDownloadDone = downloadTask?.status === "done";
  const continueFrom = history.find(
    (h) => h.itemId === itemId && h.episodeIndex === epIdx && !h.completed
  )?.position;

  useEffect(() => {
    hydrate();
    hydrateVodAssets();
  }, [hydrate, hydrateVodAssets]);

  const handleFavorite = () => {
    if (!item) return;
    toggleFavorite(item);
  };

  const handleDownload = async () => {
    if (!script || !detail || !playback || episode === undefined) return;
    const taskId = addDownloadTask({
      itemId,
      scriptKey,
      vodId,
      title: detail.title,
      poster: detail.poster,
      sourceName: playback.sourceName || script.name,
      playbackIndex: pbIdx,
      episodeIndex: epIdx,
      episodeTitle: playback.episodes_titles?.[epIdx] || `第${epIdx + 1}集`,
    });
    const task = useVodAssetsStore
      .getState()
      .downloads.find((row) => row.id === taskId);
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
    const text = `${detail?.title || videoTitle} ${playback?.episodes_titles?.[epIdx] || `第${epIdx + 1}集`}`;
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: detail?.title || videoTitle, text, url });
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

  const handlePickPlayback = (newPbIdx: number) => {
    setShowSourceSwitcher(false);
    if (newPbIdx === pbIdx) return;
    // 切换到新线路 —— 同集数 epIdx，组件根据 URL 重新解析
    navigate(
      `/play/${encodeURIComponent(scriptKey)}/${encodeURIComponent(vodId)}/${newPbIdx}/${epIdx}`,
      { replace: true }
    );
  };

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
      style={{ touchAction: "none", height: "100dvh" }}
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

      {/* 操作按钮 */}
      <div
        className="absolute z-20 flex items-center gap-2 flex-wrap justify-end"
        style={{
          top: "calc(env(safe-area-inset-top) + 16px)",
          right: "calc(env(safe-area-inset-right) + 16px)",
          maxWidth: "calc(100vw - 84px)",
        }}
      >
        <button
          type="button"
          onClick={handleFavorite}
          className="w-9 h-9 flex items-center justify-center rounded-full backdrop-blur-md tap"
          style={{
            background: isFav ? "var(--ember)" : "rgba(14,15,17,0.6)",
            border: `1px solid ${isFav ? "var(--ember)" : "var(--cream-line)"}`,
            color: isFav ? "var(--ink)" : "var(--cream)",
          }}
          aria-label={isFav ? "取消收藏" : "收藏"}
          title={isFav ? "取消收藏" : "收藏"}
        >
          {isFav ? <IconHeartFill size={16} /> : <IconHeart size={16} />}
        </button>
        <button
          type="button"
          disabled={isDownloadBusy || isDownloadDone}
          onClick={() => void handleDownload()}
          className="w-9 h-9 flex items-center justify-center rounded-full backdrop-blur-md tap disabled:opacity-70"
          style={{
            background: isDownloadDone ? "rgba(124,255,178,0.14)" : "rgba(14,15,17,0.6)",
            border: `1px solid ${
              isDownloadDone ? "rgba(124,255,178,0.32)" : "var(--cream-line)"
            }`,
            color: isDownloadDone ? "var(--phosphor)" : "var(--cream)",
          }}
          aria-label={isDownloadDone ? "已下载" : "下载"}
          title={
            isDownloadBusy
              ? `下载中 ${Math.round(downloadTask?.progress ?? 0)}%`
              : isDownloadDone
              ? "已下载"
              : "下载"
          }
        >
          {isDownloadDone ? <IconCheck size={16} /> : <IconDownload size={16} />}
        </button>
        <button
          type="button"
          onClick={() => void handleShare()}
          className="w-9 h-9 flex items-center justify-center rounded-full backdrop-blur-md tap"
          style={{
            background: "rgba(14,15,17,0.6)",
            border: "1px solid var(--cream-line)",
            color: "var(--cream)",
          }}
          aria-label="分享"
          title="分享"
        >
          <IconShare size={16} />
        </button>
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
          className="hidden sm:flex px-3 h-9 items-center gap-1.5 rounded-full backdrop-blur-md tap font-display text-xs"
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
        {browseResults.length > 0 && (
          <button
            type="button"
            onClick={() => setShowPlaylist(true)}
            className="px-3 h-9 flex items-center gap-1.5 rounded-full backdrop-blur-md tap font-display text-xs"
            style={{
              background: "rgba(14,15,17,0.6)",
              border: "1px solid var(--cream-line)",
              color: "var(--cream)",
            }}
            title="播放列表"
          >
            <IconList size={14} />
            <span className="hidden sm:inline">播放列表</span>
          </button>
        )}
      </div>

      <VideoPlayer
        item={item}
        active
        loop={false}
        muted={false}
        controls
        autoFullscreen
        startPosition={continueFrom}
        danmuComments={danmuComments}
        danmakuVisible={danmakuVisible && danmakuEnabled}
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
        onProgress={(pos, dur) => {
          upsertHistory(item, {
            position: pos,
            duration: dur,
            episodeIndex: epIdx,
          });
          maybePrefetch(pos, dur);
        }}
        onEnded={() => {
          // 自动连播（受播放器设置菜单开关控制）：有下一集先切集，
          // 否则（末集/单集）跳到源站列表里的下一个视频（直接开播）。
          if (!readAutoNext()) return;
          if (epIdx + 1 < totalEps) {
            navigate(
              `/play/${encodeURIComponent(scriptKey)}/${encodeURIComponent(vodId)}/${pbIdx}/${epIdx + 1}`
            );
            return;
          }
          const idx = browseResults.findIndex(
            (r) => `${r.scriptKey}:${r.vod.id}` === itemId
          );
          const next = browseResults[idx + 1];
          if (next) void openBrowseRow(next);
        }}
      />

      <div
        className="absolute left-4 right-4 text-cream pointer-events-none"
        style={{
          bottom: "calc(env(safe-area-inset-bottom) + 92px)",
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
        onSelect={(s) => {
          setShowDanmakuPanel(false);
          void handleDanmakuAutoSelect(s);
        }}
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

      {/* 播放列表抽屉 —— 源站寻片列表，快速切下一个视频（直接开播）+ 翻页 */}
      <Sheet
        open={showPlaylist}
        onClose={() => setShowPlaylist(false)}
        side="right"
        title="播放列表"
      >
        <div className="p-3 space-y-2">
          {browseResults.map((row) => {
            const rowId = `${row.scriptKey}:${row.vod.id}`;
            const isCurrent = rowId === itemId;
            const isOpening = openingId === rowId;
            return (
              <button
                key={rowId}
                type="button"
                onClick={() => void openBrowseRow(row)}
                className="w-full flex gap-3 rounded-lg overflow-hidden p-2 text-left tap"
                style={{
                  background: isCurrent ? "var(--ember-soft)" : "var(--ink)",
                  border: `1px solid ${
                    isCurrent ? "var(--ember)" : "var(--cream-line)"
                  }`,
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
                  {isOpening && (
                    <div className="absolute inset-0 grid place-items-center bg-black/50">
                      <span className="signal-bars" style={{ height: 14 }}>
                        <span></span>
                        <span></span>
                        <span></span>
                      </span>
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
                  background: "var(--ink)",
                  border: "1px solid var(--cream-line)",
                  color: "var(--cream)",
                }}
              >
                {browseLoading ? "加载中..." : "加载更多"}
              </button>
            </div>
          )}
        </div>
      </Sheet>
    </div>
  );
}
