import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useDetail } from "@/hooks/useDetail";
import { useLibraryStore } from "@/stores/library";
import { callResolvePlayUrl } from "@/source-script/runtime";
import VideoPlayer from "@/components/VideoPlayer";
import type { MediaItem } from "@/types/media";
import { IconArrowLeft } from "@/components/Icon";

export default function Play() {
  const params = useParams();
  const navigate = useNavigate();
  const scriptKey = decodeURIComponent(params.scriptKey ?? "");
  const vodId = decodeURIComponent(params.vodId ?? "");
  const pbIdx = parseInt(params.playbackIdx ?? "0", 10);
  const epIdx = parseInt(params.epIdx ?? "0", 10);

  const { detail, script } = useDetail(scriptKey, vodId);
  const upsertHistory = useLibraryStore((s) => s.upsertHistory);
  const hydrate = useLibraryStore((s) => s.hydrate);
  const history = useLibraryStore((s) => s.history);

  const [item, setItem] = useState<MediaItem | undefined>(undefined);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | undefined>(undefined);

  const playback = detail?.playbacks[pbIdx];
  const episode = playback?.episodes[epIdx];

  // 继续观看：当前视频 + 当前集 + 未完成 → 用 history.position 作为起播点
  const itemId = `${scriptKey}:${vodId}`;
  const continueFrom = history.find(
    (h) => h.itemId === itemId && h.episodeIndex === epIdx && !h.completed
  )?.position;

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!script || !playback || episode === undefined) return;
    let aborted = false;
    const playUrl = typeof episode === "string" ? episode : episode.playUrl;
    const needResolve =
      typeof episode === "string" ? true : episode.needResolve !== false;

    setResolving(true);
    setResolveError(undefined);

    (async () => {
      try {
        let resolved: {
          url: string;
          type: "auto" | "mp4" | "hls" | "dash" | "flv";
          headers: Record<string, string>;
        } = { url: playUrl, type: "auto", headers: {} };
        if (needResolve) {
          const r = await callResolvePlayUrl(script, {
            playUrl,
            sourceId: playback.sourceId,
            episodeIndex: epIdx,
          });
          resolved = {
            url: r.url,
            type: (r.type ?? "auto") as typeof resolved.type,
            headers: r.headers ?? {},
          };
        }
        if (aborted) return;
        setItem({
          id: `${scriptKey}:${vodId}`,
          kind: "video",
          title: detail?.title || vodId,
          poster: detail?.poster,
          url: resolved.url,
          streamType: resolved.type,
          headers: resolved.headers,
          sourceId: playback.sourceId,
          sourceName: playback.sourceName,
        });
      } catch (e) {
        if (!aborted) setResolveError((e as Error)?.message ?? String(e));
      } finally {
        if (!aborted) setResolving(false);
      }
    })();

    return () => {
      aborted = true;
    };
  }, [script?.key, vodId, pbIdx, epIdx, detail?.title]);

  if (resolveError) {
    return (
      <div className="min-h-screen bg-ink text-cream p-4 flex flex-col items-center justify-center">
        <p className="font-mono text-[10px] tracking-[0.25em] text-ember mb-2">
          PLAYBACK ERROR
        </p>
        <p className="text-sm text-cream-dim mb-4 text-center max-w-xs">
          {resolveError}
        </p>
        <Link
          to={`/detail/${encodeURIComponent(scriptKey)}/${encodeURIComponent(vodId)}`}
          className="px-5 py-2.5 rounded-full text-xs font-display font-semibold tap"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
            color: "var(--cream)",
          }}
        >
          返回详情
        </Link>
      </div>
    );
  }

  if (resolving || !item) {
    return (
      <div className="min-h-screen bg-ink text-cream flex flex-col items-center justify-center">
        <div className="signal-bars" style={{ height: 24 }}>
          <span></span>
          <span></span>
          <span></span>
        </div>
        <p className="mt-5 font-mono text-[10px] tracking-[0.25em] text-cream-faint">
          RESOLVING SIGNAL…
        </p>
      </div>
    );
  }

  const epTitle =
    playback?.episodes_titles?.[epIdx] || `第${epIdx + 1}集`;
  const totalEps = playback?.episodes.length ?? 0;

  return (
    <div className="h-screen w-screen bg-black relative overflow-hidden">
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

      <VideoPlayer
        item={item}
        active
        loop={false}
        muted={false}
        controls
        startPosition={continueFrom}
        onProgress={(pos, dur) =>
          upsertHistory(item, {
            position: pos,
            duration: dur,
            episodeIndex: epIdx,
          })
        }
        onEnded={() => {
          if (epIdx + 1 < totalEps) {
            navigate(
              `/play/${encodeURIComponent(scriptKey)}/${encodeURIComponent(vodId)}/${pbIdx}/${epIdx + 1}`
            );
          }
        }}
      />

      <div className="absolute bottom-6 left-4 right-4 text-cream pointer-events-none">
        <div className="flex items-center gap-2 mb-1">
          <span className="chip-ch">
            CH {String(epIdx + 1).padStart(2, "0")}
            {totalEps > 1 && ` / ${String(totalEps).padStart(2, "0")}`}
          </span>
        </div>
        <p className="text-base font-display font-bold text-shadow line-clamp-1">
          {detail?.title}
        </p>
        <p className="text-[11px] text-cream-dim text-shadow mt-1">{epTitle}</p>
      </div>
    </div>
  );
}
