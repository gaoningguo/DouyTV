/**
 * 豆瓣热门推荐 - 点播首页和搜索页的发现入口。
 *
 * 首页模式展示大图轮播 + 横向海报；搜索页模式展示紧凑推荐区。
 */
import { useEffect, useMemo, useState } from "react";
import {
  fetchMoonHomeRecommendations,
  MOVIE_TAGS,
  TV_TAGS,
  type DoubanItem,
  type DoubanKind,
} from "@/lib/douban";
import {
  IconAntenna,
  IconChevronLeft,
  IconChevronRight,
  IconFilm,
  IconPlay,
  IconSearch,
} from "@/components/Icon";
import { wrapImage } from "@/lib/proxy";

interface Props {
  onPickTitle: (title: string) => void;
  variant?: "compact" | "home";
  resolvingTitle?: string;
  onOpenSearch?: () => void;
  onOpenSourceBrowse?: () => void;
}

const KIND_KEY = "douytv:douban-kind";
const TAG_KEY = "douytv:douban-tag";

interface HomeRecommendationCache {
  heroIndex: number;
  items: DoubanItem[];
}

const homeRecommendationCache = new Map<string, HomeRecommendationCache>();

function homeRecommendationKey(kind: DoubanKind, tag: string): string {
  return `${kind}:${tag}`;
}

function readKind(): DoubanKind {
  try {
    const v = localStorage.getItem(KIND_KEY);
    return v === "tv" ? "tv" : "movie";
  } catch {
    return "movie";
  }
}

function readTag(): string {
  try {
    return localStorage.getItem(TAG_KEY) || "热门";
  } catch {
    return "热门";
  }
}

