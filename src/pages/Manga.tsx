import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { appAlert, appConfirm } from "@/components/AppDialog";
import { EmptyState } from "@/components/EmptyState";
import {
  IconArrowLeft,
  IconBookmark,
  IconBookmarkFill,
  IconChevronDown,
  IconChevronUp,
  IconManga,
  IconSearch,
  IconSettings,
} from "@/components/Icon";
import {
  getMangaSources,
  searchManga,
  getMangaDetail,
  getMangaChapterPages,
  getRecommendedManga,
  isMangaConfigured,
  type MangaChapter,
  type MangaDetail,
  type MangaSearchItem,
  type MangaSource,
} from "@/lib/manga";
import { useMangaStore } from "@/stores/manga";
import type { MangaReadRecord, MangaShelfItem } from "@/lib/manga/types";

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
}: {
  cover?: string;
  title: string;
  onClick?: () => void;
  badge?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
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

// ─── 首页 / 书架 + 推荐 ───────────────────────────────
function MangaHome() {
  const navigate = useNavigate();
  const shelf = useMangaStore((s) => s.shelf);
  const config = useMangaStore((s) => s.config);
  const [sources, setSources] = useState<MangaSource[]>([]);
  const [recSourceId, setRecSourceId] = useState("");
  const [recommend, setRecommend] = useState<MangaSearchItem[]>([]);
  const [loadingRec, setLoadingRec] = useState(false);
  const [recError, setRecError] = useState("");

  const configured = isMangaConfigured(config);

  useEffect(() => {
    if (!configured) return;
    getMangaSources(config)
      .then((list) => {
        setSources(list);
        if (list.length > 0) setRecSourceId((prev) => prev || list[0].id);
      })
      .catch(() => undefined);
  }, [config, configured]);

  useEffect(() => {
    if (!configured || !recSourceId) return;
    setLoadingRec(true);
    setRecError("");
    getRecommendedManga(config, recSourceId, "POPULAR", 1)
      .then((res) => setRecommend(res.mangas))
      .catch((e) => setRecError((e as Error).message))
      .finally(() => setLoadingRec(false));
  }, [config, configured, recSourceId]);

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

          <section>
            <div className="flex items-center justify-between mb-3 gap-3">
              <h2 className="font-display font-bold text-sm text-cream">
                热门推荐
              </h2>
              {sources.length > 0 && (
                <select
                  value={recSourceId}
                  onChange={(e) => setRecSourceId(e.target.value)}
                  className="text-xs rounded-lg px-2 py-1.5 outline-none"
                  style={{
                    background: "var(--ink-2)",
                    border: "1px solid var(--cream-line)",
                    color: "var(--cream-dim)",
                  }}
                >
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.displayName || s.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {loadingRec ? (
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
            ) : recError ? (
              <p className="text-sm text-ember">{recError}</p>
            ) : recommend.length === 0 ? (
              <EmptyState
                icon={<IconManga size={48} />}
                title="暂无推荐"
                subtitle="试试切换来源，或直接搜索漫画。"
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

  useEffect(() => {
    getMangaSources(config).then(setSources).catch(() => undefined);
  }, [config]);

  const doSearch = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const q = query.trim();
      if (!q) return;
      setLoading(true);
      setError("");
      setSearched(true);
      try {
        const res = await searchManga(config, q, sourceId || undefined);
        setResults(res.results);
        if (res.results.length === 0 && res.failedSources.length > 0) {
          setError(res.failedSources.map((f) => f.error).join("; "));
        }
      } catch (err) {
        setError((err as Error).message);
        setResults([]);
      } finally {
        setLoading(false);
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

      {loading ? (
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
      ) : results.length === 0 ? (
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

// ─── 阅读器（垂直滚动）───────────────────────────────
function MangaReader() {
  const navigate = useNavigate();
  const { sourceId = "", mangaId = "", chapterId = "" } = useParams();
  const [params] = useSearchParams();
  const config = useMangaStore((s) => s.config);
  const upsertHistory = useMangaStore((s) => s.upsertHistory);
  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activePage, setActivePage] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const title = params.get("title") || "漫画阅读";
  const cover = params.get("cover") || "";
  const sourceName = params.get("sourceName") || sourceId;
  const chapterName = params.get("chapterName") || "章节";

  useEffect(() => {
    setLoading(true);
    setError("");
    setPages([]);
    getMangaChapterPages(config, chapterId)
      .then((list) => {
        setPages(list);
        if (list.length === 0) setError("该章节没有可显示的页面");
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [config, chapterId]);

  // 保存阅读进度（页码变化时）
  useEffect(() => {
    if (pages.length === 0) return;
    const record: MangaReadRecord = {
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
    const t = window.setTimeout(() => upsertHistory(record), 500);
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

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const children = Array.from(el.querySelectorAll("[data-page]"));
    let current = 0;
    for (let i = 0; i < children.length; i++) {
      const rect = (children[i] as HTMLElement).getBoundingClientRect();
      if (rect.top <= 120) current = i;
    }
    setActivePage(current);
  }, []);

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
          {pages.length > 0 && (
            <span className="font-mono text-xs text-cream-dim shrink-0">
              {activePage + 1}/{pages.length}
            </span>
          )}
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        onClick={() => setControlsVisible((v) => !v)}
        className="flex-1 min-h-0 overflow-y-auto"
      >
        {loading ? (
          <div className="flex items-center justify-center h-full text-cream-faint text-sm">
            加载中…
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-ember">{error}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            {pages.map((src, i) => (
              <img
                key={i}
                data-page={i}
                src={src}
                alt={`第 ${i + 1} 页`}
                loading="lazy"
                className="w-full max-w-3xl"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
