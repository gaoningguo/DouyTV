import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSearch, type SearchResult } from "@/hooks/useSearch";
import { useScriptStore } from "@/stores/scripts";
import { callGetSources, callRecommend } from "@/source-script/runtime";
import type { ScriptDescriptor, ScriptSourceItem } from "@/source-script/types";
import HotRecommendations from "@/components/HotRecommendations";
import {
  IconSearch,
  IconClose,
  IconFilm,
  IconRefresh,
  IconGrid,
  IconList,
} from "@/components/Icon";

/** 聚合 key 用：去空格 / 全角空格 / 括号 / 标点，保留汉字/字母/数字 */
function normalizeTitle(t: string): string {
  return t
    .replace(/[\s　]/g, "")
    .replace(/[()（）[\]【】{}「」『』<>《》]/g, "")
    .replace(/[^\w一-龥]/g, "");
}

/** 根据 type_name 推断电影/剧集 */
function inferType(r: SearchResult): "movie" | "tv" {
  const t = (r.vod.type_name || "").toLowerCase();
  if (t.includes("电影") || t.includes("movie")) return "movie";
  if (
    t.includes("剧") ||
    t.includes("动漫") ||
    t.includes("综艺") ||
    t.includes("anime")
  )
    return "tv";
  return "movie";
}

/** 聚合后的一组 */
interface AggGroup {
  key: string;
  title: string;
  year: string;
  poster?: string;
  remarks?: string;
  type: "movie" | "tv";
  results: SearchResult[];
}

function aggregateResults(results: SearchResult[]): AggGroup[] {
  const map = new Map<string, AggGroup>();
  const order: string[] = [];
  for (const r of results) {
    const type = inferType(r);
    const year = r.vod.year && /^\d{4}$/.test(r.vod.year) ? r.vod.year : "unknown";
    const k = `${normalizeTitle(r.vod.title)}|${type}|${year}`;
    let g = map.get(k);
    if (!g) {
      g = {
        key: k,
        title: r.vod.title,
        year,
        poster: r.vod.poster,
        remarks: r.vod.vod_remarks,
        type,
        results: [],
      };
      map.set(k, g);
      order.push(k);
    } else {
      if (!g.poster && r.vod.poster) g.poster = r.vod.poster;
      if (!g.remarks && r.vod.vod_remarks) g.remarks = r.vod.vod_remarks;
    }
    g.results.push(r);
  }
  return order.map((k) => map.get(k)!);
}

type ViewMode = "agg" | "all";
type DisplayMode = "card" | "list";

const VIEW_KEY = "douytv:search-view";
const DISPLAY_KEY = "douytv:search-display";
const BROWSE_SCRIPT_KEY = "douytv:browse-script";
const BROWSE_SOURCE_KEY = "douytv:browse-source";
const LAST_STATE_KEY = "douytv:search-last-state";

interface LastState {
  keyword: string;
  scrollY: number;
}

