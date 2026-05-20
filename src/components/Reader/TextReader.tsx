/**
 * TextReader —— 共享文本阅读器组件（小说 / OPDS 文本均可用）。
 *
 * 行为：
 *  - 主题（ink / cream / sepia）+ 字号 + 行距 + 段首缩进 + 自动滚动 —— 持久化到 localStorage
 *  - 翻页模式：scroll（默认，纵向滚动）/ page（横向整屏切，左右滑或按键）
 *  - 书签：段落级（长按段落 / 上下文菜单），从 props.bookmarks 渲染，回调 add/remove
 *  - TTS：用 window.speechSynthesis 按段落朗读，结束自动翻页（仅 scroll 模式触发滚动到段）
 *  - 替换规则编辑器：在抽屉里编辑 `##regex##repl##` 字符串并回传，立即重新渲染
 *  - 章节切换通过 onPrev/Next，目录通过 onOpenToc，回退通过 onBack
 *
 * 不管：章节加载 / 进度持久化 / 来源源是哪家 —— 交给外层 NovelRead.tsx 编排。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NovelBookmark } from "@/stores/novelsource";
import {
  IconArrowLeft,
  IconChevronRight,
  IconList,
  IconBookmark,
  IconBookmarkFill,
} from "@/components/Icon";

const FONT_KEY = "douytv:novel-font-size";
const LINE_HEIGHT_KEY = "douytv:novel-line-height";
const INDENT_KEY = "douytv:novel-indent";
const THEME_KEY = "douytv:novel-theme";
const AUTOSCROLL_KEY = "douytv:novel-autoscroll-speed";
const PAGE_MODE_KEY = "douytv:novel-page-mode";

type ReadTheme = "ink" | "cream" | "sepia";
type ReadMode = "scroll" | "page";

const THEMES: Record<ReadTheme, { bg: string; fg: string; accent: string }> = {
  ink: { bg: "#0E0F11", fg: "#E8DCC4", accent: "var(--ember)" },
  cream: { bg: "#F2E8D5", fg: "#1A1A1A", accent: "#C24A2A" },
  sepia: { bg: "#22201B", fg: "#D9C9A8", accent: "#D27F3A" },
};

const LINE_HEIGHTS = [1.6, 1.85, 2.1, 2.4] as const;

export interface TextReaderProps {
  content: string;
  chapterTitle: string;
  bookTitle: string;
  chapterIndex: number;
  totalChapters: number;
  bookId: string;
  bookmarks: NovelBookmark[];
  loading?: boolean;
  error?: string | null;
  /** 当前章节的 replaceRegex（source.ruleContent.replaceRegex）—— 提供则启用编辑器 */
  replaceRegex?: string;
  onBack: () => void;
  onOpenToc: () => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  onAddBookmark: (b: NovelBookmark) => void;
  onRemoveBookmark: (id: string) => void;
  /** 保存替换规则（不提供则隐藏编辑器入口） */
  onSaveReplaceRegex?: (rule: string) => void;
}

