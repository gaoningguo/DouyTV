import { useState } from "react";
import { IconClose, IconList } from "@/components/Icon";

/** 歌单导入弹层:粘贴网易云歌单链接/ID,导入为「我的歌单」(对齐 CyreneMusic ImportPlaylistDialog)。 */
export function ImportPlaylistDialog({
  busy,
  onClose,
  onImport,
}: {
  busy: boolean;
  onClose: () => void;
  onImport: (input: string) => void;
}) {
  const [input, setInput] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <button
        type="button"
        aria-label="关闭"
        className="absolute inset-0 cursor-default"
        style={{ background: "rgba(0,0,0,0.68)" }}
        onClick={onClose}
      />
      <section
        className="relative w-full max-w-lg rounded-xl p-5"
        style={{ background: "rgba(22,24,29,0.98)", border: "1px solid var(--cream-line)" }}
      >
        <header className="mb-3 flex items-center gap-3">
          <IconList size={18} style={{ color: "var(--ember)" }} />
          <h2 className="font-display font-bold">导入网易歌单</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto w-9 h-9 rounded-lg grid place-items-center tap text-cream-dim"
          >
            <IconClose size={17} />
          </button>
        </header>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="粘贴网易云歌单链接或 ID（如 https://music.163.com/playlist?id=123 或 123）"
          className="h-10 w-full rounded-lg px-3 bg-ink text-sm outline-none text-cream"
          style={{ border: "1px solid var(--cream-line)" }}
        />
        <p className="mt-2 text-xs text-cream-faint">
          载入歌单需自部署 NeteaseCloudMusicApi 源（内置源受网易反爬限制）。
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="music-ob-ghost-btn !h-9 !px-4 !text-xs">
            取消
          </button>
          <button
            type="button"
            disabled={busy || !input.trim()}
            onClick={() => onImport(input.trim())}
            className="h-9 px-4 rounded-lg text-xs font-display font-bold tap disabled:opacity-45"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            {busy ? "导入中…" : "导入"}
          </button>
        </div>
      </section>
    </div>
  );
}
