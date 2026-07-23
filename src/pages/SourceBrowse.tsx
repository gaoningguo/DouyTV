/**
 * 源站寻片 —— 独立路由页（/browse-source）。
 *
 * 原本这是 Search.tsx 里的一个 useState 弹层（showSourceBrowse），进详情后弹层状态丢失，
 * 返回会落回点播首页。改成真正的路由页 + 状态提到 useVodBrowseStore 后：
 *   - 卡片 <Link to="/detail/..."> 进详情，返回 navigate(-1) 落回本页 ✓；
 *   - 列表状态存在 store，播放页抽屉能读同一份列表快速切片。
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useScriptStore } from "@/stores/scripts";
import { useVodBrowseStore } from "@/stores/vodBrowse";
import type { ScriptSourceItem } from "@/source-script/types";
import { wrapImage } from "@/lib/proxy";
import {
  IconAntenna,
  IconChevronLeft,
  IconFilm,
  IconSearch,
} from "@/components/Icon";

export default function SourceBrowse() {
  const navigate = useNavigate();
  const scripts = useScriptStore((s) => s.scripts);
  const hydrateScripts = useScriptStore((s) => s.hydrate);
  const enabledScripts = scripts.filter((s) => s.enabled);

  const scriptKey = useVodBrowseStore((s) => s.scriptKey);
  const sourceId = useVodBrowseStore((s) => s.sourceId);
  const subSources = useVodBrowseStore((s) => s.subSources);
  const subLoading = useVodBrowseStore((s) => s.subLoading);
  const results = useVodBrowseStore((s) => s.results);
  const loading = useVodBrowseStore((s) => s.loading);
  const error = useVodBrowseStore((s) => s.error);
  const hasMore = useVodBrowseStore((s) => s.hasMore);
  const mode = useVodBrowseStore((s) => s.mode);
  const searchKeyword = useVodBrowseStore((s) => s.searchKeyword);
  const ensureInit = useVodBrowseStore((s) => s.ensureInit);
  const pickScript = useVodBrowseStore((s) => s.pickScript);
  const pickSubSource = useVodBrowseStore((s) => s.pickSubSource);
  const submitSearch = useVodBrowseStore((s) => s.submitSearch);
  const backToBrowse = useVodBrowseStore((s) => s.backToBrowse);
  const loadMore = useVodBrowseStore((s) => s.loadMore);

  const [searchInput, setSearchInput] = useState("");

  useEffect(() => {
    hydrateScripts();
  }, [hydrateScripts]);

  useEffect(() => {
    if (enabledScripts.length > 0) ensureInit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledScripts.length]);

  const subSourceGroups = subSources.reduce<Record<string, ScriptSourceItem[]>>(
    (acc, s) => {
      const g = s.group || "分类";
      (acc[g] = acc[g] || []).push(s);
      return acc;
    },
    {}
  );
  const groupKeys = Object.keys(subSourceGroups);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-ink text-cream animate-fade-in">
      {/* 头部 */}
      <div
        className="shrink-0 flex items-center gap-3 px-4 pt-4 pb-3"
        style={{
          paddingTop: "calc(env(safe-area-inset-top) + 16px)",
          borderBottom: "1px solid var(--cream-line)",
          background: "rgba(14,15,17,0.94)",
        }}
      >
        <button
          type="button"
          onClick={() => navigate("/search")}
          className="w-9 h-9 rounded-full grid place-items-center tap text-cream-dim hover:text-ember shrink-0"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          aria-label="返回点播"
        >
          <IconChevronLeft size={16} />
        </button>
        <span
          className="w-9 h-9 rounded-full grid place-items-center text-ember shrink-0"
          style={{ background: "var(--ember-soft)", border: "1px solid rgba(255,107,53,0.3)" }}
        >
          <IconAntenna size={16} />
        </span>
        <div className="min-w-0">
          <p className="font-display text-base font-extrabold text-cream">源站寻片</p>
          <p className="font-mono text-[10px] text-cream-faint">按视频源浏览分类内容</p>
        </div>
      </div>

      {/* 筛选区 */}
      <div
        className="shrink-0 p-4"
        style={{
          background: "rgba(14,15,17,0.9)",
          borderBottom: "1px solid var(--cream-line)",
        }}
      >
        <div className="mx-auto w-full max-w-5xl space-y-2">
          {enabledScripts.length === 0 ? (
            <p className="text-cream-faint text-sm">
              还没有启用的视频源，请先到设置中启用点播源。
            </p>
          ) : (
            <>
              <ChipRow
                label="源"
                value={scriptKey}
                options={enabledScripts.map((s) => ({ value: s.key, label: s.name }))}
                onChange={pickScript}
              />
              {scriptKey && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    submitSearch(searchInput);
                  }}
                  className="flex items-center gap-2 pl-12"
                >
                  <div
                    className="flex-1 flex items-center gap-2 px-3 py-2 rounded-full min-w-0"
                    style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
                  >
                    <IconSearch size={14} className="text-cream-faint" />
                    <input
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      placeholder="搜索当前视频源..."
                      className="flex-1 min-w-0 bg-transparent text-sm outline-none text-cream placeholder:text-cream-faint"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!searchInput.trim()}
                    className="px-3 h-9 rounded-full text-xs font-display font-semibold tap disabled:opacity-45"
                    style={{ background: "var(--ember)", color: "var(--ink)" }}
                  >
                    搜索
                  </button>
                </form>
              )}
              {mode === "search" && searchKeyword && (
                <div
                  className="ml-12 flex items-center justify-between gap-3 rounded-lg px-3 py-2"
                  style={{ background: "rgba(89,213,255,0.1)", border: "1px solid rgba(89,213,255,0.24)" }}
                >
                  <p className="min-w-0 text-xs text-cream-dim">
                    搜索结果：<span className="text-cream">{searchKeyword}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSearchInput("");
                      backToBrowse();
                    }}
                    className="shrink-0 text-[11px] font-display text-vhs hover:text-cream tap"
                  >
                    返回分类浏览
                  </button>
                </div>
              )}
              {scriptKey && mode === "browse" && (
                <>
                  {subLoading ? (
                    <div className="flex items-center gap-2 text-[10px] font-mono text-cream-faint pl-12">
                      <span className="signal-bars" style={{ height: 10 }}>
                        <span></span>
                        <span></span>
                        <span></span>
                      </span>
                      <span>正在加载分类</span>
                    </div>
                  ) : groupKeys.length > 0 ? (
                    groupKeys.map((groupName) => (
                      <ChipWrap
                        key={groupName}
                        label={groupName}
                        value={sourceId}
                        options={subSourceGroups[groupName].map((s) => ({
                          value: s.id,
                          label: s.name,
                        }))}
                        onChange={pickSubSource}
                      />
                    ))
                  ) : (
                    <p className="text-[10px] font-mono text-cream-faint pl-12">
                      该源没有返回分类
                    </p>
                  )}
                </>
              )}
              {scriptKey && (mode === "search" || sourceId) && (
                <p className="font-mono text-[10px] tracking-wider text-cream-faint pt-1">
                  {loading && results.length === 0 ? "加载中" : `${results.length} 项`}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* 结果区 */}
      <div
        className="flex-1 min-h-0 overflow-y-auto p-4"
        style={{ paddingBottom: "calc(var(--bottom-tab-h, 56px) + env(safe-area-inset-bottom) + 24px)" }}
      >
        <div className="mx-auto w-full max-w-6xl">
          {error ? (
            <p className="text-ember text-sm">{error}</p>
          ) : mode === "search" && !searchKeyword ? (
            <EmptyText>输入关键词后在当前源站内搜索。</EmptyText>
          ) : !scriptKey || (mode === "browse" && !sourceId) ? (
            <EmptyText>选择视频源和分类后开始浏览。</EmptyText>
          ) : results.length === 0 ? (
            <EmptyText>{loading ? "正在加载内容..." : "当前分类暂时没有内容。"}</EmptyText>
          ) : (
            <>
              <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2">
                {results.map((r) => (
                  <CardOne key={`${r.scriptKey}:${r.vod.id}`} r={r} />
                ))}
              </div>
              {hasMore && (
                <div className="mt-4 flex justify-center">
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={loading}
                    className="px-5 py-2 rounded-full text-xs font-display font-semibold tap disabled:opacity-50"
                    style={{
                      background: "var(--ink-2)",
                      border: "1px solid var(--cream-line)",
                      color: "var(--cream)",
                    }}
                  >
                    {loading ? "加载中..." : "加载更多"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-cream-faint py-6 text-center">{children}</p>;
}

function CardOne({ r }: { r: ReturnType<typeof useVodBrowseStore.getState>["results"][number] }) {
  return (
    <Link
      to={`/detail/${encodeURIComponent(r.scriptKey)}/${encodeURIComponent(r.vod.id)}`}
      className="rounded-lg overflow-hidden flex flex-col tap"
      style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
    >
      <div className="aspect-[3/4] relative scanlines" style={{ background: "var(--ink-3)" }}>
        {r.vod.poster ? (
          <img
            src={wrapImage(r.vod.poster, r.vod.poster_headers)}
            className="w-full h-full object-cover"
            alt={r.vod.title}
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-cream-faint">
            <IconFilm size={32} />
          </div>
        )}
        {r.vod.vod_remarks && (
          <span
            className="absolute bottom-1 right-1 font-mono text-[9px] px-1.5 py-0.5 rounded tracking-wider"
            style={{
              background: "rgba(14,15,17,0.85)",
              color: "var(--phosphor)",
              border: "1px solid rgba(124,255,178,0.2)",
            }}
          >
            {r.vod.vod_remarks}
          </span>
        )}
      </div>
      <div className="p-2">
        <p className="text-xs line-clamp-1 text-cream font-display">{r.vod.title}</p>
        <p className="font-mono text-[10px] text-cream-faint mt-0.5 line-clamp-1">
          @{r.scriptName}
          {r.vod.year && ` · ${r.vod.year}`}
        </p>
      </div>
    </Link>
  );
}

/** 横向滚动的胶囊行：单行，溢出可拖拽滚动。用于源列表。 */
function ChipRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] tracking-wider text-cream-faint w-10 shrink-0">
        {label}
      </span>
      <div
        className="flex-1 relative min-w-0"
        style={{
          maskImage:
            "linear-gradient(to right, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%)",
        }}
      >
        <div className="flex gap-1.5 overflow-x-auto vod-scroll-row pb-1 px-2">
          {options.map((o) => {
            const active = o.value === value;
            return (
              <button
                key={o.value || "__empty__"}
                type="button"
                onClick={() => onChange(o.value)}
                className="shrink-0 px-2.5 py-1 rounded-full text-[11px] font-display tap whitespace-nowrap transition-colors"
                style={{
                  background: active ? "var(--ember-soft)" : "var(--ink-2)",
                  border: `1px solid ${active ? "var(--ember)" : "var(--cream-line)"}`,
                  color: active ? "var(--ember)" : "var(--cream-dim)",
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 单行横向滚动的胶囊行：分类很多时不换行占高度。 */
function ChipWrap({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] tracking-wider text-cream-faint w-10 shrink-0">
        {label}
      </span>
      <div
        className="flex-1 relative min-w-0"
        style={{
          maskImage:
            "linear-gradient(to right, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent 0, #000 12px, #000 calc(100% - 12px), transparent 100%)",
        }}
      >
        <div className="flex gap-1.5 overflow-x-auto vod-scroll-row pb-1 px-2">
          {options.map((o) => {
            const active = o.value === value;
            return (
              <button
                key={o.value || "__empty__"}
                type="button"
                onClick={() => onChange(o.value)}
                className="shrink-0 px-2.5 py-1 rounded-full text-[11px] font-display tap whitespace-nowrap transition-colors"
                style={{
                  background: active ? "var(--ember-soft)" : "var(--ink-2)",
                  border: `1px solid ${active ? "var(--ember)" : "var(--cream-line)"}`,
                  color: active ? "var(--ember)" : "var(--cream-dim)",
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