export default function TextReader(props: TextReaderProps) {
  const {
    content,
    chapterTitle,
    bookTitle,
    chapterIndex,
    totalChapters,
    bookId,
    bookmarks,
    loading,
    error,
    replaceRegex,
    onBack,
    onOpenToc,
    onPrevChapter,
    onNextChapter,
    onAddBookmark,
    onRemoveBookmark,
    onSaveReplaceRegex,
  } = props;

  /* ─────────── 阅读偏好 ─────────── */
  const [fontSize, setFontSize] = useState<number>(() =>
    readNum(FONT_KEY, 16, 12, 28)
  );
  const [theme, setTheme] = useState<ReadTheme>(() => {
    try {
      const v = localStorage.getItem(THEME_KEY);
      return v === "cream" || v === "sepia" ? v : "ink";
    } catch {
      return "ink";
    }
  });
  const [lineHeight, setLineHeight] = useState<number>(() =>
    readFloat(LINE_HEIGHT_KEY, 1.85)
  );
  const [indent, setIndent] = useState<boolean>(() => {
    try {
      return localStorage.getItem(INDENT_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [autoScrollSpeed, setAutoScrollSpeed] = useState<number>(() =>
    readNum(AUTOSCROLL_KEY, 0, 0, 5)
  );
  const [readMode, setReadMode] = useState<ReadMode>(() => {
    try {
      return localStorage.getItem(PAGE_MODE_KEY) === "page" ? "page" : "scroll";
    } catch {
      return "scroll";
    }
  });

  useEffect(() => writeStr(FONT_KEY, String(fontSize)), [fontSize]);
  useEffect(() => writeStr(THEME_KEY, theme), [theme]);
  useEffect(() => writeStr(LINE_HEIGHT_KEY, String(lineHeight)), [lineHeight]);
  useEffect(() => writeStr(INDENT_KEY, indent ? "1" : "0"), [indent]);
  useEffect(() => writeStr(AUTOSCROLL_KEY, String(autoScrollSpeed)), [autoScrollSpeed]);
  useEffect(() => writeStr(PAGE_MODE_KEY, readMode), [readMode]);

  /* ─────────── 段落 + 翻页 ─────────── */
  const paragraphs = useMemo(
    () => content.split(/\n+/).filter((s) => s.trim().length > 0),
    [content]
  );

  // page 模式：每页能容纳多少段（按视口高度估算）
  const [pageIdx, setPageIdx] = useState(0);
  const [pageSize, setPageSize] = useState(8);
  useEffect(() => {
    // 章节切换重置 pageIdx + 滚到顶
    setPageIdx(0);
    if (readMode === "scroll") window.scrollTo({ top: 0 });
  }, [chapterIndex, readMode]);

  useEffect(() => {
    if (readMode !== "page") return;
    const calc = () => {
      // 经验：每段平均 ~3 行 × lineHeight × fontSize；屏幕高度 - 头尾 ~ 180px
      const avgParaHeight = fontSize * lineHeight * 3 + 16;
      const usable = Math.max(200, window.innerHeight - 180);
      setPageSize(Math.max(2, Math.floor(usable / avgParaHeight)));
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, [readMode, fontSize, lineHeight]);

  const totalPages =
    readMode === "page" ? Math.max(1, Math.ceil(paragraphs.length / pageSize)) : 1;
  const visibleParagraphs =
    readMode === "page"
      ? paragraphs.slice(pageIdx * pageSize, (pageIdx + 1) * pageSize)
      : paragraphs;

  const goPrevPage = useCallback(() => {
    if (readMode !== "page") return;
    if (pageIdx > 0) setPageIdx(pageIdx - 1);
    else onPrevChapter();
  }, [readMode, pageIdx, onPrevChapter]);

  const goNextPage = useCallback(() => {
    if (readMode !== "page") return;
    if (pageIdx + 1 < totalPages) setPageIdx(pageIdx + 1);
    else onNextChapter();
  }, [readMode, pageIdx, totalPages, onNextChapter]);

  /* ─────────── 自动滚动（scroll 模式） ─────────── */
  useEffect(() => {
    if (readMode !== "scroll" || autoScrollSpeed === 0) return;
    let raf: number;
    const tick = () => {
      window.scrollBy({ top: autoScrollSpeed * 0.6, behavior: "auto" });
      if (
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 4
      ) {
        if (chapterIndex < totalChapters - 1) onNextChapter();
        else setAutoScrollSpeed(0);
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [autoScrollSpeed, readMode, chapterIndex, totalChapters, onNextChapter]);

  /* ─────────── 键盘 / 触摸翻页 ─────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        if (readMode === "page") goPrevPage();
        else onPrevChapter();
      } else if (e.key === "ArrowRight") {
        if (readMode === "page") goNextPage();
        else onNextChapter();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readMode, onPrevChapter, onNextChapter, goPrevPage, goNextPage]);

  // 触摸滑动（page 模式）
  const touchStartX = useRef(0);
  const onTouchStart = (e: React.TouchEvent) => {
    if (readMode !== "page") return;
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (readMode !== "page") return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) < 40) return;
    if (dx > 0) goPrevPage();
    else goNextPage();
  };

  /* ─────────── TTS ─────────── */
  const [ttsActive, setTtsActive] = useState(false);
  const [ttsParaIdx, setTtsParaIdx] = useState(-1);
  const ttsRate = useRef(1);
  const ttsVoice = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const load = () => {
      const list = window.speechSynthesis.getVoices();
      // 偏好中文
      const cn = list.find((v) => /zh/i.test(v.lang));
      ttsVoice.current = cn ?? list[0] ?? null;
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () =>
      window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  const speakFrom = useCallback(
    (startIdx: number) => {
      if (!window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      let i = startIdx;
      const speakOne = () => {
        if (i >= paragraphs.length) {
          // 末段读完 → 下一章继续（外层 useEffect 会重置 ttsParaIdx）
          if (chapterIndex < totalChapters - 1) {
            onNextChapter();
          } else {
            setTtsActive(false);
            setTtsParaIdx(-1);
          }
          return;
        }
        const u = new SpeechSynthesisUtterance(paragraphs[i]);
        if (ttsVoice.current) u.voice = ttsVoice.current;
        u.rate = ttsRate.current;
        u.onend = () => {
          i++;
          setTtsParaIdx(i);
          // 滚到当前段（scroll 模式）
          const el = document.getElementById(`para-${i}`);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
          speakOne();
        };
        setTtsParaIdx(i);
        window.speechSynthesis.speak(u);
      };
      speakOne();
    },
    [paragraphs, chapterIndex, totalChapters, onNextChapter]
  );

  const startTts = () => {
    setTtsActive(true);
    speakFrom(0);
  };
  const stopTts = () => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setTtsActive(false);
    setTtsParaIdx(-1);
  };
  // 切章自动接读
  useEffect(() => {
    if (!ttsActive) return;
    speakFrom(0);
    return () => {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterIndex]);
  // 卸载时停
  useEffect(() => {
    return () => {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    };
  }, []);

  /* ─────────── 书签 ─────────── */
  const bookmarkedParas = useMemo(() => {
    const set = new Set<number>();
    for (const b of bookmarks) {
      if (b.chapterIndex === chapterIndex && b.paragraphIndex !== undefined) {
        set.add(b.paragraphIndex);
      }
    }
    return set;
  }, [bookmarks, chapterIndex]);

  const findBookmarkId = (paraIdx: number): string | undefined =>
    bookmarks.find(
      (b) => b.chapterIndex === chapterIndex && b.paragraphIndex === paraIdx
    )?.id;

  const toggleParagraphBookmark = (paraIdx: number) => {
    const existing = findBookmarkId(paraIdx);
    if (existing) {
      onRemoveBookmark(existing);
    } else {
      const text = paragraphs[paraIdx] ?? "";
      onAddBookmark({
        id: `bm-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 6)}`,
        bookId,
        chapterIndex,
        chapterTitle,
        paragraphIndex: paraIdx,
        excerpt: text.slice(0, 120),
        createdAt: Date.now(),
      });
    }
  };

  /* ─────────── 抽屉状态 ─────────── */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceDraft, setReplaceDraft] = useState(replaceRegex ?? "");
  useEffect(() => setReplaceDraft(replaceRegex ?? ""), [replaceRegex]);

  const themeStyle = THEMES[theme];

  return (
    <div
      className="min-h-screen"
      style={{ background: themeStyle.bg, color: themeStyle.fg }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* 顶部工具栏 */}
      <div
        className="sticky top-0 z-20 flex items-center gap-2 px-4 py-2"
        style={{
          background: `${themeStyle.bg}E0`,
          backdropFilter: "blur(8px)",
          borderBottom: `1px solid ${themeStyle.fg}22`,
        }}
      >
        <button
          type="button"
          onClick={onBack}
          className="tap"
          style={{ color: themeStyle.fg }}
        >
          <IconArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-mono opacity-60 truncate">
            {bookTitle || "—"}
          </p>
          <p className="text-[12px] font-display font-semibold truncate">
            {chapterTitle || "…"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setBookmarksOpen(true)}
          className="tap"
          style={{ color: themeStyle.fg }}
          title="书签"
        >
          <IconBookmark size={18} />
        </button>
        <button
          type="button"
          onClick={onOpenToc}
          className="tap"
          style={{ color: themeStyle.fg }}
          title="目录"
        >
          <IconList size={18} />
        </button>
      </div>

      {/* 正文 */}
      <div
        className="px-6 py-6 max-w-3xl mx-auto"
        style={{ fontSize: `${fontSize}px`, lineHeight }}
      >
        {loading && <p className="opacity-60">正在读取…</p>}
        {error && (
          <p
            className="p-2 rounded text-[12px] font-mono"
            style={{
              background: "rgba(255,80,80,0.1)",
              color: "#E14F4F",
              border: "1px solid rgba(255,80,80,0.3)",
            }}
          >
            ✗ {error}
          </p>
        )}
        {!loading &&
          !error &&
          visibleParagraphs.map((p, i) => {
            const realIdx =
              readMode === "page" ? pageIdx * pageSize + i : i;
            const bookmarked = bookmarkedParas.has(realIdx);
            const speaking = ttsActive && ttsParaIdx === realIdx;
            return (
              <p
                key={realIdx}
                id={`para-${realIdx}`}
                className="mb-4 relative group cursor-pointer"
                style={{
                  textIndent: indent ? "2em" : 0,
                  background: speaking ? `${themeStyle.accent}22` : "transparent",
                  transition: "background 200ms ease",
                  borderRadius: speaking ? "4px" : 0,
                  padding: speaking ? "4px 8px" : 0,
                  marginLeft: speaking ? "-8px" : 0,
                  marginRight: speaking ? "-8px" : 0,
                }}
                onDoubleClick={() => toggleParagraphBookmark(realIdx)}
                title="双击此段加书签"
              >
                {p}
                {bookmarked && (
                  <span
                    className="absolute -left-5 top-0"
                    style={{ color: themeStyle.accent }}
                  >
                    <IconBookmarkFill size={14} />
                  </span>
                )}
              </p>
            );
          })}

        {/* page 模式底部翻页 */}
        {readMode === "page" && !loading && !error && (
          <div
            className="flex items-center justify-between mt-4 pt-3 border-t"
            style={{ borderColor: `${themeStyle.fg}22` }}
          >
            <button
              type="button"
              onClick={goPrevPage}
              className="px-3 py-1.5 rounded text-[11px] tap"
              style={{
                background: `${themeStyle.fg}11`,
                border: `1px solid ${themeStyle.fg}22`,
                color: themeStyle.fg,
              }}
            >
              ← 上一页
            </button>
            <span className="font-mono text-[10px] opacity-60">
              第 {pageIdx + 1} / {totalPages} 页 · 章 {chapterIndex + 1}/{totalChapters}
            </span>
            <button
              type="button"
              onClick={goNextPage}
              className="px-3 py-1.5 rounded text-[11px] tap"
              style={{
                background: themeStyle.accent,
                color: themeStyle.bg,
              }}
            >
              下一页 →
            </button>
          </div>
        )}

        {/* scroll 模式上下章 */}
        {readMode === "scroll" && (
          <div
            className="flex items-center justify-between mt-8 pt-4 border-t"
            style={{ borderColor: `${themeStyle.fg}22` }}
          >
            <button
              type="button"
              onClick={onPrevChapter}
              disabled={chapterIndex === 0}
              className="px-4 py-2 rounded text-[12px] tap disabled:opacity-30"
              style={{
                background: `${themeStyle.fg}11`,
                border: `1px solid ${themeStyle.fg}22`,
                color: themeStyle.fg,
              }}
            >
              上一章
            </button>
            <span className="font-mono text-[10px] opacity-60">
              {chapterIndex + 1} / {totalChapters}
            </span>
            <button
              type="button"
              onClick={onNextChapter}
              disabled={chapterIndex >= totalChapters - 1}
              className="px-4 py-2 rounded text-[12px] tap disabled:opacity-30"
              style={{
                background: themeStyle.accent,
                color: themeStyle.bg,
              }}
            >
              下一章
            </button>
          </div>
        )}
      </div>

      {/* 浮动控制条 */}
      <div
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 px-2 py-1 rounded-full"
        style={{
          background: `${themeStyle.bg}EE`,
          border: `1px solid ${themeStyle.fg}33`,
        }}
      >
        <button
          type="button"
          onClick={() => setFontSize((f) => Math.max(12, f - 1))}
          className="w-8 h-8 tap text-sm"
          style={{ color: themeStyle.fg }}
        >
          A-
        </button>
        <span className="text-[10px] font-mono opacity-60">{fontSize}</span>
        <button
          type="button"
          onClick={() => setFontSize((f) => Math.min(28, f + 1))}
          className="w-8 h-8 tap text-sm"
          style={{ color: themeStyle.fg }}
        >
          A+
        </button>
        <span className="w-px h-4" style={{ background: `${themeStyle.fg}22` }} />
        {(Object.keys(THEMES) as ReadTheme[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTheme(t)}
            className="w-6 h-6 rounded-full tap"
            style={{
              background: THEMES[t].bg,
              border: `2px solid ${theme === t ? THEMES[t].accent : `${themeStyle.fg}33`}`,
            }}
            title={t}
          />
        ))}
        <span className="w-px h-4" style={{ background: `${themeStyle.fg}22` }} />
        {/* TTS 切换 */}
        <button
          type="button"
          onClick={ttsActive ? stopTts : startTts}
          className="w-8 h-8 tap text-[12px] font-mono"
          style={{ color: ttsActive ? themeStyle.accent : themeStyle.fg }}
          title="听书"
        >
          {ttsActive ? "■" : "♪"}
        </button>
        {/* 自动滚动 */}
        <button
          type="button"
          onClick={() =>
            setAutoScrollSpeed((s) => (s === 0 ? 2 : s >= 5 ? 0 : s + 1))
          }
          className="w-8 h-8 tap text-[10px] font-mono"
          style={{
            color: autoScrollSpeed > 0 ? themeStyle.accent : themeStyle.fg,
          }}
          title="自动滚动"
        >
          {autoScrollSpeed > 0 ? `▶${autoScrollSpeed}` : "▶"}
        </button>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="w-8 h-8 tap text-[14px]"
          style={{ color: themeStyle.fg }}
          title="更多设置"
        >
          ⋯
        </button>
      </div>

      {/* 设置抽屉 */}
      {settingsOpen && (
        <Drawer side="bottom" themeStyle={themeStyle} onClose={() => setSettingsOpen(false)}>
          <p
            className="font-mono text-[10px] tracking-[0.2em] mb-3"
            style={{ color: themeStyle.fg, opacity: 0.6 }}
          >
            READING SETTINGS
          </p>

          <SectionLabel themeFg={themeStyle.fg}>阅读模式</SectionLabel>
          <div className="grid grid-cols-2 gap-1 mb-3">
            {(["scroll", "page"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setReadMode(m)}
                className="py-1.5 rounded text-[11px] tap"
                style={{
                  background:
                    readMode === m ? `${themeStyle.accent}33` : `${themeStyle.fg}11`,
                  color: readMode === m ? themeStyle.accent : themeStyle.fg,
                  border: `1px solid ${themeStyle.fg}22`,
                }}
              >
                {m === "scroll" ? "滚动" : "翻页"}
              </button>
            ))}
          </div>

          <SectionLabel themeFg={themeStyle.fg}>行间距</SectionLabel>
          <div className="grid grid-cols-4 gap-1 mb-3">
            {LINE_HEIGHTS.map((lh) => (
              <button
                key={lh}
                type="button"
                onClick={() => setLineHeight(lh)}
                className="py-1.5 rounded text-[11px] tap font-mono"
                style={{
                  background:
                    lineHeight === lh
                      ? `${themeStyle.accent}33`
                      : `${themeStyle.fg}11`,
                  color: lineHeight === lh ? themeStyle.accent : themeStyle.fg,
                  border: `1px solid ${themeStyle.fg}22`,
                }}
              >
                {lh}
              </button>
            ))}
          </div>

          <div className="mb-3 flex items-center justify-between">
            <p className="text-[11px]" style={{ color: themeStyle.fg }}>
              段首缩进 2 字符
            </p>
            <Toggle
              on={indent}
              onChange={() => setIndent(!indent)}
              themeStyle={themeStyle}
            />
          </div>

          {onSaveReplaceRegex && (
            <button
              type="button"
              onClick={() => {
                setSettingsOpen(false);
                setReplaceOpen(true);
              }}
              className="w-full py-2 rounded text-xs tap mb-2"
              style={{
                background: `${themeStyle.fg}11`,
                color: themeStyle.fg,
                border: `1px solid ${themeStyle.fg}22`,
              }}
            >
              编辑内容净化规则…
            </button>
          )}

          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            className="w-full py-2 rounded text-xs tap"
            style={{
              background: themeStyle.accent,
              color: themeStyle.bg,
            }}
          >
            完成
          </button>
        </Drawer>
      )}

      {/* 替换规则编辑器 */}
      {replaceOpen && onSaveReplaceRegex && (
        <Drawer side="bottom" themeStyle={themeStyle} onClose={() => setReplaceOpen(false)}>
          <p
            className="font-mono text-[10px] tracking-[0.2em] mb-2"
            style={{ color: themeStyle.fg, opacity: 0.6 }}
          >
            CONTENT REPLACE RULES
          </p>
          <p className="text-[11px] mb-3 opacity-80" style={{ color: themeStyle.fg }}>
            格式：<code className="font-mono">##正则##替换##</code> 可重复多组。例如<br />
            <code className="font-mono">##广告.+##</code> 直接删除匹配。
          </p>
          <textarea
            value={replaceDraft}
            onChange={(e) => setReplaceDraft(e.target.value)}
            rows={6}
            spellCheck={false}
            className="w-full p-2 rounded text-[12px] font-mono"
            style={{
              background: `${themeStyle.fg}08`,
              color: themeStyle.fg,
              border: `1px solid ${themeStyle.fg}33`,
              resize: "vertical",
            }}
            placeholder="##广告.+##"
          />
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={() => setReplaceOpen(false)}
              className="flex-1 py-2 rounded text-xs tap"
              style={{
                background: `${themeStyle.fg}11`,
                color: themeStyle.fg,
                border: `1px solid ${themeStyle.fg}22`,
              }}
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => {
                onSaveReplaceRegex(replaceDraft);
                setReplaceOpen(false);
              }}
              className="flex-1 py-2 rounded text-xs tap"
              style={{
                background: themeStyle.accent,
                color: themeStyle.bg,
              }}
            >
              保存并应用
            </button>
          </div>
        </Drawer>
      )}

      {/* 书签抽屉 */}
      {bookmarksOpen && (
        <Drawer side="right" themeStyle={themeStyle} onClose={() => setBookmarksOpen(false)}>
          <p
            className="font-mono text-[10px] tracking-[0.2em] mb-2"
            style={{ color: themeStyle.fg, opacity: 0.6 }}
          >
            BOOKMARKS · {bookmarks.length}
          </p>
          {bookmarks.length === 0 ? (
            <p className="text-[12px] opacity-60" style={{ color: themeStyle.fg }}>
              暂无书签 —— 双击段落即可加书签。
            </p>
          ) : (
            <ul className="space-y-1.5">
              {bookmarks.map((b) => (
                <li
                  key={b.id}
                  className="p-2 rounded"
                  style={{
                    background: `${themeStyle.fg}08`,
                    border: `1px solid ${themeStyle.fg}22`,
                  }}
                >
                  <p
                    className="text-[11px] font-display font-semibold mb-0.5"
                    style={{ color: themeStyle.accent }}
                  >
                    {b.chapterTitle}
                  </p>
                  <p
                    className="text-[11px] opacity-80 line-clamp-2"
                    style={{ color: themeStyle.fg }}
                  >
                    {b.excerpt ?? "—"}
                  </p>
                  <div className="flex justify-between items-center mt-1.5 font-mono text-[10px]">
                    <span className="opacity-50" style={{ color: themeStyle.fg }}>
                      {new Date(b.createdAt).toLocaleDateString()}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveBookmark(b.id)}
                      className="opacity-60 hover:opacity-100 tap"
                      style={{ color: themeStyle.fg }}
                    >
                      删除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Drawer>
      )}

      {/* page 模式 hint */}
      {readMode === "page" && (
        <div
          className="fixed top-1/2 right-2 -translate-y-1/2 opacity-30 pointer-events-none"
          style={{ color: themeStyle.fg }}
        >
          <IconChevronRight size={20} />
        </div>
      )}
    </div>
  );
}

/* ───────────────── 内部 helpers ───────────────── */

function readNum(key: string, fallback: number, min: number, max: number): number {
  try {
    const v = parseInt(localStorage.getItem(key) || String(fallback), 10);
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  } catch {
    return fallback;
  }
}

function readFloat(key: string, fallback: number): number {
  try {
    const v = parseFloat(localStorage.getItem(key) || String(fallback));
    return Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function writeStr(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

function Drawer(props: {
  side: "bottom" | "right";
  themeStyle: { bg: string; fg: string; accent: string };
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { side, themeStyle, onClose, children } = props;
  return (
    <div
      className={`fixed inset-0 z-30 flex ${
        side === "bottom" ? "items-end" : "justify-end"
      }`}
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={onClose}
    >
      <div
        className={`${
          side === "bottom" ? "w-full rounded-t-2xl" : "w-80 max-w-full h-full overflow-y-auto"
        } p-4`}
        style={{
          background: themeStyle.bg,
          borderTop: side === "bottom" ? `1px solid ${themeStyle.fg}22` : undefined,
          borderLeft: side === "right" ? `1px solid ${themeStyle.fg}22` : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function SectionLabel(props: { themeFg: string; children: React.ReactNode }) {
  return (
    <p className="text-[11px] mb-1" style={{ color: props.themeFg }}>
      {props.children}
    </p>
  );
}

function Toggle(props: {
  on: boolean;
  onChange: () => void;
  themeStyle: { bg: string; fg: string; accent: string };
}) {
  return (
    <button
      type="button"
      onClick={props.onChange}
      className="relative w-11 h-6 rounded-full transition-all shrink-0"
      style={{
        background: props.on ? props.themeStyle.accent : `${props.themeStyle.fg}22`,
      }}
    >
      <span
        className="absolute top-0.5 w-5 h-5 rounded-full transition-all"
        style={{
          left: props.on ? "calc(100% - 22px)" : "2px",
          background: props.on ? props.themeStyle.bg : props.themeStyle.fg,
        }}
      />
    </button>
  );
}
