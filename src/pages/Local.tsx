import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useLocalStore, type LocalVideo } from "@/stores/localVideos";
import VideoPlayer from "@/components/VideoPlayer";
import type { MediaItem } from "@/types/media";
import {
  captureFirstFrame,
  readCachedThumb,
  writeCachedThumb,
  ThumbnailQueue,
} from "@/lib/thumbnail";
import { IconArrowLeft, IconFilm, IconLocal, IconSettings } from "@/components/Icon";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const THUMB_LIMIT = 30;

function formatSize(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + " GB";
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + " MB";
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(0) + " KB";
  return bytes + " B";
}

function formatDate(secs: number): string {
  if (!secs) return "";
  const d = new Date(secs * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Local() {
  const root = useLocalStore((s) => s.root);
  const videos = useLocalStore((s) => s.videos);
  const loading = useLocalStore((s) => s.loading);
  const error = useLocalStore((s) => s.error);
  const hydrate = useLocalStore((s) => s.hydrate);

  const [active, setActive] = useState<LocalVideo | undefined>(undefined);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const queueRef = useRef<ThumbnailQueue | null>(null);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    queueRef.current?.cancel();
    const queue = new ThumbnailQueue(2);
    queueRef.current = queue;
    const targets = videos.slice(0, THUMB_LIMIT);

    const next: Record<string, string> = {};
    for (const v of targets) {
      const url = isTauri ? convertFileSrc(v.path) : `file:///${v.path}`;
      const cached = readCachedThumb(url);
      if (cached) next[v.path] = cached;
    }
    if (Object.keys(next).length > 0) {
      setThumbs((prev) => ({ ...prev, ...next }));
    }

    for (const v of targets) {
      const url = isTauri ? convertFileSrc(v.path) : `file:///${v.path}`;
      if (readCachedThumb(url)) continue;
      queue.enqueue(async () => {
        try {
          const dataUrl = await captureFirstFrame(url);
          writeCachedThumb(url, dataUrl);
          setThumbs((prev) =>
            prev[v.path] ? prev : { ...prev, [v.path]: dataUrl }
          );
        } catch (e) {
          if (import.meta.env.DEV) {
            console.warn(`[thumb] ${v.path}`, e);
          }
        }
      });
    }

    return () => {
      queue.cancel();
    };
  }, [videos]);

  const mediaItem = useMemo<MediaItem | undefined>(() => {
    if (!active) return undefined;
    return {
      id: `local:${active.path}`,
      kind: "video",
      title: active.name,
      url: isTauri ? convertFileSrc(active.path) : `file:///${active.path}`,
      streamType: active.extension === "webm" ? "mp4" : "mp4",
      description: `${formatSize(active.size)} · ${active.extension.toUpperCase()}`,
    };
  }, [active]);

  if (active) {
    return (
      <div className="h-screen w-screen bg-black relative overflow-hidden">
        <button
          type="button"
          onClick={() => setActive(undefined)}
          className="absolute top-4 left-4 z-20 w-9 h-9 flex items-center justify-center rounded-full backdrop-blur-md tap"
          style={{
            background: "rgba(14,15,17,0.6)",
            border: "1px solid var(--cream-line)",
            color: "var(--cream)",
          }}
        >
          <IconArrowLeft size={16} />
        </button>
        {mediaItem && (
          <VideoPlayer item={mediaItem} active loop={false} muted={false} controls />
        )}
        <div className="absolute bottom-6 left-4 right-4 text-cream pointer-events-none">
          <p className="text-base font-display font-bold text-shadow line-clamp-1">
            {active.name}
          </p>
          <p className="font-mono text-[11px] text-cream-dim text-shadow mt-1">
            {formatSize(active.size)} · {active.extension.toUpperCase()} ·{" "}
            {formatDate(active.modified)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink text-cream p-4 pb-20">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[9px] tracking-[0.25em] text-cream-faint">
            STORAGE · LOCAL
          </p>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">
            本地视频
          </h1>
        </div>
        <Link
          to="/settings/local-scan"
          className="px-3 py-1.5 rounded-full text-xs font-display font-semibold tap flex items-center gap-1.5 text-cream shrink-0"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
          title="扫描目录设置"
        >
          <IconSettings size={13} />
          扫描设置
        </Link>
      </div>

      {!isTauri && (
        <p
          className="text-xs mb-3 p-3 rounded-lg flex items-start gap-2"
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

      {root && (
        <p className="font-mono text-[10px] text-cream-faint mb-3 line-clamp-1">
          <span className="text-cream-dim">ROOT:</span> {root}
          {videos.length > 0 && (
            <>
              {" · "}
              <span className="text-ember">{videos.length}</span> FILES
            </>
          )}
        </p>
      )}

      {loading && (
        <div className="flex items-center gap-3 text-cream-dim text-xs mb-3">
          <span className="signal-bars">
            <span></span>
            <span></span>
            <span></span>
          </span>
          <span className="font-mono tracking-wider">SCANNING…</span>
        </div>
      )}
      {error && (
        <p
          className="text-sm mb-3 p-2 rounded"
          style={{
            background: "rgba(255,80,80,0.08)",
            border: "1px solid rgba(255,80,80,0.2)",
            color: "#FF6B6B",
          }}
        >
          {error}
        </p>
      )}

      {!root && !loading && (
        <div className="text-center py-16">
          <IconLocal size={56} className="mx-auto text-cream-faint opacity-50 mb-3" />
          <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint mb-2">
            NO DIRECTORY
          </p>
          <p className="text-sm text-cream-dim mb-5">还没有扫描的本地目录</p>
          <Link
            to="/settings/local-scan"
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full text-xs font-display font-semibold tap glow-ember"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            <IconSettings size={13} />
            前往扫描设置
          </Link>
        </div>
      )}

      <ul className="space-y-1.5">
        {videos.map((v) => {
          const thumb = thumbs[v.path];
          return (
            <li
              key={v.path}
              onClick={() => setActive(v)}
              className="p-2 rounded-lg cursor-pointer flex items-center gap-3 tap"
              style={{
                background: "var(--ink-2)",
                border: "1px solid var(--cream-line)",
              }}
            >
              <div
                className="w-20 h-12 rounded overflow-hidden flex items-center justify-center shrink-0 scanlines"
                style={{ background: "var(--ink-3)" }}
              >
                {thumb ? (
                  <img
                    src={thumb}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <IconFilm size={20} className="text-cream-faint" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-display line-clamp-1 text-cream">
                  {v.name}
                </p>
                <p className="font-mono text-[10px] text-cream-faint mt-0.5 line-clamp-1">
                  {v.path}
                </p>
                <p className="font-mono text-[10px] text-cream-faint mt-0.5">
                  {formatSize(v.size)} · {v.extension.toUpperCase()} ·{" "}
                  {formatDate(v.modified)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      {!loading && !error && videos.length === 0 && root && (
        <div className="text-center py-10">
          <IconLocal size={48} className="mx-auto text-cream-faint opacity-50 mb-3" />
          <p className="text-sm text-cream-dim">该目录下没有支持的视频文件</p>
        </div>
      )}
    </div>
  );
}
