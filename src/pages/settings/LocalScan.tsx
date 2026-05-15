import { useEffect, useState } from "react";
import { useLocalStore } from "@/stores/localVideos";
import { SettingsSubPageLayout } from "./Layout";
import { IconLocal } from "@/components/Icon";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export default function SettingsLocalScan() {
  const root = useLocalStore((s) => s.root);
  const videos = useLocalStore((s) => s.videos);
  const loading = useLocalStore((s) => s.loading);
  const error = useLocalStore((s) => s.error);
  const hydrate = useLocalStore((s) => s.hydrate);
  const scan = useLocalStore((s) => s.scan);

  const [input, setInput] = useState("");

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (root && !input) setInput(root);
  }, [root]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    scan(input.trim());
  };

  return (
    <SettingsSubPageLayout eyebrow="STORAGE · LOCAL" title="本地视频目录">
      {!isTauri && (
        <p
          className="text-xs mb-4 p-3 rounded-lg flex items-start gap-2"
          style={{
            background: "rgba(255,193,7,0.08)",
            border: "1px solid rgba(255,193,7,0.25)",
            color: "#FFD54F",
          }}
        >
          <span className="font-mono text-[10px] tracking-wider shrink-0">
            BROWSER MODE
          </span>
          <span>本地视频扫描需要 Tauri 桌面环境</span>
        </p>
      )}

      <section
        className="rounded-xl p-4 mb-4"
        style={{
          background: "var(--ink-2)",
          border: "1px solid var(--cream-line)",
        }}
      >
        <form onSubmit={onSubmit}>
          <label className="block font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
            DIRECTORY PATH
          </label>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="C:\\Users\\GAONX6\\Videos"
            className="w-full px-3 py-2 rounded-lg text-xs font-mono outline-none text-cream placeholder:text-cream-faint mb-3"
            style={{
              background: "var(--ink-3)",
              border: "1px solid var(--cream-line)",
            }}
          />
          <button
            type="submit"
            disabled={!input.trim() || loading || !isTauri}
            className="w-full py-2.5 rounded-lg text-xs font-display font-semibold tap disabled:opacity-50"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            {loading ? "扫描中…" : "扫描"}
          </button>
        </form>

        {error && (
          <p
            className="text-xs mt-3 p-2 rounded"
            style={{
              background: "rgba(255,80,80,0.08)",
              border: "1px solid rgba(255,80,80,0.2)",
              color: "#FF6B6B",
            }}
          >
            {error}
          </p>
        )}

        {root && (
          <div className="mt-3 pt-3 border-t border-cream-line">
            <p className="font-mono text-[10px] text-cream-faint mb-1">
              CURRENT ROOT
            </p>
            <p className="font-mono text-[11px] text-cream line-clamp-2 break-all">
              {root}
            </p>
            <p className="font-mono text-[10px] text-cream-faint mt-1">
              <span className="text-ember">{videos.length}</span> FILES INDEXED
            </p>
          </div>
        )}
      </section>

      <p className="text-[11px] text-cream-faint leading-relaxed flex items-start gap-2">
        <IconLocal size={13} className="text-cream-faint mt-0.5 shrink-0" />
        <span>
          扫描后可在底栏「本地」tab 浏览所有支持的视频文件（mp4 / m4v / webm /
          mov / mkv / avi 等）
        </span>
      </p>
    </SettingsSubPageLayout>
  );
}
