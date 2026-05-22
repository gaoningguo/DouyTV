/**
 * ImageReader —— 共享漫画阅读器组件。
 *
 * 三种模式：
 *  - vertical: 长条流（webtoon），向下滚动；接近底部自动触发 onNextChapter
 *  - ltr: 横向左→右翻页（西式漫画习惯）
 *  - rtl: 横向右→左翻页（日漫习惯）
 *
 * 增强（PR3）：
 *  - tap zones：左/中/右 → 上一页 / 切工具栏显隐 / 下一页（横向模式）
 *  - 双页对开：横向 LTR/RTL，桌面 / 横屏时把两张连续图横排显示
 *  - 亮度遮罩：0-100，通过半透明黑色蒙层在桌面端模拟"屏幕变暗"
 *  - 预下载缓存：所有 imgUrls 都已经过 wrapImage() 走 dyproxy，浏览器有图片缓存
 *  - webtoon gap fill：垂直模式滚到 80% 自动触发下一章载入
 *
 * 不处理：图片字节抓取 / IndexedDB 缓存（PR5 可加）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconArrowLeft,
  IconList,
} from "@/components/Icon";

type ReadMode = "vertical" | "ltr" | "rtl";
type FitMode = "width" | "height" | "contain";

const MODE_KEY = "douytv:manga-read-mode";
const FIT_KEY = "douytv:manga-fit";
const DOUBLE_KEY = "douytv:manga-double-page";
const BRIGHT_KEY = "douytv:manga-brightness";

export interface ImageReaderProps {
  /** 已经 wrapImage 过的当前章节图片 URL */
  imgUrls: string[];
  /** 下一章图片 URL（已 wrap）—— 用于预下载 + webtoon 续读 */
  nextImgUrls?: string[];
  mangaTitle: string;
  chapterTitle: string;
  chapterIndex: number;
  totalChapters: number;
  loading?: boolean;
  error?: string | null;
  onBack: () => void;
  onOpenToc: () => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  /** 阅读位置回调（chapterIndex × pageIdx）—— 外层用来持久化进度 */
  onPositionChange?: (pageIdx: number, pageCount: number) => void;
}

