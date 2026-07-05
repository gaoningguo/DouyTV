import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { appAlert } from "@/components/AppDialog";
import { EmptyState } from "@/components/EmptyState";
import {
  IconArrowLeft,
  IconBook,
  IconBookmark,
  IconBookmarkFill,
  IconList,
  IconPause,
  IconPlay,
  IconSearch,
  IconSettings,
} from "@/components/Icon";
import {
  getBookChapterContent,
  getBookChapters,
  getBookDetail,
  getBookSources,
  getPreferredAcquisition,
  searchBooks,
  type BookChapter,
  type BookDetail,
  type BookListItem,
  type BookSource,
} from "@/lib/book";
import { synthesizeBookTts } from "@/lib/book/tts";
import { useBookStore } from "@/stores/book";
import type { BookReadRecord, BookShelfItem } from "@/lib/book/types";

// 小说模块页面：首页/书架、搜索、详情、章节阅读器(含 TTS)。
// 数据走 book 引擎(OPDS + Legado,经 script_http_bytes 绕 CORS + GBK 解码),
// 书架/阅读记录走 book store。当前阅读器聚焦章节型(Legado)正文;OPDS epub/pdf 走系统下载。

const READER_THEMES: Record<string, { bg: string; fg: string }> = {
  sepia: { bg: "#f4ecd8", fg: "#5b4636" },
  dark: { bg: "#0e0f11", fg: "#c9c4bb" },
  paper: { bg: "#ffffff", fg: "#1a1a1a" },
};

export default function Book() {
  const hydrate = useBookStore((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <Routes>
      <Route path="/" element={<BookHome />} />
      <Route path="search" element={<BookSearch />} />
      <Route path="detail/:sourceId/*" element={<BookDetailView />} />
      <Route path="reader/:sourceId/*" element={<BookReader />} />
    </Routes>
  );
}

function PageShell({
  title,
  eyebrow,
  children,
  trailing,
  onBack,
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
  trailing?: React.ReactNode;
  onBack?: () => void;
}) {
  const navigate = useNavigate();
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-ink text-cream">
      <div
        className="shrink-0 flex items-center gap-3 px-4 pt-4 pb-3"
        style={{ borderBottom: "1px solid var(--cream-line)" }}
      >
        <button
          type="button"
          onClick={() => (onBack ? onBack() : navigate(-1))}
          className="w-9 h-9 flex items-center justify-center rounded-full shrink-0 tap text-cream"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          aria-label="返回"
        >
          <IconArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
            {eyebrow}
          </p>
          <h1 className="font-display text-xl font-extrabold tracking-tight line-clamp-1">
            {title}
          </h1>
        </div>
        {trailing}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
    </div>
  );
}

// ─── 首页 / 书架 ────────────────────────────────────────────
function BookHome() {
  const navigate = useNavigate();
  const shelf = useBookStore((s) => s.shelf);
  const records = useBookStore((s) => s.records);
  const sources = useBookStore((s) => s.sources);
  const subscriptions = useBookStore((s) => s.subscriptions);

  const hasSource =
    sources.some((s) => s.enabled !== false) ||
    subscriptions.some((s) => s.enabled !== false);

  return (
    <PageShell
      title="小说"
      eyebrow="BOOKS · LEGADO / OPDS"
      onBack={() => navigate("/")}
      trailing={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => navigate("/book/search")}
            className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            aria-label="搜索"
          >
            <IconSearch size={16} />
          </button>
          <button
            type="button"
            onClick={() => navigate("/settings/book-hub")}
            className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            aria-label="书源管理"
          >
            <IconSettings size={16} />
          </button>
        </div>
      }
    >
      {!hasSource ? (
        <EmptyState
          icon={<IconBook size={48} />}
          title="还没有配置书源"
          subtitle="前往书源管理添加 OPDS 目录或导入 Legado 书源 / 订阅,即可搜索和阅读小说。"
          action={
            <button
              type="button"
              onClick={() => navigate("/settings/book-hub")}
              className="rounded-lg px-4 py-2 text-sm font-semibold tap glow-ember"
              style={{ background: "var(--ember)", color: "var(--ink)" }}
            >
              添加书源
            </button>
          }
        />
      ) : shelf.length === 0 ? (
        <EmptyState
          icon={<IconBookmark size={48} />}
          title="书架空空如也"
          subtitle="搜索感兴趣的小说并加入书架,进度会自动记录。"
          action={
            <button
              type="button"
              onClick={() => navigate("/book/search")}
              className="rounded-lg px-4 py-2 text-sm font-semibold tap glow-ember"
              style={{ background: "var(--ember)", color: "var(--ink)" }}
            >
              去搜索
            </button>
          }
        />
      ) : (
        <div className="p-4 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
          {shelf.map((item) => {
            const rec = records.find(
              (r) => r.sourceId === item.sourceId && r.bookId === item.bookId
            );
            return (
              <BookShelfCard
                key={`${item.sourceId}:${item.bookId}`}
                item={item}
                record={rec}
                onOpen={() =>
                  navigate(
                    `/book/detail/${encodeURIComponent(item.sourceId)}/${encodeURIComponent(
                      item.detailHref || item.bookId
                    )}?title=${encodeURIComponent(item.title)}`
                  )
                }
              />
            );
          })}
        </div>
      )}
    </PageShell>
  );
}

