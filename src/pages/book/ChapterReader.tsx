import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appAlert } from "@/components/AppDialog";
import { Sheet } from "@/components/Sheet";
import {
  IconArrowLeft,
  IconList,
  IconPause,
  IconPlay,
  IconSettings,
  IconChevronUp,
  IconChevronDown,
  IconClose,
} from "@/components/Icon";
import {
  getBookChapterContent,
  getBookChapters,
  type BookChapter,
} from "@/lib/book";
import {
  synthesizeBookTts,
  listBookTtsVoices,
} from "@/lib/book/tts";
import type { BookTtsVoice } from "@/lib/book/types";
import {
  chunkTtsText,
  sanitizeTtsText,
  formatDurationTime,
  type TtsChunk,
} from "@/lib/book/ttsChunk";
import {
  getCachedTtsChunk,
  putCachedTtsChunk,
  buildTtsChunkKey,
} from "@/lib/book/blobCache";
import { useBookStore } from "@/stores/book";
import { wrapImage } from "@/lib/proxy";

// 章节型(Legado)阅读器 —— 对齐 MoonTVPlus ChapterReader。
//   - 翻页 / 滚动 双模式(翻页用 scroll-snap + tap 区域;滚动连续)
//   - 进度定位 href#scroll=ratio,20s + 离开时存,恢复到上次比例
//   - 图片章节(<img>)dangerouslySetInnerHTML,图片走 dyproxy
//   - 完整 TTS:整章 chunk 切分 + 音色/语速/音调/音量 + seek + 上/下一块 +
//     自动续播 + 60% 预取 + IndexedDB 音频缓存
// 数据全部走 book 引擎(script_http_bytes 绕 CORS + GBK 解码)。

const READER_THEMES: Record<string, { bg: string; fg: string; panel: string }> = {
  sepia: { bg: "#f4ecd8", fg: "#5b4636", panel: "#f7f1e7" },
  paper: { bg: "#ffffff", fg: "#1a1a1a", panel: "#f4f4f4" },
  dark: { bg: "#0e0f11", fg: "#c9c4bb", panel: "#050506" },
};

const TTS_RATE_STEPS = [-20, -10, 0, 10, 20, 35];
const TTS_PITCH_STEPS = [-10, 0, 10, 20];
const TTS_VOLUME_STEPS = [-10, 0, 10, 20];
const CHAPTER_SAVE_INTERVAL_MS = 20000;
const VOICES_CACHE_KEY = "douytv:book-tts-voices";

function formatSigned(value: number, unit: "%" | "Hz"): string {
  return `${value >= 0 ? "+" : ""}${value}${unit}`;
}

function parseSigned(value: string): number {
  const m = String(value || "").match(/([+-]?\d+)(?:%|Hz)/);
  return m ? Number(m[1]) : 0;
}

