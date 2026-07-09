// PDF 阅读器 —— 移植自 MoonTVPlus 的 PDF 阅读能力。
//
// MoonTVPlus 用 <iframe> 内嵌浏览器 PDF viewer。DouyTV 是跨平台 Tauri 客户端,
// Android WebView / Linux WebKitGTK 没有内置 PDF viewer,iframe 方案直接白屏。
// 因此这里改用 pdf.js(pdfjs-dist v6)把每页渲染到 <canvas>:
//   - 连续纵向滚动,IntersectionObserver 懒渲染(仅渲染视口附近页,离开即释放 canvas 内存)
//   - devicePixelRatio 提升清晰度,按面积上限封顶防止大页 OOM
//   - 缩放(fit-width 默认 + 0.5x~3x)、页码浮层、进度记忆(pdf-page locator)
//
// worker 必须打包进产物(不能走 CDN,离线/移动端拿不到):?url 让 Vite 打包并给出本地 URL。

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { getBookFileBytes } from "@/lib/book";
import { getCachedFile, putCachedFile } from "@/lib/book/blobCache";
import { useBookStore } from "@/stores/book";
import type { BookReadRecord } from "@/lib/book/types";
import { IconArrowLeft, IconPlus, IconRefresh, IconFullscreen } from "@/components/Icon";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// ── 常量 ──────────────────────────────────────────────
/** 单页 canvas 背板像素面积上限(w*h),超出则压低 outputScale 防止大页占用过多显存。 */
const MAX_CANVAS_AREA = 6_000_000;
/** devicePixelRatio 上限 —— 移动端高 DPR 屏幕不必全量渲染,够清晰即可。 */
const MAX_DPR = 2.5;
/** 内容列最大宽度(桌面端可读性)。 */
const MAX_CONTENT_WIDTH = 900;
/** 缩放范围。 */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;
/** 进度节流保存间隔。 */
const SAVE_THROTTLE_MS = 10_000;
/** 无内在尺寸时的占位纵横比(A4 竖版 ≈ 1.414)。 */
const FALLBACK_ASPECT = 1.414;

type Phase = "checking" | "downloading" | "rendering" | "ready" | "error";

interface Intrinsic {
  w: number;
  h: number;
}

/** 本地极简 minus 图标 —— 与 Icon 库同一视觉规格(24×24 / stroke=1.6 / currentColor)。 */
function IconMinus({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
    </svg>
  );
}

// ── 单页视图 ──────────────────────────────────────────
interface PageCanvasProps {
  doc: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  active: boolean;
  contentWidth: number;
  zoom: number;
  dpr: number;
  intrinsic: Intrinsic | undefined;
  defaultAspect: number;
  onIntrinsic: (pageNumber: number, w: number, h: number) => void;
  registerEl: (pageNumber: number, el: HTMLElement | null) => void;
}

