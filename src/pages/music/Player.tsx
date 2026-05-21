/**
 * 全屏 now-playing —— 参考 MusicFree musicDetail：背景毛玻璃封面 + NavBar 三段式
 * + Content tap-swap (单击封面→歌词，单击歌词→封面) + 底部固定 SeekBar+控件。
 *
 * 桌面端 (md+) 永远左右双栏（封面信息 ｜ 歌词），不参与 tap-swap。
 * 移动端单视图切换，封面或歌词全屏二选一。
 *
 * 保留全部既有功能：循环 / 队列 / 音量 / 倍速 / 定时停止 / 评论 / 下载 / 独立歌词窗口。
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
  IconMore,
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

type MobileView = "album" | "lyric";

export default function MusicPlayer() {
  const navigate = useNavigate();
  const store = useMusicStore();
  const [view, setView] = useState<MobileView>("album");
  const [showSleep, setShowSleep] = useState(false);
  const [showVolume, setShowVolume] = useState(false);
  const [showRate, setShowRate] = useState(false);
  const [showMobileActions, setShowMobileActions] = useState(false);
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
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
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
  const canShowComments = !!backendInfo?.capabilities.comments;
  const sleepRemainingSec = store.sleepTimer
    ? Math.max(0, Math.floor((store.sleepTimer.fireAt - Date.now()) / 1000))
    : null;

  const openLyricWindow = () => {
    if (!isTauri()) return;
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("open_lyric_window").catch(() => null)
    );
  };

  return (
    <div className="fixed inset-0 z-30 bg-ink text-cream overflow-hidden flex flex-col">
      {/* ── 背景 ── 模糊封面双层叠加 (MusicFree background.tsx) */}
      {cover && (
        <>
          <div
            className="absolute inset-0 -z-10"
            style={{
              backgroundImage: `url(${cover})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              filter: "blur(60px) saturate(1.4)",
              transform: "scale(1.3)",
              opacity: 0.5,
            }}
          />
          <div
            className="absolute inset-0 -z-10 scanlines"
            style={{ background: "rgba(10,11,13,0.55)" }}
          />
        </>
      )}

      {/* ── NavBar ── 顶部三段式 (返回 / 居中标题 / 右操作) */}
      <header
        className="relative z-20 flex items-center px-4 pb-2 gap-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 16px)" }}
      >
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-10 h-10 flex items-center justify-center rounded-full backdrop-blur-md tap shrink-0"
          style={{
            background: "rgba(14,15,17,0.6)",
            border: "1px solid var(--cream-line)",
          }}
          aria-label="返回"
        >
          <IconArrowLeft size={16} />
        </button>

        <div className="flex-1 min-w-0 text-center">
          <p className="text-sm font-display font-extrabold tracking-tight line-clamp-1">
            {store.current.name}
          </p>
          <p className="text-[10px] font-mono text-cream-dim line-clamp-1">
            {store.current.artist || "—"}
            {store.current.source ? `  ·  ${store.current.source.toUpperCase()}` : ""}
          </p>
        </div>

        {/* 桌面端：展开全部 actions；移动端：单 ⋯ */}
        <div className="flex items-center gap-1.5 shrink-0">
          <MusicHeart
            song={store.current}
            size={16}
            className="w-10 h-10 flex items-center justify-center rounded-full backdrop-blur-md"
          />
          {desktop ? (
            <>
              <NavButton
                onClick={openLyricWindow}
                label="独立歌词窗口"
                icon={<IconSubtitle size={16} />}
              />
              <NavButton
                onClick={() => void store.startDownload(store.current!)}
                label="下载"
                icon={<IconDownload size={16} />}
              />
              {canShowComments && (
                <NavButton
                  onClick={() => showCommentsPanel(store.current!)}
                  label="评论"
                  icon={<IconList size={16} />}
                />
              )}
              <NavButton
                onClick={() => setShowSleep(true)}
                label="定时停止"
                icon={<IconClock size={16} />}
                active={sleepRemainingSec !== null}
              />
            </>
          ) : (
            <NavButton
              onClick={() => setShowMobileActions(true)}
              label="更多操作"
              icon={<IconMore size={16} />}
              active={sleepRemainingSec !== null}
            />
          )}
        </div>
      </header>

      {/* ── Body ── 桌面双栏 / 移动单视图 tap-swap */}
      <div className="relative z-10 flex-1 min-h-0 flex">
        {desktop ? (
          <div className="flex-1 flex">
            <div className="flex-1 flex flex-col items-center justify-center p-6 lg:p-12">
              <AlbumCover song={store.current} cover={cover} />
            </div>
            <div className="flex-1 flex flex-col p-6 lg:p-12 max-w-2xl min-h-0">
              <LyricControls store={store} />
              <div className="flex-1 min-h-0">
                <MusicLyricView largeMode />
              </div>
            </div>
          </div>
        ) : view === "album" ? (
          <button
            type="button"
            onClick={() => setView("lyric")}
            className="flex-1 flex flex-col items-center justify-center px-6"
            title="点击查看歌词"
          >
            <AlbumCover song={store.current} cover={cover} />
          </button>
        ) : (
          <div className="flex-1 flex flex-col min-h-0 px-4">
            <LyricControls store={store} />
            <div
              className="flex-1 min-h-0"
              onClick={(e) => {
                // 只在点击空白处切回
                if (e.target === e.currentTarget) setView("album");
              }}
            >
              <MusicLyricView />
            </div>
            <button
              type="button"
              onClick={() => setView("album")}
              className="mx-auto mb-2 text-[10px] font-mono text-cream-faint tap"
            >
              返回封面 ↑
            </button>
          </div>
        )}
      </div>

      {/* ── Bottom ── 固定底栏 SeekBar + Controls */}
      <div
        className="relative z-20 px-4 pt-3 backdrop-blur-md"
        style={{
          background: "rgba(10,11,13,0.7)",
          borderTop: "1px solid var(--cream-line)",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)",
        }}
      >
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-2">
            <span className="font-mono text-[10px] text-cream-faint w-10 text-right">
              {formatTime(seekDragging ? dragRatio * store.durationSec : store.positionSec)}
            </span>
            <div
              ref={progressRef}
              className="flex-1 h-2 rounded-full relative cursor-pointer"
              style={{ background: "var(--ink-edge, rgba(255,255,255,0.08))" }}
              onPointerDown={(e) => onSeekStart(e.clientX)}
            >
              <div
                className="h-full rounded-full pointer-events-none"
                style={{
                  width: `${progressPct}%`,
                  background: "var(--ember)",
                  boxShadow: "0 0 8px var(--ember-glow, rgba(255,107,53,0.5))",
                  transition: seekDragging ? "none" : "width 200ms linear",
                }}
              />
              <div
                className="absolute top-1/2 w-3.5 h-3.5 rounded-full -translate-y-1/2 pointer-events-none"
                style={{
                  left: `calc(${progressPct}% - 7px)`,
                  background: "var(--ember)",
                  boxShadow: "0 0 8px var(--ember-glow, rgba(255,107,53,0.5))",
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
              className="w-10 h-10 flex items-center justify-center tap text-cream-dim hover:text-cream"
              aria-label={`循环模式: ${store.repeatMode}`}
              title={`循环：${store.repeatMode}`}
            >
              {repeatIcon}
            </button>
            <button
              type="button"
              onClick={() => void store.prev()}
              className="w-12 h-12 flex items-center justify-center tap text-cream"
              aria-label="上一首"
            >
              <IconSkipBackward size={22} />
            </button>
            <button
              type="button"
              onClick={() => store.setPaused(!store.paused)}
              className="w-16 h-16 rounded-full flex items-center justify-center tap glow-ember"
              style={{ background: "var(--ember)", color: "var(--ink)" }}
              aria-label={store.paused ? "播放" : "暂停"}
            >
              {store.paused ? <IconPlay size={28} /> : <IconPause size={28} />}
            </button>
            <button
              type="button"
              onClick={() => void store.next()}
              className="w-12 h-12 flex items-center justify-center tap text-cream"
              aria-label="下一首"
            >
              <IconSkipForward size={22} />
            </button>
            <button
              type="button"
              onClick={showQueuePanel}
              className="w-10 h-10 flex items-center justify-center tap text-cream-dim hover:text-cream"
              aria-label="队列"
            >
              <IconQueue size={20} />
            </button>
          </div>

          {/* 桌面端：音量 + 倍速 */}
          {desktop && (
            <div className="flex items-center justify-end gap-3 mt-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setShowVolume(!showVolume);
                    setShowRate(false);
                  }}
                  className="w-8 h-8 flex items-center justify-center tap text-cream-dim hover:text-cream"
                  aria-label="音量"
                >
                  <IconVolume size={14} />
                </button>
                {showVolume && (
                  <div
                    className="absolute bottom-full right-0 mb-2 p-3 rounded-lg w-36"
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
                      className="w-full accent-ember"
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
                  className="px-2 py-1 rounded text-[10px] font-mono tap"
                  style={{
                    background: store.playbackRate !== 1 ? "var(--ember-soft, rgba(255,107,53,0.15))" : "transparent",
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
                          background: store.playbackRate === r ? "var(--ember)" : "var(--ink-3)",
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

      {/* ── 移动 actions sheet ── */}
      {!desktop && showMobileActions && (
        <ActionSheet
          onClose={() => setShowMobileActions(false)}
          actions={[
            ...(isTauri()
              ? [
                  {
                    icon: <IconSubtitle size={16} />,
                    label: "独立歌词窗口",
                    onClick: openLyricWindow,
                  },
                  {
                    icon: <IconDownload size={16} />,
                    label: "下载到本地",
                    onClick: () => void store.startDownload(store.current!),
                  },
                ]
              : []),
            ...(canShowComments
              ? [
                  {
                    icon: <IconList size={16} />,
                    label: "查看评论",
                    onClick: () => showCommentsPanel(store.current!),
                  },
                ]
              : []),
            {
              icon: <IconClock size={16} />,
              label: sleepRemainingSec !== null
                ? `定时停止 (${Math.ceil(sleepRemainingSec / 60)} 分)`
                : "定时停止",
              onClick: () => setShowSleep(true),
              active: sleepRemainingSec !== null,
            },
          ]}
        />
      )}

      {/* ── 定时停止 ── */}
      {showSleep && (
        <SleepDialog
          onClose={() => setShowSleep(false)}
          remainingSec={sleepRemainingSec}
          onSet={(m) => {
            store.setSleepTimer(m);
            setShowSleep(false);
            setShowMobileActions(false);
          }}
          onCancel={() => {
            store.setSleepTimer(null);
            setShowSleep(false);
          }}
        />
      )}
    </div>
  );
}

// ─── 子组件 ─────────────────────────────────────────────

function NavButton({
  onClick,
  label,
  icon,
  active,
}: {
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-10 h-10 flex items-center justify-center rounded-full backdrop-blur-md tap"
      style={{
        background: "rgba(14,15,17,0.6)",
        border: "1px solid var(--cream-line)",
        color: active ? "var(--ember)" : "var(--cream)",
      }}
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  );
}

function AlbumCover({
  song,
  cover,
}: {
  song: { name: string; artist?: string; album?: string };
  cover: string | undefined;
}) {
  return (
    <div className="w-full max-w-md flex flex-col items-center gap-5">
      {cover ? (
        <img
          src={cover}
          alt={song.name}
          className="w-full aspect-square rounded-2xl object-cover scanlines"
          style={{
            boxShadow: "0 24px 64px -24px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.05)",
          }}
        />
      ) : (
        <div
          className="w-full aspect-square rounded-2xl flex items-center justify-center"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
        >
          <IconMusic size={72} className="text-cream-faint" />
        </div>
      )}
      <div className="text-center">
        <h2 className="font-display text-xl font-extrabold tracking-tight line-clamp-2">
          {song.name}
        </h2>
        <p className="text-sm text-cream-dim mt-1.5 line-clamp-1">
          {song.artist || "—"}
          {song.album ? `  ·  ${song.album}` : ""}
        </p>
      </div>
    </div>
  );
}

function LyricControls({
  store,
}: {
  store: { showTranslation: boolean; lrcSize: number; setShowTranslation: (v: boolean) => void; setLrcSize: (n: 0 | 1 | 2 | 3) => void };
}) {
  return (
    <div className="flex items-center justify-end gap-2 mb-3">
      <button
        type="button"
        onClick={() => store.setShowTranslation(!store.showTranslation)}
        className="px-2 py-1 rounded text-[10px] font-mono tap"
        style={{
          background: store.showTranslation ? "var(--ember-soft, rgba(255,107,53,0.15))" : "rgba(14,15,17,0.6)",
          color: store.showTranslation ? "var(--ember)" : "var(--cream-dim)",
          border: "1px solid var(--cream-line)",
        }}
        title="双语显示"
      >
        译
      </button>
      <div className="flex gap-0.5">
        {([0, 1, 2, 3] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => store.setLrcSize(s)}
            className="w-6 h-6 flex items-center justify-center rounded text-[10px] font-mono tap"
            style={{
              background: store.lrcSize === s ? "var(--ember-soft, rgba(255,107,53,0.15))" : "rgba(14,15,17,0.6)",
              color: store.lrcSize === s ? "var(--ember)" : "var(--cream-dim)",
              border: "1px solid var(--cream-line)",
            }}
          >
            {SIZE_LABELS[s]}
          </button>
        ))}
      </div>
    </div>
  );
}

function ActionSheet({
  onClose,
  actions,
}: {
  onClose: () => void;
  actions: Array<{
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    active?: boolean;
  }>;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-end"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-2xl p-3"
        style={{
          background: "var(--ink)",
          border: "1px solid var(--cream-line)",
          animation: "sheet-up 220ms ease both",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={() => {
              a.onClick();
              onClose();
            }}
            className="w-full flex items-center gap-3 px-3 py-3 rounded-lg tap text-left"
            style={{
              color: a.active ? "var(--ember)" : "var(--cream)",
            }}
          >
            <span className="w-8 h-8 flex items-center justify-center rounded-full" style={{ background: "var(--ink-2)" }}>
              {a.icon}
            </span>
            <span className="text-sm font-display font-semibold">{a.label}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={onClose}
          className="w-full mt-2 py-2.5 rounded-lg text-xs font-display font-semibold tap text-cream-dim"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
        >
          取消
        </button>
      </div>
    </div>
  );
}

function SleepDialog({
  onClose,
  remainingSec,
  onSet,
  onCancel,
}: {
  onClose: () => void;
  remainingSec: number | null;
  onSet: (m: number) => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={onClose}
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
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center tap text-cream-faint"
            aria-label="关闭"
          >
            <IconClose size={12} />
          </button>
        </div>
        {remainingSec !== null && (
          <div
            className="p-2 rounded mb-3 text-[11px] font-mono text-center"
            style={{
              background: "var(--ember-soft, rgba(255,107,53,0.15))",
              color: "var(--ember)",
              border: "1px solid rgba(255,107,53,0.3)",
            }}
          >
            剩余 {Math.floor(remainingSec / 60)} 分 {remainingSec % 60} 秒
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {SLEEP_OPTIONS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onSet(m)}
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
        {remainingSec !== null && (
          <button
            type="button"
            onClick={onCancel}
            className="w-full mt-2 py-2 rounded-lg text-xs tap text-cream-dim"
            style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
          >
            取消定时
          </button>
        )}
      </div>
    </div>
  );
}
