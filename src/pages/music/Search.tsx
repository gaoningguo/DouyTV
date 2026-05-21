/**
 * 搜索 —— 参考 MusicFree searchPage 的三态状态机：
 *   EDITING  → 显示历史 chip + 热搜
 *   SEARCHING → loading
 *   RESULT    → 按 type tab 显示结果（music/sheet/album/artist）
 * 删空输入即回到 EDITING；输入框为胶囊式（参考 MusicFree navBar.tsx）。
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMusicStore } from "@/stores/music";
import {
  getActiveBackendInfo,
  getHotSearch,
  searchAggregated,
  searchMusicMultiType,
} from "@/lib/music/api";
import {
  MUSIC_SEARCH_TYPES,
  MUSIC_SOURCES,
  type IRecommendSheet,
  type MusicAlbumDetail,
  type MusicArtist,
  type MusicSearchType,
  type MusicSong,
  type MusicSource,
} from "@/lib/music/types";
import { wrapImage } from "@/lib/proxy";
import {
  IconArrowLeft,
  IconArtist as IconArtistI,
  IconClose,
  IconFire,
  IconMusic,
  IconSearch,
} from "@/components/Icon";
import { showMusicMenu } from "@/components/MusicContextMenu";
import { MusicListItem } from "@/components/MusicListItem";
import { MusicChip } from "@/components/MusicChip";
import { MusicSegmentedTab } from "@/components/MusicSegmentedTab";
import { MusicEmptyState } from "@/components/MusicEmptyState";

type PageStatus = "EDITING" | "SEARCHING" | "RESULT";

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

function formatDuration(sec?: number) {
  if (!sec || !Number.isFinite(sec)) return undefined;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function MusicSearch() {
  const navigate = useNavigate();
  const store = useMusicStore();
  const hydrate = useMusicStore((s) => s.hydrate);

  const [platform, setPlatform] = useState<MusicSource>("wy");
  const [type, setType] = useState<MusicSearchType>("music");
  const [keyword, setKeyword] = useState("");
  const [committedKeyword, setCommittedKeyword] = useState("");

  const [songs, setSongs] = useState<MusicSong[]>([]);
  const [sheets, setSheets] = useState<IRecommendSheet[]>([]);
  const [albums, setAlbums] = useState<MusicAlbumDetail[]>([]);
  const [artists, setArtists] = useState<MusicArtist[]>([]);

  const [aggregated, setAggregated] = useState<
    Array<{ backendName: string; list: MusicSong[]; error?: string }>
  >([]);

  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<PageStatus>("EDITING");
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

  // 热搜
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

  const removeHistoryItem = (kw: string) => {
    const next = history.filter((h) => h !== kw);
    setHistory(next);
    saveSearchHistory(next);
  };

  const handleClearHistory = () => {
    setHistory([]);
    saveSearchHistory([]);
  };

  const doSearch = useCallback(
    async (kw: string, p: number, append: boolean) => {
      const trimmed = kw.trim();
      if (!trimmed) return;
      if (!append) {
        recordHistory(trimmed);
        setCommittedKeyword(trimmed);
      }
      setStatus("SEARCHING");
      setError(null);
      try {
        if (agg && type === "music") {
          const r = await searchAggregated(trimmed, p, 20);
          setAggregated(r);
          setSongs([]);
          setSheets([]);
          setAlbums([]);
          setArtists([]);
          setHasMore(false);
        } else {
          const r = await searchMusicMultiType(trimmed, p, 20, type);
          setAggregated([]);
          if (type === "music") {
            const list = r.songs ?? [];
            setSongs((prev) => (append ? [...prev, ...list] : list));
            setHasMore(!r.isEnd && list.length >= 20);
          } else if (type === "album") {
            const list = r.albums ?? [];
            setAlbums((prev) => (append ? [...prev, ...list] : list));
            setHasMore(!r.isEnd && list.length >= 20);
          } else if (type === "artist") {
            const list = r.artists ?? [];
            setArtists((prev) => (append ? [...prev, ...list] : list));
            setHasMore(!r.isEnd && list.length >= 20);
          } else {
            const list = r.sheets ?? [];
            setSheets((prev) => (append ? [...prev, ...list] : list));
            setHasMore(!r.isEnd && list.length >= 20);
          }
          setPage(p);
        }
        setStatus("RESULT");
      } catch (e) {
        setError((e as Error).message ?? String(e));
        setStatus("RESULT");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [platform, agg, type]
  );

  const info = getActiveBackendInfo();
  const availableTypes = info?.capabilities.multiTypeSearch
    ? MUSIC_SEARCH_TYPES
    : MUSIC_SEARCH_TYPES.filter((t) => t.id === "music");

  const handleInputChange = (v: string) => {
    setKeyword(v);
    if (v === "") {
      setStatus("EDITING");
      setSongs([]);
      setSheets([]);
      setAlbums([]);
      setArtists([]);
      setAggregated([]);
    }
  };

  return (
    <div className="min-h-screen bg-ink text-cream p-4 pb-24">
      {/* 顶部 */}
      <div className="flex items-center gap-3 mb-4">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          aria-label="返回"
        >
          <IconArrowLeft size={16} />
        </button>
        <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
          MUSIC · SEARCH
        </p>
      </div>

      {/* 胶囊搜索框 + 搜索按钮（MusicFree navBar 风格） */}
      <div className="flex items-center gap-2 mb-4">
        <div
          className="flex-1 flex items-center gap-2 pl-3 pr-2 h-10 rounded-full"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
        >
          <IconSearch size={14} className="text-cream-faint shrink-0" />
          <input
            value={keyword}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void doSearch(keyword, 1, false);
            }}
            placeholder="搜索歌曲 / 歌手 / 歌单"
            className="flex-1 bg-transparent outline-none text-sm text-cream placeholder:text-cream-faint min-w-0"
          />
          {keyword && (
            <button
              type="button"
              onClick={() => handleInputChange("")}
              className="w-6 h-6 flex items-center justify-center rounded-full tap text-cream-faint hover:text-cream"
              aria-label="清空"
            >
              <IconClose size={12} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => void doSearch(keyword, 1, false)}
          disabled={status === "SEARCHING" || !keyword.trim()}
          className="px-4 h-10 rounded-full text-xs font-display font-semibold tap disabled:opacity-50"
          style={{ background: "var(--ember)", color: "var(--ink)" }}
        >
          搜索
        </button>
      </div>

      {/* 平台 chip + 聚合 toggle —— 仅 music 类型 */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
          {MUSIC_SOURCES.map((s) => (
            <MusicChip
              key={s.id}
              label={s.label}
              active={platform === s.id}
              onClick={() => setPlatform(s.id as MusicSource)}
            />
          ))}
        </div>
        {type === "music" && (
          <button
            type="button"
            onClick={() => setAgg(!agg)}
            className="shrink-0 px-3 py-1 rounded-full text-[10px] font-mono tap"
            style={{
              background: agg ? "var(--ember)" : "var(--ink-2)",
              color: agg ? "var(--ink)" : "var(--cream-dim)",
              border: "1px solid var(--cream-line)",
            }}
            title="聚合搜索：fan-out 到所有 enabled backend"
          >
            聚合 {agg ? "ON" : "OFF"}
          </button>
        )}
      </div>

      {/* 类型 tab —— capability gated（MusicFree resultPanel 风格） */}
      {availableTypes.length > 1 && (
        <MusicSegmentedTab
          tabs={availableTypes}
          active={type}
          onChange={(t) => {
            setType(t);
            if (committedKeyword) void doSearch(committedKeyword, 1, false);
          }}
          columns={availableTypes.length}
        />
      )}

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

      {/* 三态主体 */}
      {status === "EDITING" && (
        <EditingView
          history={history}
          hot={hot}
          onClickKeyword={(kw) => {
            setKeyword(kw);
            void doSearch(kw, 1, false);
          }}
          onRemoveHistory={removeHistoryItem}
          onClearHistory={handleClearHistory}
        />
      )}

      {status === "SEARCHING" && (
        <div className="signal-bars mt-8" style={{ height: 22 }}>
          <span></span>
          <span></span>
          <span></span>
        </div>
      )}

      {status === "RESULT" && (
        <ResultView
          type={type}
          songs={songs}
          albums={albums}
          artists={artists}
          sheets={sheets}
          aggregated={aggregated}
          platform={platform}
          formatDuration={formatDuration}
          onPlayQueue={(list, i) => void store.playQueue(list, i)}
          onMenu={(s) => showMusicMenu(s)}
          hasMore={hasMore}
          onLoadMore={() => void doSearch(committedKeyword, page + 1, true)}
        />
      )}
    </div>
  );
}

