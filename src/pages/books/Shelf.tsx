import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useBooksStore } from "@/stores/books";
import { IconArrowLeft, IconBook } from "@/components/Icon";
import { CoverCard } from "@/components/CoverCard";
import { MediaGrid } from "@/components/MediaGrid";
import { EmptyState } from "@/components/EmptyState";

export default function BooksShelf() {
  const navigate = useNavigate();
  const store = useBooksStore();
  const hydrate = useBooksStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

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
        <div className="flex-1">
          <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
            BOOKS · SHELF · {store.shelf.length}
          </p>
          <h1 className="font-display text-xl font-extrabold tracking-tight">我的书架</h1>
        </div>
      </div>

      {store.shelf.length === 0 ? (
        <EmptyState
          icon={<IconBook size={48} />}
          title="书架为空"
          subtitle="去发现 / 探索找几本喜欢的书加入"
        />
      ) : (
        <MediaGrid>
          {store.shelf.map((b) => {
            const progress = store.getProgress(b.sourceId, b.bookId);
            return (
              <CoverCard
                key={`${b.sourceId}-${b.bookId}`}
                cover={b.cover}
                title={b.title}
                subtitle={b.author}
                proxyCover
                bottomBadge={
                  progress
                    ? `${Math.round(progress.percent * 100)}%`
                    : undefined
                }
                onClick={() =>
                  navigate(
                    `/books/detail/${encodeURIComponent(b.sourceId)}/${encodeURIComponent(b.bookId)}`,
                    {
                      state: {
                        id: b.bookId,
                        sourceId: b.sourceId,
                        sourceName: "",
                        title: b.title,
                        author: b.author,
                        cover: b.cover,
                        summary: b.summary,
                        acquisitionLinks: b.acquisitionLinks,
                      },
                    }
                  )
                }
              />
            );
          })}
        </MediaGrid>
      )}
    </div>
  );
}
