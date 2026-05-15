import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useDetail } from "@/hooks/useDetail";
import { useLibraryStore } from "@/stores/library";
import {
  IconArrowLeft,
  IconHeart,
  IconHeartFill,
  IconPlay,
  IconFilm,
  IconClock,
  IconCheck,
} from "@/components/Icon";

export default function Detail() {
  const params = useParams();
  const navigate = useNavigate();
  const scriptKey = decodeURIComponent(params.scriptKey ?? "");
  const vodId = decodeURIComponent(params.vodId ?? "");

  const { detail, loading, error, script } = useDetail(scriptKey, vodId);
  const hydrate = useLibraryStore((s) => s.hydrate);
  const isFavorite = useLibraryStore((s) => s.isFavorite);
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);
  const history = useLibraryStore((s) => s.history);

  const [pbIdx, setPbIdx] = useState(0);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    setPbIdx(0);
  }, [scriptKey, vodId]);

  const itemId = `${scriptKey}:${vodId}`;
  const isFav = isFavorite(itemId);
  const hist = history.find((h) => h.itemId === itemId);
  // 已看完的集索引集合 — 给选集网格加 ✓ 标记
  const watchedEpisodes = useMemo<Set<number>>(
    () => new Set(hist?.episodesWatched ?? []),
    [hist?.episodesWatched]
  );

  if (loading && !detail) {
    return (
      <div className="min-h-screen bg-ink text-cream flex items-center justify-center">
        <div className="signal-bars" style={{ height: 24 }}>
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="min-h-screen bg-ink text-cream p-4 flex flex-col items-center justify-center">
        <p className="font-mono text-[10px] tracking-[0.25em] text-ember mb-2">
          LOAD ERROR
        </p>
        <p className="text-sm text-cream-dim mb-5 text-center">
          {error || "加载失败"}
        </p>
        <Link
          to="/search"
          className="px-5 py-2.5 rounded-full text-xs font-display font-semibold tap"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
            color: "var(--cream)",
          }}
        >
          返回搜索
        </Link>
      </div>
    );
  }

  const safePbIdx = Math.min(pbIdx, detail.playbacks.length - 1);
  const playback = detail.playbacks[safePbIdx];

  return (
    <div className="min-h-screen bg-ink text-cream p-4 pb-24">
      <div className="flex items-center gap-3 mb-5">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
        >
          <IconArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[9px] tracking-[0.25em] text-cream-faint">
            DETAILS
          </p>
          <h1 className="font-display text-base font-bold line-clamp-1 tracking-tight">
            {detail.title}
          </h1>
        </div>
      </div>

      <div className="flex gap-3 mb-6">
        <div
          className="w-24 h-32 rounded-lg overflow-hidden shrink-0 scanlines"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
        >
          {detail.poster ? (
            <img
              src={detail.poster}
              className="w-full h-full object-cover"
              alt={detail.title}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-cream-faint">
              <IconFilm size={36} />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          <p className="text-base font-display font-bold line-clamp-2 leading-tight">
            {detail.title}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {detail.year && (
              <span className="chip-ch">{detail.year}</span>
            )}
            {detail.type_name && (
              <span className="chip-ch">{detail.type_name}</span>
            )}
          </div>
          <p className="font-mono text-[10px] text-cream-faint mt-2">
            @ {script?.name || scriptKey}
          </p>
          <div className="mt-auto flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                toggleFavorite({
                  id: itemId,
                  kind: "video",
                  title: detail.title,
                  url: "",
                  poster: detail.poster,
                  sourceName: script?.name,
                })
              }
              className="px-3 py-1.5 rounded-full text-xs font-display font-semibold tap flex items-center gap-1.5"
              style={
                isFav
                  ? {
                      background: "var(--ember)",
                      color: "var(--ink)",
                      boxShadow: "0 8px 20px -8px rgba(255,107,53,0.45)",
                    }
                  : {
                      background: "var(--ink-2)",
                      border: "1px solid var(--cream-line)",
                      color: "var(--cream)",
                    }
              }
            >
              {isFav ? <IconHeartFill size={13} /> : <IconHeart size={13} />}
              {isFav ? "已收藏" : "收藏"}
            </button>
            {hist && (
              <Link
                to={`/play/${encodeURIComponent(scriptKey)}/${encodeURIComponent(vodId)}/${safePbIdx}/${hist.episodeIndex}`}
                className="px-3 py-1.5 rounded-full text-xs font-display font-semibold tap flex items-center gap-1.5 text-cream"
                style={{
                  background: "var(--ink-2)",
                  border: "1px solid var(--cream-line)",
                }}
              >
                <IconClock size={13} />
                继续 · 第{hist.episodeIndex + 1}集
              </Link>
            )}
            {playback && (
              <Link
                to={`/play/${encodeURIComponent(scriptKey)}/${encodeURIComponent(vodId)}/${safePbIdx}/0`}
                className="px-3 py-1.5 rounded-full text-xs font-display font-semibold tap flex items-center gap-1.5 glow-ember"
                style={{ background: "var(--ember)", color: "var(--ink)" }}
              >
                <IconPlay size={13} />
                开始播放
              </Link>
            )}
          </div>
        </div>
      </div>

      {detail.desc && (
        <div className="mb-6">
          <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
            SYNOPSIS
          </p>
          <p className="text-xs text-cream-dim leading-relaxed whitespace-pre-line">
            {detail.desc}
          </p>
        </div>
      )}

      {detail.playbacks.length > 1 && (
        <div className="mb-4">
          <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
            LINE · SOURCE
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 no-scrollbar">
            {detail.playbacks.map((pb, i) => (
              <button
                key={`${pb.sourceId}:${i}`}
                type="button"
                onClick={() => setPbIdx(i)}
                className="shrink-0 px-3 py-1.5 rounded-full text-xs font-display font-semibold tap whitespace-nowrap"
                style={
                  i === safePbIdx
                    ? {
                        background: "var(--ember)",
                        color: "var(--ink)",
                      }
                    : {
                        background: "var(--ink-2)",
                        border: "1px solid var(--cream-line)",
                        color: "var(--cream)",
                      }
                }
              >
                {pb.sourceName} · {pb.episodes.length}
              </button>
            ))}
          </div>
        </div>
      )}

      {playback && (
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
              EPISODES
            </p>
            <p className="font-mono text-[10px] text-cream-dim">
              {String(playback.episodes.length).padStart(2, "0")} TOTAL · @{playback.sourceName}
            </p>
          </div>
          <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
            {playback.episodes.map((_ep, epIdx) => {
              const title =
                playback.episodes_titles?.[epIdx] || `第${epIdx + 1}集`;
              const isWatching =
                hist?.episodeIndex === epIdx && !hist.completed;
              const isWatched = watchedEpisodes.has(epIdx);
              return (
                <Link
                  key={epIdx}
                  to={`/play/${encodeURIComponent(scriptKey)}/${encodeURIComponent(vodId)}/${safePbIdx}/${epIdx}`}
                  className="relative px-2 py-3 rounded-lg text-xs text-center tap transition-all"
                  style={
                    isWatching
                      ? {
                          background: "var(--ember)",
                          color: "var(--ink)",
                          boxShadow: "0 0 0 1px rgba(255,107,53,0.4)",
                        }
                      : isWatched
                      ? {
                          background: "var(--ink-2)",
                          border: "1px solid rgba(124,255,178,0.35)",
                          color: "var(--cream-dim)",
                        }
                      : {
                          background: "var(--ink-2)",
                          border: "1px solid var(--cream-line)",
                          color: "var(--cream)",
                        }
                  }
                >
                  {isWatched && !isWatching && (
                    <span
                      className="absolute top-1 right-1 w-4 h-4 rounded-full flex items-center justify-center"
                      style={{
                        background: "var(--phosphor)",
                        color: "var(--ink)",
                      }}
                    >
                      <IconCheck size={10} />
                    </span>
                  )}
                  <span className="block font-mono text-[10px] opacity-60 leading-none mb-1">
                    CH {String(epIdx + 1).padStart(2, "0")}
                  </span>
                  <span className="block line-clamp-1 text-[11px]">{title}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
