/**
 * 漫画详情 + 章节列表（JSON 源）。
 * 增强：同名换源 + 章节预下载（缓存到 store.pageCache）。
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useMangaSourceStore } from "@/stores/mangasource";
import {
  getMangaChapters,
  getMangaDetail,
  getMangaPages,
  searchManga,
} from "@/lib/mangasources/runtime";
import type {
  MangaChapter,
  MangaDetail,
  MangaItem,
  MangaShelfItemV2,
} from "@/lib/mangasources/types";
import { wrapImage } from "@/lib/proxy";
import {
  IconArrowLeft,
  IconDownload,
  IconHeart,
  IconHeartFill,
  IconRefresh,
} from "@/components/Icon";

interface NavState {
  manga?: MangaItem;
}

export default function MangaSrcDetail() {
  const { sourceId = "", mangaUrl: mangaUrlEnc = "" } = useParams();
  const mangaUrl = decodeURIComponent(mangaUrlEnc);
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state as NavState | null) ?? {};

  const sources = useMangaSourceStore((s) => s.sources);
  const addToShelf = useMangaSourceStore((s) => s.addToShelf);
  const removeFromShelf = useMangaSourceStore((s) => s.removeFromShelf);
  const isOnShelf = useMangaSourceStore((s) => s.isOnShelf);
  const getProgress = useMangaSourceStore((s) => s.getProgress);
  const hydrate = useMangaSourceStore((s) => s.hydrate);
  const cachePages = useMangaSourceStore((s) => s.cachePages);
  const noteChapterCount = useMangaSourceStore((s) => s.noteChapterCount);

  const source = sources.find((s) => s.id === sourceId);
  const [detail, setDetail] = useState<MangaDetail | null>(null);
  const [chapters, setChapters] = useState<MangaChapter[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const load = useCallback(async () => {
    if (!source) return;
    setLoading(true);
    setError(null);
    try {
      const d = await getMangaDetail(source, mangaUrl);
      setDetail(d);
      const cs = await getMangaChapters(source, d.chaptersUrl);
      setChapters(cs);
      noteChapterCount(d.id, cs.length);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [source, mangaUrl, noteChapterCount]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ─────── 同名换源 ─────── */
  const [altSources, setAltSources] = useState<
    Array<{ srcId: string; srcName: string; mangaUrl: string }>
  >([]);
  const [altLoading, setAltLoading] = useState(false);
  const [showAltMenu, setShowAltMenu] = useState(false);

  useEffect(() => {
    if (!detail) return;
    const others = sources.filter((s) => s.enabled && s.id !== sourceId);
    if (others.length === 0) return;
    setAltLoading(true);
    setAltSources([]);
    let cancelled = false;
    (async () => {
      const results: typeof altSources = [];
      await Promise.allSettled(
        others.map(async (s) => {
          try {
            const list = await searchManga(s, detail.name, 1);
            const match =
              list.find(
                (m) =>
                  m.name === detail.name &&
                  (!detail.author || !m.author || m.author === detail.author)
              ) ?? list[0];
            if (match) {
              results.push({
                srcId: s.id,
                srcName: s.name,
                mangaUrl: match.url,
              });
            }
          } catch {
            /* ignore */
          }
        })
      );
      if (!cancelled) {
        setAltSources(results);
        setAltLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.name, detail?.author, sourceId]);

  /* ─────── 章节预下载（前 5 章） ─────── */
  const [precaching, setPrecaching] = useState(false);
  const [precachedCount, setPrecachedCount] = useState(0);
  const runPrecache = async () => {
    if (!source || chapters.length === 0) return;
    setPrecaching(true);
    setPrecachedCount(0);
    const N = Math.min(5, chapters.length);
    for (let i = 0; i < N; i++) {
      const c = chapters[i];
      try {
        const list = await getMangaPages(source, c.url);
        cachePages(c.id, list);
        // 触发浏览器图片缓存 —— 创建 preload link
        for (const u of list.slice(0, 10)) {
          const wrapped = wrapImage(u);
          if (!wrapped) continue;
          const l = document.createElement("link");
          l.rel = "preload";
          l.as = "image";
          l.href = wrapped;
          document.head.appendChild(l);
          // 不主动移除 —— 让浏览器自己 evict
        }
      } catch (e) {
        console.warn("[mangasrc] precache fail", c.title, e);
      }
      setPrecachedCount(i + 1);
    }
    setPrecaching(false);
  };

  if (!source) {
    return (
      <div className="min-h-screen bg-ink text-cream p-4 flex items-center justify-center">
        <p className="text-cream-faint text-sm">源不存在</p>
      </div>
    );
  }

  const mangaId = detail?.id ?? `${sourceId}::${mangaUrl}`;
  const onShelf = isOnShelf(mangaId);
  const progress = getProgress(mangaId);
  const cover = detail?.cover ?? navState.manga?.cover;
  const name = detail?.name ?? navState.manga?.name ?? "—";

  const toggleShelf = () => {
    if (!detail) return;
    if (onShelf) {
      removeFromShelf(mangaId);
    } else {
      const item: MangaShelfItemV2 = {
        ...detail,
        savedAt: Date.now(),
      };
      addToShelf(item);
    }
  };

  return (
    <div className="min-h-screen bg-ink text-cream p-4 pb-24">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-[11px] text-cream-faint hover:text-cream tap mb-3"
      >
        <IconArrowLeft size={14} />
        返回
      </button>

      <header className="flex gap-3 mb-4">
        <div
          className="w-24 h-36 rounded shrink-0 overflow-hidden flex items-center justify-center"
          style={{ background: "var(--ink-3)" }}
        >
          {cover ? (
            <img
              src={wrapImage(cover)}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover"
            />
          ) : null}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-0.5">
            {source.name}
          </p>
          <h1 className="font-display text-lg font-extrabold tracking-tight line-clamp-2">
            {name}
          </h1>
          <p className="text-[12px] text-cream-dim mt-1">
            {detail?.author ?? "—"}
          </p>
          {detail?.status && (
            <p className="text-[10px] font-mono text-ember mt-1">
              {detail.status}
            </p>
          )}
          <div className="flex gap-2 mt-2 flex-wrap">
            <button
              type="button"
              onClick={toggleShelf}
              disabled={!detail}
              className="px-3 py-1.5 rounded text-[11px] font-display font-semibold tap disabled:opacity-30"
              style={{
                background: onShelf ? "var(--ember-soft)" : "var(--ink-3)",
                color: onShelf ? "var(--ember)" : "var(--cream)",
                border: `1px solid ${
                  onShelf ? "rgba(255,107,53,0.4)" : "var(--cream-line)"
                }`,
              }}
            >
              {onShelf ? (
                <IconHeartFill size={11} className="inline mr-1" />
              ) : (
                <IconHeart size={11} className="inline mr-1" />
              )}
              {onShelf ? "已收藏" : "收藏"}
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="px-3 py-1.5 rounded text-[11px] tap text-cream"
              style={{
                background: "var(--ink-3)",
                border: "1px solid var(--cream-line)",
              }}
            >
              <IconRefresh size={11} className="inline mr-1" />
              刷新
            </button>
            <button
              type="button"
              onClick={() => void runPrecache()}
              disabled={precaching || chapters.length === 0}
              className="px-3 py-1.5 rounded text-[11px] tap text-cream disabled:opacity-40"
              style={{
                background: "var(--ink-3)",
                border: "1px solid var(--cream-line)",
              }}
              title="预下载前 5 章"
            >
              <IconDownload size={11} className="inline mr-1" />
              {precaching
                ? `预下载 ${precachedCount}/5…`
                : "预下载 5 章"}
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowAltMenu((v) => !v)}
                disabled={!detail || altSources.length === 0}
                className="px-3 py-1.5 rounded text-[11px] tap text-cream disabled:opacity-40"
                style={{
                  background: "var(--ink-3)",
                  border: "1px solid var(--cream-line)",
                }}
                title="同名换源"
              >
                换源
                {altLoading
                  ? " …"
                  : altSources.length > 0
                    ? ` · ${altSources.length}`
                    : ""}
              </button>
              {showAltMenu && altSources.length > 0 && (
                <ul
                  className="absolute right-0 top-full mt-1 z-20 min-w-[180px] max-h-72 overflow-y-auto rounded-lg p-1"
                  style={{
                    background: "var(--ink-2)",
                    border: "1px solid var(--cream-line)",
                  }}
                >
                  {altSources.map((a) => (
                    <li key={a.srcId}>
                      <button
                        type="button"
                        onClick={() => {
                          setShowAltMenu(false);
                          navigate(
                            `/manga/src/detail/${a.srcId}/${encodeURIComponent(a.mangaUrl)}`,
                            { replace: true }
                          );
                        }}
                        className="w-full text-left px-2 py-1 text-[11px] rounded tap text-cream hover:bg-white/5"
                      >
                        {a.srcName}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </header>

      {detail?.intro && (
        <section
          className="rounded-xl p-3 mb-4 text-[11px] text-cream-dim leading-relaxed max-h-32 overflow-y-auto"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
        >
          {detail.intro}
        </section>
      )}

      {error && (
        <p
          className="p-2 rounded text-[11px] font-mono mb-3"
          style={{
            background: "rgba(255,80,80,0.08)",
            color: "#FF6B6B",
            border: "1px solid rgba(255,80,80,0.25)",
          }}
        >
          ✗ {error}
        </p>
      )}

      <section>
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
          CHAPTERS · {chapters.length}
          {loading && " · 加载中…"}
        </p>
        <ul className="space-y-0.5 max-h-[60vh] overflow-y-auto">
          {chapters.map((c) => {
            const isCurrent = progress?.chapterIndex === c.index;
            return (
              <li key={c.id}>
                <Link
                  to={`/manga/src/read/${encodeURIComponent(mangaId)}/${c.index}`}
                  state={{ detail, chapters }}
                  className="block px-3 py-2 rounded text-[12px] tap"
                  style={{
                    background: isCurrent ? "var(--ember-soft)" : "transparent",
                    color: isCurrent ? "var(--ember)" : "var(--cream)",
                    border: `1px solid ${
                      isCurrent ? "rgba(255,107,53,0.3)" : "transparent"
                    }`,
                  }}
                >
                  {c.title}
                  {c.date && (
                    <span className="ml-2 text-[9px] font-mono text-cream-faint">
                      {c.date}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
