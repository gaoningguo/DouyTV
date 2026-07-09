// EPUB 阅读器 —— 移植自 MoonTVPlus 的 epub 阅读功能,适配 DouyTV 纯客户端架构。
//
// 用 epub.js 渲染,jszip 由 epubjs 内部解包(挂到 window 供其查找)。文件字节走
// getBookFileBytes(Rust 绕 CORS),命中 IndexedDB blobCache 时直接复用。进度以
// epub-cfi 存 BookReadRecord,节流 10s + pagehide/visibilitychange + 卸载时落盘。
//
// 设计 token 全部走 CSS 变量(容器层);epub iframe 内部主题是隔离的,那里允许 hex。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ePub from "epubjs";
import JSZip from "jszip";
import {
  IconArrowLeft,
  IconList,
  IconSettings,
  IconChevronRight,
} from "@/components/Icon";
import { Sheet } from "@/components/Sheet/Sheet";
import { getBookFileBytes } from "@/lib/book";
import {
  getCachedFile,
  putCachedFile,
} from "@/lib/book/blobCache";
import { useBookStore } from "@/stores/book";
import type { BookReadRecord } from "@/lib/book/types";

// epubjs 需要一个全局 JSZip 才能解 epub(zip)。这是打包环境下最稳妥的写法。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).JSZip = JSZip;

type Phase = "checking" | "downloading" | "opening" | "ready" | "error";
type ReadMode = "paginated" | "scrolled";

const MODE_KEY = "douytv:book-epub-mode";

// epubjs 类型很松,这里用宽松别名,只在必要处 any。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EpubBook = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EpubRendition = any;

interface FlatTocItem {
  label: string;
  href: string;
  depth: number;
}

// 三套阅读主题(iframe 内部隔离,允许 hex)。paper→浅色,sepia→护眼,dark→深色。
const THEME_PRESETS: Record<
  "paper" | "sepia" | "dark",
  { bg: string; fg: string; link: string }
> = {
  paper: { bg: "#faf8f3", fg: "#1c1c1c", link: "#b4530a" },
  sepia: { bg: "#f5ecd9", fg: "#5b4636", link: "#8a5a2b" },
  dark: { bg: "#16181d", fg: "#cfc7b6", link: "#ff8c5a" },
};

function loadMode(): ReadMode {
  try {
    return localStorage.getItem(MODE_KEY) === "scrolled"
      ? "scrolled"
      : "paginated";
  } catch {
    return "paginated";
  }
}

function saveMode(m: ReadMode): void {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* ignore */
  }
}

interface RawNavItem {
  label: string;
  href: string;
  subitems?: RawNavItem[];
}

// epubjs 的 NavItem 允许嵌套 subitems,这里展平(保留层级用于缩进)。
function flattenToc(
  items: RawNavItem[],
  depth = 0,
  out: FlatTocItem[] = []
): FlatTocItem[] {
  for (const it of items) {
    out.push({ label: (it.label || "").trim(), href: it.href, depth });
    if (it.subitems && it.subitems.length) {
      flattenToc(it.subitems, depth + 1, out);
    }
  }
  return out;
}

// 去掉 href 的锚点/查询,便于把渲染位置对回目录条目。
function baseHref(href: string): string {
  return (href || "").split("#")[0].split("?")[0];
}

