import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useScriptStore } from "@/stores/scripts";
import { callDetail } from "@/source-script/runtime";
import {
  getDuanjuSourceBundles,
  loadSourceCategoryVideos,
  type SourceCategoryBundle,
} from "@/lib/vodSourceDiscovery";
import type { SearchResult } from "@/hooks/useSearch";
import { appAlert } from "@/components/AppDialog";
import {
  IconChevronLeft,
  IconFilm,
  IconPlay,
  IconRefresh,
} from "@/components/Icon";

export default function Duanju() {
  const navigate = useNavigate();
  const scripts = useScriptStore((s) => s.scripts);
  const hydrateScripts = useScriptStore((s) => s.hydrate);
  const [bundles, setBundles] = useState<SourceCategoryBundle[]>([]);
  const [selectedSource, setSelectedSource] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [rows, setRows] = useState<SearchResult[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingSources, setLoadingSources] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [openingId, setOpeningId] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    hydrateScripts();
  }, [hydrateScripts]);

  useEffect(() => {
    let cancelled = false;
    setLoadingSources(true);
    setError(undefined);
    getDuanjuSourceBundles(scripts)
      .then((next) => {
        if (cancelled) return;
        setBundles(next);
        const first = next[0];
        setSelectedSource(first?.script.key || "");
        setSelectedCategory(first?.categories[0]?.id || "");
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error)?.message ?? String(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingSources(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scripts]);

  const activeBundle = useMemo(
    () => bundles.find((bundle) => bundle.script.key === selectedSource),
    [bundles, selectedSource]
  );

  const loadRows = async (nextPage: number, replace: boolean) => {
    if (!activeBundle || !selectedCategory) return;
    setLoadingRows(true);
    setError(undefined);
    try {
      const result = await loadSourceCategoryVideos(
        activeBundle.script,
        selectedCategory,
        nextPage
      );
      setRows((prev) => (replace ? result.rows : [...prev, ...result.rows]));
      setPage(result.page || nextPage);
      setHasMore((result.page || nextPage) < (result.pageCount || nextPage));
    } catch (e) {
      setError((e as Error)?.message ?? String(e));
    } finally {
      setLoadingRows(false);
    }
  };

  useEffect(() => {
    setRows([]);
    setPage(1);
    setHasMore(true);
    if (activeBundle && selectedCategory) {
      void loadRows(1, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBundle?.script.key, selectedCategory]);

  const switchSource = (key: string) => {
    const bundle = bundles.find((item) => item.script.key === key);
    setSelectedSource(key);
    setSelectedCategory(bundle?.categories[0]?.id || "");
    setRows([]);
    setPage(1);
    setHasMore(true);
  };

  const openRow = async (row: SearchResult) => {
    const script = scripts.find((item) => item.key === row.scriptKey);
    if (!script || openingId) return;
    setOpeningId(`${row.scriptKey}:${row.vod.id}`);
    try {
      const detail = await callDetail(script, { id: row.vod.id });
      const playbackIdx = detail.playbacks.findIndex((pb) => pb.episodes.length > 0);
      if (playbackIdx < 0) throw new Error("该短剧没有可播放剧集");
      navigate(
        `/play/${encodeURIComponent(script.key)}/${encodeURIComponent(row.vod.id)}/${playbackIdx}/0`
      );
    } catch (e) {
      void appAlert((e as Error)?.message ?? String(e), { tone: "warning" });
    } finally {
      setOpeningId(undefined);
    }
  };

  return (
    <div className="duanju-more-page h-full flex flex-col overflow-hidden bg-ink text-cream">
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
              SOURCE · DUANJU
            </p>
            <h1 className="font-display text-2xl font-extrabold text-cream">热播短剧</h1>
            <p className="mt-1 text-sm text-cream-faint">
              从当前启用视频源中筛选短剧分类，按源站分页浏览。
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
          {loadingSources ? (
            <div className="flex items-center gap-2 text-[10px] font-mono text-cream-faint">
              <span className="signal-bars" style={{ height: 12 }}>
                <span></span>
                <span></span>
                <span></span>
              </span>
              正在筛选短剧源...
            </div>
          ) : bundles.length === 0 ? (
            <p className="text-sm text-cream-faint">当前启用的视频源没有短剧分类。</p>
          ) : (
            <>
              <PillRow
                label="源"
                value={selectedSource}
                options={bundles.map((bundle) => ({
                  label: bundle.script.name,
                  value: bundle.script.key,
                }))}
                onChange={switchSource}
              />
              <PillRow
                label="分类"
                value={selectedCategory}
                options={(activeBundle?.categories ?? []).map((category) => ({
                  label: category.name,
                  value: category.id,
                }))}
                onChange={setSelectedCategory}
              />
            </>
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
          {rows.map((row) => {
            const loading = openingId === `${row.scriptKey}:${row.vod.id}`;
            return (
              <button
                key={`${row.scriptKey}:${row.vod.id}`}
                type="button"
                onClick={() => void openRow(row)}
                className="rounded-lg overflow-hidden text-left tap"
                style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
                title={`播放「${row.vod.title}」`}
              >
                <div className="aspect-[3/4] relative scanlines" style={{ background: "var(--ink-3)" }}>
                  {row.vod.poster ? (
                    <img
                      src={row.vod.poster}
                      alt={row.vod.title}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center text-cream-faint">
                      <IconFilm size={28} />
                    </div>
                  )}
                  {row.vod.vod_remarks && (
                    <span className="absolute bottom-1 right-1 font-mono text-[9px] px-1.5 py-0.5 rounded" style={{ background: "rgba(14,15,17,0.85)", color: "var(--phosphor)", border: "1px solid rgba(124,255,178,0.2)" }}>
                      {row.vod.vod_remarks}
                    </span>
                  )}
                  {loading && (
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
                  <p className="text-xs font-display font-semibold line-clamp-1 text-cream">{row.vod.title}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-cream-faint line-clamp-1">
                    @{row.scriptName}{row.vod.year ? ` · ${row.vod.year}` : ""}
                  </p>
                </div>
              </button>
            );
          })}
        </div>

        {loadingRows && rows.length === 0 && (
          <div className="flex items-center gap-2 text-[10px] font-mono text-cream-faint py-6">
            <span className="signal-bars" style={{ height: 12 }}>
              <span></span>
              <span></span>
              <span></span>
            </span>
            加载中...
          </div>
        )}

        {!loadingRows && rows.length === 0 && !loadingSources && bundles.length > 0 && (
          <p className="text-sm text-cream-faint">当前分类暂无短剧。</p>
        )}

        {rows.length > 0 && hasMore && (
          <div className="flex justify-center pt-2">
            <button
              type="button"
              disabled={loadingRows}
              onClick={() => void loadRows(page + 1, false)}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-xs font-display font-semibold tap disabled:opacity-50"
              style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)", color: "var(--cream)" }}
            >
              {loadingRows ? <IconRefresh size={14} className="animate-spin" /> : <IconPlay size={14} />}
              {loadingRows ? "加载中..." : "加载更多"}
            </button>
          </div>
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
