import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Route,
  Routes,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";
import { Sheet } from "@/components/Sheet";
import {
  IconArrowLeft,
  IconBookmark,
  IconBookmarkFill,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconGrid,
  IconHistoryClock,
  IconList,
  IconManga,
  IconSearch,
  IconSettings,
  IconTrash,
} from "@/components/Icon";
import {
  getMangaSources,
  searchMangaStream,
  getMangaDetail,
  getMangaChapters,
  getMangaChapterPages,
  isMangaConfigured,
  type MangaChapter,
  type MangaDetail,
  type MangaSearchItem,
  type MangaSource,
} from "@/lib/manga";
import {
  useMangaStore,
  type MangaReadMode,
  type MangaScaleMode,
} from "@/stores/manga";
import MangaBrowse from "@/pages/manga/Browse";
import type {
  MangaReadRecord,
  MangaShelfItem,
} from "@/lib/manga/types";
import { appAlert, appConfirm } from "@/components/AppDialog";
import { wrapImage } from "@/lib/proxy";
import type { DiscoverItem } from "@/lib/discover";
import {
  fetchMangaHome,
  BILI_MANGA_REFERER,
  fetchMangaRanking,
  fetchMangaClassify,
  type MangaHomeData,
  type MangaLabels,
  type MangaLabelOption,
  type MangaRankPage,
  type MangaClassifyQuery,
  type BannerCard,
  type ClassifyComic,
} from "@/lib/mangaDiscover";
import {
  titleVariants,
  decideResolution,
  type ScoredCandidate,
} from "@/lib/resolveTitle";

// 漫画模块页面：单一 Routes 承载 首页/书架、搜索、详情、阅读器 四个视图。
// 数据全部走 Suwayomi 客户端（Rust script_http_bytes 绕 CORS），书架/历史走 manga store。

