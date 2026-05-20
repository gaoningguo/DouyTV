/**
 * 全屏 now-playing 页：封面 + 歌词（双语 / 字号 / 拖动 seek）+ 控件（循环 / 队列 / 音量 / 定时）。
 *
 * 桌面端额外功能（用 isDesktop gate）：
 * - IconClock 定时停止菜单
 * - 音量 slider
 * - 倍速选择
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMusicStore } from "@/stores/music";
import { wrapImage } from "@/lib/proxy";
import { isDesktop, isTauri } from "@/lib/platform";
import { getActiveBackendInfo } from "@/lib/music/api";
import { showQueuePanel } from "@/components/MusicQueuePanel";
import { showCommentsPanel } from "@/components/MusicCommentsPanel";
import { MusicLyricView } from "@/components/MusicLyricView";
import { MusicHeart } from "@/components/MusicHeart";
import {
  IconArrowLeft,
  IconClock,
  IconClose,
  IconDownload,
  IconList,
  IconMusic,
  IconPause,
  IconPlay,
  IconQueue,
  IconRepeat,
  IconRepeatOne,
  IconShuffle,
  IconSkipBackward,
  IconSkipForward,
  IconSubtitle,
  IconVolume,
} from "@/components/Icon";

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const SLEEP_OPTIONS = [10, 20, 30, 60] as const;
const RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const SIZE_LABELS = ["S", "M", "L", "XL"] as const;

export default function MusicPlayer() {
  const navigate = useNavigate();
  const store = useMusicStore();
  const [showSleep, setShowSleep] = useState(false);
  const [showVolume, setShowVolume] = useState(false);
  const [showRate, setShowRate] = useState(false);
  const [seekDragging, setSeekDragging] = useState(false);
  const [dragRatio, setDragRatio] = useState(0);
  const progressRef = useRef<HTMLDivElement | null>(null);

  if (!store.current) {
    return (
      <div className="min-h-screen bg-ink text-cream p-4 flex items-center justify-center">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-cream-dim text-sm"
        >
          ← 返回
        </button>
      </div>
    );
  }

  const cover = wrapImage(store.current.cover);
  const progressPct = seekDragging
    ? dragRatio * 100
    : store.durationSec > 0
      ? (store.positionSec / store.durationSec) * 100
      : 0;

  const handleSeekFromEvent = (clientX: number) => {
    const el = progressRef.current;
    if (!el || store.durationSec === 0) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio;
  };

  const onSeekStart = (clientX: number) => {
    setSeekDragging(true);
    setDragRatio(handleSeekFromEvent(clientX));
  };
  const onSeekMove = (clientX: number) => {
    if (!seekDragging) return;
    setDragRatio(handleSeekFromEvent(clientX));
  };
  const onSeekEnd = () => {
    if (!seekDragging) return;
    setSeekDragging(false);
    store.seekTo(dragRatio * store.durationSec);
  };

  useEffect(() => {
    if (!seekDragging) return;
    const move = (e: PointerEvent) => onSeekMove(e.clientX);
    const up = () => onSeekEnd();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekDragging, dragRatio, store.durationSec]);

  const repeatIcon =
    store.repeatMode === "single" ? (
      <IconRepeatOne size={18} />
    ) : store.repeatMode === "shuffle" ? (
      <IconShuffle size={18} />
    ) : (
      <IconRepeat size={18} />
    );

  const cycleRepeat = () => {
    const next =
      store.repeatMode === "list"
        ? "single"
        : store.repeatMode === "single"
          ? "shuffle"
          : "list";
    store.setRepeatMode(next);
  };

  const desktop = isDesktop();
  const backendInfo = getActiveBackendInfo();
  const canShowComments = desktop && !!backendInfo?.capabilities.comments;
  const sleepRemainingSec = store.sleepTimer
    ? Math.max(0, Math.floor((store.sleepTimer.fireAt - Date.now()) / 1000))
    : null;

  return (
    <div className="min-h-screen bg-ink text-cream relative overflow-hidden">
      {/* 背景模糊封面 */}
      {cover && (
        <div
          className="absolute inset-0 -z-10"
          style={{
            backgroundImage: `url(${cover})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(60px) brightness(0.4)",
            transform: "scale(1.2)",
          }}
        />
      )}

      <button
        type="button"
        onClick={() => navigate(-1)}
        className="absolute top-4 left-4 z-20 w-9 h-9 flex items-center justify-center rounded-full backdrop-blur-md tap"
        style={{
          background: "rgba(14,15,17,0.6)",
          border: "1px solid var(--cream-line)",
          color: "var(--cream)",
        }}
        aria-label="返回"
      >
        <IconArrowLeft size={16} />
      </button>

      {/* 右上控制条 */}
      <div className="absolute top-4 right-4 z-20 flex gap-2">
        <MusicHeart
          song={store.current}
          size={16}
          className="w-9 h-9 flex items-center justify-center rounded-full backdrop-blur-md"
        />
        {desktop && (
          <button
            type="button"
            onClick={() => {
              if (!isTauri()) return;
              void import("@tauri-apps/api/core").then(({ invoke }) =>
                invoke("open_lyric_window").catch(() => null)
              );
            }}
            className="w-9 h-9 flex items-center justify-center rounded-full backdrop-blur-md tap"
            style={{
              background: "rgba(14,15,17,0.6)",
              border: "1px solid var(--cream-line)",
              color: "var(--cream)",
            }}
            aria-label="独立歌词窗口"
          >
            <IconSubtitle size={16} />
          </button>
        )}
        {desktop && store.current && (
          <button
            type="button"
            onClick={() => void store.startDownload(store.current!)}
            className="w-9 h-9 flex items-center justify-center rounded-full backdrop-blur-md tap"
            style={{
              background: "rgba(14,15,17,0.6)",
              border: "1px solid var(--cream-line)",
              color: "var(--cream)",
            }}
            aria-label="下载"
          >
            <IconDownload size={16} />
          </button>
        )}
        {canShowComments && (
          <button
            type="button"
            onClick={() => showCommentsPanel(store.current!)}
            className="w-9 h-9 flex items-center justify-center rounded-full backdrop-blur-md tap"
            style={{
              background: "rgba(14,15,17,0.6)",
              border: "1px solid var(--cream-line)",
              color: "var(--cream)",
            }}
            aria-label="评论"
          >
            <IconList size={16} />
          </button>
        )}
        {desktop && (
          <button
            type="button"
            onClick={() => setShowSleep(true)}
            className="w-9 h-9 flex items-center justify-center rounded-full backdrop-blur-md tap"
            style={{
              background: "rgba(14,15,17,0.6)",
              border: "1px solid var(--cream-line)",
              color: sleepRemainingSec !== null ? "var(--ember)" : "var(--cream)",
            }}
            aria-label="定时停止"
          >
            <IconClock size={16} />
          </button>
        )}
      </div>

      <div className="flex flex-col md:flex-row items-center justify-center min-h-screen px-6 gap-8 pt-16 pb-32">
        {/* 封面 */}
        <div className="flex-shrink-0 max-w-sm w-full">
          {cover ? (
            <img
              src={cover}
              alt={store.current.name}
              className="w-full aspect-square rounded-2xl object-cover scanlines"
              style={{ boxShadow: "0 24px 64px -24px rgba(0,0,0,0.8)" }}
            />
          ) : (
            <div className="w-full aspect-square rounded-2xl flex items-center justify-center bg-ink-2">
              <IconMusic size={64} className="text-cream-faint" />
            </div>
          )}
          <div className="mt-5 text-center md:text-left">
            <h2 className="font-display text-xl font-extrabold tracking-tight line-clamp-1">
              {store.current.name}
            </h2>
            <p className="text-sm text-cream-dim mt-1 line-clamp-1">
              {store.current.artist || "—"}
              {store.current.album ? ` · ${store.current.album}` : ""}
            </p>
          </div>
        </div>

        {/* 歌词 + lyric 控制 */}
        <div className="flex-1 max-w-md w-full max-h-[60vh] flex flex-col">
          {/* lyric 控制条 */}
          <div className="flex items-center justify-end gap-2 mb-2">
            <button
              type="button"
              onClick={() => store.setShowTranslation(!store.showTranslation)}
              className="px-2 py-1 rounded text-[10px] font-mono tap"
              style={{
                background: store.showTranslation ? "var(--ember-soft)" : "var(--ink-2)",
                color: store.showTranslation ? "var(--ember)" : "var(--cream-dim)",
                border: "1px solid var(--cream-line)",
              }}
            >
              译文
            </button>
            <div className="flex gap-0.5">
              {([0, 1, 2, 3] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => store.setLrcSize(s)}
                  className="w-6 h-6 flex items-center justify-center rounded text-[10px] font-mono tap"
                  style={{
                    background: store.lrcSize === s ? "var(--ember-soft)" : "var(--ink-2)",
                    color: store.lrcSize === s ? "var(--ember)" : "var(--cream-dim)",
                    border: "1px solid var(--cream-line)",
                  }}
                >
                  {SIZE_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            <MusicLyricView largeMode={desktop} />
          </div>
        </div>
      </div>

      {/* 底部控件 */}
      <div
        className="fixed left-0 right-0 bottom-0 p-4 backdrop-blur-md"
        style={{
          background: "rgba(14,15,17,0.85)",
          borderTop: "1px solid var(--cream-line)",
        }}
      >
        <div className="max-w-md mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <span className="font-mono text-[10px] text-cream-faint w-10 text-right">
              {formatTime(seekDragging ? dragRatio * store.durationSec : store.positionSec)}
            </span>
            <div
              ref={progressRef}
              className="flex-1 h-2 rounded-full relative cursor-pointer"
              style={{ background: "var(--ink-edge)" }}
              onPointerDown={(e) => onSeekStart(e.clientX)}
            >
              <div
                className="h-full rounded-full pointer-events-none"
                style={{
                  width: `${progressPct}%`,
                  background: "var(--ember)",
                  boxShadow: "0 0 8px var(--ember-glow)",
                  transition: seekDragging ? "none" : "width 200ms linear",
                }}
              />
              <div
                className="absolute top-1/2 w-3 h-3 rounded-full -translate-y-1/2 pointer-events-none"
                style={{
                  left: `calc(${progressPct}% - 6px)`,
                  background: "var(--ember)",
                  boxShadow: "0 0 8px var(--ember-glow)",
                }}
              />
            </div>
            <span className="font-mono text-[10px] text-cream-faint w-10">
              {formatTime(store.durationSec)}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={cycleRepeat}
              className="w-10 h-10 flex items-center justify-center tap"
              style={{ color: "var(--cream)" }}
              aria-label={`循环模式: ${store.repeatMode}`}
            >
              {repeatIcon}
            </button>
            <button
              type="button"
              onClick={() => void store.prev()}
              className="w-10 h-10 flex items-center justify-center tap text-cream"
              aria-label="上一首"
            >
              <IconSkipBackward size={20} />
            </button>
            <button
              type="button"
              onClick={() => store.setPaused(!store.paused)}
              className="w-14 h-14 rounded-full flex items-center justify-center tap glow-ember"
              style={{ background: "var(--ember)", color: "var(--ink)" }}
              aria-label={store.paused ? "播放" : "暂停"}
            >
              {store.paused ? <IconPlay size={26} /> : <IconPause size={26} />}
            </button>
            <button
              type="button"
              onClick={() => void store.next()}
              className="w-10 h-10 flex items-center justify-center tap text-cream"
              aria-label="下一首"
            >
              <IconSkipForward size={20} />
            </button>
            <button
              type="button"
              onClick={showQueuePanel}
              className="w-10 h-10 flex items-center justify-center tap text-cream"
              aria-label="队列"
            >
              <IconQueue size={20} />
            </button>
          </div>

          {/* 桌面端音量 / 倍速 */}
          {desktop && (
            <div className="flex items-center justify-end gap-3 mt-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setShowVolume(!showVolume);
                    setShowRate(false);
                  }}
                  className="w-8 h-8 flex items-center justify-center tap text-cream-dim"
                  aria-label="音量"
                >
                  <IconVolume size={14} />
                </button>
                {showVolume && (
                  <div
                    className="absolute bottom-full right-0 mb-2 p-3 rounded-lg w-32"
                    style={{
                      background: "var(--ink-2)",
                      border: "1px solid var(--cream-line)",
                    }}
                  >
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={store.volume}
                      onChange={(e) => store.setVolume(parseFloat(e.target.value))}
                      className="w-full"
                    />
                    <p className="text-[10px] font-mono text-cream-faint text-center mt-1">
                      {Math.round(store.volume * 100)}%
                    </p>
                  </div>
                )}
              </div>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setShowRate(!showRate);
                    setShowVolume(false);
                  }}
                  className="px-2 py-1 rounded text-[10px] font-mono tap text-cream-dim"
                  style={{
                    background: store.playbackRate !== 1 ? "var(--ember-soft)" : "transparent",
                    color: store.playbackRate !== 1 ? "var(--ember)" : "var(--cream-dim)",
                    border: "1px solid var(--cream-line)",
                  }}
                >
                  {store.playbackRate}×
                </button>
                {showRate && (
                  <div
                    className="absolute bottom-full right-0 mb-2 p-2 rounded-lg flex gap-1"
                    style={{
                      background: "var(--ink-2)",
                      border: "1px solid var(--cream-line)",
                    }}
                  >
                    {RATE_OPTIONS.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => {
                          store.setPlaybackRate(r);
                          setShowRate(false);
                        }}
                        className="px-2 py-1 rounded text-[10px] font-mono tap"
                        style={{
                          background:
                            store.playbackRate === r ? "var(--ember)" : "var(--ink-3)",
                          color: store.playbackRate === r ? "var(--ink)" : "var(--cream-dim)",
                        }}
                      >
                        {r}×
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 定时停止面板 */}
      {showSleep && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.55)" }}
          onClick={() => setShowSleep(false)}
        >
          <div
            className="w-full max-w-xs rounded-2xl p-4"
            style={{
              background: "var(--ink)",
              border: "1px solid var(--cream-line)",
              animation: "sheet-up 220ms ease both",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
                SLEEP TIMER
              </p>
              <button
                type="button"
                onClick={() => setShowSleep(false)}
                className="w-7 h-7 flex items-center justify-center tap text-cream-faint"
                aria-label="关闭"
              >
                <IconClose size={12} />
              </button>
            </div>
            {sleepRemainingSec !== null && (
              <div
                className="p-2 rounded mb-3 text-[11px] font-mono text-center"
                style={{
                  background: "var(--ember-soft)",
                  color: "var(--ember)",
                  border: "1px solid rgba(255,107,53,0.3)",
                }}
              >
                剩余 {Math.floor(sleepRemainingSec / 60)} 分 {sleepRemainingSec % 60} 秒
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {SLEEP_OPTIONS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    store.setSleepTimer(m);
                    setShowSleep(false);
                  }}
                  className="py-2 rounded-lg text-xs font-display font-semibold tap"
                  style={{
                    background: "var(--ink-3)",
                    color: "var(--cream)",
                    border: "1px solid var(--cream-line)",
                  }}
                >
                  {m} 分钟
                </button>
              ))}
            </div>
            {sleepRemainingSec !== null && (
              <button
                type="button"
                onClick={() => {
                  store.setSleepTimer(null);
                  setShowSleep(false);
                }}
                className="w-full mt-2 py-2 rounded-lg text-xs tap text-cream-dim"
                style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
              >
                取消定时
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
