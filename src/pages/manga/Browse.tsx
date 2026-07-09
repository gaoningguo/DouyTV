import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";
import { IconArrowLeft, IconManga } from "@/components/Icon";
import {
  getMangaSources,
  getRecommendedManga,
  type MangaSearchItem,
  type MangaSource,
} from "@/lib/manga";
import { useMangaStore } from "@/stores/manga";
import type { MangaRecommendType } from "@/lib/manga/types";

// 漫画「源站寻书」页 —— 单源浏览:源 chips → 热门/最新 tab → 封面网格 → 加载更多。
// 首页是全源聚合信息流(只读第一页),这里给需要深挖单源的用户翻页浏览。
// 数据走 getRecommendedManga(带 hasNextPage 分页,封面已代理)。

function MangaBrowseCover({
  cover,
  title,
  onClick,
}: {
  cover?: string;
  title: string;
  onClick: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <button type="button" onClick={onClick} className="group text-left w-full tap">
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
      </div>
      <p className="mt-1.5 text-xs font-display font-semibold line-clamp-2 text-cream-dim group-hover:text-cream">
        {title}
      </p>
    </button>
  );
}

export default function MangaBrowse() {
  const navigate = useNavigate();
  const config = useMangaStore((s) => s.config);

  const [sources, setSources] = useState<MangaSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [recType, setRecType] = useState<MangaRecommendType>("POPULAR");

  const [items, setItems] = useState<MangaSearchItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const reqRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const seenRef = useRef<Set<string>>(new Set());

  // 首屏(切源 / 切类型)
  useEffect(() => {
    if (!selectedSourceId) return;
    const token = ++reqRef.current;
    setLoading(true);
    setError("");
    setItems([]);
    setPage(1);
    setHasNext(false);
    seenRef.current = new Set();
    getRecommendedManga(config, selectedSourceId, recType, 1)
      .then((res) => {
        if (token !== reqRef.current) return;
        const fresh = res.mangas.filter((m) => {
          const key = `${m.sourceId}:${m.id}`;
          if (seenRef.current.has(key)) return false;
          seenRef.current.add(key);
          return true;
        });
        setItems(fresh);
        setHasNext(res.hasNextPage);
      })
      .catch((e) => {
        if (token === reqRef.current) setError((e as Error).message);
      })
      .finally(() => {
        if (token === reqRef.current) setLoading(false);
      });
  }, [config, selectedSourceId, recType]);

  const loadMore = useCallback(async () => {
    if (!hasNext || loadingMore || loading || !selectedSourceId) return;
    const token = reqRef.current;
    const next = page + 1;
    setLoadingMore(true);
    try {
      const res = await getRecommendedManga(config, selectedSourceId, recType, next);
      if (token !== reqRef.current) return;
      const fresh = res.mangas.filter((m) => {
        const key = `${m.sourceId}:${m.id}`;
        if (seenRef.current.has(key)) return false;
        seenRef.current.add(key);
        return true;
      });
      setItems((prev) => [...prev, ...fresh]);
      setHasNext(res.hasNextPage);
      setPage(next);
    } catch {
      setHasNext(false);
    } finally {
      if (token === reqRef.current) setLoadingMore(false);
    }
  }, [config, hasNext, loadingMore, loading, selectedSourceId, recType, page]);

  useEffect(() => {
    let alive = true;
    getMangaSources(config)
      .then((list) => {
        if (!alive) return;
        setSources(list);
        setSourcesLoading(false);
        if (list.length) setSelectedSourceId((prev) => prev || list[0].id);
      })
      .catch(() => {
        if (alive) setSourcesLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [config]);

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

  const noSources = !sourcesLoading && sources.length === 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-ink text-cream">
      <div
        className="shrink-0 flex items-center gap-3 px-4 pt-4 pb-3"
        style={{ borderBottom: "1px solid var(--cream-line)" }}
      >
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-full shrink-0 tap text-cream"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          aria-label="返回"
        >
          <IconArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
            MANGA · BROWSE
          </p>
          <h1 className="font-display text-xl font-extrabold tracking-tight line-clamp-1">
            源站寻书
          </h1>
        </div>
      </div>

      {/* 源切换 chips */}
      {sources.length > 0 && (
        <div
          className="shrink-0 flex gap-2 px-4 py-2.5 overflow-x-auto scrollbar-hide"
          style={{ borderBottom: "1px solid var(--cream-line)" }}
        >
          {sources.map((s) => {
            const active = s.id === selectedSourceId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedSourceId(s.id)}
                className="shrink-0 rounded-lg px-3 py-2 text-xs font-semibold tap whitespace-nowrap"
                style={{
                  minHeight: 40,
                  background: active ? "var(--ember-soft)" : "var(--ink-2)",
                  color: active ? "var(--ember)" : "var(--cream-dim)",
                  border: `1px solid ${active ? "var(--ember)" : "var(--cream-line)"}`,
                }}
              >
                {s.displayName || s.name}
              </button>
            );
          })}
        </div>
      )}

      {/* 热门 / 最新 */}
      {sources.length > 0 && (
        <div className="shrink-0 flex gap-2 px-4 py-2">
          {(
            [
              ["POPULAR", "热门"],
              ["LATEST", "最新"],
            ] as [MangaRecommendType, string][]
          ).map(([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => setRecType(t)}
              className="rounded-full px-3 py-1.5 text-xs font-display font-semibold tap whitespace-nowrap"
              style={{
                minHeight: 32,
                background: recType === t ? "var(--ember)" : "transparent",
                color: recType === t ? "var(--ink)" : "var(--cream-faint)",
                border: `1px solid ${recType === t ? "var(--ember)" : "var(--cream-line)"}`,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {noSources ? (
          <EmptyState
            icon={<IconManga size={48} />}
            title="没有可用的漫画源"
            subtitle="请先在设置里配置 Suwayomi 服务并确认有可用源。"
          />
        ) : loading && items.length === 0 && !error ? (
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
        ) : error && items.length === 0 ? (
          <p className="text-sm text-ember">{error}</p>
        ) : items.length === 0 ? (
          <EmptyState icon={<IconManga size={48} />} title="该源暂无内容" />
        ) : (
          <>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {items.map((item) => (
                <MangaBrowseCover
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
            <div ref={sentinelRef} className="h-10" />
            {loadingMore && (
              <p className="text-center text-xs text-cream-faint py-3 font-mono">
                加载中…
              </p>
            )}
            {!hasNext && items.length > 0 && (
              <p className="text-center text-xs text-cream-faint py-3 font-mono">
                没有更多了
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
