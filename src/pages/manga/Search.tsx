import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMangaStore } from "@/stores/manga";
import { getSources, searchManga } from "@/lib/manga/client";
import type { MangaSearchItem, MangaSource } from "@/lib/manga/types";
import { IconArrowLeft, IconManga, IconSearch } from "@/components/Icon";
import { CoverCard } from "@/components/CoverCard";
import { MediaGrid } from "@/components/MediaGrid";
import { EmptyState } from "@/components/EmptyState";

export default function MangaSearch() {
  const navigate = useNavigate();
  const store = useMangaStore();
  const hydrate = useMangaStore((s) => s.hydrate);

  const [sources, setSources] = useState<MangaSource[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<MangaSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!store.hydrated) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await getSources("zh");
        if (cancelled) return;
        setSources(s);
        if (s.length > 0) setSourceId(s[0].id);
      } catch (e) {
        if (!cancelled) setError((e as Error).message ?? String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store.hydrated]);

  const doSearch = useCallback(async () => {
    const src = sources.find((s) => s.id === sourceId);
    if (!src || !keyword.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const r = await searchManga(src, keyword.trim(), 1);
      setResults(r.mangas);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [sources, sourceId, keyword]);

  return (
    <div className="min-h-screen bg-ink text-cream p-4 pb-24">
      <div className="flex items-center gap-3 mb-5">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          aria-label="返回"
        >
          <IconArrowLeft size={16} />
        </button>
        <div className="flex-1">
          <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
            MANGA · SEARCH
          </p>
          <h1 className="font-display text-xl font-extrabold tracking-tight">搜索漫画</h1>
        </div>
      </div>

      {sources.length > 0 && (
        <div className="flex gap-1 overflow-x-auto no-scrollbar mb-3 pb-1">
          {sources.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSourceId(s.id)}
              className="px-3 py-1.5 rounded-md text-[11px] font-display font-semibold whitespace-nowrap tap shrink-0"
              style={{
                background: sourceId === s.id ? "var(--ember)" : "var(--ink-3)",
                color: sourceId === s.id ? "var(--ink)" : "var(--cream-dim)",
                border: "1px solid var(--cream-line)",
              }}
            >
              {s.displayName || s.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <div
          className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
        >
          <IconSearch size={14} className="text-cream-faint shrink-0" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void doSearch();
            }}
            placeholder="搜索漫画"
            className="flex-1 bg-transparent outline-none text-sm text-cream placeholder:text-cream-faint"
          />
        </div>
        <button
          type="button"
          onClick={() => void doSearch()}
          disabled={loading || !sourceId}
          className="px-4 py-2 rounded-lg text-xs font-display font-semibold tap disabled:opacity-50"
          style={{ background: "var(--ember)", color: "var(--ink)" }}
        >
          {loading ? "搜索中" : "搜索"}
        </button>
      </div>

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

      {results.length === 0 && !loading && !error ? (
        <EmptyState
          icon={<IconManga size={48} />}
          title={keyword ? "暂无搜索结果" : "输入关键词开始搜索"}
          subtitle={keyword ? "换个关键词试试" : undefined}
        />
      ) : (
        <MediaGrid>
          {results.map((m) => (
            <CoverCard
              key={`${m.sourceId}-${m.id}`}
              cover={m.cover}
              title={m.title}
              onClick={() =>
                navigate(
                  `/manga/detail/${encodeURIComponent(m.sourceId)}/${encodeURIComponent(m.id)}`,
                  { state: m }
                )
              }
            />
          ))}
        </MediaGrid>
      )}
    </div>
  );
}
