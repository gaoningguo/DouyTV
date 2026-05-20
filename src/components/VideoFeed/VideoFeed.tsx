import { useCallback, useEffect, useRef, useState } from "react";
import {
  motion,
  useAnimationControls,
  type PanInfo,
} from "framer-motion";
import VideoPlayer from "@/components/VideoPlayer";
import type { MediaItem } from "@/types/media";

interface Props {
  items: MediaItem[];
  initialIndex?: number;
  onIndexChange?: (index: number) => void;
  onLoadMore?: () => void;
  onProgress?: (item: MediaItem, position: number, duration: number) => void;
  /** 当前 active 视频播放结束。Home 用来触发自动下一集（合集情况）或翻到下个视频 */
  onItemEnded?: (item: MediaItem) => void;
  loadMoreThreshold?: number;
  renderOverlay?: (item: MediaItem, index: number) => React.ReactNode;
  /** 是否给当前视频显示完整控制条（播放/暂停/进度/音量/全屏...） */
  controls?: boolean;
  /** 视频无法播放时，错误页「换源」按钮回调（VideoFeed 透传给 VideoPlayer） */
  onRequestReresolve?: (item: MediaItem) => Promise<void> | void;
  /** ArtPlayer 设置菜单「换源 / 测速」回调（VideoFeed 透传给 VideoPlayer） */
  onRequestSwitchSource?: (item: MediaItem) => void;
  /** 合集换集 — VideoFeed 内部根据 item.episodes / currentEpisodeIndex 决定 prev/next 是否启用 */
  onChangeEpisode?: (item: MediaItem, episodeIndex: number) => void | Promise<void>;
}

const SNAP_DISTANCE_RATIO = 0.18;
const SNAP_VELOCITY = 500;

export default function VideoFeed({
  items,
  initialIndex = 0,
  onIndexChange,
  onLoadMore,
  onProgress,
  onItemEnded,
  loadMoreThreshold = 3,
  renderOverlay,
  controls = false,
  onRequestReresolve,
  onRequestSwitchSource,
  onChangeEpisode,
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
    const onResize = () => setViewportH(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    animControls.start({
      y: -index * viewportH,
      transition: { type: "spring", stiffness: 350, damping: 35 },
    });
    onIndexChange?.(index);
    if (
      onLoadMore &&
      items.length - index <= loadMoreThreshold
    ) {
      onLoadMore();
    }
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
    [index, viewportH, jumpTo]
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
      )
        return;
      // ↑↓ / PageUp/Down / j/k 仅用于翻页；其它键（←→/Space/F/P/M）由
      // 当前 active 视频的 ArtPlayerHost 处理（capture 阶段，已先触发）
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
      <div className="h-screen w-screen flex items-center justify-center bg-black text-white/60">
        暂无内容
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-screen w-full overflow-hidden bg-black touch-none"
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
          // 当前 + 前后各 1 个 mount, 让 hls.js 预解析 manifest 实现秒播
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
                  <VideoPlayer
                    item={item}
                    active={i === index}
                    muted={globalMuted}
                    onMutedChange={setGlobalMuted}
                    preload={distance === 0 ? "auto" : "auto"}
                    // 合集视频不能 loop，否则 onEnded 永远不触发 → 无法自动播下一集
                    loop={!(item.episodes && item.episodes.length > 1)}
                    onProgress={(pos, dur) => onProgress?.(item, pos, dur)}
                    onEnded={
                      i === index && onItemEnded
                        ? () => onItemEnded(item)
                        : undefined
                    }
                    hotkeys={i === index}
                    controls={controls && i === index}
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
