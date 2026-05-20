/**
 * 搜索 —— 关键词 + 平台 chip + 类型 tab + 聚合搜索 + 热搜 + 历史。
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMusicStore } from "@/stores/music";
import {
  getActiveBackendInfo,
  getHotSearch,
  searchAggregated,
  searchMusic,
} from "@/lib/music/api";
import {
  MUSIC_SEARCH_TYPES,
  MUSIC_SOURCES,
  type MusicSearchType,
  type MusicSong,
  type MusicSource,
} from "@/lib/music/types";
import { wrapImage } from "@/lib/proxy";
import {
  IconArrowLeft,
  IconClose,
  IconFire,
  IconMusic,
  IconSearch,
} from "@/components/Icon";
import { showMusicMenu } from "@/components/MusicContextMenu";

const HISTORY_KEY = "douytv:music-search-history";
const HISTORY_MAX = 10;

function loadSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as string[]).slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

function saveSearchHistory(list: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
  } catch {
    /* ignore */
  }
}

export default function MusicSearch() {
  const navigate = useNavigate();
  const store = useMusicStore();
  const hydrate = useMusicStore((s) => s.hydrate);

  const [platform, setPlatform] = useState<MusicSource>("wy");
  const [type, setType] = useState<MusicSearchType>("music");
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<MusicSong[]>([]);
  const [aggregated, setAggregated] = useState<
    Array<{ backendName: string; list: MusicSong[]; error?: string }>
  >([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agg, setAgg] = useState(false);
  const [hot, setHot] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>(loadSearchHistory);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (store.hydrated) setPlatform(store.defaultPlatform);
  }, [store.hydrated, store.defaultPlatform]);

  // 热搜（capability gate）
  useEffect(() => {
    const info = getActiveBackendInfo();
    if (!info?.capabilities.hotSearch) {
      setHot([]);
      return;
    }
    void (async () => {
      const list = await getHotSearch();
      setHot(list);
    })();
  }, [store.activeBackendId]);

  const recordHistory = (kw: string) => {
    const next = [kw, ...history.filter((h) => h !== kw)].slice(0, HISTORY_MAX);
    setHistory(next);
    saveSearchHistory(next);
  };

  const doSearch = useCallback(
    async (kw: string, p: number, append: boolean) => {
      const trimmed = kw.trim();
      if (!trimmed) return;
      if (!append) recordHistory(trimmed);
      setLoading(true);
      setError(null);
      try {
        if (agg) {
          const r = await searchAggregated(trimmed, p, 20);
          setAggregated(r);
          setResults([]);
          setHasMore(false);
        } else {
          const r = await searchMusic(trimmed, platform, p, 20);
          setResults((prev) => (append ? [...prev, ...r.list] : r.list));
          setAggregated([]);
          setPage(p);
          setHasMore(r.list.length >= 20);
        }
      } catch (e) {
        setError((e as Error).message ?? String(e));
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [platform, agg]
  );

  const handleClearHistory = () => {
    setHistory([]);
    saveSearchHistory([]);
  };

  const info = getActiveBackendInfo();
  const availableTypes = info?.capabilities.multiTypeSearch
    ? MUSIC_SEARCH_TYPES
    : MUSIC_SEARCH_TYPES.filter((t) => t.id === "music");

  return (
    <div className="min-h-screen bg-ink text-cream p-4 pb-24">
      <div className="flex items-center gap-3 mb-5">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          aria-label="返回"
        >
          <IconArrowLeft size={16} />
        </button>
        <div className="flex-1">
          <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
            MUSIC · SEARCH
          </p>
          <h1 className="font-display text-xl font-extrabold tracking-tight">搜索</h1>
        </div>
        <button
          type="button"
          onClick={() => setAgg(!agg)}
          className="px-2 py-1 rounded text-[10px] font-mono tap"
          style={{
            background: agg ? "var(--ember)" : "var(--ink-2)",
            color: agg ? "var(--ink)" : "var(--cream-dim)",
            border: "1px solid var(--cream-line)",
          }}
        >
          聚合 {agg ? "ON" : "OFF"}
        </button>
      </div>

      {/* 类型 tab — capability gated */}
      {availableTypes.length > 1 && (
        <div className="grid grid-cols-4 gap-1 mb-3">
          {availableTypes.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setType(t.id as MusicSearchType)}
              className="py-1.5 rounded-md text-[10px] font-display font-semibold tap"
              style={{
                background: type === t.id ? "var(--ember)" : "var(--ink-3)",
                color: type === t.id ? "var(--ink)" : "var(--cream-dim)",
                border: "1px solid var(--cream-line)",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* 平台 chip — 横向 scroll */}
      {!agg && (
        <div className="flex gap-1 overflow-x-auto no-scrollbar pb-1 mb-3">
          {MUSIC_SOURCES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setPlatform(s.id as MusicSource)}
              className="shrink-0 px-2.5 py-1 rounded-md text-[10px] font-display font-semibold tap"
              style={{
                background: platform === s.id ? "var(--ember)" : "var(--ink-3)",
                color: platform === s.id ? "var(--ink)" : "var(--cream-dim)",
                border: "1px solid var(--cream-line)",
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <div
          className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
        >
          <IconSearch size={14} className="text-cream-faint shrink-0" />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void doSearch(keyword, 1, false);
            }}
            placeholder="搜索歌曲 / 歌手"
            className="flex-1 bg-transparent outline-none text-sm text-cream placeholder:text-cream-faint"
          />
          {keyword && (
            <button
              type="button"
              onClick={() => setKeyword("")}
              className="text-cream-faint tap"
              aria-label="清空"
            >
              <IconClose size={12} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => void doSearch(keyword, 1, false)}
          disabled={loading}
          className="px-4 py-2 rounded-lg text-xs font-display font-semibold tap disabled:opacity-50"
          style={{ background: "var(--ember)", color: "var(--ink)" }}
        >
          {loading ? "搜索中" : "搜索"}
        </button>
      </div>

      {error && (
        <p
          className="p-2 rounded text-xs font-mono mb-3"
          style={{
            background: "rgba(255,80,80,0.08)",
            color: "#FF6B6B",
            border: "1px solid rgba(255,80,80,0.25)",
          }}
        >
          {error}
        </p>
      )}

      {/* 默认页：热搜 + 历史 */}
      {!keyword && results.length === 0 && aggregated.length === 0 && (
        <>
          {history.length > 0 && (
            <section className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
                  HISTORY
                </p>
                <button
                  type="button"
                  onClick={handleClearHistory}
                  className="text-[10px] text-cream-faint font-mono tap"
                >
                  清空
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {history.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => {
                      setKeyword(h);
                      void doSearch(h, 1, false);
                    }}
                    className="px-2.5 py-1 rounded-full text-[11px] font-mono tap"
                    style={{
                      background: "var(--ink-3)",
                      color: "var(--cream-dim)",
                      border: "1px solid var(--cream-line)",
                    }}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </section>
          )}
          {hot.length > 0 && (
            <section>
              <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
                <IconFire size={10} className="inline mr-1 text-ember" />
                HOT · {hot.length}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {hot.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => {
                      setKeyword(h);
                      void doSearch(h, 1, false);
                    }}
                    className="px-2.5 py-1 rounded text-[11px] font-mono tap text-cream"
                    style={{
                      background: "var(--ember-soft)",
                      border: "1px solid rgba(255,107,53,0.3)",
                    }}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* 聚合搜索结果 */}
      {aggregated.length > 0 && (
        <div className="space-y-4">
          {aggregated.map((g) => (
            <section key={g.backendName}>
              <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
                {g.backendName.toUpperCase()}
                {g.error ? ` · ✗ ${g.error}` : ` · ${g.list.length}`}
              </p>
              {g.list.length > 0 && (
                <ul className="space-y-1.5">
                  {g.list.slice(0, 5).map((s, i) => (
                    <SongRow
                      key={`${s.source}-${s.songId}`}
                      song={s}
                      idx={i}
                      onPlay={() => void store.playQueue(g.list, i)}
                    />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      {/* 单源搜索结果 */}
      {results.length > 0 && (
        <ul className="space-y-1.5">
          {results.map((s, i) => (
            <SongRow
              key={`${s.source}-${s.songId}`}
              song={s}
              idx={i}
              onPlay={() => void store.playQueue(results, i)}
            />
          ))}
        </ul>
      )}

      {hasMore && !loading && !agg && (
        <button
          type="button"
          onClick={() => void doSearch(keyword, page + 1, true)}
          className="mt-4 w-full py-2 rounded-lg text-xs tap text-cream"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
        >
          加载更多
        </button>
      )}

      {/* 仅显示 music 类型结果 — 其他类型尚未补 UI */}
      {type !== "music" && (
        <p className="text-[11px] text-cream-faint text-center mt-3 font-mono">
          {type} 类型暂用同一 row UI 渲染
        </p>
      )}
    </div>
  );
}

function SongRow({
  song,
  idx,
  onPlay,
}: {
  song: MusicSong;
  idx: number;
  onPlay: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onPlay}
        onContextMenu={(e) => {
          e.preventDefault();
          showMusicMenu(song);
        }}
        className="w-full flex items-center gap-3 p-2 rounded-lg tap text-left"
        style={{
          background: "var(--ink-2)",
          border: "1px solid var(--cream-line)",
        }}
      >
        <span className="w-6 text-center font-mono text-[10px] text-cream-faint shrink-0">
          {String(idx + 1).padStart(2, "0")}
        </span>
        {song.cover ? (
          <img
            src={wrapImage(song.cover)}
            alt=""
            loading="lazy"
            className="w-10 h-10 rounded shrink-0 object-cover"
          />
        ) : (
          <div className="w-10 h-10 rounded shrink-0 flex items-center justify-center bg-ink-3">
            <IconMusic size={14} className="text-cream-faint" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-display font-semibold line-clamp-1">{song.name}</p>
          <p className="text-[10px] font-mono text-cream-faint line-clamp-1">
            {song.artist || "—"}
            {song.album ? ` · ${song.album}` : ""}
          </p>
        </div>
      </button>
    </li>
  );
}
