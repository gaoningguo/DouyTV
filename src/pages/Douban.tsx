import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useScriptStore } from "@/stores/scripts";
import { callDetail, callSearch } from "@/source-script/runtime";
import {
  fetchDoubanRecentHot,
  fetchDoubanRecommends,
  fetchTodayBangumi,
  type DoubanItem,
} from "@/lib/douban";
import { wrapImage } from "@/lib/proxy";
import { appAlert } from "@/components/AppDialog";
import {
  IconChevronLeft,
  IconFilm,
  IconPlay,
  IconRefresh,
} from "@/components/Icon";
import type { ScriptDescriptor } from "@/source-script/types";

type DoubanPageType = "movie" | "tv" | "show" | "anime";

interface DirectVodTarget {
  href: string;
}

const PAGE_SIZE = 25;

const MOVIE_PRIMARY = ["全部", "热门", "最新", "豆瓣高分", "冷门佳片"];
const MOVIE_SECONDARY = ["全部", "华语", "欧美", "韩国", "日本"];
const TV_PRIMARY = ["全部", "最近热门"];
const TV_SECONDARY = [
  { label: "全部", value: "tv" },
  { label: "国产", value: "tv_domestic" },
  { label: "欧美", value: "tv_american" },
  { label: "日本", value: "tv_japanese" },
  { label: "韩国", value: "tv_korean" },
  { label: "动漫", value: "tv_animation" },
  { label: "纪录片", value: "tv_documentary" },
];
const SHOW_SECONDARY = [
  { label: "全部", value: "show" },
  { label: "国内", value: "show_domestic" },
  { label: "国外", value: "show_foreign" },
];
const ANIME_PRIMARY = ["每日放送", "番剧", "剧场版"];

