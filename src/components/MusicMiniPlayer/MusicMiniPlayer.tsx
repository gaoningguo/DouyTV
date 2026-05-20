/**
 * 全局底栏迷你音乐播放器。
 *
 * - 单例 <audio> 元素挂在这里，跨路由不卸载 → 切页面音乐不停
 * - 状态同步：useMusicStore.current 变了 → audio.src 替换；store.paused 变了 → audio.play/pause
 * - volume / playbackRate / pendingSeek → 实时同步到 <audio>
 * - 事件回传：audio 的 timeupdate / loadedmetadata / ended → store.setPosition / setDuration / next
 * - 隐藏：进入 /music/player（全屏 now-playing）/ 视频沉浸路由 时不渲染
 */
import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { useMusicStore } from "@/stores/music";
import { wrapImage } from "@/lib/proxy";
import {
  IconHeart,
  IconHeartFill,
  IconMusic,
  IconPause,
  IconPlay,
  IconSkipForward,
} from "@/components/Icon";

const HIDE_PREFIXES = [
  "/play",
  "/detail",
  "/music/player",
  "/books/read",
  "/manga/read",
];

export default function MusicMiniPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const store = useMusicStore();
  const location = useLocation();

  const hidden = HIDE_PREFIXES.some((p) => location.pathname.startsWith(p));

  // current 变化 → 重新加载
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!store.current) {
      audio.removeAttribute("src");
      audio.load();
      return;
    }
    if (audio.src !== store.current.url) {
      audio.src = store.current.url;
      audio.load();
      if (!store.paused) {
        audio.play().catch((e) => {
          console.warn("[MiniPlayer] play failed", e);
          store.setPaused(true);
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.current?.url]);

  // paused 状态同步
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !store.current) return;
    if (store.paused) {
      audio.pause();
    } else {
      audio.play().catch(() => {
        store.setPaused(true);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.paused]);

  // 音量
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = store.volume;
  }, [store.volume]);

  // 倍速
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = store.playbackRate;
  }, [store.playbackRate]);

  // 拖拽 seek（pendingSeek != -1 时消费一次）
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (store.pendingSeek < 0) return;
    audio.currentTime = store.pendingSeek;
    store.consumePendingSeek();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.pendingSeek]);

  // 进入沉浸视频路由时自动暂停音乐（音视频不同时叠播）
  useEffect(() => {
    if (location.pathname.startsWith("/play") && store.current && !store.paused) {
      store.setPaused(true);
      audioRef.current?.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  if (!store.current) return null;

  const cover = wrapImage(store.current.cover);
  const progress =
    store.durationSec > 0 ? (store.positionSec / store.durationSec) * 100 : 0;
  const isFav = store.isFavorite(store.current);

  return (
    <>
      {/* 音频元素：永远渲染，跨路由不卸载 */}
      <audio
        ref={audioRef}
        preload="auto"
        onTimeUpdate={(e) => store.setPosition(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => store.setDuration(e.currentTarget.duration)}
        onPlay={() => store.setPaused(false)}
        onPause={() => store.setPaused(true)}
        onEnded={() => void store.next()}
        onError={() => {
          store.setPaused(true);
          store.setError("音频加载失败");
        }}
      />
      {!hidden && (
        <div
          className="fixed left-0 right-0 z-30 backdrop-blur-md"
          style={{
            bottom: "var(--bottom-tab-h, 0px)",
            background: "rgba(14,15,17,0.92)",
            borderTop: "1px solid var(--cream-line)",
          }}
        >
          {/* 进度条 */}
          <div className="h-0.5 w-full" style={{ background: "var(--ink-edge)" }}>
            <div
              className="h-full"
              style={{
                width: `${progress}%`,
                background: "var(--ember)",
                transition: "width 200ms linear",
              }}
            />
          </div>
          <div className="flex items-center gap-3 px-3 py-2">
            <Link to="/music/player" className="flex items-center gap-3 flex-1 min-w-0 tap">
              {cover ? (
                <img
                  src={cover}
                  alt=""
                  loading="lazy"
                  className="w-10 h-10 rounded shrink-0 object-cover"
                />
              ) : (
                <div className="w-10 h-10 rounded shrink-0 flex items-center justify-center bg-ink-3">
                  <IconMusic size={16} className="text-cream-faint" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-display font-semibold line-clamp-1 text-cream">
                  {store.current.name}
                </p>
                <p className="text-[10px] font-mono text-cream-faint line-clamp-1">
                  {store.current.artist || "—"}
                </p>
              </div>
            </Link>
            <button
              type="button"
              onClick={() => void store.toggleFavorite(store.current!)}
              className="w-9 h-9 flex items-center justify-center tap"
              style={{ color: isFav ? "var(--ember)" : "var(--cream-dim)" }}
              aria-label={isFav ? "取消收藏" : "收藏"}
            >
              {isFav ? <IconHeartFill size={16} /> : <IconHeart size={16} />}
            </button>
            <button
              type="button"
              onClick={() => store.setPaused(!store.paused)}
              className="w-9 h-9 rounded-full flex items-center justify-center tap"
              style={{ background: "var(--ember)", color: "var(--ink)" }}
              aria-label={store.paused ? "播放" : "暂停"}
            >
              {store.paused ? <IconPlay size={16} /> : <IconPause size={16} />}
            </button>
            <button
              type="button"
              onClick={() => void store.next()}
              className="w-9 h-9 flex items-center justify-center tap text-cream"
              aria-label="下一首"
            >
              <IconSkipForward size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
