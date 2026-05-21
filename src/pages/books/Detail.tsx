import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useBooksStore } from "@/stores/books";
import type { BookListItem } from "@/lib/books/types";
import { wrapImage } from "@/lib/proxy";
import { IconHeart, IconHeartFill } from "@/components/Icon";
import { DetailHero, MetaChip } from "@/components/DetailHero";

export default function BooksDetail() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sourceId = "", bookId = "" } = useParams<{ sourceId: string; bookId: string }>();
  const store = useBooksStore();
  const hydrate = useBooksStore((s) => s.hydrate);

  // 优先用从列表页 state 传入的 BookListItem（OPDS 没有标准的「by-id」detail，
  // 所以我们直接复用列表里已经拿到的元数据）
  const fromState = (location.state || undefined) as BookListItem | undefined;
  const shelfMatch = store.shelf.find(
    (b) => b.sourceId === sourceId && b.bookId === bookId
  );

  const [item] = useState<BookListItem | undefined>(() => {
    if (fromState && fromState.id === bookId) return fromState;
    if (shelfMatch) {
      return {
        id: shelfMatch.bookId,
        sourceId: shelfMatch.sourceId,
        sourceName: shelfMatch.title,
        title: shelfMatch.title,
        author: shelfMatch.author,
        cover: shelfMatch.cover,
        summary: shelfMatch.summary,
        acquisitionLinks: shelfMatch.acquisitionLinks,
      };
    }
    return undefined;
  });

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (!item) {
    return (
      <div className="min-h-screen bg-ink text-cream p-4 flex flex-col items-center justify-center">
        <p className="text-sm text-cream-dim mb-3">没有缓存的书籍元数据</p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="px-4 py-2 rounded-full text-xs tap text-cream"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
        >
          返回
        </button>
      </div>
    );
  }

  const epubLink = item.acquisitionLinks.find((l) =>
    l.type.toLowerCase().includes("epub")
  );
  const pdfLink = item.acquisitionLinks.find((l) =>
    l.type.toLowerCase().includes("pdf")
  );
  const isOnShelf = store.isOnShelf(sourceId, bookId);
  const progress = store.getProgress(sourceId, bookId);

  return (
    <div className="min-h-screen bg-ink text-cream p-4 pb-24">
      <DetailHero
        cover={item.cover}
        proxyCover
        title={item.title}
        subtitle={item.author}
        onBack={() => navigate(-1)}
        metaChips={
          <>
            {item.language && <MetaChip>{item.language}</MetaChip>}
            {progress && (
              <MetaChip color="ember">
                已读 {Math.round(progress.percent * 100)}%
              </MetaChip>
            )}
          </>
        }
        description={item.summary}
        actions={
          <>
            {epubLink && (
              <Link
                to={`/books/read/${encodeURIComponent(sourceId)}/${encodeURIComponent(bookId)}`}
                state={item}
                className="flex-1 min-w-[140px] text-center py-2.5 rounded-lg text-sm font-display font-semibold tap"
                style={{ background: "var(--ember)", color: "var(--ink)" }}
              >
                {progress ? "继续阅读" : "开始阅读"}
              </Link>
            )}
            {!epubLink && pdfLink && (
              <a
                href={wrapImage(pdfLink.href) || pdfLink.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 min-w-[140px] text-center py-2.5 rounded-lg text-sm font-display font-semibold tap text-cream"
                style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
              >
                下载 PDF
              </a>
            )}
            <button
              type="button"
              onClick={() => {
                if (isOnShelf) void store.removeFromShelf(sourceId, bookId);
                else void store.addToShelf(item);
              }}
              className="w-12 h-11 flex items-center justify-center rounded-lg tap"
              style={{
                background: isOnShelf ? "var(--ember-soft)" : "var(--ink-2)",
                border: `1px solid ${
                  isOnShelf ? "var(--ember)" : "var(--cream-line)"
                }`,
                color: isOnShelf ? "var(--ember)" : "var(--cream)",
              }}
              aria-label={isOnShelf ? "移出书架" : "加入书架"}
            >
              {isOnShelf ? <IconHeartFill size={16} /> : <IconHeart size={16} />}
            </button>
          </>
        }
      />

      {!epubLink && !pdfLink && (
        <p className="text-[11px] text-cream-faint text-center mt-4">
          此条目没有提供 EPUB / PDF 下载链接
        </p>
      )}
    </div>
  );
}