export default function ImageReader(props: ImageReaderProps) {
  const {
    imgUrls,
    nextImgUrls,
    mangaTitle,
    chapterTitle,
    chapterIndex,
    totalChapters,
    loading,
    error,
    onBack,
    onOpenToc,
    onPrevChapter,
    onNextChapter,
    onPositionChange,
  } = props;

  /* ─────── 阅读偏好 ─────── */
  const [mode, setMode] = useState<ReadMode>(() => {
    try {
      const v = localStorage.getItem(MODE_KEY);
      return v === "ltr" || v === "rtl" ? (v as ReadMode) : "vertical";
    } catch {
      return "vertical";
    }
  });
  const [fit, setFit] = useState<FitMode>(() => {
    try {
      const v = localStorage.getItem(FIT_KEY);
      return v === "height" || v === "contain" ? (v as FitMode) : "width";
    } catch {
      return "width";
    }
  });
  const [doublePage, setDoublePage] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DOUBLE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [brightness, setBrightness] = useState<number>(() => {
    try {
      const v = parseInt(localStorage.getItem(BRIGHT_KEY) || "100", 10);
      return Number.isFinite(v) ? Math.max(20, Math.min(100, v)) : 100;
    } catch {
      return 100;
    }
  });

  useEffect(() => writeStr(MODE_KEY, mode), [mode]);
  useEffect(() => writeStr(FIT_KEY, fit), [fit]);
  useEffect(() => writeStr(DOUBLE_KEY, doublePage ? "1" : "0"), [doublePage]);
  useEffect(() => writeStr(BRIGHT_KEY, String(brightness)), [brightness]);

  /* ─────── 横向模式翻页 ─────── */
  const [pageIdx, setPageIdx] = useState(0);
  useEffect(() => setPageIdx(0), [chapterIndex]); // 切章节回到第一页

  // 双页步长：双开时一次跳 2 张
  const step = doublePage && mode !== "vertical" ? 2 : 1;

  const goPrevPage = useCallback(() => {
    if (mode === "vertical") {
      onPrevChapter();
      return;
    }
    if (pageIdx >= step) setPageIdx(pageIdx - step);
    else onPrevChapter();
  }, [mode, pageIdx, step, onPrevChapter]);

  const goNextPage = useCallback(() => {
    if (mode === "vertical") {
      onNextChapter();
      return;
    }
    if (pageIdx + step < imgUrls.length) setPageIdx(pageIdx + step);
    else onNextChapter();
  }, [mode, pageIdx, step, imgUrls.length, onNextChapter]);

  // 持久化进度
  useEffect(() => {
    if (onPositionChange && imgUrls.length > 0) {
      onPositionChange(pageIdx, imgUrls.length);
    }
  }, [pageIdx, imgUrls.length, onPositionChange]);

  /* ─────── 键盘 ─────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode === "vertical") {
        if (e.key === "ArrowLeft") onPrevChapter();
        else if (e.key === "ArrowRight") onNextChapter();
        return;
      }
      const left = mode === "rtl" ? goNextPage : goPrevPage;
      const right = mode === "rtl" ? goPrevPage : goNextPage;
      if (e.key === "ArrowLeft") left();
      else if (e.key === "ArrowRight") right();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, goPrevPage, goNextPage, onPrevChapter, onNextChapter]);

  /* ─────── 预下载下一章（horizontal）/ webtoon gap fill（vertical） ─────── */
  // 隐藏 <link rel="preload"> 让浏览器先抓 5 张
  useEffect(() => {
    if (!nextImgUrls || nextImgUrls.length === 0) return;
    const links: HTMLLinkElement[] = [];
    for (const u of nextImgUrls.slice(0, 5)) {
      if (!u) continue;
      const l = document.createElement("link");
      l.rel = "preload";
      l.as = "image";
      l.href = u;
      document.head.appendChild(l);
      links.push(l);
    }
    return () => {
      links.forEach((l) => l.parentNode?.removeChild(l));
    };
  }, [nextImgUrls]);

  // vertical 模式：滚到 80% 自动触发下一章预载入（外层通过新 chapter 拿数据时会更新 imgUrls）
  const tailMarkerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mode !== "vertical" || !tailMarkerRef.current) return;
    const target = tailMarkerRef.current;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && chapterIndex < totalChapters - 1) {
            onNextChapter();
          }
        }
      },
      { rootMargin: "300px 0px 0px 0px" }
    );
    io.observe(target);
    return () => io.disconnect();
  }, [mode, chapterIndex, totalChapters, onNextChapter, imgUrls.length]);

  /* ─────── 工具栏显隐（tap 中部） ─────── */
  const [chromeVisible, setChromeVisible] = useState(true);

  /* ─────── 设置抽屉 ─────── */
  const [showSettings, setShowSettings] = useState(false);

  const imgStyle = imgStyleFor(fit);

  return (
    <div
      className={
        mode === "vertical"
          ? "min-h-screen bg-ink text-cream"
          : "h-screen bg-ink text-cream overflow-hidden flex flex-col"
      }
    >
      {/* 顶部工具栏 —— 横向 / 隐藏时不渲染。需自管 safe-area，因为路由 /manga/read 是
          App.tsx 的 hideNav 范围（沉浸页，外层不加 padding-top/left/right）。*/}
      {chromeVisible && (
        <div
          className="sticky top-0 z-20 flex items-center gap-2 py-2 backdrop-blur-md shrink-0"
          style={{
            background: "rgba(14,15,17,0.92)",
            borderBottom: "1px solid var(--cream-line)",
            paddingTop: "max(env(safe-area-inset-top), 8px)",
            paddingLeft: "calc(env(safe-area-inset-left) + 16px)",
            paddingRight: "calc(env(safe-area-inset-right) + 16px)",
          }}
        >
          <button
            type="button"
            onClick={onBack}
            className="tap text-cream"
          >
            <IconArrowLeft size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-mono text-cream-faint truncate">
              {mangaTitle || "—"}
            </p>
            <p className="text-[12px] font-display font-semibold truncate">
              {chapterTitle || "…"} · {chapterIndex + 1}/{totalChapters}
              {mode !== "vertical" && imgUrls.length > 0 &&
                ` · 页 ${pageIdx + 1}${doublePage && pageIdx + 1 < imgUrls.length ? `-${pageIdx + 2}` : ""}/${imgUrls.length}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="tap text-cream text-sm"
            title="阅读设置"
          >
            ⋯
          </button>
          <button
            type="button"
            onClick={onOpenToc}
            className="tap text-cream"
            title="目录"
          >
            <IconList size={18} />
          </button>
        </div>
      )}

      {mode === "vertical" ? (
        <VerticalPanel
          loading={loading}
          error={error ?? null}
          imgUrls={imgUrls}
          chapterIndex={chapterIndex}
          totalChapters={totalChapters}
          onPrevChapter={onPrevChapter}
          onNextChapter={onNextChapter}
          tailMarkerRef={tailMarkerRef}
        />
      ) : (
        <HorizontalPanel
          loading={loading}
          error={error ?? null}
          imgUrls={imgUrls}
          pageIdx={pageIdx}
          rtl={mode === "rtl"}
          doublePage={doublePage}
          imgStyle={imgStyle}
          onPrevPage={goPrevPage}
          onNextPage={goNextPage}
          onToggleChrome={() => setChromeVisible((v) => !v)}
        />
      )}

      {/* 亮度遮罩 */}
      {brightness < 100 && (
        <div
          className="fixed inset-0 pointer-events-none z-10"
          style={{
            background: `rgba(0,0,0,${(100 - brightness) / 100})`,
          }}
        />
      )}

      {/* 设置抽屉 */}
      {showSettings && (
        <div
          className="fixed inset-0 z-30 flex items-end"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setShowSettings(false)}
        >
          <div
            className="w-full p-4 rounded-t-2xl bg-ink animate-sheet"
            style={{
              borderTop: "1px solid var(--cream-line)",
              paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)",
              paddingLeft: "calc(env(safe-area-inset-left) + 16px)",
              paddingRight: "calc(env(safe-area-inset-right) + 16px)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-3">
              READING MODE
            </p>
            <div className="grid grid-cols-3 gap-1.5 mb-3">
              {(
                [
                  { id: "vertical", label: "纵向长条" },
                  { id: "ltr", label: "横向 L→R" },
                  { id: "rtl", label: "横向 R→L" },
                ] as { id: ReadMode; label: string }[]
              ).map((m) => (
                <ChipBtn
                  key={m.id}
                  active={mode === m.id}
                  onClick={() => setMode(m.id)}
                >
                  {m.label}
                </ChipBtn>
              ))}
            </div>

            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
              FIT
            </p>
            <div className="grid grid-cols-3 gap-1.5 mb-3">
              {(
                [
                  { id: "width", label: "宽度填满" },
                  { id: "height", label: "高度填满" },
                  { id: "contain", label: "完整显示" },
                ] as { id: FitMode; label: string }[]
              ).map((f) => (
                <ChipBtn
                  key={f.id}
                  active={fit === f.id}
                  onClick={() => setFit(f.id)}
                >
                  {f.label}
                </ChipBtn>
              ))}
            </div>

            {/* 双页对开（仅横向有效） */}
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[11px] text-cream">
                双页对开
                <span className="ml-1 text-[10px] text-cream-faint">
                  （仅横向模式）
                </span>
              </p>
              <button
                type="button"
                onClick={() => setDoublePage(!doublePage)}
                disabled={mode === "vertical"}
                className="relative w-11 h-6 rounded-full transition-all shrink-0 disabled:opacity-40"
                style={{
                  background: doublePage ? "var(--ember)" : "var(--ink-edge)",
                }}
              >
                <span
                  className="absolute top-0.5 w-5 h-5 rounded-full transition-all"
                  style={{
                    left: doublePage ? "calc(100% - 22px)" : "2px",
                    background: doublePage ? "var(--ink)" : "var(--cream)",
                  }}
                />
              </button>
            </div>

            {/* 亮度 */}
            <div className="mb-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-cream">屏幕亮度</p>
                <span className="font-mono text-[10px] text-cream-faint">
                  {brightness}%
                </span>
              </div>
              <input
                type="range"
                min={20}
                max={100}
                value={brightness}
                onChange={(e) => setBrightness(parseInt(e.target.value, 10))}
                className="w-full"
                style={{ accentColor: "var(--ember)" }}
              />
            </div>

            {nextImgUrls && (
              <p className="text-[10px] text-cream-faint mb-3">
                下一章已预加载 {nextImgUrls.length} 张
              </p>
            )}

            <button
              type="button"
              onClick={() => setShowSettings(false)}
              className="w-full py-2 rounded text-xs tap text-cream"
              style={{
                background: "var(--ink-3)",
                border: "1px solid var(--cream-line)",
              }}
            >
              完成
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────────── Vertical 模式 ───────────────── */

function VerticalPanel({
  loading,
  error,
  imgUrls,
  chapterIndex,
  totalChapters,
  onPrevChapter,
  onNextChapter,
  tailMarkerRef,
}: {
  loading?: boolean;
  error: string | null;
  imgUrls: string[];
  chapterIndex: number;
  totalChapters: number;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  tailMarkerRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div className="max-w-3xl mx-auto">
      {loading && (
        <p className="text-center py-8 text-cream-faint text-sm">读取中…</p>
      )}
      {error && (
        <p
          className="m-3 p-2 rounded text-[12px] font-mono"
          style={{
            background: "rgba(255,80,80,0.1)",
            color: "#FF6B6B",
            border: "1px solid rgba(255,80,80,0.3)",
          }}
        >
          ✗ {error}
        </p>
      )}
      {!loading &&
        !error &&
        imgUrls.map((src, i) => (
          <img
            key={i}
            src={src}
            alt={`p${i}`}
            loading="lazy"
            className="block w-full"
            referrerPolicy="no-referrer"
          />
        ))}
      {!loading && imgUrls.length === 0 && !error && (
        <p className="text-center py-8 text-cream-faint text-sm">
          未提取到分镜图（检查 rulePages 规则）
        </p>
      )}
      {/* 滚动检测哨兵 —— 80% 位置触发下一章 */}
      <div ref={tailMarkerRef} style={{ height: 1 }} />
      <div className="flex items-center justify-between p-4">
        <button
          type="button"
          onClick={onPrevChapter}
          disabled={chapterIndex === 0}
          className="px-4 py-2 rounded text-[12px] tap disabled:opacity-30 text-cream"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
        >
          上一章
        </button>
        <span className="font-mono text-[10px] text-cream-faint">
          {chapterIndex + 1} / {totalChapters}
        </span>
        <button
          type="button"
          onClick={onNextChapter}
          disabled={chapterIndex >= totalChapters - 1}
          className="px-4 py-2 rounded text-[12px] font-display font-semibold tap disabled:opacity-30"
          style={{ background: "var(--ember)", color: "var(--ink)" }}
        >
          下一章
        </button>
      </div>
    </div>
  );
}

/* ───────────────── Horizontal 模式 ───────────────── */

function HorizontalPanel({
  loading,
  error,
  imgUrls,
  pageIdx,
  rtl,
  doublePage,
  imgStyle,
  onPrevPage,
  onNextPage,
  onToggleChrome,
}: {
  loading?: boolean;
  error: string | null;
  imgUrls: string[];
  pageIdx: number;
  rtl: boolean;
  doublePage: boolean;
  imgStyle: React.CSSProperties;
  onPrevPage: () => void;
  onNextPage: () => void;
  onToggleChrome: () => void;
}) {
  // tap zone：左 1/3 / 中 1/3 (切工具栏) / 右 1/3。rtl 时方向取反。
  const onClickArea = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const third = rect.width / 3;
    if (x < third) (rtl ? onNextPage : onPrevPage)();
    else if (x > rect.width - third) (rtl ? onPrevPage : onNextPage)();
    else onToggleChrome();
  };

  // 触摸滑动支持
  const touchStartX = useRef(0);
  const onTouchStart = (e: React.TouchEvent) =>
    (touchStartX.current = e.touches[0].clientX);
  const onTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) < 40) return;
    if (dx > 0) (rtl ? onNextPage : onPrevPage)();
    else (rtl ? onPrevPage : onNextPage)();
  };

  // 当前 + 下一张（双页时）
  const showSecondary =
    doublePage && pageIdx + 1 < imgUrls.length && imgUrls[pageIdx + 1];

  // 单页 / 双页布局
  const flexDirection = rtl ? "row-reverse" : "row";

  return (
    <div
      className="flex-1 flex items-center justify-center relative bg-ink select-none"
      onClick={onClickArea}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {loading && <p className="text-cream-faint text-sm">读取中…</p>}
      {error && (
        <p
          className="m-3 p-2 rounded text-[12px] font-mono max-w-md"
          style={{
            background: "rgba(255,80,80,0.1)",
            color: "#FF6B6B",
            border: "1px solid rgba(255,80,80,0.3)",
          }}
        >
          ✗ {error}
        </p>
      )}
      {!loading && !error && imgUrls[pageIdx] && (
        <div
          className="flex items-center justify-center h-full w-full"
          style={{ flexDirection }}
        >
          <img
            src={imgUrls[pageIdx]}
            alt={`p${pageIdx}`}
            style={
              showSecondary
                ? { ...imgStyle, maxWidth: "50%" }
                : imgStyle
            }
            referrerPolicy="no-referrer"
          />
          {showSecondary && (
            <img
              src={imgUrls[pageIdx + 1]}
              alt={`p${pageIdx + 1}`}
              style={{ ...imgStyle, maxWidth: "50%" }}
              referrerPolicy="no-referrer"
            />
          )}
        </div>
      )}
      {!loading && imgUrls.length === 0 && !error && (
        <p className="text-cream-faint text-sm">未提取到分镜图</p>
      )}
      {/* tap zone hints */}
      <span
        className="absolute top-1/2 -translate-y-1/2 text-[10px] font-mono text-cream-faint opacity-50 pointer-events-none"
        style={{ left: 8 }}
      >
        {rtl ? "→" : "←"}
      </span>
      <span
        className="absolute top-1/2 -translate-y-1/2 text-[10px] font-mono text-cream-faint opacity-50 pointer-events-none"
        style={{ right: 8 }}
      >
        {rtl ? "←" : "→"}
      </span>
    </div>
  );
}

/* ───────────────── helpers ───────────────── */

function imgStyleFor(fit: FitMode): React.CSSProperties {
  if (fit === "height")
    return {
      maxHeight: "100vh",
      width: "auto",
      display: "block",
      margin: "0 auto",
    };
  if (fit === "contain")
    return {
      maxHeight: "100vh",
      maxWidth: "100%",
      width: "auto",
      display: "block",
      margin: "0 auto",
    };
  return { width: "100%", display: "block" };
}

function writeStr(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

function ChipBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="py-2 rounded text-[11px] tap font-display font-semibold"
      style={{
        background: active ? "var(--ember-soft)" : "var(--ink-3)",
        color: active ? "var(--ember)" : "var(--cream)",
        border: `1px solid ${active ? "rgba(255,107,53,0.4)" : "var(--cream-line)"}`,
      }}
    >
      {children}
    </button>
  );
}
