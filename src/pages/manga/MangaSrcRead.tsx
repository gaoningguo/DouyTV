/**
 * 漫画阅读编排页 —— /manga/src/read/:mangaId/:chapterIndex
 *
 * 这层职责：
 *  - 用 mangaId 找源 → 拉详情 / 章节列表（若 nav state 没传）
 *  - 拉当前章节的图片 URL（getMangaPages）+ 缓存到 store.pageCache
 *  - 预拉下一章 URL 列表 → 传给 ImageReader 做预下载
 *  - 持久化进度 / 同步书架最后阅读
 *  - 渲染 ImageReader（vertical / ltr / rtl / 双页 / tap zones 都在内部）
 *  - 渲染目录抽屉
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useMangaSourceStore } from "@/stores/mangasource";
import {
  getMangaChapters,
  getMangaDetail,
  getMangaPages,
} from "@/lib/mangasources/runtime";
import type { MangaChapter, MangaDetail } from "@/lib/mangasources/types";
import { wrapImage } from "@/lib/proxy";
import ImageReader from "@/components/Reader/ImageReader";

interface NavState {
  detail?: MangaDetail;
  chapters?: MangaChapter[];
}

export default function MangaSrcRead() {
  const { mangaId: mangaIdEnc = "", chapterIndex = "0" } = useParams();
  const mangaId = decodeURIComponent(mangaIdEnc);
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state as NavState | null) ?? {};

  const sources = useMangaSourceStore((s) => s.sources);
  const saveProgress = useMangaSourceStore((s) => s.saveProgress);
  const addToShelf = useMangaSourceStore((s) => s.addToShelf);
  const shelfList = useMangaSourceStore((s) => s.shelf);
  const hydrate = useMangaSourceStore((s) => s.hydrate);
  const cachePages = useMangaSourceStore((s) => s.cachePages);
  const getCachedPages = useMangaSourceStore((s) => s.getCachedPages);
  const noteChapterCount = useMangaSourceStore((s) => s.noteChapterCount);

  const [sourceId, ...rest] = mangaId.split("::");
  const mangaUrl = rest.join("::");
  const source = sources.find((s) => s.id === sourceId);

  const [detail, setDetail] = useState<MangaDetail | null>(
    navState.detail ?? null
  );
  const [chapters, setChapters] = useState<MangaChapter[]>(
    navState.chapters ?? []
  );
  const [idx, setIdx] = useState(parseInt(chapterIndex, 10) || 0);
  const [pages, setPages] = useState<string[]>([]);
  const [nextPages, setNextPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showToc, setShowToc] = useState(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // 初始：未有 chapters 时重新拉
  useEffect(() => {
    if (!source) return;
    if (chapters.length > 0) return;
    (async () => {
      try {
        let d = detail;
        if (!d) {
          d = await getMangaDetail(source, mangaUrl);
          setDetail(d);
        }
        const cs = await getMangaChapters(source, d.chaptersUrl);
        setChapters(cs);
        noteChapterCount(mangaId, cs.length);
      } catch (e) {
        setError((e as Error).message ?? String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.id, mangaUrl]);

  const loadPages = useCallback(
    async (i: number) => {
      if (!source || !chapters[i]) return;
      setLoading(true);
      setError(null);
      setPages([]);
      try {
        const chapterId = chapters[i].id;
        let list = getCachedPages(chapterId);
        if (!list) {
          list = await getMangaPages(source, chapters[i].url);
          cachePages(chapterId, list);
        }
        setPages(list);
        saveProgress({
          mangaId,
          chapterIndex: i,
          pageIndex: 0,
          pageCount: list.length,
          updatedAt: Date.now(),
        });
        const onShelf = shelfList.find((s) => s.id === mangaId);
        if (onShelf) {
          addToShelf({
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
    [
      source,
      chapters,
      mangaId,
      shelfList,
      saveProgress,
      addToShelf,
      cachePages,
      getCachedPages,
    ]
  );

  useEffect(() => {
    if (chapters.length === 0) return;
    void loadPages(idx);
    // 预加载下一章 URL 列表（不拉图片字节）
    setNextPages([]);
    const next = idx + 1;
    if (source && chapters[next]) {
      const nid = chapters[next].id;
      const cached = getCachedPages(nid);
      if (cached) {
        setNextPages(cached);
      } else {
        getMangaPages(source, chapters[next].url)
          .then((list) => {
            cachePages(nid, list);
            setNextPages(list);
          })
          .catch(() => {
            /* preload 失败不打扰 */
          });
      }
    }
  }, [idx, chapters.length, loadPages, source, chapters, cachePages, getCachedPages]);

  const imgUrls = useMemo(
    () =>
      pages
        .map((p) => wrapImage(p))
        .filter((u): u is string => !!u),
    [pages]
  );
  const nextImgUrls = useMemo(
    () =>
      nextPages
        .map((p) => wrapImage(p))
        .filter((u): u is string => !!u),
    [nextPages]
  );

  if (!source) {
    return (
      <div className="min-h-screen bg-ink text-cream p-4 flex items-center justify-center">
        <p className="text-cream-faint text-sm">源不存在</p>
      </div>
    );
  }

  const goPrev = () => idx > 0 && setIdx(idx - 1);
  const goNext = () => idx < chapters.length - 1 && setIdx(idx + 1);

  return (
    <>
      <ImageReader
        imgUrls={imgUrls}
        nextImgUrls={nextImgUrls}
        mangaTitle={detail?.name ?? "—"}
        chapterTitle={chapters[idx]?.title ?? "…"}
        chapterIndex={idx}
        totalChapters={chapters.length}
        loading={loading}
        error={error}
        onBack={() => navigate(-1)}
        onOpenToc={() => setShowToc(true)}
        onPrevChapter={goPrev}
        onNextChapter={goNext}
        onPositionChange={(pageIdx, pageCount) => {
          // 仅更新当前章节的页码进度
          saveProgress({
            mangaId,
            chapterIndex: idx,
            pageIndex: pageIdx,
            pageCount,
            updatedAt: Date.now(),
          });
        }}
      />

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
                    className="w-full text-left px-2 py-1.5 rounded text-[12px] tap"
                    style={{
                      background:
                        i === idx ? "var(--ember-soft)" : "transparent",
                      color: i === idx ? "var(--ember)" : "var(--cream)",
                    }}
                  >
                    {c.title}
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
