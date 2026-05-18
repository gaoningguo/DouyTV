/**
 * 弹幕选源面板。
 *
 * 流程（对齐 MoonTV/src/components/DanmakuPanel.tsx）：
 *   关键词搜索 → 选择动漫 → 选择剧集 → 把 episodeId 抛给父组件加载弹幕
 *
 * 记忆：按 title 把上次的选择存到 localStorage["douytv:danmaku-memories"]，
 * 进入 Play 页时父组件先读记忆，autoLoad=true 时不打开本面板直接套用。
 *
 * 仅 Play 页使用（长片）；Home Feed 走 matchAnime 自动匹配，不会触发本面板。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getEpisodes, searchAnime } from "@/lib/danmaku/api";
import type {
  DanmakuAnime,
  DanmakuEpisode,
  DanmakuSelection,
} from "@/lib/danmaku/types";
import { IconClose, IconSearch } from "@/components/Icon";

interface Props {
  open: boolean;
  videoTitle: string;
  currentEpisodeIndex: number;
  currentSelection: DanmakuSelection | null;
  onSelect: (selection: DanmakuSelection) => void;
  onClose: () => void;
}

const MEMORIES_KEY = "douytv:danmaku-memories";
const MEM_MAX = 100;

export interface DanmakuMemory extends DanmakuSelection {
  videoTitle: string;
  timestamp: number;
}

export function loadDanmakuMemory(videoTitle: string): DanmakuMemory | null {
  try {
    const raw = localStorage.getItem(MEMORIES_KEY);
    if (!raw) return null;
    const all = JSON.parse(raw) as Record<string, DanmakuMemory>;
    return all[videoTitle] || null;
  } catch {
    return null;
  }
}

export function saveDanmakuMemory(videoTitle: string, sel: DanmakuSelection): void {
  try {
    const raw = localStorage.getItem(MEMORIES_KEY);
    const all: Record<string, DanmakuMemory> = raw ? JSON.parse(raw) : {};
    all[videoTitle] = { ...sel, videoTitle, timestamp: Date.now() };
    // trim 到 MEM_MAX 条最新的
    const entries = Object.entries(all);
    if (entries.length > MEM_MAX) {
      entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
      const trimmed = Object.fromEntries(entries.slice(0, MEM_MAX));
      localStorage.setItem(MEMORIES_KEY, JSON.stringify(trimmed));
    } else {
      localStorage.setItem(MEMORIES_KEY, JSON.stringify(all));
    }
  } catch (e) {
    console.warn("[danmaku-panel] save memory failed", e);
  }
}

export default function DanmakuPanel({
  open,
  videoTitle,
  currentEpisodeIndex,
  currentSelection,
  onSelect,
  onClose,
}: Props) {
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<DanmakuAnime[]>([]);
  const [selectedAnime, setSelectedAnime] = useState<DanmakuAnime | null>(null);
  const [episodes, setEpisodes] = useState<DanmakuEpisode[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingEps, setLoadingEps] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const initRef = useRef(false);

  // 初次打开时：用 videoTitle 自动搜一遍，给用户一个起点
  useEffect(() => {
    if (!open) return;
    if (initRef.current) return;
    initRef.current = true;
    const initialKw = videoTitle.trim();
    if (initialKw) {
      setKeyword(initialKw);
      void doSearch(initialKw);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, videoTitle]);

  const doSearch = useCallback(async (kw: string) => {
    if (!kw.trim()) {
      setErr("请输入关键词");
      return;
    }
    setSearching(true);
    setErr(null);
    try {
      const res = await searchAnime(kw.trim());
      if (res.success) {
        setResults(res.animes);
        if (res.animes.length === 0) setErr("未找到匹配的剧集");
      } else {
        setResults([]);
        setErr(res.errorMessage || "搜索失败");
      }
    } finally {
      setSearching(false);
    }
  }, []);

  const pickAnime = useCallback(async (a: DanmakuAnime) => {
    setSelectedAnime(a);
    setEpisodes([]);
    setLoadingEps(true);
    setErr(null);
    try {
      const res = await getEpisodes(a.animeId);
      if (res.success && res.bangumi.episodes.length > 0) {
        setEpisodes(res.bangumi.episodes);
      } else {
        setErr(res.errorMessage || "该剧集无弹幕信息");
      }
    } finally {
      setLoadingEps(false);
    }
  }, []);

  const pickEpisode = useCallback(
    (ep: DanmakuEpisode) => {
      if (!selectedAnime) return;
      const selection: DanmakuSelection = {
        animeId: selectedAnime.animeId,
        episodeId: ep.episodeId,
        animeTitle: selectedAnime.animeTitle,
        episodeTitle: ep.episodeTitle,
        searchKeyword: keyword.trim() || undefined,
      };
      saveDanmakuMemory(videoTitle, selection);
      onSelect(selection);
    },
    [selectedAnime, keyword, videoTitle, onSelect]
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end animate-fade-in"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md h-full overflow-y-auto animate-slide-right"
        style={{
          background: "var(--ink)",
          borderLeft: "1px solid var(--cream-line)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶栏 */}
        <div
          className="sticky top-0 z-10 p-4 flex items-center gap-3"
          style={{
            background: "var(--ink)",
            borderBottom: "1px solid var(--cream-line)",
          }}
        >
          <div className="flex-1 min-w-0">
            <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
              DANMAKU · PICKER
            </p>
            <h1 className="font-display text-base font-extrabold tracking-tight line-clamp-1">
              {selectedAnime ? selectedAnime.animeTitle : "选择弹幕源"}
            </h1>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream"
            style={{
              background: "var(--ink-2)",
              border: "1px solid var(--cream-line)",
            }}
            aria-label="关闭"
          >
            <IconClose size={16} />
          </button>
        </div>

        <div className="p-4 pb-20">
          {/* 当前选择展示 */}
          {currentSelection && !selectedAnime && (
            <div
              className="rounded-xl p-3 mb-4"
              style={{
                background: "var(--phosphor-soft)",
                border: "1px solid rgba(124,255,178,0.2)",
              }}
            >
              <p className="font-mono text-[10px] tracking-[0.2em] text-phosphor mb-1">
                CURRENT
              </p>
              <p className="text-sm font-display font-semibold line-clamp-1">
                {currentSelection.animeTitle}
              </p>
              <p className="text-[11px] text-cream-dim mt-0.5 line-clamp-1">
                {currentSelection.episodeTitle}
                {currentSelection.danmakuCount !== undefined &&
                  ` · ${currentSelection.danmakuCount} 条`}
              </p>
            </div>
          )}

          {/* 搜索框（仅未选择动漫时显示） */}
          {!selectedAnime && (
            <div className="flex gap-2 mb-4">
              <div
                className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg"
                style={{
                  background: "var(--ink-2)",
                  border: "1px solid var(--cream-line)",
                }}
              >
                <IconSearch size={14} className="text-cream-faint shrink-0" />
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void doSearch(keyword);
                  }}
                  placeholder="搜索剧集名称"
                  className="flex-1 bg-transparent outline-none text-sm text-cream placeholder:text-cream-faint"
                />
              </div>
              <button
                type="button"
                onClick={() => void doSearch(keyword)}
                disabled={searching}
                className="px-4 py-2 rounded-lg text-xs font-display font-semibold tap disabled:opacity-50"
                style={{ background: "var(--ember)", color: "var(--ink)" }}
              >
                {searching ? "搜索中" : "搜索"}
              </button>
            </div>
          )}

          {/* 错误信息 */}
          {err && (
            <p
              className="p-2 rounded text-xs font-mono mb-4"
              style={{
                background: "rgba(255,80,80,0.08)",
                color: "#FF6B6B",
                border: "1px solid rgba(255,80,80,0.25)",
              }}
            >
              {err}
            </p>
          )}

          {/* 动漫列表 */}
          {!selectedAnime && results.length > 0 && (
            <ul className="space-y-1.5">
              {results.map((a) => (
                <li key={a.animeId}>
                  <button
                    type="button"
                    onClick={() => void pickAnime(a)}
                    className="w-full text-left p-3 rounded-lg tap"
                    style={{
                      background: "var(--ink-2)",
                      border: "1px solid var(--cream-line)",
                    }}
                  >
                    <p className="text-sm font-display font-semibold line-clamp-1">
                      {a.animeTitle}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-[10px] font-mono text-cream-faint">
                      {a.typeDescription && <span>{a.typeDescription}</span>}
                      {a.startDate && <span>· {a.startDate.slice(0, 4)}</span>}
                      {a.episodeCount !== undefined && a.episodeCount > 0 && (
                        <span>· {a.episodeCount}集</span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* 剧集列表 */}
          {selectedAnime && (
            <>
              <button
                type="button"
                onClick={() => setSelectedAnime(null)}
                className="text-xs text-cream-dim hover:text-cream mb-3 font-mono"
              >
                ← 返回搜索结果
              </button>

              {loadingEps ? (
                <div className="signal-bars" style={{ height: 18 }}>
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              ) : (
                <ul className="grid grid-cols-2 gap-1.5">
                  {episodes.map((ep, i) => {
                    const isCurrent =
                      currentSelection?.episodeId === ep.episodeId ||
                      i === currentEpisodeIndex;
                    return (
                      <li key={ep.episodeId}>
                        <button
                          type="button"
                          onClick={() => pickEpisode(ep)}
                          className="w-full text-left p-2.5 rounded-lg tap"
                          style={{
                            background: isCurrent
                              ? "var(--ember-soft)"
                              : "var(--ink-2)",
                            border: `1px solid ${
                              isCurrent ? "var(--ember)" : "var(--cream-line)"
                            }`,
                            color: isCurrent ? "var(--ember)" : "var(--cream)",
                          }}
                        >
                          <p className="text-xs font-display font-semibold line-clamp-2">
                            {ep.episodeTitle}
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
