import { useCallback, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useBooksStore } from "@/stores/books";
import { searchBooks } from "@/lib/books/client";
import type { BookListItem } from "@/lib/books/types";
import { IconArrowLeft, IconBook, IconSearch } from "@/components/Icon";
import { CoverCard } from "@/components/CoverCard";
import { MediaGrid } from "@/components/MediaGrid";
import { EmptyState } from "@/components/EmptyState";

export default function BooksSearch() {
  const navigate = useNavigate();
  const { sourceId = "" } = useParams<{ sourceId: string }>();
  const store = useBooksStore();
  const source = store.sources.find((s) => s.id === sourceId);

  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<BookListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doSearch = useCallback(async () => {
    if (!source || !keyword.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const r = await searchBooks(source, keyword.trim());
      setResults(r.results);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [source, keyword]);

  if (!source) {
    return (
      <div className="min-h-screen bg-ink text-cream p-4 flex items-center justify-center">
        <p className="text-sm text-cream-dim">未找到此书源</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink text-cream p-4">
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
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
            BOOKS · SEARCH
          </p>
          <h1 className="font-display text-xl font-extrabold tracking-tight line-clamp-1">
            {source.name}
          </h1>
        </div>
      </div>

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
            placeholder="搜索书名 / 作者"
            className="flex-1 bg-transparent outline-none text-sm text-cream placeholder:text-cream-faint"
          />
        </div>
        <button
          type="button"
          onClick={() => void doSearch()}
          disabled={loading}
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
          icon={<IconBook size={48} />}
          title={keyword ? "暂无搜索结果" : "输入关键词开始搜索"}
          subtitle={keyword ? "换个关键词试试" : undefined}
        />
      ) : (
        <MediaGrid>
          {results.map((b) => (
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
      )}
    </div>
  );
}