// ─── EDITING ───────────────────────────────────────────────────
function EditingView({
  history,
  hot,
  onClickKeyword,
  onRemoveHistory,
  onClearHistory,
}: {
  history: string[];
  hot: string[];
  onClickKeyword: (kw: string) => void;
  onRemoveHistory: (kw: string) => void;
  onClearHistory: () => void;
}) {
  if (history.length === 0 && hot.length === 0) {
    return (
      <MusicEmptyState
        icon={<IconSearch size={32} />}
        title="开始搜索吧"
        subtitle="搜索歌曲、歌单、专辑或歌手"
      />
    );
  }
  return (
    <>
      {history.length > 0 && (
        <section className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
              HISTORY · {history.length}
            </p>
            <button
              type="button"
              onClick={onClearHistory}
              className="text-[10px] text-cream-faint font-mono tap hover:text-cream"
            >
              清空
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {history.map((h) => (
              <MusicChip
                key={h}
                label={h}
                onClick={() => onClickKeyword(h)}
                onClose={() => onRemoveHistory(h)}
              />
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
              <MusicChip
                key={h}
                label={h}
                onClick={() => onClickKeyword(h)}
                active
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// ─── RESULT ────────────────────────────────────────────────────
function ResultView({
  type,
  songs,
  albums,
  artists,
  sheets,
  aggregated,
  platform,
  formatDuration,
  onPlayQueue,
  onMenu,
  hasMore,
  onLoadMore,
}: {
  type: MusicSearchType;
  songs: MusicSong[];
  albums: MusicAlbumDetail[];
  artists: MusicArtist[];
  sheets: IRecommendSheet[];
  aggregated: Array<{ backendName: string; list: MusicSong[]; error?: string }>;
  platform: MusicSource;
  formatDuration: (sec?: number) => string | undefined;
  onPlayQueue: (list: MusicSong[], i: number) => void;
  onMenu: (s: MusicSong) => void;
  hasMore: boolean;
  onLoadMore: () => void;
}) {
  // 聚合模式
  if (aggregated.length > 0) {
    return (
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
                  <li key={`${s.source}-${s.songId}`}>
                    <MusicListItem
                      song={s}
                      index={i + 1}
                      duration={formatDuration(s.durationSec)}
                      onClick={() => onPlayQueue(g.list, i)}
                      onMenu={() => onMenu(s)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    );
  }

  if (type === "music") {
    if (songs.length === 0)
      return (
        <MusicEmptyState
          icon={<IconMusic size={32} />}
          title="没有找到匹配的歌曲"
          subtitle="尝试切换平台或开启聚合搜索"
          compact
        />
      );
    return (
      <>
        <ul className="space-y-1.5">
          {songs.map((s, i) => (
            <li key={`${s.source}-${s.songId}`}>
              <MusicListItem
                song={s}
                index={i + 1}
                duration={formatDuration(s.durationSec)}
                onClick={() => onPlayQueue(songs, i)}
                onMenu={() => onMenu(s)}
              />
            </li>
          ))}
        </ul>
        {hasMore && (
          <button
            type="button"
            onClick={onLoadMore}
            className="mt-4 w-full py-2 rounded-lg text-xs tap text-cream"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          >
            加载更多
          </button>
        )}
      </>
    );
  }

  if (type === "album") {
    if (albums.length === 0)
      return (
        <MusicEmptyState icon={<IconMusic size={32} />} title="没有找到专辑" compact />
      );
    return (
      <>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {albums.map((a) => (
            <Link
              key={a.id}
              to={`/music/album/${encodeURIComponent(platform)}/${encodeURIComponent(a.id)}`}
              className="rounded-lg overflow-hidden tap transition-transform hover:-translate-y-0.5"
              style={{
                background: "var(--ink-2)",
                border: "1px solid var(--cream-line)",
              }}
            >
              {a.cover ? (
                <img
                  src={wrapImage(a.cover)}
                  alt=""
                  loading="lazy"
                  className="w-full aspect-square object-cover"
                />
              ) : (
                <div className="w-full aspect-square flex items-center justify-center bg-ink-3">
                  <IconMusic size={32} className="text-cream-faint" />
                </div>
              )}
              <div className="p-2">
                <p className="text-xs font-display font-semibold line-clamp-1">{a.name}</p>
                {a.artist && (
                  <p className="text-[10px] font-mono text-cream-faint mt-0.5 line-clamp-1">
                    {a.artist}
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
        {hasMore && (
          <button
            type="button"
            onClick={onLoadMore}
            className="mt-4 w-full py-2 rounded-lg text-xs tap text-cream"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          >
            加载更多
          </button>
        )}
      </>
    );
  }

  if (type === "artist") {
    if (artists.length === 0)
      return (
        <MusicEmptyState icon={<IconArtistI size={32} />} title="没有找到歌手" compact />
      );
    return (
      <>
        <ul className="space-y-1.5">
          {artists.map((a) => (
            <li key={a.id}>
              <Link
                to={`/music/artist/${encodeURIComponent(platform)}/${encodeURIComponent(a.id)}`}
                className="w-full flex items-center gap-3 p-2 rounded-lg tap"
                style={{
                  background: "var(--ink-2)",
                  border: "1px solid var(--cream-line)",
                }}
              >
                {a.avatar ? (
                  <img
                    src={wrapImage(a.avatar)}
                    alt=""
                    loading="lazy"
                    className="w-12 h-12 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full flex items-center justify-center bg-ink-3 shrink-0">
                    <IconArtistI size={18} className="text-cream-faint" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-display font-semibold line-clamp-1">
                    {a.name}
                  </p>
                  {(a.worksNum != null || a.albumNum != null) && (
                    <p className="text-[10px] font-mono text-cream-faint mt-0.5">
                      {a.worksNum != null ? `${a.worksNum} 首作品` : ""}
                      {a.albumNum != null ? `  ·  ${a.albumNum} 张专辑` : ""}
                    </p>
                  )}
                </div>
                <span className="text-cream-faint">→</span>
              </Link>
            </li>
          ))}
        </ul>
        {hasMore && (
          <button
            type="button"
            onClick={onLoadMore}
            className="mt-4 w-full py-2 rounded-lg text-xs tap text-cream"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          >
            加载更多
          </button>
        )}
      </>
    );
  }

  // sheet
  if (sheets.length === 0)
    return (
      <MusicEmptyState icon={<IconMusic size={32} />} title="没有找到歌单" compact />
    );
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {sheets.map((s) => (
          <Link
            key={s.id}
            to={`/music/playlist/${encodeURIComponent(s.source ?? platform)}/${encodeURIComponent(s.id)}`}
            className="rounded-lg overflow-hidden tap transition-transform hover:-translate-y-0.5"
            style={{
              background: "var(--ink-2)",
              border: "1px solid var(--cream-line)",
            }}
          >
            {s.cover ? (
              <img
                src={wrapImage(s.cover)}
                alt=""
                loading="lazy"
                className="w-full aspect-square object-cover"
              />
            ) : (
              <div className="w-full aspect-square flex items-center justify-center bg-ink-3">
                <IconMusic size={32} className="text-cream-faint" />
              </div>
            )}
            <div className="p-2">
              <p className="text-xs font-display font-semibold line-clamp-2">{s.name}</p>
            </div>
          </Link>
        ))}
      </div>
      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          className="mt-4 w-full py-2 rounded-lg text-xs tap text-cream"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
        >
          加载更多
        </button>
      )}
    </>
  );
}
