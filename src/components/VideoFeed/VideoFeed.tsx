import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  motion,
  useAnimationControls,
  type PanInfo,
} from "framer-motion";
import VideoPlayer from "@/components/VideoPlayer";
import type { MediaItem } from "@/types/media";

interface Props {
  items: MediaItem[];
  active?: boolean;
  initialIndex?: number;
  onIndexChange?: (index: number) => void;
  onLoadMore?: () => void;
  onProgress?: (item: MediaItem, position: number, duration: number) => void;
  onItemEnded?: (item: MediaItem) => void;
  loadMoreThreshold?: number;
  renderOverlay?: (item: MediaItem, index: number) => ReactNode;
  controls?: boolean;
  feedChrome?: "video" | "live";
  onRequestReresolve?: (item: MediaItem) => Promise<void> | void;
  onRequestSwitchSource?: (item: MediaItem) => void;
  onChangeEpisode?: (item: MediaItem, episodeIndex: number) => void | Promise<void>;
  heightMode?: "viewport" | "container";
  className?: string;
}

const SNAP_DISTANCE_RATIO = 0.18;
const SNAP_VELOCITY = 500;

export default function VideoFeed({
  items,
  active = true,
  initialIndex = 0,
  onIndexChange,
  onLoadMore,
  onProgress,
  onItemEnded,
  loadMoreThreshold = 3,
  renderOverlay,
  controls = false,
  feedChrome,
  onRequestReresolve,
  onRequestSwitchSource,
  onChangeEpisode,
  heightMode = "viewport",
  className,
}: Props) {
  const [index, setIndex] = useState(initialIndex);
  const [viewportH, setViewportH] = useState(() =>
    typeof window === "undefined" ? 800 : window.innerHeight
  );
  const [globalMuted, setGlobalMuted] = useState(false);
  const animControls = useAnimationControls();
  const containerRef = useRef<HTMLDivElement>(null);
  const lastWheelTs = useRef(0);

  useEffect(() => {
    const readHeight = () => {
      if (heightMode === "container") {
        const h = containerRef.current?.clientHeight;
        setViewportH(h && h > 0 ? h : window.innerHeight);
        return;
      }
      setViewportH(window.innerHeight);
    };
    readHeight();
    if (heightMode === "container" && typeof ResizeObserver !== "undefined") {
      const el = containerRef.current;
      if (!el) return;
      const ro = new ResizeObserver(readHeight);
      ro.observe(el);
      window.addEventListener("resize", readHeight);
      return () => {
        ro.disconnect();
        window.removeEventListener("resize", readHeight);
      };
    }
    window.addEventListener("resize", readHeight);
    return () => window.removeEventListener("resize", readHeight);
  }, [heightMode]);

  useEffect(() => {
    animControls.start({
      y: -index * viewportH,
      transition: { type: "spring", stiffness: 350, damping: 35 },
    });
    onIndexChange?.(index);
    if (onLoadMore && items.length - index <= loadMoreThreshold) {
      onLoadMore();
    }
    // Only react to feed position changes here; parent callbacks are often
    // recreated during item updates and would otherwise repeatedly load pages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, viewportH]);

  const jumpTo = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(items.length - 1, next));
      setIndex(clamped);
    },
    [items.length]
  );

  const handleDragEnd = useCallback(
    (_: unknown, info: PanInfo) => {
      const distanceThreshold = viewportH * SNAP_DISTANCE_RATIO;
      const dy = info.offset.y;
      const vy = info.velocity.y;
      if (dy < -distanceThreshold || vy < -SNAP_VELOCITY) {
        jumpTo(index + 1);
      } else if (dy > distanceThreshold || vy > SNAP_VELOCITY) {
        jumpTo(index - 1);
      } else {
        animControls.start({
          y: -index * viewportH,
          transition: { type: "spring", stiffness: 350, damping: 35 },
        });
      }
    },
    [animControls, index, jumpTo, viewportH]
  );

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const now = Date.now();
      if (now - lastWheelTs.current < 350) return;
      if (Math.abs(e.deltaY) < 15) return;
      lastWheelTs.current = now;
      jumpTo(index + (e.deltaY > 0 ? 1 : -1));
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === "j") {
        e.preventDefault();
        jumpTo(index + 1);
      } else if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "k") {
        e.preventDefault();
        jumpTo(index - 1);
      }
    };
    const el = containerRef.current;
    el?.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      el?.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
  }, [index, jumpTo]);

  if (items.length === 0) {
    return (
      <div
        className={`flex items-center justify-center bg-black text-white/60 ${
          heightMode === "container" ? "h-full w-full" : "h-screen w-screen"
        } ${className ?? ""}`}
      >
        暂无内容
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`${
        heightMode === "container" ? "h-full" : "h-screen"
      } w-full overflow-hidden bg-black touch-none ${className ?? ""}`}
    >
      <motion.div
        drag="y"
        dragConstraints={{
          top: -(items.length - 1) * viewportH,
          bottom: 0,
        }}
        dragElastic={0.12}
        dragMomentum={false}
        onDragEnd={handleDragEnd}
        animate={animControls}
        initial={{ y: -index * viewportH }}
        className="w-full"
      >
        {items.map((item, i) => {
          const distance = Math.abs(i - index);
          const shouldMount = distance <= 1;
          const curEp = item.currentEpisodeIndex ?? 0;
          const totalEp = item.episodes?.length ?? 0;
          const hasEps = totalEp > 1;
          return (
            <div
              key={item.id}
              className="relative w-full"
              style={{ height: viewportH }}
            >
              {shouldMount ? (
                <>
                  {item.url ? (
                    <VideoPlayer
                      item={item}
                      active={active && i === index}
                      muted={globalMuted}
                      onMutedChange={setGlobalMuted}
                      preload={distance === 0 ? "auto" : "auto"}
                      loop={!(item.episodes && item.episodes.length > 1)}
                      onProgress={(pos, dur) => onProgress?.(item, pos, dur)}
                      onEnded={
                        i === index && onItemEnded
                          ? () => onItemEnded(item)
                          : undefined
                      }
                      hotkeys={active && i === index}
                      controls={active && controls && i === index}
                      feedChrome={feedChrome ?? (item.kind === "live" ? "live" : "video")}
                      netlivePlatform={item.netlivePlatform}
                      onPrevEpisode={
                        hasEps && curEp > 0 && onChangeEpisode
                          ? () => void onChangeEpisode(item, curEp - 1)
                          : undefined
                      }
                      onNextEpisode={
                        hasEps && curEp < totalEp - 1 && onChangeEpisode
                          ? () => void onChangeEpisode(item, curEp + 1)
                          : undefined
                      }
                      onRequestReresolve={
                        onRequestReresolve
                          ? () => onRequestReresolve(item)
                          : undefined
                      }
                      onRequestSwitchSource={
                        onRequestSwitchSource
                          ? () => onRequestSwitchSource(item)
                          : undefined
                      }
                    />
                  ) : (
                    <LiveResolvingPlaceholder poster={item.poster} />
                  )}
                  {renderOverlay?.(item, i)}
                </>
              ) : (
                <div className="absolute inset-0 bg-black" />
              )}
            </div>
          );
        })}
      </motion.div>
    </div>
  );
}

function LiveResolvingPlaceholder({ poster }: { poster?: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black text-cream-faint">
      {poster && (
        <img
          src={poster}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-30 blur-sm"
          referrerPolicy="no-referrer"
        />
      )}
      <div className="relative z-10 signal-bars mb-4" style={{ height: 24 }}>
        <span />
        <span />
        <span />
      </div>
      <p className="relative z-10 font-mono text-[10px] tracking-[0.25em]">
        RESOLVING LIVE...
      </p>
    </div>
  );
}