/** 章节滚动进度定位:href#scroll=ratio */
function encodeScrollLocator(href: string, ratio: number): string {
  return `${href}#scroll=${Math.min(Math.max(ratio, 0), 1).toFixed(6)}`;
}
function parseScrollRatio(value: string): number {
  const m = String(value || "").match(/(?:^|[#&?])scroll=([0-9.]+)/);
  return m ? Math.min(Math.max(Number(m[1]), 0), 1) : 0;
}

interface ChapterReaderProps {
  sourceId: string;
  chapterHref: string;
  tocHref?: string;
  bookId: string;
  bookTitle: string;
  onBack: () => void;
  onNavigateChapter: (href: string) => void;
}

export default function ChapterReader({
  sourceId,
  chapterHref,
  tocHref,
  bookId,
  bookTitle,
  onBack,
  onNavigateChapter,
}: ChapterReaderProps) {
  const settings = useBookStore((s) => s.settings);
  const setSettings = useBookStore((s) => s.setSettings);
  const upsertRecord = useBookStore((s) => s.upsertRecord);

  const [content, setContent] = useState("");
  const [chapterTitle, setChapterTitle] = useState("");
  const [prevHref, setPrevHref] = useState<string | undefined>();
  const [nextHref, setNextHref] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showControls, setShowControls] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chapterListOpen, setChapterListOpen] = useState(false);
  const [chapterListDesc, setChapterListDesc] = useState(false);
  const [chapters, setChapters] = useState<BookChapter[]>([]);
  const [mode, setMode] = useState<"paginated" | "scrolled">(
    () => (localStorage.getItem("douytv:book-chapter-mode") as "paginated" | "scrolled") || "scrolled"
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const restoredRef = useRef("");
  const activeChapterRef = useRef<HTMLButtonElement>(null);

  const theme = READER_THEMES[settings.theme] || READER_THEMES.sepia;

  // 图片章节判定
  const isImageChapter = /<img\b/i.test(content);
  const paragraphs = useMemo(
    () =>
      isImageChapter
        ? []
        : content
            .replace(/<[^>]+>/g, "")
            .split(/\n+/)
            .map((p) => p.trim())
            .filter(Boolean),
    [content, isImageChapter]
  );
  // 图片章节:把 <img src> 走 dyproxy
  const imageHtml = useMemo(() => {
    if (!isImageChapter) return "";
    return content.replace(
      /<img\b([^>]*?)\bsrc=(["'])(.*?)\2([^>]*)>/gi,
      (_m, before, q, src, after) => {
        const proxied = wrapImage(src) || src;
        return `<img${before}src=${q}${proxied}${q}${after} referrerpolicy="no-referrer" style="max-width:100%;display:block;margin:0 auto;">`;
      }
    );
  }, [content, isImageChapter]);

  // ── 加载章节内容 + 目录 ──
  const load = useCallback(
    async (href: string) => {
      setLoading(true);
      setError("");
      stopTts(true);
      try {
        const ch = await getBookChapterContent(sourceId, href, tocHref);
        setContent(ch.content);
        setChapterTitle(ch.title || bookTitle);
        setPrevHref(ch.previousHref);
        setNextHref(ch.nextHref);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourceId, tocHref, bookTitle]
  );

  useEffect(() => {
    void load(chapterHref);
  }, [chapterHref, load]);

  useEffect(() => {
    if (!tocHref) return;
    getBookChapters(sourceId, tocHref)
      .then(setChapters)
      .catch(() => setChapters([]));
  }, [sourceId, tocHref]);

  useEffect(() => {
    localStorage.setItem("douytv:book-chapter-mode", mode);
  }, [mode]);

  const orderedChapters = useMemo(
    () => (chapterListDesc ? [...chapters].reverse() : chapters),
    [chapters, chapterListDesc]
  );

  const chapterIndex = useMemo(
    () => chapters.findIndex((c) => c.href === chapterHref),
    [chapters, chapterHref]
  );

  // ── 进度存储:滚动比例 + 章节序号 ──
  const saveRef = useRef(0);
  const persistProgress = useCallback(() => {
    if (!bookId || loading) return;
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const ratio = max > 0 ? el.scrollTop / max : 0;
    const chapterCount = chapters.length || 1;
    const idx = chapterIndex >= 0 ? chapterIndex : 0;
    const progressPercent = Math.min(
      Math.max(((idx + ratio) / chapterCount) * 100, 0),
      100
    );
    upsertRecord({
      sourceId,
      sourceName: "",
      bookId,
      title: bookTitle,
      format: "chapters",
      locator: {
        type: "chapter",
        value: encodeScrollLocator(chapterHref, ratio),
        href: chapterHref,
        chapterTitle,
      },
      progressPercent,
      chapterTitle,
      chapterHref,
      saveTime: Date.now(),
    });
  }, [
    bookId,
    loading,
    chapters.length,
    chapterIndex,
    sourceId,
    bookTitle,
    chapterHref,
    chapterTitle,
    upsertRecord,
  ]);

  const scheduleSave = useCallback(() => {
    const now = Date.now();
    if (now - saveRef.current < CHAPTER_SAVE_INTERVAL_MS) return;
    saveRef.current = now;
    persistProgress();
  }, [persistProgress]);

  // 滚动 → 触发存储(节流)
  const onScroll = useCallback(() => {
    scheduleSave();
  }, [scheduleSave]);

  // 离开时 flush
  useEffect(() => {
    const flush = () => persistProgress();
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      persistProgress();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [persistProgress]);

  // 内容加载后恢复上次滚动比例
  useEffect(() => {
    if (loading || !content) return;
    const key = `${sourceId}:${chapterHref}`;
    if (restoredRef.current === key) return;
    restoredRef.current = key;
    const record = useBookStore.getState().getRecord(sourceId, bookId);
    if (!record || record.chapterHref !== chapterHref) {
      scrollRef.current?.scrollTo({ top: 0 });
      return;
    }
    const ratio = parseScrollRatio(record.locator.value);
    // rAF 重试等布局稳定
    let tries = 0;
    const restore = () => {
      const el = scrollRef.current;
      if (!el) return;
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 0 && tries < 20) {
        tries += 1;
        window.setTimeout(restore, 100);
        return;
      }
      el.scrollTo({ top: max * ratio, behavior: "auto" });
    };
    window.setTimeout(restore, 0);
  }, [loading, content, sourceId, chapterHref, bookId]);

  const gotoChapter = useCallback(
    (href?: string) => {
      if (!href) return;
      persistProgress();
      restoredRef.current = "";
      onNavigateChapter(href);
    },
    [persistProgress, onNavigateChapter]
  );

  // 翻页模式:tap 区域左/右翻页,中间切控件
  const turnPage = useCallback(
    (dir: -1 | 1) => {
      const el = scrollRef.current;
      if (!el) return;
      const max = el.scrollHeight - el.clientHeight;
      const delta = Math.max(240, el.clientHeight * 0.88) * dir;
      const target = el.scrollTop + delta;
      if (dir > 0 && el.scrollTop >= max - 8) {
        gotoChapter(nextHref);
        return;
      }
      if (dir < 0 && el.scrollTop <= 8) {
        gotoChapter(prevHref);
        return;
      }
      el.scrollTo({ top: Math.min(Math.max(target, 0), max), behavior: "smooth" });
    },
    [gotoChapter, nextHref, prevHref]
  );

  const onReaderClick = useCallback(
    (e: React.MouseEvent) => {
      if (mode === "scrolled") {
        setShowControls((v) => !v);
        return;
      }
      const w = e.currentTarget.clientWidth;
      const x = e.clientX;
      if (x < w / 3) turnPage(-1);
      else if (x > (w * 2) / 3) turnPage(1);
      else setShowControls((v) => !v);
    },
    [mode, turnPage]
  );

  // ─── TTS ───────────────────────────────────────────────
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [ttsBarVisible, setTtsBarVisible] = useState(false);
  const [ttsPanelOpen, setTtsPanelOpen] = useState(false);
  const [ttsVoices, setTtsVoices] = useState<BookTtsVoice[]>([]);
  const [chunks, setChunks] = useState<TtsChunk[]>([]);
  const [ttsIndex, setTtsIndex] = useState(0);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [ttsLoadingChunk, setTtsLoadingChunk] = useState<number | null>(null);
  const [ttsCurrentTime, setTtsCurrentTime] = useState(0);
  const [ttsDuration, setTtsDuration] = useState(0);
  const [ttsSeeking, setTtsSeeking] = useState(false);
  const [ttsSeekValue, setTtsSeekValue] = useState(0);
  const prefetchedRef = useRef<Set<number>>(new Set());
  const blobUrlRef = useRef<string | null>(null);

  // 音色列表(会话缓存 + localStorage)
  useEffect(() => {
    if (!ttsBarVisible || ttsVoices.length > 0) return;
    try {
      const cached = localStorage.getItem(VOICES_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as BookTtsVoice[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setTtsVoices(parsed);
          return;
        }
      }
    } catch {
      /* ignore */
    }
    listBookTtsVoices()
      .then((v) => {
        setTtsVoices(v);
        try {
          localStorage.setItem(VOICES_CACHE_KEY, JSON.stringify(v));
        } catch {
          /* ignore */
        }
      })
      .catch(() => undefined);
  }, [ttsBarVisible, ttsVoices.length]);

  function stopTts(hard = false) {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      if (hard) audio.src = "";
    }
    setTtsPlaying(false);
    if (hard) {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      prefetchedRef.current.clear();
    }
  }

  const getChunkPlainText = useCallback(() => {
    const plain = isImageChapter
      ? ""
      : sanitizeTtsText(content.replace(/<[^>]+>/g, ""));
    return plain;
  }, [content, isImageChapter]);

  // 合成 + 缓存单块音频 → object URL
  const fetchChunkUrl = useCallback(
    async (chunk: TtsChunk): Promise<string> => {
      const cacheKeyInput = {
        sourceId,
        bookId,
        chapterHref,
        text: chunk.text,
        voice: settings.ttsVoice,
        rate: settings.ttsRate,
        pitch: settings.ttsPitch,
        volume: settings.ttsVolume,
      };
      const key = buildTtsChunkKey(cacheKeyInput);
      const cached = await getCachedTtsChunk(key);
      if (cached) return URL.createObjectURL(cached.blob);
      const { blob } = await synthesizeBookTts({
        text: chunk.text,
        voice: settings.ttsVoice,
        rate: settings.ttsRate,
        pitch: settings.ttsPitch,
        volume: settings.ttsVolume,
      });
      void putCachedTtsChunk({
        key,
        sourceId,
        bookId,
        blob,
        mimeType: blob.type || "audio/mpeg",
        updatedAt: Date.now(),
      });
      return URL.createObjectURL(blob);
    },
    [sourceId, bookId, chapterHref, settings.ttsVoice, settings.ttsRate, settings.ttsPitch, settings.ttsVolume]
  );

  const playChunk = useCallback(
    async (index: number) => {
      if (index < 0 || index >= chunks.length) return;
      setTtsLoadingChunk(index);
      try {
        const url = await fetchChunkUrl(chunks[index]);
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = url;
        if (!audioRef.current) audioRef.current = new Audio();
        audioRef.current.src = url;
        await audioRef.current.play();
        setTtsIndex(index);
        setTtsPlaying(true);
      } catch (e) {
        setTtsPlaying(false);
        await appAlert(`朗读失败: ${(e as Error).message}`, { tone: "danger" });
      } finally {
        setTtsLoadingChunk(null);
      }
    },
    [chunks, fetchChunkUrl]
  );

  // 音频事件:自动续播 + 60% 预取 + 时间同步
  useEffect(() => {
    if (!audioRef.current) audioRef.current = new Audio();
    const audio = audioRef.current;
    const onEnded = () => {
      setTtsCurrentTime(0);
      const next = ttsIndex + 1;
      if (next < chunks.length) void playChunk(next);
      else setTtsPlaying(false);
    };
    const onTime = () => {
      setTtsCurrentTime(audio.currentTime);
      if (
        audio.duration > 0 &&
        audio.currentTime / audio.duration >= 0.6 &&
        !prefetchedRef.current.has(ttsIndex) &&
        ttsIndex + 1 < chunks.length
      ) {
        prefetchedRef.current.add(ttsIndex);
        void fetchChunkUrl(chunks[ttsIndex + 1])
          .then((u) => URL.revokeObjectURL(u))
          .catch(() => undefined);
      }
    };
    const onMeta = () => setTtsDuration(audio.duration || 0);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
    };
  }, [ttsIndex, chunks, playChunk, fetchChunkUrl]);

  const toggleTts = useCallback(async () => {
    if (ttsPlaying) {
      stopTts();
      return;
    }
    if (chunks.length > 0 && audioRef.current?.src) {
      await audioRef.current.play();
      setTtsPlaying(true);
      return;
    }
    const plain = getChunkPlainText();
    if (!plain) {
      await appAlert("本章无可朗读文本(可能是图片章节)", { tone: "warning" });
      return;
    }
    const list = chunkTtsText(plain, 1200);
    setChunks(list);
    prefetchedRef.current.clear();
    if (list.length > 0) await playChunk(0);
  }, [ttsPlaying, chunks.length, getChunkPlainText, playChunk]);

  // 章节切换 / 卸载时停 TTS
  useEffect(() => {
    setChunks([]);
    setTtsIndex(0);
    stopTts(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterHref]);
  useEffect(() => () => stopTts(true), []);

  const displayTime = ttsSeeking ? ttsSeekValue : ttsCurrentTime;
  const currentChunk = chunks[ttsIndex];

  return (
    <div className="fixed inset-0 z-40 flex flex-col" style={{ background: theme.bg }}>
      {/* 顶栏 */}
      {showControls && (
        <div
          className="shrink-0 flex items-center gap-3 px-4 py-3 backdrop-blur-xl"
          style={{
            background: "rgba(14,15,17,0.9)",
            borderBottom: "1px solid var(--cream-line)",
            paddingTop: "max(0.75rem, env(safe-area-inset-top))",
          }}
        >
          <button
            type="button"
            onClick={onBack}
            className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream shrink-0"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            aria-label="返回"
          >
            <IconArrowLeft size={16} />
          </button>
          <p className="flex-1 min-w-0 font-display text-sm font-semibold line-clamp-1 text-cream">
            {chapterTitle}
          </p>
          <button
            type="button"
            onClick={() => setTtsBarVisible((v) => !v)}
            className="w-9 h-9 flex items-center justify-center rounded-full tap shrink-0"
            style={{
              background: ttsBarVisible ? "var(--ember-soft)" : "var(--ink-2)",
              color: ttsBarVisible ? "var(--ember)" : "var(--cream)",
              border: "1px solid var(--cream-line)",
            }}
            aria-label="听书"
          >
            {ttsPlaying ? <IconPause size={16} /> : <IconPlay size={16} />}
          </button>
          <button
            type="button"
            onClick={() => setChapterListOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream shrink-0"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            aria-label="目录"
          >
            <IconList size={16} />
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream shrink-0"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            aria-label="设置"
          >
            <IconSettings size={16} />
          </button>
        </div>
      )}

      {/* 正文 */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onClick={onReaderClick}
        className="flex-1 min-h-0 overflow-y-auto"
        style={mode === "paginated" ? { scrollSnapType: "y proximity" } : undefined}
      >
        {loading ? (
          <div className="p-8 text-center font-mono text-sm" style={{ color: theme.fg, opacity: 0.6 }}>
            加载中…
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <p style={{ color: theme.fg }}>加载失败: {error}</p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void load(chapterHref);
              }}
              className="mt-3 rounded-lg px-4 py-2 text-sm"
              style={{ background: "var(--ember)", color: "var(--ink)" }}
            >
              重试
            </button>
          </div>
        ) : (
          <div
            className="mx-auto max-w-2xl px-6 py-8"
            style={{ color: theme.fg, fontSize: settings.fontSize, lineHeight: settings.lineHeight }}
          >
            <h2 className="font-display font-bold mb-6" style={{ fontSize: settings.fontSize + 6 }}>
              {chapterTitle}
            </h2>
            {isImageChapter ? (
              <div
                className="[&_img]:mx-auto [&_img]:block [&_img]:max-w-full"
                dangerouslySetInnerHTML={{ __html: imageHtml }}
              />
            ) : (
              paragraphs.map((p, i) => (
                <p key={i} className="mb-4" style={{ textIndent: "2em" }}>
                  {p}
                </p>
              ))
            )}
            {mode === "scrolled" && (
              <div className="flex gap-3 mt-8 pb-4">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    gotoChapter(prevHref);
                  }}
                  disabled={!prevHref}
                  className="flex-1 rounded-lg py-2.5 text-sm tap"
                  style={{
                    background: "var(--ink-2)",
                    color: "var(--cream)",
                    border: "1px solid var(--cream-line)",
                    opacity: prevHref ? 1 : 0.4,
                  }}
                >
                  上一章
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    gotoChapter(nextHref);
                  }}
                  disabled={!nextHref}
                  className="flex-1 rounded-lg py-2.5 text-sm tap glow-ember"
                  style={{ background: "var(--ember)", color: "var(--ink)", opacity: nextHref ? 1 : 0.4 }}
                >
                  下一章
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* TTS 播放条 */}
      {ttsBarVisible && (
        <div
          className="shrink-0 px-4 py-2.5 backdrop-blur-xl"
          style={{
            background: "rgba(14,15,17,0.95)",
            borderTop: "1px solid var(--cream-line)",
            paddingBottom: "max(0.625rem, env(safe-area-inset-bottom))",
          }}
        >
          <input
            type="range"
            min={0}
            max={ttsDuration || 0}
            step={0.1}
            value={displayTime}
            onChange={(e) => setTtsSeekValue(Number(e.target.value))}
            onPointerDown={() => setTtsSeeking(true)}
            onPointerUp={() => {
              if (audioRef.current) audioRef.current.currentTime = ttsSeekValue;
              setTtsSeeking(false);
            }}
            className="w-full accent-ember mb-1.5"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleTts}
              className="w-9 h-9 flex items-center justify-center rounded-full tap glow-ember shrink-0"
              style={{ background: "var(--ember)", color: "var(--ink)" }}
              aria-label="播放/暂停"
            >
              {ttsLoadingChunk !== null ? (
                <span className="text-[10px]">…</span>
              ) : ttsPlaying ? (
                <IconPause size={16} />
              ) : (
                <IconPlay size={16} />
              )}
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-cream line-clamp-1">
                {ttsPlaying ? "正在朗读" : ttsLoadingChunk !== null ? "生成语音中…" : "已暂停"}
                {chunks.length > 0 && ` · ${ttsIndex + 1}/${chunks.length}`}
              </p>
              <p className="text-[10px] font-mono text-cream-faint">
                {formatDurationTime(displayTime)} / {formatDurationTime(ttsDuration)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setTtsPanelOpen(true)}
              className="w-8 h-8 flex items-center justify-center rounded-full tap text-cream-dim shrink-0"
              style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
              aria-label="听书设置"
            >
              <IconChevronUp size={15} />
            </button>
          </div>
        </div>
      )}

      {/* 章节目录抽屉 */}
      <Sheet
        open={chapterListOpen}
        onClose={() => setChapterListOpen(false)}
        side="right"
        title={`目录 (${chapters.length})`}
        headerActions={
          <button
            type="button"
            onClick={() => setChapterListDesc((d) => !d)}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs tap text-cream-dim shrink-0"
            style={{ background: "var(--ink)", border: "1px solid var(--cream-line)" }}
          >
            {chapterListDesc ? <IconChevronDown size={13} /> : <IconChevronUp size={13} />}
            {chapterListDesc ? "倒序" : "正序"}
          </button>
        }
      >
        <div className="py-2">
          {orderedChapters.map((ch) => {
            const active = ch.href === chapterHref;
            return (
              <button
                key={ch.id}
                ref={active ? activeChapterRef : undefined}
                type="button"
                onClick={() => {
                  gotoChapter(ch.href);
                  setChapterListOpen(false);
                }}
                className="block w-full text-left px-4 py-2.5 text-sm tap line-clamp-1"
                style={{
                  color: active ? "var(--ember)" : "var(--cream-dim)",
                  background: active ? "var(--ember-soft)" : "transparent",
                }}
              >
                {ch.title}
              </button>
            );
          })}
        </div>
      </Sheet>

      {/* 阅读设置 */}
      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} side="bottom" title="阅读设置">
        <div className="p-4 space-y-5">
          <div>
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">翻页方式</p>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["scrolled", "滚动"],
                  ["paginated", "翻页"],
                ] as ["scrolled" | "paginated", string][]
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className="rounded-lg py-2 text-xs tap"
                  style={{
                    background: mode === m ? "var(--ember)" : "var(--ink)",
                    color: mode === m ? "var(--ink)" : "var(--cream-dim)",
                    border: "1px solid var(--cream-line)",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
              字号 {settings.fontSize}
            </p>
            <input
              type="range"
              min={14}
              max={32}
              step={1}
              value={settings.fontSize}
              onChange={(e) => setSettings({ fontSize: Number(e.target.value) })}
              className="w-full accent-ember"
            />
          </div>
          <div>
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
              行距 {settings.lineHeight.toFixed(1)}
            </p>
            <input
              type="range"
              min={1.4}
              max={2.2}
              step={0.1}
              value={settings.lineHeight}
              onChange={(e) => setSettings({ lineHeight: Number(e.target.value) })}
              className="w-full accent-ember"
            />
          </div>
          <div>
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">主题</p>
            <div className="flex items-center gap-2">
              {(["sepia", "paper", "dark"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setSettings({ theme: t })}
                  className="w-9 h-9 rounded-full tap"
                  style={{
                    background: READER_THEMES[t].bg,
                    border: settings.theme === t ? "2px solid var(--ember)" : "1px solid var(--cream-line)",
                  }}
                  aria-label={t}
                />
              ))}
            </div>
          </div>
        </div>
      </Sheet>

      {/* 听书控制面板 */}
      <Sheet open={ttsPanelOpen} onClose={() => setTtsPanelOpen(false)} side="bottom" title="听书控制">
        <div className="p-4 space-y-5">
          {currentChunk && (
            <div className="rounded-lg p-3" style={{ background: "var(--ink)" }}>
              <p className="text-xs text-cream-dim line-clamp-2">{currentChunk.text.slice(0, 60)}…</p>
              <p className="text-[10px] font-mono text-cream-faint mt-1">
                {ttsIndex + 1}/{chunks.length} · {Math.round(((ttsIndex + 1) / (chunks.length || 1)) * 100)}%
              </p>
            </div>
          )}
          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => playChunk(Math.max(0, ttsIndex - 1))}
              disabled={ttsIndex <= 0}
              className="w-10 h-10 flex items-center justify-center rounded-full tap text-cream"
              style={{ background: "var(--ink)", border: "1px solid var(--cream-line)", opacity: ttsIndex > 0 ? 1 : 0.4 }}
              aria-label="上一段"
            >
              <IconChevronDown size={18} style={{ transform: "rotate(90deg)" }} />
            </button>
            <button
              type="button"
              onClick={toggleTts}
              className="w-14 h-14 flex items-center justify-center rounded-full tap glow-ember"
              style={{ background: "var(--ember)", color: "var(--ink)" }}
              aria-label="播放/暂停"
            >
              {ttsPlaying ? <IconPause size={22} /> : <IconPlay size={22} />}
            </button>
            <button
              type="button"
              onClick={() => playChunk(ttsIndex + 1)}
              disabled={ttsIndex + 1 >= chunks.length}
              className="w-10 h-10 flex items-center justify-center rounded-full tap text-cream"
              style={{
                background: "var(--ink)",
                border: "1px solid var(--cream-line)",
                opacity: ttsIndex + 1 < chunks.length ? 1 : 0.4,
              }}
              aria-label="下一段"
            >
              <IconChevronUp size={18} style={{ transform: "rotate(90deg)" }} />
            </button>
            <button
              type="button"
              onClick={() => stopTts(true)}
              className="w-10 h-10 flex items-center justify-center rounded-full tap text-cream-dim"
              style={{ background: "var(--ink)", border: "1px solid var(--cream-line)" }}
              aria-label="停止"
            >
              <IconClose size={16} />
            </button>
          </div>
          <div>
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">音色</p>
            <select
              value={settings.ttsVoice}
              onChange={(e) => {
                stopTts(true);
                setSettings({ ttsVoice: e.target.value });
              }}
              className="w-full rounded-lg px-3 py-2 text-sm bg-ink text-cream outline-none"
              style={{ border: "1px solid var(--cream-line)" }}
            >
              {ttsVoices.map((v) => (
                <option key={v.shortName} value={v.shortName}>
                  {v.displayName}
                </option>
              ))}
            </select>
          </div>
          {(
            [
              ["语速", TTS_RATE_STEPS, settings.ttsRate, "%", (val: string) => setSettings({ ttsRate: val })],
              ["音调", TTS_PITCH_STEPS, settings.ttsPitch, "Hz", (val: string) => setSettings({ ttsPitch: val })],
              ["音量", TTS_VOLUME_STEPS, settings.ttsVolume, "%", (val: string) => setSettings({ ttsVolume: val })],
            ] as [string, number[], string, "%" | "Hz", (v: string) => void][]
          ).map(([label, steps, cur, unit, setter]) => {
            const curNum = parseSigned(cur);
            const idx = Math.max(0, steps.indexOf(curNum));
            return (
              <div key={label}>
                <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
                  {label} {formatSigned(steps[idx], unit)}
                </p>
                <input
                  type="range"
                  min={0}
                  max={steps.length - 1}
                  step={1}
                  value={idx}
                  onChange={(e) => {
                    stopTts(true);
                    setter(formatSigned(steps[Number(e.target.value)], unit));
                  }}
                  className="w-full accent-ember"
                />
              </div>
            );
          })}
        </div>
      </Sheet>
    </div>
  );
}
