import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import VideoFeed from "@/components/VideoFeed";
import InteractionBar from "@/components/InteractionBar";
import SourceSwitcher from "@/components/SourceSwitcher";
import DanmakuPanel, {
  loadDanmakuMemory,
  saveDanmakuMemory,
} from "@/components/DanmakuPanel";
import { useFeed } from "@/hooks/useFeed";
import { useLiveFeed } from "@/hooks/useLiveFeed";
import { useViewport } from "@/hooks/useViewport";
import { useLibraryStore } from "@/stores/library";
import { useMusicStore } from "@/stores/music";
import { useNetLiveStore } from "@/stores/netlive";
import { useScriptStore } from "@/stores/scripts";
import { useDanmakuStore } from "@/stores/danmaku";
import {
  IconRefresh,
  IconStatic,
  IconDanmaku,
  IconLive,
  IconAlbum,
  IconQueue,
  IconPlay,
  IconPause,
  IconHeart,
  IconHeartFill,
  IconBookmark,
  IconBookmarkFill,
  IconShare,
  IconMore,
} from "@/components/Icon";
import type { MediaItem } from "@/types/media";
import { NETLIVE_PLATFORMS, type NetLiveRoom } from "@/lib/netlive/types";
import {
  formatDuration,
  getMusicBoardSongs,
  getMusicBoards,
  getMusicHotSearch,
  musicSongKey,
  resolveMusicSource,
  searchMusicSource,
  waitForUsableMusicAudio,
  type MusicSong,
} from "@/lib/music";
import { wrapImage } from "@/lib/proxy";
import type { ScriptPlayback } from "@/source-script/types";
import type { DanmakuSelection } from "@/lib/danmaku/types";

type FeedMode = "video" | "live" | "music";

interface HomeProps {
  feedPaused?: boolean;
}

const MUSIC_FEED_KEYWORDS = ["新歌", "热歌", "民谣", "粤语", "流行", "纯音乐"];
const MUSIC_FEED_LIMIT = 48;
const MUSIC_CENTER_LIFT_CSS = "clamp(40px, 7vh, 82px)";

function shouldUseAnonymousMusicAudio(url: string) {
  if (!url) return false;
  try {
    const parsed = new URL(url, window.location.href);
    return (
      parsed.origin === window.location.origin ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "dyproxy.localhost" ||
      parsed.protocol === "dyproxy:"
    );
  } catch {
    return false;
  }
}

function setMusicAudioSource(audio: HTMLAudioElement, url: string) {
  if (shouldUseAnonymousMusicAudio(url)) {
    audio.crossOrigin = "anonymous";
    audio.setAttribute("crossorigin", "anonymous");
  } else {
    audio.crossOrigin = null;
    audio.removeAttribute("crossorigin");
  }
  audio.src = url;
  audio.load();
}

interface LyricLine {
  time: number;
  text: string;
}

