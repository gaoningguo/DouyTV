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
  loadMoreThreshold?: number;
  renderOverlay?: (item: MediaItem, index: number) => React.ReactNode;
  /** 是否给当前视频显示完整控制条（播放/暂停/进度/音量/全屏...） */
  controls?: boolean;
  /** 视频无法播放时，错误页「换源」按钮回调（VideoFeed 透传给 VideoPlayer） */
  onRequestReresolve?: (item: MediaItem) => Promise<void> | void;
}

const SNAP_DISTANCE_RATIO = 0.18;
const SNAP_VELOCITY = 500;

export default function VideoFeed({
  items,
  initialIndex = 0,
  onIndexChange,
  onLoadMore,
  onProgress,
  loadMoreThreshold = 3,
  renderOverlay,
  controls = false,
  onRequestReresolve,
}: Props) {
  const [index, setIndex] = useState(initialIndex);
  const [viewportH, setViewportH] = useState(() =>
    typeof window === "undefined" ? 800 : window.innerHeight
  );
  const [globalMuted, setGlobalMuted] = useState(true);
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
      if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === "j") {
        e.preventDefault();
        jumpTo(index + 1);
      } else if (e.key === "ArrowUp" || e.key === "PageUp" || e.key === "k") {
        e.preventDefault();
        jumpTo(index - 1);
      } else if (e.key === "m" || e.key === "M") {
        setGlobalMuted((m) => !m);
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
                    onProgress={(pos, dur) => onProgress?.(item, pos, dur)}
                    hotkeys={false}
                    controls={controls && i === index}
                    onRequestReresolve={
                      onRequestReresolve
                        ? () => onRequestReresolve(item)
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