function PageCanvas({
  doc,
  pageNumber,
  active,
  contentWidth,
  zoom,
  dpr,
  intrinsic,
  defaultAspect,
  onIntrinsic,
  registerEl,
}: PageCanvasProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const taskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const [rendered, setRendered] = useState(false);

  // 把外层容器注册到父级的 IntersectionObserver。
  useEffect(() => {
    registerEl(pageNumber, wrapRef.current);
    return () => registerEl(pageNumber, null);
  }, [pageNumber, registerEl]);

  const displayWidth = contentWidth * zoom;
  const aspect = intrinsic ? intrinsic.h / intrinsic.w : defaultAspect;
  const displayHeight = displayWidth > 0 ? displayWidth * aspect : 0;

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;

    if (!active || displayWidth <= 0 || !canvas) {
      // 离开视口:取消进行中的渲染并释放 canvas 背板内存。
      taskRef.current?.cancel();
      taskRef.current = null;
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      setRendered(false);
      return;
    }

    (async () => {
      try {
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        onIntrinsic(pageNumber, base.width, base.height);

        const cssScale = displayWidth / base.width;
        const dispH = base.height * cssScale;
        let outputScale = Math.min(dpr, MAX_DPR);
        const area = displayWidth * dispH * outputScale * outputScale;
        if (area > MAX_CANVAS_AREA) {
          outputScale = Math.sqrt(MAX_CANVAS_AREA / (displayWidth * dispH));
        }

        const viewport = page.getViewport({ scale: cssScale * outputScale });
        const ctx = canvas.getContext("2d");
        if (!ctx || cancelled) return;

        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        canvas.style.width = `${Math.floor(displayWidth)}px`;
        canvas.style.height = `${Math.floor(dispH)}px`;

        taskRef.current?.cancel();
        const task = page.render({ canvasContext: ctx, viewport, canvas });
        taskRef.current = task;
        await task.promise;
        if (!cancelled) setRendered(true);
      } catch (err) {
        // 渲染取消(切页/缩放重渲)属正常流程,静默。
        const name = (err as { name?: string } | null)?.name;
        if (name !== "RenderingCancelledException" && !cancelled) {
          console.warn(`[pdf] page ${pageNumber} render failed`, err);
        }
      }
    })();

    return () => {
      cancelled = true;
      taskRef.current?.cancel();
      taskRef.current = null;
    };
  }, [active, displayWidth, zoom, dpr, doc, pageNumber, onIntrinsic]);

  return (
    <div
      ref={wrapRef}
      className="relative mx-auto flex items-center justify-center"
      style={{
        width: displayWidth > 0 ? `${Math.floor(displayWidth)}px` : "100%",
        minHeight: displayHeight > 0 ? `${Math.floor(displayHeight)}px` : "60vh",
        background: "var(--ink-2)",
        border: "1px solid var(--cream-line)",
      }}
    >
      <canvas ref={canvasRef} className="block max-w-full" />
      {!rendered && (
        <span className="absolute font-mono text-xs" style={{ color: "var(--cream-faint)" }}>
          {pageNumber}
        </span>
      )}
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────
export default function PdfReader(props: {
  sourceId: string;
  bookId: string;
  fileUrl: string;
  title: string;
  onBack: () => void;
}): JSX.Element {
  const { sourceId, bookId, fileUrl, title, onBack } = props;

  const upsertRecord = useBookStore((s) => s.upsertRecord);
  const getRecord = useBookStore((s) => s.getRecord);

  const [phase, setPhase] = useState<Phase>("checking");
  const [downloadPct, setDownloadPct] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [doc, setDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [defaultAspect, setDefaultAspect] = useState(FALLBACK_ASPECT);

  const [contentWidth, setContentWidth] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [activePages, setActivePages] = useState<Set<number>>(new Set());
  const [pageDims, setPageDims] = useState<Map<number, Intrinsic>>(new Map());

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const renderObserverRef = useRef<IntersectionObserver | null>(null);
  const viewObserverRef = useRef<IntersectionObserver | null>(null);
  const elMapRef = useRef<Map<number, HTMLElement>>(new Map());
  const ratioMapRef = useRef<Map<number, number>>(new Map());
  const restoredRef = useRef(false);
  const reloadRef = useRef(0);

  const dpr = useMemo(
    () => (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1),
    []
  );
  const cacheKey = `${sourceId}::${bookId}::pdf`;

  // 最新值镜像(供 pagehide / unmount 保存时读取)。
  const currentPageRef = useRef(1);
  const numPagesRef = useRef(0);
  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);
  useEffect(() => {
    numPagesRef.current = numPages;
  }, [numPages]);

  // ── 下载 + 打开 ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let openedDoc: pdfjsLib.PDFDocumentProxy | null = null;

    (async () => {
      setPhase("checking");
      setErrorMsg("");
      setDownloadPct(null);
      try {
        let bytes: Uint8Array | null = null;
        let mimeType = "application/pdf";

        const cached = await getCachedFile(cacheKey);
        if (cached && !cancelled) {
          const buf = await cached.blob.arrayBuffer();
          bytes = new Uint8Array(buf);
          mimeType = cached.mimeType || mimeType;
        }

        if (!bytes && !cancelled) {
          setPhase("downloading");
          const res = await getBookFileBytes(sourceId, fileUrl, (received, total) => {
            if (cancelled) return;
            setDownloadPct(total && total > 0 ? Math.round((received / total) * 100) : null);
          });
          bytes = res.bytes;
          mimeType = res.mimeType || mimeType;
          // 缓存原始字节(Blob 会复制一份,后续 getDocument 拿到的是独立 buffer)。
          await putCachedFile({
            key: cacheKey,
            sourceId,
            bookId,
            title,
            format: "pdf",
            blob: new Blob([bytes as BlobPart], { type: mimeType }),
            size: bytes.length,
            mimeType,
            updatedAt: Date.now(),
          }).catch(() => {});
        }

        if (cancelled || !bytes) return;

        setPhase("rendering");
        const task = pdfjsLib.getDocument({ data: bytes });
        openedDoc = await task.promise;
        if (cancelled) {
          void openedDoc.loadingTask.destroy();
          return;
        }

        // 首页尺寸决定占位纵横比。
        const first = await openedDoc.getPage(1);
        const v = first.getViewport({ scale: 1 });
        if (cancelled) {
          void openedDoc.loadingTask.destroy();
          return;
        }
        setDefaultAspect(v.height / v.width);
        setDoc(openedDoc);
        setNumPages(openedDoc.numPages);
        setPhase("ready");
      } catch (err) {
        if (cancelled) return;
        console.error("[pdf] open failed", err);
        setErrorMsg(err instanceof Error ? err.message : "PDF 打开失败");
        setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
      if (openedDoc) void openedDoc.loadingTask.destroy();
    };
  }, [sourceId, bookId, fileUrl, title, cacheKey, reloadRef.current]);

  // ── 容器宽度测量 ────────────────────────────────────
  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setContentWidth(Math.min(w, MAX_CONTENT_WIDTH));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [phase]);

  // ── IntersectionObserver:懒渲染 + 当前页追踪 ───────
  const registerEl = useCallback((pageNumber: number, el: HTMLElement | null) => {
    const map = elMapRef.current;
    const prev = map.get(pageNumber);
    if (prev && prev !== el) {
      renderObserverRef.current?.unobserve(prev);
      viewObserverRef.current?.unobserve(prev);
    }
    if (el) {
      el.dataset.page = String(pageNumber);
      map.set(pageNumber, el);
      renderObserverRef.current?.observe(el);
      viewObserverRef.current?.observe(el);
    } else {
      map.delete(pageNumber);
      ratioMapRef.current.delete(pageNumber);
    }
  }, []);

  useEffect(() => {
    const root = scrollRef.current;
    if (!doc || !root) return;

    const renderObs = new IntersectionObserver(
      (entries) => {
        setActivePages((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const n = Number((e.target as HTMLElement).dataset.page);
            if (!n) continue;
            if (e.isIntersecting) next.add(n);
            else next.delete(n);
          }
          return next;
        });
      },
      { root, rootMargin: "1200px 0px 1200px 0px", threshold: 0 }
    );

    const viewObs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const n = Number((e.target as HTMLElement).dataset.page);
          if (n) ratioMapRef.current.set(n, e.intersectionRatio);
        }
        let best = -1;
        let bestRatio = -1;
        ratioMapRef.current.forEach((ratio, n) => {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            best = n;
          }
        });
        if (best > 0) setCurrentPage(best);
      },
      { root, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] }
    );

    renderObserverRef.current = renderObs;
    viewObserverRef.current = viewObs;
    elMapRef.current.forEach((el) => {
      renderObs.observe(el);
      viewObs.observe(el);
    });

    return () => {
      renderObs.disconnect();
      viewObs.disconnect();
      renderObserverRef.current = null;
      viewObserverRef.current = null;
    };
  }, [doc]);

  // ── 恢复上次阅读页 ─────────────────────────────────
  useEffect(() => {
    if (!doc || restoredRef.current) return;
    const rec = getRecord(sourceId, bookId);
    const savedPage =
      rec && rec.locator.type === "pdf-page" ? parseInt(rec.locator.value, 10) : NaN;
    restoredRef.current = true;
    if (Number.isFinite(savedPage) && savedPage > 1) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          elMapRef.current.get(savedPage)?.scrollIntoView({ block: "start" });
        });
      });
    }
  }, [doc, sourceId, bookId, getRecord]);

  const onIntrinsic = useCallback((pageNumber: number, w: number, h: number) => {
    setPageDims((prev) => {
      const ex = prev.get(pageNumber);
      if (ex && ex.w === w && ex.h === h) return prev;
      const next = new Map(prev);
      next.set(pageNumber, { w, h });
      return next;
    });
  }, []);

  // ── 进度保存 ───────────────────────────────────────
  const buildRecord = useCallback(
    (page: number): BookReadRecord => {
      const existing = getRecord(sourceId, bookId);
      const total = numPagesRef.current;
      const pct = total > 0 ? Math.min(100, Math.round((page / total) * 100)) : 0;
      return {
        sourceId,
        sourceName: existing?.sourceName ?? sourceId,
        bookId,
        title: existing?.title ?? title,
        author: existing?.author,
        cover: existing?.cover,
        format: "pdf",
        detailHref: existing?.detailHref,
        acquisitionHref: existing?.acquisitionHref ?? fileUrl,
        locator: { type: "pdf-page", value: String(page) },
        progressPercent: pct,
        saveTime: Date.now(),
      };
    },
    [getRecord, sourceId, bookId, title, fileUrl]
  );

  const lastSaveRef = useRef(0);
  const doSave = useCallback(
    (page: number) => {
      if (numPagesRef.current <= 0) return;
      lastSaveRef.current = Date.now();
      upsertRecord(buildRecord(page));
    },
    [upsertRecord, buildRecord]
  );

  // 翻页触发节流保存(至多每 10s 一次)。
  useEffect(() => {
    if (phase !== "ready") return;
    if (Date.now() - lastSaveRef.current >= SAVE_THROTTLE_MS) {
      doSave(currentPage);
    }
  }, [currentPage, phase, doSave]);

  // pagehide + 卸载时强制保存最新页。
  useEffect(() => {
    const onHide = () => {
      if (numPagesRef.current > 0) doSave(currentPageRef.current);
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      onHide();
    };
  }, [doSave]);

  // ── 缩放 ───────────────────────────────────────────
  const zoomOut = useCallback(
    () => setZoom((z) => Math.max(MIN_ZOOM, Math.round((z - ZOOM_STEP) * 100) / 100)),
    []
  );
  const zoomIn = useCallback(
    () => setZoom((z) => Math.min(MAX_ZOOM, Math.round((z + ZOOM_STEP) * 100) / 100)),
    []
  );
  const zoomFit = useCallback(() => setZoom(1), []);

  const retry = useCallback(() => {
    reloadRef.current += 1;
    restoredRef.current = false;
    setDoc(null);
    setNumPages(0);
    setActivePages(new Set());
    setPageDims(new Map());
    setPhase("checking");
  }, []);

  // ── 渲染 ───────────────────────────────────────────
  const pageList = useMemo(
    () => (numPages > 0 ? Array.from({ length: numPages }, (_, i) => i + 1) : []),
    [numPages]
  );

  const loading = phase === "checking" || phase === "downloading" || phase === "rendering";
  const loadingLabel =
    phase === "checking"
      ? "检查缓存…"
      : phase === "downloading"
        ? downloadPct != null
          ? `下载中 ${downloadPct}%`
          : "下载中…"
        : "解析中…";

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "var(--ink)", color: "var(--cream)" }}
    >
      {/* 顶栏 */}
      <div
        className={`absolute top-0 left-0 right-0 z-20 transition-transform duration-200 ${
          controlsVisible ? "translate-y-0" : "-translate-y-full"
        }`}
        style={{
          paddingTop: "env(safe-area-inset-top)",
          background: "var(--ink-2)",
          borderBottom: "1px solid var(--cream-line)",
        }}
        onPointerDownCapture={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-2 py-2">
          <button
            type="button"
            onClick={onBack}
            aria-label="返回"
            className="flex items-center justify-center rounded-full tap shrink-0"
            style={{
              width: 40,
              height: 40,
              color: "var(--cream)",
              background: "var(--ink)",
              border: "1px solid var(--cream-line)",
            }}
          >
            <IconArrowLeft size={18} />
          </button>
          <h1 className="flex-1 font-display text-sm font-bold line-clamp-1" style={{ color: "var(--cream)" }}>
            {title}
          </h1>
          {numPages > 0 && (
            <span
              className="font-mono text-xs px-2 py-1 rounded shrink-0"
              style={{ color: "var(--cream-dim)", background: "var(--ink)" }}
            >
              {currentPage} / {numPages}
            </span>
          )}
        </div>
      </div>

      {/* 内容滚动区 —— 点击空白切换控件显隐 */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-auto"
        onClick={() => setControlsVisible((v) => !v)}
        style={{
          paddingTop: "calc(env(safe-area-inset-top) + 3.5rem)",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 4rem)",
        }}
      >
        <div ref={measureRef} className="w-full px-2">
          {doc && contentWidth > 0 && (
            <div className="flex flex-col items-center gap-3">
              {pageList.map((n) => (
                <PageCanvas
                  key={n}
                  doc={doc}
                  pageNumber={n}
                  active={activePages.has(n)}
                  contentWidth={contentWidth}
                  zoom={zoom}
                  dpr={dpr}
                  intrinsic={pageDims.get(n)}
                  defaultAspect={defaultAspect}
                  onIntrinsic={onIntrinsic}
                  registerEl={registerEl}
                />
              ))}
            </div>
          )}
        </div>

        {/* 加载态 */}
        {loading && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-3"
            style={{ background: "var(--ink)" }}
          >
            <div
              className="w-8 h-8 rounded-full animate-spin"
              style={{
                border: "2px solid var(--cream-line)",
                borderTopColor: "var(--ember)",
              }}
            />
            <span className="font-mono text-sm" style={{ color: "var(--cream-dim)" }}>
              {loadingLabel}
            </span>
          </div>
        )}

        {/* 错误态 */}
        {phase === "error" && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center"
            style={{ background: "var(--ink)" }}
          >
            <p className="font-display text-sm" style={{ color: "var(--cream)" }}>
              PDF 加载失败
            </p>
            <p className="font-mono text-xs" style={{ color: "var(--cream-faint)" }}>
              {errorMsg}
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={retry}
                className="flex items-center gap-2 px-4 rounded-full tap font-display text-sm"
                style={{
                  height: 40,
                  color: "var(--ink)",
                  background: "var(--ember)",
                }}
              >
                <IconRefresh size={16} /> 重试
              </button>
              <button
                type="button"
                onClick={onBack}
                className="flex items-center px-4 rounded-full tap font-display text-sm"
                style={{
                  height: 40,
                  color: "var(--cream)",
                  background: "var(--ink-2)",
                  border: "1px solid var(--cream-line)",
                }}
              >
                返回
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 底部缩放栏 */}
      {phase === "ready" && (
        <div
          className={`absolute bottom-0 left-0 right-0 z-20 transition-transform duration-200 ${
            controlsVisible ? "translate-y-0" : "translate-y-full"
          }`}
          style={{
            paddingBottom: "env(safe-area-inset-bottom)",
            background: "var(--ink-2)",
            borderTop: "1px solid var(--cream-line)",
          }}
          onPointerDownCapture={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-center gap-3 px-3 py-2">
            <button
              type="button"
              onClick={zoomOut}
              disabled={zoom <= MIN_ZOOM}
              aria-label="缩小"
              className="flex items-center justify-center rounded-full tap disabled:opacity-40"
              style={{
                width: 40,
                height: 40,
                color: "var(--cream)",
                background: "var(--ink)",
                border: "1px solid var(--cream-line)",
              }}
            >
              <IconMinus size={18} />
            </button>
            <button
              type="button"
              onClick={zoomFit}
              aria-label="适应宽度"
              className="flex items-center justify-center gap-1.5 rounded-full tap px-4"
              style={{
                height: 40,
                minWidth: 88,
                color: "var(--cream-dim)",
                background: "var(--ink)",
                border: "1px solid var(--cream-line)",
              }}
            >
              <IconFullscreen size={15} />
              <span className="font-mono text-xs">{Math.round(zoom * 100)}%</span>
            </button>
            <button
              type="button"
              onClick={zoomIn}
              disabled={zoom >= MAX_ZOOM}
              aria-label="放大"
              className="flex items-center justify-center rounded-full tap disabled:opacity-40"
              style={{
                width: 40,
                height: 40,
                color: "var(--cream)",
                background: "var(--ink)",
                border: "1px solid var(--cream-line)",
              }}
            >
              <IconPlus size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
