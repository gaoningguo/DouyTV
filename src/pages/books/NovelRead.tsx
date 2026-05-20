/**
 * 网络小说阅读编排页 —— /books/novel/read/:bookId/:chapterIndex
 *
 * 这层职责：
 *  - 用 bookId 找源 → 拉详情 / 章节列表（若 nav state 没传）
 *  - 拉当前章节正文
 *  - 持久化进度 / 同步书架最后阅读
 *  - 渲染 TextReader 组件（书签 / TTS / 主题 / 翻页 等全在 TextReader 内部）
 *  - 渲染目录抽屉
 *
 * 来自 NovelDetail 的 navigate 应传 state: { book, chapters }，避免再次拉详情。
 */
import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useNovelSourceStore } from "@/stores/novelsource";
import { getBookInfo, getChapterContent, getToc } from "@/lib/booksources/runtime";
import type { NovelBook, NovelChapter } from "@/lib/booksources/types";
import { IconChevronRight } from "@/components/Icon";
import TextReader from "@/components/Reader/TextReader";

interface NavState {
  book?: NovelBook;
  chapters?: NovelChapter[];
}

export default function NovelRead() {
  const { bookId: bookIdEnc = "", chapterIndex = "0" } = useParams();
  const bookId = decodeURIComponent(bookIdEnc);
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state as NavState | null) ?? {};

  const sources = useNovelSourceStore((s) => s.sources);
  const saveProgress = useNovelSourceStore((s) => s.saveProgress);
  const updateShelfRead = useNovelSourceStore((s) => s.addToShelf);
  const shelfList = useNovelSourceStore((s) => s.shelf);
  const hydrate = useNovelSourceStore((s) => s.hydrate);
  const bookmarks = useNovelSourceStore((s) => s.getBookmarks(bookId));
  const addBookmark = useNovelSourceStore((s) => s.addBookmark);
  const removeBookmark = useNovelSourceStore((s) => s.removeBookmark);
  const saveReplaceRegex = useNovelSourceStore((s) => s.saveReplaceRegex);

  const [sourceId, ...rest] = bookId.split("::");
  const bookUrl = rest.join("::");
  const source = sources.find((s) => s.id === sourceId);

  const [book, setBook] = useState<NovelBook | null>(navState.book ?? null);
  const [chapters, setChapters] = useState<NovelChapter[]>(
    navState.chapters ?? []
  );
  const [idx, setIdx] = useState(parseInt(chapterIndex, 10) || 0);
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showToc, setShowToc] = useState(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // 若没传 chapters，重新拉一次
  useEffect(() => {
    if (!source) return;
    if (chapters.length > 0) return;
    (async () => {
      try {
        let b = book;
        let tocUrl = bookUrl;
        if (!b) {
          const r = await getBookInfo(source, bookUrl);
          b = r.book;
          tocUrl = r.tocUrl;
          setBook(b);
        }
        const list = await getToc(source, tocUrl);
        setChapters(list);
      } catch (e) {
        setError((e as Error).message ?? String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.id, bookUrl]);

  // 加载当前章节正文
  const loadContent = useCallback(
    async (i: number) => {
      if (!source || !chapters[i]) return;
      setLoading(true);
      setError(null);
      setContent("");
      try {
        const text = await getChapterContent(source, chapters[i].url);
        setContent(text);
        saveProgress({
          bookId,
          chapterIndex: i,
          scrollRatio: 0,
          updatedAt: Date.now(),
        });
        const onShelf = shelfList.find((s) => s.id === bookId);
        if (onShelf) {
          updateShelfRead({
            ...onShelf,
            lastReadChapterIndex: i,
            lastReadChapterTitle: chapters[i].title,
            lastReadAt: Date.now(),
          });
        }
      } catch (e) {
        setError((e as Error).message ?? String(e));
      } finally {
        setLoading(false);
      }
    },
    [source, chapters, bookId, shelfList, saveProgress, updateShelfRead]
  );

  useEffect(() => {
    if (chapters.length === 0) return;
    void loadContent(idx);
  }, [idx, chapters.length, loadContent]);

  if (!source) {
    return (
      <div className="min-h-screen bg-ink text-cream p-4 flex items-center justify-center">
        <p className="text-cream-faint text-sm">书源不存在</p>
      </div>
    );
  }

  const goPrev = () => idx > 0 && setIdx(idx - 1);
  const goNext = () => idx < chapters.length - 1 && setIdx(idx + 1);

  return (
    <>
      <TextReader
        bookId={bookId}
        bookTitle={book?.name ?? "—"}
        chapterTitle={chapters[idx]?.title ?? "…"}
        chapterIndex={idx}
        totalChapters={chapters.length}
        content={content}
        loading={loading}
        error={error}
        bookmarks={bookmarks}
        replaceRegex={source.ruleContent?.replaceRegex ?? ""}
        onBack={() => navigate(-1)}
        onOpenToc={() => setShowToc(true)}
        onPrevChapter={goPrev}
        onNextChapter={goNext}
        onAddBookmark={addBookmark}
        onRemoveBookmark={(id) => removeBookmark(bookId, id)}
        onSaveReplaceRegex={(rule) => saveReplaceRegex(source.id, rule)}
      />

      {/* 目录抽屉 —— 沿用现有样式（ink theme），点击章节切换 */}
      {showToc && (
        <div
          className="fixed inset-0 z-30 flex justify-end"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setShowToc(false)}
        >
          <div
            className="w-80 max-w-full h-full overflow-y-auto p-4 bg-ink"
            style={{ borderLeft: "1px solid var(--cream-line)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
              CHAPTERS · {chapters.length}
            </p>
            <ul className="space-y-0.5">
              {chapters.map((c, i) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setIdx(i);
                      setShowToc(false);
                    }}
                    className="w-full text-left px-2 py-1.5 rounded text-[12px] tap flex items-center text-cream"
                    style={{
                      background:
                        i === idx ? "rgba(255,107,53,0.15)" : "transparent",
                      color: i === idx ? "var(--ember)" : undefined,
                    }}
                  >
                    <span className="flex-1 truncate">{c.title}</span>
                    {i === idx && <IconChevronRight size={12} />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
