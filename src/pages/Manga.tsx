import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";
import { Sheet } from "@/components/Sheet";
import {
  IconArrowLeft,
  IconBookmark,
  IconBookmarkFill,
  IconChevronDown,
  IconChevronUp,
  IconGrid,
  IconList,
  IconManga,
  IconSearch,
  IconSettings,
} from "@/components/Icon";
import {
  getMangaSources,
  searchMangaStream,
  getAggregatedRecommendStream,
  getMangaDetail,
  getMangaChapters,
  getMangaChapterPages,
  isMangaConfigured,
  type MangaChapter,
  type MangaDetail,
  type MangaSearchItem,
  type MangaSource,
} from "@/lib/manga";
import {
  useMangaStore,
  type MangaReadMode,
  type MangaScaleMode,
} from "@/stores/manga";
import MangaBrowse from "@/pages/manga/Browse";
import type {
  MangaReadRecord,
  MangaShelfItem,
  MangaRecommendType,
} from "@/lib/manga/types";

// 漫画模块页面：单一 Routes 承载 首页/书架、搜索、详情、阅读器 四个视图。
// 数据全部走 Suwayomi 客户端（Rust script_http_bytes 绕 CORS），书架/历史走 manga store。

export default function Manga() {
  const hydrate = useMangaStore((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <Routes>
      <Route path="/" element={<MangaHome />} />
      <Route path="search" element={<MangaSearch />} />
      <Route path="browse" element={<MangaBrowse />} />
      <Route path="detail/:sourceId/:mangaId" element={<MangaDetailView />} />
      <Route
        path="reader/:sourceId/:mangaId/:chapterId"
        element={<MangaReader />}
      />
    </Routes>
  );
}

function PageShell({
  title,
  eyebrow,
  onBack,
  trailing,
  children,
}: {
  title: string;
  eyebrow: string;
  onBack?: () => void;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-ink text-cream">
      <div
        className="shrink-0 flex items-center gap-3 px-4 pt-4 pb-3"
        style={{ borderBottom: "1px solid var(--cream-line)" }}
      >
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="w-9 h-9 flex items-center justify-center rounded-full shrink-0 tap text-cream"
            style={{
              background: "var(--ink-2)",
              border: "1px solid var(--cream-line)",
            }}
            aria-label="返回"
          >
            <IconArrowLeft size={16} />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
            {eyebrow}
          </p>
          <h1 className="font-display text-xl font-extrabold tracking-tight line-clamp-1">
            {title}
          </h1>
        </div>
        {trailing ?? (
          <button
            type="button"
            onClick={() => navigate("/settings/manga-hub")}
            className="w-9 h-9 flex items-center justify-center rounded-full shrink-0 tap text-cream-dim"
            style={{
              background: "var(--ink-2)",
              border: "1px solid var(--cream-line)",
            }}
            aria-label="漫画设置"
          >
            <IconSettings size={16} />
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4">{children}</div>
    </div>
  );
}

function MangaCover({
  cover,
  title,
  onClick,
  badge,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  onContextMenu,
}: {
  cover?: string;
  title: string;
  onClick?: () => void;
  badge?: React.ReactNode;
  onPointerDown?: () => void;
  onPointerUp?: () => void;
  onPointerLeave?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onContextMenu={onContextMenu}
      className="group text-left w-full tap"
    >
      <div
        className="relative aspect-[3/4] w-full overflow-hidden rounded-lg"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
      >
        {cover && !failed ? (
          <img
            src={cover}
            alt={title}
            loading="lazy"
            onError={() => setFailed(true)}
            className="w-full h-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-cream-faint">
            <IconManga size={32} />
          </div>
        )}
        {badge && (
          <div className="absolute bottom-1 left-1 right-1 flex justify-end">
            {badge}
          </div>
        )}
      </div>
      <p className="mt-1.5 text-xs font-display font-semibold line-clamp-2 text-cream-dim group-hover:text-cream">
        {title}
      </p>
    </button>
  );
}

// 历史卡片:点开继续阅读,长按/右键弹操作菜单。
function MangaHistoryCard({
  record,
  onOpen,
  onLongPress,
}: {
  record: MangaReadRecord;
  onOpen: () => void;
  onLongPress: () => void;
}) {
  const timerRef = useRef<number | null>(null);
  const longFiredRef = useRef(false);

  const start = () => {
    longFiredRef.current = false;
    timerRef.current = window.setTimeout(() => {
      longFiredRef.current = true;
      onLongPress();
    }, 500);
  };
  const clear = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  return (
    <MangaCover
      cover={record.cover}
      title={record.title}
      badge={
        record.pageCount > 0 ? (
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-mono"
            style={{ background: "rgba(0,0,0,0.6)", color: "var(--cream)" }}
          >
            {record.pageIndex + 1}/{record.pageCount}
          </span>
        ) : undefined
      }
      onClick={() => {
        if (longFiredRef.current) return;
        onOpen();
      }}
      onPointerDown={start}
      onPointerUp={clear}
      onPointerLeave={clear}
      onContextMenu={(e) => {
        e.preventDefault();
        onLongPress();
      }}
    />
  );
}

// ─── 首页 / 书架 + 推荐 ───────────────────────────────
function MangaHome() {
  const navigate = useNavigate();
  const shelf = useMangaStore((s) => s.shelf);
  const history = useMangaStore((s) => s.history);
  const isOnShelf = useMangaStore((s) => s.isOnShelf);
  const toggleShelf = useMangaStore((s) => s.toggleShelf);
  const removeHistory = useMangaStore((s) => s.removeHistory);
  const config = useMangaStore((s) => s.config);
  const recType: MangaRecommendType = "POPULAR";
  const [recommend, setRecommend] = useState<MangaSearchItem[]>([]);
  const [loadingRec, setLoadingRec] = useState(false);
  const [recError, setRecError] = useState("");
  const [recProgress, setRecProgress] = useState({ done: 0, total: 0 });
  const recTokenRef = useRef(0);
  // 长按/右键的历史记录操作菜单目标。
  const [actionTarget, setActionTarget] = useState<MangaReadRecord | null>(null);

  const configured = isMangaConfigured(config);

  // 首页聚合信息流:所有源的推荐(POPULAR/LATEST)合并,逐源增量刷新。
  useEffect(() => {
    if (!configured) return;
    const token = ++recTokenRef.current;
    setLoadingRec(true);
    setRecError("");
    setRecommend([]);
    setRecProgress({ done: 0, total: 0 });
    const seen = new Set<string>();
    getAggregatedRecommendStream(
      config,
      {
        onStart: (total) => {
          if (token === recTokenRef.current) setRecProgress({ done: 0, total });
        },
        onSourceResult: (_source, mangas, _hasNextPage, done, total) => {
          if (token !== recTokenRef.current) return;
          const fresh = mangas.filter((m) => {
            const key = `${m.sourceId}:${m.id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          if (fresh.length > 0) setRecommend((prev) => [...prev, ...fresh]);
          setRecProgress({ done, total });
        },
        onSourceError: (_failure, done, total) => {
          if (token === recTokenRef.current) setRecProgress({ done, total });
        },
      },
      recType
    )
      .then((res) => {
        if (token === recTokenRef.current && res.mangas.length === 0 && res.failedSources.length > 0) {
          setRecError(res.failedSources[0]?.error || "推荐加载失败");
        }
      })
      .catch((e) => {
        if (token === recTokenRef.current) setRecError((e as Error).message);
      })
      .finally(() => {
        if (token === recTokenRef.current) setLoadingRec(false);
      });
  }, [config, configured, recType]);

  const trailing = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => navigate("/manga/search")}
        className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream-dim"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
        aria-label="搜索漫画"
      >
        <IconSearch size={16} />
      </button>
      <button
        type="button"
        onClick={() => navigate("/settings/manga-hub")}
        className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream-dim"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
        aria-label="漫画设置"
      >
        <IconSettings size={16} />
      </button>
    </div>
  );

  return (
    <PageShell title="漫画" eyebrow="MANGA · SUWAYOMI" trailing={trailing}>
      {!configured ? (
        <EmptyState
          icon={<IconManga size={48} />}
          title="尚未配置 Suwayomi 服务"
          subtitle="漫画功能依赖你自部署的 Suwayomi 服务，请先在设置里填写服务地址。"
          action={
            <button
              type="button"
              onClick={() => navigate("/settings/manga-hub")}
              className="px-4 py-2 rounded-lg text-sm font-display font-semibold tap"
              style={{ background: "var(--ember)", color: "var(--ink)" }}
            >
              前往设置
            </button>
          }
        />
      ) : (
        <div className="space-y-6">
          {shelf.length > 0 && (
            <section>
              <h2 className="font-display font-bold text-sm text-cream mb-3">
                我的书架
              </h2>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {shelf.map((item) => (
                  <MangaCover
                    key={`${item.sourceId}:${item.mangaId}`}
                    cover={item.cover}
                    title={item.title}
                    badge={
                      item.unreadChapterCount && item.unreadChapterCount > 0 ? (
                        <span
                          className="rounded px-1.5 py-0.5 text-[10px] font-mono font-bold glow-ember"
                          style={{ background: "var(--ember)", color: "var(--ink)" }}
                        >
                          +{item.unreadChapterCount}
                        </span>
                      ) : undefined
                    }
                    onClick={() =>
                      navigate(
                        `/manga/detail/${encodeURIComponent(item.sourceId)}/${encodeURIComponent(item.mangaId)}`
                      )
                    }
                  />
                ))}
              </div>
            </section>
          )}

          {history.length > 0 && (
            <section>
              <h2 className="font-display font-bold text-sm text-cream mb-3">
                最近阅读
              </h2>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {history.slice(0, 12).map((h) => (
                  <MangaHistoryCard
                    key={`${h.sourceId}:${h.mangaId}`}
                    record={h}
                    onOpen={() =>
                      navigate(
                        `/manga/reader/${encodeURIComponent(h.sourceId)}/${encodeURIComponent(h.mangaId)}/${encodeURIComponent(h.chapterId)}?title=${encodeURIComponent(h.title)}&cover=${encodeURIComponent(h.cover)}&sourceName=${encodeURIComponent(h.sourceName)}&chapterName=${encodeURIComponent(h.chapterName)}`
                      )
                    }
                    onLongPress={() => setActionTarget(h)}
                  />
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="flex items-center justify-between mb-3 gap-3">
              <h2 className="font-display font-bold text-sm text-cream">
                热门推荐
              </h2>
              <button
                type="button"
                onClick={() => navigate("/manga/browse")}
                className="flex items-center gap-1 rounded-full px-3 py-1 text-xs font-display font-semibold tap text-cream-dim"
                style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
              >
                <IconGrid size={13} />
                源站寻书
              </button>
            </div>
            {recProgress.total > 0 && recProgress.done < recProgress.total && (
              <div className="h-1 rounded-full bg-ink-2 overflow-hidden mb-3">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${(recProgress.done / recProgress.total) * 100}%`,
                    background: "var(--ember)",
                  }}
                />
              </div>
            )}
            {recommend.length === 0 && loadingRec ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="space-y-1.5">
                    <div
                      className="aspect-[3/4] rounded-lg animate-pulse"
                      style={{ background: "var(--ink-2)" }}
                    />
                    <div
                      className="h-3 w-3/4 rounded animate-pulse"
                      style={{ background: "var(--ink-2)" }}
                    />
                  </div>
                ))}
              </div>
            ) : recommend.length === 0 && recError ? (
              <p className="text-sm text-ember">{recError}</p>
            ) : recommend.length === 0 ? (
              <EmptyState
                icon={<IconManga size={48} />}
                title="暂无推荐"
                subtitle="试试直接搜索，或到源站寻书浏览分类。"
              />
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {recommend.map((item) => (
                  <MangaCover
                    key={`${item.sourceId}:${item.id}`}
                    cover={item.cover}
                    title={item.title}
                    onClick={() =>
                      navigate(
                        `/manga/detail/${encodeURIComponent(item.sourceId)}/${encodeURIComponent(item.id)}?title=${encodeURIComponent(item.title)}&cover=${encodeURIComponent(item.cover)}&sourceName=${encodeURIComponent(item.sourceName)}`
                      )
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* 历史记录操作菜单 */}
      {actionTarget && (
        <Sheet
          open={!!actionTarget}
          onClose={() => setActionTarget(null)}
          side="bottom"
          title={actionTarget.title}
        >
          <div className="p-3 space-y-1">
            <button
              type="button"
              onClick={() => {
                navigate(
                  `/manga/reader/${encodeURIComponent(actionTarget.sourceId)}/${encodeURIComponent(actionTarget.mangaId)}/${encodeURIComponent(actionTarget.chapterId)}?title=${encodeURIComponent(actionTarget.title)}&cover=${encodeURIComponent(actionTarget.cover)}&sourceName=${encodeURIComponent(actionTarget.sourceName)}&chapterName=${encodeURIComponent(actionTarget.chapterName)}`
                );
                setActionTarget(null);
              }}
              className="w-full text-left px-4 py-3 rounded-lg text-sm tap text-cream"
              style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            >
              继续阅读
            </button>
            <button
              type="button"
              onClick={() => {
                navigate(
                  `/manga/detail/${encodeURIComponent(actionTarget.sourceId)}/${encodeURIComponent(actionTarget.mangaId)}`
                );
                setActionTarget(null);
              }}
              className="w-full text-left px-4 py-3 rounded-lg text-sm tap text-cream"
              style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            >
              查看详情
            </button>
            <button
              type="button"
              onClick={() => {
                toggleShelf({
                  sourceId: actionTarget.sourceId,
                  sourceName: actionTarget.sourceName,
                  mangaId: actionTarget.mangaId,
                  title: actionTarget.title,
                  cover: actionTarget.cover,
                  saveTime: Date.now(),
                });
                setActionTarget(null);
              }}
              className="w-full text-left px-4 py-3 rounded-lg text-sm tap text-cream"
              style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            >
              {isOnShelf(actionTarget.sourceId, actionTarget.mangaId) ? "移出书架" : "加入书架"}
            </button>
            <button
              type="button"
              onClick={() => {
                removeHistory(actionTarget.sourceId, actionTarget.mangaId);
                setActionTarget(null);
              }}
              className="w-full text-left px-4 py-3 rounded-lg text-sm tap text-ember"
              style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            >
              删除记录
            </button>
          </div>
        </Sheet>
      )}
    </PageShell>
  );
}

// ─── 搜索 ───────────────────────────────
function MangaSearch() {
  const navigate = useNavigate();
  const config = useMangaStore((s) => s.config);
  const [query, setQuery] = useState("");
  const [sources, setSources] = useState<MangaSource[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [results, setResults] = useState<MangaSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const runTokenRef = useRef(0);

  useEffect(() => {
    getMangaSources(config).then(setSources).catch(() => undefined);
  }, [config]);

  const doSearch = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const q = query.trim();
      if (!q) return;
      const token = ++runTokenRef.current;
      setLoading(true);
      setError("");
      setSearched(true);
      setResults([]);
      setProgress({ done: 0, total: 0 });
      const seen = new Set<string>();
      const errors: string[] = [];
      try {
        const res = await searchMangaStream(
          config,
          q,
          {
            onStart: (total) => {
              if (token === runTokenRef.current) setProgress({ done: 0, total });
            },
            onSourceResult: (_source, sourceResults, done, total) => {
              if (token !== runTokenRef.current) return;
              const fresh = sourceResults.filter((item) => {
                const key = `${item.sourceId}:${item.id}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              });
              if (fresh.length > 0) setResults((prev) => [...prev, ...fresh]);
              setProgress({ done, total });
            },
            onSourceError: (failure, done, total) => {
              if (token !== runTokenRef.current) return;
              errors.push(failure.error);
              setProgress({ done, total });
            },
          },
          sourceId || undefined
        );
        if (
          token === runTokenRef.current &&
          res.results.length === 0 &&
          res.failedSources.length > 0
        ) {
          setError(errors.join("; "));
        }
      } catch (err) {
        if (token === runTokenRef.current) {
          setError((err as Error).message);
          setResults([]);
        }
      } finally {
        if (token === runTokenRef.current) setLoading(false);
      }
    },
    [config, query, sourceId]
  );

  return (
    <PageShell
      title="搜索漫画"
      eyebrow="MANGA · SEARCH"
      onBack={() => navigate(-1)}
    >
      <form onSubmit={doSearch} className="flex flex-col sm:flex-row gap-2 mb-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索漫画标题"
          className="flex-1 rounded-lg px-3 py-2.5 text-sm outline-none"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
            color: "var(--cream)",
          }}
        />
        <select
          value={sourceId}
          onChange={(e) => setSourceId(e.target.value)}
          className="rounded-lg px-3 py-2.5 text-sm outline-none sm:w-44"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
            color: "var(--cream-dim)",
          }}
        >
          <option value="">全部来源</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.displayName || s.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg px-6 py-2.5 text-sm font-display font-semibold tap sm:w-28"
          style={{ background: "var(--ember)", color: "var(--ink)" }}
        >
          搜索
        </button>
      </form>

      {loading && progress.total > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="font-mono text-[11px] text-cream-faint">
              搜索中 {progress.done}/{progress.total} 个来源
            </span>
          </div>
          <div className="h-1 rounded-full bg-ink-2 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                background: "var(--ember)",
              }}
            />
          </div>
        </div>
      )}

      {loading && results.length === 0 ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div
                className="aspect-[3/4] rounded-lg animate-pulse"
                style={{ background: "var(--ink-2)" }}
              />
              <div
                className="h-3 w-3/4 rounded animate-pulse"
                style={{ background: "var(--ink-2)" }}
              />
            </div>
          ))}
        </div>
      ) : error && results.length === 0 ? (
        <p className="text-sm text-ember">{error}</p>
      ) : results.length === 0 && !loading ? (
        <EmptyState
          icon={<IconSearch size={48} />}
          title={searched ? "没有找到相关漫画" : "输入关键词开始搜索"}
        />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {results.map((item) => (
            <MangaCover
              key={`${item.sourceId}:${item.id}`}
              cover={item.cover}
              title={item.title}
              onClick={() =>
                navigate(
                  `/manga/detail/${encodeURIComponent(item.sourceId)}/${encodeURIComponent(item.id)}?title=${encodeURIComponent(item.title)}&cover=${encodeURIComponent(item.cover)}&sourceName=${encodeURIComponent(item.sourceName)}&description=${encodeURIComponent(item.description || "")}&author=${encodeURIComponent(item.author || "")}&status=${encodeURIComponent(item.status || "")}`
                )
              }
            />
          ))}
        </div>
      )}
    </PageShell>
  );
}

// ─── 详情 ───────────────────────────────
function MangaDetailView() {
  const navigate = useNavigate();
  const { sourceId = "", mangaId = "" } = useParams();
  const [params] = useSearchParams();
  const config = useMangaStore((s) => s.config);
  const isOnShelf = useMangaStore((s) => s.isOnShelf);
  const toggleShelf = useMangaStore((s) => s.toggleShelf);
  const getHistory = useMangaStore((s) => s.getHistory);
  const [detail, setDetail] = useState<MangaDetail | null>(null);
  const [error, setError] = useState("");
  const [descOrder, setDescOrder] = useState(true);

  const onShelf = isOnShelf(sourceId, mangaId);
  const record = getHistory(sourceId, mangaId);

  useEffect(() => {
    if (!sourceId || !mangaId) return;
    setError("");
    getMangaDetail(config, {
      sourceId,
      mangaId,
      title: params.get("title") || undefined,
      cover: params.get("cover") || undefined,
      sourceName: params.get("sourceName") || undefined,
      description: params.get("description") || undefined,
      author: params.get("author") || undefined,
      status: params.get("status") || undefined,
    })
      .then(setDetail)
      .catch((e) => setError((e as Error).message));
  }, [config, sourceId, mangaId, params]);

  const chapters = useMemo(() => {
    const list = detail?.chapters || [];
    return [...list].sort((a, b) => {
      const diff = (a.chapterNumber || 0) - (b.chapterNumber || 0);
      return descOrder ? -diff : diff;
    });
  }, [detail?.chapters, descOrder]);

  const openChapter = (chapter: MangaChapter) => {
    if (!detail) return;
    navigate(
      `/manga/reader/${encodeURIComponent(sourceId)}/${encodeURIComponent(mangaId)}/${encodeURIComponent(chapter.id)}?title=${encodeURIComponent(detail.title)}&cover=${encodeURIComponent(detail.cover)}&sourceName=${encodeURIComponent(detail.sourceName)}&chapterName=${encodeURIComponent(chapter.name)}`
    );
  };

  const handleShelf = () => {
    if (!detail) return;
    const item: MangaShelfItem = {
      sourceId: detail.sourceId,
      sourceName: detail.sourceName,
      mangaId: detail.id,
      title: detail.title,
      cover: detail.cover,
      description: detail.description,
      author: detail.author,
      status: detail.status,
      saveTime: Date.now(),
    };
    toggleShelf(item);
  };

  const continueChapter =
    record &&
    (detail?.chapters.find((c) => c.id === record.chapterId) ||
      chapters[chapters.length - 1]);

  return (
    <PageShell
      title={detail?.title || params.get("title") || "漫画详情"}
      eyebrow="MANGA · DETAIL"
      onBack={() => navigate(-1)}
    >
      {error ? (
        <p className="text-sm text-ember">{error}</p>
      ) : !detail ? (
        <p className="text-sm text-cream-faint">加载中…</p>
      ) : (
        <div className="space-y-5">
          <div className="flex gap-4">
            <div className="w-28 sm:w-36 shrink-0">
              <div
                className="aspect-[3/4] rounded-lg overflow-hidden"
                style={{
                  background: "var(--ink-2)",
                  border: "1px solid var(--cream-line)",
                }}
              >
                {detail.cover && (
                  <img
                    src={detail.cover}
                    alt={detail.title}
                    className="w-full h-full object-cover"
                  />
                )}
              </div>
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <h2 className="font-display font-bold text-lg text-cream leading-tight">
                {detail.title}
              </h2>
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {detail.author && (
                  <span className="chip-ch">{detail.author}</span>
                )}
                {detail.status && (
                  <span className="chip-ch">{detail.status}</span>
                )}
                <span className="chip-ch">{detail.sourceName}</span>
              </div>
              {detail.description && (
                <p className="text-xs text-cream-faint leading-relaxed line-clamp-5">
                  {detail.description}
                </p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                {continueChapter && (
                  <button
                    type="button"
                    onClick={() => openChapter(continueChapter)}
                    className="px-4 py-2 rounded-lg text-sm font-display font-semibold tap"
                    style={{ background: "var(--ember)", color: "var(--ink)" }}
                  >
                    {record ? "继续阅读" : "开始阅读"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleShelf}
                  className="px-4 py-2 rounded-lg text-sm font-display font-semibold tap flex items-center gap-1.5"
                  style={{
                    background: "var(--ink-2)",
                    border: "1px solid var(--cream-line)",
                    color: onShelf ? "var(--ember)" : "var(--cream-dim)",
                  }}
                >
                  {onShelf ? (
                    <IconBookmarkFill size={16} />
                  ) : (
                    <IconBookmark size={16} />
                  )}
                  {onShelf ? "已在书架" : "加入书架"}
                </button>
              </div>
            </div>
          </div>

          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-display font-bold text-sm text-cream">
                章节 ({detail.chapters.length})
              </h3>
              <button
                type="button"
                onClick={() => setDescOrder((v) => !v)}
                className="flex items-center gap-1 text-xs text-cream-dim tap"
              >
                {descOrder ? (
                  <IconChevronDown size={14} />
                ) : (
                  <IconChevronUp size={14} />
                )}
                {descOrder ? "倒序" : "正序"}
              </button>
            </div>
            <div className="space-y-1">
              {chapters.map((chapter) => {
                const isCurrent = record?.chapterId === chapter.id;
                return (
                  <button
                    key={chapter.id}
                    type="button"
                    onClick={() => openChapter(chapter)}
                    className="w-full text-left px-3 py-2.5 rounded-lg tap flex items-center justify-between gap-2"
                    style={{
                      background: isCurrent
                        ? "var(--ember-soft)"
                        : "var(--ink-2)",
                      border: "1px solid var(--cream-line)",
                    }}
                  >
                    <span
                      className="text-sm line-clamp-1"
                      style={{
                        color: isCurrent ? "var(--ember)" : "var(--cream-dim)",
                      }}
                    >
                      {chapter.name}
                    </span>
                    {chapter.scanlator && (
                      <span className="text-[10px] text-cream-faint shrink-0">
                        {chapter.scanlator}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </PageShell>
  );
}

// ─── 阅读器（4 模式 + 缩放 + 预取 + 章节抽屉 + 完成弹窗）──────
const PRELOAD_PAGE_COUNT = 5;
const SAVE_INTERVAL_MS = 10000;

function sortChapters(list: MangaChapter[]): MangaChapter[] {
  return [...list].sort(
    (a, b) =>
      (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0) ||
      (a.uploadDate ?? 0) - (b.uploadDate ?? 0)
  );
}

function MangaReader() {
  const navigate = useNavigate();
  const { sourceId = "", mangaId = "", chapterId = "" } = useParams();
  const [params] = useSearchParams();
  const config = useMangaStore((s) => s.config);
  const upsertHistory = useMangaStore((s) => s.upsertHistory);
  const readerSettings = useMangaStore((s) => s.readerSettings);
  const setReaderSettings = useMangaStore((s) => s.setReaderSettings);
  const { readMode, scaleMode, pageGap } = readerSettings;

  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activePage, setActivePage] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chapterListOpen, setChapterListOpen] = useState(false);
  const [chapterListDesc, setChapterListDesc] = useState(false);
  const [chapters, setChapters] = useState<MangaChapter[]>([]);
  const [showComplete, setShowComplete] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const horizontalRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const preloadedRef = useRef<Set<string>>(new Set());
  const activeChapterRef = useRef<HTMLAnchorElement>(null);
  const restoredRef = useRef("");
  const prevModeRef = useRef(readMode);

  const title = params.get("title") || "漫画阅读";
  const cover = params.get("cover") || "";
  const sourceName = params.get("sourceName") || sourceId;
  const chapterName = params.get("chapterName") || "章节";

  // getMangaChapterPages 返回的 URL 已在 suwayomi.ts buildImageUrl 里过了 dyproxy 代理,
  // 这里不能再包一层(buildProxyUrl 非幂等,二次编码会把整个 dyproxy URL 当上游 → 404)。
  // 章节页 + 章节列表(供抽屉/换章/完成弹窗)
  useEffect(() => {
    setLoading(true);
    setError("");
    setPages([]);
    setActivePage(0);
    preloadedRef.current.clear();
    restoredRef.current = "";
    getMangaChapterPages(config, chapterId)
      .then((list) => {
        setPages(list);
        if (list.length === 0) setError("该章节没有可显示的页面");
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [config, chapterId]);

  useEffect(() => {
    getMangaChapters(config, mangaId)
      .then(setChapters)
      .catch(() => setChapters([]));
  }, [config, mangaId]);

  const orderedChapters = useMemo(() => {
    const asc = sortChapters(chapters);
    return chapterListDesc ? [...asc].reverse() : asc;
  }, [chapters, chapterListDesc]);

  const nextChapter = useMemo(() => {
    const asc = sortChapters(chapters);
    const idx = asc.findIndex((c) => c.id === chapterId);
    return idx >= 0 && idx + 1 < asc.length ? asc[idx + 1] : undefined;
  }, [chapters, chapterId]);

  const gotoChapter = useCallback(
    (ch: MangaChapter | undefined) => {
      if (!ch) return;
      const sp = new URLSearchParams();
      sp.set("title", title);
      if (cover) sp.set("cover", cover);
      sp.set("sourceName", sourceName);
      sp.set("chapterName", ch.name);
      setShowComplete(false);
      navigate(
        `/manga/reader/${sourceId}/${mangaId}/${encodeURIComponent(ch.id)}?${sp.toString()}`
      );
    },
    [navigate, sourceId, mangaId, title, cover, sourceName]
  );

  // 保存阅读进度：debounce + 定时 + pagehide/visibilitychange
  const recordRef = useRef<MangaReadRecord | null>(null);
  useEffect(() => {
    if (pages.length === 0) return;
    recordRef.current = {
      sourceId,
      sourceName,
      mangaId,
      chapterId,
      chapterName,
      title,
      cover,
      pageIndex: activePage,
      pageCount: pages.length,
      saveTime: Date.now(),
    };
    const t = window.setTimeout(() => {
      if (recordRef.current) upsertHistory(recordRef.current);
    }, 500);
    return () => window.clearTimeout(t);
  }, [
    activePage,
    pages.length,
    sourceId,
    sourceName,
    mangaId,
    chapterId,
    chapterName,
    title,
    cover,
    upsertHistory,
  ]);

  useEffect(() => {
    const flush = () => {
      if (recordRef.current) upsertHistory(recordRef.current);
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const id = window.setInterval(flush, SAVE_INTERVAL_MS);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [upsertHistory]);

  // 恢复上次页码(同章节)
  useEffect(() => {
    if (pages.length === 0) return;
    const key = `${sourceId}:${mangaId}:${chapterId}`;
    if (restoredRef.current === key) return;
    restoredRef.current = key;
    const record = useMangaStore.getState().getHistory(sourceId, mangaId);
    if (!record || record.chapterId !== chapterId) return;
    const target = Math.min(Math.max(record.pageIndex, 0), pages.length - 1);
    if (target <= 0) return;
    setActivePage(target);
    window.setTimeout(() => {
      if (readMode === "vertical") {
        pageRefs.current[target]?.scrollIntoView({ block: "start" });
      } else if (readMode === "horizontal") {
        const c = horizontalRef.current;
        if (c) c.scrollTo({ left: c.clientWidth * target, behavior: "auto" });
      }
    }, 0);
  }, [pages.length, sourceId, mangaId, chapterId, readMode]);

  // 主动预取 current+1..+5
  useEffect(() => {
    if (pages.length === 0) return;
    const targets = pages.slice(activePage + 1, activePage + 1 + PRELOAD_PAGE_COUNT);
    for (const src of targets) {
      if (!src || preloadedRef.current.has(src)) continue;
      const img = new window.Image();
      img.decoding = "async";
      img.src = src;
      preloadedRef.current.add(src);
    }
  }, [activePage, pages]);

  // 模式切换后重新锚定到当前页
  useEffect(() => {
    if (prevModeRef.current === readMode) return;
    prevModeRef.current = readMode;
    window.setTimeout(() => {
      if (readMode === "vertical") {
        pageRefs.current[activePage]?.scrollIntoView({ block: "start" });
      } else if (readMode === "horizontal") {
        const c = horizontalRef.current;
        if (c) c.scrollTo({ left: c.clientWidth * activePage, behavior: "auto" });
      }
    }, 0);
  }, [readMode, activePage]);

  const onVerticalScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    let current = 0;
    for (let i = 0; i < pageRefs.current.length; i++) {
      const rect = pageRefs.current[i]?.getBoundingClientRect();
      if (rect && rect.top <= 120) current = i;
    }
    setActivePage(current);
  }, []);

  const onHorizontalScroll = useCallback(() => {
    const c = horizontalRef.current;
    if (!c || c.clientWidth === 0) return;
    setActivePage(Math.round(c.scrollLeft / c.clientWidth));
  }, []);

  const isPaged = readMode === "single" || readMode === "double";

  const atEnd = useCallback(() => {
    if (readMode === "double") return activePage >= pages.length - 2;
    return activePage >= pages.length - 1;
  }, [readMode, activePage, pages.length]);

  const goNext = useCallback(() => {
    if (atEnd()) {
      if (nextChapter) setShowComplete(true);
      return;
    }
    const step = readMode === "double" ? 2 : 1;
    if (isPaged) {
      setActivePage((p) => Math.min(p + step, pages.length - 1));
    } else if (readMode === "horizontal") {
      const c = horizontalRef.current;
      if (c) c.scrollTo({ left: c.clientWidth * (activePage + 1), behavior: "smooth" });
    } else {
      window.scrollBy({ top: window.innerHeight * 0.85, behavior: "smooth" });
    }
  }, [atEnd, nextChapter, readMode, isPaged, pages.length, activePage]);

  const goPrev = useCallback(() => {
    const step = readMode === "double" ? 2 : 1;
    if (isPaged) {
      setActivePage((p) => Math.max(p - step, 0));
    } else if (readMode === "horizontal") {
      const c = horizontalRef.current;
      if (c) c.scrollTo({ left: c.clientWidth * (activePage - 1), behavior: "smooth" });
    } else {
      window.scrollBy({ top: -window.innerHeight * 0.85, behavior: "smooth" });
    }
  }, [readMode, isPaged, activePage]);

  // tap 区域:左 1/3 上一页,右 1/3 下一页,中间切控件(垂直模式只切控件)
  const onReaderClick = useCallback(
    (e: React.MouseEvent) => {
      if (readMode === "vertical") {
        setControlsVisible((v) => !v);
        return;
      }
      const w = e.currentTarget.clientWidth;
      const x = e.clientX;
      if (x < w / 3) goPrev();
      else if (x > (w * 2) / 3) goNext();
      else setControlsVisible((v) => !v);
    },
    [readMode, goPrev, goNext]
  );

  const imageClass =
    scaleMode === "original"
      ? "block mx-auto h-auto w-auto max-w-none"
      : isPaged
        ? "block h-auto w-full object-contain sm:mx-auto sm:max-h-[calc(100dvh-6rem)] sm:w-auto sm:max-w-full"
        : "block h-auto w-full object-contain";

  const pagedItems =
    readMode === "single"
      ? pages.slice(activePage, activePage + 1)
      : readMode === "double"
        ? pages.slice(activePage, activePage + 2)
        : [];

  const loadStrategy = (i: number): "eager" | "lazy" =>
    i >= activePage - 1 && i <= activePage + PRELOAD_PAGE_COUNT ? "eager" : "lazy";

  const progress =
    pages.length > 0 ? Math.round(((activePage + 1) / pages.length) * 100) : 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-ink text-cream relative">
      {controlsVisible && (
        <div
          className="shrink-0 flex items-center gap-3 px-4 pt-4 pb-3 z-10"
          style={{ borderBottom: "1px solid var(--cream-line)" }}
        >
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="w-9 h-9 flex items-center justify-center rounded-full shrink-0 tap text-cream"
            style={{
              background: "var(--ink-2)",
              border: "1px solid var(--cream-line)",
            }}
            aria-label="返回"
          >
            <IconArrowLeft size={16} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint line-clamp-1">
              {title}
            </p>
            <h1 className="font-display text-base font-bold line-clamp-1">
              {chapterName}
            </h1>
          </div>
          <button
            type="button"
            onClick={() => setChapterListOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-full shrink-0 tap text-cream"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            aria-label="章节列表"
          >
            <IconList size={16} />
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-full shrink-0 tap text-cream"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            aria-label="阅读设置"
          >
            <IconSettings size={16} />
          </button>
          {pages.length > 0 && (
            <span className="font-mono text-xs text-cream-dim shrink-0">
              {activePage + 1}/{pages.length}
            </span>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-cream-faint text-sm">
          加载中…
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-ember">{error}</p>
        </div>
      ) : readMode === "vertical" ? (
        <div
          ref={scrollRef}
          onScroll={onVerticalScroll}
          onClick={onReaderClick}
          className="flex-1 min-h-0 overflow-y-auto"
        >
          <div className="flex flex-col items-center" style={{ gap: `${pageGap}px` }}>
            {pages.map((src, i) => (
              <div
                key={i}
                ref={(el) => (pageRefs.current[i] = el)}
                className="w-full max-w-3xl"
              >
                <img
                  src={src}
                  alt={`第 ${i + 1} 页`}
                  loading={loadStrategy(i)}
                  onLoad={onVerticalScroll}
                  className={imageClass}
                />
              </div>
            ))}
          </div>
        </div>
      ) : readMode === "horizontal" ? (
        <div
          ref={horizontalRef}
          onScroll={onHorizontalScroll}
          onClick={onReaderClick}
          className="flex-1 min-h-0 flex overflow-x-auto snap-x snap-mandatory scrollbar-hide"
          style={{ gap: `${pageGap}px` }}
        >
          {pages.map((src, i) => (
            <div key={i} className="min-w-full snap-center flex items-center justify-center">
              <img
                src={src}
                alt={`第 ${i + 1} 页`}
                loading={loadStrategy(i)}
                className={imageClass}
              />
            </div>
          ))}
        </div>
      ) : (
        <div
          onClick={onReaderClick}
          className="flex-1 min-h-0 overflow-y-auto"
        >
          <div
            className={`min-h-full grid ${readMode === "double" ? "md:grid-cols-2" : "grid-cols-1"} items-center justify-center`}
            style={{ gap: `${pageGap}px` }}
          >
            {pagedItems.map((src, i) => (
              <img
                key={activePage + i}
                src={src}
                alt={`第 ${activePage + i + 1} 页`}
                className={imageClass}
              />
            ))}
            {readMode === "double" && pagedItems.length === 1 && <div />}
          </div>
        </div>
      )}

      {/* 右侧进度条 */}
      {!loading && !error && pages.length > 0 && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 h-32 w-1 rounded-full bg-ink-2 overflow-hidden pointer-events-none">
          <div
            className="w-full rounded-full"
            style={{ height: `${progress}%`, background: "var(--ember)" }}
          />
        </div>
      )}

      {/* 章节完成弹窗 */}
      {showComplete && nextChapter && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 animate-fade-in">
          <div
            className="mx-6 max-w-sm rounded-2xl p-6 text-center bg-ink-2"
            style={{ border: "1px solid var(--cream-line)" }}
          >
            <p className="font-display text-base font-bold mb-1">本话看完了</p>
            <p className="text-sm text-cream-dim mb-4 line-clamp-1">
              下一话：{nextChapter.name}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowComplete(false)}
                className="flex-1 rounded-lg py-2.5 text-sm tap text-cream-dim"
                style={{ background: "var(--ink)", border: "1px solid var(--cream-line)" }}
              >
                继续看本话
              </button>
              <button
                type="button"
                onClick={() => gotoChapter(nextChapter)}
                className="flex-1 rounded-lg py-2.5 text-sm tap glow-ember"
                style={{ background: "var(--ember)", color: "var(--ink)" }}
              >
                下一话
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 章节列表抽屉 */}
      <Sheet
        open={chapterListOpen}
        onClose={() => setChapterListOpen(false)}
        side="right"
        title="章节目录"
        headerActions={
          <button
            type="button"
            onClick={() => setChapterListDesc((d) => !d)}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs tap text-cream-dim shrink-0"
            style={{ background: "var(--ink)", border: "1px solid var(--cream-line)" }}
          >
            {chapterListDesc ? <IconChevronDown size={13} /> : <IconChevronUp size={13} />}
            {chapterListDesc ? "倒序" : "正序"}
          </button>
        }
      >
        <div className="py-2">
          {orderedChapters.map((ch) => {
            const active = ch.id === chapterId;
            return (
              <a
                key={ch.id}
                ref={active ? activeChapterRef : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  gotoChapter(ch);
                  setChapterListOpen(false);
                }}
                href="#"
                className="block px-4 py-2.5 text-sm tap line-clamp-1"
                style={{
                  color: active ? "var(--ember)" : "var(--cream-dim)",
                  background: active ? "var(--ember-soft)" : "transparent",
                }}
              >
                {ch.name}
              </a>
            );
          })}
        </div>
      </Sheet>

      {/* 设置面板 */}
      <Sheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        side="bottom"
        title="阅读设置"
      >
        <div className="p-4 space-y-5">
          <div>
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
              阅读模式
            </p>
            <div className="grid grid-cols-4 gap-2">
              {(
                [
                  ["vertical", "垂直"],
                  ["horizontal", "水平"],
                  ["single", "单页"],
                  ["double", "双页"],
                ] as [MangaReadMode, string][]
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setReaderSettings({ readMode: mode })}
                  className="rounded-lg py-2 text-xs tap"
                  style={{
                    background: readMode === mode ? "var(--ember)" : "var(--ink)",
                    color: readMode === mode ? "var(--ink)" : "var(--cream-dim)",
                    border: "1px solid var(--cream-line)",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
              缩放
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["fit", "适配屏幕"],
                  ["original", "原始大小"],
                ] as [MangaScaleMode, string][]
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setReaderSettings({ scaleMode: mode })}
                  className="rounded-lg py-2 text-xs tap"
                  style={{
                    background: scaleMode === mode ? "var(--ember)" : "var(--ink)",
                    color: scaleMode === mode ? "var(--ink)" : "var(--cream-dim)",
                    border: "1px solid var(--cream-line)",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
              页间距 {pageGap}px
            </p>
            <input
              type="range"
              min={0}
              max={48}
              step={2}
              value={pageGap}
              onChange={(e) => setReaderSettings({ pageGap: Number(e.target.value) })}
              className="w-full accent-ember"
            />
          </div>
        </div>
      </Sheet>
    </div>
  );
}