// Parse an LRC string into time-sorted lines. Tolerates multiple timestamps on
// one line ("[00:01.00][00:05.00]text") and skips metadata-only / blank lines.
function parseLrc(lrc: string): LyricLine[] {
  if (!lrc) return [];
  const lines: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (stamps.length === 0) continue;
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    if (!text) continue;
    for (const stamp of stamps) {
      const min = parseInt(stamp[1], 10);
      const sec = parseInt(stamp[2], 10);
      const frac = stamp[3] ? parseInt(stamp[3].padEnd(3, "0").slice(0, 3), 10) : 0;
      lines.push({ time: min * 60 + sec + frac / 1000, text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

interface MusicFeedCache {
  items: MusicSong[];
  activeIndex: number;
  signature: string;
  seed: number;
}

let musicFeedCache: MusicFeedCache = {
  items: [],
  activeIndex: 0,
  signature: "",
  seed: 0,
};

function normalizeMusicText(value?: string) {
  return (value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function musicRecommendKey(song: MusicSong) {
  return `${normalizeMusicText(song.title)}:${normalizeMusicText(song.artist)}`;
}

function hashString(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function seededScore(seed: number, id: string): number {
  let h = (seed ^ hashString(id)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function dedupeMusicRecommendations(songs: MusicSong[]) {
  const seen = new Set<string>();
  return songs.filter((song) => {
    const key = musicRecommendKey(song) || musicSongKey(song);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type MusicRankSong = MusicSong & {
  lastPlayedAt?: number;
  playCount?: number;
};

function musicArtistTokens(song: MusicSong) {
  return (song.artist || "")
    .split(/[、,/&，;；|｜]+/)
    .map(normalizeMusicText)
    .filter(Boolean);
}

function buildArtistAffinity(
  songs: MusicSong[],
  options: { limit: number; base: number; playCount?: boolean }
) {
  const affinity = new Map<string, number>();
  songs.slice(0, options.limit).forEach((song, index) => {
    const rank = Math.max(0.12, 1 - index / Math.max(1, options.limit));
    const count = options.playCount
      ? Math.min(2.2, Math.max(1, (song as MusicRankSong).playCount ?? 1))
      : 1;
    musicArtistTokens(song).forEach((artist) => {
      affinity.set(
        artist,
        (affinity.get(artist) ?? 0) + options.base * rank * count
      );
    });
  });
  return affinity;
}

function artistAffinityScore(song: MusicSong, affinity: Map<string, number>) {
  return Math.min(
    0.32,
    musicArtistTokens(song).reduce(
      (score, artist) => score + (affinity.get(artist) ?? 0),
      0
    )
  );
}

function recentPlayPenalty(song: MusicSong, historyByKey: Map<string, MusicRankSong>) {
  const record = historyByKey.get(musicRecommendKey(song));
  if (!record?.lastPlayedAt) return 0;
  const age = Date.now() - record.lastPlayedAt;
  if (age < 10 * 60_000) return 0.42;
  if (age < 6 * 60 * 60_000) return 0.22;
  if (age < 24 * 60 * 60_000) return 0.1;
  return 0;
}

function diversifyMusicRecommendations(songs: MusicSong[], limit: number) {
  const pending = songs.slice();
  const out: MusicSong[] = [];
  const wouldCluster = (song: MusicSong) => {
    const recent = out.slice(-2);
    if (recent.length < 2) return false;
    const sameSource = recent.every((item) => item.sourceId === song.sourceId);
    const platform = String(song.platform || "");
    const samePlatform =
      !!platform && recent.every((item) => String(item.platform || "") === platform);
    return sameSource || samePlatform;
  };

  while (pending.length > 0 && out.length < limit) {
    const pick = pending.findIndex((song) => !wouldCluster(song));
    out.push(pending.splice(pick >= 0 ? pick : 0, 1)[0]);
  }
  return out;
}

function rankMusicRecommendations({
  songs,
  favorites,
  history,
  queue,
  seed,
}: {
  songs: MusicSong[];
  favorites: MusicSong[];
  history: MusicRankSong[];
  queue: MusicSong[];
  seed: number;
}) {
  const favoriteKeys = new Set(favorites.map(musicRecommendKey));
  const historyByKey = new Map(
    history.slice(0, 140).map((song) => [musicRecommendKey(song), song])
  );
  const favoriteArtists = buildArtistAffinity(favorites, {
    limit: 80,
    base: 0.09,
  });
  const recentArtists = buildArtistAffinity(history, {
    limit: 100,
    base: 0.055,
    playCount: true,
  });
  const queueArtists = buildArtistAffinity(queue, {
    limit: 40,
    base: 0.05,
  });
  const titleCounts = new Map<string, number>();
  songs.forEach((song) => {
    const titleKey = normalizeMusicText(song.title);
    if (titleKey) titleCounts.set(titleKey, (titleCounts.get(titleKey) ?? 0) + 1);
  });

  const scored = dedupeMusicRecommendations(songs)
    .map((song, index) => {
      const key = musicRecommendKey(song) || musicSongKey(song);
      const favoriteBoost = favoriteKeys.has(key) ? 0.36 : 0;
      const historyBoost = historyByKey.has(key) ? 0.12 : 0;
      const artistBoost =
        artistAffinityScore(song, favoriteArtists) +
        artistAffinityScore(song, recentArtists) +
        artistAffinityScore(song, queueArtists);
      const coverBoost = song.cover ? 0.08 : 0;
      const durationBoost = song.durationSec || song.durationText ? 0.04 : 0;
      const freshness = Math.max(0, 0.1 - index * 0.0015);
      const duplicateTitlePenalty =
        (titleCounts.get(normalizeMusicText(song.title)) ?? 0) > 3 ? 0.04 : 0;
      const repeatPenalty = recentPlayPenalty(song, historyByKey);
      const random = seededScore(seed, `${key}:${song.sourceId}`) * 0.18;
      return {
        song,
        score:
          favoriteBoost +
          historyBoost +
          artistBoost +
          coverBoost +
          durationBoost +
          freshness +
          random -
          repeatPenalty -
          duplicateTitlePenalty,
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((item) => item.song);

  return diversifyMusicRecommendations(scored, MUSIC_FEED_LIMIT);
}

function useMusicHomeFeed(enabled: boolean) {
  const hydrate = useMusicStore((s) => s.hydrate);
  const hydrated = useMusicStore((s) => s.hydrated);
  const sources = useMusicStore((s) => s.sources);
  const favorites = useMusicStore((s) => s.favorites);
  const history = useMusicStore((s) => s.history);
  const queue = useMusicStore((s) => s.queue);
  const [items, setItems] = useState<MusicSong[]>(() => musicFeedCache.items);
  const [activeIndex, setActiveIndex] = useState(() => musicFeedCache.activeIndex);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const inFlight = useRef(false);
  const seedRef = useRef(musicFeedCache.seed || Date.now());
  const restoredCacheRef = useRef(musicFeedCache.items.length > 0);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const enabledSources = useMemo(
    () => sources.filter((source) => source.enabled),
    [sources]
  );
  const discoverySource = useMemo(
    () => enabledSources.find((source) => source.kind === "lx-server"),
    [enabledSources]
  );
  // Only source config (add/remove/enable/disable) should auto-reload the
  // feed. favorites/history must NOT be in the signature: playing/scrolling a
  // song calls noteHistory(), and a favorites toggle mutates favorites — either
  // would otherwise re-trigger load(true), re-seeding the whole list into fresh
  // songs ("下滑后刷新变成新歌"). They remain inputs to ranking inside load().
  const signature = useMemo(
    () =>
      enabledSources
        .map((source) => `${source.id}:${source.enabled ? 1 : 0}:${source.updatedAt ?? 0}`)
        .join("|"),
    [enabledSources]
  );

  const load = useCallback(
    async (replace = true) => {
      if (!enabled || inFlight.current) return;
      if (enabledSources.length === 0) {
        setItems([]);
        setError(undefined);
        return;
      }
      inFlight.current = true;
      setLoading(true);
      setError(undefined);
      if (replace) {
        seedRef.current = Date.now();
        setActiveIndex(0);
      }
      try {
        const collected: MusicSong[] = [
          ...queue,
          ...favorites,
          ...history,
        ];

        if (discoverySource) {
          const [boardsResult, hotResult] = await Promise.allSettled([
            getMusicBoards(discoverySource, "kw"),
            getMusicHotSearch(discoverySource, "mg"),
          ]);
          if (boardsResult.status === "fulfilled") {
            const boards = boardsResult.value.list.slice(0, 3);
            const boardSongs = await Promise.allSettled(
              boards.map((board) =>
                getMusicBoardSongs(discoverySource, board.source, board.id, 1)
              )
            );
            boardSongs.forEach((result) => {
              if (result.status === "fulfilled") collected.push(...result.value.list);
            });
          }
          if (hotResult.status === "fulfilled") {
            const hotKeywords = hotResult.value
              .map((item) => item.keyword)
              .filter(Boolean)
              .slice(0, 4);
            const hotSongs = await Promise.allSettled(
              hotKeywords.map((keyword) =>
                searchMusicSource(discoverySource, keyword, 1, 8)
              )
            );
            hotSongs.forEach((result) => {
              if (result.status === "fulfilled") collected.push(...result.value.list);
            });
          }
        }

        const fallbackSearches = await Promise.allSettled(
          enabledSources.slice(0, 4).map((source, index) =>
            searchMusicSource(
              source,
              MUSIC_FEED_KEYWORDS[index % MUSIC_FEED_KEYWORDS.length],
              1,
              8
            )
          )
        );
        fallbackSearches.forEach((result) => {
          if (result.status === "fulfilled") collected.push(...result.value.list);
        });

        const ranked = rankMusicRecommendations({
          songs: collected,
          favorites,
          history,
          queue,
          seed: seedRef.current,
        });
        setItems(ranked);
        setError(ranked.length === 0 ? "没有拿到可推荐的音乐内容" : undefined);
      } catch (e) {
        setError((e as Error).message ?? String(e));
        if (replace) setItems([]);
      } finally {
        setLoading(false);
        inFlight.current = false;
      }
    },
    [discoverySource, enabled, enabledSources, favorites, history, queue]
  );

  useEffect(() => {
    if (!enabled || !hydrated) return;
    if (
      restoredCacheRef.current &&
      musicFeedCache.items.length > 0 &&
      musicFeedCache.signature === signature
    ) {
      restoredCacheRef.current = false;
      return;
    }
    restoredCacheRef.current = false;
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hydrated, signature]);

  useEffect(() => {
    musicFeedCache = {
      items,
      activeIndex: Math.max(0, Math.min(items.length - 1, activeIndex)),
      signature,
      seed: seedRef.current,
    };
  }, [activeIndex, items, signature]);

  return {
    items,
    loading,
    error,
    activeIndex,
    setActiveIndex,
    reload: () => load(true),
    enabledSources,
  };
}

export default function Home({ feedPaused = false }: HomeProps) {
  const { isDesktop } = useViewport();
  const [mode, setMode] = useState<FeedMode>(() => {
    try {
      const saved = localStorage.getItem("douytv:home-feed-mode");
      return saved === "live" || saved === "music" ? saved : "video";
    } catch {
      return "video";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("douytv:home-feed-mode", mode);
    } catch {
      /* private mode */
    }
  }, [mode]);

  return mode === "live" ? (
    <LiveHomeFeed
      mode={mode}
      setMode={setMode}
      isDesktop={isDesktop}
      feedPaused={feedPaused}
    />
  ) : mode === "music" ? (
    <MusicHomeFeed
      mode={mode}
      setMode={setMode}
      isDesktop={isDesktop}
      feedPaused={feedPaused}
    />
  ) : (
    <VideoHomeFeed mode={mode} setMode={setMode} isDesktop={isDesktop} />
  );
}

function VideoHomeFeed({
  mode,
  setMode,
  isDesktop,
}: {
  mode: FeedMode;
  setMode: (mode: FeedMode) => void;
  isDesktop: boolean;
}) {
  const {
    items,
    loading,
    error,
    loadMore,
    reload,
    changeEpisode,
    reresolveItem,
    swapSource,
  } = useFeed();
  const hydrateScripts = useScriptStore((s) => s.hydrate);
  const hydrateLib = useLibraryStore((s) => s.hydrate);
  const upsertHistory = useLibraryStore((s) => s.upsertHistory);
  const scripts = useScriptStore((s) => s.scripts);
  const enabledInFeed = useDanmakuStore((s) => s.enabledInFeed);
  const patchPrefs = useDanmakuStore((s) => s.patchPrefs);
  const bumpFeedRefresh = useDanmakuStore((s) => s.bumpFeedRefresh);

  const [activeIndex, setActiveIndex] = useState(0);
  const [switchSourceItem, setSwitchSourceItem] = useState<MediaItem | null>(null);
  const [danmakuPanelOpen, setDanmakuPanelOpen] = useState(false);
  const [danmakuSelTick, setDanmakuSelTick] = useState(0);

  useEffect(() => {
    hydrateScripts();
    hydrateLib();
  }, [hydrateScripts, hydrateLib]);

  const activeItem: MediaItem | undefined = items[activeIndex];

  const currentDanmakuSel: DanmakuSelection | null = useMemo(() => {
    if (!activeItem?.title) return null;
    return loadDanmakuMemory(activeItem.title) ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeItem?.title, danmakuSelTick]);

  const handleDanmakuPick = (selection: DanmakuSelection) => {
    setDanmakuPanelOpen(false);
    if (!activeItem?.title) return;
    saveDanmakuMemory(activeItem.title, selection);
    if (!enabledInFeed) patchPrefs({ enabledInFeed: true });
    bumpFeedRefresh();
    setDanmakuSelTick((n) => n + 1);
  };

  const switchPlaybacks: ScriptPlayback[] =
    switchSourceItem && switchSourceItem.episodes && switchSourceItem.episodes.length > 0
      ? [
          {
            sourceId: switchSourceItem.sourceId ?? "",
            sourceName: switchSourceItem.sourceName ?? "当前线路",
            episodes: switchSourceItem.episodes,
            episodes_titles: switchSourceItem.episodesTitles,
          },
        ]
      : [];
  const switchScript = switchSourceItem
    ? scripts.find((s) => s.key === switchSourceItem.scriptKey)
    : undefined;

  const topBar = (
    <HomeTopBar
      mode={mode}
      setMode={setMode}
      onRefresh={reload}
      activeItem={activeItem}
      variant={isDesktop ? "desktop" : "immersive"}
      videoActions={
        activeItem ? (
          <>
            <button
              type="button"
              onClick={() => patchPrefs({ enabledInFeed: !enabledInFeed })}
              className="w-9 h-9 rounded-full flex items-center justify-center tap backdrop-blur-md transition-colors"
              style={{
                background: "rgba(14,15,17,0.55)",
                border: `1px solid ${
                  enabledInFeed && currentDanmakuSel
                    ? "var(--ember)"
                    : "var(--cream-line)"
                }`,
                color:
                  enabledInFeed && currentDanmakuSel
                    ? "var(--ember)"
                    : "var(--cream-dim)",
              }}
              aria-label="弹幕开关"
              title={
                currentDanmakuSel
                  ? enabledInFeed
                    ? "关闭弹幕"
                    : "开启弹幕"
                  : "未选择弹幕源"
              }
            >
              <IconDanmaku size={16} />
            </button>
            <button
              type="button"
              onClick={() => setDanmakuPanelOpen(true)}
              className="hidden sm:flex px-3 h-9 items-center gap-1.5 rounded-full backdrop-blur-md tap font-display text-xs"
              style={{
                background: "rgba(14,15,17,0.55)",
                border: "1px solid var(--cream-line)",
                color: "var(--cream)",
              }}
            >
              {currentDanmakuSel ? (
                <>
                  <span
                    className="rec-dot"
                    style={{ width: 5, height: 5, background: "var(--phosphor)" }}
                  />
                  <span className="line-clamp-1 max-w-[100px]">
                    {currentDanmakuSel.episodeTitle ||
                      currentDanmakuSel.animeTitle ||
                      "已选弹幕"}
                  </span>
                </>
              ) : (
                "选择弹幕"
              )}
            </button>
          </>
        ) : null
      }
    />
  );

  if (loading && items.length === 0) {
    return (
      <HomeShell isDesktop={isDesktop}>
        {topBar}
        <FeedLoading label="TUNING VIDEO..." />
      </HomeShell>
    );
  }

  if (error) {
    return (
      <HomeShell isDesktop={isDesktop}>
        {topBar}
        <FeedError
          title="NO SIGNAL"
          message={error}
          actionLabel="重试连接"
          onRetry={reload}
        />
      </HomeShell>
    );
  }

  if (items.length === 0) {
    return (
      <HomeShell isDesktop={isDesktop}>
        {topBar}
        <FeedEmptyState
          icon={<IconStatic size={64} className="text-cream-faint mb-4" />}
          label="NO BROADCAST"
          title="还没有可用的视频内容"
          detail={
            <>
              已安装 <span className="font-mono text-cream-dim">{scripts.length}</span>{" "}
              个脚本，启用{" "}
              <span className="font-mono text-ember">
                {scripts.filter((s) => s.enabled).length}
              </span>{" "}
              个
            </>
          }
          primaryLabel="刷新"
          onPrimary={reload}
          secondaryTo="/settings"
          secondaryLabel="前往设置"
        />
      </HomeShell>
    );
  }

  return (
    <HomeShell isDesktop={isDesktop}>
      {topBar}
      <VideoFeed
        items={items}
        onLoadMore={loadMore}
        feedChrome="video"
        onIndexChange={setActiveIndex}
        onProgress={(item, position, duration) =>
          upsertHistory(item, { position, duration })
        }
        onItemEnded={(item) => {
          const cur = item.currentEpisodeIndex ?? 0;
          const total = item.episodes?.length ?? 0;
          if (total > 1 && cur + 1 < total) {
            void changeEpisode(item.id, cur + 1);
          }
        }}
        onRequestReresolve={(item) => reresolveItem(item.id)}
        onRequestSwitchSource={(item) => setSwitchSourceItem(item)}
        onChangeEpisode={(item, idx) => changeEpisode(item.id, idx)}
        heightMode={isDesktop ? "container" : "viewport"}
        renderOverlay={(item, i) => (
          <>
            <FeedShade />
            <FeedCaption item={item} index={i} desktop={isDesktop} />
            <InteractionBar
              item={item}
              onSelectEpisode={(idx) => changeEpisode(item.id, idx)}
            />
          </>
        )}
      />

      {switchSourceItem && (
        <SourceSwitcher
          open={!!switchSourceItem}
          playbacks={switchPlaybacks}
          currentIndex={0}
          episodeIndex={switchSourceItem.currentEpisodeIndex ?? 0}
          script={switchScript}
          videoTitle={switchSourceItem.title}
          onPick={() => setSwitchSourceItem(null)}
          onPickCrossScript={async (newScriptKey, newVodId) => {
            const targetId = switchSourceItem.id;
            setSwitchSourceItem(null);
            await swapSource(targetId, newScriptKey, newVodId);
          }}
          onClose={() => setSwitchSourceItem(null)}
        />
      )}

      {activeItem && (
        <DanmakuPanel
          open={danmakuPanelOpen}
          videoTitle={activeItem.title}
          currentEpisodeIndex={activeItem.currentEpisodeIndex ?? 0}
          currentSelection={currentDanmakuSel}
          onSelect={handleDanmakuPick}
          onClose={() => setDanmakuPanelOpen(false)}
        />
      )}
    </HomeShell>
  );
}

function LiveHomeFeed({
  mode,
  setMode,
  isDesktop,
  feedPaused,
}: {
  mode: FeedMode;
  setMode: (mode: FeedMode) => void;
  isDesktop: boolean;
  feedPaused: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    items,
    loading,
    error,
    loadMore,
    reload,
    activeIndex,
    setActiveIndex,
    reresolveItem,
  } = useLiveFeed({ enabled: true });
  const hydrateLibrary = useLibraryStore((s) => s.hydrate);
  const noteVisit = useNetLiveStore((s) => s.noteVisit);
  const activeItem = items[activeIndex];

  useEffect(() => {
    hydrateLibrary();
  }, [hydrateLibrary]);

  const openLiveDetail = (item: MediaItem) => {
    const room = mediaItemToNetLiveRoom(item);
    if (!room) return;
    noteVisit(room);
    navigate(
      `/live/room/${encodeURIComponent(room.platform)}/${encodeURIComponent(room.roomId)}`,
      { state: { room, backgroundLocation: location } }
    );
  };

  const topBar = (
    <HomeTopBar
      mode={mode}
      setMode={setMode}
      onRefresh={reload}
      activeItem={activeItem}
      variant={isDesktop ? "desktop" : "immersive"}
    />
  );

  if (loading && items.length === 0) {
    return (
      <HomeShell isDesktop={isDesktop}>
        {topBar}
        <FeedLoading label="TUNING LIVE..." />
      </HomeShell>
    );
  }

  if (error) {
    return (
      <HomeShell isDesktop={isDesktop}>
        {topBar}
        <FeedError
          title="LIVE SIGNAL LOST"
          message={error}
          actionLabel="刷新直播"
          onRetry={reload}
        />
      </HomeShell>
    );
  }

  if (items.length === 0) {
    return (
      <HomeShell isDesktop={isDesktop}>
        {topBar}
        <FeedEmptyState
          icon={<IconLive size={64} className="text-cream-faint mb-4" />}
          label="NO LIVE FEED"
          title="还没有可推荐的直播内容"
          primaryLabel="刷新"
          onPrimary={reload}
          secondaryTo="/settings/live-hub"
          secondaryLabel="添加直播源"
        />
      </HomeShell>
    );
  }

  return (
    <HomeShell isDesktop={isDesktop}>
      {topBar}
      <VideoFeed
        items={items}
        active={!feedPaused}
        initialIndex={activeIndex}
        onLoadMore={loadMore}
        feedChrome="live"
        onIndexChange={setActiveIndex}
        onRequestReresolve={(item) => reresolveItem(item.id)}
        heightMode={isDesktop ? "container" : "viewport"}
        renderOverlay={(item, i) => (
          <>
            <FeedShade />
            <LiveCaption
              item={item}
              index={i}
              desktop={isDesktop}
              onOpenDetail={openLiveDetail}
            />
            <LiveActionRail item={item} desktop={isDesktop} />
          </>
        )}
      />
    </HomeShell>
  );
}

function MusicHomeFeed({
  mode,
  setMode,
  isDesktop,
  feedPaused,
}: {
  mode: FeedMode;
  setMode: (mode: FeedMode) => void;
  isDesktop: boolean;
  feedPaused: boolean;
}) {
  const navigate = useNavigate();
  const audioRef = useRef<HTMLAudioElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const playRequestRef = useRef(0);
  const userStartedRef = useRef(false);
  const lastAutoPlayKeyRef = useRef("");
  const scrollSettleRef = useRef<number | undefined>(undefined);
  const restoredScrollRef = useRef(false);
  const iconFlashRef = useRef<number | undefined>(undefined);
  const {
    items,
    loading,
    error,
    activeIndex,
    setActiveIndex,
    reload,
    enabledSources,
  } = useMusicHomeFeed(true);
  const sources = useMusicStore((s) => s.sources);
  const currentSong = useMusicStore((s) => s.currentSong);
  const setCurrentSong = useMusicStore((s) => s.setCurrentSong);
  const setQueue = useMusicStore((s) => s.setQueue);
  const appendToQueue = useMusicStore((s) => s.appendToQueue);
  const isFavorite = useMusicStore((s) => s.isFavorite);
  const toggleFavorite = useMusicStore((s) => s.toggleFavorite);
  const noteHistory = useMusicStore((s) => s.noteHistory);
  const quality = useMusicStore((s) => s.quality);
  const proxyEnabled = useMusicStore((s) => s.proxyEnabled);
  const volume = useMusicStore((s) => s.volume);
  const [audioUrl, setAudioUrl] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [toast, setToast] = useState<string | undefined>();
  const [iconFlash, setIconFlash] = useState(false);
  const [lyricLines, setLyricLines] = useState<LyricLine[]>([]);
  const activeSong = items[Math.max(0, Math.min(activeIndex, items.length - 1))];

  // Index of the lyric line that matches the current playback position.
  const activeLyricIndex = useMemo(() => {
    if (lyricLines.length === 0) return -1;
    let lo = 0;
    let hi = lyricLines.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lyricLines[mid].time <= currentTime) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }, [lyricLines, currentTime]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    if (feedPaused) audioRef.current?.pause();
  }, [feedPaused]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(undefined), 1300);
  };

  const scrollToIndex = (index: number) => {
    const target = itemRefs.current[index];
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setActiveIndex(index);
  };

  // Briefly reveal the centre play/pause icon on tap, then fade it back out.
  const flashIcon = () => {
    if (iconFlashRef.current !== undefined) {
      window.clearTimeout(iconFlashRef.current);
    }
    setIconFlash(true);
    iconFlashRef.current = window.setTimeout(() => {
      iconFlashRef.current = undefined;
      setIconFlash(false);
    }, 600);
  };

  const playSong = useCallback(
    async (song: MusicSong, userInitiated = true) => {
      if (userInitiated) userStartedRef.current = true;
      const candidates = dedupeMusicRecommendations([
        song,
        ...items.filter((item) => musicRecommendKey(item) === musicRecommendKey(song)),
      ]);
      const requestId = ++playRequestRef.current;
      setResolving(true);
      // Stop the previous track immediately. Otherwise the old audio keeps
      // playing through the (async) resolve below, so the card shows the new
      // song while the speakers are still on the previous one.
      const prevAudio = audioRef.current;
      if (prevAudio && !prevAudio.paused) {
        prevAudio.pause();
        setIsPlaying(false);
      }
      setLyricLines([]);
      let lastError: unknown;

      for (const candidate of candidates) {
        const source = sources.find(
          (item) => item.enabled && item.id === candidate.sourceId
        );
        if (!source) continue;
        try {
          setCurrentSong(candidate);
          // Only (re)build the queue on an explicit user play. Auto-advance
          // while scrolling the feed must not clobber a user-curated queue.
          if (userInitiated) {
            setQueue(items.length > 0 ? items : [candidate], candidate);
          }
          const play = await resolveMusicSource(source, candidate, quality, {
            proxy: proxyEnabled,
          });
          if (requestId !== playRequestRef.current) return;
          const audio = audioRef.current;
          if (audio) {
            audio.autoplay = userStartedRef.current;
            setMusicAudioSource(audio, play.url);
            const loadedDuration = await waitForUsableMusicAudio(
              audio,
              candidate.durationSec
            );
            if (requestId !== playRequestRef.current) return;
            if (loadedDuration) setDuration(loadedDuration);
          }
          setAudioUrl(play.url);
          setCurrentTime(0);
          setLyricLines(parseLrc(play.lyric ?? ""));
          noteHistory(candidate, 0, candidate.durationSec ?? 0);
          if (audio) {
            if (userStartedRef.current && !feedPaused) {
              await audio
                .play()
                .then(() => setIsPlaying(true))
                .catch(() => setIsPlaying(false));
            }
          }
          setResolving(false);
          return;
        } catch (playError) {
          lastError = playError;
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.removeAttribute("src");
            audioRef.current.load();
          }
          if (requestId !== playRequestRef.current) return;
        }
      }

      if (requestId === playRequestRef.current) {
        setResolving(false);
        const message =
          lastError instanceof Error ? lastError.message : "音乐解析失败";
        showToast(message);
      }
    },
    [
      feedPaused,
      items,
      noteHistory,
      proxyEnabled,
      quality,
      setCurrentSong,
      setQueue,
      sources,
    ]
  );

  useEffect(() => {
    if (!activeSong || !userStartedRef.current || feedPaused) return;
    const key = musicSongKey(activeSong);
    if (lastAutoPlayKeyRef.current === key) return;
    lastAutoPlayKeyRef.current = key;
    void playSong(activeSong, false);
  }, [activeSong, feedPaused, playSong]);

  const handleScroll = () => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    if (scrollSettleRef.current !== undefined) {
      window.clearTimeout(scrollSettleRef.current);
    }
    // Only commit the active index once scrolling settles on a snap point.
    // Reacting mid-drag would switch the active song before the swipe lands
    // (and even when it snaps back), leaving audio and the card out of sync.
    scrollSettleRef.current = window.setTimeout(() => {
      scrollSettleRef.current = undefined;
      const el = scrollRef.current;
      if (!el) return;
      const height = el.clientHeight || 1;
      const nextIndex = Math.max(
        0,
        Math.min(items.length - 1, Math.round(el.scrollTop / height))
      );
      if (nextIndex !== activeIndex) setActiveIndex(nextIndex);
    }, 120);
  };

  useEffect(
    () => () => {
      if (scrollSettleRef.current !== undefined) {
        window.clearTimeout(scrollSettleRef.current);
      }
      if (iconFlashRef.current !== undefined) {
        window.clearTimeout(iconFlashRef.current);
      }
    },
    []
  );

  // Restore the scroll position to the cached active index once items are
  // ready, so re-entering the page lands on the same card the audio is on
  // (the scroller resets to top on mount otherwise).
  useEffect(() => {
    if (restoredScrollRef.current) return;
    if (items.length === 0) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    restoredScrollRef.current = true;
    if (activeIndex <= 0) return;
    const height = scroller.clientHeight || 1;
    scroller.scrollTop = activeIndex * height;
  }, [items.length, activeIndex]);

  const playNext = () => {
    if (items.length === 0) return;
    const nextIndex = (activeIndex + 1) % items.length;
    scrollToIndex(nextIndex);
    const next = items[nextIndex];
    if (next) void playSong(next, false);
  };

  const handlePrimaryPlay = () => {
    if (!activeSong) return;
    flashIcon();
    const audio = audioRef.current;
    if (
      currentSong &&
      musicSongKey(currentSong) === musicSongKey(activeSong) &&
      audioUrl
    ) {
      if (audio?.paused) {
        userStartedRef.current = true;
        void audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
      } else {
        audio?.pause();
      }
      return;
    }
    void playSong(activeSong, true);
  };

  const handleFavorite = (song: MusicSong) => {
    toggleFavorite(song);
    showToast(isFavorite(song) ? "已取消收藏" : "已收藏");
  };

  const handleQueue = (song: MusicSong) => {
    appendToQueue(song);
    showToast("已加入队列");
  };

  const handleShare = async (song: MusicSong) => {
    const text = `${song.title} - ${song.artist}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: song.title, text });
        return;
      } catch {
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast("已复制歌曲信息");
    } catch {
      showToast(text);
    }
  };

  const topBar = (
    <HomeTopBar
      mode={mode}
      setMode={setMode}
      onRefresh={reload}
      variant={isDesktop ? "desktop" : "immersive"}
    />
  );

  if (loading && items.length === 0) {
    return (
      <HomeShell isDesktop={isDesktop}>
        {topBar}
        <FeedLoading label="TUNING MUSIC..." />
      </HomeShell>
    );
  }

  if (enabledSources.length === 0) {
    return (
      <HomeShell isDesktop={isDesktop}>
        {topBar}
        <FeedEmptyState
          icon={<IconAlbum size={64} className="text-cream-faint mb-4" />}
          label="NO MUSIC SOURCE"
          title="还没有可用于推荐的音乐源"
          primaryLabel="刷新"
          onPrimary={reload}
          secondaryTo="/settings/music-hub"
          secondaryLabel="添加音乐源"
        />
      </HomeShell>
    );
  }

  if (error && items.length === 0) {
    return (
      <HomeShell isDesktop={isDesktop}>
        {topBar}
        <FeedError
          title="MUSIC SIGNAL LOST"
          message={error}
          actionLabel="刷新音乐"
          onRetry={reload}
        />
      </HomeShell>
    );
  }

  return (
    <HomeShell isDesktop={isDesktop} contentClassName="text-cream">
      {topBar}
      <audio
        ref={audioRef}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => {
          const nextTime = event.currentTarget.currentTime || 0;
          const nextDuration = event.currentTarget.duration || duration || 0;
          setCurrentTime(nextTime);
          if (currentSong) noteHistory(currentSong, nextTime, nextDuration);
        }}
        onPlaying={() => setIsPlaying(true)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={playNext}
      />

      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-y-auto snap-y snap-mandatory scrollbar-hide"
        onScroll={handleScroll}
      >
        {items.map((song, index) => {
          const cover = song.cover ? wrapImage(song.cover) : "";
          const active =
            !!currentSong && musicSongKey(currentSong) === musicSongKey(song);
          const playing = active && isPlaying;
          const progress =
            active && duration > 0
              ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
              : 0;
          return (
            <section
              key={`${musicSongKey(song)}:${index}`}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              className="relative h-full w-full snap-start overflow-hidden"
            >
              <div className="absolute inset-0 bg-[#050608]">
                {cover ? (
                  <img
                    src={cover}
                    alt=""
                    className="h-full w-full object-cover opacity-45"
                  />
                ) : (
                  <div className="h-full w-full bg-[linear-gradient(135deg,rgba(79,195,247,0.18),rgba(255,107,53,0.12))]" />
                )}
                <div className="absolute inset-0 backdrop-blur-2xl scale-110" />
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(0,0,0,0.50) 0%, rgba(0,0,0,0.18) 35%, rgba(0,0,0,0.78) 100%)",
                  }}
                />
              </div>

              <main className="absolute inset-0 flex items-center justify-center px-5">
                <div
                  className="relative z-10 grid place-items-center"
                  style={{ transform: `translateY(calc(-1 * ${MUSIC_CENTER_LIFT_CSS}))` }}
                >
                  <button
                    type="button"
                    onClick={handlePrimaryPlay}
                    className="relative grid place-items-center tap"
                    aria-label={playing ? "暂停" : "播放"}
                  >
                    <div
                      className="music-vinyl relative grid place-items-center rounded-full music-vinyl-spin"
                      style={{
                        width: "min(70vw, 340px)",
                        height: "min(70vw, 340px)",
                        // Keep the animation mounted at all times and only toggle
                        // its play state, so pausing freezes the disc in place
                        // instead of snapping the rotation back to 0deg.
                        animationPlayState: playing ? "running" : "paused",
                      }}
                    >
                      {/* Album art sits in the inner "label" of the record. */}
                      <span
                        className="relative grid place-items-center overflow-hidden rounded-full"
                        style={{
                          width: "62%",
                          height: "62%",
                          background: "#0c0d10",
                          boxShadow:
                            "0 0 0 6px rgba(5,6,8,0.9), 0 6px 22px -8px rgba(0,0,0,0.9)",
                        }}
                      >
                        {cover ? (
                          <img src={cover} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <IconAlbum size={68} className="text-cream-faint" />
                        )}
                        {/* Spindle hole in the centre of the label. */}
                        <span
                          className="absolute rounded-full"
                          style={{
                            width: 16,
                            height: 16,
                            background: "var(--ink)",
                            boxShadow:
                              "inset 0 0 0 2px rgba(0,0,0,0.85), 0 0 0 3px rgba(242,232,213,0.12)",
                          }}
                        />
                      </span>
                    </div>
                    <span
                      className="absolute left-1/2 top-1/2 z-20 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full backdrop-blur-md transition-opacity duration-200"
                      style={{
                        background: "rgba(14,15,17,0.58)",
                        border: "1px solid var(--cream-line)",
                        color: "var(--cream)",
                        // Hidden by default; only surfaces while resolving or for
                        // a brief flash after the user taps the active card.
                        opacity: active && (resolving || iconFlash) ? 1 : 0,
                      }}
                    >
                      {resolving && active ? (
                        <IconRefresh size={22} className="animate-spin" />
                      ) : playing ? (
                        <IconPause size={24} />
                      ) : (
                        <IconPlay size={24} />
                      )}
                    </span>
                  </button>
                </div>

                <MusicFeedActionRail
                  song={song}
                  favorite={isFavorite(song)}
                  desktop={isDesktop}
                  onFavorite={() => handleFavorite(song)}
                  onQueue={() => handleQueue(song)}
                  onShare={() => void handleShare(song)}
                  onDetail={() => navigate("/music")}
                />

                <MusicFeedCaption
                  song={song}
                  index={index}
                  desktop={isDesktop}
                  playing={playing}
                />

                {active && lyricLines.length > 0 && (
                  <MusicLyrics lines={lyricLines} activeIndex={activeLyricIndex} />
                )}

                <div
                  className="absolute left-0 right-0 z-20 px-5 sm:px-8"
                  style={{
                    bottom: isDesktop
                      ? 44
                      : "calc(var(--bottom-tab-h, 56px) + env(safe-area-inset-bottom) + 18px)",
                  }}
                >
                  <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/20">
                    <div
                      className="absolute left-0 top-0 h-full rounded-full"
                      style={{
                        width: `${progress}%`,
                        background: "var(--vhs)",
                        boxShadow: "0 0 12px rgba(79,195,247,0.9)",
                      }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between font-mono text-[10px] text-cream-faint">
                    <span>{active ? formatDuration(currentTime) : "0:00"}</span>
                    <span>{formatDuration(song.durationSec || duration)}</span>
                  </div>
                </div>
              </main>
            </section>
          );
        })}
      </div>

      {toast && (
        <div
          className="absolute left-1/2 top-1/2 z-40 px-5 py-2.5 backdrop-blur-md pointer-events-none animate-toast-in font-mono text-xs tracking-wider"
          style={{
            background: "rgba(14, 15, 17, 0.86)",
            border: "1px solid var(--cream-line)",
            borderRadius: 10,
            color: "var(--cream)",
          }}
        >
          <span className="rec-dot" style={{ marginRight: 8 }} />
          {toast}
        </div>
      )}
    </HomeShell>
  );
}

function MusicLyrics({
  lines,
  activeIndex,
}: {
  lines: LyricLine[];
  activeIndex: number;
}) {
  // Show the active line plus one above and one below. The neighbours fade out
  // and the whole window slides up by one line each time the active row moves,
  // so the lyrics track the audio without a scroll container.
  const cur = activeIndex < 0 ? 0 : activeIndex;
  const window = [cur - 1, cur, cur + 1];
  return (
    <div
      className="absolute left-1/2 z-20 -translate-x-1/2 w-[min(86vw,560px)] text-center pointer-events-none"
      style={{
        // Sit just below the vinyl, above the visualiser/progress block.
        top: `calc(40% + min(48vw, 264px) - ${MUSIC_CENTER_LIFT_CSS})`,
      }}
    >
      <div className="flex flex-col items-center gap-2 overflow-hidden">
        {window.map((lineIndex, slot) => {
          const line = lines[lineIndex];
          const isActive = slot === 1 && activeIndex >= 0;
          return (
            <p
              key={`${lineIndex}-${slot}`}
              className="line-clamp-2 font-display leading-snug transition-all duration-300 text-shadow"
              style={{
                fontSize: isActive ? "1.05rem" : "0.82rem",
                fontWeight: isActive ? 700 : 500,
                color: isActive ? "var(--cream)" : "var(--cream-dim)",
                opacity: line ? (isActive ? 1 : 0.4) : 0,
                textShadow: isActive
                  ? "0 0 16px rgba(79,195,247,0.5)"
                  : undefined,
              }}
            >
              {line?.text || " "}
            </p>
          );
        })}
      </div>
    </div>
  );
}

function MusicFeedCaption({
  song,
  index,
  desktop,
  playing,
}: {
  song: MusicSong;
  index: number;
  desktop: boolean;
  playing: boolean;
}) {
  return (
    <div
      className="absolute left-5 right-24 z-20 max-w-2xl"
      style={{
        bottom: desktop
          ? 118
          : "calc(var(--bottom-tab-h, 56px) + env(safe-area-inset-bottom) + 88px)",
        paddingLeft: desktop ? 0 : "env(safe-area-inset-left)",
      }}
    >
      <h1
        className="line-clamp-2 font-display text-2xl sm:text-3xl font-extrabold leading-tight text-shadow"
        style={{
          color: "var(--vhs)",
          textShadow: "0 0 14px rgba(79,195,247,0.72)",
        }}
      >
        {song.title}
      </h1>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span
          className="px-2 py-0.5 rounded text-[10px] font-mono font-bold"
          style={{ background: "var(--ember)", color: "var(--ink)" }}
        >
          {playing ? "PLAYING" : `REC ${String(index + 1).padStart(2, "0")}`}
        </span>
        <p className="text-sm text-cream text-shadow">@{song.artist || "未知歌手"}</p>
      </div>
      <p className="mt-2 line-clamp-2 text-xs text-cream-dim text-shadow">
        {song.album || song.sourceName} · {song.sourceName} · {song.durationText || formatDuration(song.durationSec)}
      </p>
      <div className="mt-2 overflow-hidden whitespace-nowrap opacity-75">
        <p className="music-marquee font-mono text-[10px] tracking-[0.12em] text-cream-dim">
          正在推荐：{song.title} - {song.artist} - 来源：{song.sourceName}
        </p>
      </div>
    </div>
  );
}

function MusicFeedActionRail({
  song,
  favorite,
  desktop,
  onFavorite,
  onQueue,
  onShare,
  onDetail,
}: {
  song: MusicSong;
  favorite: boolean;
  desktop: boolean;
  onFavorite: () => void;
  onQueue: () => void;
  onShare: () => void;
  onDetail: () => void;
}) {
  return (
    <div
      className="absolute right-4 sm:right-6 z-30 flex flex-col items-center gap-5"
      style={{
        bottom: desktop
          ? 118
          : "calc(var(--bottom-tab-h, 56px) + env(safe-area-inset-bottom) + 88px)",
        paddingRight: desktop ? 0 : "env(safe-area-inset-right)",
      }}
    >
      <MusicRailButton
        icon={favorite ? <IconHeartFill size={21} /> : <IconHeart size={21} />}
        label={favorite ? "已收藏" : "收藏"}
        active={favorite}
        onClick={onFavorite}
      />
      <MusicRailButton
        icon={<IconQueue size={21} />}
        label="队列"
        tone="vhs"
        onClick={onQueue}
      />
      <MusicRailButton icon={<IconShare size={20} />} label="分享" onClick={onShare} />
      <MusicRailButton icon={<IconMore size={20} />} label="详情" onClick={onDetail} />
      <span className="sr-only">{song.title}</span>
    </div>
  );
}

function MusicRailButton({
  icon,
  label,
  tone,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  tone?: "ember" | "vhs";
  active?: boolean;
  onClick: () => void;
}) {
  const color =
    active || tone === "ember"
      ? "var(--ember)"
      : tone === "vhs"
        ? "var(--vhs)"
        : "var(--cream)";
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="flex flex-col items-center gap-1 text-cream tap"
    >
      <span
        className="w-11 h-11 sm:w-12 sm:h-12 rounded-full grid place-items-center"
        style={{
          background: "rgba(242,232,213,0.08)",
          border: "1px solid var(--cream-line)",
          color,
          backdropFilter: "blur(16px)",
        }}
      >
        {icon}
      </span>
      <span className="font-mono text-[10px] text-cream-dim text-shadow">{label}</span>
    </button>
  );
}

function HomeShell({
  isDesktop,
  contentClassName = "",
  children,
}: {
  isDesktop: boolean;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  if (!isDesktop) {
    return (
      <div
        className={`relative h-screen w-full overflow-hidden bg-ink ${contentClassName}`}
      >
        {children}
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden bg-ink">
      <main
        className={`relative h-full min-h-0 overflow-hidden rounded-lg bg-black ${contentClassName}`}
        style={{
          border: "1px solid var(--cream-line)",
          boxShadow: "0 24px 70px -48px rgba(0,0,0,0.95)",
        }}
      >
        {children}
      </main>
    </div>
  );
}

function FeedEmptyState({
  icon,
  label,
  title,
  detail,
  primaryLabel,
  onPrimary,
  secondaryTo,
  secondaryLabel,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  detail?: React.ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryTo?: string;
  secondaryLabel?: string;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-ink text-cream-dim p-6 text-center">
      {icon}
      <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint mb-2">
        {label}
      </p>
      <p className="mb-2 text-sm text-cream-dim">{title}</p>
      {detail && <p className="text-xs text-cream-faint mb-6">{detail}</p>}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onPrimary}
          className="px-5 py-2.5 rounded-full text-xs tap text-cream"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
        >
          <IconRefresh size={14} className="inline mr-1.5 -mt-0.5" />
          {primaryLabel}
        </button>
        {secondaryTo && secondaryLabel && (
          <Link
            to={secondaryTo}
            className="px-5 py-2.5 rounded-full text-xs font-display font-semibold tap glow-ember"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            {secondaryLabel}
          </Link>
        )}
      </div>
    </div>
  );
}

function HomeTopBar({
  mode,
  setMode,
  onRefresh,
  activeItem,
  videoActions,
  variant = "immersive",
}: {
  mode: FeedMode;
  setMode: (mode: FeedMode) => void;
  onRefresh?: () => void;
  activeItem?: MediaItem;
  videoActions?: React.ReactNode;
  variant?: "immersive" | "desktop";
}) {
  return (
    <div
      className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-4 pb-2 pointer-events-none"
      style={{
        paddingTop:
          variant === "desktop" ? 12 : "calc(env(safe-area-inset-top) + 12px)",
        paddingLeft:
          variant === "desktop" ? 16 : "calc(env(safe-area-inset-left) + 16px)",
        paddingRight:
          variant === "desktop" ? 16 : "calc(env(safe-area-inset-right) + 16px)",
      }}
    >
      <div className="pointer-events-auto flex items-center gap-2.5 min-w-0">
        <span className="rec-dot" />
        <span className="hidden sm:inline font-display font-extrabold text-sm tracking-tight text-cream text-shadow">
          DOUY<span style={{ color: "var(--ember)" }}>TV</span>
        </span>
        <span className="hidden sm:inline font-mono text-[10px] tracking-[0.2em] text-cream-dim text-shadow">
          /{" "}
          {mode === "live"
            ? "LIVE RECS"
            : mode === "music"
              ? "MUSIC RECS"
              : "VIDEO FEED"}
        </span>
      </div>
      <nav
        className="absolute left-1/2 top-0 -translate-x-1/2 flex items-center gap-6 pointer-events-auto"
        style={{
          paddingTop:
            variant === "desktop" ? 16 : "calc(env(safe-area-inset-top) + 16px)",
        }}
        aria-label="首页推荐类型"
      >
        <FeedModeButton active={mode === "video"} onClick={() => setMode("video")}>
          视频
        </FeedModeButton>
        <FeedModeButton active={mode === "live"} onClick={() => setMode("live")}>
          直播
        </FeedModeButton>
        <FeedModeButton active={mode === "music"} onClick={() => setMode("music")}>
          音乐
        </FeedModeButton>
      </nav>
      <div className="flex gap-2 pointer-events-auto">
        {videoActions}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="w-9 h-9 rounded-full flex items-center justify-center tap text-cream backdrop-blur-md transition-colors"
            style={{
              background: "rgba(14,15,17,0.55)",
              border: "1px solid var(--cream-line)",
            }}
            aria-label="刷新"
            title={activeItem ? `刷新 ${activeItem.title}` : "刷新"}
          >
            <IconRefresh size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function FeedModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative h-7 px-0.5 text-sm font-display tap text-shadow transition-colors"
      style={{
        background: "transparent",
        color: active ? "var(--cream)" : "var(--cream-dim)",
        fontWeight: active ? 800 : 500,
      }}
    >
      {children}
      {active && (
        <span
          className="absolute left-1/2 -translate-x-1/2 rounded-full"
          style={{
            bottom: -2,
            width: 18,
            height: 2,
            background: "var(--ember)",
            boxShadow: "0 0 10px var(--ember-glow)",
          }}
        />
      )}
    </button>
  );
}

function FeedShade() {
  return (
    <div
      className="absolute inset-0 pointer-events-none z-10"
      style={{
        background:
          "linear-gradient(180deg, rgba(0,0,0,0.42) 0%, transparent 28%, transparent 52%, rgba(0,0,0,0.72) 100%)",
      }}
    />
  );
}

function FeedCaption({
  item,
  index,
  desktop = false,
}: {
  item: MediaItem;
  index: number;
  desktop?: boolean;
}) {
  return (
    <div
      className="absolute left-4 right-24 text-cream pointer-events-none z-10"
      style={{
        bottom: desktop
          ? 86
          : "calc(var(--bottom-tab-h, 56px) + env(safe-area-inset-bottom) + 36px)",
        paddingLeft: desktop ? 0 : "env(safe-area-inset-left)",
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="px-2 py-0.5 rounded font-mono text-[10px] font-bold text-shadow"
          style={{
            background: "rgba(255,107,53,0.16)",
            color: "var(--ember)",
            border: "1px solid rgba(255,107,53,0.32)",
          }}
        >
          CH {String(index + 1).padStart(2, "0")}
        </span>
        {item.sourceName && (
          <span className="font-mono text-[10px] text-cream-dim text-shadow line-clamp-1">
            {item.sourceName}
          </span>
        )}
      </div>
      <h2 className="text-base font-display font-bold text-cream leading-relaxed text-shadow line-clamp-2 max-w-xl">
        {item.title}
      </h2>
      {item.description && item.description !== item.title && (
        <p className="text-xs text-cream-dim text-shadow mt-1 line-clamp-2 leading-relaxed max-w-xl">
          {item.description}
        </p>
      )}
      <div className="flex items-center gap-2 mt-2 text-cream-dim">
        <IconAlbum size={14} />
        <span className="font-mono text-[10px] tracking-[0.12em] animate-pulse">
          原声 - {item.typeName || item.remarks || `CH ${String(index + 1).padStart(2, "0")}`}
        </span>
      </div>
      {item.remarks && (
        <span
          className="inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-mono tracking-wider"
          style={{
            background: "rgba(242,232,213,0.08)",
            color: "var(--cream-dim)",
            border: "1px solid var(--cream-line)",
          }}
        >
          {item.remarks}
        </span>
      )}
    </div>
  );
}

function LiveCaption({
  item,
  index,
  desktop = false,
  onOpenDetail,
}: {
  item: MediaItem;
  index: number;
  desktop?: boolean;
  onOpenDetail?: (item: MediaItem) => void;
}) {
  const hasRoomDetail = !!item.netlivePlatform && !!item.netliveRoomId;
  const sourceLabel = formatLiveSource(item);

  return (
    <>
      <div
        className="absolute left-4 right-24 text-cream pointer-events-none z-10"
        style={{
          bottom: desktop
            ? 82
            : "calc(var(--bottom-tab-h, 56px) + env(safe-area-inset-bottom) + 38px)",
          paddingLeft: desktop ? 0 : "env(safe-area-inset-left)",
        }}
      >
        <button
          type="button"
          disabled={!hasRoomDetail || !onOpenDetail}
          onPointerDownCapture={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOpenDetail?.(item);
          }}
          className="pointer-events-auto block text-left tap disabled:cursor-default"
          aria-label={hasRoomDetail ? `进入${item.title}` : item.title}
        >
          <div className="flex items-center gap-2.5 mb-2">
            <FeedAvatar label={item.author || sourceLabel || item.title} live />
            <div className="min-w-0">
              <p className="font-display text-lg font-bold line-clamp-1 text-shadow text-cream">
                {item.author || item.title || "LIVE"}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full font-mono text-[10px] font-bold"
                  style={{ background: "rgba(255,107,53,0.84)", color: "var(--ink)" }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-ink animate-pulse" />
                  直播中
                </span>
                <span
                  className="px-2 py-0.5 rounded-full font-mono text-[10px] text-cream-dim"
                  style={{
                    background: "rgba(14,15,17,0.44)",
                    border: "1px solid var(--cream-line)",
                  }}
                >
                  来自 {sourceLabel}
                </span>
              </div>
            </div>
          </div>
          <h2 className="text-base font-display font-bold text-shadow line-clamp-2 max-w-xl text-cream">
            {item.title}
          </h2>
          {item.description && item.description !== item.title && (
            <p className="text-xs text-cream-dim text-shadow mt-1 line-clamp-2 leading-relaxed max-w-xl">
              {item.description}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className="px-2 py-1 rounded text-[11px] font-mono backdrop-blur-md text-cream-dim"
              style={{
                background: "rgba(14,15,17,0.42)",
                border: "1px solid var(--cream-line)",
              }}
            >
              {formatLiveViewers(index)} 观看
            </span>
            <span
              className="px-2 py-1 rounded text-[11px] font-mono backdrop-blur-md text-cream-dim"
              style={{
                background: "rgba(14,15,17,0.42)",
                border: "1px solid var(--cream-line)",
              }}
            >
              # {item.typeName || item.remarks || "直播推荐"}
            </span>
            {hasRoomDetail && (
              <span
                className="px-2 py-1 rounded text-[11px] font-mono backdrop-blur-md"
                style={{
                  background: "rgba(255,107,53,0.16)",
                  border: "1px solid rgba(255,107,53,0.34)",
                  color: "var(--ember)",
                }}
              >
                进入直播间
              </span>
            )}
          </div>
        </button>
      </div>
      <div
        className="absolute left-1/2 -translate-x-1/2 z-20 flex flex-col items-center pointer-events-none opacity-45 animate-drag-hint"
        style={{
          bottom: desktop
            ? 30
            : "calc(var(--bottom-tab-h, 56px) + env(safe-area-inset-bottom) + 8px)",
        }}
      >
        <span className="text-lg text-cream">⌃</span>
        <span className="font-mono text-[10px] text-cream-faint">下滑查看更多</span>
      </div>
    </>
  );
}

function FeedAvatar({ label, live = false }: { label?: string; live?: boolean }) {
  const initial = (label || "D").trim().slice(0, 1).toUpperCase();
  return (
    <span
      className="relative w-10 h-10 rounded-full grid place-items-center shrink-0 font-display font-extrabold text-sm"
      style={{
        background: live
          ? "linear-gradient(135deg, var(--ember), var(--vhs))"
          : "linear-gradient(135deg, var(--vhs), var(--phosphor))",
        color: "var(--ink)",
        border: live ? "2px solid var(--ember)" : "2px solid var(--vhs)",
        boxShadow: live
          ? "0 0 18px rgba(255,107,53,0.42)"
          : "0 0 18px rgba(79,195,247,0.38)",
      }}
    >
      {initial}
      {live && (
        <span
          className="absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full"
          style={{ background: "var(--ember)", border: "2px solid var(--ink)" }}
        />
      )}
    </span>
  );
}

function LiveActionRail({ item, desktop }: { item: MediaItem; desktop?: boolean }) {
  const [liked, setLiked] = useState(() => loadLiked(item.id));
  const [toast, setToast] = useState<string | undefined>();
  const toggleNetLiveFavorite = useNetLiveStore((s) => s.toggleFavorite);
  const isNetLiveFavorite = useNetLiveStore((s) => s.isFavorite);
  const isMediaFavorite = useLibraryStore((s) => s.isFavorite(item.id));
  const toggleMediaFavorite = useLibraryStore((s) => s.toggleFavorite);
  const room = mediaItemToNetLiveRoom(item);
  const isFavorite = room
    ? isNetLiveFavorite(room.platform, room.roomId)
    : isMediaFavorite;

  useEffect(() => {
    setLiked(loadLiked(item.id));
  }, [item.id]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(undefined), 1300);
  };

  const handleLike = () => {
    const next = !liked;
    setLiked(next);
    saveLiked(item.id, next);
    showToast(next ? "已点赞" : "已取消点赞");
  };

  const handleFavorite = () => {
    if (room) toggleNetLiveFavorite(room);
    else toggleMediaFavorite(item);
    showToast(isFavorite ? "已取消收藏" : "已收藏");
  };

  const handleShare = async () => {
    const shareUrl = liveShareUrl(item);
    const shareData = {
      title: item.title,
      text: item.description ?? "",
      url: shareUrl,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast("已复制链接");
    } catch {
      showToast(shareUrl);
    }
  };

  return (
    <>
      <div
        className="absolute right-4 z-30 flex flex-col items-center gap-4 pointer-events-auto"
        style={{
          bottom: desktop
            ? 106
            : "calc(var(--bottom-tab-h, 56px) + env(safe-area-inset-bottom) + 92px)",
          paddingRight: desktop ? 0 : "env(safe-area-inset-right)",
        }}
        onPointerDownCapture={(e) => e.stopPropagation()}
      >
        <FeedActionButton
          icon={liked ? <IconHeartFill size={22} /> : <IconHeart size={22} />}
          label={liked ? "已赞" : "点赞"}
          active={liked}
          tone="ember"
          onClick={handleLike}
        />
        <FeedActionButton
          icon={
            isFavorite ? <IconBookmarkFill size={21} /> : <IconBookmark size={21} />
          }
          label={isFavorite ? "已收藏" : "收藏"}
          active={isFavorite}
          onClick={handleFavorite}
        />
        <FeedActionButton
          icon={<IconShare size={20} />}
          label="分享"
          onClick={() => void handleShare()}
        />
      </div>
      {toast && (
        <div
          className="absolute left-1/2 top-1/2 z-30 px-5 py-2.5 backdrop-blur-md pointer-events-none animate-toast-in font-mono text-xs tracking-wider"
          style={{
            background: "rgba(14, 15, 17, 0.86)",
            border: "1px solid var(--cream-line)",
            borderRadius: 10,
            color: "var(--cream)",
            boxShadow:
              "0 0 0 1px rgba(255,107,53,0.18), 0 12px 32px -8px rgba(0,0,0,0.6)",
          }}
        >
          <span className="rec-dot" style={{ marginRight: 8 }} />
          {toast}
        </div>
      )}
    </>
  );
}

function FeedActionButton({
  icon,
  label,
  tone,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  tone?: "ember" | "vhs";
  active?: boolean;
  onClick?: () => void;
}) {
  const color =
    active || tone === "ember"
      ? "var(--ember)"
      : tone === "vhs"
        ? "var(--vhs)"
        : "var(--cream)";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className={`feed-action-button group flex flex-col items-center gap-1 select-none ${
        active ? "feed-action-button-active" : ""
      }`}
      style={{ color }}
    >
      <span
        className="feed-action-icon w-12 h-12 rounded-full grid place-items-center backdrop-blur-md"
      >
        {icon}
      </span>
      <span className="font-mono text-[10px] text-cream text-shadow">{label}</span>
    </button>
  );
}

function formatLiveViewers(index: number) {
  const count = 3.6 + ((index * 7) % 23) / 10;
  return `${count.toFixed(1)}万`;
}

const FALLBACK_PLATFORM_LABELS: Record<string, string> = {
  bilibili: "哔哩哔哩",
  douyu: "斗鱼",
  huya: "虎牙",
  douyin: "抖音",
  kuaishou: "快手",
  cc: "网易 CC",
  twitch: "Twitch",
  youtube: "YouTube",
  kick: "Kick",
  trovo: "Trovo",
  bigo: "Bigo Live",
  live17: "17 Live",
  chaturbate: "Chaturbate",
  stripchat: "Stripchat",
  bongacams: "BongaCams",
  camsoda: "CamSoda",
};

function formatPlatformLabel(platform?: string): string {
  if (!platform) return "IPTV";
  return (
    NETLIVE_PLATFORMS.find((meta) => meta.id === platform)?.label ??
    FALLBACK_PLATFORM_LABELS[platform] ??
    platform
  );
}

function formatLiveSource(item: MediaItem): string {
  if (item.netlivePlatform) return formatPlatformLabel(item.netlivePlatform);
  return item.sourceName ? `IPTV / ${item.sourceName}` : "IPTV";
}

function mediaItemToNetLiveRoom(item: MediaItem): NetLiveRoom | null {
  if (!item.netlivePlatform || !item.netliveRoomId) return null;
  return {
    platform: item.netlivePlatform,
    roomId: item.netliveRoomId,
    title: item.title,
    uname: item.author,
    avatar: item.poster,
    cover: item.poster,
    category: item.typeName || item.remarks,
    introduction: item.description,
    live: true,
  };
}

function liveShareUrl(item: MediaItem): string {
  if (item.netlivePlatform && item.netliveRoomId) {
    return `${window.location.origin}/live/room/${encodeURIComponent(item.netlivePlatform)}/${encodeURIComponent(item.netliveRoomId)}`;
  }
  return item.url || window.location.href;
}

function likeKey(itemId: string): string {
  return `douytv:liked:${itemId}`;
}

function loadLiked(itemId: string): boolean {
  try {
    return localStorage.getItem(likeKey(itemId)) === "1";
  } catch {
    return false;
  }
}

function saveLiked(itemId: string, liked: boolean) {
  try {
    if (liked) localStorage.setItem(likeKey(itemId), "1");
    else localStorage.removeItem(likeKey(itemId));
  } catch {
    /* ignore */
  }
}

function FeedLoading({ label }: { label: string }) {
  return (
    <div
      className="absolute inset-x-0 bottom-0 flex items-center justify-center text-cream-dim"
      style={{
        top: "64px",
      }}
    >
      <div
        className="px-6 py-5 rounded-lg flex flex-col items-center"
        style={{
          background: "rgba(14,15,17,0.62)",
          border: "1px solid var(--cream-line)",
          backdropFilter: "blur(10px)",
        }}
      >
        <div className="signal-bars" style={{ height: 24 }}>
          <span />
          <span />
          <span />
        </div>
        <p className="mt-5 text-xs font-mono tracking-[0.25em] text-cream-faint">
          {label}
        </p>
      </div>
    </div>
  );
}

function FeedError({
  title,
  message,
  actionLabel,
  onRetry,
}: {
  title: string;
  message: string;
  actionLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-ink text-cream-dim p-6">
      <IconStatic size={56} className="text-cream-faint mb-4" />
      <p className="font-mono text-[10px] tracking-[0.2em] text-ember mb-2">
        {title}
      </p>
      <p className="text-sm text-cream-dim mb-6 text-center">{message}</p>
      <button
        onClick={onRetry}
        className="px-5 py-2.5 rounded-full text-xs font-display font-semibold tracking-wider tap glow-ember"
        style={{ background: "var(--ember)", color: "var(--ink)" }}
      >
        {actionLabel}
      </button>
    </div>
  );
}
