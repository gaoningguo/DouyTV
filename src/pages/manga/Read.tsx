/**
 * 漫画长条流阅读器。
 * 一次性渲染整个章节的所有图，IntersectionObserver 跟踪当前可见图 → 保存进度。
 * 滑到底部自动跳下一章。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useMangaStore } from "@/stores/manga";
import { getChapterPages, getMangaDetail } from "@/lib/manga/client";
import type { MangaDetail } from "@/lib/manga/types";
import { IconArrowLeft } from "@/components/Icon";

interface NavState {
  chapterName?: string;
  detail?: MangaDetail;
}

export default function MangaRead() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sourceId = "", mangaId = "", chapterId = "" } = useParams<{
    sourceId: string;
    mangaId: string;
    chapterId: string;
  }>();
  const store = useMangaStore();
  const hydrate = useMangaStore((s) => s.hydrate);
  const nav = (location.state || {}) as NavState;

  const [pages, setPages] = useState<string[]>([]);
  const [detail, setDetail] = useState<MangaDetail | undefined>(nav.detail);
  const [chapterName, setChapterName] = useState<string>(nav.chapterName ?? "");
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // 加载章节图
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPages([]);
    setPageIndex(0);
    try {
      // 没有 detail 时先拉一次，方便底部跳下一章
      if (!detail) {
        try {
          const d = await getMangaDetail(mangaId);
          setDetail(d);
          if (!chapterName) {
            const c = d.chapters.find((x) => x.id === chapterId);
            if (c) setChapterName(c.name);
          }
        } catch {
          /* 详情拉失败不影响图片加载 */
        }
      }
      const urls = await getChapterPages(chapterId);
      setPages(urls);
      // 恢复上次进度
      const h = store.getHistory(sourceId, mangaId, chapterId);
      if (h && h.pageIndex > 0 && h.pageIndex < urls.length) {
        // 等图片渲染后再 scroll
        setTimeout(() => {
          const el = containerRef.current?.querySelector<HTMLElement>(
            `[data-page-idx="${h.pageIndex}"]`
          );
          el?.scrollIntoView({ behavior: "auto", block: "start" });
        }, 300);
      }
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterId, mangaId, sourceId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 进度跟踪
  useEffect(() => {
    const container = containerRef.current;
    if (!container || pages.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const idx = Number((e.target as HTMLElement).dataset.pageIdx);
            if (!Number.isNaN(idx)) {
              setPageIndex(idx);
            }
          }
        }
      },
      { root: container, rootMargin: "-30% 0px -30% 0px", threshold: 0 }
    );
    container
      .querySelectorAll<HTMLElement>("[data-page-idx]")
      .forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [pages]);

  // 节流保存历史
  useEffect(() => {
    if (pages.length === 0) return;
    const t = window.setTimeout(() => {
      void store.saveHistory({
        sourceId,
        mangaId,
        chapterId,
        chapterName,
        pageIndex,
        pageCount: pages.length,
      });
      if (chapterName) {
        void store.updateShelfLastChapter(sourceId, mangaId, chapterId, chapterName);
      }
    }, 800);
    return () => window.clearTimeout(t);
  }, [pageIndex, pages.length, sourceId, mangaId, chapterId, chapterName, store]);

  // 跳下一章
  const gotoNextChapter = useCallback(() => {
    if (!detail) return;
    const idx = detail.chapters.findIndex((c) => c.id === chapterId);
    if (idx < 0) return;
    // Suwayomi 的章节通常按 number 倒序返回；"下一章"是 idx-1（更新的章）
    const next = detail.chapters[idx - 1] || detail.chapters[idx + 1];
    if (!next) return;
    navigate(
      `/manga/read/${encodeURIComponent(sourceId)}/${encodeURIComponent(mangaId)}/${encodeURIComponent(next.id)}`,
      {
        replace: true,
        state: { chapterName: next.name, detail },
      }
    );
  }, [detail, chapterId, navigate, sourceId, mangaId]);

  return (
    <div className="h-screen w-screen bg-ink text-cream relative">
      {/* 顶部控件 */}
      <div
        className="absolute z-20 flex items-center gap-2"
        style={{
          top: "calc(env(safe-area-inset-top) + 16px)",
          left: "calc(env(safe-area-inset-left) + 16px)",
          right: "calc(env(safe-area-inset-right) + 16px)",
        }}
      >
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-full backdrop-blur-md tap"
          style={{
            background: "rgba(14,15,17,0.6)",
            border: "1px solid var(--cream-line)",
            color: "var(--cream)",
          }}
          aria-label="返回"
        >
          <IconArrowLeft size={16} />
        </button>
        <div
          className="flex-1 px-3 py-1.5 rounded-full backdrop-blur-md text-xs font-display font-semibold line-clamp-1"
          style={{
            background: "rgba(14,15,17,0.6)",
            border: "1px solid var(--cream-line)",
            color: "var(--cream)",
          }}
        >
          {chapterName || "章节"}
        </div>
        {pages.length > 0 && (
          <div
            className="px-3 py-1.5 rounded-full backdrop-blur-md text-xs font-mono"
            style={{
              background: "rgba(14,15,17,0.6)",
              border: "1px solid var(--cream-line)",
              color: "var(--cream-dim)",
            }}
          >
            {pageIndex + 1}/{pages.length}
          </div>
        )}
      </div>

      <div
        ref={containerRef}
        className="absolute inset-0 overflow-y-auto pt-16"
      >
        {error && (
          <p
            className="m-4 p-3 rounded text-xs font-mono"
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
          <div className="flex justify-center py-10">
            <div className="signal-bars" style={{ height: 22 }}>
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        ) : (
          <>
            {pages.map((u, i) => (
              <div
                key={`${i}-${u}`}
                data-page-idx={i}
                className="w-full flex justify-center"
              >
                <img
                  src={u}
                  alt={`page ${i + 1}`}
                  loading="lazy"
                  className="max-w-full h-auto block"
                />
              </div>
            ))}
            {/* 章末跳转 */}
            <div className="p-6 text-center">
              {detail ? (
                <button
                  type="button"
                  onClick={gotoNextChapter}
                  className="px-6 py-3 rounded-full text-sm font-display font-semibold tap glow-ember"
                  style={{ background: "var(--ember)", color: "var(--ink)" }}
                >
                  下一章 →
                </button>
              ) : (
                <p className="text-[11px] text-cream-faint">已到本章末尾</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
