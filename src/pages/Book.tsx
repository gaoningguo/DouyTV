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
  IconChevronRight,
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
import { wrapImage } from "@/lib/proxy";
import { Sheet } from "@/components/Sheet";
import type { DiscoverItem } from "@/lib/discover";
import {
  fetchFanqieHome,
  FANQIE_REFERER,
  type FanqieHomeData,
  type FanqieUpdate,
  type FanqieWriter,
} from "@/lib/fanqieDiscover";
import {
  fetchQidianFeed,
  QIDIAN_FEED_TABS,
  type QidianFeedTab,
} from "@/lib/qidianFeed";
import {
  fetchQqbookHome,
  fetchQqbookRank,
  QQBOOK_REFERER,
  QQ_RANK_GENDERS,
  QQ_RANK_TABS,
  type QqbookHomeData,
  type QqbookGroup,
  type QqRankGender,
  type QqRankKind,
} from "@/lib/bookDiscover";
import {
  titleVariants,
  decideResolution,
  type ScoredCandidate,
} from "@/lib/resolveTitle";
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
      <Route path="ranking" element={<BookRanking />} />
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

// ─── 官方发现区(壳子)—— QQ阅读(book.qq.com)数据,起点(qidian.com)web 首页版式 ─────
// 数据只做展示,点击卡片拿书名去用户配置的书源里搜索解析,与漫画/豆瓣壳子同构。阅读走用户源。
// 布局参照起点 www.qidian.com web 首页:每个精选大类 = 左侧 hero 大图轮播 + 右侧榜单列,
// 下方精选封面网格。数据来自 book.qq.com(www.qidian.com 有腾讯 WAF,纯 HTTP 抓不到)。

// 官方卡片 → 用户书源的多级解析(发现区 + 榜单全部页共用)。抽成 hook 复用。
function useBookResolve() {
  const navigate = useNavigate();
  const sources = useBookStore((s) => s.sources);
  const subscriptions = useBookStore((s) => s.subscriptions);
  const hasSource =
    sources.some((s) => s.enabled !== false) ||
    subscriptions.some((s) => s.enabled !== false);

  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [chooser, setChooser] = useState<{
    title: string;
    candidates: ScoredCandidate<BookListItem>[];
  } | null>(null);

  const gotoDetail = useCallback(
    (b: BookListItem) => {
      navigate(
        `/book/detail/${encodeURIComponent(b.sourceId)}/${encodeURIComponent(
          b.detailHref || b.id
        )}?title=${encodeURIComponent(b.title)}&cover=${encodeURIComponent(
          b.cover || ""
        )}&author=${encodeURIComponent(b.author || "")}`
      );
    },
    [navigate]
  );

  // 逐个查询变体聚合搜索 → 打分决策 → 自动跳 / 弹选择器 / 跳搜索页。
  const openItem = useCallback(
    async (item: DiscoverItem) => {
      if (!hasSource) {
        void appAlert("阅读需要先添加书源,前往书源管理导入 Legado 书源 / 订阅后即可阅读。", {
          tone: "warning",
        });
        return;
      }
      if (resolvingId) return;
      setResolvingId(item.id);
      try {
        const seen = new Set<string>();
        const collected: BookListItem[] = [];
        for (const q of titleVariants(item.title)) {
          await searchBooksStream(q, {
            onSourceResult: (_source, results) => {
              for (const r of results) {
                const key = `${r.sourceId}:${r.detailHref || r.id}`;
                if (!seen.has(key)) {
                  seen.add(key);
                  collected.push(r);
                }
              }
            },
          });
          const peek = decideResolution(item.title, collected, (c) => c.title);
          if (peek.kind === "auto") break;
        }
        const decision = decideResolution(item.title, collected, (c) => c.title);
        if (decision.kind === "auto") {
          gotoDetail(decision.item);
        } else if (decision.kind === "choose") {
          setChooser({ title: item.title, candidates: decision.candidates });
        } else {
          navigate(`/book/search?q=${encodeURIComponent(item.title)}`);
        }
      } catch {
        navigate(`/book/search?q=${encodeURIComponent(item.title)}`);
      } finally {
        setResolvingId(null);
      }
    },
    [hasSource, resolvingId, navigate, gotoDetail]
  );

  return { resolvingId, chooser, setChooser, openItem, gotoDetail };
}

