import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useBooksStore } from "@/stores/books";
import { fetchCatalog } from "@/lib/books/client";
import type { BookCatalogResult } from "@/lib/books/types";
import { IconArrowLeft } from "@/components/Icon";
import { CoverCard } from "@/components/CoverCard";
import { MediaGrid } from "@/components/MediaGrid";

export default function BooksCatalog() {
  const navigate = useNavigate();
  const { sourceId = "" } = useParams<{ sourceId: string }>();
  const [sp] = useSearchParams();
  const href = sp.get("href") || undefined;

  const store = useBooksStore();
  const hydrate = useBooksStore((s) => s.hydrate);
  const [catalog, setCatalog] = useState<BookCatalogResult | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const source = store.sources.find((s) => s.id === sourceId);

  const load = useCallback(async () => {
    if (!source) return;
    setLoading(true);
    setError(null);
    try {
      const c = await fetchCatalog(source, href);
      setCatalog(c);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [source, href]);

  useEffect(() => {
    if (store.hydrated) void load();
  }, [store.hydrated, load]);

  if (!source) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center bg-ink text-cream p-4">
        <p className="text-sm text-cream-dim">未找到此书源</p>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-ink text-cream">
      <div
        className="shrink-0 flex items-center gap-3 px-4 pt-4 pb-3"
        style={{ borderBottom: "1px solid var(--cream-line)" }}
      >
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          aria-label="返回"
        >
          <IconArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
            BOOKS · {source.name}
          </p>
          <h1 className="font-display text-xl font-extrabold tracking-tight line-clamp-1">
            {catalog?.title || "目录"}
          </h1>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4">

      {error && (
        <p
          className="p-2 rounded text-xs font-mono mb-3"
          style={{
            background: "rgba(255,80,80,0.08)",
            color: "#FF6B6B",
            border: "1px solid rgba(255,80,80,0.25)",
          }}
        >
          {error}
        </p>
      )}

      {loading ? (
        <div className="signal-bars" style={{ height: 22 }}>
          <span></span>
          <span></span>
          <span></span>
        </div>
      ) : catalog ? (
        <>
          {/* 子导航 */}
          {catalog.navigation.length > 0 && (
            <>
              <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-3">
                NAVIGATE
              </p>
              <ul className="space-y-1.5 mb-5">
                {catalog.navigation.map((n, i) => (
                  <li key={`${n.href}-${i}`}>
                    <Link
                      to={`/books/catalog/${encodeURIComponent(sourceId)}?href=${encodeURIComponent(n.href)}`}
                      className="block p-3 rounded-lg text-xs font-display font-semibold tap"
                      style={{
                        background: "var(--ink-2)",
                        border: "1px solid var(--cream-line)",
                      }}
                    >
                      {n.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* 书籍 */}
          {catalog.entries.length > 0 && (
            <>
              <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-3">
                BOOKS · {catalog.entries.length}
              </p>
              <MediaGrid className="mb-5">
                {catalog.entries.map((b) => (
                  <CoverCard
                    key={b.id}
                    cover={b.cover}
                    title={b.title}
                    subtitle={b.author}
                    proxyCover
                    onClick={() =>
                      navigate(
                        `/books/detail/${encodeURIComponent(sourceId)}/${encodeURIComponent(b.id)}`,
                        { state: b }
                      )
                    }
                  />
                ))}
              </MediaGrid>
            </>
          )}

          {/* 分页 */}
          {(catalog.previousHref || catalog.nextHref) && (
            <div className="flex gap-2 mt-4">
              {catalog.previousHref && (
                <Link
                  to={`/books/catalog/${encodeURIComponent(sourceId)}?href=${encodeURIComponent(catalog.previousHref)}`}
                  className="flex-1 text-center py-2 rounded-lg text-xs tap text-cream"
                  style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
                >
                  ← 上一页
                </Link>
              )}
              {catalog.nextHref && (
                <Link
                  to={`/books/catalog/${encodeURIComponent(sourceId)}?href=${encodeURIComponent(catalog.nextHref)}`}
                  className="flex-1 text-center py-2 rounded-lg text-xs font-display font-semibold tap"
                  style={{ background: "var(--ember)", color: "var(--ink)" }}
                >
                  下一页 →
                </Link>
              )}
            </div>
          )}
        </>
      ) : null}
      </div>
    </div>
  );
}
