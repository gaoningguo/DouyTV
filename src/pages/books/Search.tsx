import { useCallback, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useBooksStore } from "@/stores/books";
import { searchBooks } from "@/lib/books/client";
import type { BookListItem } from "@/lib/books/types";
import { wrapImage } from "@/lib/proxy";
import { IconArrowLeft, IconBook, IconSearch } from "@/components/Icon";

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

      <ul className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {results.map((b) => {
          const cover = wrapImage(b.cover);
          return (
            <li key={b.id}>
              <Link
                to={`/books/detail/${encodeURIComponent(sourceId)}/${encodeURIComponent(b.id)}`}
                state={b}
                className="block rounded-lg overflow-hidden tap"
                style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
              >
                {cover ? (
                  <img
                    src={cover}
                    alt={b.title}
                    loading="lazy"
                    className="w-full aspect-[2/3] object-cover"
                  />
                ) : (
                  <div className="w-full aspect-[2/3] flex items-center justify-center bg-ink-3">
                    <IconBook size={32} className="text-cream-faint" />
                  </div>
                )}
                <div className="p-2">
                  <p className="text-xs font-display font-semibold line-clamp-2">{b.title}</p>
                  {b.author && (
                    <p className="text-[10px] text-cream-faint mt-1 line-clamp-1">{b.author}</p>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
