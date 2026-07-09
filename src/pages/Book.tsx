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
  IconDownload,
  IconGrid,
  IconList,
  IconSearch,
  IconSettings,
} from "@/components/Icon";
import {
  getBookChapters,
  getBookDetail,
  getBookFileBytes,
  getBookSources,
  searchBooksStream,
  type BookChapter,
  type BookDetail,
  type BookListItem,
  type BookSource,
} from "@/lib/book";
import { useBookStore } from "@/stores/book";
import type { BookReadRecord, BookShelfItem } from "@/lib/book/types";
import ChapterReader from "@/pages/book/ChapterReader";
import EpubReader from "@/pages/book/EpubReader";
import PdfReader from "@/pages/book/PdfReader";
import BookCatalog from "@/pages/book/Catalog";

// 小说模块页面：首页/书架、搜索、详情、章节阅读器(含 TTS)。
// 数据走 book 引擎(OPDS + Legado,经 script_http_bytes 绕 CORS + GBK 解码),
// 书架/阅读记录走 book store。阅读器按 format 分流:章节型(Legado)/ EPUB / PDF。

export default function Book() {
  const hydrate = useBookStore((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <Routes>
      <Route path="/" element={<BookHome />} />
      <Route path="search" element={<BookSearch />} />
      <Route path="catalog" element={<BookCatalogView />} />
      <Route path="detail/:sourceId/*" element={<BookDetailView />} />
      <Route path="reader/:sourceId/*" element={<BookReader />} />
    </Routes>
  );
}

// 目录 / 发现浏览 —— 复用独立的 Catalog 组件,接线到详情路由。
function BookCatalogView() {
  const navigate = useNavigate();
  return (
    <BookCatalog
      onBack={() => navigate("/book")}
      onOpenBook={(sourceId, detailHref, meta) => {
        const sp = new URLSearchParams();
        if (meta?.title) sp.set("title", meta.title);
        if (meta?.cover) sp.set("cover", meta.cover);
        if (meta?.author) sp.set("author", meta.author);
        navigate(
          `/book/detail/${encodeURIComponent(sourceId)}/${encodeURIComponent(detailHref)}?${sp.toString()}`
        );
      }}
    />
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
      trailing={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => navigate("/book/catalog")}
            className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            aria-label="发现"
          >
            <IconGrid size={16} />
          </button>
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
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  // 每次搜索递增,丢弃过期请求的增量回调(切换关键词/源时)。
  const runTokenRef = useRef(0);

  useEffect(() => {
    getBookSources()
      .then((list) => setSources(list.filter((s) => s.enabled !== false)))
      .catch(() => undefined);
  }, []);

  const run = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    const token = ++runTokenRef.current;
    setLoading(true);
    setSearched(true);
    setResults([]);
    setFailed([]);
    setProgress({ done: 0, total: 0 });
    // 增量去重:同一书详情页 href 只保留一条。
    const seen = new Set<string>();
    try {
      await searchBooksStream(
        q,
        {
          onStart: (total) => {
            if (token === runTokenRef.current) setProgress({ done: 0, total });
          },
          onSourceResult: (_source, sourceResults, done, total) => {
            if (token !== runTokenRef.current) return;
            const fresh = sourceResults.filter((item) => {
              const key = `${item.sourceId}:${item.detailHref || item.id}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
            if (fresh.length > 0) setResults((prev) => [...prev, ...fresh]);
            setProgress({ done, total });
          },
          onSourceError: (failure, done, total) => {
            if (token !== runTokenRef.current) return;
            setFailed((prev) => [...prev, failure.sourceName]);
            setProgress({ done, total });
          },
        },
        sourceId || undefined
      );
    } catch (e) {
      if (token === runTokenRef.current)
        await appAlert(`搜索失败: ${(e as Error).message}`, { tone: "danger" });
    } finally {
      if (token === runTokenRef.current) setLoading(false);
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

        {(loading || failed.length > 0) && progress.total > 0 && (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "var(--ink-2)" }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.round((progress.done / progress.total) * 100)}%`,
                  background: "var(--ember)",
                }}
              />
            </div>
            <span className="text-[11px] text-cream-faint font-mono shrink-0">
              {progress.done}/{progress.total}
              {failed.length > 0 ? ` · ${failed.length} 失败` : ""}
            </span>
          </div>
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
      )}&toc=${encodeURIComponent(tocHref || "")}&bookId=${encodeURIComponent(detail?.id || "")}&format=chapters`
    );
  };

  const tocHref =
    detail?.acquisitionLinks.find((l) => l.type.includes("legado-chapters"))?.href ||
    detail?.navigation?.[0]?.href;

  // 文件型资源(OPDS epub/pdf)—— acquisition link 的 MIME 决定格式。
  const fileFormat = (type: string): "epub" | "pdf" | null => {
    const t = type.toLowerCase();
    if (t.includes("epub")) return "epub";
    if (t.includes("pdf")) return "pdf";
    return null;
  };
  const fileLinks = (detail?.acquisitionLinks || [])
    .map((l) => ({ link: l, format: fileFormat(l.type || "") }))
    .filter((x): x is { link: (typeof x)["link"]; format: "epub" | "pdf" } => !!x.format);

  const openFile = (fileHref: string, format: "epub" | "pdf") => {
    navigate(
      `/book/reader/${encodeURIComponent(sourceId)}/${encodeURIComponent(fileHref)}?title=${encodeURIComponent(
        detail?.title || ""
      )}&bookId=${encodeURIComponent(detail?.id || "")}&format=${format}`
    );
  };

  const downloadFile = async (fileHref: string, format: "epub" | "pdf") => {
    try {
      const { bytes, mimeType } = await getBookFileBytes(sourceId, fileHref);
      const blob = new Blob([bytes as BlobPart], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${detail?.title || "book"}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      await appAlert(`下载失败: ${(e as Error).message}`, { tone: "danger" });
    }
  };

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

          {chapters.length === 0 && fileLinks.length > 0 && (
            <div className="space-y-2">
              <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
                可用格式
              </p>
              {fileLinks.map(({ link, format }, i) => (
                <div key={i} className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => openFile(link.href, format)}
                    className="flex-1 rounded-lg py-2.5 text-sm font-semibold tap glow-ember"
                    style={{ background: "var(--ember)", color: "var(--ink)" }}
                  >
                    在线阅读 · {format.toUpperCase()}
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadFile(link.href, format)}
                    className="w-11 flex items-center justify-center rounded-lg tap text-cream"
                    style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
                    aria-label="下载文件"
                  >
                    <IconDownload size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {chapters.length === 0 && fileLinks.length === 0 && (
            <EmptyState
              icon={<IconList size={40} />}
              title="没有可用章节"
              subtitle="该书源没有返回可读的章节或文件资源。"
            />
          )}
        </div>
      ) : null}
    </PageShell>
  );
}

// ─── 阅读器分流:按 format 路由到 章节 / EPUB / PDF ───────────
// URL: /book/reader/:sourceId/*  ,splat = 章节 href 或 epub/pdf 文件 url
// query: format(chapters|epub|pdf,缺省 chapters)、toc、bookId、title
function BookReader() {
  const navigate = useNavigate();
  const { sourceId = "" } = useParams();
  const params = useParams();
  const target = decodeURIComponent((params["*"] as string) || "");
  const [search] = useSearchParams();
  const format = (search.get("format") || "chapters") as
    | "chapters"
    | "epub"
    | "pdf";
  const tocHref = search.get("toc") || undefined;
  const bookId = search.get("bookId") || "";
  const bookTitle = search.get("title") || "";

  const back = () => navigate(-1);

  if (format === "epub") {
    return (
      <EpubReader
        sourceId={sourceId}
        bookId={bookId}
        fileUrl={target}
        title={bookTitle}
        onBack={back}
      />
    );
  }
  if (format === "pdf") {
    return (
      <PdfReader
        sourceId={sourceId}
        bookId={bookId}
        fileUrl={target}
        title={bookTitle}
        onBack={back}
      />
    );
  }
  return (
    <ChapterReader
      sourceId={sourceId}
      chapterHref={target}
      tocHref={tocHref}
      bookId={bookId}
      bookTitle={bookTitle}
      onBack={back}
      onNavigateChapter={(href) =>
        navigate(
          `/book/reader/${encodeURIComponent(sourceId)}/${encodeURIComponent(
            href
          )}?title=${encodeURIComponent(bookTitle)}&toc=${encodeURIComponent(
            tocHref || ""
          )}&bookId=${encodeURIComponent(bookId)}`,
          { replace: true }
        )
      }
    />
  );
}
