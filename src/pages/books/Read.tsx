/**
 * EPUB 阅读器，基于 epub.js。
 *
 * 流程：
 *  1) 从 useLocation().state 拿到 BookListItem
 *  2) 找 epub 类型 acquisition link → downloadAcquisition() 拿 ArrayBuffer
 *  3) ePub(buffer) → book.renderTo(divRef)
 *  4) 监听 relocated → 保存进度（CFI）
 *  5) 加载时若有历史进度，rendition.display(cfi) 跳过去
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import ePub, { type Book, type Rendition } from "epubjs";
import { useBooksStore } from "@/stores/books";
import { downloadAcquisition } from "@/lib/books/client";
import type { BookListItem } from "@/lib/books/types";
import { IconArrowLeft, IconList } from "@/components/Icon";

type Theme = "ink" | "cream" | "phosphor";

const THEMES: Record<Theme, { bg: string; color: string }> = {
  ink: { bg: "#0E0F11", color: "#F2E8D5" },
  cream: { bg: "#F2E8D5", color: "#0E0F11" },
  phosphor: { bg: "#0E0F11", color: "#7CFFB2" },
};

export default function BooksRead() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sourceId = "", bookId = "" } = useParams<{ sourceId: string; bookId: string }>();
  const store = useBooksStore();
  const hydrate = useBooksStore((s) => s.hydrate);

  const item = (location.state || undefined) as BookListItem | undefined;
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>("ink");
  const [fontSize, setFontSize] = useState(100);
  const [showTOC, setShowTOC] = useState(false);
  const [toc, setToc] = useState<Array<{ label: string; href: string }>>([]);
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const applyTheme = useCallback((t: Theme, size: number, r: Rendition) => {
    const cfg = THEMES[t];
    r.themes.register("douytv", {
      body: {
        background: cfg.bg,
        color: cfg.color,
        "font-family": "Bricolage Grotesque, PingFang SC, system-ui, sans-serif",
        "line-height": "1.7",
      },
      a: { color: "#FF6B35" },
      p: { "margin-bottom": "0.8em" },
    });
    r.themes.select("douytv");
    r.themes.fontSize(`${size}%`);
  }, []);

  // 加载 epub
  useEffect(() => {
    const source = store.sources.find((s) => s.id === sourceId);
    if (!source || !item) return;
    const epubLink = item.acquisitionLinks.find((l) =>
      l.type.toLowerCase().includes("epub")
    );
    if (!epubLink) {
      setError("此条目没有 EPUB 下载链接");
      setLoading(false);
      return;
    }

    let book: Book | null = null;
    let rendition: Rendition | null = null;

    (async () => {
      setLoading(true);
      try {
        const buf = await downloadAcquisition(source, epubLink);
        if (!viewerRef.current) return;
        book = ePub(buf);
        bookRef.current = book;
        rendition = book.renderTo(viewerRef.current, {
          width: "100%",
          height: "100%",
          allowScriptedContent: false,
          manager: "default",
        });
        renditionRef.current = rendition;
        applyTheme(theme, fontSize, rendition);

        const progress = store.getProgress(sourceId, bookId);
        const startCfi =
          progress?.locatorType === "epub-cfi" ? progress.locatorValue : undefined;

        await rendition.display(startCfi);

        const navResult = await book.loaded.navigation;
        const flat = (navResult.toc || []).map((n) => ({
          label: n.label.trim(),
          href: n.href,
        }));
        setToc(flat);

        // 监听位置变化保存进度
        rendition.on("relocated", (location: { start: { cfi: string; percentage?: number } }) => {
          const cfi = location.start.cfi;
          const pct = location.start.percentage ?? 0;
          setPercent(pct);
          void store.saveProgress({
            sourceId,
            bookId,
            locatorType: "epub-cfi",
            locatorValue: cfi,
            percent: pct,
          });
        });
      } catch (e) {
        setError((e as Error).message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      try {
        rendition?.destroy();
        book?.destroy();
      } catch {
        /* ignore */
      }
      renditionRef.current = null;
      bookRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId, bookId]);

  // 主题 / 字号变化
  useEffect(() => {
    const r = renditionRef.current;
    if (r) applyTheme(theme, fontSize, r);
  }, [theme, fontSize, applyTheme]);

  // 键盘 ← →
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        renditionRef.current?.prev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        renditionRef.current?.next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="h-screen w-screen relative overflow-hidden"
      style={{ background: THEMES[theme].bg }}
    >
      {/* 顶部控件 */}
      <div className="absolute top-4 left-4 right-4 z-20 flex items-center gap-2">
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
        <button
          type="button"
          onClick={() => setShowTOC(true)}
          className="w-9 h-9 flex items-center justify-center rounded-full backdrop-blur-md tap"
          style={{
            background: "rgba(14,15,17,0.6)",
            border: "1px solid var(--cream-line)",
            color: "var(--cream)",
          }}
          aria-label="目录"
        >
          <IconList size={16} />
        </button>
        <div className="flex-1" />
        {/* 主题 */}
        <div
          className="flex rounded-full p-0.5"
          style={{
            background: "rgba(14,15,17,0.6)",
            border: "1px solid var(--cream-line)",
          }}
        >
          {(Object.keys(THEMES) as Theme[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTheme(t)}
              className="w-7 h-7 rounded-full tap"
              style={{
                background: THEMES[t].bg,
                border:
                  theme === t ? "2px solid var(--ember)" : "1px solid transparent",
              }}
              aria-label={t}
            />
          ))}
        </div>
        {/* 字号 */}
        <div
          className="flex rounded-full px-1 backdrop-blur-md"
          style={{
            background: "rgba(14,15,17,0.6)",
            border: "1px solid var(--cream-line)",
          }}
        >
          <button
            type="button"
            onClick={() => setFontSize((n) => Math.max(60, n - 10))}
            className="w-7 h-9 text-cream tap font-mono text-sm"
          >
            A−
          </button>
          <button
            type="button"
            onClick={() => setFontSize((n) => Math.min(200, n + 10))}
            className="w-7 h-9 text-cream tap font-mono text-base"
          >
            A+
          </button>
        </div>
      </div>

      {/* 阅读器视口 */}
      <div
        ref={viewerRef}
        className="absolute inset-0"
        style={{ paddingTop: 60, paddingBottom: 40 }}
      />

      {/* 翻页热区 */}
      <button
        type="button"
        onClick={() => renditionRef.current?.prev()}
        className="absolute left-0 top-20 bottom-12 w-1/3 z-10"
        style={{ background: "transparent" }}
        aria-label="上一页"
      />
      <button
        type="button"
        onClick={() => renditionRef.current?.next()}
        className="absolute right-0 top-20 bottom-12 w-1/3 z-10"
        style={{ background: "transparent" }}
        aria-label="下一页"
      />

      {/* 底部进度条 */}
      <div
        className="absolute bottom-0 left-0 right-0 z-20 px-4 py-2 font-mono text-[10px] text-center backdrop-blur-md"
        style={{
          background: "rgba(14,15,17,0.6)",
          color: theme === "cream" ? "#0E0F11" : "var(--cream-dim)",
        }}
      >
        {loading ? "加载中…" : error ? error : `${Math.round(percent * 100)}%`}
      </div>

      {/* TOC drawer */}
      {showTOC && (
        <div
          className="fixed inset-0 z-30 flex"
          style={{ background: "rgba(0,0,0,0.6)" }}
          onClick={() => setShowTOC(false)}
        >
          <div
            className="w-72 h-full overflow-y-auto animate-slide-right"
            style={{
              background: "var(--ink)",
              borderRight: "1px solid var(--cream-line)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="sticky top-0 p-4"
              style={{
                background: "var(--ink)",
                borderBottom: "1px solid var(--cream-line)",
              }}
            >
              <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
                TABLE OF CONTENTS
              </p>
            </div>
            <ul className="p-2">
              {toc.length === 0 ? (
                <li className="text-[11px] text-cream-faint p-3">无目录</li>
              ) : (
                toc.map((n, i) => (
                  <li key={`${n.href}-${i}`}>
                    <button
                      type="button"
                      onClick={() => {
                        renditionRef.current?.display(n.href);
                        setShowTOC(false);
                      }}
                      className="w-full text-left p-2 rounded-md text-xs text-cream tap hover:bg-cream-pale"
                    >
                      {n.label}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
