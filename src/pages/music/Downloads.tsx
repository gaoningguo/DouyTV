/**
 * 桌面端音乐下载页 — 列出所有 in-progress / completed / failed 下载。
 *
 * 移动端不渲染（路由 gate 在 App.tsx 仍然挂；此处兜底用 isDesktop()）。
 */
import { useNavigate } from "react-router-dom";
import { useMusicStore } from "@/stores/music";
import { isDesktop } from "@/lib/platform";
import {
  IconArrowLeft,
  IconCheck,
  IconClose,
  IconDownload,
  IconMusic,
} from "@/components/Icon";
import { wrapImage } from "@/lib/proxy";

function fmtBytes(b: number): string {
  if (!b) return "0 KB";
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

export default function MusicDownloads() {
  const navigate = useNavigate();
  const downloads = useMusicStore((s) => s.downloads);
  const clearCompleted = useMusicStore((s) => s.clearCompletedDownloads);

  if (!isDesktop()) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center bg-ink text-cream p-4">
        <p className="text-[12px] text-cream-faint">
          下载管理仅在桌面端可用。
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-ink text-cream">
      <div
        className="shrink-0 flex items-center gap-3 px-4 pt-4 pb-3"
        style={{ borderBottom: "1px solid var(--cream-line)" }}
      >
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          aria-label="返回"
        >
          <IconArrowLeft size={16} />
        </button>
        <div className="flex-1">
          <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
            MUSIC · DOWNLOADS
          </p>
          <h1 className="font-display text-xl font-extrabold tracking-tight">
            下载管理
          </h1>
        </div>
        {downloads.some((d) => d.status !== "downloading") && (
          <button
            type="button"
            onClick={clearCompleted}
            className="px-2 py-1 rounded text-[10px] font-mono tap text-cream-dim"
            style={{
              background: "var(--ink-2)",
              border: "1px solid var(--cream-line)",
            }}
          >
            清空已完成
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
      {downloads.length === 0 ? (
        <div
          className="rounded-xl p-6 text-center"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
        >
          <IconDownload size={32} className="text-cream-faint mx-auto mb-3" />
          <p className="text-[12px] text-cream-faint">
            暂无下载 — 在歌曲长按菜单选择"下载"
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {downloads.map((d) => (
            <li
              key={d.id}
              className="rounded-lg p-3"
              style={{
                background: "var(--ink-2)",
                border: "1px solid var(--cream-line)",
              }}
            >
              <div className="flex items-center gap-3">
                {d.song.cover ? (
                  <img
                    src={wrapImage(d.song.cover)}
                    alt=""
                    loading="lazy"
                    className="w-10 h-10 rounded shrink-0 object-cover"
                  />
                ) : (
                  <div className="w-10 h-10 rounded shrink-0 flex items-center justify-center bg-ink-3">
                    <IconMusic size={14} className="text-cream-faint" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-display font-semibold line-clamp-1">
                    {d.song.name}
                  </p>
                  <p className="text-[10px] font-mono text-cream-faint line-clamp-1">
                    {d.song.artist || "—"}
                  </p>
                </div>
                <div className="shrink-0 flex flex-col items-end">
                  {d.status === "completed" && (
                    <span
                      className="flex items-center gap-1 text-[10px] font-mono"
                      style={{ color: "var(--phosphor)" }}
                    >
                      <IconCheck size={10} />
                      已完成
                    </span>
                  )}
                  {d.status === "failed" && (
                    <span
                      className="flex items-center gap-1 text-[10px] font-mono"
                      style={{ color: "#FF6B6B" }}
                      title={d.error}
                    >
                      <IconClose size={10} />
                      失败
                    </span>
                  )}
                  {d.status === "downloading" && (
                    <span className="text-[10px] font-mono text-ember">
                      {d.totalBytes > 0
                        ? `${Math.round(d.progress * 100)}%`
                        : fmtBytes(d.loadedBytes)}
                    </span>
                  )}
                </div>
              </div>

              {d.status === "downloading" && (
                <div
                  className="mt-2 h-1 rounded-full overflow-hidden"
                  style={{ background: "var(--ink-edge)" }}
                >
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: d.totalBytes > 0 ? `${d.progress * 100}%` : "50%",
                      background: "var(--ember)",
                      boxShadow: "0 0 8px var(--ember-glow)",
                    }}
                  />
                </div>
              )}

              {d.status === "completed" && d.filePath && (
                <p className="mt-1.5 text-[10px] font-mono text-cream-faint truncate">
                  {d.filePath}
                </p>
              )}
              {d.status === "failed" && d.error && (
                <p
                  className="mt-1.5 text-[10px] font-mono"
                  style={{ color: "#FF6B6B" }}
                >
                  {d.error}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      </div>
    </div>
  );
}
