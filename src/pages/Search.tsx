import { useState } from "react";
import { Link } from "react-router-dom";
import { useSearch } from "@/hooks/useSearch";
import { useScriptStore } from "@/stores/scripts";
import { IconSearch, IconClose, IconFilm } from "@/components/Icon";

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
  } = useSearch();
  const scripts = useScriptStore((s) => s.scripts);
  const enabledCount = scripts.filter((s) => s.enabled).length;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    search(input);
  };

  const quickSearch = (kw: string) => {
    setInput(kw);
    search(kw);
  };

  return (
    <div className="min-h-screen bg-ink text-cream p-4 pb-20">
      <form
        onSubmit={onSubmit}
        className="flex items-center gap-2 mb-5 sticky top-0 py-2 z-10 backdrop-blur-xl"
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

      <div className="flex items-center gap-3 font-mono text-[10px] tracking-wider text-cream-faint mb-4">
        <span>{enabledCount} SCRIPTS · PARALLEL</span>
        {keyword && (
          <>
            <span className="text-cream-dim">·</span>
            <span className="text-cream">「{keyword}」</span>
            <span className="text-cream-dim">·</span>
            <span className="text-ember">{results.length} RESULTS</span>
          </>
        )}
      </div>

      {loading && (
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
      {!loading && !error && keyword && results.length === 0 && (
        <p className="text-cream-faint text-sm">没有匹配结果</p>
      )}
      {!loading && !error && !keyword && (
        <>
          <p className="text-cream-faint text-sm">输入关键词后回车开始搜索</p>
          {history.length > 0 && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-3">
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
        </>
      )}

      <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2 mt-2">
        {results.map((r) => (
          <Link
            key={`${r.scriptKey}:${r.vod.id}`}
            to={`/detail/${encodeURIComponent(r.scriptKey)}/${encodeURIComponent(r.vod.id)}`}
            className="rounded-lg overflow-hidden flex flex-col tap"
            style={{
              background: "var(--ink-2)",
              border: "1px solid var(--cream-line)",
            }}
          >
            <div
              className="aspect-[3/4] relative scanlines"
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
              <p className="text-xs line-clamp-1 text-cream font-display">
                {r.vod.title}
              </p>
              <p className="font-mono text-[10px] text-cream-faint mt-0.5 line-clamp-1">
                @{r.scriptName}
                {r.vod.year && ` · ${r.vod.year}`}
              </p>
            </div>
          </Link>
        ))}
      </div>

      {results.length > 0 && (
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
      )}
    </div>
  );
}
