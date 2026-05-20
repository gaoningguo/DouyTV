/**
 * 桌面端评论面板 —— 通过 showCommentsPanel(song) 全局触发。
 *
 * 走 backend.capabilities.comments；当前后端不支持时不渲染入口（在 Player 里 gate）。
 * 分页加载（getMusicComments），下拉到底加载更多。
 */
import { create } from "zustand";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getMusicComments } from "@/lib/music/api";
import type { MusicComment, MusicSong } from "@/lib/music/types";
import { wrapImage } from "@/lib/proxy";
import { IconClose, IconHeart } from "@/components/Icon";

interface PanelState {
  song: MusicSong | null;
  open: boolean;
  show: (song: MusicSong) => void;
  close: () => void;
}

const usePanelStore = create<PanelState>((set) => ({
  song: null,
  open: false,
  show: (song) => set({ song, open: true }),
  close: () => set({ open: false, song: null }),
}));

export function showCommentsPanel(song: MusicSong) {
  usePanelStore.getState().show(song);
}

function formatTime(ts?: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(ts).toLocaleDateString();
}

export function MusicCommentsPanel() {
  const { song, open, close } = usePanelStore();
  const [comments, setComments] = useState<MusicComment[]>([]);
  const [page, setPage] = useState(1);
  const [isEnd, setIsEnd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !song) {
      setComments([]);
      setPage(1);
      setIsEnd(false);
      setError(null);
      return;
    }
    setLoading(true);
    void getMusicComments(song, 1)
      .then((r) => {
        setComments(r.list);
        setIsEnd(r.isEnd ?? r.list.length === 0);
        setPage(1);
      })
      .catch((e) => setError((e as Error).message ?? String(e)))
      .finally(() => setLoading(false));
  }, [open, song]);

  const loadMore = async () => {
    if (!song || isEnd || loading) return;
    setLoading(true);
    try {
      const next = page + 1;
      const r = await getMusicComments(song, next);
      setComments((prev) => [...prev, ...r.list]);
      setIsEnd(r.isEnd ?? r.list.length === 0);
      setPage(next);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  if (!open || !song) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={close}
    >
      <div
        className="w-full max-w-lg rounded-2xl flex flex-col"
        style={{
          background: "var(--ink)",
          border: "1px solid var(--cream-line)",
          maxHeight: "80vh",
          animation: "sheet-up 220ms ease both",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between p-4 shrink-0"
          style={{ borderBottom: "1px solid var(--cream-line)" }}
        >
          <div className="flex-1 min-w-0">
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
              COMMENTS
            </p>
            <h3 className="font-display text-base font-extrabold truncate">
              {song.name}
            </h3>
            <p className="text-[10px] text-cream-faint">{song.artist || "—"}</p>
          </div>
          <button
            type="button"
            onClick={close}
            className="w-8 h-8 flex items-center justify-center tap text-cream-faint"
            aria-label="关闭"
          >
            <IconClose size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <p
              className="p-2 rounded text-xs font-mono mb-3"
              style={{
                background: "rgba(255,80,80,0.08)",
                color: "#FF6B6B",
                border: "1px solid rgba(255,80,80,0.25)",
              }}
            >
              {error}
            </p>
          )}

          {loading && comments.length === 0 && (
            <div className="signal-bars" style={{ height: 22 }}>
              <span></span>
              <span></span>
              <span></span>
            </div>
          )}

          {!loading && comments.length === 0 && !error && (
            <p className="text-center text-[12px] text-cream-faint py-8">
              暂无评论
            </p>
          )}

          <ul className="space-y-3">
            {comments.map((c) => (
              <li
                key={c.id}
                className="flex gap-3 p-3 rounded-lg"
                style={{
                  background: "var(--ink-2)",
                  border: "1px solid var(--cream-line)",
                }}
              >
                {c.avatar ? (
                  <img
                    src={wrapImage(c.avatar)}
                    alt=""
                    loading="lazy"
                    className="w-8 h-8 rounded-full shrink-0 object-cover"
                  />
                ) : (
                  <div
                    className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center"
                    style={{ background: "var(--ink-3)" }}
                  >
                    <span className="text-[10px] font-display font-extrabold text-cream-dim">
                      {(c.user[0] || "?").toUpperCase()}
                    </span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-xs font-display font-semibold text-cream">
                      {c.user}
                    </span>
                    <span className="text-[10px] font-mono text-cream-faint">
                      {formatTime(c.publishedAt)}
                    </span>
                    {typeof c.likeCount === "number" && c.likeCount > 0 && (
                      <span className="ml-auto flex items-center gap-1 text-[10px] font-mono text-cream-faint">
                        <IconHeart size={10} />
                        {c.likeCount}
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-cream-dim leading-relaxed whitespace-pre-wrap break-words">
                    {c.content}
                  </p>
                  {c.reply && (
                    <div
                      className="mt-2 p-2 rounded text-[11px]"
                      style={{
                        background: "var(--ink-3)",
                        border: "1px solid var(--cream-line)",
                      }}
                    >
                      <span className="font-display font-semibold text-cream-faint">
                        @{c.reply.user}：
                      </span>
                      <span className="text-cream-dim">{c.reply.content}</span>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {!isEnd && comments.length > 0 && (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loading}
              className="mt-3 w-full py-2 rounded-lg text-xs tap text-cream disabled:opacity-50"
              style={{
                background: "var(--ink-2)",
                border: "1px solid var(--cream-line)",
              }}
            >
              {loading ? "加载中…" : "加载更多"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
