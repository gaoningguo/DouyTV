import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLibraryStore } from "@/stores/library";
import { useScriptStore } from "@/stores/scripts";
import { useVodAssetsStore } from "@/stores/vodAssets";
import { resumeVodDownload, startVodDownload } from "@/lib/vodDownload";
import type { MediaItem } from "@/types/media";
import {
  IconHeart,
  IconHeartFill,
  IconBookmark,
  IconBookmarkFill,
  IconShare,
  IconEpisodes,
  IconClose,
  IconDownload,
  IconCheck,
} from "@/components/Icon";

interface Props {
  item: MediaItem;
  onShare?: () => void;
  onSelectEpisode?: (episodeIndex: number) => void | Promise<void>;
}

function IconBtn({
  active,
  label,
  children,
  onClick,
  disabled,
}: {
  active?: boolean;
  label?: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      // framer-motion drag 容器会吞 pointer，必须在 pointerdown 阶段就 stopPropagation
      onPointerDownCapture={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`feed-action-button group flex flex-col items-center gap-1 pointer-events-auto select-none ${
        active ? "feed-action-button-active" : ""
      }`}
    >
      <span
        className="feed-action-icon w-12 h-12 rounded-full flex items-center justify-center backdrop-blur-md"
      >
        {children}
      </span>
      {label !== undefined && (
        <span className="text-[10px] text-cream text-shadow font-mono tracking-wider">
          {label}
        </span>
      )}
    </button>
  );
}

