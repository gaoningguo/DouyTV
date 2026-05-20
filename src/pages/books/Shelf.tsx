import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useBooksStore } from "@/stores/books";
import { wrapImage } from "@/lib/proxy";
import { IconArrowLeft, IconBook } from "@/components/Icon";

export default function BooksShelf() {
  const navigate = useNavigate();
  const store = useBooksStore();
  const hydrate = useBooksStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

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
            BOOKS · SHELF · {store.shelf.length}
          </p>
          <h1 className="font-display text-xl font-extrabold tracking-tight">我的书架</h1>
        </div>
      </div>

      {store.shelf.length === 0 ? (
        <p className="text-[11px] text-cream-faint text-center py-12">书架为空</p>
      ) : (
        <ul className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {store.shelf.map((b) => {
            const cover = wrapImage(b.cover);
            const progress = store.getProgress(b.sourceId, b.bookId);
            return (
              <li key={`${b.sourceId}-${b.bookId}`}>
                <Link
                  to={`/books/detail/${encodeURIComponent(b.sourceId)}/${encodeURIComponent(b.bookId)}`}
                  state={{
                    id: b.bookId,
                    sourceId: b.sourceId,
                    sourceName: "",
                    title: b.title,
                    author: b.author,
                    cover: b.cover,
                    summary: b.summary,
                    acquisitionLinks: b.acquisitionLinks,
                  }}
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
                    {progress && (
                      <p className="text-[10px] font-mono mt-1" style={{ color: "var(--ember)" }}>
                        {Math.round(progress.percent * 100)}%
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