export default function HotRecommendations({
  onPickTitle,
  variant = "compact",
  resolvingTitle,
  onOpenSearch,
  onOpenSourceBrowse,
}: Props) {
  const [kind, setKind] = useState<DoubanKind>(readKind);
  const [tag, setTag] = useState<string>(readTag);
  const [items, setItems] = useState<DoubanItem[]>(() => {
    const cached = homeRecommendationCache.get(
      homeRecommendationKey(readKind(), readTag())
    );
    return cached?.items ?? [];
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [heroIndex, setHeroIndex] = useState(() => {
    const cached = homeRecommendationCache.get(
      homeRecommendationKey(readKind(), readTag())
    );
    return cached?.heroIndex ?? 0;
  });

  const availableTags = kind === "movie" ? MOVIE_TAGS : TV_TAGS;
  const cacheKey = homeRecommendationKey(kind, tag);
  const heroItems = useMemo(() => items.slice(0, 5), [items]);
  const hero = heroItems[heroIndex];
  const railItems = variant === "home" ? items.slice(5) : items;
  const canHeroLeft = heroIndex > 0;
  const canHeroRight = heroItems.length > 1 && heroIndex < heroItems.length - 1;

  useEffect(() => {
    let cancelled = false;
    const cached = homeRecommendationCache.get(cacheKey);
    if (cached) {
      setItems(cached.items);
      setHeroIndex(
        Math.min(cached.heroIndex, Math.max(0, cached.items.slice(0, 5).length - 1))
      );
    } else {
      setItems([]);
      setHeroIndex(0);
    }
    setLoading(!cached?.items.length);
    setError(undefined);
    fetchMoonHomeRecommendations(kind, tag, 24)
      .then((list) => {
        if (!cancelled) {
          homeRecommendationCache.set(cacheKey, {
            heroIndex: cached?.heroIndex ?? 0,
            items: list,
          });
          setItems(list);
          setHeroIndex((i) => Math.min(i, Math.max(0, list.slice(0, 5).length - 1)));
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError((e as Error).message ?? String(e));
          if (!cached?.items.length) setItems([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, kind, tag]);

  useEffect(() => {
    const cached = homeRecommendationCache.get(cacheKey);
    if (!cached) return;
    homeRecommendationCache.set(cacheKey, { ...cached, heroIndex });
  }, [cacheKey, heroIndex]);

  useEffect(() => {
    if (variant !== "home" || heroItems.length <= 1) return;
    const timer = window.setInterval(() => {
      setHeroIndex((i) => (i >= heroItems.length - 1 ? 0 : i + 1));
    }, 5200);
    return () => window.clearInterval(timer);
  }, [heroItems.length, variant]);

  const switchKind = (k: DoubanKind) => {
    setKind(k);
    try {
      localStorage.setItem(KIND_KEY, k);
    } catch {}
    const next = k === "movie" ? MOVIE_TAGS : TV_TAGS;
    if (!next.includes(tag)) {
      setTag("热门");
      try {
        localStorage.setItem(TAG_KEY, "热门");
      } catch {}
    }
  };

  const switchTag = (t: string) => {
    setTag(t);
    try {
      localStorage.setItem(TAG_KEY, t);
    } catch {}
  };

  const stepHero = (dir: -1 | 1) => {
    if (heroItems.length <= 1) return;
    setHeroIndex((i) => Math.min(heroItems.length - 1, Math.max(0, i + dir)));
  };

  return (
    <section className={variant === "home" ? "space-y-5 -mx-4 -mt-4" : "mb-6 space-y-3"}>
      <div className={`flex items-center justify-between gap-3 ${variant === "home" ? "px-4 pt-4" : ""}`}>
        <div className="min-w-0">
          <p className="font-mono text-[10px] tracking-[0.22em] text-cream-faint">
            DISCOVER · MOONTV
          </p>
          <h2 className="font-display text-lg font-extrabold text-cream">
            {variant === "home" ? "本周推荐" : "豆瓣推荐"}
          </h2>
        </div>
        <div className="shrink-0 flex items-center gap-1.5">
          <div
            className="flex rounded-full overflow-hidden"
            style={{ border: "1px solid var(--cream-line)" }}
          >
            {(["movie", "tv"] as DoubanKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => switchKind(k)}
                className="px-3 py-1 text-[11px] font-display tap"
                style={{
                  background: kind === k ? "var(--ember-soft)" : "var(--ink-2)",
                  color: kind === k ? "var(--ember)" : "var(--cream-dim)",
                  borderLeft: k === "tv" ? "1px solid var(--cream-line)" : undefined,
                }}
              >
                {k === "movie" ? "电影" : "电视剧"}
              </button>
            ))}
          </div>
          {variant === "home" && onOpenSearch && (
            <button
              type="button"
              onClick={onOpenSearch}
              className="w-8 h-8 rounded-full grid place-items-center tap text-cream-dim hover:text-ember transition-colors"
              style={{
                background: "rgba(22,24,29,0.72)",
                border: "1px solid rgba(242,232,213,0.14)",
                boxShadow: "0 8px 20px rgba(0,0,0,0.24)",
              }}
              title="搜索"
              aria-label="搜索"
            >
              <IconSearch size={15} />
            </button>
          )}
          {variant === "home" && onOpenSourceBrowse && (
            <button
              type="button"
              onClick={onOpenSourceBrowse}
              className="w-8 h-8 rounded-full grid place-items-center tap text-cream-dim hover:text-ember transition-colors"
              style={{
                background: "rgba(22,24,29,0.72)",
                border: "1px solid rgba(242,232,213,0.14)",
                boxShadow: "0 8px 20px rgba(0,0,0,0.24)",
              }}
              title="按源浏览"
              aria-label="按源浏览"
            >
              <IconAntenna size={15} />
            </button>
          )}
        </div>
      </div>

      <div className={`flex gap-1.5 overflow-x-auto vod-scroll-row pb-2 ${variant === "home" ? "px-4" : ""}`}>
        {availableTags.map((t) => {
          const active = t === tag;
          return (
            <button
              key={t}
              type="button"
              onClick={() => switchTag(t)}
              className="shrink-0 px-2.5 py-1 rounded-full text-[11px] font-display tap whitespace-nowrap"
              style={{
                background: active ? "var(--ember-soft)" : "var(--ink-2)",
                border: `1px solid ${active ? "var(--ember)" : "var(--cream-line)"}`,
                color: active ? "var(--ember)" : "var(--cream-dim)",
              }}
            >
              {t}
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-[10px] font-mono text-cream-faint">
          <span className="signal-bars" style={{ height: 10 }}>
            <span></span>
            <span></span>
            <span></span>
          </span>
          <span>
            加载 {tag} {kind === "movie" ? "电影" : "电视剧"}…
          </span>
        </div>
      )}
      {error && <p className="text-[11px] font-mono text-ember">豆瓣加载失败：{error}</p>}

      {!loading && hero && variant === "home" && (
        <div
          className={`relative w-full h-[320px] sm:h-[370px] overflow-hidden scanlines group ${
            variant === "home" ? "rounded-none" : "rounded-lg"
          }`}
          style={{
            background: "var(--ink-2)",
            border:
              variant === "home"
                ? "1px solid rgba(242,232,213,0.06)"
                : "1px solid var(--cream-line)",
          }}
        >
          {hero.cover ? (
            <img
              key={hero.id}
              src={wrapImage(hero.cover)}
              referrerPolicy="no-referrer"
              className="absolute inset-0 w-full h-full object-cover"
              alt={hero.title}
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-cream-faint">
              <IconFilm size={64} />
            </div>
          )}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(90deg, rgba(14,15,17,0.92) 0%, rgba(14,15,17,0.58) 45%, rgba(14,15,17,0.2) 100%), linear-gradient(0deg, rgba(14,15,17,0.86), transparent 48%)",
            }}
          />
          <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span
                className="px-2 py-0.5 rounded-full font-mono text-[10px] font-bold"
                style={{ background: "var(--ember)", color: "var(--ink)" }}
              >
                {tag}
              </span>
              <span
                className="px-2 py-0.5 rounded-full font-mono text-[10px]"
                style={{
                  background: "rgba(14,15,17,0.62)",
                  border: "1px solid var(--cream-line)",
                  color: "var(--cream-dim)",
                }}
              >
                {kind === "movie" ? "电影" : "电视剧"}
              </span>
              {hero.rate && Number(hero.rate) > 0 && (
                <span className="font-mono text-[10px] text-ember">★ {hero.rate}</span>
              )}
            </div>
            <h3 className="font-display text-3xl sm:text-4xl font-extrabold text-cream text-shadow line-clamp-2">
              {hero.title}
            </h3>
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={() => onPickTitle(hero.title)}
                className="inline-flex items-center gap-2 px-4 h-10 rounded-full font-display text-sm font-bold"
                style={{ background: "var(--ember)", color: "var(--ink)" }}
              >
                {resolvingTitle === hero.title ? (
                  <>
                    <span className="signal-bars" style={{ height: 12 }}>
                      <span></span>
                      <span></span>
                      <span></span>
                    </span>
                    匹配片源
                  </>
                ) : (
                  <>
                    <IconPlay size={16} />
                    立即播放
                  </>
                )}
              </button>
              <span className="font-mono text-[10px] text-cream-faint">
                推荐命中后直接进入首集
              </span>
            </div>
          </div>
          {heroItems.length > 1 && (
            <>
              <div className="absolute right-4 bottom-4 flex gap-1.5">
                {heroItems.map((it, i) => (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => setHeroIndex(i)}
                    className="h-1.5 rounded-full tap"
                    aria-label={`切换到 ${it.title}`}
                    style={{
                      width: i === heroIndex ? 18 : 6,
                      background:
                        i === heroIndex ? "var(--ember)" : "rgba(244,230,210,0.38)",
                    }}
                  />
                ))}
              </div>
              {canHeroLeft && (
                <button
                  type="button"
                  onClick={() => stepHero(-1)}
                  className="hidden md:grid absolute left-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 place-items-center rounded-full tap backdrop-blur-md text-cream opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{
                    background: "rgba(14,15,17,0.72)",
                    border: "1px solid rgba(242,232,213,0.22)",
                    boxShadow: "0 10px 24px rgba(0,0,0,0.34)",
                  }}
                  aria-label="上一条推荐"
                >
                  <IconChevronLeft size={18} />
                </button>
              )}
              {canHeroRight && (
                <button
                  type="button"
                  onClick={() => stepHero(1)}
                  className="hidden md:grid absolute right-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 place-items-center rounded-full tap backdrop-blur-md text-cream opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{
                    background: "rgba(14,15,17,0.72)",
                    border: "1px solid rgba(242,232,213,0.22)",
                    boxShadow: "0 10px 24px rgba(0,0,0,0.34)",
                  }}
                  aria-label="下一条推荐"
                >
                  <IconChevronRight size={18} />
                </button>
              )}
              <div className="absolute inset-x-0 bottom-0 h-0.5 bg-black/30">
                <div
                  key={hero.id}
                  className="vod-hero-progress h-full origin-left"
                  style={{ background: "var(--ember)" }}
                />
              </div>
            </>
          )}
        </div>
      )}

      {variant !== "home" && !loading && items.length > 0 && (
        <div>
          <div className="flex gap-3 overflow-x-auto vod-scroll-row pb-3">
            {railItems.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => onPickTitle(it.title)}
                className="w-32 sm:w-36 shrink-0 rounded-lg overflow-hidden flex flex-col tap text-left"
                style={{
                  background: "var(--ink-2)",
                  border: "1px solid var(--cream-line)",
                }}
                title={`播放「${it.title}」`}
              >
                <div className="aspect-[3/4] relative scanlines" style={{ background: "var(--ink-3)" }}>
                  {it.cover ? (
                    <img
                      src={wrapImage(it.cover)}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                      alt={it.title}
                      loading="lazy"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-cream-faint">
                      <IconFilm size={28} />
                    </div>
                  )}
                  {it.rate && Number(it.rate) > 0 && (
                    <span
                      className="absolute top-1 right-1 font-mono text-[9px] px-1.5 py-0.5 rounded tracking-wider"
                      style={{
                        background: "rgba(14,15,17,0.85)",
                        color: "var(--ember)",
                        border: "1px solid rgba(255,107,53,0.3)",
                      }}
                    >
                      ★ {it.rate}
                    </span>
                  )}
                  {resolvingTitle === it.title && (
                    <div className="absolute inset-0 grid place-items-center bg-black/45">
                      <span className="signal-bars" style={{ height: 18 }}>
                        <span></span>
                        <span></span>
                        <span></span>
                      </span>
                    </div>
                  )}
                </div>
                <div className="p-2">
                  <p className="text-xs line-clamp-1 text-cream font-display">{it.title}</p>
                  <p className="font-mono text-[10px] text-cream-faint mt-0.5">
                    {kind === "movie" ? "电影" : "剧集"} · 播放
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
