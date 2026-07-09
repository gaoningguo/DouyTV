import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { IconArrowLeft, IconBook } from "@/components/Icon";
import {
  getBookCatalog,
  getBookSources,
  type BookListItem,
  type BookNavLink,
  type BookSource,
} from "@/lib/book";

// 小说「发现 / 目录」浏览页 —— 移植自 MoonTVPlus catalog。
// 引擎层已就绪(getBookCatalog + getBookSources),此文件只负责 UI:
//   源切换 chips → 分类(navigation)tabs → 封面网格 → IntersectionObserver 无限翻页。
// 数据全部经 book provider(OPDS 导航树 / Legado explore 分类,封面已代理)。

interface BookCatalogProps {
  onBack: () => void;
  onOpenBook: (
    sourceId: string,
    detailHref: string,
    meta?: { title?: string; cover?: string; author?: string }
  ) => void;
}

export default function BookCatalog({
  onBack,
  onOpenBook,
}: BookCatalogProps): JSX.Element {
  const [sources, setSources] = useState<BookSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [selectedSourceId, setSelectedSourceId] = useState("");

  const [navTabs, setNavTabs] = useState<BookNavLink[]>([]);
  const [activeHref, setActiveHref] = useState("");
  const [entries, setEntries] = useState<BookListItem[]>([]);
  const [nextHref, setNextHref] = useState<string | undefined>();
  const [pageSubtitle, setPageSubtitle] = useState<string | undefined>();

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  // 递增 token 忽略过期响应(切源 / 切分类时旧请求可能后返回)。
  const reqRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadCatalog = useCallback(
    async (sid: string, href: string | undefined, resetNav: boolean) => {
      const token = ++reqRef.current;
      setLoading(true);
      setError("");
      setEntries([]);
      try {
        const result = await getBookCatalog(sid, href);
        if (token !== reqRef.current) return;
        if (resetNav) {
          setNavTabs(result.navigation);
          setPageSubtitle(result.subtitle);
          // 自动选中第一个有 href 的分类(导航树根通常无 entries)。
          const firstNav = result.navigation.find((n) => n.href && n.href.trim());
          if (result.entries.length === 0 && firstNav) {
            setActiveHref(firstNav.href);
            void loadCatalog(sid, firstNav.href, false);
            return;
          }
          setActiveHref("");
        }
        setEntries(result.entries);
        setNextHref(result.nextHref);
        setLoading(false);
      } catch (e) {
        if (token !== reqRef.current) return;
        setError((e as Error).message || "加载失败");
        setLoading(false);
      }
    },
    []
  );

  const selectSource = useCallback(
    (sid: string) => {
      setSelectedSourceId(sid);
      setActiveHref("");
      setNavTabs([]);
      setNextHref(undefined);
      setPageSubtitle(undefined);
      void loadCatalog(sid, undefined, true);
    },
    [loadCatalog]
  );

  const selectCategory = useCallback(
    (href: string) => {
      if (href === activeHref) return;
      setActiveHref(href);
      setNextHref(undefined);
      void loadCatalog(selectedSourceId, href || undefined, false);
    },
    [activeHref, selectedSourceId, loadCatalog]
  );

  const loadMore = useCallback(async () => {
    if (!nextHref || loadingMore || loading) return;
    const sid = selectedSourceId;
    const href = nextHref;
    setLoadingMore(true);
    try {
      const result = await getBookCatalog(sid, href);
      setEntries((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...result.entries.filter((e) => !seen.has(e.id))];
      });
      setNextHref(result.nextHref);
    } catch {
      // 翻页失败:停止继续尝试,已加载内容保留。
      setNextHref(undefined);
    } finally {
      setLoadingMore(false);
    }
  }, [nextHref, loadingMore, loading, selectedSourceId]);

  // 初次加载书源列表:仅保留启用且支持目录的源。
  useEffect(() => {
    let alive = true;
    getBookSources()
      .then((list) => {
        if (!alive) return;
        const cat = list.filter(
          (s) => s.enabled !== false && s.capabilities?.catalogSupported !== false
        );
        setSources(cat);
        setSourcesLoading(false);
        if (cat.length) selectSource(cat[0].id);
      })
      .catch(() => {
        if (alive) setSourcesLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [selectSource]);

  // 无限翻页哨兵。nextHref 变化会重建 loadMore,进而重挂 observer。
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (obs) => {
        if (obs[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "400px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  const retry = useCallback(() => {
    void loadCatalog(
      selectedSourceId,
      activeHref || undefined,
      navTabs.length === 0
    );
  }, [loadCatalog, selectedSourceId, activeHref, navTabs.length]);

  const noCatalogSources = !sourcesLoading && sources.length === 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-ink text-cream">
      {/* 头部:eyebrow + 标题 + 返回 */}
      <div
        className="shrink-0 flex items-center gap-3 px-4 pt-4 pb-3"
        style={{ borderBottom: "1px solid var(--cream-line)" }}
      >
        <button
          type="button"
          onClick={onBack}
          className="w-9 h-9 flex items-center justify-center rounded-full shrink-0 tap text-cream"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          aria-label="返回"
        >
          <IconArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
            BOOKS · CATALOG
          </p>
          <h1 className="font-display text-xl font-extrabold tracking-tight line-clamp-1">
            发现
          </h1>
        </div>
      </div>

      {/* 源切换 chips */}
      {sources.length > 0 && (
        <div
          className="shrink-0 flex gap-2 px-4 py-2.5 overflow-x-auto"
          style={{ borderBottom: "1px solid var(--cream-line)" }}
        >
          {sources.map((s) => {
            const active = s.id === selectedSourceId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => selectSource(s.id)}
                className="shrink-0 rounded-lg px-3 py-2 text-xs font-semibold tap whitespace-nowrap"
                style={{
                  minHeight: 40,
                  background: active ? "var(--ember-soft)" : "var(--ink-2)",
                  color: active ? "var(--ember)" : "var(--cream-dim)",
                  border: `1px solid ${active ? "var(--ember)" : "var(--cream-line)"}`,
                }}
              >
                {s.name}
              </button>
            );
          })}
        </div>
      )}

      {/* 分类(navigation)tabs */}
      {navTabs.length > 0 && (
        <div className="shrink-0 flex gap-2 px-4 py-2 overflow-x-auto">
          {navTabs.map((nav) => {
            const active = nav.href === activeHref;
            const disabled = !nav.href || !nav.href.trim();
            return (
              <button
                key={`${nav.href}:${nav.title}`}
                type="button"
                disabled={disabled}
                onClick={() => !disabled && selectCategory(nav.href)}
                className="shrink-0 rounded-full px-3 py-1.5 text-xs tap whitespace-nowrap"
                style={{
                  minHeight: 32,
                  background: active ? "var(--ember)" : "transparent",
                  color: active ? "var(--ink)" : "var(--cream-faint)",
                  border: `1px solid ${active ? "var(--ember)" : "var(--cream-line)"}`,
                  opacity: disabled ? 0.4 : 1,
                }}
              >
                {nav.title}
              </button>
            );
          })}
        </div>
      )}

      {/* 主体 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {noCatalogSources ? (
          <EmptyState
            icon={<IconBook size={48} />}
            title="没有支持目录的书源"
            subtitle="前往书源管理添加支持发现 / 目录浏览的 OPDS 或 Legado 书源。"
          />
        ) : sourcesLoading || (loading && entries.length === 0 && !error) ? (
          <div className="p-4 grid gap-3 grid-cols-3 sm:grid-cols-4 md:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : error ? (
          <div className="p-6">
            <div
              className="rounded-xl p-4 text-center"
              style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            >
              <p className="text-sm text-cream-dim">加载失败</p>
              <p className="text-[11px] font-mono text-cream-faint mt-1 break-all">
                {error}
              </p>
              <button
                type="button"
                onClick={retry}
                className="mt-3 rounded-lg px-4 py-2 text-sm font-semibold tap glow-ember"
                style={{ background: "var(--ember)", color: "var(--ink)" }}
              >
                重试
              </button>
            </div>
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<IconBook size={48} />}
            title="这里没有内容"
            subtitle={pageSubtitle || "换个分类或书源试试。"}
          />
        ) : (
          <>
            {pageSubtitle && (
              <p className="px-4 pt-3 text-[11px] font-mono text-cream-faint line-clamp-1">
                {pageSubtitle}
              </p>
            )}
            <div className="p-4 grid gap-3 grid-cols-3 sm:grid-cols-4 md:grid-cols-6">
              {entries.map((entry) => (
                <CatalogCard
                  key={entry.id}
                  entry={entry}
                  onOpen={() =>
                    onOpenBook(entry.sourceId, entry.detailHref || entry.id, {
                      title: entry.title,
                      cover: entry.cover,
                      author: entry.author,
                    })
                  }
                />
              ))}
            </div>

            {nextHref && (
              <div
                ref={sentinelRef}
                className="py-6 text-center font-mono text-[11px] text-cream-faint"
              >
                {loadingMore ? "加载中…" : ""}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CatalogCard({
  entry,
  onOpen,
}: {
  entry: BookListItem;
  onOpen: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const showCover = entry.cover && !imgError;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left rounded-lg overflow-hidden tap"
      style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
    >
      <div className="aspect-[3/4] relative" style={{ background: "var(--ink)" }}>
        {showCover ? (
          <img
            src={entry.cover}
            alt={entry.title}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-cream-faint">
            <IconBook size={28} />
          </div>
        )}
      </div>
      <div className="p-2">
        <p className="text-xs font-display font-semibold line-clamp-2 text-cream leading-tight">
          {entry.title}
        </p>
        {entry.author && (
          <p className="text-[10px] text-cream-faint line-clamp-1 mt-1">
            {entry.author}
          </p>
        )}
      </div>
    </button>
  );
}

function SkeletonCard() {
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
    >
      <div className="aspect-[3/4] animate-pulse" style={{ background: "var(--ink)" }} />
      <div className="p-2 space-y-1.5">
        <div
          className="h-3 rounded animate-pulse"
          style={{ background: "var(--cream-line)" }}
        />
        <div
          className="h-2.5 w-2/3 rounded animate-pulse"
          style={{ background: "var(--cream-line)" }}
        />
      </div>
    </div>
  );
}