// 多候选选择器(发现区 + 榜单全部页共用)。
function BookChooser({
  chooser,
  onClose,
  onPick,
  onManual,
}: {
  chooser: { title: string; candidates: ScoredCandidate<BookListItem>[] } | null;
  onClose: () => void;
  onPick: (b: BookListItem) => void;
  onManual: (title: string) => void;
}) {
  if (!chooser) return null;
  return (
    <Sheet open={!!chooser} onClose={onClose} side="bottom" title={`选择「${chooser.title}」的来源`}>
      <div className="p-3 space-y-2">
        <p className="text-[11px] text-cream-faint px-1">
          官方书名与书源里的名字可能有差异,选一个正确的:
        </p>
        {chooser.candidates.map((c) => (
          <button
            key={`${c.item.sourceId}:${c.item.detailHref || c.item.id}`}
            type="button"
            onClick={() => onPick(c.item)}
            className="w-full flex gap-3 rounded-lg p-2.5 text-left tap"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          >
            <div className="w-10 h-14 shrink-0 rounded overflow-hidden" style={{ background: "var(--ink)" }}>
              {c.item.cover && (
                <img src={c.item.cover} alt="" loading="lazy" className="w-full h-full object-cover" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-display font-semibold line-clamp-1 text-cream">{c.item.title}</p>
              {c.item.author && (
                <p className="text-[11px] text-cream-dim line-clamp-1 mt-0.5">{c.item.author}</p>
              )}
              <p className="text-[10px] font-mono text-cream-faint mt-0.5">
                {c.item.sourceName} · 匹配度 {Math.round(c.score * 100)}%
              </p>
            </div>
          </button>
        ))}
        <button
          type="button"
          onClick={() => onManual(chooser.title)}
          className="w-full text-center px-4 py-2.5 rounded-lg text-sm tap text-cream-dim"
          style={{ background: "var(--ink)", border: "1px solid var(--cream-line)" }}
        >
          都不对,去搜索页手动找
        </button>
      </div>
    </Sheet>
  );
}

// 精选封面卡(照起点 web 首页 book-list:竖封面 + 书名 + 作者)。网格里横向铺开。
function FeaturedCard({
  item,
  resolving,
  onOpen,
}: {
  item: DiscoverItem;
  resolving: boolean;
  onOpen: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const src = wrapImage(item.cover, { Referer: QQBOOK_REFERER });
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={resolving}
      className="group text-left w-full tap"
    >
      <div
        className="relative w-full overflow-hidden rounded-md transition-transform duration-300 group-hover:scale-[1.04]"
        style={{ aspectRatio: "3 / 4", background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
      >
        {item.cover && !failed ? (
          <img
            src={src}
            alt={item.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full grid place-items-center text-cream-faint">
            <IconBook size={28} />
          </div>
        )}
        {resolving && (
          <div className="absolute inset-0 grid place-items-center bg-black/50">
            <span className="signal-bars" style={{ height: 16 }}>
              <span></span>
              <span></span>
              <span></span>
            </span>
          </div>
        )}
      </div>
      <p className="mt-2 text-[13px] font-display font-semibold line-clamp-1 text-cream-dim group-hover:text-cream">
        {item.title}
      </p>
      {item.author && (
        <p className="mt-0.5 text-[11px] text-cream-faint line-clamp-1">{item.author}</p>
      )}
    </button>
  );
}

// 起点 web 首页 hero 大图轮播(照 www.qidian.com 首页左侧焦点图):
// 大横幅 = 模糊封面铺底 + 前景竖封面 + 书名/作者/分类/简介 + 去阅读,底部圆点切换,自动轮播。
function HeroCarousel({
  items,
  resolvingId,
  onOpen,
  referer = QQBOOK_REFERER,
}: {
  items: DiscoverItem[];
  resolvingId: string | null;
  onOpen: (item: DiscoverItem) => void;
  referer?: string;
}) {
  const [sel, setSel] = useState(0);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const slides = items.slice(0, 6);
  useEffect(() => {
    if (paused || slides.length <= 1) return;
    const t = window.setInterval(() => setSel((s) => (s + 1) % slides.length), 5000);
    return () => window.clearInterval(t);
  }, [paused, slides.length]);
  if (slides.length === 0) return null;
  const cur = slides[Math.min(sel, slides.length - 1)];
  const tags = cur.cat ? cur.cat.split(/[ /]/).filter(Boolean).slice(0, 3) : [];
  const coverSrc = wrapImage(cur.cover, { Referer: referer });
  return (
    <div
      className="relative overflow-hidden rounded-2xl"
      style={{ border: "1px solid var(--cream-line)", background: "var(--ink-2)" }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* 模糊封面铺底 */}
      {cur.cover && !failed[cur.id] && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `url(${coverSrc})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(32px) saturate(1.3)",
            transform: "scale(1.25)",
            opacity: 0.4,
          }}
        />
      )}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(120deg, rgba(14,15,17,0.92) 0%, rgba(14,15,17,0.7) 45%, rgba(14,15,17,0.4) 100%)",
        }}
      />
      <div className="relative flex gap-4 sm:gap-6 p-5 sm:p-7 min-h-[220px] sm:min-h-[248px]">
        {/* 前景竖封面 */}
        <button
          type="button"
          disabled={resolvingId === cur.id}
          onClick={() => onOpen(cur)}
          className="group relative shrink-0 w-[120px] sm:w-[150px] overflow-hidden rounded-lg tap"
          style={{ aspectRatio: "3 / 4", background: "var(--ink)", border: "1px solid var(--cream-line)", boxShadow: "0 8px 24px rgba(0,0,0,0.5)" }}
        >
          {cur.cover && !failed[cur.id] ? (
            <img
              src={coverSrc}
              alt={cur.title}
              referrerPolicy="no-referrer"
              onError={() => setFailed((f) => ({ ...f, [cur.id]: true }))}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="w-full h-full grid place-items-center text-cream-faint">
              <IconBook size={36} />
            </div>
          )}
          {resolvingId === cur.id && (
            <div className="absolute inset-0 grid place-items-center bg-black/50">
              <span className="signal-bars" style={{ height: 18 }}>
                <span></span>
                <span></span>
                <span></span>
              </span>
            </div>
          )}
        </button>
        {/* 信息栏 */}
        <div className="min-w-0 flex-1 flex flex-col">
          <h3 className="font-display font-extrabold text-lg sm:text-2xl text-cream line-clamp-1">
            {cur.title}
          </h3>
          {(cur.author || tags.length > 0) && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {cur.author && <span className="text-[13px] text-cream-dim">{cur.author}</span>}
              {tags.map((t) => (
                <span
                  key={t}
                  className="rounded px-1.5 py-0.5 text-[11px]"
                  style={{ background: "var(--ember-soft)", color: "var(--ember)" }}
                >
                  {t}
                </span>
              ))}
            </div>
          )}
          {cur.desc && (
            <p className="mt-3 text-[13px] leading-relaxed text-cream-dim line-clamp-3 sm:line-clamp-4 whitespace-pre-line">
              {cur.desc}
            </p>
          )}
          <div className="mt-auto pt-4 flex items-center gap-3">
            <button
              type="button"
              disabled={resolvingId === cur.id}
              onClick={() => onOpen(cur)}
              className="rounded-lg px-5 py-2 text-sm font-display font-bold tap glow-ember"
              style={{ background: "var(--ember)", color: "var(--ink)" }}
            >
              {resolvingId === cur.id ? "查找中…" : "去阅读"}
            </button>
            {cur.meta && (
              <span className="text-[12px] font-mono text-cream-faint">{cur.meta}</span>
            )}
          </div>
        </div>
      </div>
      {/* 底部圆点 */}
      {slides.length > 1 && (
        <div className="absolute bottom-3 right-4 flex gap-1.5">
          {slides.map((s, i) => (
            <button
              key={s.id}
              type="button"
              aria-label={`第 ${i + 1} 本`}
              onClick={() => setSel(i)}
              className="rounded-full transition-all"
              style={{
                width: i === sel ? 18 : 6,
                height: 6,
                background: i === sel ? "var(--ember)" : "rgba(255,255,255,0.5)",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// 起点 web 首页榜单列(照右侧榜单:列名 + 序号 + 书名,前 3 名序号高亮)。
function RankColumn({
  name,
  books,
  resolvingId,
  onMore,
  onOpen,
  compact = false,
}: {
  name: string;
  books: DiscoverItem[];
  resolvingId: string | null;
  onMore: () => void;
  onOpen: (item: DiscoverItem) => void;
  /** compact:hero 右侧的紧凑单列(只序号 + 书名 + 作者)。 */
  compact?: boolean;
}) {
  if (books.length === 0) return null;
  const numBadge = (n: number) => (
    <span
      className="shrink-0 grid place-items-center font-mono font-bold"
      style={{
        width: 20,
        fontSize: n <= 3 ? 15 : 13,
        color: n <= 3 ? "var(--ember)" : "var(--cream-faint)",
      }}
    >
      {n}
    </span>
  );
  const list = compact ? books.slice(0, 8) : books;
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={onMore}
        className="flex items-center gap-1 mb-3 tap group"
      >
        <span className="font-display font-bold text-base text-cream group-hover:text-ember">{name}</span>
        <IconChevronRight size={14} />
      </button>
      <div className={compact ? "space-y-2.5" : "space-y-3"}>
        {list.map((b, i) => (
          <button
            key={b.id}
            type="button"
            disabled={resolvingId === b.id}
            onClick={() => onOpen(b)}
            className="w-full flex items-center gap-2.5 text-left tap group"
          >
            {numBadge(i + 1)}
            <span className="min-w-0 flex-1 truncate text-sm text-cream-dim group-hover:text-cream">
              {b.title}
            </span>
            {b.author && !compact && (
              <span className="shrink-0 max-w-[80px] truncate text-[11px] text-cream-faint">
                {b.author}
              </span>
            )}
            {resolvingId === b.id && (
              <span className="signal-bars shrink-0" style={{ height: 12 }}>
                <span></span>
                <span></span>
                <span></span>
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// 精选大类块(照起点 web 首页:大类标题 + [hero 轮播 | 榜单列] 两栏 + 精选封面网格 + 并排榜单)。
function GroupBlock({
  group,
  resolvingId,
  onOpen,
  onMoreGroup,
  onMoreColumn,
}: {
  group: QqbookGroup;
  resolvingId: string | null;
  onOpen: (item: DiscoverItem) => void;
  onMoreGroup: () => void;
  onMoreColumn: (kind: QqRankKind) => void;
}) {
  // 列名 → kind(用于「查看更多」跳对应榜单页)。
  const kindFor = (colName: string): QqRankKind => {
    if (colName.includes("新书")) return "new";
    if (colName.includes("完结")) return "finish";
    if (colName.includes("新知")) return "knowledge";
    return "sell";
  };
  // hero 用 featured;右侧紧凑榜取第一个榜单列(通常「热门榜」)。
  const heroBooks = group.featured.length > 0 ? group.featured : group.columns[0]?.books || [];
  const sideCol = group.columns[0];
  return (
    <section>
      {/* 大类标题 */}
      <button
        type="button"
        onClick={onMoreGroup}
        className="flex items-center gap-1 mb-4 tap group"
      >
        <h2 className="font-display font-extrabold text-xl sm:text-2xl text-cream group-hover:text-ember">
          {group.title}
        </h2>
        <IconChevronRight size={18} />
      </button>

      {/* 焦点两栏:左 hero 轮播 + 右紧凑榜单(照起点 web 首页焦点区) */}
      <div className="flex flex-col lg:flex-row gap-5 mb-6">
        <div className="lg:flex-1 min-w-0">
          <HeroCarousel items={heroBooks} resolvingId={resolvingId} onOpen={onOpen} />
        </div>
        {sideCol && (
          <div
            className="lg:w-[280px] shrink-0 rounded-2xl p-4"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          >
            <RankColumn
              name={sideCol.name}
              books={sideCol.books}
              resolvingId={resolvingId}
              onMore={() => onMoreColumn(kindFor(sideCol.name))}
              onOpen={onOpen}
              compact
            />
          </div>
        )}
      </div>

      {/* 精选封面网格(featured) */}
      {group.featured.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-x-3 gap-y-4 mb-6">
          {group.featured.map((item) => (
            <FeaturedCard
              key={item.id}
              item={item}
              resolving={resolvingId === item.id}
              onOpen={() => onOpen(item)}
            />
          ))}
        </div>
      )}

      {/* 剩余榜单列并排(除已在右侧展示的第一个) */}
      {group.columns.length > 1 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          {group.columns.slice(1).map((col) => (
            <RankColumn
              key={col.name}
              name={col.name}
              books={col.books}
              resolvingId={resolvingId}
              onMore={() => onMoreColumn(kindFor(col.name))}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// 榜单卡片网格:大号斜体序号压封面左上角(榜单"查看全部"页用)。
function RankList({
  items,
  resolvingId,
  onOpen,
}: {
  items: DiscoverItem[];
  resolvingId: string | null;
  onOpen: (item: DiscoverItem) => void;
}) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
      {items.map((item, i) => {
        const rank = i + 1;
        return (
          <button
            key={item.id}
            type="button"
            disabled={resolvingId === item.id}
            onClick={() => onOpen(item)}
            className="group text-left w-full tap relative transition-transform duration-300 hover:z-20 hover:scale-[1.06]"
          >
            <div className="relative" style={{ paddingTop: 14 }}>
              <span
                className="absolute left-0 z-10 font-display font-extrabold italic leading-none pointer-events-none"
                style={{
                  top: 0,
                  fontSize: 46,
                  color: rank <= 3 ? "var(--ember)" : "var(--cream)",
                  textShadow: "0 2px 8px rgba(0,0,0,0.9)",
                }}
              >
                {rank}
              </span>
              <div
                className="relative aspect-[3/4] w-full overflow-hidden rounded-lg"
                style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
              >
                {item.cover ? (
                  <img
                    src={wrapImage(item.cover, { Referer: QQBOOK_REFERER })}
                    alt={item.title}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full grid place-items-center text-cream-faint">
                    <IconBook size={28} />
                  </div>
                )}
                {resolvingId === item.id && (
                  <div className="absolute inset-0 grid place-items-center bg-black/50">
                    <span className="signal-bars" style={{ height: 18 }}>
                      <span></span>
                      <span></span>
                      <span></span>
                    </span>
                  </div>
                )}
              </div>
            </div>
            <p className="mt-2 truncate text-[15px] font-display font-semibold text-cream-dim group-hover:text-cream">
              {item.title}
            </p>
            {(item.author || item.meta) && (
              <p className="mt-1 truncate text-xs text-cream-faint">
                {item.author || item.meta}
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}

// 榜单"查看全部"页(照漫画 MangaRanking):大类 tab(男/女/出版)+ 榜 tab(热门/新书/完结)+ 网格。
function BookRanking() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const genderParam = (params.get("gender") || "male") as QqRankGender;
  const gender: QqRankGender = QQ_RANK_GENDERS.some((g) => g.key === genderParam)
    ? genderParam
    : "male";
  const tabsForGender = QQ_RANK_TABS[gender];
  const kindParam = (params.get("kind") || tabsForGender[0].kind) as QqRankKind;
  const kind: QqRankKind = tabsForGender.some((t) => t.kind === kindParam)
    ? kindParam
    : tabsForGender[0].kind;

  const [items, setItems] = useState<DiscoverItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { resolvingId, chooser, setChooser, openItem, gotoDetail } = useBookResolve();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    fetchQqbookRank(gender, kind)
      .then((list) => {
        if (alive) setItems(list);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [gender, kind]);

  const setGender = (g: QqRankGender) =>
    setParams({ gender: g, kind: QQ_RANK_TABS[g][0].kind }, { replace: true });
  const setKind = (k: QqRankKind) =>
    setParams({ gender, kind: k }, { replace: true });

  const genderLabel = QQ_RANK_GENDERS.find((g) => g.key === gender)?.label || "榜单";

  return (
    <PageShell
      title={`高能榜单 · ${genderLabel}`}
      eyebrow="BOOKS · RANKING"
      onBack={() => navigate(-1)}
    >
      <div className="p-4 space-y-4">
        {/* 大类 tab(男/女/出版) */}
        <div className="flex gap-2 overflow-x-auto vod-scroll-row -mx-1 px-1">
          {QQ_RANK_GENDERS.map((g) => {
            const active = g.key === gender;
            return (
              <button
                key={g.key}
                type="button"
                onClick={() => setGender(g.key)}
                className="shrink-0 rounded-full px-4 py-1.5 text-sm font-display tap transition-colors"
                style={{
                  background: active ? "var(--ember)" : "var(--ink-2)",
                  color: active ? "var(--ink)" : "var(--cream-dim)",
                  border: `1px solid ${active ? "var(--ember)" : "var(--cream-line)"}`,
                }}
              >
                {g.label}
              </button>
            );
          })}
        </div>
        {/* 榜 tab(热门/新书/完结) */}
        <div className="flex gap-2 overflow-x-auto vod-scroll-row -mx-1 px-1">
          {tabsForGender.map((t) => {
            const active = t.kind === kind;
            return (
              <button
                key={t.kind}
                type="button"
                onClick={() => setKind(t.kind)}
                className="shrink-0 rounded-full px-3 py-1.5 text-xs font-display tap whitespace-nowrap"
                style={{
                  background: active ? "var(--ember-soft)" : "var(--ink-2)",
                  color: active ? "var(--ember)" : "var(--cream-dim)",
                  border: `1px solid ${active ? "var(--ember)" : "var(--cream-line)"}`,
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {error ? (
          <p className="text-sm text-ember">{error}</p>
        ) : loading && items.length === 0 ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="aspect-[3/4] rounded-lg animate-pulse" style={{ background: "var(--ink-2)" }} />
                <div className="h-3 w-3/4 rounded animate-pulse" style={{ background: "var(--ink-2)" }} />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={<IconBook size={48} />} title="该榜暂无内容" />
        ) : (
          <RankList items={items} resolvingId={resolvingId} onOpen={openItem} />
        )}
      </div>
      <BookChooser
        chooser={chooser}
        onClose={() => setChooser(null)}
        onPick={(b) => {
          gotoDetail(b);
          setChooser(null);
        }}
        onManual={(t) => {
          setChooser(null);
          navigate(`/book/search?q=${encodeURIComponent(t)}`);
        }}
      />
    </PageShell>
  );
}

// ─── 番茄小说首页组件(主布局)────────────────────────────────

// 分区标题行(番茄各分区通用:标题 + 副标题)。
function SectionHead({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-3">
      <h2 className="font-display font-extrabold text-xl sm:text-2xl text-cream">{title}</h2>
      {subtitle && <span className="text-[13px] text-cream-faint">{subtitle}</span>}
    </div>
  );
}

// 番茄封面卡(竖封面 + 书名 + 作者;简介行可选)。封面走 wrapImage + Referer。
function FanqieCard({
  item,
  resolving,
  onOpen,
  showDesc = false,
  referer = FANQIE_REFERER,
}: {
  item: DiscoverItem;
  resolving: boolean;
  onOpen: () => void;
  showDesc?: boolean;
  referer?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = wrapImage(item.cover, { Referer: referer });
  return (
    <button type="button" onClick={onOpen} disabled={resolving} className="group text-left w-full tap">
      <div
        className="relative w-full overflow-hidden rounded-md transition-transform duration-300 group-hover:scale-[1.04]"
        style={{ aspectRatio: "3 / 4", background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
      >
        {item.cover && !failed ? (
          <img
            src={src}
            alt={item.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full grid place-items-center text-cream-faint">
            <IconBook size={28} />
          </div>
        )}
        {item.cat && (
          <>
            <div
              className="absolute inset-x-0 bottom-0 h-1/3 pointer-events-none"
              style={{ background: "linear-gradient(to top, rgba(0,0,0,0.6), transparent)" }}
            />
            <span className="absolute bottom-1.5 left-1.5 right-1.5 truncate text-[10px] leading-tight text-white/90">
              {item.cat}
            </span>
          </>
        )}
        {resolving && (
          <div className="absolute inset-0 grid place-items-center bg-black/50">
            <span className="signal-bars" style={{ height: 16 }}>
              <span></span>
              <span></span>
              <span></span>
            </span>
          </div>
        )}
      </div>
      <p className="mt-2 text-[13px] font-display font-semibold line-clamp-1 text-cream-dim group-hover:text-cream">
        {item.title}
      </p>
      {item.author && (
        <p className="mt-0.5 text-[11px] text-cream-faint line-clamp-1">{item.author}</p>
      )}
      {showDesc && item.desc && (
        <p className="mt-1 text-[11px] text-cream-faint line-clamp-2 leading-snug">
          {item.desc.replace(/[\r\n]+/g, " ")}
        </p>
      )}
    </button>
  );
}

// 封面网格分区(编辑推荐 / 男生 / 女生 / 本周强推)。
function CoverGridSection({
  title,
  subtitle,
  items,
  resolvingId,
  onOpen,
  showDesc = false,
}: {
  title: string;
  subtitle?: string;
  items: DiscoverItem[];
  resolvingId: string | null;
  onOpen: (item: DiscoverItem) => void;
  showDesc?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <SectionHead title={title} subtitle={subtitle} />
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-x-3 gap-y-4">
        {items.map((item) => (
          <FanqieCard
            key={item.id}
            item={item}
            resolving={resolvingId === item.id}
            onOpen={() => onOpen(item)}
            showDesc={showDesc}
          />
        ))}
      </div>
    </section>
  );
}

// 横滑封面分区(编辑推荐/本周强推,大卡横向滚动)。
function CoverRowSection({
  title,
  subtitle,
  items,
  resolvingId,
  onOpen,
}: {
  title: string;
  subtitle?: string;
  items: DiscoverItem[];
  resolvingId: string | null;
  onOpen: (item: DiscoverItem) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <SectionHead title={title} subtitle={subtitle} />
      <div className="flex gap-3 sm:gap-4 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1">
        {items.map((item) => (
          <div key={item.id} className="shrink-0 w-[104px] sm:w-[128px]">
            <FanqieCard
              item={item}
              resolving={resolvingId === item.id}
              onOpen={() => onOpen(item)}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

// 最近更新列表(书名 + 最新章 + 分类)。
function UpdateListSection({
  updates,
  resolvingId,
  onOpen,
}: {
  updates: FanqieUpdate[];
  resolvingId: string | null;
  onOpen: (title: string, id: string) => void;
}) {
  if (updates.length === 0) return null;
  return (
    <section>
      <SectionHead title="最近更新" subtitle="追更不迷路" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
        {updates.map((u) => (
          <button
            key={u.bookId}
            type="button"
            disabled={resolvingId === u.bookId}
            onClick={() => onOpen(u.bookName, u.bookId)}
            className="w-full flex items-center gap-3 py-2 text-left tap group"
            style={{ borderBottom: "1px solid var(--cream-line)" }}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="shrink-0 max-w-[45%] truncate text-sm font-display font-semibold text-cream-dim group-hover:text-cream">
                  {u.bookName}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-cream-faint">
                  {u.chapter}
                </span>
              </div>
            </div>
            {u.category && (
              <span
                className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
                style={{ background: "var(--ember-soft)", color: "var(--ember)" }}
              >
                {u.category}
              </span>
            )}
            {resolvingId === u.bookId && (
              <span className="signal-bars shrink-0" style={{ height: 12 }}>
                <span></span>
                <span></span>
                <span></span>
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}

// 名家横条(头像 + 笔名 + 代表作)。
function WriterRowSection({
  writers,
  onOpen,
}: {
  writers: FanqieWriter[];
  onOpen: (name: string) => void;
}) {
  if (writers.length === 0) return null;
  return (
    <section>
      <SectionHead title="名家专区" subtitle="大神在此" />
      <div className="flex gap-4 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1">
        {writers.slice(0, 20).map((w) => (
          <WriterAvatar key={w.uid} writer={w} onOpen={() => onOpen(w.name)} />
        ))}
      </div>
    </section>
  );
}

function WriterAvatar({ writer, onOpen }: { writer: FanqieWriter; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <button type="button" onClick={onOpen} className="group shrink-0 w-[76px] text-center tap">
      <div
        className="relative w-[76px] h-[76px] mx-auto overflow-hidden rounded-full transition-transform duration-300 group-hover:scale-105"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
      >
        {writer.cover && !failed ? (
          <img
            src={wrapImage(writer.cover, { Referer: FANQIE_REFERER })}
            alt={writer.name}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full grid place-items-center text-cream-faint">
            <IconBook size={22} />
          </div>
        )}
      </div>
      <p className="mt-1.5 text-[12px] font-display font-semibold line-clamp-1 text-cream-dim group-hover:text-cream">
        {writer.name}
      </p>
      {writer.introduction && (
        <p className="text-[10px] text-cream-faint line-clamp-1">{writer.introduction}</p>
      )}
    </button>
  );
}

// 起点榜单区(GitHub 源:畅销榜 / 完本收藏榜 tab 切换 + 序号榜单列)。
function QidianRankSection({
  resolvingId,
  onOpen,
}: {
  resolvingId: string | null;
  onOpen: (item: DiscoverItem) => void;
}) {
  const [tab, setTab] = useState<QidianFeedTab>("sell");
  const [items, setItems] = useState<DiscoverItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);
    fetchQidianFeed(tab, tab === "finish" ? 30 : 30)
      .then((list) => {
        if (alive) setItems(list);
      })
      .catch(() => {
        if (alive) {
          setFailed(true);
          setItems([]);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tab]);

  // 第三方源不可用时整块隐藏(首页仍有番茄内容)。
  if (failed && items.length === 0) return null;

  return (
    <section>
      <div className="flex items-center gap-3 mb-3">
        <h2 className="font-display font-extrabold text-xl sm:text-2xl text-cream">起点榜单</h2>
        <div className="flex gap-2">
          {QIDIAN_FEED_TABS.map((t) => {
            const active = t.key === tab;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className="rounded-full px-3 py-1 text-xs font-display tap transition-colors"
                style={{
                  background: active ? "var(--ember)" : "var(--ink-2)",
                  color: active ? "var(--ink)" : "var(--cream-dim)",
                  border: `1px solid ${active ? "var(--ember)" : "var(--cream-line)"}`,
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
      {loading && items.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-2">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-6 rounded animate-pulse" style={{ background: "var(--ink-2)" }} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-6">
          {[0, 1, 2].map((col) => {
            const slice = items.slice(col * 10, col * 10 + 10);
            if (slice.length === 0) return null;
            return (
              <div key={col} className="space-y-2.5">
                {slice.map((b, i) => {
                  const rank = col * 10 + i + 1;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      disabled={resolvingId === b.id}
                      onClick={() => onOpen(b)}
                      className="w-full flex items-center gap-2.5 text-left tap group"
                    >
                      <span
                        className="shrink-0 grid place-items-center font-mono font-bold"
                        style={{
                          width: 20,
                          fontSize: rank <= 3 ? 15 : 13,
                          color: rank <= 3 ? "var(--ember)" : "var(--cream-faint)",
                        }}
                      >
                        {rank}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm text-cream-dim group-hover:text-cream">
                        {b.title}
                      </span>
                      {b.author && (
                        <span className="shrink-0 max-w-[80px] truncate text-[11px] text-cream-faint">
                          {b.author}
                        </span>
                      )}
                      {resolvingId === b.id && (
                        <span className="signal-bars shrink-0" style={{ height: 12 }}>
                          <span></span>
                          <span></span>
                          <span></span>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─── 发现区主体:番茄为主 + 起点榜单(GitHub)+ QQ阅读兜底 ────────────
function BookDiscover() {
  const navigate = useNavigate();
  const [fanqie, setFanqie] = useState<FanqieHomeData | null>(null);
  const [qqHome, setQqHome] = useState<QqbookHomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { resolvingId, chooser, setChooser, openItem, gotoDetail } = useBookResolve();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    fetchFanqieHome()
      .then((d) => {
        if (alive) setFanqie(d);
      })
      .catch((e) => {
        if (!alive) return;
        // 番茄挂了 → QQ阅读兜底。
        setError((e as Error).message);
        fetchQqbookHome()
          .then((d) => {
            if (alive) setQqHome(d);
          })
          .catch(() => undefined);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 番茄条目按书名解析(番茄无用户源直连,统一走 openItem)。
  const openFanqie = (item: DiscoverItem) => openItem(item);
  const openByTitle = (title: string, id: string) =>
    openItem({ id: `fq:${id}`, title, cover: "" });

  const chooserSheet = (
    <BookChooser
      chooser={chooser}
      onClose={() => setChooser(null)}
      onPick={(b) => {
        gotoDetail(b);
        setChooser(null);
      }}
      onManual={(t) => {
        setChooser(null);
        navigate(`/book/search?q=${encodeURIComponent(t)}`);
      }}
    />
  );

  if (loading && !fanqie && !qqHome) {
    return (
      <div className="p-4 space-y-6">
        <div className="w-full rounded-2xl animate-pulse" style={{ aspectRatio: "24 / 9", background: "var(--ink-2)" }} />
        {Array.from({ length: 2 }).map((_, g) => (
          <div key={g} className="space-y-3">
            <div className="h-6 w-28 rounded animate-pulse" style={{ background: "var(--ink-2)" }} />
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="aspect-[3/4] rounded-md animate-pulse" style={{ background: "var(--ink-2)" }} />
                  <div className="h-3 w-3/4 rounded animate-pulse" style={{ background: "var(--ink-2)" }} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // 番茄成功 → 番茄主布局 + 起点榜单穿插。
  if (fanqie) {
    const heroItems = [...fanqie.editor, ...fanqie.week].slice(0, 6);
    return (
      <>
        <div className="p-4 space-y-8">
          {heroItems.length > 0 && (
            <HeroCarousel items={heroItems} resolvingId={resolvingId} onOpen={openFanqie} referer={FANQIE_REFERER} />
          )}
          <CoverGridSection title="编辑推荐" subtitle="小编精挑细选" items={fanqie.editor} resolvingId={resolvingId} onOpen={openFanqie} showDesc />
          <CoverRowSection title="本周强推" subtitle="热度飙升" items={fanqie.week} resolvingId={resolvingId} onOpen={openFanqie} />
          <CoverGridSection title="男生精选" subtitle="热血燃向" items={fanqie.boy} resolvingId={resolvingId} onOpen={openFanqie} />
          <CoverGridSection title="女生精选" subtitle="甜宠上头" items={fanqie.girl} resolvingId={resolvingId} onOpen={openFanqie} />
          <QidianRankSection resolvingId={resolvingId} onOpen={openFanqie} />
          <UpdateListSection updates={fanqie.updates} resolvingId={resolvingId} onOpen={openByTitle} />
          <WriterRowSection writers={fanqie.writers} onOpen={(name) => openItem({ id: `w:${name}`, title: name, cover: "" })} />
        </div>
        {chooserSheet}
      </>
    );
  }

  // 番茄失败 → QQ阅读 group blocks 兜底。
  if (qqHome?.groups?.length) {
    return (
      <>
        <div className="p-4 space-y-10">
          {qqHome.groups.map((group) => (
            <GroupBlock
              key={group.gender}
              group={group}
              resolvingId={resolvingId}
              onOpen={openItem}
              onMoreGroup={() => navigate(`/book/ranking?gender=${group.gender}`)}
              onMoreColumn={(kind) =>
                navigate(`/book/ranking?gender=${group.gender}&kind=${kind}`)
              }
            />
          ))}
        </div>
        {chooserSheet}
      </>
    );
  }

  // 全部源失败 → 起点榜单兜底(自身也可能不可用,会整块隐藏)。
  return (
    <>
      <div className="p-4 space-y-8">
        <QidianRankSection resolvingId={resolvingId} onOpen={openItem} />
        {error && <p className="text-sm text-ember">{error}</p>}
      </div>
      {chooserSheet}
    </>
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
      eyebrow="BOOKS · QQ阅读 / LEGADO"
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
      <div>
        {/* 书架:有书才显示 */}
        {shelf.length > 0 && (
          <section className="p-4">
            <h2 className="font-display font-bold text-sm text-cream mb-3">我的书架</h2>
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
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
          </section>
        )}

        {/* 未配置书源:细提示条(不再整页拦截,发现区照常展示) */}
        {!hasSource && (
          <div
            className="mx-4 mt-1 flex items-center justify-between gap-3 rounded-lg p-3"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          >
            <p className="text-xs text-cream-dim leading-relaxed">
              阅读需要先添加书源,导入 Legado 书源 / 订阅后即可打开下面的官方推荐。
            </p>
            <button
              type="button"
              onClick={() => navigate("/settings/book-hub")}
              className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-display font-semibold tap"
              style={{ background: "var(--ember)", color: "var(--ink)" }}
            >
              添加书源
            </button>
          </div>
        )}

        {/* 官方发现区(壳子)—— QQ阅读富布局,常驻 */}
        <BookDiscover />
      </div>
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
  const [searchParams] = useSearchParams();
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

  const run = useCallback(async (override?: string) => {
    const q = (override ?? query).trim();
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

  // 从官方发现区跳来时带 ?q=书名,自动预填 + 搜索一次。
  const autoQ = searchParams.get("q") || "";
  const autoRanRef = useRef("");
  useEffect(() => {
    if (!autoQ || autoRanRef.current === autoQ) return;
    autoRanRef.current = autoQ;
    setQuery(autoQ);
    void run(autoQ);
  }, [autoQ, run]);

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
            onClick={() => run()}
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