function normalizeTitle(t: string): string {
  return (t || "")
    .trim()
    .replace(/[\s　]/g, "")
    .replace(/[()（）[\]【】{}「」『』<>《》·\-_,.!?，。；：:'""]/g, "")
    .replace(/[^\w一-龥]/g, "");
}

async function inspectScriptForTitle(
  desc: ScriptDescriptor,
  title: string
): Promise<DirectVodTarget | null> {
  try {
    const result = await callSearch(desc, { keyword: title, page: 1 });
    const normalized = normalizeTitle(title);
    const candidates = result.list
      .filter((vod) => vod.id)
      .sort((a, b) => {
        const ae = normalizeTitle(a.title) === normalized ? 0 : 1;
        const be = normalizeTitle(b.title) === normalized ? 0 : 1;
        return ae - be;
      })
      .slice(0, 4);

    for (const vod of candidates) {
      try {
        const detail = await callDetail(desc, { id: vod.id });
        const playbackIdx = detail.playbacks.findIndex((pb) => pb.episodes.length > 0);
        if (playbackIdx >= 0) {
          return {
            href: `/play/${encodeURIComponent(desc.key)}/${encodeURIComponent(vod.id)}/${playbackIdx}/0`,
          };
        }
      } catch {}
    }
  } catch {}
  return null;
}

function resolveTitle(title: string, scripts: ScriptDescriptor[]): Promise<DirectVodTarget | null> {
  const enabled = scripts.filter((script) => script.enabled);
  if (enabled.length === 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    let pending = enabled.length;
    let settled = false;
    const finish = (target: DirectVodTarget | null) => {
      if (settled) return;
      if (target) {
        settled = true;
        resolve(target);
        return;
      }
      pending -= 1;
      if (pending === 0) {
        settled = true;
        resolve(null);
      }
    };
    enabled.forEach((script) => {
      void inspectScriptForTitle(script, title).then(finish);
    });
  });
}

function readType(searchParams: URLSearchParams): DoubanPageType {
  const type = searchParams.get("type");
  const category = searchParams.get("category");
  if (type === "anime") return "anime";
  if (type === "show" || (type === "tv" && category === "show")) return "show";
  if (type === "tv") return "tv";
  return "movie";
}

function defaultPrimary(type: DoubanPageType) {
  if (type === "movie") return "热门";
  if (type === "anime") return "每日放送";
  return "最近热门";
}

function defaultSecondary(type: DoubanPageType) {
  if (type === "movie") return "全部";
  if (type === "show") return "show";
  if (type === "tv") return "tv";
  return "全部";
}

async function loadDoubanPageItems(
  type: DoubanPageType,
  primary: string,
  secondary: string,
  page: number
): Promise<DoubanItem[]> {
  const start = page * PAGE_SIZE;
  if (type === "anime" && primary === "每日放送") {
    return page === 0 ? fetchTodayBangumi() : [];
  }
  if (type === "anime") {
    return fetchDoubanRecommends({
      kind: primary === "番剧" ? "tv" : "movie",
      category: "动画",
      format: primary === "番剧" ? "电视剧" : "",
      limit: PAGE_SIZE,
      start,
    });
  }
  if (type === "movie") {
    if (primary === "全部") {
      return fetchDoubanRecommends({ kind: "movie", limit: PAGE_SIZE, start });
    }
    return fetchDoubanRecentHot({
      kind: "movie",
      category: primary,
      type: secondary || "全部",
      limit: PAGE_SIZE,
      start,
    });
  }
  if (primary === "全部") {
    return fetchDoubanRecommends({
      kind: "tv",
      format: type === "show" ? "综艺" : "电视剧",
      limit: PAGE_SIZE,
      start,
    });
  }
  return fetchDoubanRecentHot({
    kind: "tv",
    category: type === "show" ? "show" : "tv",
    type: secondary || (type === "show" ? "show" : "tv"),
    limit: PAGE_SIZE,
    start,
  });
}

export default function Douban() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const scripts = useScriptStore((s) => s.scripts);
  const hydrateScripts = useScriptStore((s) => s.hydrate);
  const type = readType(searchParams);
  const [primary, setPrimary] = useState(() => defaultPrimary(type));
  const [secondary, setSecondary] = useState(() => defaultSecondary(type));
  const [items, setItems] = useState<DoubanItem[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [resolvingTitle, setResolvingTitle] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    hydrateScripts();
  }, [hydrateScripts]);

  useEffect(() => {
    setPrimary(defaultPrimary(type));
    setSecondary(defaultSecondary(type));
    setItems([]);
    setPage(0);
    setHasMore(true);
  }, [type]);

  const title = useMemo(() => {
    if (type === "movie") return "电影";
    if (type === "tv") return "电视剧";
    if (type === "show") return "综艺";
    return "动漫";
  }, [type]);

  const primaryOptions = useMemo(() => {
    if (type === "movie") return MOVIE_PRIMARY;
    if (type === "anime") return ANIME_PRIMARY;
    return TV_PRIMARY;
  }, [type]);

  const secondaryOptions = useMemo(() => {
    if (type === "movie") return MOVIE_SECONDARY.map((value) => ({ label: value, value }));
    if (type === "show") return SHOW_SECONDARY;
    if (type === "tv") return TV_SECONDARY;
    return [];
  }, [type]);

  const load = async (nextPage: number, replace: boolean) => {
    setLoading(true);
    setError(undefined);
    try {
      const next = await loadDoubanPageItems(type, primary, secondary, nextPage);
      setItems((prev) => (replace ? next : [...prev, ...next]));
      setPage(nextPage);
      setHasMore(type === "anime" && primary === "每日放送" ? false : next.length >= PAGE_SIZE);
    } catch (e) {
      setError((e as Error)?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setItems([]);
    setPage(0);
    setHasMore(true);
    void load(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, primary, secondary]);

  const openTitle = async (item: DoubanItem) => {
    if (resolvingTitle) return;
    setResolvingTitle(item.title);
    try {
      const target = await resolveTitle(item.title, scripts);
      if (target) {
        navigate(target.href);
        return;
      }
      void appAlert(`未找到可播放片源「${item.title}」`, { tone: "warning" });
    } finally {
      setResolvingTitle(undefined);
    }
  };

  const switchPrimary = (value: string) => {
    setPrimary(value);
    if (type === "movie") setSecondary("全部");
    if (type === "tv") setSecondary("tv");
    if (type === "show") setSecondary("show");
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-ink text-cream">
      <div
        className="shrink-0 px-4 pt-4 pb-3 sm:px-6 sm:pt-6"
        style={{ background: "rgba(14,15,17,0.94)", borderBottom: "1px solid var(--cream-line)" }}
      >
        <div className="mx-auto max-w-6xl space-y-3">
        <div
          className="flex items-center gap-3 rounded-lg p-3"
          style={{ background: "rgba(14,15,17,0.72)", border: "1px solid var(--cream-line)" }}
        >
          <Link
            to="/search"
            className="w-9 h-9 rounded-full grid place-items-center tap text-cream-dim hover:text-ember shrink-0"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            aria-label="杩斿洖鐐规挱"
          >
            <IconChevronLeft size={16} />
          </Link>
          <div className="min-w-0">
            <p className="font-mono text-[10px] tracking-[0.22em] text-cream-faint">
              DOUBAN · MOONTV
            </p>
            <h1 className="font-display text-xl font-extrabold text-cream">{title}</h1>
            <p className="hidden">
              {type === "anime" && primary === "每日放送"
                ? "来自 Bangumi 番组计划的每日放送"
                : "来自豆瓣 recent_hot / recommend 的精选内容"}
            </p>
          </div>
          <Link
            to="/search"
            className="hidden"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            aria-label="返回点播"
          >
            <IconChevronLeft size={16} />
          </Link>
        </div>

        <section
          className="rounded-lg p-3 space-y-2"
          style={{ background: "rgba(14,15,17,0.92)", border: "1px solid var(--cream-line)" }}
        >
          <PillRow label="分类" value={primary} options={primaryOptions.map((value) => ({ label: value, value }))} onChange={switchPrimary} />
          {secondaryOptions.length > 0 && primary !== "全部" && (
            <PillRow label={type === "movie" ? "地区" : "频道"} value={secondary} options={secondaryOptions} onChange={setSecondary} />
          )}
        </section>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-6xl space-y-5 pb-24">

        {error && (
          <p className="rounded-lg p-3 text-sm text-ember" style={{ background: "rgba(255,107,53,0.1)", border: "1px solid rgba(255,107,53,0.25)" }}>
            {error}
          </p>
        )}

        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {items.map((item) => (
            <button
              key={`${item.id}:${item.title}`}
              type="button"
              onClick={() => void openTitle(item)}
              className="rounded-lg overflow-hidden text-left tap"
              style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
              title={`播放「${item.title}」`}
            >
              <div className="aspect-[3/4] relative scanlines" style={{ background: "var(--ink-3)" }}>
                {item.cover ? (
                  <img
                    src={wrapImage(item.cover)}
                    referrerPolicy="no-referrer"
                    alt={item.title}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="absolute inset-0 grid place-items-center text-cream-faint">
                    <IconFilm size={28} />
                  </div>
                )}
                {item.rate && Number(item.rate) > 0 && (
                  <span className="absolute top-1 right-1 font-mono text-[9px] px-1.5 py-0.5 rounded" style={{ background: "rgba(14,15,17,0.85)", color: "var(--ember)", border: "1px solid rgba(255,107,53,0.3)" }}>
                    {item.rate}
                  </span>
                )}
                {resolvingTitle === item.title && (
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
                <p className="text-xs font-display font-semibold line-clamp-1 text-cream">{item.title}</p>
                <p className="mt-0.5 font-mono text-[10px] text-cream-faint line-clamp-1">
                  {item.year || title}
                </p>
              </div>
            </button>
          ))}
        </div>

        {loading && items.length === 0 && (
          <div className="flex items-center gap-2 text-[10px] font-mono text-cream-faint py-6">
            <span className="signal-bars" style={{ height: 12 }}>
              <span></span>
              <span></span>
              <span></span>
            </span>
            加载中...
          </div>
        )}

        {!loading && items.length === 0 && !error && (
          <p className="text-sm text-cream-faint">暂无相关内容</p>
        )}

        {items.length > 0 && hasMore && (
          <div className="flex justify-center pt-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => void load(page + 1, false)}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-xs font-display font-semibold tap disabled:opacity-50"
              style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)", color: "var(--cream)" }}
            >
              {loading ? <IconRefresh size={14} className="animate-spin" /> : <IconPlay size={14} />}
              {loading ? "加载中..." : "加载更多"}
            </button>
          </div>
        )}

        {!hasMore && items.length > 0 && (
          <p className="text-center text-xs text-cream-faint py-4">已加载全部内容</p>
        )}
      </div>
    </div>
    </div>
  );
}

function PillRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 font-mono text-[10px] text-cream-faint">{label}</span>
      <div className="min-w-0 flex-1 overflow-x-auto vod-scroll-row">
        <div className="flex gap-1.5">
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onChange(option.value)}
                className="shrink-0 px-2.5 py-1 rounded-full text-[11px] font-display tap whitespace-nowrap"
                style={{
                  background: active ? "var(--ember-soft)" : "var(--ink-2)",
                  border: `1px solid ${active ? "var(--ember)" : "var(--cream-line)"}`,
                  color: active ? "var(--ember)" : "var(--cream-dim)",
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