export default function InteractionBar({ item, onShare, onSelectEpisode }: Props) {
  const isFav = useLibraryStore((s) => s.isFavorite(item.id));
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);
  const scripts = useScriptStore((s) => s.scripts);
  const downloads = useVodAssetsStore((s) => s.downloads);
  const addDownloadTask = useVodAssetsStore((s) => s.addDownloadTask);
  const [liked, setLiked] = useState(() => loadLiked(item.id));
  const [toast, setToast] = useState<string | undefined>(undefined);
  const [epSheetOpen, setEpSheetOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  const hasEpisodes = !!item.episodes && item.episodes.length > 1;
  const currentEp = item.currentEpisodeIndex ?? 0;
  const totalEp = item.episodes?.length ?? 0;
  const downloadTask = downloads.find(
    (task) =>
      task.itemId === item.id &&
      task.playbackIndex === 0 &&
      task.episodeIndex === currentEp
  );

  useEffect(() => {
    setLiked(loadLiked(item.id));
  }, [item.id]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(undefined), 1400);
  };

  const handleLike = () => {
    const next = !liked;
    setLiked(next);
    saveLiked(item.id, next);
    showToast(next ? "已点赞" : "已取消点赞");
  };

  const handleFavorite = () => {
    const willBeFav = !isFav;
    toggleFavorite(item);
    showToast(willBeFav ? "已收藏" : "已取消收藏");
  };

  const handleDownload = async () => {
    if (!item.scriptKey || !item.vodId || !item.episodes?.[currentEp]) {
      showToast("当前内容暂不支持下载");
      return;
    }
    const script = scripts.find((row) => row.key === item.scriptKey);
    if (!script) {
      showToast("视频源不存在");
      return;
    }
    const taskId = addDownloadTask({
      itemId: item.id,
      scriptKey: item.scriptKey,
      vodId: item.vodId,
      title: item.title,
      poster: item.poster,
      sourceName: item.sourceName || script.name,
      playbackIndex: 0,
      episodeIndex: currentEp,
      episodeTitle: item.episodesTitles?.[currentEp] || `第${currentEp + 1}集`,
    });
    const task = useVodAssetsStore
      .getState()
      .downloads.find((row) => row.id === taskId);
    if (!task) return;
    await resumeVodDownload(task.id);
    showToast("已加入下载");
    await startVodDownload({
      task,
      script,
      episode: item.episodes[currentEp],
      sourceId: item.sourceId || "",
    });
  };

  const handlePickEpisode = async (idx: number) => {
    if (!onSelectEpisode || idx === currentEp) {
      setEpSheetOpen(false);
      return;
    }
    setSwitching(true);
    try {
      await onSelectEpisode(idx);
      showToast(`CH ${String(idx + 1).padStart(2, "0")}`);
    } catch (e) {
      showToast(`切换失败：${(e as Error).message}`);
    } finally {
      setSwitching(false);
      setEpSheetOpen(false);
    }
  };

  const handleShare = async () => {
    if (onShare) return onShare();
    const shareUrl = item.url || window.location.href;
    const shareData = {
      title: item.title,
      text: item.description ?? "",
      url: shareUrl,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        /* user cancelled */
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareUrl);
        showToast("已复制链接");
      } catch {
        showToast(shareUrl);
      }
    }
  };

  return (
    <>
      <div
        className="absolute flex flex-col gap-3.5 z-30 pointer-events-none"
        style={{
          bottom: "calc(var(--bottom-tab-h, 56px) + env(safe-area-inset-bottom) + 88px)",
          right: "calc(env(safe-area-inset-right) + 12px)",
        }}
      >
        <IconBtn active={liked} label={liked ? "已赞" : "点赞"} onClick={handleLike}>
          {liked ? <IconHeartFill size={22} /> : <IconHeart size={22} />}
        </IconBtn>

        <IconBtn
          active={isFav}
          label={isFav ? "已收藏" : "收藏"}
          onClick={handleFavorite}
        >
          {isFav ? <IconBookmarkFill size={21} /> : <IconBookmark size={21} />}
        </IconBtn>

        {hasEpisodes && (
          <IconBtn
            label={`${String(currentEp + 1).padStart(2, "0")}/${String(totalEp).padStart(2, "0")}`}
            onClick={() => setEpSheetOpen(true)}
          >
            <IconEpisodes size={20} />
          </IconBtn>
        )}

        {item.kind === "video" && (
          <IconBtn
            active={downloadTask?.status === "done"}
            label={
              downloadTask?.status === "done"
                ? "已下载"
                : downloadTask?.status === "downloading"
                ? `${Math.round(downloadTask.progress)}%`
                : "下载"
            }
            onClick={() => void handleDownload()}
            disabled={downloadTask?.status === "downloading"}
          >
            {downloadTask?.status === "done" ? (
              <IconCheck size={20} />
            ) : (
              <IconDownload size={20} />
            )}
          </IconBtn>
        )}

        <IconBtn label="分享" onClick={handleShare}>
          <IconShare size={20} />
        </IconBtn>
      </div>

      {toast && (
        <div
          className="absolute left-1/2 top-1/2 z-30 px-5 py-2.5 backdrop-blur-md pointer-events-none animate-toast-in font-mono text-xs tracking-wider"
          style={{
            background: "rgba(14, 15, 17, 0.86)",
            border: "1px solid var(--cream-line)",
            borderRadius: "10px",
            color: "var(--cream)",
            boxShadow: "0 0 0 1px rgba(255,107,53,0.18), 0 12px 32px -8px rgba(0,0,0,0.6)",
          }}
        >
          <span className="rec-dot" style={{ marginRight: 8 }} />
          {toast}
        </div>
      )}

      {epSheetOpen && hasEpisodes && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          onPointerDownCapture={(e) => e.stopPropagation()}
          onClick={() => setEpSheetOpen(false)}
          style={{ background: "rgba(0, 0, 0, 0.6)", backdropFilter: "blur(6px)" }}
        >
          <div
            className="w-full max-w-md bg-ink-2 max-h-[60vh] overflow-auto animate-sheet"
            onClick={(e) => e.stopPropagation()}
            style={{
              borderTopLeftRadius: 22,
              borderTopRightRadius: 22,
              borderTop: "1px solid var(--ink-edge)",
              padding: "20px 18px",
              // bottom sheet —— Home Indicator 让位
              paddingBottom: "calc(env(safe-area-inset-bottom) + 28px)",
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
                EPISODES · {String(totalEp).padStart(2, "0")} TOTAL
              </span>
              <button
                type="button"
                onClick={() => setEpSheetOpen(false)}
                className="text-cream-faint hover:text-cream tap p-1"
              >
                <IconClose size={18} />
              </button>
            </div>
            <h2 className="font-display text-lg font-semibold mb-4 line-clamp-1">
              {item.title}
            </h2>
            <div className="grid grid-cols-4 gap-2">
              {item.episodes!.map((_ep, idx) => {
                const title = item.episodesTitles?.[idx];
                const isCur = idx === currentEp;
                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={switching}
                    onClick={() => void handlePickEpisode(idx)}
                    className={`relative px-2 py-3 rounded text-xs text-center tap transition-all ${
                      isCur
                        ? "bg-ember text-ink font-semibold shadow-ember"
                        : "bg-ink-3 text-cream hover:bg-ink-edge border border-cream-line"
                    } disabled:opacity-50`}
                  >
                    <span className="block font-mono text-[10px] opacity-60 leading-none mb-1">
                      CH {String(idx + 1).padStart(2, "0")}
                    </span>
                    <span className="block line-clamp-1 text-[11px]">
                      {title || `第${idx + 1}集`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}

    </>
  );
}

function likeKey(itemId: string): string {
  return `douytv:liked:${itemId}`;
}

function loadLiked(itemId: string): boolean {
  try {
    return localStorage.getItem(likeKey(itemId)) === "1";
  } catch {
    return false;
  }
}

function saveLiked(itemId: string, liked: boolean) {
  try {
    if (liked) localStorage.setItem(likeKey(itemId), "1");
    else localStorage.removeItem(likeKey(itemId));
  } catch {
    /* ignore */
  }
}
