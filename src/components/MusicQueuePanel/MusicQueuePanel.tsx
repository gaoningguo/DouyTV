/**
 * 播放队列面板 — 从底部滑入的 sheet。
 *
 * 用法：受控 — 由 Player.tsx / MiniPlayer.tsx 长按触发 setOpen(true)。
 * 内部 zustand-like store 暴露开关方法，避免父层一堆 props 钻孔。
 */
import { useEffect } from "react";
import { create } from "zustand";
import { wrapImage } from "@/lib/proxy";
import { useMusicStore } from "@/stores/music";
import {
  IconClose,
  IconMusic,
  IconPlay,
  IconTrash,
} from "@/components/Icon";

interface PanelState {
  open: boolean;
  show: () => void;
  hide: () => void;
}

const usePanelStore = create<PanelState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

export function showQueuePanel() {
  usePanelStore.getState().show();
}

export function MusicQueuePanel() {
  const open = usePanelStore((s) => s.open);
  const hide = usePanelStore((s) => s.hide);
  const queue = useMusicStore((s) => s.queue);
  const queueIndex = useMusicStore((s) => s.queueIndex);
  const removeFromQueue = useMusicStore((s) => s.removeFromQueue);
  const playQueue = useMusicStore((s) => s.playQueue);

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, hide]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-end"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={hide}
    >
      <div
        className="w-full rounded-t-2xl flex flex-col"
        style={{
          background: "var(--ink)",
          borderTop: "1px solid var(--cream-line)",
          maxHeight: "70vh",
          animation: "sheet-up 220ms ease both",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ borderBottom: "1px solid var(--cream-line)" }}
        >
          <div>
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
              QUEUE · {queue.length}
            </p>
            <p className="text-sm font-display font-extrabold text-cream">播放队列</p>
          </div>
          <button
            type="button"
            onClick={hide}
            className="w-8 h-8 flex items-center justify-center tap text-cream-faint"
            aria-label="关闭"
          >
            <IconClose size={14} />
          </button>
        </div>
        <ul
          className="flex-1 overflow-y-auto p-2 space-y-1"
          style={{
            paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)",
          }}
        >
          {queue.length === 0 && (
            <li className="text-center text-cream-faint text-xs font-mono py-6">
              队列为空
            </li>
          )}
          {queue.map((s, i) => {
            const img = wrapImage(s.cover);
            const active = i === queueIndex;
            return (
              <li key={`${s.source}-${s.songId}-${i}`}>
                <div
                  className="flex items-center gap-2 px-2 py-2 rounded-lg tap"
                  style={{
                    background: active ? "var(--ember-soft)" : "var(--ink-2)",
                    border: active
                      ? "1px solid rgba(255,107,53,0.3)"
                      : "1px solid var(--cream-line)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => void playQueue(queue, i)}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                  >
                    <span
                      className="w-6 text-center font-mono text-[10px] shrink-0"
                      style={{ color: active ? "var(--ember)" : "var(--cream-faint)" }}
                    >
                      {active ? <IconPlay size={10} className="inline" /> : i + 1}
                    </span>
                    {img ? (
                      <img
                        src={img}
                        alt=""
                        loading="lazy"
                        className="w-8 h-8 rounded shrink-0 object-cover"
                      />
                    ) : (
                      <div
                        className="w-8 h-8 rounded shrink-0 flex items-center justify-center"
                        style={{ background: "var(--ink-3)" }}
                      >
                        <IconMusic size={12} className="text-cream-faint" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-xs font-display font-semibold line-clamp-1"
                        style={{ color: active ? "var(--ember)" : "var(--cream)" }}
                      >
                        {s.name}
                      </p>
                      <p className="text-[10px] font-mono text-cream-faint line-clamp-1">
                        {s.artist || "—"}
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeFromQueue(s)}
                    className="w-7 h-7 flex items-center justify-center tap text-cream-faint"
                    aria-label="从队列移除"
                  >
                    <IconTrash size={12} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export default MusicQueuePanel;