function BookShelfCard({
  item,
  record,
  onOpen,
}: {
  item: BookShelfItem;
  record?: BookReadRecord;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left rounded-xl overflow-hidden tap"
      style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
    >
      <div className="aspect-[3/4] relative" style={{ background: "var(--ink)" }}>
        {item.cover ? (
          <img src={item.cover} alt={item.title} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-cream-faint">
            <IconBook size={32} />
          </div>
        )}
        {typeof item.progressPercent === "number" && item.progressPercent > 0 && (
          <div
            className="absolute bottom-0 left-0 h-1 bg-ember"
            style={{ width: `${Math.min(100, item.progressPercent)}%` }}
          />
        )}
      </div>
      <div className="p-2">
        <p className="text-sm font-display font-semibold line-clamp-1 text-cream">{item.title}</p>
        <p className="text-[11px] text-cream-faint line-clamp-1 mt-0.5">
          {record?.chapterTitle || item.lastChapterTitle || item.author || item.sourceName}
        </p>
      </div>
    </button>
  );
}

// ─── 搜索 ────────────────────────────────────────────────
function BookSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [sources, setSources] = useState<BookSource[]>([]);
  const [results, setResults] = useState<BookListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);

  useEffect(() => {
    getBookSources()
      .then((list) => setSources(list.filter((s) => s.enabled !== false)))
      .catch(() => undefined);
  }, []);

  const run = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setSearched(true);
    setResults([]);
    setFailed([]);
    try {
      const res = await searchBooks(q, sourceId || undefined);
      setResults(res.results);
      setFailed(res.failedSources.map((f) => f.sourceName));
    } catch (e) {
      await appAlert(`搜索失败: ${(e as Error).message}`, { tone: "danger" });
    } finally {
      setLoading(false);
    }
  }, [query, sourceId]);

  return (
    <PageShell title="搜索小说" eyebrow="BOOKS · SEARCH">
      <div className="p-4 space-y-3">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="输入书名 / 作者"
            autoFocus
            className="flex-1 rounded-lg px-3 py-2.5 text-sm bg-ink-2 text-cream outline-none"
            style={{ border: "1px solid var(--cream-line)" }}
          />
          <button
            type="button"
            onClick={run}
            disabled={loading || !query.trim()}
            className="rounded-lg px-5 text-sm font-semibold tap glow-ember"
            style={{ background: "var(--ember)", color: "var(--ink)", opacity: loading || !query.trim() ? 0.5 : 1 }}
          >
            {loading ? "搜索中" : "搜索"}
          </button>
        </div>
        <select
          value={sourceId}
          onChange={(e) => setSourceId(e.target.value)}
          className="w-full rounded-lg px-3 py-2 text-sm bg-ink-2 text-cream outline-none"
          style={{ border: "1px solid var(--cream-line)" }}
        >
          <option value="">全部书源 ({sources.length})</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        {failed.length > 0 && (
          <p className="text-[11px] text-cream-faint font-mono">
            {failed.length} 个源无结果或失败
          </p>
        )}

        {searched && !loading && results.length === 0 ? (
          <EmptyState icon={<IconSearch size={40} />} title="没有找到相关小说" />
        ) : (
          <div className="space-y-2">
            {results.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() =>
                  navigate(
                    `/book/detail/${encodeURIComponent(item.sourceId)}/${encodeURIComponent(
                      item.detailHref || item.id
                    )}?title=${encodeURIComponent(item.title)}&cover=${encodeURIComponent(
                      item.cover || ""
                    )}&author=${encodeURIComponent(item.author || "")}`
                  )
                }
                className="w-full text-left flex gap-3 rounded-xl p-2.5 tap"
                style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
              >
                <div className="w-12 h-16 rounded overflow-hidden shrink-0" style={{ background: "var(--ink)" }}>
                  {item.cover ? (
                    <img src={item.cover} alt="" className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-cream-faint">
                      <IconBook size={18} />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-display font-semibold line-clamp-1 text-cream">{item.title}</p>
                  {item.author && <p className="text-[11px] text-cream-dim mt-0.5">{item.author}</p>}
                  {item.summary && (
                    <p className="text-[11px] text-cream-faint line-clamp-2 mt-1">{item.summary}</p>
                  )}
                  <p className="text-[10px] font-mono text-cream-faint mt-1">{item.sourceName}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}

// ─── 详情 ────────────────────────────────────────────────
function BookDetailView() {
  const navigate = useNavigate();
  const { sourceId = "" } = useParams();
  const params = useParams();
  const href = decodeURIComponent((params["*"] as string) || "");
  const [search] = useSearchParams();
  const [detail, setDetail] = useState<BookDetail | null>(null);
  const [chapters, setChapters] = useState<BookChapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [descOrder, setDescOrder] = useState(false);

  const isOnShelf = useBookStore((s) => s.isOnShelf);
  const toggleShelf = useBookStore((s) => s.toggleShelf);
  const record = useBookStore((s) =>
    s.records.find((r) => r.sourceId === sourceId && detail && r.bookId === detail.id)
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const d = await getBookDetail(sourceId, href, {
          title: search.get("title") || undefined,
          cover: search.get("cover") || undefined,
          author: search.get("author") || undefined,
          detailHref: href,
        });
        if (!alive) return;
        setDetail(d);
        const tocHref =
          d.acquisitionLinks.find((l) => l.type.includes("legado-chapters"))?.href ||
          d.navigation?.[0]?.href;
        if (tocHref) {
          const ch = await getBookChapters(sourceId, tocHref).catch(() => []);
          if (alive) setChapters(ch);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [sourceId, href]);

  const onShelf = detail ? isOnShelf(sourceId, detail.id) : false;
  const orderedChapters = useMemo(
    () => (descOrder ? [...chapters].reverse() : chapters),
    [chapters, descOrder]
  );

  const openChapter = (ch: BookChapter, tocHref?: string) => {
    navigate(
      `/book/reader/${encodeURIComponent(sourceId)}/${encodeURIComponent(ch.href)}?title=${encodeURIComponent(
        detail?.title || ""
      )}&toc=${encodeURIComponent(tocHref || "")}&bookId=${encodeURIComponent(detail?.id || "")}`
    );
  };

  const tocHref =
    detail?.acquisitionLinks.find((l) => l.type.includes("legado-chapters"))?.href ||
    detail?.navigation?.[0]?.href;

  return (
    <PageShell
      title={detail?.title || search.get("title") || "书籍详情"}
      eyebrow="BOOKS · DETAIL"
      trailing={
        detail && (
          <button
            type="button"
            onClick={() =>
              toggleShelf({
                sourceId,
                sourceName: detail.sourceName,
                bookId: detail.id,
                title: detail.title,
                author: detail.author,
                cover: detail.cover,
                format: "chapters",
                detailHref: href,
                saveTime: Date.now(),
              })
            }
            className="w-9 h-9 flex items-center justify-center rounded-full tap"
            style={{
              background: onShelf ? "var(--ember-soft)" : "var(--ink-2)",
              color: onShelf ? "var(--ember)" : "var(--cream)",
              border: "1px solid var(--cream-line)",
            }}
            aria-label={onShelf ? "移出书架" : "加入书架"}
          >
            {onShelf ? <IconBookmarkFill size={16} /> : <IconBookmark size={16} />}
          </button>
        )
      }
    >
      {loading ? (
        <div className="p-8 text-center text-cream-faint font-mono text-sm">加载中…</div>
      ) : error ? (
        <EmptyState icon={<IconBook size={40} />} title="加载失败" subtitle={error} />
      ) : detail ? (
        <div className="p-4 space-y-5">
          <div className="flex gap-4">
            <div className="w-24 h-32 rounded-lg overflow-hidden shrink-0" style={{ background: "var(--ink-2)" }}>
              {detail.cover ? (
                <img src={detail.cover} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-cream-faint">
                  <IconBook size={28} />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-lg font-bold text-cream line-clamp-2">{detail.title}</h2>
              {detail.author && <p className="text-sm text-cream-dim mt-1">{detail.author}</p>}
              <p className="text-[11px] font-mono text-cream-faint mt-1">{detail.sourceName}</p>
              {detail.tags && detail.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {detail.tags.slice(0, 4).map((t) => (
                    <span
                      key={t}
                      className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {detail.summary && (
            <p className="text-sm text-cream-dim leading-relaxed whitespace-pre-line">{detail.summary}</p>
          )}

          {chapters.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const target = record?.chapterHref
                  ? chapters.find((c) => c.href === record.chapterHref)
                  : chapters[0];
                if (target) openChapter(target, tocHref);
              }}
              className="w-full rounded-lg py-3 text-sm font-semibold tap glow-ember"
              style={{ background: "var(--ember)", color: "var(--ink)" }}
            >
              {record?.chapterTitle ? `继续阅读 · ${record.chapterTitle}` : "开始阅读"}
            </button>
          )}

          {chapters.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
                  目录 ({chapters.length})
                </p>
                <button
                  type="button"
                  onClick={() => setDescOrder((v) => !v)}
                  className="text-[11px] text-cream-dim tap"
                >
                  {descOrder ? "倒序" : "正序"}
                </button>
              </div>
              <div className="space-y-1">
                {orderedChapters.map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => openChapter(ch, tocHref)}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm tap line-clamp-1"
                    style={{
                      background: record?.chapterHref === ch.href ? "var(--ember-soft)" : "var(--ink-2)",
                      color: record?.chapterHref === ch.href ? "var(--ember)" : "var(--cream-dim)",
                      border: "1px solid var(--cream-line)",
                    }}
                  >
                    {ch.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          {chapters.length === 0 && (
            <EmptyState
              icon={<IconList size={40} />}
              title="没有可用章节"
              subtitle="该书源可能是 OPDS 文件型(epub/pdf),暂不支持在应用内阅读。"
            />
          )}
        </div>
      ) : null}
    </PageShell>
  );
}

// ─── 阅读器(章节型 + TTS) ───────────────────────────────
function BookReader() {
  const navigate = useNavigate();
  const { sourceId = "" } = useParams();
  const params = useParams();
  const chapterHref = decodeURIComponent((params["*"] as string) || "");
  const [search] = useSearchParams();
  const tocHref = search.get("toc") || undefined;
  const bookId = search.get("bookId") || "";
  const bookTitle = search.get("title") || "";

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
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(
    async (href: string) => {
      setLoading(true);
      setError("");
      stopTts();
      try {
        const ch = await getBookChapterContent(sourceId, href, tocHref);
        setContent(ch.content);
        setChapterTitle(ch.title || bookTitle);
        setPrevHref(ch.previousHref);
        setNextHref(ch.nextHref);
        scrollRef.current?.scrollTo({ top: 0 });
        // 记录阅读进度
        if (bookId) {
          upsertRecord({
            sourceId,
            sourceName: "",
            bookId,
            title: bookTitle,
            format: "chapters",
            locator: { type: "chapter", value: href, href, chapterTitle: ch.title },
            progressPercent: 0,
            chapterTitle: ch.title,
            chapterHref: href,
            saveTime: Date.now(),
          });
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [sourceId, tocHref, bookId, bookTitle, upsertRecord]
  );

  useEffect(() => {
    void load(chapterHref);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterHref]);

  const goto = (href?: string) => {
    if (!href) return;
    navigate(
      `/book/reader/${encodeURIComponent(sourceId)}/${encodeURIComponent(href)}?title=${encodeURIComponent(
        bookTitle
      )}&toc=${encodeURIComponent(tocHref || "")}&bookId=${encodeURIComponent(bookId)}`,
      { replace: true }
    );
  };

  const stopTts = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    setTtsPlaying(false);
  };

  const startTts = async () => {
    if (ttsPlaying) {
      stopTts();
      return;
    }
    const plain = content.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!plain) return;
    try {
      setTtsPlaying(true);
      const { blob } = await synthesizeBookTts({
        text: plain.slice(0, 1800),
        voice: settings.ttsVoice,
        rate: settings.ttsRate,
        pitch: settings.ttsPitch,
        volume: settings.ttsVolume,
      });
      const url = URL.createObjectURL(blob);
      if (!audioRef.current) audioRef.current = new Audio();
      audioRef.current.src = url;
      audioRef.current.onended = () => {
        setTtsPlaying(false);
        URL.revokeObjectURL(url);
      };
      await audioRef.current.play();
    } catch (e) {
      setTtsPlaying(false);
      await appAlert(`朗读失败: ${(e as Error).message}`, { tone: "danger" });
    }
  };

  useEffect(() => () => stopTts(), []);

  const theme = READER_THEMES[settings.theme] || READER_THEMES.sepia;
  const paragraphs = useMemo(
    () =>
      content
        .replace(/<[^>]+>/g, "")
        .split(/\n+/)
        .map((p) => p.trim())
        .filter(Boolean),
    [content]
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden" style={{ background: theme.bg }}>
      {/* 顶栏 */}
      {showControls && (
        <div
          className="shrink-0 flex items-center gap-3 px-4 py-3 backdrop-blur-xl"
          style={{ background: "rgba(14,15,17,0.9)", borderBottom: "1px solid var(--cream-line)" }}
        >
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          >
            <IconArrowLeft size={16} />
          </button>
          <p className="flex-1 min-w-0 font-display text-sm font-semibold line-clamp-1 text-cream">
            {chapterTitle}
          </p>
          <button
            type="button"
            onClick={startTts}
            className="w-9 h-9 flex items-center justify-center rounded-full tap"
            style={{
              background: ttsPlaying ? "var(--ember-soft)" : "var(--ink-2)",
              color: ttsPlaying ? "var(--ember)" : "var(--cream)",
              border: "1px solid var(--cream-line)",
            }}
            aria-label="朗读"
          >
            {ttsPlaying ? <IconPause size={16} /> : <IconPlay size={16} />}
          </button>
        </div>
      )}

      {/* 正文 */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto"
        onClick={() => setShowControls((v) => !v)}
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
              onClick={() => load(chapterHref)}
              className="mt-3 rounded-lg px-4 py-2 text-sm"
              style={{ background: "var(--ember)", color: "var(--ink)" }}
            >
              重试
            </button>
          </div>
        ) : (
          <div
            className="mx-auto max-w-2xl px-6 py-8"
            style={{
              color: theme.fg,
              fontSize: settings.fontSize,
              lineHeight: settings.lineHeight,
            }}
          >
            <h2 className="font-display font-bold mb-6" style={{ fontSize: settings.fontSize + 6 }}>
              {chapterTitle}
            </h2>
            {paragraphs.map((p, i) => (
              <p key={i} className="mb-4" style={{ textIndent: "2em" }}>
                {p}
              </p>
            ))}
            <div className="flex gap-3 mt-8 pb-4">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  goto(prevHref);
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
                  goto(nextHref);
                }}
                disabled={!nextHref}
                className="flex-1 rounded-lg py-2.5 text-sm tap glow-ember"
                style={{
                  background: "var(--ember)",
                  color: "var(--ink)",
                  opacity: nextHref ? 1 : 0.4,
                }}
              >
                下一章
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 底部设置条 */}
      {showControls && (
        <div
          className="shrink-0 flex items-center gap-4 px-4 py-3 backdrop-blur-xl"
          style={{ background: "rgba(14,15,17,0.9)", borderTop: "1px solid var(--cream-line)" }}
        >
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-cream-faint">字号</span>
            <button
              type="button"
              onClick={() => setSettings({ fontSize: Math.max(14, settings.fontSize - 1) })}
              className="w-7 h-7 rounded tap text-cream"
              style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            >
              -
            </button>
            <span className="text-sm text-cream w-6 text-center">{settings.fontSize}</span>
            <button
              type="button"
              onClick={() => setSettings({ fontSize: Math.min(32, settings.fontSize + 1) })}
              className="w-7 h-7 rounded tap text-cream"
              style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            >
              +
            </button>
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            {(["sepia", "paper", "dark"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSettings({ theme: t })}
                className="w-7 h-7 rounded-full tap"
                style={{
                  background: READER_THEMES[t].bg,
                  border: settings.theme === t ? "2px solid var(--ember)" : "1px solid var(--cream-line)",
                }}
                aria-label={t}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
