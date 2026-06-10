import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useScriptStore } from "@/stores/scripts";
import { callDetail, callSearch } from "@/source-script/runtime";
import { fetchDoubanList, type DoubanItem, type DoubanKind } from "@/lib/douban";
import { wrapImage } from "@/lib/proxy";
import { IconChevronLeft, IconFilm } from "@/components/Icon";

type BrowseKey =
  | "hotMovies"
  | "hotDuanju"
  | "bangumiCalendar"
  | "hotTvShows"
  | "hotVarietyShows";

const BROWSE_CONFIG: Record<
  BrowseKey,
  { title: string; eyebrow: string; kind: DoubanKind; tag: string }
> = {
  hotMovies: { title: "热门电影", eyebrow: "MOVIES", kind: "movie", tag: "热门" },
  hotDuanju: { title: "热播短剧", eyebrow: "SHORTS", kind: "tv", tag: "国产剧" },
  bangumiCalendar: { title: "新番放送", eyebrow: "ANIME", kind: "tv", tag: "日本动画" },
  hotTvShows: { title: "热门剧集", eyebrow: "SERIES", kind: "tv", tag: "热门" },
  hotVarietyShows: { title: "热门综艺", eyebrow: "SHOWS", kind: "tv", tag: "综艺" },
};

interface DirectVodTarget {
  href: string;
}

function normalizeTitle(t: string): string {
  return (t || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[（）()【】\[\]<>《》·—\-_,.!?，。；：:'""]/g, "")
    .replace(/[^\w一-龥]/g, "");
}

async function inspectScriptForRecommendedTitle(
  desc: ReturnType<typeof useScriptStore.getState>["scripts"][number],
  title: string
): Promise<DirectVodTarget | null> {
  try {
    const result = await callSearch(desc, { keyword: title, page: 1 });
    const normalizedTitle = normalizeTitle(title);
    const candidates = result.list
      .filter((vod) => vod.id)
      .sort((a, b) => {
        const ae = normalizeTitle(a.title) === normalizedTitle ? 0 : 1;
        const be = normalizeTitle(b.title) === normalizedTitle ? 0 : 1;
        return ae - be;
      })
      .slice(0, 4);

    for (const vod of candidates) {
      try {
        const detail = await callDetail(desc, { id: vod.id });
        const playbackIdx = detail.playbacks.findIndex((pb) => pb.episodes.length > 0);
        if (playbackIdx >= 0) {
          return {
            href: `/play/${encodeURIComponent(desc.key)}/${encodeURIComponent(
              vod.id
            )}/${playbackIdx}/0`,
          };
        }
      } catch {}
    }
    return null;
  } catch {
    return null;
  }
}

function resolveRecommendedTarget(title: string, scripts: ReturnType<typeof useScriptStore.getState>["scripts"]) {
  const enabledScripts = scripts.filter((s) => s.enabled);
  if (enabledScripts.length === 0) return Promise.resolve(null);

  return new Promise<DirectVodTarget | null>((resolve) => {
    let pending = enabledScripts.length;
    let settled = false;

    const finishOne = (target: DirectVodTarget | null) => {
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

    enabledScripts.forEach((script) => {
      void inspectScriptForRecommendedTitle(script, title).then(finishOne);
    });
  });
}

export default function BrowsePage() {
  const navigate = useNavigate();
  const params = useParams();
  const scripts = useScriptStore((s) => s.scripts);
  const routeKey = params.key as BrowseKey | undefined;
  const config = routeKey ? BROWSE_CONFIG[routeKey] : undefined;
  const [items, setItems] = useState<DoubanItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [resolvingTitle, setResolvingTitle] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!config) {
      setItems([]);
      setError("未找到该分类页");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fetchDoubanList(config.kind, config.tag, 48, 0)
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error)?.message ?? String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config]);

  const subtitle = useMemo(() => {
    if (!config) return "";
    return `${config.eyebrow} · ${config.tag}`;
  }, [config]);

  const openTitle = async (title: string) => {
    const kw = title.trim();
    if (!kw || resolvingTitle) return;
    setResolvingTitle(kw);
    try {
      const target = await resolveRecommendedTarget(kw, scripts);
      if (target) {
        navigate(target.href);
      }
    } finally {
      setResolvingTitle(undefined);
    }
  };

  if (!config) {
    return (
      <div className="h-full p-4 text-cream">
        <p className="text-sm text-cream-faint">未找到该分类页。</p>
        <Link to="/" className="inline-flex items-center gap-2 mt-4 text-ember">
          <IconChevronLeft size={16} />
          返回首页
        </Link>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-ink text-cream">
      <div
        className="shrink-0 px-4 pt-4 pb-3 sm:px-6 sm:pt-6"
        style={{ background: "rgba(14,15,17,0.94)", borderBottom: "1px solid var(--cream-line)" }}
      >
        <div className="max-w-6xl mx-auto">
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
              DISCOVER · {config.eyebrow}
            </p>
            <h1 className="font-display text-xl font-extrabold text-cream">{config.title}</h1>
            <p className="hidden">{subtitle}</p>
          </div>
          <Link
            to="/"
            className="hidden"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            aria-label="返回首页"
          >
            <IconChevronLeft size={16} />
          </Link>
        </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-6xl mx-auto space-y-4">

        {error && <p className="text-sm text-ember">{error}</p>}

        {loading && items.length === 0 ? (
          <div className="flex items-center gap-2 text-[10px] font-mono text-cream-faint py-6">
            <span className="signal-bars" style={{ height: 12 }}>
              <span></span>
              <span></span>
              <span></span>
            </span>
            加载中…
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => void openTitle(item.title)}
                className="text-left tap rounded-lg overflow-hidden"
                style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
                title={`播放「${item.title}」`}
              >
                <div className="aspect-[3/4] relative scanlines" style={{ background: "var(--ink-3)" }}>
                  {item.cover ? (
                    <img
                      src={wrapImage(item.cover)}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                      alt={item.title}
                      loading="lazy"
                    />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center text-cream-faint">
                      <IconFilm size={28} />
                    </div>
                  )}
                  {item.rate && Number(item.rate) > 0 && (
                    <span
                      className="absolute top-1 right-1 font-mono text-[9px] px-1.5 py-0.5 rounded"
                      style={{
                        background: "rgba(14,15,17,0.85)",
                        color: "var(--ember)",
                        border: "1px solid rgba(255,107,53,0.3)",
                      }}
                    >
                      ★ {item.rate}
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
                  <p className="text-xs font-display font-semibold line-clamp-1 text-cream">
                    {item.title}
                  </p>
                  <p className="font-mono text-[10px] text-cream-faint mt-0.5">
                    {config.kind === "movie" ? "电影" : "剧集"} · 播放
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
