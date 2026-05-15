import { useState } from "react";
import { createPortal } from "react-dom";
import { useLibraryStore } from "@/stores/library";
import type { MediaItem } from "@/types/media";
import {
  IconHeart,
  IconHeartFill,
  IconShare,
  IconEpisodes,
  IconClose,
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
      className="group flex flex-col items-center gap-1 pointer-events-auto tap select-none"
    >
      <span
        className={`w-12 h-12 rounded-full flex items-center justify-center backdrop-blur-md transition-all border ${
          active
            ? "bg-ember text-ink border-ember/0 shadow-ember"
            : "bg-ink-2/70 text-cream border-cream-line hover:border-cream-dim/40"
        }`}
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
  const [toast, setToast] = useState<string | undefined>(undefined);
  const [epSheetOpen, setEpSheetOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  const hasEpisodes = !!item.episodes && item.episodes.length > 1;
  const currentEp = item.currentEpisodeIndex ?? 0;
  const totalEp = item.episodes?.length ?? 0;

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(undefined), 1400);
  };

  const handleFavorite = () => {
    const willBeFav = !isFav;
    toggleFavorite(item);
    showToast(willBeFav ? "已收藏" : "已取消");
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
    const shareData = {
      title: item.title,
      text: item.description ?? "",
      url: item.url,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        /* user cancelled */
      }
    } else {
      try {
        await navigator.clipboard.writeText(item.url);
        showToast("已复制链接");
      } catch {
        showToast(item.url);
      }
    }
  };

  return (
    <>
      <div className="absolute right-3 bottom-32 md:bottom-40 flex flex-col gap-3.5 z-30 pointer-events-none">
        <IconBtn
          active={isFav}
          label={isFav ? "收藏" : "收藏"}
          onClick={handleFavorite}
        >
          {isFav ? <IconHeartFill size={22} /> : <IconHeart size={22} />}
        </IconBtn>

        {hasEpisodes && (
          <IconBtn
            label={`${String(currentEp + 1).padStart(2, "0")}/${String(totalEp).padStart(2, "0")}`}
            onClick={() => setEpSheetOpen(true)}
          >
            <IconEpisodes size={20} />
          </IconBtn>
        )}

        <IconBtn label="分享" onClick={handleShare}>
          <IconShare size={20} />
        </IconBtn>
      </div>

      {toast && (
        <div
          className="absolute left-1/2 top-1/2 z-30 px-5 py-2.5 backdrop-blur-md pointer-events-none animate-fade-in font-mono text-xs tracking-wider"
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
              padding: "20px 18px 28px",
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
