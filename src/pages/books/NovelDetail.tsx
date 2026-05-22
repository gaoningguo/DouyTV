/**
 * 小说详情 + 章节列表。
 * URL: /books/novel/detail/:sourceId/:bookUrl  (bookUrl 是 encodeURIComponent)
 *
 * 增强：自动尝试在其它启用源里搜同名书，提供"换源"下拉。
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useNovelSourceStore } from "@/stores/novelsource";
import { getBookInfo, getToc, searchBooks } from "@/lib/booksources/runtime";
import type { NovelBook, NovelChapter, NovelShelfItem } from "@/lib/booksources/types";
import {
  IconHeart,
  IconHeartFill,
  IconRefresh,
} from "@/components/Icon";
import { DetailHero, MetaChip } from "@/components/DetailHero";

interface NavState {
  book?: NovelBook;
}

export default function NovelDetail() {
  const { sourceId = "", bookUrl: bookUrlEnc = "" } = useParams();
  const bookUrl = decodeURIComponent(bookUrlEnc);
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state as NavState | null) ?? {};

  const sources = useNovelSourceStore((s) => s.sources);
  const addToShelf = useNovelSourceStore((s) => s.addToShelf);
  const removeFromShelf = useNovelSourceStore((s) => s.removeFromShelf);
  const isOnShelf = useNovelSourceStore((s) => s.isOnShelf);
  const getProgress = useNovelSourceStore((s) => s.getProgress);
  const hydrate = useNovelSourceStore((s) => s.hydrate);

  const source = sources.find((s) => s.id === sourceId);
  const [book, setBook] = useState<NovelBook | null>(navState.book ?? null);
  const [tocUrl, setTocUrl] = useState<string>("");
  const [chapters, setChapters] = useState<NovelChapter[]>([]);
  const [loadingBook, setLoadingBook] = useState(false);
  const [loadingToc, setLoadingToc] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const loadBookAndToc = useCallback(async () => {
    if (!source) return;
    setError(null);
    if (!book) {
      setLoadingBook(true);
      try {
        const { book: info, tocUrl: toc } = await getBookInfo(source, bookUrl);
        setBook(info);
        setTocUrl(toc);
      } catch (e) {
        setError((e as Error).message ?? String(e));
        setLoadingBook(false);
        return;
      } finally {
        setLoadingBook(false);
      }
    }
    const useTocUrl = tocUrl || bookUrl;
    setLoadingToc(true);
    try {
      const list = await getToc(source, useTocUrl);
      setChapters(list);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setLoadingToc(false);
    }
  }, [source, book, tocUrl, bookUrl]);

  useEffect(() => {
    void loadBookAndToc();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.id, bookUrl]);

  /* ─────── 同名换源 ─────── */
  const [altSources, setAltSources] = useState<
    Array<{ srcId: string; srcName: string; bookUrl: string }>
  >([]);
  const [altLoading, setAltLoading] = useState(false);
  const [showAltMenu, setShowAltMenu] = useState(false);

  useEffect(() => {
    if (!book) return;
    const otherSources = sources.filter(
      (s) => s.enabled && s.id !== sourceId
    );
    if (otherSources.length === 0) return;
    setAltLoading(true);
    setAltSources([]);
    let cancelled = false;
    (async () => {
      const results: typeof altSources = [];
      await Promise.allSettled(
        otherSources.map(async (s) => {
          try {
            const list = await searchBooks(s, book.name, 1);
            // 优先取作者匹配的；否则取第一条
            const match =
              list.find(
                (b) =>
                  b.name === book.name &&
                  (!book.author || !b.author || b.author === book.author)
              ) ?? list[0];
            if (match) {
              results.push({
                srcId: s.id,
                srcName: s.bookSourceName,
                bookUrl: match.url,
              });
            }
          } catch {
            /* ignore single source */
          }
        })
      );
      if (!cancelled) {
        setAltSources(results);
        setAltLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book?.name, book?.author, sourceId]);

  if (!source) {
    return (
      <div className="min-h-screen bg-ink text-cream p-4 flex items-center justify-center">
        <p className="text-cream-faint text-sm">书源不存在 · 已被删除</p>
      </div>
    );
  }

  const bookId = book?.id ?? `${sourceId}::${bookUrl}`;
  const onShelf = isOnShelf(bookId);
  const progress = getProgress(bookId);

  const toggleShelf = () => {
    if (!book) return;
    if (onShelf) {
      removeFromShelf(bookId);
    } else {
      const item: NovelShelfItem = {
        ...book,
        savedAt: Date.now(),
      };
      addToShelf(item);
    }
  };

  return (
    <div className="min-h-screen bg-ink text-cream p-4">
      {loadingBook && !book && (
        <p className="text-cream-faint text-sm">读取详情中…</p>
      )}

      {book && (
        <DetailHero
          cover={book.cover}
          title={book.name}
          subtitle={book.author ?? "—"}
          onBack={() => navigate(-1)}
          metaChips={
            <>
              <MetaChip>{source.bookSourceName}</MetaChip>
              {book.kind && <MetaChip>{book.kind}</MetaChip>}
              {onShelf && <MetaChip color="ember">已在书架</MetaChip>}
              {progress && (
                <MetaChip color="phosphor">
                  已读 {progress.chapterIndex + 1} 章
                </MetaChip>
              )}
            </>
          }
          description={book.intro}
          actions={
            <>
              <button
                type="button"
                onClick={toggleShelf}
                className="px-3 py-2 rounded-lg text-[12px] font-display font-semibold tap inline-flex items-center gap-1.5"
                style={{
                  background: onShelf ? "var(--ember-soft)" : "var(--ember)",
                  color: onShelf ? "var(--ember)" : "var(--ink)",
                  border: `1px solid ${
                    onShelf ? "rgba(255,107,53,0.4)" : "var(--ember)"
                  }`,
                }}
              >
                {onShelf ? (
                  <>
                    <IconHeartFill size={12} />
                    已加入书架
                  </>
                ) : (
                  <>
                    <IconHeart size={12} />
                    加入书架
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => void loadBookAndToc()}
                className="px-3 py-2 rounded-lg text-[12px] tap text-cream inline-flex items-center gap-1.5"
                style={{
                  background: "var(--ink-2)",
                  border: "1px solid var(--cream-line)",
                }}
              >
                <IconRefresh size={12} />
                刷新
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowAltMenu((v) => !v)}
                  disabled={!book || altSources.length === 0}
                  className="px-3 py-2 rounded-lg text-[12px] tap text-cream disabled:opacity-40"
                  style={{
                    background: "var(--ink-2)",
                    border: "1px solid var(--cream-line)",
                  }}
                  title="同名换源"
                >
                  换源
                  {altLoading
                    ? " …"
                    : altSources.length > 0
                      ? ` · ${altSources.length}`
                      : ""}
                </button>
                {showAltMenu && altSources.length > 0 && (
                  <ul
                    className="absolute right-0 top-full mt-1 z-20 min-w-[180px] max-h-72 overflow-y-auto rounded-lg p-1"
                    style={{
                      background: "var(--ink-2)",
                      border: "1px solid var(--cream-line)",
                    }}
                  >
                    {altSources.map((a) => (
                      <li key={a.srcId}>
                        <button
                          type="button"
                          onClick={() => {
                            setShowAltMenu(false);
                            navigate(
                              `/books/novel/detail/${a.srcId}/${encodeURIComponent(a.bookUrl)}`,
                              { replace: true }
                            );
                          }}
                          className="w-full text-left px-2 py-1 text-[11px] rounded tap text-cream hover:bg-white/5"
                        >
                          {a.srcName}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          }
        />
      )}

      {error && (
        <p
          className="p-2 rounded text-[11px] font-mono mb-3"
          style={{
            background: "rgba(255,80,80,0.08)",
            color: "#FF6B6B",
            border: "1px solid rgba(255,80,80,0.25)",
          }}
        >
          ✗ {error}
        </p>
      )}

      <section>
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
          CHAPTERS · {chapters.length}
          {loadingToc && " · 加载中…"}
        </p>
        <ul className="space-y-0.5 max-h-[60vh] overflow-y-auto">
          {chapters.map((c) => {
            const isCurrent = progress?.chapterIndex === c.index;
            return (
              <li key={c.id}>
                <Link
                  to={`/books/novel/read/${encodeURIComponent(bookId)}/${c.index}`}
                  state={{ book, chapters }}
                  className="block px-3 py-2 rounded text-[12px] tap"
                  style={{
                    background: isCurrent ? "var(--ember-soft)" : "transparent",
                    color: isCurrent ? "var(--ember)" : "var(--cream)",
                    border: `1px solid ${
                      isCurrent ? "rgba(255,107,53,0.3)" : "transparent"
                    }`,
                  }}
                >
                  {c.title}
                  {c.isVip && (
                    <span className="ml-2 text-[9px] font-mono text-cream-faint">VIP</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