export default function Manga() {
  const hydrate = useMangaStore((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <Routes>
      <Route path="/" element={<MangaHome />} />
      <Route path="search" element={<MangaSearch />} />
      <Route path="ranking" element={<MangaRanking />} />
      <Route path="classify" element={<MangaClassify />} />
      <Route path="mine" element={<MangaMine />} />
      <Route path="mine" element={<MangaMine />} />
      <Route path="browse" element={<MangaBrowse />} />
      <Route path="detail/:sourceId/:mangaId" element={<MangaDetailView />} />
      <Route
        path="reader/:sourceId/:mangaId/:chapterId"
        element={<MangaReader />}
      />
    </Routes>
  );
}

function PageShell({
  title,
  eyebrow,
  onBack,
  trailing,
  children,
}: {
  title: string;
  eyebrow: string;
  onBack?: () => void;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-ink text-cream">
      <div
        className="shrink-0 flex items-center gap-3 px-4 pt-4 pb-3"
        style={{ borderBottom: "1px solid var(--cream-line)" }}
      >
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="w-9 h-9 flex items-center justify-center rounded-full shrink-0 tap text-cream"
            style={{
              background: "var(--ink-2)",
              border: "1px solid var(--cream-line)",
            }}
            aria-label="返回"
          >
            <IconArrowLeft size={16} />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
            {eyebrow}
          </p>
          <h1 className="font-display text-xl font-extrabold tracking-tight line-clamp-1">
            {title}
          </h1>
        </div>
        {trailing ?? (
          <button
            type="button"
            onClick={() => navigate("/settings/manga-hub")}
            className="w-9 h-9 flex items-center justify-center rounded-full shrink-0 tap text-cream-dim"
            style={{
              background: "var(--ink-2)",
              border: "1px solid var(--cream-line)",
            }}
            aria-label="漫画设置"
          >
            <IconSettings size={16} />
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4">{children}</div>
    </div>
  );
}

function MangaCover({
  cover,
  title,
  onClick,
  badge,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  onContextMenu,
}: {
  cover?: string;
  title: string;
  onClick?: () => void;
  badge?: React.ReactNode;
  onPointerDown?: () => void;
  onPointerUp?: () => void;
  onPointerLeave?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const [failed, setFailed] = useState(false);
  // Suwayomi 封面常是本地/局域网服务器,直连不过代理;渲染时过 wrapImage 顺带拆掉历史双层包装。
  const src = wrapImage(cover, undefined, { bypassProxy: true });
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onContextMenu={onContextMenu}
      className="group text-left w-full tap relative transition-transform duration-300 hover:z-20 hover:scale-[1.06]"
    >
      <div
        className="relative aspect-[3/4] w-full overflow-hidden rounded-lg"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
      >
        {src && !failed ? (
          <img
            src={src}
            alt={title}
            loading="lazy"
            onError={() => setFailed(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-cream-faint">
            <IconManga size={32} />
          </div>
        )}
        {badge && (
          <div className="absolute bottom-1 left-1 right-1 flex justify-end">
            {badge}
          </div>
        )}
      </div>
      <p className="mt-1.5 text-xs font-display font-semibold line-clamp-2 text-cream-dim group-hover:text-cream">
        {title}
      </p>
    </button>
  );
}

// 历史卡片:点开继续阅读,长按/右键弹操作菜单。
function MangaHistoryCard({
  record,
  onOpen,
  onLongPress,
}: {
  record: MangaReadRecord;
  onOpen: () => void;
  onLongPress: () => void;
}) {
  const timerRef = useRef<number | null>(null);
  const longFiredRef = useRef(false);

  const start = () => {
    longFiredRef.current = false;
    timerRef.current = window.setTimeout(() => {
      longFiredRef.current = true;
      onLongPress();
    }, 500);
  };
  const clear = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  return (
    <MangaCover
      cover={record.cover}
      title={record.title}
      badge={
        record.pageCount > 0 ? (
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-mono"
            style={{ background: "rgba(0,0,0,0.6)", color: "var(--cream)" }}
          >
            {record.pageIndex + 1}/{record.pageCount}
          </span>
        ) : undefined
      }
      onClick={() => {
        if (longFiredRef.current) return;
        onOpen();
      }}
      onPointerDown={start}
      onPointerUp={clear}
      onPointerLeave={clear}
      onContextMenu={(e) => {
        e.preventDefault();
        onLongPress();
      }}
    />
  );
}

// ─── 官方发现区(壳子)—— B站热门 + 包子完结/题材 ─────────
// 数据来自官方接口(只做展示),点击卡片拿标题去用户配置的 Suwayomi 源里搜索解析,
// 与影视的豆瓣壳子同构。

type RankRegion = "JP" | "CN" | "KO";

// 官方封面卡片:与 MangaCover 同视觉,但走 wrapImage(封面是外站,Tauri 下过代理)。
function DiscoverCover({
  item,
  onClick,
  resolving,
}: {
  item: DiscoverItem;
  onClick: () => void;
  resolving: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const src = wrapImage(item.cover, { Referer: BILI_MANGA_REFERER });
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={resolving}
      className="group text-left w-full tap relative transition-transform duration-300 hover:z-20 hover:scale-[1.06]"
    >
      {/* 封面 3:4,标签叠在封面底部(照 B站 top-[255px] + bg-white/25)。
          整卡放大而非只裁剪封面 —— 外层不裁剪,靠 hover:scale + z 抬升盖过邻卡。 */}
      <div
        className="relative aspect-[3/4] w-full overflow-hidden rounded-lg"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
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
          <div className="w-full h-full flex items-center justify-center text-cream-faint">
            <IconManga size={32} />
          </div>
        )}
        {item.cat && (
          <>
            <div
              className="absolute inset-x-0 bottom-0 h-1/3 pointer-events-none"
              style={{ background: "linear-gradient(to top, rgba(0,0,0,0.6), transparent)" }}
            />
            <div className="absolute bottom-1.5 left-1.5 right-1.5 flex gap-1 overflow-hidden">
              {item.cat.split(" ").filter(Boolean).slice(0, 2).map((tag) => (
                <span
                  key={tag}
                  className="truncate rounded px-1.5 py-0.5 text-[10px] leading-tight text-white/90"
                  style={{ background: "rgba(255,255,255,0.25)" }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </>
        )}
        {resolving && (
          <div className="absolute inset-0 grid place-items-center bg-black/50">
            <span className="signal-bars" style={{ height: 18 }}>
              <span></span>
              <span></span>
              <span></span>
            </span>
          </div>
        )}
      </div>
      {/* 标题 text-lg + 分区状态行(畅销指数/人热议中/完结共N话,金色段用 ember) */}
      <div className="my-2.5 flex h-6 items-center">
        <h3 className="w-0 flex-1 truncate text-base font-display font-semibold text-cream-dim group-hover:text-cream">
          {item.title}
        </h3>
      </div>
      {item.metaSegs && item.metaSegs.length > 0 && (
        <p className="truncate text-sm text-cream-faint">
          {item.metaSegs.map((s, i) => (
            <span key={i} className={i > 0 ? "ml-1" : ""} style={s.gold ? { color: "var(--ember)" } : undefined}>
              {s.text}
            </span>
          ))}
        </p>
      )}
    </button>
  );
}

// 顶部 banner 封面墙(严格照 B站 CSS 复刻):
//   swiper 居中轮播,每屏 931×398 马赛克(big-card 242×381 ×2 + 堆叠对 141×188 ×3 = 8 卡),
//   active 屏 opacity 1 / 邻屏 0.5,两侧 12.5% 渐变 mask + 箭头 + 底部圆点。
//   带简介卡:标题 + 67px 半透黑条推荐语。响应式固定高度,列宽按 931:398 比例。

function BannerSlide({
  cards,
  onOpenTitle,
  onBrowse,
}: {
  cards: BannerCard[];
  onOpenTitle: (title: string) => void;
  onBrowse: () => void;
}) {
  const img = (src: string) => wrapImage(src, { Referer: BILI_MANGA_REFERER });
  // 与下方分区卡片一致:能拿到标题就走多级解析(匹配到直接进详情、不完全弹选源),
  // 填充卡没有 resolveTitle 时回落到 comicTitle / mainTitle,实在没有才去浏览页。
  const click = (c: BannerCard) => {
    const t = c.resolveTitle || c.comicTitle || c.mainTitle;
    if (t) onOpenTitle(t);
    else onBrowse();
  };
  // 每屏真实排列(照 DOM):big, 堆叠对, big(featured 浮层), 堆叠对, 堆叠对 = 8 卡。
  const big1 = cards[0];
  const pair1 = [cards[1], cards[2]];
  const big2 = cards[3];
  const pair2 = [cards[4], cards[5]];
  const pair3 = [cards[6], cards[7]];

  const BigCard = ({ c }: { c?: BannerCard }) => {
    if (!c) return null;
    const featured = !!c.mainTitle;
    return (
      <button
        type="button"
        onClick={() => click(c)}
        className="relative block overflow-hidden rounded-[2px] tap group h-full shrink-0"
        style={{ width: "26%" }}
      >
        <img
          src={img(c.img)}
          alt={c.mainTitle || ""}
          referrerPolicy="no-referrer"
          className="block h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        {featured && (
          <div className="pointer-events-none absolute inset-0">
            {/* eyebrow(bottom-90 scale-0.8)+ 主标题 h3(bottom-75) */}
            {c.eyebrow && (
              <div className="absolute left-3 origin-left" style={{ bottom: 90, transform: "scale(0.8)" }}>
                <span className="block max-w-[220px] truncate text-xs text-white">{c.eyebrow}</span>
              </div>
            )}
            <div className="absolute left-3 max-w-[220px] origin-left truncate text-xs text-white" style={{ bottom: 75 }}>
              {c.mainTitle}
            </div>
            {/* 67px 黑条:44×33 缩略图 + 漫画名 + 题材色标签 + 推荐语 */}
            <div className="absolute bottom-0 flex w-full gap-2 px-3" style={{ height: 67, background: "rgba(0,0,0,0.5)", paddingTop: 11, paddingBottom: 11 }}>
              {c.thumb && (
                <img src={img(c.thumb)} alt="" referrerPolicy="no-referrer" className="block rounded-[5px] object-cover" style={{ width: 33, height: 44 }} />
              )}
              <div className="max-w-[175px] flex-1">
                <div className="flex items-start justify-between">
                  <span className="block max-w-[140px] truncate text-[12px] text-white/80">{c.comicTitle}</span>
                  {c.tag && (
                    <div className="flex items-center rounded-[5px] px-[2px]" style={{ height: 16, background: c.tagColor || "#76797a" }}>
                      <span className="block max-w-[50px] truncate text-[11px] text-white">{c.tag}</span>
                    </div>
                  )}
                </div>
                {c.recommendation && (
                  <p className="max-w-[170px] truncate text-[10px] text-white/80">{c.recommendation}</p>
                )}
              </div>
            </div>
          </div>
        )}
      </button>
    );
  };

  const StackPair = ({ pair }: { pair: (BannerCard | undefined)[] }) => (
    <div className="flex flex-col h-full shrink-0" style={{ width: "15.1%", gap: "1.3%" }}>
      {pair.map((c, i) =>
        !c ? null : (
          <button
            key={i}
            type="button"
            onClick={() => click(c)}
            className="block flex-1 min-h-0 overflow-hidden rounded-[2px] tap"
          >
            <img src={img(c.img)} alt="" referrerPolicy="no-referrer" className="block h-full w-full object-cover" />
          </button>
        )
      )}
    </div>
  );

  return (
    <div className="flex gap-[0.65%] w-full h-[220px] sm:h-[300px] md:h-[360px]">
      <BigCard c={big1} />
      <StackPair pair={pair1} />
      <BigCard c={big2} />
      <StackPair pair={pair2} />
      <StackPair pair={pair3} />
    </div>
  );
}

// B站 swiper loop 复刻:transform 轨道 + 首尾克隆,active 居中、邻屏半透、无限循环。
const BANNER_SLIDE_W = 0.78; // 每屏占容器宽比例(两侧各露 11% 邻屏)
const BANNER_GAP = 12;

function BannerWall({
  slides,
  onOpenTitle,
  onBrowse,
}: {
  slides: BannerCard[][];
  resolvingId: string | null;
  onOpenTitle: (title: string) => void;
  onBrowse: () => void;
}) {
  const n = slides.length;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [wrapW, setWrapW] = useState(0);
  // 扩展列表:[克隆末屏, ...真实, 克隆首屏];pos 指向扩展列表下标,真实首屏在 pos=1。
  const [pos, setPos] = useState(1);
  const [anim, setAnim] = useState(true);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWrapW(el.clientWidth));
    ro.observe(el);
    setWrapW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // 自动播放 5s → 前进一屏。
  useEffect(() => {
    if (n <= 1) return;
    const t = window.setInterval(() => setPos((p) => p + 1), 5000);
    return () => window.clearInterval(t);
  }, [n]);

  // 到克隆屏后,动画结束瞬间无动画跳回对应真实屏。
  const onTransitionEnd = useCallback(() => {
    if (pos === n + 1) {
      setAnim(false);
      setPos(1);
    } else if (pos === 0) {
      setAnim(false);
      setPos(n);
    }
  }, [pos, n]);
  // 关掉动画跳回后,下一帧恢复动画。
  useEffect(() => {
    if (!anim) {
      const id = requestAnimationFrame(() => setAnim(true));
      return () => cancelAnimationFrame(id);
    }
  }, [anim, pos]);

  if (n === 0) return null;

  const ext = [slides[n - 1], ...slides, slides[0]]; // 扩展列表
  const slideW = wrapW * BANNER_SLIDE_W;
  const step = slideW + BANNER_GAP;
  // 让 pos 屏居中:偏移 = 容器中心 - (pos 屏中心)
  const offset = wrapW / 2 - (pos * step + slideW / 2);
  // active 真实屏下标(用于圆点高亮)
  const activeReal = ((pos - 1) % n + n) % n;

  const jump = (realIdx: number) => setPos(realIdx + 1);

  return (
    <section ref={wrapRef} className="relative -mx-4 bg-black py-3 overflow-hidden">
      <div
        className="flex"
        style={{
          gap: BANNER_GAP,
          transform: `translateX(${offset}px)`,
          transition: anim ? "transform .5s cubic-bezier(.22,.58,.12,.98)" : "none",
        }}
        onTransitionEnd={onTransitionEnd}
      >
        {ext.map((cards, i) => {
          const isActive = i === pos;
          return (
            <div
              key={i}
              className="shrink-0 transition-opacity duration-300"
              style={{ width: slideW || "78%", opacity: isActive ? 1 : 0.45 }}
            >
              <BannerSlide cards={cards} onOpenTitle={onOpenTitle} onBrowse={onBrowse} />
            </div>
          );
        })}
      </div>

      {/* 两侧渐变遮罩(照 B站 mask) */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-[11%]" style={{ background: "linear-gradient(90deg, rgba(0,0,0,.75), transparent)" }} />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-[11%]" style={{ background: "linear-gradient(270deg, rgba(0,0,0,.75), transparent)" }} />

      {/* 箭头 */}
      {n > 1 && (
        <>
          <button
            type="button"
            aria-label="上一屏"
            onClick={() => setPos((p) => p - 1)}
            className="absolute top-1/2 left-1 -translate-y-1/2 grid place-items-center text-white z-10"
            style={{ width: 32, height: 80, background: "rgba(0,0,0,.5)" }}
          >
            <IconChevronLeft size={20} />
          </button>
          <button
            type="button"
            aria-label="下一屏"
            onClick={() => setPos((p) => p + 1)}
            className="absolute top-1/2 right-1 -translate-y-1/2 grid place-items-center text-white z-10"
            style={{ width: 32, height: 80, background: "rgba(0,0,0,.5)" }}
          >
            <IconChevronRight size={20} />
          </button>
        </>
      )}

      {/* 圆点 */}
      {n > 1 && (
        <div className="flex justify-center gap-2 mt-2">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`第 ${i + 1} 屏`}
              onClick={() => jump(i)}
              className="rounded-full"
              style={{ width: 6, height: 6, background: "#fff", opacity: i === activeReal ? 1 : 0.5 }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// 为你推荐(严格照 B站 DOM 复刻):标题 32px + 深色圆角卡,
//   左栏 标题24px/灰药丸标签/427px 分隔线/2行简介/64×85 缩略图条(选中放大 1.25),
//   右侧大图 562×316 向上探出卡片,右下角 去阅读 药丸。整体桌面重叠、窄屏堆叠。
function RecommendPanel({
  items,
  resolvingId,
  onOpen,
}: {
  items: DiscoverItem[];
  resolvingId: string | null;
  onOpen: (item: DiscoverItem) => void;
}) {
  const [sel, setSel] = useState(0);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [paused, setPaused] = useState(false);
  // 左侧缩略图条自动轮播(照 B站),右侧大图跟随;鼠标悬停/交互时暂停。
  useEffect(() => {
    if (paused || items.length <= 1) return;
    const t = window.setInterval(() => {
      setSel((s) => (s + 1) % items.length);
    }, 4000);
    return () => window.clearInterval(t);
  }, [paused, items.length]);
  if (items.length === 0) return null;
  const cur = items[Math.min(sel, items.length - 1)];
  const bg = cur.wide || cur.cover;
  const tags = cur.cat ? cur.cat.split(" ").filter(Boolean).slice(0, 3) : [];
  const readBtn = (
    <button
      type="button"
      disabled={resolvingId === cur.id}
      onClick={() => onOpen(cur)}
      className="absolute right-3 bottom-3 grid place-items-center rounded-[22px] tap hover:scale-105 transition-transform"
      style={{ width: 82, height: 36, background: "rgba(0,0,0,0.5)" }}
    >
      {resolvingId === cur.id ? (
        <span className="signal-bars" style={{ height: 12 }}>
          <span></span>
          <span></span>
          <span></span>
        </span>
      ) : (
        <span className="text-[14px] text-white">去阅读</span>
      )}
    </button>
  );
  return (
    <section
      id="mg-reco"
      style={{ scrollMarginTop: 12 }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* 标题 32px + Pick你的最爱 */}
      <div className="flex items-baseline gap-1.5 mb-3">
        <h2 className="font-display text-2xl sm:text-[32px] font-normal text-cream leading-none">为你推荐</h2>
        <span className="text-base text-cream-faint">Pick你的最爱！</span>
      </div>
      {/* 深色圆角卡;桌面右侧留白给大图重叠,大图向上探出所以留 mt。窄屏堆叠 */}
      <div
        className="relative flex flex-col md:block rounded-2xl md:mt-7 md:pr-[47%] md:min-h-[300px]"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
      >
        {/* 左栏信息 */}
        <div className="p-5 md:p-6 order-2 md:order-none">
          <h3 className="truncate text-xl sm:text-2xl font-display font-bold text-cream">{cur.title}</h3>
          {tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {tags.map((t) => (
                <span key={t} className="rounded px-1.5 py-0.5 text-[13px] text-white" style={{ background: "#76797a" }}>
                  {t}
                </span>
              ))}
            </div>
          )}
          <div className="mt-4 h-px max-w-[427px]" style={{ background: "var(--cream-line)" }} />
          {cur.desc && (
            <p className="mt-3 max-w-[427px] text-[14px] leading-relaxed text-cream-dim line-clamp-2">{cur.desc}</p>
          )}
          {/* 缩略图条 64×85,选中放大;py/-my 抵消给 hover 放大留出溢出空间不被裁 */}
          <div className="mt-5 flex items-center gap-3 overflow-x-auto overflow-y-visible vod-scroll-row py-3 -my-2">
            {items.map((it, i) => (
              <button
                key={it.id}
                type="button"
                onMouseEnter={() => setSel(i)}
                onClick={() => setSel(i)}
                className={`relative shrink-0 overflow-hidden rounded-[5px] tap transition-transform duration-300 hover:z-20 hover:scale-125 ${i === sel ? "scale-110" : "scale-100"}`}
                style={{
                  width: 64,
                  height: 85,
                  border: `1px solid ${i === sel ? "var(--ember)" : "transparent"}`,
                }}
              >
                {it.cover && (
                  <img
                    src={wrapImage(it.cover, { Referer: BILI_MANGA_REFERER })}
                    alt={it.title}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                )}
              </button>
            ))}
          </div>
        </div>
        {/* 右侧大图:窄屏在顶部(16:9 block);桌面向上探出黑框(照 B站 -top-27),
            用负 top + 底部内嵌,高度受控不横向溢出。 */}
        <div
          className="relative order-1 md:order-none w-full overflow-hidden rounded-t-2xl aspect-[16/9] md:aspect-auto md:rounded-xl md:absolute md:-top-7 md:bottom-5 md:right-6 md:w-[46%]"
          style={{ background: "var(--ink)" }}
        >
          {bg && !failed[cur.id] ? (
            <img
              key={cur.id}
              src={wrapImage(bg, { Referer: BILI_MANGA_REFERER })}
              alt={cur.title}
              referrerPolicy="no-referrer"
              onError={() => setFailed((f) => ({ ...f, [cur.id]: true }))}
              className="absolute inset-0 w-full h-full object-cover transition-all duration-500"
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-cream-faint">
              <IconManga size={40} />
            </div>
          )}
          {readBtn}
        </div>
      </div>
    </section>
  );
}

// 分区单行(畅销热门/全网热议/完结佳作)—— 照 B站:标题34px + 副标题 + 单行卡 + 右侧大圆箭头。
function ArrowRow({
  title,
  subtitle,
  items,
  resolvingId,
  onOpen,
  anchorId,
}: {
  title: string;
  subtitle?: string;
  items: DiscoverItem[];
  resolvingId: string | null;
  onOpen: (item: DiscoverItem) => void;
  anchorId?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const updateEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 2);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
  }, []);
  useEffect(() => {
    updateEdges();
  }, [updateEdges, items.length]);
  if (items.length === 0) return null;
  const nudge = (dir: -1 | 1) => {
    const el = scrollRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };
  // 箭头锚定在封面竖直中心(桌面卡宽 190,封面 3:4 → 高≈253,中心≈127),
  // 用固定 top + translateY(-50%),不随卡片文字高度变化而移位。
  const arrowBtn = (dir: -1 | 1, disabled: boolean) => (
    <button
      type="button"
      onClick={() => nudge(dir)}
      aria-label={dir < 0 ? "上一批" : "下一批"}
      className="hidden md:grid place-items-center absolute z-10 rounded-full tap text-cream transition-opacity"
      style={{
        width: 44,
        height: 44,
        top: 127,
        transform: "translateY(-50%)",
        [dir < 0 ? "left" : "right"]: -8,
        background: "rgba(14,15,17,0.85)",
        border: "1px solid var(--cream-line)",
        boxShadow: "0 0 14px rgba(0,0,0,0.4)",
        opacity: disabled ? 0 : 1,
        pointerEvents: disabled ? "none" : "auto",
      }}
    >
      {dir < 0 ? <IconChevronLeft size={20} /> : <IconChevronRight size={20} />}
    </button>
  );
  return (
    <section id={anchorId} style={{ scrollMarginTop: 12 }}>
      {/* 标题 34px + 副标题灰 */}
      <div className="flex items-baseline gap-1.5 mb-4">
        <h2 className="font-display text-2xl sm:text-[30px] font-semibold text-cream leading-none">{title}</h2>
        {subtitle && <span className="text-base text-cream-faint">{subtitle}</span>}
      </div>
      <div className="relative">
        {/* py + -my 抵消:给放大卡留出上下溢出空间,又不撑高行 */}
        <div ref={scrollRef} onScroll={updateEdges} className="flex gap-4 overflow-x-auto overflow-y-visible scrollbar-hide py-3 -my-3 px-1 -mx-1">
          {items.map((item) => (
            <div key={item.id} className="shrink-0 w-[150px] sm:w-[190px]">
              <DiscoverCover
                item={item}
                resolving={resolvingId === item.id}
                onClick={() => onOpen(item)}
              />
            </div>
          ))}
        </div>
        {arrowBtn(-1, atStart)}
        {arrowBtn(1, atEnd)}
      </div>
    </section>
  );
}

// 榜单卡片网格:大号橙色序号压在封面左上角(照搬 B站高能排行)。
// 首页传前 6 → 单行;查看全部页传全部 → 自动换行。
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
            {/* 序号大号斜体压在封面左上角上方(照 B站 -top-7 序号图) */}
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
                    src={wrapImage(item.cover, { Referer: BILI_MANGA_REFERER })}
                    alt={item.title}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full grid place-items-center text-cream-faint">
                    <IconManga size={28} />
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
            {/* 标题 18px + 灰色作者/热度 */}
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

// 官方卡片 → 用户 Suwayomi 源的多级解析(发现区 + 榜单全部页共用)。
function useMangaResolve() {
  const navigate = useNavigate();
  const config = useMangaStore((s) => s.config);
  const configured = isMangaConfigured(config);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [chooser, setChooser] = useState<{
    title: string;
    candidates: ScoredCandidate<MangaSearchItem>[];
  } | null>(null);

  const gotoDetail = useCallback(
    (m: MangaSearchItem) => {
      navigate(
        `/manga/detail/${encodeURIComponent(m.sourceId)}/${encodeURIComponent(m.id)}?title=${encodeURIComponent(m.title)}&cover=${encodeURIComponent(m.cover)}&sourceName=${encodeURIComponent(m.sourceName)}`
      );
    },
    [navigate]
  );

  // 逐个查询变体聚合搜索 → 打分决策 → 自动跳 / 弹选择器 / 跳搜索页。
  const openItem = useCallback(
    async (item: DiscoverItem) => {
      if (!configured) {
        void appAlert("漫画阅读需要先配置 Suwayomi 服务,前往设置添加后即可阅读官方推荐。", {
          tone: "warning",
        });
        return;
      }
      if (resolvingId) return;
      setResolvingId(item.id);
      try {
        const seen = new Set<string>();
        const collected: MangaSearchItem[] = [];
        for (const q of titleVariants(item.title)) {
          const res = await searchMangaStream(config, q, {});
          for (const r of res.results) {
            const key = `${r.sourceId}:${r.id}`;
            if (!seen.has(key)) {
              seen.add(key);
              collected.push(r);
            }
          }
          const peek = decideResolution(item.title, collected, (c) => c.title);
          if (peek.kind === "auto") break;
        }
        const decision = decideResolution(item.title, collected, (c) => c.title);
        if (decision.kind === "auto") {
          gotoDetail(decision.item);
        } else if (decision.kind === "choose") {
          setChooser({ title: item.title, candidates: decision.candidates });
        } else {
          navigate(`/manga/search?q=${encodeURIComponent(item.title)}`);
        }
      } catch {
        navigate(`/manga/search?q=${encodeURIComponent(item.title)}`);
      } finally {
        setResolvingId(null);
      }
    },
    [config, configured, resolvingId, navigate, gotoDetail]
  );

  return { resolvingId, chooser, setChooser, openItem, gotoDetail };
}

// 多候选选择器(发现区 + 榜单全部页共用)。
function MangaChooser({
  chooser,
  onClose,
  onPick,
  onManual,
}: {
  chooser: { title: string; candidates: ScoredCandidate<MangaSearchItem>[] } | null;
  onClose: () => void;
  onPick: (m: MangaSearchItem) => void;
  onManual: (title: string) => void;
}) {
  if (!chooser) return null;
  return (
    <Sheet open={!!chooser} onClose={onClose} side="bottom" title={`选择「${chooser.title}」的来源`}>
      <div className="p-3 space-y-2">
        <p className="text-[11px] text-cream-faint px-1">
          官方标题与源里的书名可能有差异,选一个正确的:
        </p>
        {chooser.candidates.map((c) => (
          <button
            key={`${c.item.sourceId}:${c.item.id}`}
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

// 高能排行"查看全部"页(照 B站 /ranking):官方榜 tab 行(新作/男生/女生/国漫/日漫/
// 韩漫/宝藏/完结/原创)+ 当前榜 ~50 名网格。数据走 SSR 免签名接口,点条目走用户源解析。
function MangaRanking() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const urlId = Number(params.get("id"));
  const [activeId, setActiveId] = useState<number>(
    Number.isFinite(urlId) ? urlId : 1
  );
  const [page, setPage] = useState<MangaRankPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { resolvingId, chooser, setChooser, openItem, gotoDetail } = useMangaResolve();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    fetchMangaRanking(activeId)
      .then((p) => {
        if (alive) setPage(p);
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
  }, [activeId]);

  const selectTab = (id: number) => {
    setActiveId(id);
    setParams({ id: String(id) }, { replace: true });
  };

  const tabs = page?.tabs || [];
  const curName = tabs.find((t) => t.id === activeId)?.name;

  return (
    <PageShell
      title={curName ? `高能排行 · ${curName}` : "高能排行"}
      eyebrow="MANGA · RANKING"
      onBack={() => navigate(-1)}
    >
      {/* 榜 tab 行(照 B站 ranking 顶部) */}
      {tabs.length > 0 && (
        <div className="mb-4 flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
          {tabs.map((t) => {
            const active = t.id === activeId;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => selectTab(t.id)}
                className="shrink-0 rounded-full px-4 py-1.5 text-sm font-display tap transition-colors"
                style={{
                  background: active ? "var(--ember)" : "var(--ink-2)",
                  color: active ? "var(--ink)" : "var(--cream-dim)",
                  border: `1px solid ${active ? "var(--ember)" : "var(--cream-line)"}`,
                }}
              >
                {t.name}
              </button>
            );
          })}
        </div>
      )}

      {error ? (
        <p className="text-sm text-ember">{error}</p>
      ) : loading && !page ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="aspect-[3/4] rounded-lg animate-pulse" style={{ background: "var(--ink-2)" }} />
              <div className="h-3 w-3/4 rounded animate-pulse" style={{ background: "var(--ink-2)" }} />
            </div>
          ))}
        </div>
      ) : (
        <RankList items={page?.list || []} resolvingId={resolvingId} onOpen={openItem} />
      )}
      <MangaChooser
        chooser={chooser}
        onClose={() => setChooser(null)}
        onPick={(m) => {
          gotoDetail(m);
          setChooser(null);
        }}
        onManual={(t) => {
          setChooser(null);
          navigate(`/manga/search?q=${encodeURIComponent(t)}`);
        }}
      />
    </PageShell>
  );
}

// ─── 分类页(照 B站 classify 布局)───────────────────────
// 筛选项(题材/地区/进度/排序/收费)走 B站官方 AllLabel 接口(免签名),不自己编。
// 列表数据走 gaia WASM 签名接口拿不到,用首页免签名数据聚合出的本地目录(catalog)做筛选。
// 布局照搬 B站:多行筛选 chips + 封面网格。点卡片走同一套多级解析到用户配置的源。
type ClassifyFilters = {
  style: number; // 官方 style id,-1 = 全部
  area: number; // 官方 area id,-1 = 全部
  status: number; // 官方 status id(0=连载 1=完结),-1 = 全部
  order: number; // 官方 order id(0=人气 1=更新 3=上架)
  price: number; // 官方 price id,-1 = 全部(本地目录无收费信息,仅照布局展示)
};

function classifyToDiscover(c: ClassifyComic): DiscoverItem {
  return {
    id: c.id,
    title: c.title,
    cover: c.cover,
    author: c.author,
    cat: c.styles.slice(0, 2).join(" ") || undefined,
    finished: c.finished,
    episodes: c.total,
    metaSegs: c.finished
      ? [{ text: "完结" }, ...(c.total ? [{ text: `共 ${c.total} 话` }] : [])]
      : c.total
        ? [{ text: `共 ${c.total} 话` }]
        : undefined,
  };
}

function FilterRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: number; label: string }[];
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="shrink-0 pt-1.5 text-sm text-cream-faint w-9">{label}</span>
      <div className="flex flex-wrap gap-x-1.5 gap-y-1.5">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              className="rounded-md px-3 py-1.5 text-sm tap transition-colors"
              style={{
                background: active ? "var(--ember-soft)" : "transparent",
                color: active ? "var(--ember)" : "var(--cream-dim)",
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const CLASSIFY_PAGE_SIZE = 24; // 每批渲染数(客户端"加载更多")

function MangaClassify() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [list, setList] = useState<ClassifyComic[]>([]);
  const [labels, setLabels] = useState<MangaLabels | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(CLASSIFY_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const reqRef = useRef(0);
  // 官方筛选项一律用 id(SSR tabListData 返回)。-1 = 全部;orders 默认 0(人气推荐)。
  const initStyle = Number(params.get("style"));
  const [f, setF] = useState<ClassifyFilters>({
    style: Number.isFinite(initStyle) && initStyle > 0 ? initStyle : -1,
    area: -1,
    status: -1,
    price: -1,
    order: 0,
  });
  const { resolvingId, chooser, setChooser, openItem, gotoDetail } = useMangaResolve();

  // 每次筛选变化 → 去 B站移动端 SSR 查真实、随筛选变化的数据(合并 3 种排序去重)。
  useEffect(() => {
    const token = ++reqRef.current;
    setLoading(true);
    setError("");
    const q: MangaClassifyQuery = {
      styles: f.style,
      areas: f.area,
      status: f.status,
      prices: f.price,
      special: 0,
      orders: f.order,
    };
    fetchMangaClassify(q)
      .then((res) => {
        if (token !== reqRef.current) return;
        setList(res.list);
        if (res.labels) setLabels(res.labels);
        setVisible(CLASSIFY_PAGE_SIZE);
      })
      .catch((e) => {
        if (token === reqRef.current) setError((e as Error).message);
      })
      .finally(() => {
        if (token === reqRef.current) setLoading(false);
      });
  }, [f]);

  // 官方 chips → FilterRow options(前置「全部」= -1)。
  const withAll = (opts: MangaLabelOption[] | undefined) => [
    { value: -1, label: "全部" },
    ...(opts || []).map((o) => ({ value: o.id, label: o.name })),
  ];

  // 客户端"加载更多":每批 CLASSIFY_PAGE_SIZE 部,滚到底再放一批。
  const shown = list.slice(0, visible);
  const hasMore = visible < list.length;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (obs) => {
        if (obs[0]?.isIntersecting) {
          setVisible((v) => Math.min(v + CLASSIFY_PAGE_SIZE, list.length));
        }
      },
      { rootMargin: "400px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, list.length]);

  return (
    <PageShell title="全部漫画" eyebrow="MANGA · CLASSIFY" onBack={() => navigate(-1)}>
      {error && list.length === 0 ? (
        <p className="text-sm text-ember">{error}</p>
      ) : loading && list.length === 0 ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="aspect-[3/4] rounded-lg animate-pulse" style={{ background: "var(--ink-2)" }} />
              <div className="h-3 w-3/4 rounded animate-pulse" style={{ background: "var(--ink-2)" }} />
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* 筛选区(官方 AllLabel 数据 + B站 classify 布局):题材/地区/进度/收费/排序 */}
          <div
            className="mb-4 rounded-xl p-2 sm:p-3"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          >
            <FilterRow
              label="题材"
              value={f.style}
              onChange={(v) => setF((s) => ({ ...s, style: v }))}
              options={withAll(labels?.styles)}
            />
            <FilterRow
              label="地区"
              value={f.area}
              onChange={(v) => setF((s) => ({ ...s, area: v }))}
              options={withAll(labels?.areas)}
            />
            <FilterRow
              label="进度"
              value={f.status}
              onChange={(v) => setF((s) => ({ ...s, status: v }))}
              options={withAll(labels?.status)}
            />
            <FilterRow
              label="收费"
              value={f.price}
              onChange={(v) => setF((s) => ({ ...s, price: v }))}
              options={withAll(labels?.prices)}
            />
            {labels?.orders && labels.orders.length > 0 && (
              <FilterRow
                label="排序"
                value={f.order}
                onChange={(v) => setF((s) => ({ ...s, order: v }))}
                options={labels.orders.map((o) => ({ value: o.id, label: o.name }))}
              />
            )}
          </div>

          {/* 结果数 */}
          <p className="mb-3 text-xs text-cream-faint font-mono">
            共 {list.length} 部
          </p>

          {list.length === 0 ? (
            <EmptyState icon={<IconManga size={48} />} title="没有符合条件的漫画" subtitle="换个筛选条件试试。" />
          ) : (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-x-3 gap-y-1">
                {shown.map((c) => (
                  <DiscoverCover
                    key={c.id}
                    item={classifyToDiscover(c)}
                    resolving={resolvingId === c.id}
                    onClick={() => openItem(classifyToDiscover(c))}
                  />
                ))}
              </div>
              <div ref={sentinelRef} className="h-10" />
              {hasMore && (
                <p className="text-center text-xs text-cream-faint py-3 font-mono">加载中…</p>
              )}
              {!hasMore && list.length > CLASSIFY_PAGE_SIZE && (
                <p className="text-center text-xs text-cream-faint py-3 font-mono">没有更多了</p>
              )}
            </>
          )}
        </>
      )}
      <MangaChooser
        chooser={chooser}
        onClose={() => setChooser(null)}
        onPick={(m) => {
          gotoDetail(m);
          setChooser(null);
        }}
        onManual={(t) => {
          setChooser(null);
          navigate(`/manga/search?q=${encodeURIComponent(t)}`);
        }}
      />
    </PageShell>
  );
}

function MangaDiscover({ recentSlot }: { recentSlot?: React.ReactNode }) {
  const navigate = useNavigate();
  const [home, setHome] = useState<MangaHomeData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rankRegion, setRankRegion] = useState<RankRegion>("JP");
  const { resolvingId, chooser, setChooser, openItem, gotoDetail } = useMangaResolve();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    fetchMangaHome()
      .then((d) => {
        if (alive) setHome(d);
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
  }, []);

  if (loading && !home) {
    return (
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="shrink-0 w-[104px] space-y-1.5">
            <div className="aspect-[3/4] rounded-lg animate-pulse" style={{ background: "var(--ink-2)" }} />
            <div className="h-3 w-3/4 rounded animate-pulse" style={{ background: "var(--ink-2)" }} />
          </div>
        ))}
      </div>
    );
  }
  if (error && !home) return <p className="text-sm text-ember">{error}</p>;
  if (!home) return null;

  const rankItems = home.ranking[rankRegion];

  return (
    <>
      <div className="space-y-6">
        {/* 顶部分类区(照搬 B站):banner 封面墙轮播 + 题材 chips 条 */}
        <BannerWall
          slides={home.banner}
          resolvingId={resolvingId}
          onOpenTitle={(title) =>
            openItem({ id: `banner:${title}`, title, cover: "" })
          }
          onBrowse={() => navigate("/manga/browse")}
        />
        {home.categories.length > 0 && (
          <div className="flex items-center gap-x-4 gap-y-2 flex-wrap -mt-2">
            {home.categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => navigate(`/manga/classify?style=${encodeURIComponent(c.name)}`)}
                className="text-sm font-display tap text-cream-dim hover:text-ember"
              >
                {c.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => navigate("/manga/classify")}
              className="flex items-center gap-0.5 text-sm font-display text-cream tap"
            >
              全部 <IconChevronRight size={13} />
            </button>
          </div>
        )}

        {recentSlot}

        <RecommendPanel items={home.recommendation} resolvingId={resolvingId} onOpen={openItem} />
        <ArrowRow anchorId="mg-hot" title="畅销热门" subtitle="物有所值的真香漫画" items={home.hotSeller} resolvingId={resolvingId} onOpen={openItem} />
        <ArrowRow anchorId="mg-net" title="全网热议" subtitle="恭喜你发现宝藏" items={home.internetHot} resolvingId={resolvingId} onOpen={openItem} />
        <ArrowRow anchorId="mg-fin" title="完结佳作" subtitle="一口气追到大结局！" items={home.completed} resolvingId={resolvingId} onOpen={openItem} />

        {rankItems.length > 0 && (
          <section id="mg-rank" style={{ scrollMarginTop: 12 }}>
            {/* 高能排行标题 + 大号 tab(日漫榜/国漫榜/韩漫榜)+ 竖分隔 + 蓝色更多药丸 */}
            <div className="flex items-center justify-between mb-4 gap-2">
              <div className="flex items-center min-w-0">
                <h2 className="font-display font-extrabold text-xl text-cream shrink-0">高能排行</h2>
                <span className="mx-4 h-6 w-px shrink-0" style={{ background: "var(--cream-line)" }} />
                <div className="flex items-center gap-6 overflow-x-auto vod-scroll-row">
                  {(
                    [
                      ["JP", "日漫榜"],
                      ["CN", "国漫榜"],
                      ["KO", "韩漫榜"],
                    ] as [RankRegion, string][]
                  ).map(([r, label]) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRankRegion(r)}
                      className="shrink-0 text-lg font-display transition-colors tap"
                      style={{ color: rankRegion === r ? "var(--cream)" : "var(--cream-faint)" }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  navigate(
                    `/manga/ranking?id=${rankRegion === "JP" ? 0 : rankRegion === "CN" ? 1 : 2}`
                  )
                }
                className="flex items-center gap-0.5 rounded-full px-3 py-1.5 text-xs font-display tap shrink-0"
                style={{ background: "var(--ember-soft)", color: "var(--ember)" }}
              >
                更多 <IconChevronRight size={13} />
              </button>
            </div>
            {/* 首页只显示前 6 名 */}
            <RankList items={rankItems.slice(0, 6)} resolvingId={resolvingId} onOpen={openItem} />
          </section>
        )}
      </div>

      <MangaChooser
        chooser={chooser}
        onClose={() => setChooser(null)}
        onPick={(m) => {
          gotoDetail(m);
          setChooser(null);
        }}
        onManual={(t) => {
          setChooser(null);
          navigate(`/manga/search?q=${encodeURIComponent(t)}`);
        }}
      />
    </>
  );
}

// ─── 首页 / 书架 + 推荐 ───────────────────────────────
function MangaHome() {
  const navigate = useNavigate();
  const shelf = useMangaStore((s) => s.shelf);
  const history = useMangaStore((s) => s.history);
  const clearHistory = useMangaStore((s) => s.clearHistory);
  const config = useMangaStore((s) => s.config);

  const configured = isMangaConfigured(config);

  // 最近阅读小卡横条(放在为你推荐上方),带清空。
  const recentSlot =
    configured && history.length > 0 ? (
      <RecentReadStrip
        history={history}
        onOpen={(h) =>
          navigate(
            `/manga/reader/${encodeURIComponent(h.sourceId)}/${encodeURIComponent(h.mangaId)}/${encodeURIComponent(h.chapterId)}?title=${encodeURIComponent(h.title)}&cover=${encodeURIComponent(h.cover)}&sourceName=${encodeURIComponent(h.sourceName)}&chapterName=${encodeURIComponent(h.chapterName)}`
          )
        }
        onClear={async () => {
          const ok = await appConfirm("确定清空全部最近阅读记录?", { tone: "warning" });
          if (ok) clearHistory();
        }}
        onMore={() => navigate("/manga/mine")}
      />
    ) : undefined;

  const trailing = (
    <div className="flex items-center gap-2">
      {configured && (
        <>
          <button
            type="button"
            onClick={() => navigate("/manga/mine")}
            className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream-dim"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            aria-label="我的数据"
          >
            <IconBookmark size={16} />
          </button>
          <button
            type="button"
            onClick={() => navigate("/manga/browse")}
            className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream-dim"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            aria-label="源站寻书"
          >
            <IconGrid size={16} />
          </button>
        </>
      )}
      <button
        type="button"
        onClick={() => navigate("/manga/search")}
        className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream-dim"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
        aria-label="搜索漫画"
      >
        <IconSearch size={16} />
      </button>
      <button
        type="button"
        onClick={() => navigate("/settings/manga-hub")}
        className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream-dim"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
        aria-label="漫画设置"
      >
        <IconSettings size={16} />
      </button>
    </div>
  );

  return (
    <PageShell title="漫画" eyebrow="MANGA · SUWAYOMI" trailing={trailing}>
      <div className="space-y-6">
        {/* 官方发现区(壳子)—— 不依赖 Suwayomi,常驻展示。最近阅读小条插在为你推荐上方 */}
        <MangaDiscover recentSlot={recentSlot} />

        {/* 未配置 Suwayomi:细提示条(阅读需要源) */}
        {!configured && (
          <div
            className="flex items-center justify-between gap-3 rounded-lg p-3"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          >
            <p className="text-xs text-cream-dim leading-relaxed">
              阅读漫画需要先配置 Suwayomi 服务,配置后即可打开上面的官方推荐。
            </p>
            <button
              type="button"
              onClick={() => navigate("/settings/manga-hub")}
              className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-display font-semibold tap"
              style={{ background: "var(--ember)", color: "var(--ink)" }}
            >
              前往设置
            </button>
          </div>
        )}

        {configured && shelf.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display font-bold text-sm text-cream">我的书架</h2>
              <button
                type="button"
                onClick={() => navigate("/manga/mine")}
                className="flex items-center gap-0.5 text-xs font-display text-cream-dim tap hover:text-ember"
              >
                全部 <IconChevronRight size={12} />
              </button>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {shelf.slice(0, 6).map((item) => (
                <MangaCover
                  key={`${item.sourceId}:${item.mangaId}`}
                  cover={item.cover}
                  title={item.title}
                  badge={
                    item.unreadChapterCount && item.unreadChapterCount > 0 ? (
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-mono font-bold glow-ember"
                        style={{ background: "var(--ember)", color: "var(--ink)" }}
                      >
                        +{item.unreadChapterCount}
                      </span>
                    ) : undefined
                  }
                  onClick={() =>
                    navigate(
                      `/manga/detail/${encodeURIComponent(item.sourceId)}/${encodeURIComponent(item.mangaId)}`
                    )
                  }
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </PageShell>
  );
}

// 最近阅读小卡横条(放首页为你推荐上方):比书架卡小一圈,横向滚动,带清空 + 全部。
function RecentReadStrip({
  history,
  onOpen,
  onClear,
  onMore,
}: {
  history: MangaReadRecord[];
  onOpen: (h: MangaReadRecord) => void;
  onClear: () => void;
  onMore: () => void;
}) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <IconHistoryClock size={15} />
          <h2 className="font-display font-bold text-sm text-cream">最近阅读</h2>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClear}
            className="flex items-center gap-0.5 text-xs font-display text-cream-faint tap hover:text-ember"
            aria-label="清空最近阅读"
          >
            <IconTrash size={12} /> 清空
          </button>
          <button
            type="button"
            onClick={onMore}
            className="flex items-center gap-0.5 text-xs font-display text-cream-dim tap hover:text-ember"
          >
            全部 <IconChevronRight size={12} />
          </button>
        </div>
      </div>
      <div className="flex gap-3 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1">
        {history.slice(0, 15).map((h) => {
          const pct = h.pageCount > 0 ? Math.round(((h.pageIndex + 1) / h.pageCount) * 100) : 0;
          return (
            <button
              key={`${h.sourceId}:${h.mangaId}`}
              type="button"
              onClick={() => onOpen(h)}
              className="group shrink-0 w-[76px] sm:w-[88px] text-left tap"
            >
              <div
                className="relative aspect-[3/4] w-full overflow-hidden rounded-lg"
                style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
              >
                {h.cover ? (
                  <img
                    src={wrapImage(h.cover, undefined, { bypassProxy: true })}
                    alt={h.title}
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full grid place-items-center text-cream-faint">
                    <IconManga size={22} />
                  </div>
                )}
                {pct > 0 && (
                  <div className="absolute inset-x-0 bottom-0 h-1" style={{ background: "rgba(0,0,0,0.5)" }}>
                    <div className="h-full" style={{ width: `${pct}%`, background: "var(--ember)" }} />
                  </div>
                )}
              </div>
              <p className="mt-1 text-[11px] font-display line-clamp-1 text-cream-dim group-hover:text-cream">
                {h.title}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ─── 我的数据(完整书架 + 最近阅读 + 管理)──────────────────
function MangaMine() {
  const navigate = useNavigate();
  const shelf = useMangaStore((s) => s.shelf);
  const history = useMangaStore((s) => s.history);
  const isOnShelf = useMangaStore((s) => s.isOnShelf);
  const toggleShelf = useMangaStore((s) => s.toggleShelf);
  const removeHistory = useMangaStore((s) => s.removeHistory);
  const clearHistory = useMangaStore((s) => s.clearHistory);
  const [tab, setTab] = useState<"shelf" | "history">("shelf");
  const [actionTarget, setActionTarget] = useState<MangaReadRecord | null>(null);

  const openReader = (h: MangaReadRecord) =>
    navigate(
      `/manga/reader/${encodeURIComponent(h.sourceId)}/${encodeURIComponent(h.mangaId)}/${encodeURIComponent(h.chapterId)}?title=${encodeURIComponent(h.title)}&cover=${encodeURIComponent(h.cover)}&sourceName=${encodeURIComponent(h.sourceName)}&chapterName=${encodeURIComponent(h.chapterName)}`
    );

  const list: [typeof tab, string, number][] = [
    ["shelf", "我的书架", shelf.length],
    ["history", "最近阅读", history.length],
  ];

  return (
    <PageShell title="我的数据" eyebrow="MANGA · LIBRARY" onBack={() => navigate(-1)}>
      {/* tab 切换 */}
      <div className="flex items-center gap-2 mb-4">
        {list.map(([k, label, n]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className="rounded-full px-4 py-1.5 text-sm font-display font-semibold tap"
            style={{
              background: tab === k ? "var(--ember)" : "var(--ink-2)",
              color: tab === k ? "var(--ink)" : "var(--cream-dim)",
              border: `1px solid ${tab === k ? "var(--ember)" : "var(--cream-line)"}`,
            }}
          >
            {label} {n > 0 && <span className="font-mono">{n}</span>}
          </button>
        ))}
        {tab === "history" && history.length > 0 && (
          <button
            type="button"
            onClick={async () => {
              const ok = await appConfirm("确定清空全部最近阅读记录?", { tone: "warning" });
              if (ok) clearHistory();
            }}
            className="ml-auto flex items-center gap-0.5 text-xs font-display text-cream-faint tap hover:text-ember"
          >
            <IconTrash size={13} /> 清空
          </button>
        )}
      </div>

      {tab === "shelf" ? (
        shelf.length === 0 ? (
          <EmptyState icon={<IconBookmark size={48} />} title="书架还是空的" subtitle="在详情页点「加入书架」收藏漫画。" />
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {shelf.map((item) => (
              <MangaCover
                key={`${item.sourceId}:${item.mangaId}`}
                cover={item.cover}
                title={item.title}
                badge={
                  item.unreadChapterCount && item.unreadChapterCount > 0 ? (
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-mono font-bold glow-ember"
                      style={{ background: "var(--ember)", color: "var(--ink)" }}
                    >
                      +{item.unreadChapterCount}
                    </span>
                  ) : undefined
                }
                onClick={() =>
                  navigate(
                    `/manga/detail/${encodeURIComponent(item.sourceId)}/${encodeURIComponent(item.mangaId)}`
                  )
                }
              />
            ))}
          </div>
        )
      ) : history.length === 0 ? (
        <EmptyState icon={<IconHistoryClock size={48} />} title="还没有阅读记录" subtitle="读过的漫画会出现在这里。" />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {history.map((h) => (
            <MangaHistoryCard
              key={`${h.sourceId}:${h.mangaId}`}
              record={h}
              onOpen={() => openReader(h)}
              onLongPress={() => setActionTarget(h)}
            />
          ))}
        </div>
      )}

      {/* 历史记录操作菜单 */}
      {actionTarget && (
        <Sheet open={!!actionTarget} onClose={() => setActionTarget(null)} side="bottom" title={actionTarget.title}>
          <div className="p-3 space-y-1">
            <button
              type="button"
              onClick={() => {
                openReader(actionTarget);
                setActionTarget(null);
              }}
              className="w-full text-left px-4 py-3 rounded-lg text-sm tap text-cream"
              style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            >
              继续阅读
            </button>
            <button
              type="button"
              onClick={() => {
                navigate(
                  `/manga/detail/${encodeURIComponent(actionTarget.sourceId)}/${encodeURIComponent(actionTarget.mangaId)}`
                );
                setActionTarget(null);
              }}
              className="w-full text-left px-4 py-3 rounded-lg text-sm tap text-cream"
              style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            >
              查看详情
            </button>
            <button
              type="button"
              onClick={() => {
                toggleShelf({
                  sourceId: actionTarget.sourceId,
                  sourceName: actionTarget.sourceName,
                  mangaId: actionTarget.mangaId,
                  title: actionTarget.title,
                  cover: actionTarget.cover,
                  saveTime: Date.now(),
                });
                setActionTarget(null);
              }}
              className="w-full text-left px-4 py-3 rounded-lg text-sm tap text-cream"
              style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            >
              {isOnShelf(actionTarget.sourceId, actionTarget.mangaId) ? "移出书架" : "加入书架"}
            </button>
            <button
              type="button"
              onClick={() => {
                removeHistory(actionTarget.sourceId, actionTarget.mangaId);
                setActionTarget(null);
              }}
              className="w-full text-left px-4 py-3 rounded-lg text-sm tap text-ember"
              style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            >
              删除记录
            </button>
          </div>
        </Sheet>
      )}
    </PageShell>
  );
}

// ─── 搜索 ───────────────────────────────
function MangaSearch() {
  const navigate = useNavigate();
  const config = useMangaStore((s) => s.config);
  const [query, setQuery] = useState("");
  const [sources, setSources] = useState<MangaSource[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [results, setResults] = useState<MangaSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const runTokenRef = useRef(0);

  useEffect(() => {
    getMangaSources(config).then(setSources).catch(() => undefined);
  }, [config]);

  const doSearch = useCallback(
    async (e?: React.FormEvent, override?: string) => {
      e?.preventDefault();
      const q = (override ?? query).trim();
      if (!q) return;
      const token = ++runTokenRef.current;
      setLoading(true);
      setError("");
      setSearched(true);
      setResults([]);
      setProgress({ done: 0, total: 0 });
      const seen = new Set<string>();
      const errors: string[] = [];
      try {
        const res = await searchMangaStream(
          config,
          q,
          {
            onStart: (total) => {
              if (token === runTokenRef.current) setProgress({ done: 0, total });
            },
            onSourceResult: (_source, sourceResults, done, total) => {
              if (token !== runTokenRef.current) return;
              const fresh = sourceResults.filter((item) => {
                const key = `${item.sourceId}:${item.id}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              });
              if (fresh.length > 0) setResults((prev) => [...prev, ...fresh]);
              setProgress({ done, total });
            },
            onSourceError: (failure, done, total) => {
              if (token !== runTokenRef.current) return;
              errors.push(failure.error);
              setProgress({ done, total });
            },
          },
          sourceId || undefined
        );
        if (
          token === runTokenRef.current &&
          res.results.length === 0 &&
          res.failedSources.length > 0
        ) {
          setError(errors.join("; "));
        }
      } catch (err) {
        if (token === runTokenRef.current) {
          setError((err as Error).message);
          setResults([]);
        }
      } finally {
        if (token === runTokenRef.current) setLoading(false);
      }
    },
    [config, query, sourceId]
  );

  // 从官方发现区跳来时带 ?q=标题,自动预填 + 搜索一次。
  const [searchParams] = useSearchParams();
  const autoQ = searchParams.get("q") || "";
  const autoRanRef = useRef("");
  useEffect(() => {
    if (!autoQ || autoRanRef.current === autoQ) return;
    autoRanRef.current = autoQ;
    setQuery(autoQ);
    void doSearch(undefined, autoQ);
  }, [autoQ, doSearch]);

  return (
    <PageShell
      title="搜索漫画"
      eyebrow="MANGA · SEARCH"
      onBack={() => navigate(-1)}
    >
      <form onSubmit={doSearch} className="flex flex-col sm:flex-row gap-2 mb-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索漫画标题"
          className="flex-1 rounded-lg px-3 py-2.5 text-sm outline-none"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
            color: "var(--cream)",
          }}
        />
        <select
          value={sourceId}
          onChange={(e) => setSourceId(e.target.value)}
          className="rounded-lg px-3 py-2.5 text-sm outline-none sm:w-44"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
            color: "var(--cream-dim)",
          }}
        >
          <option value="">全部来源</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.displayName || s.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-lg px-6 py-2.5 text-sm font-display font-semibold tap sm:w-28"
          style={{ background: "var(--ember)", color: "var(--ink)" }}
        >
          搜索
        </button>
      </form>

      {loading && progress.total > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="font-mono text-[11px] text-cream-faint">
              搜索中 {progress.done}/{progress.total} 个来源
            </span>
          </div>
          <div className="h-1 rounded-full bg-ink-2 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                background: "var(--ember)",
              }}
            />
          </div>
        </div>
      )}

      {loading && results.length === 0 ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div
                className="aspect-[3/4] rounded-lg animate-pulse"
                style={{ background: "var(--ink-2)" }}
              />
              <div
                className="h-3 w-3/4 rounded animate-pulse"
                style={{ background: "var(--ink-2)" }}
              />
            </div>
          ))}
        </div>
      ) : error && results.length === 0 ? (
        <p className="text-sm text-ember">{error}</p>
      ) : results.length === 0 && !loading ? (
        <EmptyState
          icon={<IconSearch size={48} />}
          title={searched ? "没有找到相关漫画" : "输入关键词开始搜索"}
        />
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
          {results.map((item) => (
            <MangaCover
              key={`${item.sourceId}:${item.id}`}
              cover={item.cover}
              title={item.title}
              onClick={() =>
                navigate(
                  `/manga/detail/${encodeURIComponent(item.sourceId)}/${encodeURIComponent(item.id)}?title=${encodeURIComponent(item.title)}&cover=${encodeURIComponent(item.cover)}&sourceName=${encodeURIComponent(item.sourceName)}&description=${encodeURIComponent(item.description || "")}&author=${encodeURIComponent(item.author || "")}&status=${encodeURIComponent(item.status || "")}`
                )
              }
            />
          ))}
        </div>
      )}
    </PageShell>
  );
}

// ─── 详情 ───────────────────────────────
function MangaDetailView() {
  const navigate = useNavigate();
  const { sourceId = "", mangaId = "" } = useParams();
  const [params] = useSearchParams();
  const config = useMangaStore((s) => s.config);
  const isOnShelf = useMangaStore((s) => s.isOnShelf);
  const toggleShelf = useMangaStore((s) => s.toggleShelf);
  const getHistory = useMangaStore((s) => s.getHistory);
  const [detail, setDetail] = useState<MangaDetail | null>(null);
  const [error, setError] = useState("");
  const [descOrder, setDescOrder] = useState(true);
  const [descOpen, setDescOpen] = useState(false);

  const onShelf = isOnShelf(sourceId, mangaId);
  const record = getHistory(sourceId, mangaId);

  useEffect(() => {
    if (!sourceId || !mangaId) return;
    setError("");
    getMangaDetail(config, {
      sourceId,
      mangaId,
      title: params.get("title") || undefined,
      cover: params.get("cover") || undefined,
      sourceName: params.get("sourceName") || undefined,
      description: params.get("description") || undefined,
      author: params.get("author") || undefined,
      status: params.get("status") || undefined,
    })
      .then(setDetail)
      .catch((e) => setError((e as Error).message));
  }, [config, sourceId, mangaId, params]);

  const chapters = useMemo(() => {
    const list = detail?.chapters || [];
    return [...list].sort((a, b) => {
      const diff = (a.chapterNumber || 0) - (b.chapterNumber || 0);
      return descOrder ? -diff : diff;
    });
  }, [detail?.chapters, descOrder]);

  const openChapter = (chapter: MangaChapter) => {
    if (!detail) return;
    navigate(
      `/manga/reader/${encodeURIComponent(sourceId)}/${encodeURIComponent(mangaId)}/${encodeURIComponent(chapter.id)}?title=${encodeURIComponent(detail.title)}&cover=${encodeURIComponent(detail.cover)}&sourceName=${encodeURIComponent(detail.sourceName)}&chapterName=${encodeURIComponent(chapter.name)}`
    );
  };

  const handleShelf = () => {
    if (!detail) return;
    const item: MangaShelfItem = {
      sourceId: detail.sourceId,
      sourceName: detail.sourceName,
      mangaId: detail.id,
      title: detail.title,
      cover: detail.cover,
      description: detail.description,
      author: detail.author,
      status: detail.status,
      saveTime: Date.now(),
    };
    toggleShelf(item);
  };

  const continueChapter =
    record &&
    (detail?.chapters.find((c) => c.id === record.chapterId) ||
      chapters[chapters.length - 1]);

  const genres = (detail?.genre || "")
    .split(/[,，、]/)
    .map((g) => g.trim())
    .filter(Boolean)
    .slice(0, 6);
  const readProgress =
    record && record.pageCount > 0
      ? Math.round(((record.pageIndex + 1) / record.pageCount) * 100)
      : 0;

  return (
    <PageShell
      title={detail?.title || params.get("title") || "漫画详情"}
      eyebrow="MANGA · DETAIL"
      onBack={() => navigate(-1)}
    >
      {error ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <IconManga size={40} />
          <p className="text-sm text-ember">{error}</p>
        </div>
      ) : !detail ? (
        <div className="space-y-5">
          <div className="flex gap-4">
            <div className="w-28 sm:w-36 aspect-[3/4] rounded-xl animate-pulse shrink-0" style={{ background: "var(--ink-2)" }} />
            <div className="flex-1 space-y-3 pt-2">
              <div className="h-5 w-2/3 rounded animate-pulse" style={{ background: "var(--ink-2)" }} />
              <div className="h-3 w-1/3 rounded animate-pulse" style={{ background: "var(--ink-2)" }} />
              <div className="h-3 w-full rounded animate-pulse" style={{ background: "var(--ink-2)" }} />
              <div className="h-3 w-4/5 rounded animate-pulse" style={{ background: "var(--ink-2)" }} />
            </div>
          </div>
        </div>
      ) : (
        <div className="-m-4">
          {/* 头图区:模糊封面背景 + 渐隐,前景封面卡 + 信息 */}
          <div className="relative overflow-hidden">
            {detail.cover && (
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  backgroundImage: `url(${detail.cover})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  filter: "blur(28px) saturate(1.2)",
                  transform: "scale(1.2)",
                  opacity: 0.35,
                }}
              />
            )}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "linear-gradient(180deg, rgba(14,15,17,0.55) 0%, rgba(14,15,17,0.85) 65%, var(--ink) 100%)",
              }}
            />
            <div className="relative p-4 pt-5 flex gap-4">
              <div
                className="w-28 sm:w-36 shrink-0 aspect-[3/4] rounded-xl overflow-hidden shadow-lg"
                style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
              >
                {detail.cover ? (
                  <img src={detail.cover} alt={detail.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full grid place-items-center text-cream-faint">
                    <IconManga size={32} />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0 flex flex-col">
                <h2 className="font-display font-extrabold text-xl sm:text-2xl text-cream leading-tight line-clamp-3">
                  {detail.title}
                </h2>
                {detail.author && (
                  <p className="mt-1.5 text-sm text-cream-dim line-clamp-1">{detail.author}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {detail.status && (
                    <span
                      className="rounded px-2 py-0.5 text-[11px] font-mono"
                      style={{ background: "var(--ember-soft)", color: "var(--ember)" }}
                    >
                      {detail.status}
                    </span>
                  )}
                  <span className="rounded px-2 py-0.5 text-[11px] font-mono text-cream-dim" style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}>
                    {detail.sourceName}
                  </span>
                  <span className="text-[11px] font-mono text-cream-faint">
                    {detail.chapters.length} 话
                  </span>
                </div>
                {/* 桌面端把操作按钮放头图内 */}
                <div className="mt-auto hidden sm:flex flex-wrap gap-2 pt-3">
                  {continueChapter && (
                    <button
                      type="button"
                      onClick={() => openChapter(continueChapter)}
                      className="px-5 py-2.5 rounded-lg text-sm font-display font-bold tap glow-ember"
                      style={{ background: "var(--ember)", color: "var(--ink)" }}
                    >
                      {record ? `继续阅读 · ${record.chapterName}` : "开始阅读"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleShelf}
                    className="px-4 py-2.5 rounded-lg text-sm font-display font-semibold tap flex items-center gap-1.5"
                    style={{
                      background: "var(--ink-2)",
                      border: `1px solid ${onShelf ? "var(--ember)" : "var(--cream-line)"}`,
                      color: onShelf ? "var(--ember)" : "var(--cream-dim)",
                    }}
                  >
                    {onShelf ? <IconBookmarkFill size={16} /> : <IconBookmark size={16} />}
                    {onShelf ? "已在书架" : "加入书架"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 space-y-5">
            {/* 移动端操作按钮(全宽) */}
            <div className="flex sm:hidden gap-2">
              {continueChapter && (
                <button
                  type="button"
                  onClick={() => openChapter(continueChapter)}
                  className="flex-1 px-4 py-3 rounded-lg text-sm font-display font-bold tap glow-ember"
                  style={{ background: "var(--ember)", color: "var(--ink)" }}
                >
                  {record ? "继续阅读" : "开始阅读"}
                </button>
              )}
              <button
                type="button"
                onClick={handleShelf}
                className="px-4 py-3 rounded-lg text-sm font-display font-semibold tap flex items-center gap-1.5 shrink-0"
                style={{
                  background: "var(--ink-2)",
                  border: `1px solid ${onShelf ? "var(--ember)" : "var(--cream-line)"}`,
                  color: onShelf ? "var(--ember)" : "var(--cream-dim)",
                }}
              >
                {onShelf ? <IconBookmarkFill size={18} /> : <IconBookmark size={18} />}
              </button>
            </div>

            {/* 继续阅读进度条 */}
            {record && readProgress > 0 && (
              <div
                className="rounded-lg p-3 flex items-center gap-3"
                style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-cream-dim line-clamp-1">{record.chapterName}</p>
                  <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: "var(--ink)" }}>
                    <div className="h-full rounded-full" style={{ width: `${readProgress}%`, background: "var(--ember)" }} />
                  </div>
                </div>
                <span className="font-mono text-xs text-cream-faint shrink-0">{readProgress}%</span>
              </div>
            )}

            {/* 题材 chips */}
            {genres.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {genres.map((g) => (
                  <span key={g} className="chip-ch">{g}</span>
                ))}
              </div>
            )}

            {/* 简介(可展开) */}
            {detail.description && (
              <div>
                <p
                  className={`text-sm text-cream-dim leading-relaxed ${descOpen ? "" : "line-clamp-3"}`}
                >
                  {detail.description}
                </p>
                <button
                  type="button"
                  onClick={() => setDescOpen((v) => !v)}
                  className="mt-1 text-xs text-ember tap"
                >
                  {descOpen ? "收起" : "展开"}
                </button>
              </div>
            )}

            {/* 章节 */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display font-bold text-base text-cream">
                  章节 <span className="text-cream-faint font-mono text-sm">({detail.chapters.length})</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setDescOrder((v) => !v)}
                  className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs tap text-cream-dim"
                  style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
                >
                  {descOrder ? <IconChevronDown size={13} /> : <IconChevronUp size={13} />}
                  {descOrder ? "倒序" : "正序"}
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {chapters.map((chapter) => {
                  const isCurrent = record?.chapterId === chapter.id;
                  return (
                    <button
                      key={chapter.id}
                      type="button"
                      onClick={() => openChapter(chapter)}
                      className="text-left px-3 py-2.5 rounded-lg tap min-w-0"
                      style={{
                        background: isCurrent ? "var(--ember-soft)" : "var(--ink-2)",
                        border: `1px solid ${isCurrent ? "var(--ember)" : "var(--cream-line)"}`,
                      }}
                    >
                      <span
                        className="block text-sm line-clamp-1"
                        style={{ color: isCurrent ? "var(--ember)" : "var(--cream-dim)" }}
                      >
                        {chapter.name}
                      </span>
                      {chapter.scanlator && (
                        <span className="block mt-0.5 text-[10px] text-cream-faint line-clamp-1">
                          {chapter.scanlator}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      )}
    </PageShell>
  );
}

// ─── 阅读器（4 模式 + 缩放 + 预取 + 章节抽屉 + 完成弹窗）──────
const PRELOAD_PAGE_COUNT = 5;
const SAVE_INTERVAL_MS = 10000;

function sortChapters(list: MangaChapter[]): MangaChapter[] {
  return [...list].sort(
    (a, b) =>
      (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0) ||
      (a.uploadDate ?? 0) - (b.uploadDate ?? 0)
  );
}

function MangaReader() {
  const navigate = useNavigate();
  const { sourceId = "", mangaId = "", chapterId = "" } = useParams();
  const [params] = useSearchParams();
  const config = useMangaStore((s) => s.config);
  const upsertHistory = useMangaStore((s) => s.upsertHistory);
  const readerSettings = useMangaStore((s) => s.readerSettings);
  const setReaderSettings = useMangaStore((s) => s.setReaderSettings);
  const { readMode, scaleMode, pageGap } = readerSettings;

  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activePage, setActivePage] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chapterListOpen, setChapterListOpen] = useState(false);
  const [chapterListDesc, setChapterListDesc] = useState(false);
  const [chapters, setChapters] = useState<MangaChapter[]>([]);
  const [showComplete, setShowComplete] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const horizontalRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const preloadedRef = useRef<Set<string>>(new Set());
  const activeChapterRef = useRef<HTMLAnchorElement>(null);
  const restoredRef = useRef("");
  const prevModeRef = useRef(readMode);

  const title = params.get("title") || "漫画阅读";
  const cover = params.get("cover") || "";
  const sourceName = params.get("sourceName") || sourceId;
  const chapterName = params.get("chapterName") || "章节";

  // getMangaChapterPages 返回的 URL 已在 suwayomi.ts buildImageUrl 里过了 dyproxy 代理,
  // 这里不能再包一层(buildProxyUrl 非幂等,二次编码会把整个 dyproxy URL 当上游 → 404)。
  // 章节页 + 章节列表(供抽屉/换章/完成弹窗)
  useEffect(() => {
    setLoading(true);
    setError("");
    setPages([]);
    setActivePage(0);
    preloadedRef.current.clear();
    restoredRef.current = "";
    getMangaChapterPages(config, chapterId)
      .then((list) => {
        setPages(list);
        if (list.length === 0) setError("该章节没有可显示的页面");
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [config, chapterId]);

  useEffect(() => {
    getMangaChapters(config, mangaId)
      .then(setChapters)
      .catch(() => setChapters([]));
  }, [config, mangaId]);

  const orderedChapters = useMemo(() => {
    const asc = sortChapters(chapters);
    return chapterListDesc ? [...asc].reverse() : asc;
  }, [chapters, chapterListDesc]);

  const nextChapter = useMemo(() => {
    const asc = sortChapters(chapters);
    const idx = asc.findIndex((c) => c.id === chapterId);
    return idx >= 0 && idx + 1 < asc.length ? asc[idx + 1] : undefined;
  }, [chapters, chapterId]);

  const gotoChapter = useCallback(
    (ch: MangaChapter | undefined) => {
      if (!ch) return;
      const sp = new URLSearchParams();
      sp.set("title", title);
      if (cover) sp.set("cover", cover);
      sp.set("sourceName", sourceName);
      sp.set("chapterName", ch.name);
      setShowComplete(false);
      navigate(
        `/manga/reader/${sourceId}/${mangaId}/${encodeURIComponent(ch.id)}?${sp.toString()}`
      );
    },
    [navigate, sourceId, mangaId, title, cover, sourceName]
  );

  // 保存阅读进度：debounce + 定时 + pagehide/visibilitychange
  const recordRef = useRef<MangaReadRecord | null>(null);
  useEffect(() => {
    if (pages.length === 0) return;
    recordRef.current = {
      sourceId,
      sourceName,
      mangaId,
      chapterId,
      chapterName,
      title,
      cover,
      pageIndex: activePage,
      pageCount: pages.length,
      saveTime: Date.now(),
    };
    const t = window.setTimeout(() => {
      if (recordRef.current) upsertHistory(recordRef.current);
    }, 500);
    return () => window.clearTimeout(t);
  }, [
    activePage,
    pages.length,
    sourceId,
    sourceName,
    mangaId,
    chapterId,
    chapterName,
    title,
    cover,
    upsertHistory,
  ]);

  useEffect(() => {
    const flush = () => {
      if (recordRef.current) upsertHistory(recordRef.current);
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const id = window.setInterval(flush, SAVE_INTERVAL_MS);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [upsertHistory]);

  // 恢复上次页码(同章节)
  useEffect(() => {
    if (pages.length === 0) return;
    const key = `${sourceId}:${mangaId}:${chapterId}`;
    if (restoredRef.current === key) return;
    restoredRef.current = key;
    const record = useMangaStore.getState().getHistory(sourceId, mangaId);
    if (!record || record.chapterId !== chapterId) return;
    const target = Math.min(Math.max(record.pageIndex, 0), pages.length - 1);
    if (target <= 0) return;
    setActivePage(target);
    window.setTimeout(() => {
      if (readMode === "vertical") {
        pageRefs.current[target]?.scrollIntoView({ block: "start" });
      } else if (readMode === "horizontal") {
        const c = horizontalRef.current;
        if (c) c.scrollTo({ left: c.clientWidth * target, behavior: "auto" });
      }
    }, 0);
  }, [pages.length, sourceId, mangaId, chapterId, readMode]);

  // 主动预取 current+1..+5
  useEffect(() => {
    if (pages.length === 0) return;
    const targets = pages.slice(activePage + 1, activePage + 1 + PRELOAD_PAGE_COUNT);
    for (const src of targets) {
      if (!src || preloadedRef.current.has(src)) continue;
      const img = new window.Image();
      img.decoding = "async";
      img.src = src;
      preloadedRef.current.add(src);
    }
  }, [activePage, pages]);

  // 模式切换后重新锚定到当前页
  useEffect(() => {
    if (prevModeRef.current === readMode) return;
    prevModeRef.current = readMode;
    window.setTimeout(() => {
      if (readMode === "vertical") {
        pageRefs.current[activePage]?.scrollIntoView({ block: "start" });
      } else if (readMode === "horizontal") {
        const c = horizontalRef.current;
        if (c) c.scrollTo({ left: c.clientWidth * activePage, behavior: "auto" });
      }
    }, 0);
  }, [readMode, activePage]);

  const onVerticalScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    let current = 0;
    for (let i = 0; i < pageRefs.current.length; i++) {
      const rect = pageRefs.current[i]?.getBoundingClientRect();
      if (rect && rect.top <= 120) current = i;
    }
    setActivePage(current);
  }, []);

  const onHorizontalScroll = useCallback(() => {
    const c = horizontalRef.current;
    if (!c || c.clientWidth === 0) return;
    setActivePage(Math.round(c.scrollLeft / c.clientWidth));
  }, []);

  const isPaged = readMode === "single" || readMode === "double";

  const atEnd = useCallback(() => {
    if (readMode === "double") return activePage >= pages.length - 2;
    return activePage >= pages.length - 1;
  }, [readMode, activePage, pages.length]);

  const goNext = useCallback(() => {
    if (atEnd()) {
      if (nextChapter) setShowComplete(true);
      return;
    }
    const step = readMode === "double" ? 2 : 1;
    if (isPaged) {
      setActivePage((p) => Math.min(p + step, pages.length - 1));
    } else if (readMode === "horizontal") {
      const c = horizontalRef.current;
      if (c) c.scrollTo({ left: c.clientWidth * (activePage + 1), behavior: "smooth" });
    } else {
      window.scrollBy({ top: window.innerHeight * 0.85, behavior: "smooth" });
    }
  }, [atEnd, nextChapter, readMode, isPaged, pages.length, activePage]);

  const goPrev = useCallback(() => {
    const step = readMode === "double" ? 2 : 1;
    if (isPaged) {
      setActivePage((p) => Math.max(p - step, 0));
    } else if (readMode === "horizontal") {
      const c = horizontalRef.current;
      if (c) c.scrollTo({ left: c.clientWidth * (activePage - 1), behavior: "smooth" });
    } else {
      window.scrollBy({ top: -window.innerHeight * 0.85, behavior: "smooth" });
    }
  }, [readMode, isPaged, activePage]);

  // tap 区域:左 1/3 上一页,右 1/3 下一页,中间切控件(垂直模式只切控件)
  const onReaderClick = useCallback(
    (e: React.MouseEvent) => {
      if (readMode === "vertical") {
        setControlsVisible((v) => !v);
        return;
      }
      const w = e.currentTarget.clientWidth;
      const x = e.clientX;
      if (x < w / 3) goPrev();
      else if (x > (w * 2) / 3) goNext();
      else setControlsVisible((v) => !v);
    },
    [readMode, goPrev, goNext]
  );

  const imageClass =
    scaleMode === "original"
      ? "block mx-auto h-auto w-auto max-w-none"
      : isPaged
        ? "block h-auto w-full object-contain sm:mx-auto sm:max-h-[calc(100dvh-6rem)] sm:w-auto sm:max-w-full"
        : "block h-auto w-full object-contain";

  const pagedItems =
    readMode === "single"
      ? pages.slice(activePage, activePage + 1)
      : readMode === "double"
        ? pages.slice(activePage, activePage + 2)
        : [];

  const loadStrategy = (i: number): "eager" | "lazy" =>
    i >= activePage - 1 && i <= activePage + PRELOAD_PAGE_COUNT ? "eager" : "lazy";

  const progress =
    pages.length > 0 ? Math.round(((activePage + 1) / pages.length) * 100) : 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-ink text-cream relative">
      {controlsVisible && (
        <div
          className="shrink-0 flex items-center gap-3 px-4 pt-4 pb-3 z-10"
          style={{ borderBottom: "1px solid var(--cream-line)" }}
        >
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="w-9 h-9 flex items-center justify-center rounded-full shrink-0 tap text-cream"
            style={{
              background: "var(--ink-2)",
              border: "1px solid var(--cream-line)",
            }}
            aria-label="返回"
          >
            <IconArrowLeft size={16} />
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint line-clamp-1">
              {title}
            </p>
            <h1 className="font-display text-base font-bold line-clamp-1">
              {chapterName}
            </h1>
          </div>
          <button
            type="button"
            onClick={() => setChapterListOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-full shrink-0 tap text-cream"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            aria-label="章节列表"
          >
            <IconList size={16} />
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-full shrink-0 tap text-cream"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            aria-label="阅读设置"
          >
            <IconSettings size={16} />
          </button>
          {pages.length > 0 && (
            <span className="font-mono text-xs text-cream-dim shrink-0">
              {activePage + 1}/{pages.length}
            </span>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-cream-faint text-sm">
          加载中…
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-ember">{error}</p>
        </div>
      ) : readMode === "vertical" ? (
        <div
          ref={scrollRef}
          onScroll={onVerticalScroll}
          onClick={onReaderClick}
          className="flex-1 min-h-0 overflow-y-auto"
        >
          <div className="flex flex-col items-center" style={{ gap: `${pageGap}px` }}>
            {pages.map((src, i) => (
              <div
                key={i}
                ref={(el) => (pageRefs.current[i] = el)}
                className="w-full max-w-3xl"
              >
                <img
                  src={src}
                  alt={`第 ${i + 1} 页`}
                  loading={loadStrategy(i)}
                  onLoad={onVerticalScroll}
                  className={imageClass}
                />
              </div>
            ))}
          </div>
        </div>
      ) : readMode === "horizontal" ? (
        <div
          ref={horizontalRef}
          onScroll={onHorizontalScroll}
          onClick={onReaderClick}
          className="flex-1 min-h-0 flex overflow-x-auto snap-x snap-mandatory scrollbar-hide"
          style={{ gap: `${pageGap}px` }}
        >
          {pages.map((src, i) => (
            <div key={i} className="min-w-full snap-center flex items-center justify-center">
              <img
                src={src}
                alt={`第 ${i + 1} 页`}
                loading={loadStrategy(i)}
                className={imageClass}
              />
            </div>
          ))}
        </div>
      ) : (
        <div
          onClick={onReaderClick}
          className="flex-1 min-h-0 overflow-y-auto"
        >
          <div
            className={`min-h-full grid ${readMode === "double" ? "md:grid-cols-2" : "grid-cols-1"} items-center justify-center`}
            style={{ gap: `${pageGap}px` }}
          >
            {pagedItems.map((src, i) => (
              <img
                key={activePage + i}
                src={src}
                alt={`第 ${activePage + i + 1} 页`}
                className={imageClass}
              />
            ))}
            {readMode === "double" && pagedItems.length === 1 && <div />}
          </div>
        </div>
      )}

      {/* 右侧进度条 */}
      {!loading && !error && pages.length > 0 && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 h-32 w-1 rounded-full bg-ink-2 overflow-hidden pointer-events-none">
          <div
            className="w-full rounded-full"
            style={{ height: `${progress}%`, background: "var(--ember)" }}
          />
        </div>
      )}

      {/* 章节完成弹窗 */}
      {showComplete && nextChapter && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 animate-fade-in">
          <div
            className="mx-6 max-w-sm rounded-2xl p-6 text-center bg-ink-2"
            style={{ border: "1px solid var(--cream-line)" }}
          >
            <p className="font-display text-base font-bold mb-1">本话看完了</p>
            <p className="text-sm text-cream-dim mb-4 line-clamp-1">
              下一话：{nextChapter.name}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowComplete(false)}
                className="flex-1 rounded-lg py-2.5 text-sm tap text-cream-dim"
                style={{ background: "var(--ink)", border: "1px solid var(--cream-line)" }}
              >
                继续看本话
              </button>
              <button
                type="button"
                onClick={() => gotoChapter(nextChapter)}
                className="flex-1 rounded-lg py-2.5 text-sm tap glow-ember"
                style={{ background: "var(--ember)", color: "var(--ink)" }}
              >
                下一话
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 章节列表抽屉 */}
      <Sheet
        open={chapterListOpen}
        onClose={() => setChapterListOpen(false)}
        side="right"
        title="章节目录"
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
            const active = ch.id === chapterId;
            return (
              <a
                key={ch.id}
                ref={active ? activeChapterRef : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  gotoChapter(ch);
                  setChapterListOpen(false);
                }}
                href="#"
                className="block px-4 py-2.5 text-sm tap line-clamp-1"
                style={{
                  color: active ? "var(--ember)" : "var(--cream-dim)",
                  background: active ? "var(--ember-soft)" : "transparent",
                }}
              >
                {ch.name}
              </a>
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
        <div className="p-4 space-y-5">
          <div>
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
              阅读模式
            </p>
            <div className="grid grid-cols-4 gap-2">
              {(
                [
                  ["vertical", "垂直"],
                  ["horizontal", "水平"],
                  ["single", "单页"],
                  ["double", "双页"],
                ] as [MangaReadMode, string][]
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setReaderSettings({ readMode: mode })}
                  className="rounded-lg py-2 text-xs tap"
                  style={{
                    background: readMode === mode ? "var(--ember)" : "var(--ink)",
                    color: readMode === mode ? "var(--ink)" : "var(--cream-dim)",
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
              缩放
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["fit", "适配屏幕"],
                  ["original", "原始大小"],
                ] as [MangaScaleMode, string][]
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setReaderSettings({ scaleMode: mode })}
                  className="rounded-lg py-2 text-xs tap"
                  style={{
                    background: scaleMode === mode ? "var(--ember)" : "var(--ink)",
                    color: scaleMode === mode ? "var(--ink)" : "var(--cream-dim)",
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
              页间距 {pageGap}px
            </p>
            <input
              type="range"
              min={0}
              max={48}
              step={2}
              value={pageGap}
              onChange={(e) => setReaderSettings({ pageGap: Number(e.target.value) })}
              className="w-full accent-ember"
            />
          </div>
        </div>
      </Sheet>
    </div>
  );
}