export default function EpubReader(props: {
  sourceId: string;
  bookId: string;
  fileUrl: string;
  title: string;
  onBack: () => void;
}): JSX.Element {
  const { sourceId, bookId, fileUrl, title, onBack } = props;

  const settings = useBookStore((s) => s.settings);
  const setSettings = useBookStore((s) => s.setSettings);
  const upsertRecord = useBookStore((s) => s.upsertRecord);
  const getRecord = useBookStore((s) => s.getRecord);

  const [phase, setPhase] = useState<Phase>("checking");
  const [downloadPct, setDownloadPct] = useState(0);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<ReadMode>(loadMode);
  const [toc, setToc] = useState<FlatTocItem[]>([]);
  const [showControls, setShowControls] = useState(true);
  const [tocOpen, setTocOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [percent, setPercent] = useState(0);
  const [activeHref, setActiveHref] = useState("");
  const [atEnd, setAtEnd] = useState(false);
  // 递增以触发主题重应用(rendition 重建后)。
  const [renditionEpoch, setRenditionEpoch] = useState(0);

  const viewerRef = useRef<HTMLDivElement | null>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const renditionRef = useRef<EpubRendition | null>(null);
  const locationsReadyRef = useRef(false);

  // 进度落盘用的最新值(避免闭包拿到旧值)。
  const cfiRef = useRef<string>("");
  const percentRef = useRef(0);
  const activeHrefRef = useRef("");
  const lastSaveRef = useRef(0);
  const sourceNameRef = useRef(sourceId);
  const restoreCfiRef = useRef<string>(""); // 挂载时从记录恢复的 cfi

  // ── 目录条目查找(把渲染位置映射到章节标题)──────────
  const chapterTitleFor = useCallback(
    (href: string): string | undefined => {
      const b = baseHref(href);
      const hit = toc.find((t) => baseHref(t.href) === b);
      return hit?.label;
    },
    [toc]
  );

  // ── 进度落盘 ──────────────────────────────────────────
  const saveProgress = useCallback(
    (force = false) => {
      const cfi = cfiRef.current;
      if (!cfi) return;
      const now = Date.now();
      if (!force && now - lastSaveRef.current < 10_000) return;
      lastSaveRef.current = now;
      const href = activeHrefRef.current;
      const chapterTitle = chapterTitleFor(href);
      const record: BookReadRecord = {
        sourceId,
        sourceName: sourceNameRef.current,
        bookId,
        title,
        format: "epub",
        acquisitionHref: fileUrl,
        locator: {
          type: "epub-cfi",
          value: cfi,
          href,
          chapterTitle,
        },
        progressPercent: percentRef.current,
        chapterTitle,
        chapterHref: href,
        saveTime: now,
      };
      upsertRecord(record);
    },
    [sourceId, bookId, title, fileUrl, upsertRecord, chapterTitleFor]
  );

  // ── 主加载流程:缓存 → 下载 → 打开 ────────────────────
  useEffect(() => {
    let cancelled = false;
    const cacheKey = `${sourceId}::${bookId}::epub`;
    const existing = getRecord(sourceId, bookId);
    if (existing) {
      sourceNameRef.current = existing.sourceName || sourceId;
      if (existing.locator.type === "epub-cfi") {
        restoreCfiRef.current = existing.locator.value;
      }
    }

    async function run() {
      try {
        setPhase("checking");
        let arrayBuffer: ArrayBuffer | null = null;

        const cached = await getCachedFile(cacheKey);
        if (cached && !cancelled) {
          arrayBuffer = await cached.blob.arrayBuffer();
        }

        if (!arrayBuffer && !cancelled) {
          setPhase("downloading");
          setDownloadPct(0);
          const { bytes, mimeType } = await getBookFileBytes(
            sourceId,
            fileUrl,
            (received, total) => {
              if (cancelled) return;
              if (total && total > 0) {
                setDownloadPct(Math.round((received / total) * 100));
              }
            }
          );
          if (cancelled) return;
          const ab = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
          ) as ArrayBuffer;
          arrayBuffer = ab;
          const blob = new Blob([ab], {
            type: mimeType || "application/epub+zip",
          });
          void putCachedFile({
            key: cacheKey,
            sourceId,
            bookId,
            title,
            format: "epub",
            blob,
            size: blob.size,
            mimeType: mimeType || "application/epub+zip",
            updatedAt: Date.now(),
          });
        }

        if (!arrayBuffer || cancelled) return;

        setPhase("opening");
        const book: EpubBook = ePub(arrayBuffer);
        bookRef.current = book;

        await book.ready;
        if (cancelled) return;

        // 目录
        try {
          const nav = await book.loaded.navigation;
          const items = (nav?.toc ?? []) as unknown as RawNavItem[];
          if (!cancelled) setToc(flattenToc(items));
        } catch {
          /* 无目录也能读 */
        }

        // 位置索引(用于百分比进度)。较慢,放到后台,不阻塞首屏。
        book.locations
          .generate(480)
          .then(() => {
            locationsReadyRef.current = true;
          })
          .catch(() => {
            /* 生成失败则用 relocated 的 percentage 兜底 */
          });

        if (!cancelled) setPhase("ready");
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setPhase("error");
        }
      }
    }

    void run();

    return () => {
      cancelled = true;
      try {
        renditionRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
      try {
        bookRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
      renditionRef.current = null;
      bookRef.current = null;
    };
  }, [sourceId, bookId, fileUrl, title, getRecord]);

  // ── 构建 / 重建 rendition(mode 变化时重建)────────────
  useEffect(() => {
    if (phase !== "ready") return;
    const book = bookRef.current;
    const el = viewerRef.current;
    if (!book || !el) return;

    const rendition: EpubRendition = book.renderTo(el, {
      width: "100%",
      height: "100%",
      spread: "none",
      flow: mode === "scrolled" ? "scrolled-doc" : "paginated",
      allowScriptedContent: false,
    });
    renditionRef.current = rendition;

    const onRelocated = (loc: {
      start?: { cfi: string; href: string; percentage?: number };
      atEnd?: boolean;
    }) => {
      const start = loc?.start;
      if (!start) return;
      cfiRef.current = start.cfi;
      activeHrefRef.current = start.href;
      setActiveHref(start.href);
      setAtEnd(Boolean(loc?.atEnd));
      let pct = 0;
      if (locationsReadyRef.current) {
        try {
          pct = book.locations.percentageFromCfi(start.cfi) || 0;
        } catch {
          pct = start.percentage || 0;
        }
      } else {
        pct = start.percentage || 0;
      }
      pct = Math.max(0, Math.min(1, pct));
      percentRef.current = pct;
      setPercent(pct);
      saveProgress(false);
    };
    rendition.on("relocated", onRelocated);

    // 首次或重建后:优先恢复到上次 cfi,其次当前 cfi,再次从头。
    const target =
      cfiRef.current || restoreCfiRef.current || undefined;
    rendition
      .display(target)
      .then(() => setRenditionEpoch((n) => n + 1))
      .catch(() => {
        // cfi 失效时退回首页
        rendition.display().then(() => setRenditionEpoch((n) => n + 1));
      });

    return () => {
      try {
        rendition.off?.("relocated", onRelocated);
        rendition.destroy?.();
      } catch {
        /* ignore */
      }
      if (renditionRef.current === rendition) renditionRef.current = null;
    };
  }, [phase, mode, saveProgress]);

  // ── 应用主题 / 字号 / 行距(设置变化或 rendition 重建后)──
  useEffect(() => {
    const rendition = renditionRef.current;
    if (!rendition || phase !== "ready" || renditionEpoch === 0) return;
    const themeKey =
      settings.theme === "dark"
        ? "dark"
        : settings.theme === "paper"
          ? "paper"
          : "sepia";
    const preset = THEME_PRESETS[themeKey];
    const lh = settings.lineHeight;
    const rules = {
      body: {
        background: `${preset.bg} !important`,
        color: `${preset.fg} !important`,
        "line-height": `${lh} !important`,
        padding: "0 12px !important",
        "-webkit-text-size-adjust": "100%",
      },
      p: {
        "line-height": `${lh} !important`,
        color: `${preset.fg} !important`,
      },
      "h1, h2, h3, h4, h5, h6": { color: `${preset.fg} !important` },
      a: { color: `${preset.link} !important` },
      img: { "max-width": "100% !important", height: "auto !important" },
    };
    try {
      // 重新注册并选择,使已渲染的 iframe 内容即时更新。
      rendition.themes.register(`douy-${themeKey}`, rules);
      rendition.themes.select(`douy-${themeKey}`);
      rendition.themes.fontSize(`${settings.fontSize * 5 + 50}%`);
    } catch {
      /* ignore */
    }
  }, [
    phase,
    renditionEpoch,
    settings.theme,
    settings.fontSize,
    settings.lineHeight,
  ]);

  // ── 生命周期落盘:pagehide / 可见性 / 卸载 ─────────────
  useEffect(() => {
    const onHide = () => saveProgress(true);
    const onVis = () => {
      if (document.visibilityState === "hidden") saveProgress(true);
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVis);
      saveProgress(true);
    };
  }, [saveProgress]);

  // ── 翻页 / 章节跳转 ────────────────────────────────────
  const goPrev = useCallback(() => {
    renditionRef.current?.prev?.();
  }, []);
  const goNext = useCallback(() => {
    renditionRef.current?.next?.();
  }, []);

  const displayHref = useCallback((href: string) => {
    renditionRef.current?.display?.(href);
  }, []);

  const nextChapterHref = useMemo(() => {
    if (!activeHref || toc.length === 0) return "";
    const b = baseHref(activeHref);
    const idx = toc.findIndex((t) => baseHref(t.href) === b);
    if (idx >= 0 && idx + 1 < toc.length) return toc[idx + 1].href;
    return "";
  }, [activeHref, toc]);

  const changeMode = useCallback((m: ReadMode) => {
    setMode(m);
    saveMode(m);
  }, []);

  const stop = (e: React.PointerEvent) => e.stopPropagation();

  // ── 渲染 ──────────────────────────────────────────────
  const isLoading = phase !== "ready" && phase !== "error";

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col"
      style={{ background: "var(--ink)" }}
    >
      {/* 阅读区 + 点击区 */}
      <div className="relative flex-1 min-h-0">
        <div ref={viewerRef} className="absolute inset-0" />

        {/* 点击分区:仅翻页模式启用左右翻页;中间切换控件 */}
        {phase === "ready" && (
          <>
            {mode === "paginated" && (
              <>
                <button
                  type="button"
                  aria-label="上一页"
                  onPointerDownCapture={stop}
                  onClick={goPrev}
                  className="absolute left-0 top-0 bottom-0"
                  style={{ width: "28%" }}
                />
                <button
                  type="button"
                  aria-label="下一页"
                  onPointerDownCapture={stop}
                  onClick={goNext}
                  className="absolute right-0 top-0 bottom-0"
                  style={{ width: "28%" }}
                />
              </>
            )}
            <button
              type="button"
              aria-label="切换控件"
              onPointerDownCapture={stop}
              onClick={() => setShowControls((v) => !v)}
              className="absolute top-0 bottom-0"
              style={{
                left: mode === "paginated" ? "28%" : "0",
                right: mode === "paginated" ? "28%" : "0",
              }}
            />

            {/* 滚动模式:接近底部时显示"下一章" */}
            {mode === "scrolled" && atEnd && nextChapterHref && (
              <button
                type="button"
                onPointerDownCapture={stop}
                onClick={() => displayHref(nextChapterHref)}
                className="absolute right-4 font-mono text-xs px-4 rounded-full tap flex items-center gap-1"
                style={{
                  bottom: "calc(env(safe-area-inset-bottom) + 16px)",
                  height: "40px",
                  background: "var(--ember)",
                  color: "var(--ink)",
                  boxShadow: "0 0 12px var(--ember-glow)",
                }}
              >
                下一章
                <IconChevronRight size={15} />
              </button>
            )}
          </>
        )}

        {/* 加载 / 错误态 */}
        {isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
            <div
              className="w-10 h-10 rounded-full animate-spin"
              style={{
                border: "2px solid var(--cream-line)",
                borderTopColor: "var(--ember)",
              }}
            />
            <p className="font-mono text-xs" style={{ color: "var(--cream-dim)" }}>
              {phase === "checking" && "检查缓存…"}
              {phase === "downloading" &&
                `下载中 ${downloadPct > 0 ? `${downloadPct}%` : "…"}`}
              {phase === "opening" && "解析电子书…"}
            </p>
          </div>
        )}
        {phase === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
            <p className="font-display text-sm" style={{ color: "var(--cream)" }}>
              加载失败
            </p>
            <p
              className="font-mono text-xs break-all"
              style={{ color: "var(--cream-faint)" }}
            >
              {error}
            </p>
            <button
              type="button"
              onClick={onBack}
              className="mt-2 px-4 h-10 rounded-full font-mono text-xs tap"
              style={{
                border: "1px solid var(--cream-line)",
                color: "var(--cream-dim)",
              }}
            >
              返回
            </button>
          </div>
        )}
      </div>

      {/* 顶栏 */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center gap-2 px-3 transition-transform duration-200"
        style={{
          paddingTop: "calc(env(safe-area-inset-top) + 8px)",
          paddingBottom: "8px",
          background:
            "linear-gradient(to bottom, var(--ink), rgba(14,15,17,0.85), transparent)",
          transform: showControls ? "translateY(0)" : "translateY(-110%)",
        }}
      >
        <button
          type="button"
          onPointerDownCapture={stop}
          onClick={onBack}
          aria-label="返回"
          className="w-10 h-10 flex items-center justify-center rounded-full tap shrink-0"
          style={{ color: "var(--cream)" }}
        >
          <IconArrowLeft size={20} />
        </button>
        <h1
          className="flex-1 min-w-0 font-display text-sm font-bold line-clamp-1"
          style={{ color: "var(--cream)" }}
        >
          {title}
        </h1>
        <button
          type="button"
          onPointerDownCapture={stop}
          onClick={() => setTocOpen(true)}
          aria-label="目录"
          className="w-10 h-10 flex items-center justify-center rounded-full tap shrink-0"
          style={{ color: "var(--cream)" }}
        >
          <IconList size={20} />
        </button>
        <button
          type="button"
          onPointerDownCapture={stop}
          onClick={() => setSettingsOpen(true)}
          aria-label="阅读设置"
          className="w-10 h-10 flex items-center justify-center rounded-full tap shrink-0"
          style={{ color: "var(--cream)" }}
        >
          <IconSettings size={20} />
        </button>
      </div>

      {/* 底栏进度 */}
      <div
        className="absolute bottom-0 left-0 right-0 px-4 transition-transform duration-200"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)",
          paddingTop: "10px",
          background:
            "linear-gradient(to top, var(--ink), rgba(14,15,17,0.85), transparent)",
          transform: showControls ? "translateY(0)" : "translateY(110%)",
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex-1 h-1 rounded-full overflow-hidden"
            style={{ background: "var(--cream-line)" }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.round(percent * 100)}%`,
                background: "var(--ember)",
              }}
            />
          </div>
          <span
            className="font-mono text-xs tabular-nums shrink-0"
            style={{ color: "var(--cream-dim)" }}
          >
            {Math.round(percent * 100)}%
          </span>
        </div>
      </div>

      {/* 目录抽屉 */}
      <Sheet
        open={tocOpen}
        onClose={() => setTocOpen(false)}
        side="right"
        title="目录"
      >
        <div className="py-2">
          {toc.length === 0 && (
            <p
              className="px-4 py-6 font-mono text-xs text-center"
              style={{ color: "var(--cream-faint)" }}
            >
              无目录
            </p>
          )}
          {toc.map((item, i) => {
            const active = baseHref(item.href) === baseHref(activeHref);
            return (
              <button
                key={`${item.href}-${i}`}
                type="button"
                onPointerDownCapture={stop}
                onClick={() => {
                  displayHref(item.href);
                  setTocOpen(false);
                }}
                className="w-full text-left px-4 py-3 tap font-mono text-sm line-clamp-2"
                style={{
                  paddingLeft: `${16 + item.depth * 14}px`,
                  color: active ? "var(--ember)" : "var(--cream-dim)",
                  background: active ? "var(--ember-soft)" : "transparent",
                  minHeight: "44px",
                }}
              >
                {item.label || "(未命名)"}
              </button>
            );
          })}
        </div>
      </Sheet>

      {/* 设置面板 */}
      <Sheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        side="bottom"
        title="阅读设置"
      >
        <div className="px-4 py-4 flex flex-col gap-5">
          {/* 阅读模式 */}
          <div className="flex flex-col gap-2">
            <span
              className="font-mono text-xs"
              style={{ color: "var(--cream-faint)" }}
            >
              阅读模式
            </span>
            <div className="flex gap-2">
              {(
                [
                  ["paginated", "翻页"],
                  ["scrolled", "滚动"],
                ] as Array<[ReadMode, string]>
              ).map(([val, label]) => {
                const on = mode === val;
                return (
                  <button
                    key={val}
                    type="button"
                    onPointerDownCapture={stop}
                    onClick={() => changeMode(val)}
                    className="flex-1 h-10 rounded-lg font-mono text-sm tap"
                    style={{
                      border: "1px solid var(--cream-line)",
                      background: on ? "var(--ember)" : "var(--ink)",
                      color: on ? "var(--ink)" : "var(--cream-dim)",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 主题 */}
          <div className="flex flex-col gap-2">
            <span
              className="font-mono text-xs"
              style={{ color: "var(--cream-faint)" }}
            >
              主题
            </span>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["paper", "浅色"],
                  ["sepia", "护眼"],
                  ["dark", "深色"],
                ] as Array<["paper" | "sepia" | "dark", string]>
              ).map(([val, label]) => {
                const on = settings.theme === val;
                const preset = THEME_PRESETS[val];
                return (
                  <button
                    key={val}
                    type="button"
                    onPointerDownCapture={stop}
                    onClick={() => setSettings({ theme: val })}
                    className="h-14 rounded-lg font-mono text-xs tap flex items-center justify-center"
                    style={{
                      background: preset.bg,
                      color: preset.fg,
                      border: on
                        ? "2px solid var(--ember)"
                        : "1px solid var(--cream-line)",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 字号 */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span
                className="font-mono text-xs"
                style={{ color: "var(--cream-faint)" }}
              >
                字号
              </span>
              <span
                className="font-mono text-xs tabular-nums"
                style={{ color: "var(--cream-dim)" }}
              >
                {settings.fontSize}
              </span>
            </div>
            <input
              type="range"
              min={14}
              max={32}
              step={1}
              value={settings.fontSize}
              onPointerDownCapture={stop}
              onChange={(e) =>
                setSettings({ fontSize: Number(e.target.value) })
              }
              className="w-full accent-ember"
              style={{ accentColor: "var(--ember)", height: "40px" }}
            />
          </div>

          {/* 行距 */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span
                className="font-mono text-xs"
                style={{ color: "var(--cream-faint)" }}
              >
                行距
              </span>
              <span
                className="font-mono text-xs tabular-nums"
                style={{ color: "var(--cream-dim)" }}
              >
                {settings.lineHeight.toFixed(1)}
              </span>
            </div>
            <input
              type="range"
              min={1.2}
              max={2.4}
              step={0.1}
              value={settings.lineHeight}
              onPointerDownCapture={stop}
              onChange={(e) =>
                setSettings({ lineHeight: Number(e.target.value) })
              }
              className="w-full"
              style={{ accentColor: "var(--ember)", height: "40px" }}
            />
          </div>
        </div>
      </Sheet>
    </div>
  );
}