function readLastState(): LastState | null {
  try {
    const raw = sessionStorage.getItem(LAST_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.keyword === "string") {
      return {
        keyword: parsed.keyword,
        scrollY: typeof parsed.scrollY === "number" ? parsed.scrollY : 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function saveLastState(s: LastState) {
  try {
    sessionStorage.setItem(LAST_STATE_KEY, JSON.stringify(s));
  } catch {}
}

function clearLastState() {
  try {
    sessionStorage.removeItem(LAST_STATE_KEY);
  } catch {}
}

function readViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "all" ? "all" : "agg";
  } catch {
    return "agg";
  }
}

function readDisplayMode(): DisplayMode {
  try {
    const v = localStorage.getItem(DISPLAY_KEY);
    return v === "list" ? "list" : "card";
  } catch {
    return "card";
  }
}

export default function Search() {
  const [input, setInput] = useState("");
  const {
    results,
    loading,
    error,
    keyword,
    page,
    search,
    history,
    removeHistory,
    clearHistory,
    totalScripts,
    completedScripts,
    fromCache,
  } = useSearch();
  const scripts = useScriptStore((s) => s.scripts);
  const enabledScripts = useMemo(() => scripts.filter((s) => s.enabled), [scripts]);

  const [viewMode, setViewMode] = useState<ViewMode>(readViewMode);
  const [displayMode, setDisplayMode] = useState<DisplayMode>(readDisplayMode);

  // ── 跨页面持久化：搜 → 播 → 返回后恢复 keyword/results/scroll ─────
  // sessionStorage 寿命跟 Tauri 进程一致；results 走 useSearch 的 search-cache，
  // 这里只持久化最近 keyword + 滚动位置。
  const keywordRef = useRef(keyword);
  keywordRef.current = keyword;
  const pendingScrollRef = useRef<number | null>(null);
  const restoredRef = useRef(false);

  // 挂载时尝试恢复
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const last = readLastState();
    if (last && last.keyword) {
      setInput(last.keyword);
      void search(last.keyword);
      pendingScrollRef.current = last.scrollY;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 卸载 / pagehide 时保存
  useEffect(() => {
    const save = () => {
      const kw = keywordRef.current;
      if (kw) {
        saveLastState({ keyword: kw, scrollY: window.scrollY });
      } else {
        clearLastState();
      }
    };
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("pagehide", save);
      save();
    };
  }, []);

  // 结果回填后恢复滚动 —— 等 results 写入 DOM 再 scroll，否则跳到顶部
  useEffect(() => {
    if (pendingScrollRef.current == null) return;
    if (results.length === 0) return;
    const y = pendingScrollRef.current;
    pendingScrollRef.current = null;
    requestAnimationFrame(() => {
      window.scrollTo(0, y);
    });
  }, [results.length]);

  // ── 分类浏览状态（仅在 keyword 为空时显示） ──────────────────────────
  // 用户选了源 → 调 callGetSources 拉子分类；选了子分类 → callRecommend 展示
  const [browseScriptKey, setBrowseScriptKey] = useState<string>(() => {
    try {
      return localStorage.getItem(BROWSE_SCRIPT_KEY) || "";
    } catch {
      return "";
    }
  });
  const [browseSourceId, setBrowseSourceId] = useState<string>(() => {
    try {
      return localStorage.getItem(BROWSE_SOURCE_KEY) || "";
    } catch {
      return "";
    }
  });
  const [browseSubSources, setBrowseSubSources] = useState<ScriptSourceItem[]>([]);
  const [browseSubLoading, setBrowseSubLoading] = useState(false);
  const [browseResults, setBrowseResults] = useState<SearchResult[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | undefined>(undefined);
  const [browsePage, setBrowsePage] = useState(1);
  const [browseHasMore, setBrowseHasMore] = useState(true);

  // 选源变化 → 拉子分类，重置 sub source 选择
  useEffect(() => {
    if (!browseScriptKey) {
      setBrowseSubSources([]);
      return;
    }
    const desc = enabledScripts.find((s) => s.key === browseScriptKey);
    if (!desc) {
      setBrowseSubSources([]);
      return;
    }
    setBrowseSubLoading(true);
    let cancelled = false;
    callGetSources(desc)
      .then((list) => {
        if (cancelled) return;
        setBrowseSubSources(list);
        // 如果之前的 browseSourceId 在新列表中不存在，重置成首个
        if (list.length > 0 && !list.some((s) => s.id === browseSourceId)) {
          const first = list[0].id;
          setBrowseSourceId(first);
          try {
            localStorage.setItem(BROWSE_SOURCE_KEY, first);
          } catch {}
        }
      })
      .catch((e) => {
        if (!cancelled) {
          console.warn("[browse] getSources failed", e);
          setBrowseSubSources([]);
        }
      })
      .finally(() => {
        if (!cancelled) setBrowseSubLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [browseScriptKey, enabledScripts]);

  // 选了 script + sourceId → callRecommend
  const loadBrowse = async (p: number, replace: boolean) => {
    if (!browseScriptKey || !browseSourceId) return;
    const desc = enabledScripts.find((s) => s.key === browseScriptKey);
    if (!desc) return;
    setBrowseLoading(true);
    setBrowseError(undefined);
    try {
      const r = await callRecommend(desc, { page: p, sourceId: browseSourceId });
      const rows: SearchResult[] = r.list.map((vod) => ({
        scriptKey: desc.key,
        scriptName: desc.name,
        vod,
      }));
      setBrowseResults((prev) => (replace ? rows : [...prev, ...rows]));
      setBrowsePage(p);
      setBrowseHasMore(rows.length > 0);
    } catch (e) {
      setBrowseError((e as Error)?.message ?? String(e));
    } finally {
      setBrowseLoading(false);
    }
  };

  useEffect(() => {
    if (!keyword && browseScriptKey && browseSourceId) {
      void loadBrowse(1, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browseScriptKey, browseSourceId, keyword]);

  const pickBrowseScript = (key: string) => {
    setBrowseScriptKey(key);
    setBrowseSourceId("");
    setBrowseResults([]);
    try {
      localStorage.setItem(BROWSE_SCRIPT_KEY, key);
      localStorage.removeItem(BROWSE_SOURCE_KEY);
    } catch {}
  };

  const pickBrowseSubSource = (id: string) => {
    setBrowseSourceId(id);
    setBrowseResults([]);
    try {
      localStorage.setItem(BROWSE_SOURCE_KEY, id);
    } catch {}
  };

  // ── 搜索模式的聚合结果（无筛选，直接聚合）─────────────────────────
  const aggregated = useMemo(() => aggregateResults(results), [results]);
  const visibleCount = viewMode === "agg" ? aggregated.length : results.length;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    search(input);
  };

  const quickSearch = (kw: string) => {
    setInput(kw);
    search(kw);
  };

  const toggleViewMode = () => {
    const next = viewMode === "agg" ? "all" : "agg";
    setViewMode(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {}
  };

  const setDisplay = (d: DisplayMode) => {
    setDisplayMode(d);
    try {
      localStorage.setItem(DISPLAY_KEY, d);
    } catch {}
  };

  return (
    <div className="min-h-screen bg-ink text-cream p-4">
      {/* 搜索栏（sticky 顶部） */}
      <form
        onSubmit={onSubmit}
        className="flex items-center gap-2 mb-4 sticky top-0 py-2 z-10 backdrop-blur-xl"
        style={{ background: "rgba(14,15,17,0.92)" }}
      >
        <div
          className="flex-1 flex items-center gap-2 px-3 py-2 rounded-full"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
        >
          <IconSearch size={14} className="text-cream-faint" />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
            placeholder="搜索影视、剧名…"
            className="flex-1 bg-transparent text-sm outline-none text-cream placeholder:text-cream-faint"
          />
          {input && (
            <button
              type="button"
              onClick={() => setInput("")}
              className="text-cream-faint hover:text-cream tap p-0.5"
              aria-label="清除"
            >
              <IconClose size={14} />
            </button>
          )}
        </div>
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="px-4 py-2 rounded-full text-xs font-display font-semibold tracking-wider tap disabled:opacity-50"
          style={{ background: "var(--ember)", color: "var(--ink)" }}
        >
          搜索
        </button>
      </form>

      {/* 历史 —— 紧贴搜索栏下方，仅未输入关键词时显示 */}
      {!keyword && history.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
              RECENT
            </p>
            <button
              type="button"
              onClick={clearHistory}
              className="text-[10px] text-cream-faint hover:text-cream-dim font-mono tracking-wider"
            >
              CLEAR
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {history.map((kw) => (
              <div
                key={kw}
                className="group flex items-center rounded-full overflow-hidden"
                style={{
                  background: "var(--ink-2)",
                  border: "1px solid var(--cream-line)",
                }}
              >
                <button
                  type="button"
                  onClick={() => quickSearch(kw)}
                  className="px-3 py-1.5 text-xs hover:bg-ink-3 text-cream tap"
                >
                  {kw}
                </button>
                <button
                  type="button"
                  onClick={() => removeHistory(kw)}
                  className="px-2 py-1.5 text-cream-faint hover:text-ember border-l"
                  style={{ borderColor: "var(--cream-line)" }}
                >
                  <IconClose size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* =================== 浏览模式（未输入关键词） =================== */}
      {!keyword && (
        <>
          {/* 豆瓣热门发现 */}
          <HotRecommendations onPickTitle={quickSearch} />
          <BrowseSection
            scripts={enabledScripts}
            browseScriptKey={browseScriptKey}
            browseSourceId={browseSourceId}
            browseSubSources={browseSubSources}
            browseSubLoading={browseSubLoading}
            browseResults={browseResults}
            browseLoading={browseLoading}
            browseError={browseError}
            browseHasMore={browseHasMore}
            pickBrowseScript={pickBrowseScript}
            pickBrowseSubSource={pickBrowseSubSource}
            loadMore={() => void loadBrowse(browsePage + 1, false)}
            displayMode={displayMode}
            setDisplay={setDisplay}
          />
        </>
      )}

      {/* =================== 搜索模式（有关键词） =================== */}
      {keyword && (
        <>
          {/* 状态条 */}
          <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 font-mono text-[10px] tracking-wider text-cream-faint">
              <span className="text-cream">「{keyword}」</span>
              <span>·</span>
              {fromCache ? (
                <span className="text-phosphor">CACHED</span>
              ) : (
                <span>
                  {completedScripts}/{totalScripts} 源
                </span>
              )}
              <span>·</span>
              <span className="text-ember">{visibleCount} 结果</span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => search(keyword, 1, { force: true })}
                disabled={loading}
                className="w-8 h-8 rounded-lg flex items-center justify-center tap text-cream-dim hover:text-cream disabled:opacity-50"
                style={{
                  background: "var(--ink-2)",
                  border: "1px solid var(--cream-line)",
                }}
                aria-label="刷新"
                title="忽略缓存重新搜索"
              >
                <IconRefresh size={14} className={loading ? "animate-spin" : ""} />
              </button>
              <button
                type="button"
                onClick={toggleViewMode}
                className="px-2.5 h-8 rounded-lg flex items-center gap-1.5 text-[11px] font-display tap"
                style={{
                  background: viewMode === "agg" ? "var(--ember-soft)" : "var(--ink-2)",
                  border: `1px solid ${
                    viewMode === "agg" ? "var(--ember)" : "var(--cream-line)"
                  }`,
                  color: viewMode === "agg" ? "var(--ember)" : "var(--cream-dim)",
                }}
              >
                聚合
              </button>
              <div
                className="flex rounded-lg overflow-hidden"
                style={{ border: "1px solid var(--cream-line)" }}
              >
                <button
                  type="button"
                  onClick={() => setDisplay("card")}
                  className="w-8 h-8 flex items-center justify-center tap"
                  style={{
                    background:
                      displayMode === "card" ? "var(--ember-soft)" : "var(--ink-2)",
                    color: displayMode === "card" ? "var(--ember)" : "var(--cream-dim)",
                  }}
                >
                  <IconGrid size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => setDisplay("list")}
                  className="w-8 h-8 flex items-center justify-center tap"
                  style={{
                    background:
                      displayMode === "list" ? "var(--ember-soft)" : "var(--ink-2)",
                    color: displayMode === "list" ? "var(--ember)" : "var(--cream-dim)",
                    borderLeft: "1px solid var(--cream-line)",
                  }}
                >
                  <IconList size={14} />
                </button>
              </div>
            </div>
          </div>

          {loading && results.length === 0 && (
            <div className="flex items-center gap-3 text-cream-dim text-xs">
              <span className="signal-bars">
                <span></span>
                <span></span>
                <span></span>
              </span>
              <span className="font-mono tracking-wider">SEARCHING…</span>
            </div>
          )}
          {error && <p className="text-ember text-sm">{error}</p>}
          {!loading && !error && results.length === 0 && (
            <p className="text-cream-faint text-sm">没有匹配结果</p>
          )}

          {results.length > 0 && (
            <>
              {displayMode === "card" ? (
                <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2 mt-2">
                  {viewMode === "agg"
                    ? aggregated.map((g) => <CardAgg key={g.key} group={g} />)
                    : results.map((r) => (
                        <CardOne key={`${r.scriptKey}:${r.vod.id}`} r={r} />
                      ))}
                </div>
              ) : (
                <div className="space-y-2 mt-2">
                  {viewMode === "agg"
                    ? aggregated.map((g) => <ListAgg key={g.key} group={g} />)
                    : results.map((r) => (
                        <ListOne key={`${r.scriptKey}:${r.vod.id}`} r={r} />
                      ))}
                </div>
              )}
              <div className="mt-5 flex justify-center">
                <button
                  type="button"
                  onClick={() => search(keyword, page + 1)}
                  disabled={loading}
                  className="px-5 py-2 rounded-full text-xs font-display font-semibold tap disabled:opacity-50"
                  style={{
                    background: "var(--ink-2)",
                    border: "1px solid var(--cream-line)",
                    color: "var(--cream)",
                  }}
                >
                  {loading ? "加载中…" : `加载第 ${page + 1} 页`}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/* 历史已移到搜索栏下方 */}
    </div>
  );
}

// =================== 浏览模式 ===================

function BrowseSection({
  scripts,
  browseScriptKey,
  browseSourceId,
  browseSubSources,
  browseSubLoading,
  browseResults,
  browseLoading,
  browseError,
  browseHasMore,
  pickBrowseScript,
  pickBrowseSubSource,
  loadMore,
  displayMode,
  setDisplay,
}: {
  scripts: ScriptDescriptor[];
  browseScriptKey: string;
  browseSourceId: string;
  browseSubSources: ScriptSourceItem[];
  browseSubLoading: boolean;
  browseResults: SearchResult[];
  browseLoading: boolean;
  browseError?: string;
  browseHasMore: boolean;
  pickBrowseScript: (key: string) => void;
  pickBrowseSubSource: (id: string) => void;
  loadMore: () => void;
  displayMode: DisplayMode;
  setDisplay: (d: DisplayMode) => void;
}) {
  if (scripts.length === 0) {
    return (
      <p className="text-cream-faint text-sm mt-2">
        还没启用任何脚本。先去设置安装一个再来分类浏览。
      </p>
    );
  }

  // 分类按 group 分组（缺省归到"分类"）
  const subSourceGroups = browseSubSources.reduce<Record<string, ScriptSourceItem[]>>(
    (acc, s) => {
      const g = s.group || "分类";
      (acc[g] = acc[g] || []).push(s);
      return acc;
    },
    {}
  );
  const subSourceGroupKeys = Object.keys(subSourceGroups);

  return (
    <div className="space-y-2 mb-4">
      {/* 源 —— 横向滚动（数量多时） */}
      <ChipRow
        label="源"
        value={browseScriptKey}
        options={[
          { value: "", label: "未选择" },
          ...scripts.map((s) => ({ value: s.key, label: s.name })),
        ]}
        onChange={pickBrowseScript}
      />
      {/* 二级分类（按 group 分组，每组一行）—— 仅在选了源后显示 */}
      {browseScriptKey && (
        <>
          {browseSubLoading ? (
            <div className="flex items-center gap-2 text-[10px] font-mono text-cream-faint pl-12">
              <span className="signal-bars" style={{ height: 10 }}>
                <span></span>
                <span></span>
                <span></span>
              </span>
              <span>加载分类…</span>
            </div>
          ) : subSourceGroupKeys.length > 0 ? (
            subSourceGroupKeys.map((groupName) => (
              <ChipWrap
                key={groupName}
                label={groupName}
                value={browseSourceId}
                options={subSourceGroups[groupName].map((s) => ({
                  value: s.id,
                  label: s.name,
                }))}
                onChange={pickBrowseSubSource}
              />
            ))
          ) : (
            <p className="text-[10px] font-mono text-cream-faint pl-12">
              该源未提供分类
            </p>
          )}
        </>
      )}

      {/* 显示模式 + 加载状态 */}
      {browseScriptKey && browseSourceId && (
        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="font-mono text-[10px] tracking-wider text-cream-faint">
            {browseLoading ? "加载中…" : `${browseResults.length} 项`}
          </p>
          <div
            className="flex rounded-lg overflow-hidden"
            style={{ border: "1px solid var(--cream-line)" }}
          >
            <button
              type="button"
              onClick={() => setDisplay("card")}
              className="w-8 h-8 flex items-center justify-center tap"
              style={{
                background:
                  displayMode === "card" ? "var(--ember-soft)" : "var(--ink-2)",
                color: displayMode === "card" ? "var(--ember)" : "var(--cream-dim)",
              }}
            >
              <IconGrid size={14} />
            </button>
            <button
              type="button"
              onClick={() => setDisplay("list")}
              className="w-8 h-8 flex items-center justify-center tap"
              style={{
                background:
                  displayMode === "list" ? "var(--ember-soft)" : "var(--ink-2)",
                color: displayMode === "list" ? "var(--ember)" : "var(--cream-dim)",
                borderLeft: "1px solid var(--cream-line)",
              }}
            >
              <IconList size={14} />
            </button>
          </div>
        </div>
      )}

      {browseError && <p className="text-ember text-sm">{browseError}</p>}

      {/* 结果网格 */}
      {browseResults.length > 0 && (
        <>
          {displayMode === "card" ? (
            <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2 mt-2">
              {browseResults.map((r) => (
                <CardOne key={`${r.scriptKey}:${r.vod.id}`} r={r} />
              ))}
            </div>
          ) : (
            <div className="space-y-2 mt-2">
              {browseResults.map((r) => (
                <ListOne key={`${r.scriptKey}:${r.vod.id}`} r={r} />
              ))}
            </div>
          )}
          {browseHasMore && (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={browseLoading}
                className="px-5 py-2 rounded-full text-xs font-display font-semibold tap disabled:opacity-50"
                style={{
                  background: "var(--ink-2)",
                  border: "1px solid var(--cream-line)",
                  color: "var(--cream)",
                }}
              >
                {browseLoading ? "加载中…" : "加载更多"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// =================== ChipRow / ChipWrap ===================

/** 横向滚动的胶囊行 —— 单行，溢出可拖拽滚动。两侧渐变 mask 暗示可滚。
 *  用于"源" — 启用脚本可能很多，但不想换行占太多垂直空间 */
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
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 px-2">
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

/** 多行换行的胶囊行 —— 放得下就放，放不下就换行。常用于"分类"这种数量多的维度。 */
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
    <div className="flex items-start gap-2">
      <span className="font-mono text-[10px] tracking-wider text-cream-faint w-10 shrink-0 pt-1.5">
        {label}
      </span>
      <div className="flex-1 flex flex-wrap gap-1.5">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value || "__empty__"}
              type="button"
              onClick={() => onChange(o.value)}
              className="px-2.5 py-1 rounded-full text-[11px] font-display tap whitespace-nowrap transition-colors"
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
  );
}

// =================== 卡片 ===================

function CardAgg({ group }: { group: AggGroup }) {
  const first = group.results[0];
  return (
    <Link
      to={`/detail/${encodeURIComponent(first.scriptKey)}/${encodeURIComponent(first.vod.id)}`}
      className="rounded-lg overflow-hidden flex flex-col tap"
      style={{
        background: "var(--ink-2)",
        border: "1px solid var(--cream-line)",
      }}
    >
      <div className="aspect-[3/4] relative scanlines" style={{ background: "var(--ink-3)" }}>
        {group.poster ? (
          <img
            src={group.poster}
            className="w-full h-full object-cover"
            alt={group.title}
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-cream-faint">
            <IconFilm size={32} />
          </div>
        )}
        {group.results.length > 1 && (
          <span
            className="absolute top-1 left-1 font-mono text-[9px] px-1.5 py-0.5 rounded tracking-wider"
            style={{
              background: "rgba(14,15,17,0.85)",
              color: "var(--phosphor)",
              border: "1px solid rgba(124,255,178,0.3)",
            }}
          >
            {group.results.length} 源
          </span>
        )}
        {group.remarks && (
          <span
            className="absolute bottom-1 right-1 font-mono text-[9px] px-1.5 py-0.5 rounded tracking-wider"
            style={{
              background: "rgba(14,15,17,0.85)",
              color: "var(--phosphor)",
              border: "1px solid rgba(124,255,178,0.2)",
            }}
          >
            {group.remarks}
          </span>
        )}
      </div>
      <div className="p-2">
        <p className="text-xs line-clamp-1 text-cream font-display">{group.title}</p>
        <p className="font-mono text-[10px] text-cream-faint mt-0.5 line-clamp-1">
          {group.year !== "unknown" ? group.year : ""}
          {group.type === "tv" && " · 剧集"}
        </p>
      </div>
    </Link>
  );
}

function CardOne({ r }: { r: SearchResult }) {
  return (
    <Link
      to={`/detail/${encodeURIComponent(r.scriptKey)}/${encodeURIComponent(r.vod.id)}`}
      className="rounded-lg overflow-hidden flex flex-col tap"
      style={{
        background: "var(--ink-2)",
        border: "1px solid var(--cream-line)",
      }}
    >
      <div className="aspect-[3/4] relative scanlines" style={{ background: "var(--ink-3)" }}>
        {r.vod.poster ? (
          <img
            src={r.vod.poster}
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

function ListAgg({ group }: { group: AggGroup }) {
  const first = group.results[0];
  return (
    <Link
      to={`/detail/${encodeURIComponent(first.scriptKey)}/${encodeURIComponent(first.vod.id)}`}
      className="flex gap-3 rounded-lg overflow-hidden p-2 tap"
      style={{
        background: "var(--ink-2)",
        border: "1px solid var(--cream-line)",
      }}
    >
      <div
        className="w-20 h-28 shrink-0 rounded overflow-hidden scanlines relative"
        style={{ background: "var(--ink-3)" }}
      >
        {group.poster ? (
          <img
            src={group.poster}
            className="w-full h-full object-cover"
            alt={group.title}
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-cream-faint">
            <IconFilm size={24} />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        <p className="text-sm font-display font-semibold line-clamp-1 text-cream">
          {group.title}
        </p>
        <div className="flex items-center gap-2 flex-wrap mt-1">
          {group.year !== "unknown" && (
            <span className="font-mono text-[10px] text-cream-dim">{group.year}</span>
          )}
          {group.type === "tv" && (
            <span className="chip-ch" style={{ fontSize: 9 }}>
              剧集
            </span>
          )}
          {group.results.length > 1 && (
            <span
              className="font-mono text-[10px] px-1.5 rounded"
              style={{ color: "var(--phosphor)", border: "1px solid rgba(124,255,178,0.3)" }}
            >
              {group.results.length} 源
            </span>
          )}
          {group.remarks && (
            <span className="font-mono text-[10px] text-phosphor">{group.remarks}</span>
          )}
        </div>
        <p className="font-mono text-[10px] text-cream-faint mt-2 line-clamp-1">
          {group.results.map((r) => r.scriptName).join(" · ")}
        </p>
      </div>
    </Link>
  );
}

function ListOne({ r }: { r: SearchResult }) {
  return (
    <Link
      to={`/detail/${encodeURIComponent(r.scriptKey)}/${encodeURIComponent(r.vod.id)}`}
      className="flex gap-3 rounded-lg overflow-hidden p-2 tap"
      style={{
        background: "var(--ink-2)",
        border: "1px solid var(--cream-line)",
      }}
    >
      <div
        className="w-20 h-28 shrink-0 rounded overflow-hidden scanlines relative"
        style={{ background: "var(--ink-3)" }}
      >
        {r.vod.poster ? (
          <img
            src={r.vod.poster}
            className="w-full h-full object-cover"
            alt={r.vod.title}
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-cream-faint">
            <IconFilm size={24} />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0 flex flex-col">
        <p className="text-sm font-display font-semibold line-clamp-1 text-cream">
          {r.vod.title}
        </p>
        <div className="flex items-center gap-2 flex-wrap mt-1">
          {r.vod.year && <span className="font-mono text-[10px] text-cream-dim">{r.vod.year}</span>}
          {r.vod.vod_remarks && (
            <span className="font-mono text-[10px] text-phosphor">{r.vod.vod_remarks}</span>
          )}
          {r.vod.type_name && (
            <span className="font-mono text-[10px] text-cream-dim">{r.vod.type_name}</span>
          )}
        </div>
        <p className="font-mono text-[10px] text-cream-faint mt-2 line-clamp-1">
          @{r.scriptName}
        </p>
        {r.vod.desc && (
          <p className="text-[11px] text-cream-dim mt-1 line-clamp-2">{r.vod.desc}</p>
        )}
      </div>
    </Link>
  );
}
