import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { appAlert, appConfirm } from "@/components/AppDialog";
import {
  IconArtist,
  IconClose,
  IconSearch,
  IconSettings,
} from "@/components/Icon";
import {
  getAllMusicSonglistTags,
  getAllMusicSonglists,
  getMusicBoardSongs,
  getMusicBoards,
  getMusicHotSearch,
  getMusicSonglistDetail,
  getNeteaseAlbum,
  getNeteaseArtist,
  getNeteaseArtistAlbums,
  getNeteaseHotSearch,
  getNeteaseMvUrl,
  getNeteaseNewSongRecommend,
  getNeteasePlaylistSongs,
  getNeteaseRadioPrograms,
  getNeteaseSimiSongs,
  importMusicSourceFromText,
  isNeteaseAntiBotError,
  parseNeteasePlaylistInput,
  resolveNeteaseArtistId,
  isMusicPreviewError,
  musicSongKey,
  normalizeMusicPlatform,
  normalizeMusicSourceDescriptor,
  resolveMusicSource,
  resolveMusicSourceWithFallback,
  prefetchMusicSource,
  takePrefetchedSource,
  searchMusicSource,
  searchMusicSources,
  waitForUsableMusicAudio,
  type MusicDiscoveryBoard,
  type MusicHotSearchItem,
  type MusicPlayMode,
  type MusicQuality,
  type MusicSong,
  type MusicSongListSummary,
  type MusicSongListTag,
  type MusicSourceDescriptor,
  type NeteaseMv,
} from "@/lib/music";
import { wrapImage, isTauri } from "@/lib/proxy";
import { getCoverColor } from "@/lib/music/coverColor";
import { useMusicDownloadStore } from "@/stores/musicDownload";
import { useMusicStore } from "@/stores/music";
import { type DrawerView, type LibraryTab, type MusicView, type ChartCard } from "./music/types";
import {
  dedupeSearchSongs,
  dedupeSongs,
  deriveView,
  mergeSongCandidates,
  mostCommonArtist,
  musicSearchKey,
  normalizeSongText,
} from "./music/utils";
import { parseLyric } from "./music/lyric/parse";
import {
  applyEqGains,
  ensureAudioGraph,
  resumeAudioGraph,
} from "@/lib/music/audioGraph";
import {
  openDesktopLyric,
  closeDesktopLyric,
  isDesktopLyricOpen,
  pushDesktopLyricLine,
  pushDesktopLyricTime,
} from "./music/desktopLyricBridge";
import { EmptyMusicState } from "./music/components/ui";
import { MusicSidebar } from "./music/components/MusicSidebar";
import { PlayerBar } from "./music/components/PlayerBar";
import { MusicDrawer } from "./music/components/MusicDrawer";
import { SourceDialog } from "./music/components/SourceDialog";
import { MvModal } from "./music/components/MvModal";
import { ImportPlaylistDialog } from "./music/components/ImportPlaylistDialog";
import { AddToPlaylistDialog } from "./music/components/AddToPlaylistDialog";
import { DiscoverView } from "./music/views/DiscoverView";
import { ToplistView } from "./music/views/ToplistView";
import { RecommendView } from "./music/views/RecommendView";
import { RecentView, MvView, RadioView, ArtistsView } from "./music/views/BrowseViews";
import { StatsView } from "./music/views/StatsView";
import { LocalView } from "./music/views/shared";
import { SonglistsView } from "./music/views/SonglistsView";
import { SearchView } from "./music/views/SearchView";
import { LibraryView } from "./music/views/LibraryView";
import { SourcesView } from "./music/views/SourcesView";
import { SonglistView } from "./music/views/SonglistView";
import { AlbumView } from "./music/views/AlbumView";
import { ArtistView } from "./music/views/ArtistView";
import { PlayerView } from "./music/views/PlayerView";

export default function Music() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const muteRestoreRef = useRef(0.8);
  const playRequestRef = useRef(0);
  const lastHistorySaveRef = useRef(0);
  const pendingAutoPlayRef = useRef(false);
  const searchCandidatesRef = useRef<Map<string, MusicSong[]>>(new Map());
  // 「全平台试听则自动下一首」相关：避免整队列都是试听时无限跳转
  const playByQueueOffsetRef = useRef<((offset: number) => Promise<void>) | null>(null);
  const previewSkipChainRef = useRef(0);
  const queueRef = useRef<MusicSong[]>([]);
  const location = useLocation();
  const navigate = useNavigate();
  const view = deriveView(location.pathname);
  const setView = useCallback(
    (next: MusicView) => {
      navigate(next === "discover" ? "/music" : `/music/${next}`);
    },
    [navigate]
  );
  const songlistParams = useMemo(() => {
    const match = location.pathname.match(
      /^\/music\/songlist\/([^/]+)\/([^/]+)/
    );
    return match
      ? {
          source: decodeURIComponent(match[1]),
          id: decodeURIComponent(match[2]),
        }
      : null;
  }, [location.pathname]);
  const albumParams = useMemo(() => {
    const match = location.pathname.match(/^\/music\/album\/([^/]+)/);
    if (!match) return null;
    const query = new URLSearchParams(location.search);
    const artist = query.get("artist") || "";
    // 真专辑 id（来自歌手页/搜索的真接口）；无 id 的旧入口走文本派生回退。
    const id = query.get("id") || "";
    return { name: decodeURIComponent(match[1]), artist, id };
  }, [location.pathname, location.search]);
  const artistParams = useMemo(() => {
    const match = location.pathname.match(/^\/music\/artist\/([^/]+)/);
    if (!match) return null;
    // 真歌手 id（来自歌手广场/搜索/专辑的真接口）；无 id 的旧入口走搜索派生回退。
    const id = new URLSearchParams(location.search).get("id") || "";
    return { name: decodeURIComponent(match[1]), id };
  }, [location.pathname, location.search]);
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("favorites");
  const [drawer, setDrawer] = useState<DrawerView>(null);
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<MusicSong[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [desktopLyricOn, setDesktopLyricOn] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [recommendedKeywords, setRecommendedKeywords] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [boardLoading, setBoardLoading] = useState(false);
  const [songlistLoading, setSonglistLoading] = useState(false);
  const [error, setError] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [lyricText, setLyricText] = useState("");
  const [tlyricText, setTlyricText] = useState("");
  const [yrcText, setYrcText] = useState("");
  const [romaText, setRomaText] = useState("");
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [lxBaseUrl, setLxBaseUrl] = useState("http://35.208.239.12:9527/");
  const [lxToken, setLxToken] = useState("");
  const [neteaseBaseUrl, setNeteaseBaseUrl] = useState("");
  const [cyreneBaseUrl, setCyreneBaseUrl] = useState("https://music.nekofun.top");
  const [cyreneMode, setCyreneMode] = useState<"omni" | "tunehub" | "lx">("omni");
  const [mvPlay, setMvPlay] = useState<{ url: string; title: string } | null>(null);
  const [neteaseRecommend, setNeteaseRecommend] = useState<MusicSong[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [boards, setBoards] = useState<MusicDiscoveryBoard[]>([]);
  const [selectedBoard, setSelectedBoard] = useState<MusicDiscoveryBoard | null>(null);
  const [boardSongs, setBoardSongs] = useState<MusicSong[]>([]);
  const [chartCards, setChartCards] = useState<ChartCard[]>([]);
  const [hotSearch, setHotSearch] = useState<MusicHotSearchItem[]>([]);
  const [songlists, setSonglists] = useState<MusicSongListSummary[]>([]);
  const [songTags, setSongTags] = useState<MusicSongListTag[]>([]);
  const [songSorts, setSongSorts] = useState<MusicSongListTag[]>([]);
  const [selectedTag, setSelectedTag] = useState("");
  const [selectedSort, setSelectedSort] = useState("hot");
  const [songlistKeyword, setSonglistKeyword] = useState("");
  const [songlistSearchResults, setSonglistSearchResults] = useState<
    MusicSongListSummary[] | null
  >(null);
  const [songlistSearching, setSonglistSearching] = useState(false);
  const [openedSonglist, setOpenedSonglist] = useState<MusicSongListSummary | null>(null);
  const [songlistDetailSongs, setSonglistDetailSongs] = useState<MusicSong[]>([]);
  const [songlistDetailLoading, setSonglistDetailLoading] = useState(false);
  const [relatedWorks, setRelatedWorks] = useState<MusicSong[]>([]);
  const [relatedArtist, setRelatedArtist] = useState("");
  const [albumSongs, setAlbumSongs] = useState<MusicSong[]>([]);
  const [albumLoading, setAlbumLoading] = useState(false);
  const [albumArtistWorks, setAlbumArtistWorks] = useState<MusicSong[]>([]);
  const [albumArtist, setAlbumArtist] = useState("");
  const [artistSongs, setArtistSongs] = useState<MusicSong[]>([]);
  const [artistAlbums, setArtistAlbums] = useState<
    Array<{ id?: string; name: string; cover?: string }>
  >([]);
  const [artistSimilar, setArtistSimilar] = useState<
    Array<{ name: string; cover?: string; count: number; song: MusicSong }>
  >([]);
  const [artistMeta, setArtistMeta] = useState<{
    cover?: string;
    briefDesc?: string;
    musicSize?: number;
    albumSize?: number;
  } | null>(null);
  // 内置/无外部网易源时富接口受 -462 限制，页面降级为派生数据 + 提示。
  const [artistRestricted, setArtistRestricted] = useState(false);
  const [albumRestricted, setAlbumRestricted] = useState(false);
  const [albumMeta, setAlbumMeta] = useState<{
    cover?: string;
    desc?: string;
    publishTime?: number;
  } | null>(null);
  const [artistLoading, setArtistLoading] = useState(false);
  const [addToPlaylistSong, setAddToPlaylistSong] = useState<MusicSong | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [sleepRemaining, setSleepRemaining] = useState(0);
  const [coverColor, setCoverColor] = useState<{ accent: string; deep: string } | null>(null);

  const hydrate = useMusicStore((state) => state.hydrate);
  const sources = useMusicStore((state) => state.sources);
  const activeSourceId = useMusicStore((state) => state.activeSourceId);
  const setActiveSource = useMusicStore((state) => state.setActiveSource);
  const quality = useMusicStore((state) => state.quality);
  const setQuality = useMusicStore((state) => state.setQuality);
  const playMode = useMusicStore((state) => state.playMode);
  const setPlayMode = useMusicStore((state) => state.setPlayMode);
  const volume = useMusicStore((state) => state.volume);
  const setVolume = useMusicStore((state) => state.setVolume);
  const proxyEnabled = useMusicStore((state) => state.proxyEnabled);
  const setProxyEnabled = useMusicStore((state) => state.setProxyEnabled);
  const showSpectrum = useMusicStore((state) => state.showSpectrum);
  const setShowSpectrum = useMusicStore((state) => state.setShowSpectrum);
  const eqEnabled = useMusicStore((state) => state.eqEnabled);
  const setEqEnabled = useMusicStore((state) => state.setEqEnabled);
  const eqPreset = useMusicStore((state) => state.eqPreset);
  const setEqPreset = useMusicStore((state) => state.setEqPreset);
  const eqGains = useMusicStore((state) => state.eqGains);
  const setEqGain = useMusicStore((state) => state.setEqGain);
  const lyricShowTrans = useMusicStore((state) => state.lyricShowTrans);
  const setLyricShowTrans = useMusicStore((state) => state.setLyricShowTrans);
  const lyricShowRoma = useMusicStore((state) => state.lyricShowRoma);
  const setLyricShowRoma = useMusicStore((state) => state.setLyricShowRoma);
  const lyricFontScale = useMusicStore((state) => state.lyricFontScale);
  const setLyricFontScale = useMusicStore((state) => state.setLyricFontScale);
  const lyricOffsets = useMusicStore((state) => state.lyricOffsets);
  const setLyricOffset = useMusicStore((state) => state.setLyricOffset);
  const sleepTimerEndAt = useMusicStore((state) => state.sleepTimerEndAt);
  const setSleepTimerEndAt = useMusicStore((state) => state.setSleepTimerEndAt);
  const sleepAfterCurrent = useMusicStore((state) => state.sleepAfterCurrent);
  const setSleepAfterCurrent = useMusicStore((state) => state.setSleepAfterCurrent);
  const playbackRate = useMusicStore((state) => state.playbackRate);
  const setPlaybackRate = useMusicStore((state) => state.setPlaybackRate);
  const queue = useMusicStore((state) => state.queue);
  const setQueue = useMusicStore((state) => state.setQueue);
  const appendToQueue = useMusicStore((state) => state.appendToQueue);
  const removeFromQueue = useMusicStore((state) => state.removeFromQueue);
  const clearQueue = useMusicStore((state) => state.clearQueue);
  const currentSong = useMusicStore((state) => state.currentSong);
  const setCurrentSong = useMusicStore((state) => state.setCurrentSong);
  const favorites = useMusicStore((state) => state.favorites);
  const history = useMusicStore((state) => state.history);
  const playlists = useMusicStore((state) => state.playlists);
  const installSource = useMusicStore((state) => state.installSource);
  const uninstallSource = useMusicStore((state) => state.uninstallSource);
  const toggleSource = useMusicStore((state) => state.toggleSource);
  const updateSource = useMusicStore((state) => state.updateSource);
  const isFavorite = useMusicStore((state) => state.isFavorite);
  const toggleFavorite = useMusicStore((state) => state.toggleFavorite);
  const noteHistory = useMusicStore((state) => state.noteHistory);
  const clearHistory = useMusicStore((state) => state.clearHistory);
  const createPlaylist = useMusicStore((state) => state.createPlaylist);
  const updatePlaylist = useMusicStore((state) => state.updatePlaylist);
  const deletePlaylist = useMusicStore((state) => state.deletePlaylist);
  const addToPlaylist = useMusicStore((state) => state.addToPlaylist);
  const removeFromPlaylist = useMusicStore((state) => state.removeFromPlaylist);
  const clearPlaylist = useMusicStore((state) => state.clearPlaylist);
  const hydrateDownloads = useMusicDownloadStore((state) => state.hydrate);
  const enqueueDownload = useMusicDownloadStore((state) => state.enqueue);
  const downloadItems = useMusicDownloadStore((state) => state.items);
  const removeDownload = useMusicDownloadStore((state) => state.remove);
  const clearDownloads = useMusicDownloadStore((state) => state.clearFinished);

  useEffect(() => {
    hydrate();
    hydrateDownloads();
    // Load recent searches from localStorage
    const saved = localStorage.getItem("douytv:music-recent-searches");
    if (saved) {
      try {
        setRecentSearches(JSON.parse(saved));
      } catch {
        // ignore
      }
    }
  }, [hydrate]);

  const saveRecentSearch = useCallback((query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setRecentSearches((prev) => {
      const updated = [trimmed, ...prev.filter((item) => item !== trimmed)].slice(0, 10);
      localStorage.setItem("douytv:music-recent-searches", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    localStorage.removeItem("douytv:music-recent-searches");
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // 倍速(对齐 SPlayer setRate):playbackRate + preservesPitch 保持音高;切歌后也要复用。
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = playbackRate;
    audio.preservesPitch = true;
  }, [playbackRate, audioUrl]);

  // 均衡器实时同步：启用时套当前增益，关闭时归零（不拆图，置零等效旁路）。
  useEffect(() => {
    applyEqGains(eqEnabled ? eqGains : eqGains.map(() => 0));
  }, [eqEnabled, eqGains]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl || !pendingAutoPlayRef.current) return;
    let disposed = false;
    const tryPlay = () => {
      if (disposed || !pendingAutoPlayRef.current) return;
      void audio
        .play()
        .then(() => {
          pendingAutoPlayRef.current = false;
          setIsPlaying(true);
        })
        .catch(() => {
          setIsPlaying(false);
        });
    };
    tryPlay();
    audio.addEventListener("canplay", tryPlay);
    audio.addEventListener("canplaythrough", tryPlay);
    return () => {
      disposed = true;
      audio.removeEventListener("canplay", tryPlay);
      audio.removeEventListener("canplaythrough", tryPlay);
    };
  }, [audioUrl, currentSong]);

  const enabledSources = useMemo(
    () => sources.filter((source) => source.enabled),
    [sources]
  );

  const activeSource = useMemo(
    () => sources.find((source) => source.id === activeSourceId),
    [activeSourceId, sources]
  );

  const discoverySource = useMemo(() => {
    if (activeSource?.enabled && activeSource.kind === "lx-server") return activeSource;
    return enabledSources.find((source) => source.kind === "lx-server");
  }, [activeSource, enabledSources]);

  // 富页面(评论/相似/推荐)数据源：优先自部署网易源(反爬能力强)，否则内置网易源。
  const extrasSource = useMemo(() => {
    const netease = enabledSources.filter((source) => source.kind === "netease-api");
    return (
      netease.find((source) => source.neteaseMode === "external") ??
      netease[0] ??
      null
    );
  }, [enabledSources]);

  // 每日推荐:有网易源用 /personalized/newsong 填充(对齐 SPlayer 推荐;真·私人FM/每日歌曲需登录,匿名不可用)。
  const loadNeteaseRecommend = useCallback(async () => {
    if (!extrasSource) {
      setNeteaseRecommend([]);
      return;
    }
    try {
      setNeteaseRecommend(await getNeteaseNewSongRecommend(extrasSource, 30));
    } catch {
      setNeteaseRecommend([]);
    }
  }, [extrasSource]);

  useEffect(() => {
    if (view === "recommend") void loadNeteaseRecommend();
  }, [view, loadNeteaseRecommend]);

  // 「网易热搜」改用真接口（/search/hot/detail，对齐 SPlayer searchHot）填充搜索面板推荐区。
  // 不再自造客户端打分引擎——照参考项目实现；无网易源时留空，由下方 LX 热门搜索兜底。
  useEffect(() => {
    if (!extrasSource) {
      setRecommendedKeywords([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const words = await getNeteaseHotSearch(extrasSource, 8);
        if (!cancelled) setRecommendedKeywords(words);
      } catch {
        if (!cancelled) setRecommendedKeywords([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [extrasSource]);

  const lyricLines = useMemo(
    () => parseLyric({ lyric: lyricText, tlyric: tlyricText, yrc: yrcText, romalrc: romaText }),
    [lyricText, tlyricText, yrcText, romaText]
  );

  const activeLyricIndex = useMemo(() => {
    let index = -1;
    for (let i = 0; i < lyricLines.length; i += 1) {
      if (lyricLines[i].time <= currentTime) index = i;
      else break;
    }
    return index;
  }, [currentTime, lyricLines]);

  const currentCover = currentSong?.cover ? wrapImage(currentSong.cover) : undefined;

  // 封面取色 → 动态主题强调色（失败回退到默认 ember）。
  useEffect(() => {
    let cancelled = false;
    if (!currentCover) {
      setCoverColor(null);
      return;
    }
    void getCoverColor(currentCover).then((color) => {
      if (!cancelled) setCoverColor(color);
    });
    return () => {
      cancelled = true;
    };
  }, [currentCover]);
  const librarySongs = libraryTab === "favorites" ? favorites : history;
  // 每日推荐：LX 无 FM 接口，用收藏 + 历史 + 榜单聚合去重填充，等后端接入再替换。
  const recommendSongs = useMemo(
    () =>
      neteaseRecommend.length > 0
        ? neteaseRecommend
        : dedupeSongs([...favorites, ...history, ...boardSongs]).slice(0, 30),
    [neteaseRecommend, favorites, history, boardSongs]
  );

  const playSong = useCallback(
    async (song: MusicSong, contextSongs: MusicSong[] = [], autoChain = false) => {
      const baseQueue = dedupeSongs(contextSongs.length > 0 ? contextSongs : [song]);
      const searchKey = musicSearchKey(song);
      // 手动播放一首新歌时重置「连续试听跳过」计数；自动续播时保留，用于探底防死循环。
      if (!autoChain) previewSkipChainRef.current = 0;

      const knownCandidates = dedupeSongs([
        song,
        ...(searchCandidatesRef.current.get(searchKey) ?? []),
        ...contextSongs.filter((item) => musicSearchKey(item) === searchKey),
      ]).filter(
        (candidate) =>
          sources.some((source) => source.enabled && source.id === candidate.sourceId)
      );

      const enabled = sources.filter((source) => source.enabled);
      if (knownCandidates.length === 0 && enabled.length === 0) {
        await appAlert("这首歌没有可用的完整播放源", { tone: "warning" });
        return;
      }

      const requestId = ++playRequestRef.current;
      pendingAutoPlayRef.current = true;
      setResolving(true);
      setError("");
      let lastError: unknown;
      let sawPreviewOnly = false; // 是否出现过「试听片段」
      let sawRealError = false; // 是否出现过真正的失败（网络/解析）
      const triedKeys = new Set<string>();

      // 尝试播放单个候选；返回 'played' | 'preview' | 'error' | 'stale'
      const tryCandidate = async (
        candidate: MusicSong
      ): Promise<"played" | "preview" | "error" | "stale"> => {
        const source = sources.find(
          (item) => item.enabled && item.id === candidate.sourceId
        );
        if (!source) return "error";
        triedKeys.add(musicSongKey(candidate));
        const queueForCandidate = baseQueue.some(
          (item) => musicSongKey(item) === musicSongKey(candidate)
        )
          ? baseQueue
          : baseQueue.some((item) => musicSearchKey(item) === searchKey)
            ? baseQueue.map((item) =>
                musicSearchKey(item) === searchKey ? candidate : item
              )
            : [candidate, ...baseQueue];

        setCurrentSong(candidate);
        setQueue(queueForCandidate, candidate);
        try {
          // 命中预取则秒播，否则带音质降级解析。
          const play =
            takePrefetchedSource(source.id, candidate.id, quality) ??
            (await resolveMusicSourceWithFallback(source, candidate, quality, {
              proxy: proxyEnabled,
            }));
          if (requestId !== playRequestRef.current) return "stale";
          const audio = audioRef.current;
          if (audio) {
            // crossOrigin 必须在赋 src 前设；只有走本地代理（CORS-clean）才设，
            // 否则裸 CDN 直链会因 CORS 加载失败。
            audio.crossOrigin = /^https?:\/\/127\.0\.0\.1[:/]/.test(play.url)
              ? "anonymous"
              : null;
            audio.autoplay = true;
            audio.src = play.url;
            audio.load();
            const loadedDuration = await waitForUsableMusicAudio(
              audio,
              candidate.durationSec
            );
            if (requestId !== playRequestRef.current) return "stale";
            if (loadedDuration) setDuration(loadedDuration);
          }
          setAudioUrl(play.url);
          setLyricText(play.lyric || "");
          setTlyricText(play.tlyric || "");
          setYrcText(play.yrc || "");
          setRomaText(play.romalrc || "");
          setCurrentTime(0);
          noteHistory(candidate, 0, candidate.durationSec ?? 0);
          if (audio) {
            // CORS-clean 音频才接 Web Audio 图（频谱 + 均衡器）。建图后输出永久走图。
            if (audio.crossOrigin === "anonymous") {
              if (ensureAudioGraph(audio)) {
                resumeAudioGraph();
                if (eqEnabled) applyEqGains(eqGains);
              }
            }
            await audio
              .play()
              .then(() => {
                pendingAutoPlayRef.current = false;
                setIsPlaying(true);
              })
              .catch(() => {
                setIsPlaying(false);
              });
          }
          // 顺序播放时后台预取下一首，命中后切歌秒播。
          if (playMode === "loop") {
            const idx = queueForCandidate.findIndex(
              (item) => musicSongKey(item) === musicSongKey(candidate)
            );
            const next = idx >= 0 ? queueForCandidate[idx + 1] : undefined;
            if (next) {
              const nextSource = sources.find(
                (item) => item.enabled && item.id === next.sourceId
              );
              if (nextSource) {
                void prefetchMusicSource(nextSource, next, quality, { proxy: proxyEnabled });
              }
            }
          }
          return "played";
        } catch (playError) {
          lastError = playError;
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.removeAttribute("src");
            audioRef.current.load();
          }
          if (requestId !== playRequestRef.current) return "stale";
          return isMusicPreviewError(playError) ? "preview" : "error";
        }
      };

      // 1) 先试已知候选（搜索缓存 / 当前上下文里同一首歌的各平台版本）
      for (const candidate of knownCandidates) {
        const outcome = await tryCandidate(candidate);
        if (outcome === "stale") return;
        if (outcome === "played") {
          previewSkipChainRef.current = 0;
          if (requestId === playRequestRef.current) setResolving(false);
          return;
        }
        if (outcome === "preview") sawPreviewOnly = true;
        else sawRealError = true;
      }

      // 2) 已知候选都不行 —— 跨「源下全部平台」再找同一首歌，挖掘非试听的版本
      try {
        const expanded = await searchMusicSources(enabled, song.title, 1, 20);
        if (requestId !== playRequestRef.current) return;
        const alternates = dedupeSongs(expanded.list).filter(
          (item) =>
            musicSearchKey(item) === searchKey &&
            !triedKeys.has(musicSongKey(item))
        );
        for (const candidate of alternates) {
          const outcome = await tryCandidate(candidate);
          if (outcome === "stale") return;
          if (outcome === "played") {
            previewSkipChainRef.current = 0;
            if (requestId === playRequestRef.current) setResolving(false);
            return;
          }
          if (outcome === "preview") sawPreviewOnly = true;
          else sawRealError = true;
        }
      } catch (expandError) {
        // 扩展搜索失败不致命，按已有结果继续处理
        sawRealError = sawRealError || !sawPreviewOnly;
        if (!lastError) lastError = expandError;
      }

      if (requestId !== playRequestRef.current) return;
      setResolving(false);
      pendingAutoPlayRef.current = false;

      // 3) 收尾：全平台都是试听 → 不弹框，自动播下一首（带探底保护）
      const nextQueue = queueRef.current;
      const onlyPreview = sawPreviewOnly && !sawRealError;
      if (onlyPreview && nextQueue.length > 1) {
        previewSkipChainRef.current += 1;
        if (previewSkipChainRef.current <= nextQueue.length) {
          setError(`「${song.title}」各平台均为试听，已自动跳过`);
          await playByQueueOffsetRef.current?.(1);
          return;
        }
        // 整个队列都试听过一遍了，停下来给个轻提示，不再继续跳
        previewSkipChainRef.current = 0;
        setError("队列中的歌曲在当前源下都只有试听片段");
        return;
      }

      // 4) 真正的失败（或单首试听且无下一首）：保留原有提示
      const message =
        onlyPreview
          ? "当前源下该歌曲只有试听片段"
          : lastError instanceof Error
            ? lastError.message
            : "获取播放地址失败";
      setError(message);
      if (!onlyPreview) {
        await appAlert(message, { title: "播放失败", tone: "warning" });
      }
    },
    [eqEnabled, eqGains, noteHistory, playMode, proxyEnabled, quality, setCurrentSong, setQueue, sources]
  );

  const playByQueueOffset = useCallback(
    async (offset: number, autoChain = false) => {
      if (queue.length === 0) return;
      const currentKey = currentSong ? musicSongKey(currentSong) : "";
      const currentIndex = Math.max(
        0,
        queue.findIndex((song) => musicSongKey(song) === currentKey)
      );
      const nextIndex =
        playMode === "random"
          ? Math.floor(Math.random() * queue.length)
          : (currentIndex + offset + queue.length) % queue.length;
      await playSong(queue[nextIndex], queue, autoChain);
    },
    [currentSong, playMode, playSong, queue]
  );

  // 打开网易推荐歌单：载入歌曲入队并从首曲播放（内置源受反爬限制时降级提示）。
  const openNeteasePlaylist = useCallback(
    async (summary: MusicSongListSummary) => {
      if (!extrasSource) return;
      try {
        const songs = await getNeteasePlaylistSongs(extrasSource, summary.id, 50);
        if (songs.length === 0) {
          await appAlert(
            "载入歌单需自部署 NeteaseCloudMusicApi 源（内置源受网易反爬限制）",
            { tone: "warning" }
          );
          return;
        }
        setQueue(songs, songs[0]);
        await playSong(songs[0], songs);
      } catch (error) {
        await appAlert(error instanceof Error ? error.message : "载入歌单失败", {
          tone: "warning",
        });
      }
    },
    [extrasSource, playSong, setQueue]
  );

  // 播放 MV(对齐 SPlayer:/mv/url 取地址,视频弹层播放,暂停当前音频)。
  const playMv = useCallback(
    async (mv: NeteaseMv) => {
      if (!extrasSource) return;
      try {
        const url = await getNeteaseMvUrl(extrasSource, mv.id);
        audioRef.current?.pause();
        setMvPlay({ url, title: mv.name });
      } catch (error) {
        await appAlert(error instanceof Error ? error.message : "MV 播放失败", {
          tone: "warning",
        });
      }
    },
    [extrasSource]
  );

  // 打开电台:载入全部节目(对齐 SPlayer radioAllProgram)入队从首集播放。
  const openRadio = useCallback(
    async (radio: MusicSongListSummary) => {
      if (!extrasSource) return;
      try {
        const programs = await getNeteaseRadioPrograms(extrasSource, radio.id, 100);
        if (programs.length === 0) {
          await appAlert(
            "载入电台节目需自部署 NeteaseCloudMusicApi 源（内置源受网易反爬限制）",
            { tone: "warning" }
          );
          return;
        }
        setQueue(programs, programs[0]);
        await playSong(programs[0], programs);
      } catch (error) {
        await appAlert(error instanceof Error ? error.message : "载入电台失败", {
          tone: "warning",
        });
      }
    },
    [extrasSource, playSong, setQueue]
  );

  // 导入网易歌单(对齐 CyreneMusic playlistImportService):解析链接/ID → 拉歌 → 建「我的歌单」。
  const importPlaylist = useCallback(
    async (input: string) => {
      if (!extrasSource) {
        await appAlert("请先在「音乐源」添加网易源", { tone: "warning" });
        return;
      }
      const id = parseNeteasePlaylistInput(input);
      if (!id) {
        await appAlert("无法识别歌单链接或 ID", { tone: "warning" });
        return;
      }
      setImportBusy(true);
      try {
        const songs = await getNeteasePlaylistSongs(extrasSource, id, 500);
        if (songs.length === 0) {
          await appAlert(
            "未取到歌单歌曲（内置源受网易反爬限制，建议自部署 NeteaseCloudMusicApi 源）",
            { tone: "warning" }
          );
          return;
        }
        const playlistId = createPlaylist(`导入歌单 (${songs.length})`);
        songs.forEach((song) => addToPlaylist(playlistId, song));
        setImportOpen(false);
        await appAlert(`已导入 ${songs.length} 首到新歌单`, { title: "导入成功" });
      } catch (error) {
        await appAlert(error instanceof Error ? error.message : "导入失败", { tone: "warning" });
      } finally {
        setImportBusy(false);
      }
    },
    [extrasSource, createPlaylist, addToPlaylist]
  );

  // queue / 自动续播函数用 ref 暴露给 playSong（避免把 queue 塞进它的依赖导致频繁重建）
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  useEffect(() => {
    playByQueueOffsetRef.current = (offset: number) => playByQueueOffset(offset, true);
  }, [playByQueueOffset]);

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audioUrl && currentSong) {
      await playSong(currentSong, queue.length > 0 ? queue : [currentSong]);
      return;
    }
    if (audio.paused) {
      await audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
  }, [audioUrl, currentSong, playSong, queue]);

  const changeQuality = useCallback(
    async (nextQuality: MusicQuality) => {
      setQuality(nextQuality);
      const song = currentSong;
      const audio = audioRef.current;
      if (!song || !audio) return;
      const source = sources.find((item) => item.id === song.sourceId);
      if (!source) return;
      const resumeAt = Number.isFinite(audio.currentTime) ? audio.currentTime : currentTime;
      const shouldResume = !audio.paused;
      const requestId = ++playRequestRef.current;
      setResolving(true);
      try {
        const play = await resolveMusicSource(source, song, nextQuality, {
          proxy: proxyEnabled,
        });
        if (requestId !== playRequestRef.current) return;
        setAudioUrl(play.url);
        setLyricText(play.lyric || lyricText);
        setTlyricText(play.tlyric || tlyricText);
        setYrcText(play.yrc || yrcText);
        setRomaText(play.romalrc || romaText);
        audio.pause();
        audio.crossOrigin = /^https?:\/\/127\.0\.0\.1[:/]/.test(play.url)
          ? "anonymous"
          : null;
        audio.src = play.url;
        audio.addEventListener(
          "loadedmetadata",
          () => {
            const maxSeek =
              Number.isFinite(audio.duration) && audio.duration > 0
                ? Math.max(0, audio.duration - 0.25)
                : resumeAt;
            audio.currentTime = Math.max(0, Math.min(resumeAt, maxSeek));
          },
          { once: true }
        );
        audio.load();
        await waitForUsableMusicAudio(audio, song.durationSec);
        if (shouldResume) await audio.play().catch(() => setIsPlaying(false));
      } catch (qualityError) {
        await appAlert(
          qualityError instanceof Error ? qualityError.message : "切换音质失败",
          { title: "切换音质失败", tone: "warning" }
        );
      } finally {
        if (requestId === playRequestRef.current) setResolving(false);
      }
    },
    [
      currentSong,
      currentTime,
      lyricText,
      proxyEnabled,
      romaText,
      setQuality,
      sources,
      tlyricText,
      yrcText,
    ]
  );

  const doSearch = useCallback(
    async (nextPage = 1, nextKeyword = keyword) => {
      const q = nextKeyword.trim();
      if (!q) {
        // Don't change view if keyword is empty, just clear results
        setResults([]);
        setHasMore(false);
        setError("");
        return;
      }
      if (enabledSources.length === 0) {
        setSourceDialogOpen(true);
        await appAlert("请先导入并启用音乐源", {
          title: "音乐源未配置",
          tone: "warning",
        });
        return;
      }
      setSearching(true);
      setError("");
      try {
        const response =
          activeSourceId === "all" || !activeSource
            ? await searchMusicSources(enabledSources, q, nextPage, 24)
            : await searchMusicSource(activeSource, q, nextPage, 30);
        searchCandidatesRef.current = mergeSongCandidates(
          nextPage === 1 ? new Map() : searchCandidatesRef.current,
          response.list
        );
        setResults((old) =>
          dedupeSearchSongs(
            nextPage === 1 ? response.list : [...old, ...response.list]
          )
        );
        setPage(nextPage);
        setHasMore(response.hasMore);
        setView("search");
        saveRecentSearch(q);
        setSearchPanelOpen(false);
      } catch (searchError) {
        const message =
          searchError instanceof Error ? searchError.message : "搜索失败";
        setError(message);
        await appAlert(message, { title: "搜索失败", tone: "warning" });
      } finally {
        setSearching(false);
      }
    },
    [activeSource, activeSourceId, enabledSources, keyword, saveRecentSearch, setView]
  );

  const loadBoardSongs = useCallback(
    async (board: MusicDiscoveryBoard) => {
      if (!discoverySource) return;
      setBoardLoading(true);
      try {
        const data = await getMusicBoardSongs(
          discoverySource,
          board.source,
          board.id,
          1
        );
        setSelectedBoard(board);
        setBoardSongs(data.list);
      } catch (loadError) {
        setBoardSongs([]);
        await appAlert(
          loadError instanceof Error ? loadError.message : "榜单歌曲加载失败",
          { title: "榜单加载失败", tone: "warning" }
        );
      } finally {
        setBoardLoading(false);
      }
    },
    [discoverySource]
  );

  const loadSonglists = useCallback(
    async (
      tagId = selectedTag,
      sortId = selectedSort
    ) => {
      if (!discoverySource) return;
      setSonglistLoading(true);
      try {
        const data = await getAllMusicSonglists(
          discoverySource,
          tagId,
          sortId,
          1
        );
        setSonglists(data.list);
      } catch {
        setSonglists([]);
      } finally {
        setSonglistLoading(false);
      }
    },
    [discoverySource, selectedSort, selectedTag]
  );

  const searchSonglists = useCallback(
    async (rawKeyword: string) => {
      const q = rawKeyword.trim();
      if (!q) {
        setSonglistSearchResults(null);
        return;
      }
      if (!discoverySource) {
        setSonglistSearchResults([]);
        return;
      }
      setSonglistSearching(true);
      try {
        const data = await getAllMusicSonglists(
          discoverySource,
          selectedTag,
          selectedSort,
          1
        );
        const needle = q.toLowerCase();
        const list = data.list.filter((item) => {
          const name = (item.name || "").toLowerCase();
          const author = (item.author || "").toLowerCase();
          return name.includes(needle) || author.includes(needle);
        });
        setSonglistSearchResults(list);
      } catch {
        setSonglistSearchResults([]);
      } finally {
        setSonglistSearching(false);
      }
    },
    [discoverySource, selectedSort, selectedTag]
  );

  const loadDiscovery = useCallback(async () => {
    if (!discoverySource) {
      setBoards([]);
      setBoardSongs([]);
      setChartCards([]);
      setHotSearch([]);
      setSonglists([]);
      return;
    }
    setDiscoveryLoading(true);
    try {
      const [boardsResult, hotResult, tagsResult, songlistsResult] =
        await Promise.allSettled([
          getMusicBoards(discoverySource, "kw"),
          getMusicHotSearch(discoverySource, "mg"),
          getAllMusicSonglistTags(discoverySource),
          getAllMusicSonglists(discoverySource, selectedTag, selectedSort, 1),
        ]);

      if (boardsResult.status === "fulfilled") {
        setBoards(boardsResult.value.list);
        const first = boardsResult.value.list[0] ?? null;
        setSelectedBoard(first);
        if (first) {
          const songs = await getMusicBoardSongs(
            discoverySource,
            first.source,
            first.id,
            1
          );
          setBoardSongs(songs.list);
        } else {
          setBoardSongs([]);
        }
        // 预加载前若干榜单的前几首，供「排行榜卡片」网格展示（借鉴 Tabos chart 卡片）
        const topBoards = boardsResult.value.list.slice(0, 6);
        const cardResults = await Promise.allSettled(
          topBoards.map(async (board) => {
            const detail = await getMusicBoardSongs(
              discoverySource,
              board.source,
              board.id,
              1
            );
            return { board, songs: detail.list.slice(0, 5) } as ChartCard;
          })
        );
        setChartCards(
          cardResults
            .filter(
              (r): r is PromiseFulfilledResult<ChartCard> =>
                r.status === "fulfilled" && r.value.songs.length > 0
            )
            .map((r) => r.value)
        );
      } else {
        setBoards([]);
        setBoardSongs([]);
        setChartCards([]);
      }
      setHotSearch(hotResult.status === "fulfilled" ? hotResult.value : []);
      if (tagsResult.status === "fulfilled") {
        setSongTags(tagsResult.value.hotTags);
        setSongSorts(tagsResult.value.sortList);
      } else {
        setSongTags([]);
        setSongSorts([]);
      }
      setSonglists(
        songlistsResult.status === "fulfilled" ? songlistsResult.value.list : []
      );
    } finally {
      setDiscoveryLoading(false);
    }
  }, [discoverySource, selectedSort, selectedTag]);

  useEffect(() => {
    void loadDiscovery();
  }, [loadDiscovery]);

  useEffect(() => {
    if (!sleepTimerEndAt) {
      setSleepRemaining(0);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((sleepTimerEndAt - Date.now()) / 1000));
      setSleepRemaining(remaining);
      if (remaining <= 0) {
        audioRef.current?.pause();
        setSleepTimerEndAt(null);
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [setSleepTimerEndAt, sleepTimerEndAt]);

  const openSonglist = useCallback(
    (item: MusicSongListSummary) => {
      setOpenedSonglist(item);
      navigate(
        `/music/songlist/${encodeURIComponent(item.source)}/${encodeURIComponent(item.id)}`,
        { state: { songlist: item } }
      );
    },
    [navigate]
  );

  useEffect(() => {
    if (!songlistParams) return;
    const stateSonglist = (location.state as { songlist?: MusicSongListSummary } | null)
      ?.songlist;
    const summary: MusicSongListSummary =
      stateSonglist && stateSonglist.id === songlistParams.id
        ? stateSonglist
        : openedSonglist && openedSonglist.id === songlistParams.id
          ? openedSonglist
          : { id: songlistParams.id, name: "歌单", source: songlistParams.source };
    if (!openedSonglist || openedSonglist.id !== summary.id) {
      setOpenedSonglist(summary);
    }
    if (!discoverySource) return;
    let cancelled = false;
    setSonglistDetailSongs([]);
    setRelatedWorks([]);
    setRelatedArtist("");
    setSonglistDetailLoading(true);
    (async () => {
      try {
        const platform = normalizeMusicPlatform(songlistParams.source) || "wy";
        const detail = await getMusicSonglistDetail(
          discoverySource,
          platform,
          songlistParams.id,
          1
        );
        if (!cancelled) setSonglistDetailSongs(detail.list);
        // 「更多作品」：取歌单中出现最多的歌手，按歌手名再搜一遍作为相关作品。
        const topArtist = mostCommonArtist(detail.list);
        if (topArtist && !cancelled) {
          setRelatedArtist(topArtist);
          try {
            const related =
              enabledSources.length === 0
                ? null
                : await searchMusicSources(enabledSources, topArtist, 1, 12);
            if (!cancelled && related) {
              const detailKeys = new Set(detail.list.map((song) => musicSongKey(song)));
              setRelatedWorks(
                dedupeSearchSongs(related.list).filter(
                  (song) => !detailKeys.has(musicSongKey(song))
                )
              );
            }
          } catch {
            if (!cancelled) setRelatedWorks([]);
          }
        }
      } catch (detailError) {
        if (!cancelled) {
          setSonglistDetailSongs([]);
          await appAlert(
            detailError instanceof Error ? detailError.message : "歌单详情加载失败",
            { title: "歌单详情", tone: "warning" }
          );
        }
      } finally {
        if (!cancelled) setSonglistDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songlistParams?.source, songlistParams?.id, discoverySource]);

  const openAlbum = useCallback(
    (album: string, artist?: string, id?: string) => {
      const name = (album || "").trim();
      if (!name && !id) return;
      const query = new URLSearchParams();
      if (artist) query.set("artist", artist);
      if (id) query.set("id", id);
      const qs = query.toString();
      navigate(`/music/album/${encodeURIComponent(name || id || "")}${qs ? `?${qs}` : ""}`);
    },
    [navigate]
  );

  useEffect(() => {
    if (!albumParams) return;
    if (enabledSources.length === 0) return;
    let cancelled = false;
    setAlbumSongs([]);
    setAlbumArtistWorks([]);
    setAlbumArtist(albumParams.artist || "");
    setAlbumMeta(null);
    setAlbumRestricted(false);
    setAlbumLoading(true);
    (async () => {
      // 有真专辑 id + 网易源 → 真接口 /album?id=（对齐 SPlayer album.ts）。
      if (albumParams.id && extrasSource) {
        try {
          const detail = await getNeteaseAlbum(extrasSource, albumParams.id);
          if (cancelled) return;
          setAlbumSongs(detail.songs);
          setAlbumArtist(detail.album.artist || albumParams.artist || "");
          setAlbumMeta({
            cover: detail.album.cover,
            desc: detail.album.desc,
            publishTime: detail.album.publishTime,
          });
          setAlbumLoading(false);
          return;
        } catch (albumError) {
          if (cancelled) return;
          // 内置源 -462 → 标记降级，继续走派生回退。
          if (isNeteaseAntiBotError(albumError)) setAlbumRestricted(true);
        }
      }
      try {
        // 无 id 或真接口受限：按「专辑名 歌手」搜索，再筛出同专辑曲目（派生回退）。
        const query = albumParams.artist
          ? `${albumParams.name} ${albumParams.artist}`
          : albumParams.name;
        const response = await searchMusicSources(enabledSources, query, 1, 40);
        if (cancelled) return;
        const target = normalizeSongText(albumParams.name);
        const matched = dedupeSearchSongs(response.list).filter(
          (song) => normalizeSongText(song.album) === target
        );
        const albumTracks = matched.length > 0 ? matched : dedupeSearchSongs(response.list);
        setAlbumSongs(albumTracks);
        const topArtist = albumParams.artist || mostCommonArtist(albumTracks);
        if (topArtist && !cancelled) {
          setAlbumArtist(topArtist);
          try {
            const related = await searchMusicSources(enabledSources, topArtist, 1, 16);
            if (cancelled) return;
            const albumKeys = new Set(albumTracks.map((song) => musicSongKey(song)));
            // 同歌手的其它专辑代表作（每张专辑取一首封面图当卡片）。
            const byAlbum = new Map<string, MusicSong>();
            dedupeSearchSongs(related.list).forEach((song) => {
              if (albumKeys.has(musicSongKey(song))) return;
              const key = normalizeSongText(song.album);
              if (!key || key === target) return;
              if (!byAlbum.has(key)) byAlbum.set(key, song);
            });
            setAlbumArtistWorks(Array.from(byAlbum.values()).slice(0, 12));
          } catch {
            if (!cancelled) setAlbumArtistWorks([]);
          }
        }
      } catch (albumError) {
        if (!cancelled) {
          setAlbumSongs([]);
          await appAlert(
            albumError instanceof Error ? albumError.message : "专辑加载失败",
            { title: "专辑", tone: "warning" }
          );
        }
      } finally {
        if (!cancelled) setAlbumLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumParams?.name, albumParams?.artist, albumParams?.id, extrasSource, enabledSources.length]);

  // 跳真歌手页（带真 id）：来自歌手广场/搜索/专辑详情的真接口数据。
  const openArtistById = useCallback(
    (id: string, name?: string) => {
      if (!id) return;
      navigate(
        `/music/artist/${encodeURIComponent(name || id)}?id=${encodeURIComponent(id)}`
      );
    },
    [navigate]
  );

  const openArtist = useCallback(
    (artist?: string) => {
      const name = (artist || "")
        .split(/[/、,，&]| feat\.? | ft\.? /i)[0]
        .trim();
      if (!name) return;
      // 有网易源时先解析真 id 跳真接口页；解析不到再走派生页。
      if (extrasSource) {
        void resolveNeteaseArtistId(extrasSource, name).then((id) => {
          if (id) openArtistById(id, name);
          else navigate(`/music/artist/${encodeURIComponent(name)}`);
        });
        return;
      }
      navigate(`/music/artist/${encodeURIComponent(name)}`);
    },
    [navigate, extrasSource, openArtistById]
  );

  useEffect(() => {
    if (!artistParams) return;
    if (enabledSources.length === 0) return;
    let cancelled = false;
    setArtistSongs([]);
    setArtistAlbums([]);
    setArtistSimilar([]);
    setArtistMeta(null);
    setArtistRestricted(false);
    setArtistLoading(true);
    (async () => {
      // 有真歌手 id + 网易源 → 真接口（/artists 热门曲 + /artist/album 专辑 + /simi/song 相似）。
      if (artistParams.id && extrasSource) {
        try {
          const [detail, albums] = await Promise.all([
            getNeteaseArtist(extrasSource, artistParams.id),
            getNeteaseArtistAlbums(extrasSource, artistParams.id, 24).catch(() => []),
          ]);
          if (cancelled) return;
          setArtistSongs(detail.songs);
          setArtistMeta({
            cover: detail.artist.cover,
            briefDesc: detail.artist.briefDesc,
            musicSize: detail.artist.musicSize,
            albumSize: detail.artist.albumSize,
          });
          setArtistAlbums(
            albums.map((album) => ({
              id: album.id,
              name: album.name,
              cover: album.pic,
            }))
          );
          // 相似歌手：从相似歌曲聚合（匿名相似歌手接口需登录，照参考用 simi/song 派生）。
          try {
            const simi = await getNeteaseSimiSongs(extrasSource, detail.songs[0]?.id || artistParams.id);
            if (!cancelled) {
              const bySimilar = new Map<
                string,
                { name: string; cover?: string; count: number; song: MusicSong }
              >();
              simi.forEach((song) => {
                const primary = (song.artist || "").split(/[/、,，&]/)[0].trim();
                if (!primary || normalizeSongText(primary) === normalizeSongText(detail.artist.name))
                  return;
                const key = normalizeSongText(primary);
                const entry = bySimilar.get(key);
                if (entry) {
                  entry.count += 1;
                  if (!entry.cover && song.cover) entry.cover = song.cover;
                } else {
                  bySimilar.set(key, { name: primary, cover: song.cover, count: 1, song });
                }
              });
              setArtistSimilar(Array.from(bySimilar.values()).slice(0, 8));
            }
          } catch {
            if (!cancelled) setArtistSimilar([]);
          }
          setArtistLoading(false);
          return;
        } catch (artistError) {
          if (cancelled) return;
          if (isNeteaseAntiBotError(artistError)) setArtistRestricted(true);
        }
      }
      try {
        // 无 id 或真接口受限：按歌手名搜索，从结果聚合热门歌曲/专辑/合作歌手（派生回退）。
        const response = await searchMusicSources(enabledSources, artistParams.name, 1, 60);
        if (cancelled) return;
        const target = normalizeSongText(artistParams.name);
        const songs = dedupeSearchSongs(response.list);
        const primary = songs.filter((song) =>
          normalizeSongText(song.artist).includes(target)
        );
        const ordered = primary.length > 0 ? primary : songs;
        setArtistSongs(ordered);

        const byAlbum = new Map<string, { name: string; cover?: string }>();
        ordered.forEach((song) => {
          const name = (song.album || "").trim();
          if (!name) return;
          const key = normalizeSongText(name);
          if (!key) return;
          const entry = byAlbum.get(key);
          if (entry) {
            if (!entry.cover && song.cover) entry.cover = song.cover;
          } else {
            byAlbum.set(key, { name, cover: song.cover });
          }
        });
        setArtistAlbums(Array.from(byAlbum.values()).slice(0, 12));

        const bySimilar = new Map<
          string,
          { name: string; cover?: string; count: number; song: MusicSong }
        >();
        songs.forEach((song) => {
          (song.artist || "")
            .split(/[/、,，&]| feat\.? | ft\.? /i)
            .map((part) => part.trim())
            .filter(Boolean)
            .forEach((name) => {
              if (normalizeSongText(name) === target) return;
              const key = normalizeSongText(name);
              if (!key) return;
              const entry = bySimilar.get(key);
              if (entry) {
                entry.count += 1;
                if (!entry.cover && song.cover) entry.cover = song.cover;
              } else {
                bySimilar.set(key, { name, cover: song.cover, count: 1, song });
              }
            });
        });
        setArtistSimilar(
          Array.from(bySimilar.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, 8)
        );
      } catch (artistError) {
        if (!cancelled) {
          setArtistSongs([]);
          await appAlert(
            artistError instanceof Error ? artistError.message : "歌手加载失败",
            { title: "歌手", tone: "warning" }
          );
        }
      } finally {
        if (!cancelled) setArtistLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artistParams?.name, artistParams?.id, extrasSource, enabledSources.length]);

  const addLxServer = async () => {
    if (!lxBaseUrl.trim()) {
      await appAlert("请输入 LX Music API Server 地址", { tone: "warning" });
      return;
    }
    installSource(
      normalizeMusicSourceDescriptor({
        name: "LX Music API Server",
        kind: "lx-server",
        baseUrl: lxBaseUrl.trim(),
        token: lxToken.trim(),
        defaultPlatform: "all",
      })
    );
    setLxBaseUrl("");
    setLxToken("");
    setSourceDialogOpen(false);
  };

  const addNeteaseBuiltin = () => {
    installSource(
      normalizeMusicSourceDescriptor({
        name: "网易云(内置)",
        kind: "netease-api",
        neteaseMode: "builtin",
        description: "前端直连 music.163.com · 免部署",
      })
    );
    setSourceDialogOpen(false);
  };

  const addNeteaseExternal = async () => {
    if (!neteaseBaseUrl.trim()) {
      await appAlert("请输入 NeteaseCloudMusicApi 服务地址", { tone: "warning" });
      return;
    }
    installSource(
      normalizeMusicSourceDescriptor({
        name: "网易云(自部署)",
        kind: "netease-api",
        neteaseMode: "external",
        baseUrl: neteaseBaseUrl.trim(),
      })
    );
    setNeteaseBaseUrl("");
    setSourceDialogOpen(false);
  };

  const addCyrene = async () => {
    if (!cyreneBaseUrl.trim()) {
      await appAlert("请输入 Cyrene 聚合后端地址", { tone: "warning" });
      return;
    }
    installSource(
      normalizeMusicSourceDescriptor({
        name: "Cyrene 聚合源",
        kind: "cyrene-aggregate",
        baseUrl: cyreneBaseUrl.trim(),
        cyreneMode,
      })
    );
    setSourceDialogOpen(false);
  };

  const handleImport = async () => {
    try {
      const source = await importMusicSourceFromText(importText);
      installSource(source);
      setImportText("");
      setSourceDialogOpen(false);
      await appAlert(`已导入：${source.name}`, { title: "音乐源" });
    } catch (importError) {
      await appAlert(
        importError instanceof Error ? importError.message : "导入失败",
        { title: "导入失败", tone: "warning" }
      );
    }
  };

  const deleteSource = async (source: MusicSourceDescriptor) => {
    const ok = await appConfirm(`删除音乐源「${source.name}」？`, {
      tone: "danger",
      confirmText: "删除",
    });
    if (ok) uninstallSource(source.id);
  };

  const clearAllHistory = async () => {
    const ok = await appConfirm("清空全部音乐播放历史？", {
      tone: "warning",
      confirmText: "清空",
    });
    if (ok) clearHistory();
  };

  const handleAddToPlaylist = (playlistId: string, song: MusicSong) => {
    addToPlaylist(playlistId, song);
    setAddToPlaylistSong(null);
  };

  const handleCreatePlaylistForSong = () => {
    if (!addToPlaylistSong) return;
    const id = createPlaylist(newPlaylistName.trim() || "新建歌单");
    addToPlaylist(id, addToPlaylistSong);
    setNewPlaylistName("");
    setAddToPlaylistSong(null);
  };

  const downloadCurrentSong = () => {
    if (!currentSong || !audioUrl) return;
    // audioUrl 已是代理/直链；带上平台 Referer 头由 Rust 注入防盗链。
    void enqueueDownload(currentSong, audioUrl);
  };

  const handleAudioTime = (time: number, mediaDuration: number) => {
    setCurrentTime(time);
    if (!currentSong) return;
    const now = Date.now();
    if (now - lastHistorySaveRef.current > 10_000) {
      lastHistorySaveRef.current = now;
      noteHistory(currentSong, time, mediaDuration || duration || currentSong.durationSec || 0);
    }
  };

  const handleEnded = async () => {
    // 睡眠定时「播完当前曲」:本曲结束即停,清掉标记。
    if (sleepAfterCurrent) {
      audioRef.current?.pause();
      setIsPlaying(false);
      setSleepAfterCurrent(false);
      return;
    }
    if (playMode === "single" && audioRef.current) {
      audioRef.current.currentTime = 0;
      await audioRef.current.play().catch(() => setIsPlaying(false));
      return;
    }
    await playByQueueOffset(1);
  };

  const playMode_cycle = () => {
    const modes: MusicPlayMode[] = ["loop", "single", "random"];
    const next = modes[(modes.indexOf(playMode) + 1) % modes.length];
    setPlayMode(next);
  };
  const seekTo = (time: number) => {
    if (audioRef.current) audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  // 当前歌的歌词偏移（秒）：正值=歌词提前，负值=延后。
  const currentLyricOffset = currentSong ? lyricOffsets[musicSongKey(currentSong)] ?? 0 : 0;
  // 歌词专用时间 = 音频时间 + 偏移（onTimeUpdate 只有 ~4Hz，扫光需直读音频元素）。
  const getLyricTime = useCallback(
    () => (audioRef.current?.currentTime ?? currentTime) + currentLyricOffset,
    [currentTime, currentLyricOffset]
  );

  // 启动时同步桌面歌词窗口是否已开（窗口可能上次没关）。
  useEffect(() => {
    void isDesktopLyricOpen().then(setDesktopLyricOn);
  }, []);

  const toggleDesktopLyric = useCallback(async () => {
    if (desktopLyricOn) {
      await closeDesktopLyric();
      setDesktopLyricOn(false);
    } else {
      const ok = await openDesktopLyric();
      setDesktopLyricOn(!!ok);
    }
  }, [desktopLyricOn]);

  // 切行时把整行（含词级时间）推给桌面歌词窗口。
  useEffect(() => {
    if (!desktopLyricOn) return;
    pushDesktopLyricLine(lyricLines[activeLyricIndex], getLyricTime(), isPlaying);
  }, [desktopLyricOn, activeLyricIndex, lyricLines, isPlaying, getLyricTime]);

  // 周期推时间锚点，桌面窗口据此本地插值扫光（避免每帧 IPC）。
  useEffect(() => {
    if (!desktopLyricOn) return;
    pushDesktopLyricTime(getLyricTime(), isPlaying);
    const timer = window.setInterval(() => {
      pushDesktopLyricTime(getLyricTime(), isPlaying);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [desktopLyricOn, isPlaying, getLyricTime]);

  // 桌面窗口 ready → 立即补发当前行；桌面窗口控制条命令 → 驱动播放。
  useEffect(() => {
    if (!desktopLyricOn || !isTauri) return;
    let unReady: (() => void) | undefined;
    let unCmd: (() => void) | undefined;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unReady = await listen("desktop-lyric-ready", () => {
        pushDesktopLyricLine(lyricLines[activeLyricIndex], getLyricTime(), isPlaying);
        pushDesktopLyricTime(getLyricTime(), isPlaying);
      });
      unCmd = await listen<string>("desktop-lyric-command", (event) => {
        const cmd = event.payload;
        if (cmd === "toggle") void togglePlay();
        else if (cmd === "next") void playByQueueOffset(1);
        else if (cmd === "prev") void playByQueueOffset(-1);
      });
    })();
    return () => {
      unReady?.();
      unCmd?.();
    };
  }, [
    desktopLyricOn,
    activeLyricIndex,
    lyricLines,
    isPlaying,
    getLyricTime,
    togglePlay,
    playByQueueOffset,
  ]);

  // 系统媒体集成（MediaSession）：锁屏/系统媒体浮层/媒体键。
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    if (currentSong) {
      const artwork = currentCover
        ? [
            { src: currentCover, sizes: "512x512", type: "image/jpeg" },
            { src: currentCover, sizes: "256x256", type: "image/jpeg" },
          ]
        : undefined;
      ms.metadata = new MediaMetadata({
        title: currentSong.title || "未知歌曲",
        artist: currentSong.artist || "未知歌手",
        album: currentSong.album || currentSong.sourceName || "",
        artwork,
      });
    } else {
      ms.metadata = null;
    }
    ms.playbackState = isPlaying ? "playing" : currentSong ? "paused" : "none";
  }, [currentSong, currentCover, isPlaying]);

  // MediaSession 动作处理器（媒体键 / 锁屏按钮）。
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // 个别浏览器不支持某 action，忽略。
      }
    };
    set("play", () => void togglePlay());
    set("pause", () => void togglePlay());
    set("previoustrack", () => void playByQueueOffset(-1));
    set("nexttrack", () => void playByQueueOffset(1));
    set("seekto", (details) => {
      if (typeof details.seekTime === "number" && audioRef.current) {
        audioRef.current.currentTime = details.seekTime;
        setCurrentTime(details.seekTime);
      }
    });
    return () => {
      for (const action of [
        "play",
        "pause",
        "previoustrack",
        "nexttrack",
        "seekto",
      ] as MediaSessionAction[]) {
        set(action, null);
      }
    };
  }, [togglePlay, playByQueueOffset]);

  // 同步播放进度到 MediaSession（系统浮层进度条）。
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    if (!("setPositionState" in navigator.mediaSession)) return;
    const dur = duration || currentSong?.durationSec || 0;
    if (!dur || !Number.isFinite(dur)) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: dur,
        position: Math.min(currentTime, dur),
        playbackRate: playbackRate || 1,
      });
    } catch {
      // position > duration 等边界情况会抛，忽略。
    }
  }, [currentTime, duration, currentSong, playbackRate]);

  // 应用内键盘快捷键(对齐 SPlayer:空格播放/暂停、方向键快进退/切歌、上下音量、M 静音、L 收藏)。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const audio = audioRef.current;
      switch (event.code) {
        case "Space":
          event.preventDefault();
          void togglePlay();
          break;
        case "ArrowRight":
          if (event.ctrlKey || event.metaKey) void playByQueueOffset(1);
          else if (audio) seekTo(Math.min((audio.currentTime || 0) + 5, audio.duration || 0));
          break;
        case "ArrowLeft":
          if (event.ctrlKey || event.metaKey) void playByQueueOffset(-1);
          else if (audio) seekTo(Math.max((audio.currentTime || 0) - 5, 0));
          break;
        case "ArrowUp":
          event.preventDefault();
          setVolume(Math.min(1, (audio?.volume ?? volume) + 0.05));
          break;
        case "ArrowDown":
          event.preventDefault();
          setVolume(Math.max(0, (audio?.volume ?? volume) - 0.05));
          break;
        case "KeyM": {
          const v = audio?.volume ?? volume;
          if (v > 0) {
            muteRestoreRef.current = v;
            setVolume(0);
          } else {
            setVolume(muteRestoreRef.current || 0.8);
          }
          break;
        }
        case "KeyL":
          if (currentSong) toggleFavorite(currentSong);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, playByQueueOffset, seekTo, setVolume, volume, currentSong, toggleFavorite]);

  const isPlayerRoute = view === "player";

  return (
    <div
      className="music-page relative h-full overflow-hidden bg-ink text-cream"
      style={
        {
          "--music-accent": coverColor ? `rgb(${coverColor.accent})` : "var(--ember)",
          "--music-accent-rgb": coverColor ? coverColor.accent : "255, 107, 53",
          "--music-accent-deep": coverColor ? `rgb(${coverColor.deep})` : "#1a0f0a",
        } as React.CSSProperties
      }
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{
          background:
            "linear-gradient(180deg, rgba(255,107,53,0.08), transparent 32%), linear-gradient(180deg, rgba(13,13,13,0.52), #0D0D0D 58%, #090909)",
        }}
      />

      {/* 始终挂载的播放引擎 —— 切换路由（含全屏播放页）不会中断播放 */}
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) =>
          handleAudioTime(
            event.currentTarget.currentTime || 0,
            event.currentTarget.duration || 0
          )
        }
        onLoadStart={() => setIsBuffering(true)}
        onWaiting={() => setIsBuffering(true)}
        onStalled={() => setIsBuffering(true)}
        onCanPlay={() => setIsBuffering(false)}
        onCanPlayThrough={() => setIsBuffering(false)}
        onPlaying={() => {
          setIsBuffering(false);
          setIsPlaying(true);
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => void handleEnded()}
        onError={() => setIsBuffering(false)}
      />

      <div className="relative z-10 h-full min-h-0 flex overflow-hidden">
        {!isPlayerRoute && enabledSources.length > 0 && (
          <MusicSidebar
            view={view}
            libraryTab={libraryTab}
            playlists={playlists}
            onView={setView}
            onLibrary={(tab) => {
              setLibraryTab(tab);
              setView("library");
            }}
            onOpenPlaylist={() => {
              setLibraryTab("playlists");
              setView("library");
            }}
            onCreatePlaylist={() => {
              const id = createPlaylist("新建歌单");
              updatePlaylist(id, { name: `歌单 ${playlists.length + 1}` });
              setLibraryTab("playlists");
              setView("library");
            }}
            onOpenSources={() => setSourceDialogOpen(true)}
          />
        )}

        <div className="relative z-10 flex-1 min-w-0 h-full flex flex-col overflow-hidden">
        {!isPlayerRoute && (
          <header className="music-topbar shrink-0 px-4 sm:px-6">
            <div className="h-16 flex items-center gap-3">
              {/* 搜索栏 */}
              <div className="relative flex-1 max-w-md">
                <div className="search-field-shell music-search-field h-10 w-full flex items-center gap-2 px-3">
                  <IconSearch size={16} className="text-cream-faint shrink-0" />
                  <input
                    ref={searchInputRef}
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    onFocus={() => setSearchPanelOpen(true)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void doSearch(1, keyword);
                      }
                    }}
                    placeholder="搜索歌曲、歌手、歌单"
                    className="search-field-input min-w-0 flex-1 bg-transparent text-sm text-cream placeholder:text-cream-faint"
                  />
                  {keyword && (
                    <button
                      type="button"
                      onClick={() => {
                        setKeyword("");
                        setResults([]);
                        setView("discover");
                      }}
                      className="text-cream-faint hover:text-cream"
                      title="清除"
                    >
                      <IconClose size={14} />
                    </button>
                  )}
                </div>
              </div>

              <div className="ml-auto flex items-center gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => setDrawer("settings")}
                  className="music-icon-pill hidden sm:flex"
                  title="设置"
                >
                  <IconSettings size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => setView("library")}
                  className="music-icon-pill"
                  title="我的音乐"
                >
                  <IconArtist size={16} />
                  <span className="hidden sm:inline">我的</span>
                </button>
              </div>
            </div>
          </header>
        )}

        {/* Search Suggestions Panel - Render at top level with fixed positioning */}
        {searchPanelOpen && !isPlayerRoute && (
          <>
            <div
              className="fixed inset-0 z-[998]"
              onClick={() => setSearchPanelOpen(false)}
            />
            <div
              className="fixed overflow-y-auto rounded-xl shadow-2xl z-[999] left-4 right-4 sm:right-auto sm:w-96 max-h-[calc(100vh-6rem)] sm:max-h-[32rem]"
              style={{
                top: "4.5rem",
                background: "rgba(22,24,29,0.98)",
                border: "1px solid var(--cream-line)",
                backdropFilter: "blur(20px)",
              }}
            >
              {/* Recent Searches */}
              {recentSearches.length > 0 && (
                <div className="p-4 border-b" style={{ borderColor: "var(--cream-line)" }}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-semibold text-cream-dim">近期搜索</h3>
                    <button
                      type="button"
                      onClick={clearRecentSearches}
                      className="text-xs text-cream-faint hover:text-ember"
                    >
                      清空
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {recentSearches.map((item, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => {
                          setKeyword(item);
                          void doSearch(1, item);
                        }}
                        className="px-3 py-1.5 rounded-full text-xs transition-colors"
                        style={{
                          background: "rgba(242,232,213,0.08)",
                          border: "1px solid var(--cream-line)",
                          color: "var(--cream-dim)",
                        }}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 网易热搜榜（真接口 /search/hot/detail；无网易源时下方 LX 热门搜索兜底） */}
              {recommendedKeywords.length > 0 && (
                <div className="p-4 border-b" style={{ borderColor: "var(--cream-line)" }}>
                  <h3 className="text-xs font-semibold text-cream-dim mb-3">网易热搜</h3>
                  <div className="flex flex-wrap gap-2">
                    {recommendedKeywords.map((item, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => {
                          setKeyword(item);
                          void doSearch(1, item);
                        }}
                        className="px-3 py-1.5 rounded-full text-xs transition-colors"
                        style={{
                          background: "rgba(255,129,97,0.12)",
                          border: "1px solid rgba(255,129,97,0.3)",
                          color: "var(--ember)",
                        }}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Hot Searches */}
              {hotSearch.length > 0 && (
                <div className="p-4">
                  <h3 className="text-xs font-semibold text-cream-dim mb-3">热门搜索</h3>
                  <div className="space-y-1">
                    {hotSearch.slice(0, 8).map((item, index) => (
                      <button
                        key={`${item.source}:${item.keyword}`}
                        type="button"
                        onClick={() => {
                          setKeyword(item.keyword);
                          void doSearch(1, item.keyword);
                        }}
                        className="w-full px-3 py-2 rounded-lg text-left text-sm transition-colors hover:bg-cream-pale flex items-center gap-2"
                      >
                        <span
                          className="font-mono text-xs w-5 text-center"
                          style={{ color: index < 3 ? "var(--ember)" : "var(--cream-faint)" }}
                        >
                          {index + 1}
                        </span>
                        <span style={{ color: "var(--cream)" }}>{item.keyword}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {isPlayerRoute ? (
          <PlayerView
            currentSong={currentSong}
            currentCover={currentCover}
            isPlaying={isPlaying}
            isBuffering={isBuffering}
            resolving={resolving}
            currentTime={currentTime}
            duration={duration || currentSong?.durationSec || 0}
            volume={volume}
            quality={quality}
            playMode={playMode}
            queue={queue}
            lyricLines={lyricLines}
            getAudioTime={getLyricTime}
            lyricShowTrans={lyricShowTrans}
            lyricShowRoma={lyricShowRoma}
            lyricFontScale={lyricFontScale}
            showSpectrum={showSpectrum}
            sleepTimerEndAt={sleepTimerEndAt}
            sleepRemaining={sleepRemaining}
            sleepAfterCurrent={sleepAfterCurrent}
            playbackRate={playbackRate}
            favorite={!!currentSong && isFavorite(currentSong)}
            onBack={() => navigate(-1)}
            onTogglePlay={() => void togglePlay()}
            onPrev={() => void playByQueueOffset(-1)}
            onNext={() => void playByQueueOffset(1)}
            onSeek={seekTo}
            onVolume={setVolume}
            onQuality={(next) => void changeQuality(next)}
            onPlayMode={playMode_cycle}
            onFavorite={() => currentSong && toggleFavorite(currentSong)}
            onDownload={downloadCurrentSong}
            onAddToPlaylist={setAddToPlaylistSong}
            onPlayFromQueue={(song) => void playSong(song, queue)}
            onRemoveQueue={(song) => removeFromQueue(musicSongKey(song))}
            onClearQueue={clearQueue}
            onSpectrum={setShowSpectrum}
            onSleep={(minutes) =>
              setSleepTimerEndAt(minutes > 0 ? Date.now() + minutes * 60 * 1000 : null)
            }
            onSleepAfterCurrent={setSleepAfterCurrent}
            onPlaybackRate={setPlaybackRate}
            desktopLyricOn={desktopLyricOn}
            onDesktopLyric={() => void toggleDesktopLyric()}
            desktopLyricAvailable={isTauri}
            extrasSource={extrasSource}
            onPlaySong={(song) => void playSong(song, [song])}
            onOpenPlaylist={(summary) => void openNeteasePlaylist(summary)}
          />
        ) : (
          <main className="music-scroll flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 pt-3 pb-5">
            <div className="w-full">
              {error && (
                <div
                  className="mb-4 rounded-lg px-4 py-3 text-sm text-ember"
                  style={{
                    border: "1px solid rgba(255,107,53,0.36)",
                    background: "rgba(255,107,53,0.08)",
                  }}
                >
                  {error}
                </div>
              )}

              {enabledSources.length === 0 ? (
                <EmptyMusicState onOpenSource={() => setSourceDialogOpen(true)} />
              ) : view === "artist" ? (
                <ArtistView
                  name={artistParams?.name || "歌手"}
                  songs={artistSongs}
                  albums={artistAlbums}
                  similar={artistSimilar}
                  loading={artistLoading}
                  meta={artistMeta}
                  restricted={artistRestricted}
                  currentSong={currentSong}
                  isPlaying={isPlaying}
                  isFavorite={isFavorite}
                  onBack={() => navigate(-1)}
                  onPlay={(song) => void playSong(song, artistSongs)}
                  onPlayAll={() =>
                    artistSongs[0] && void playSong(artistSongs[0], artistSongs)
                  }
                  onFavorite={toggleFavorite}
                  onQueue={appendToQueue}
                  onAddToPlaylist={setAddToPlaylistSong}
                  onOpenAlbum={(album, artist, id) => openAlbum(album, artist, id)}
                  onOpenArtist={(artist) => openArtist(artist)}
                />
              ) : view === "album" ? (
                <AlbumView
                  name={albumParams?.name || "专辑"}
                  artist={albumArtist}
                  cover={albumMeta?.cover}
                  songs={albumSongs}
                  loading={albumLoading}
                  restricted={albumRestricted}
                  currentSong={currentSong}
                  isPlaying={isPlaying}
                  isFavorite={isFavorite}
                  onBack={() => navigate(-1)}
                  onPlay={(song) => void playSong(song, albumSongs)}
                  onPlayAll={() =>
                    albumSongs[0] && void playSong(albumSongs[0], albumSongs)
                  }
                  onFavorite={toggleFavorite}
                  onQueue={appendToQueue}
                  onAddToPlaylist={setAddToPlaylistSong}
                  relatedArtist={albumArtist}
                  relatedWorks={albumArtistWorks}
                  onPlayRelated={(song) => openAlbum(song.album || "", song.artist)}
                  onOpenArtist={(artist) => openArtist(artist)}
                />
              ) : view === "songlist" ? (
                <SonglistView
                  item={openedSonglist}
                  songs={songlistDetailSongs}
                  loading={songlistDetailLoading}
                  currentSong={currentSong}
                  isPlaying={isPlaying}
                  isFavorite={isFavorite}
                  onBack={() => navigate(-1)}
                  onPlay={(song) => void playSong(song, songlistDetailSongs)}
                  onPlayAll={() =>
                    songlistDetailSongs[0] &&
                    void playSong(songlistDetailSongs[0], songlistDetailSongs)
                  }
                  onFavorite={toggleFavorite}
                  onQueue={appendToQueue}
                  onAddToPlaylist={setAddToPlaylistSong}
                  relatedArtist={relatedArtist}
                  relatedWorks={relatedWorks}
                  onPlayRelated={(song) => void playSong(song, relatedWorks)}
                />
              ) : view === "songlists" ? (
                <SonglistsView
                  source={discoverySource}
                  loading={songlistLoading}
                  songlists={songlists}
                  tags={songTags}
                  sorts={songSorts}
                  selectedTag={selectedTag}
                  selectedSort={selectedSort}
                  keyword={songlistKeyword}
                  searchResults={songlistSearchResults}
                  searching={songlistSearching}
                  onKeyword={setSonglistKeyword}
                  onSearch={(q) => void searchSonglists(q)}
                  onTag={(tagId) => {
                    setSelectedTag(tagId);
                    void loadSonglists(tagId, selectedSort);
                  }}
                  onSort={(sortId) => {
                    setSelectedSort(sortId);
                    void loadSonglists(selectedTag, sortId);
                  }}
                  onOpenSonglist={(item) => void openSonglist(item)}
                />
              ) : view === "discover" ? (
                <DiscoverView
                  source={discoverySource}
                  loading={discoveryLoading}
                  currentSong={currentSong}
                  currentCover={currentCover}
                  isPlaying={isPlaying}
                  resolving={resolving}
                  hotSearch={hotSearch}
                  boards={boards}
                  selectedBoard={selectedBoard}
                  boardSongs={boardSongs}
                  boardLoading={boardLoading}
                  chartCards={chartCards}
                  favorites={favorites}
                  songlists={songlists}
                  onSearch={(q) => {
                    setKeyword(q);
                    void doSearch(1, q);
                  }}
                  onReload={() => void loadDiscovery()}
                  onBoard={(board) => void loadBoardSongs(board)}
                  onPlay={(song, songs) => void playSong(song, songs)}
                  onQueue={appendToQueue}
                  onFavorite={toggleFavorite}
                  isFavorite={isFavorite}
                  onAddToPlaylist={setAddToPlaylistSong}
                  onOpenSonglist={(item) => void openSonglist(item)}
                  onMore={() => setView("songlists")}
                />
              ) : view === "search" ? (
                <SearchView
                  keyword={keyword}
                  activeSourceId={activeSourceId}
                  sources={sources}
                  searching={searching}
                  results={results}
                  hasMore={hasMore}
                  page={page}
                  currentSong={currentSong}
                  isFavorite={isFavorite}
                  onActiveSource={setActiveSource}
                  onLoadMore={() => void doSearch(page + 1)}
                  onPlay={(song) => void playSong(song, results)}
                  onFavorite={toggleFavorite}
                  onQueue={appendToQueue}
                  onAddToPlaylist={setAddToPlaylistSong}
                  onOpenAlbum={(album, artist) => openAlbum(album, artist)}
                  onOpenArtist={(artist) => openArtist(artist)}
                  onClose={() => {
                    setKeyword("");
                    setResults([]);
                    setView("discover");
                  }}
                  extrasSource={extrasSource}
                  onOpenPlaylist={(summary) => void openNeteasePlaylist(summary)}
                />
              ) : view === "library" ? (
                <LibraryView
                  tab={libraryTab}
                  onTab={setLibraryTab}
                  favorites={favorites}
                  history={history}
                  playlists={playlists}
                  currentSong={currentSong}
                  isFavorite={isFavorite}
                  onPlay={(song, songs) => void playSong(song, songs)}
                  onFavorite={toggleFavorite}
                  onQueue={appendToQueue}
                  onAddToPlaylist={setAddToPlaylistSong}
                  onClearHistory={() => void clearAllHistory()}
                  onCreatePlaylist={() => {
                    const id = createPlaylist("新建歌单");
                    updatePlaylist(id, { name: `歌单 ${playlists.length + 1}` });
                  }}
                  onImportPlaylist={() => setImportOpen(true)}
                  onDeletePlaylist={(id) => void deletePlaylist(id)}
                  onClearPlaylist={(id) => clearPlaylist(id)}
                  onRemoveFromPlaylist={removeFromPlaylist}
                  librarySongs={librarySongs}
                  downloads={downloadItems}
                  onRemoveDownload={removeDownload}
                  onClearDownloads={clearDownloads}
                />
              ) : view === "recommend" ? (
                <RecommendView
                  songs={recommendSongs}
                  loading={discoveryLoading}
                  currentSong={currentSong}
                  isPlaying={isPlaying}
                  isFavorite={isFavorite}
                  onPlayAll={() =>
                    recommendSongs[0] &&
                    void playSong(recommendSongs[0], recommendSongs)
                  }
                  onReload={() => {
                    void loadDiscovery();
                    void loadNeteaseRecommend();
                  }}
                  onPlay={(song, songs) => void playSong(song, songs)}
                  onFavorite={toggleFavorite}
                  onQueue={appendToQueue}
                  onAddToPlaylist={setAddToPlaylistSong}
                />
              ) : view === "toplist" ? (
                <ToplistView
                  boards={boards}
                  chartCards={chartCards}
                  selectedBoard={selectedBoard}
                  boardSongs={boardSongs}
                  boardLoading={boardLoading}
                  currentSong={currentSong}
                  isPlaying={isPlaying}
                  isFavorite={isFavorite}
                  onBoard={(board) => void loadBoardSongs(board)}
                  onPlay={(song, songs) => void playSong(song, songs)}
                  onFavorite={toggleFavorite}
                  onQueue={appendToQueue}
                  onAddToPlaylist={setAddToPlaylistSong}
                />
              ) : view === "artists" ? (
                <ArtistsView source={extrasSource} onOpenArtist={(id) => openArtistById(id)} />
              ) : view === "mv" ? (
                <MvView source={extrasSource} onPlay={(mv) => void playMv(mv)} />
              ) : view === "radio" ? (
                <RadioView source={extrasSource} onOpenRadio={(radio) => void openRadio(radio)} />
              ) : view === "recent" ? (
                <RecentView
                  history={history}
                  currentSong={currentSong}
                  isPlaying={isPlaying}
                  isFavorite={isFavorite}
                  onPlay={(song, songs) => void playSong(song, songs)}
                  onFavorite={toggleFavorite}
                  onQueue={appendToQueue}
                  onAddToPlaylist={setAddToPlaylistSong}
                  onClear={() => void clearAllHistory()}
                />
              ) : view === "local" ? (
                <LocalView
                  currentSong={currentSong}
                  isPlaying={isPlaying}
                  isFavorite={isFavorite}
                  onPlay={(song, songs) => void playSong(song, songs)}
                  onFavorite={toggleFavorite}
                  onQueue={appendToQueue}
                  onAddToPlaylist={setAddToPlaylistSong}
                />
              ) : view === "stats" ? (
                <StatsView
                  history={history}
                  currentSong={currentSong}
                  isPlaying={isPlaying}
                  isFavorite={isFavorite}
                  onPlay={(song, songs) => void playSong(song, songs)}
                  onFavorite={toggleFavorite}
                  onQueue={appendToQueue}
                  onAddToPlaylist={setAddToPlaylistSong}
                />
              ) : (
                <SourcesView
                  sources={sources}
                  activeSourceId={activeSourceId}
                  onActive={setActiveSource}
                  onOpen={() => setSourceDialogOpen(true)}
                  onToggle={toggleSource}
                  onDelete={(source) => void deleteSource(source)}
                  onRename={(source, name) => updateSource(source.id, { name })}
                />
              )}
            </div>
          </main>
        )}

        {!isPlayerRoute && (
          <PlayerBar
            currentSong={currentSong}
            audioUrl={audioUrl}
            currentCover={currentCover}
            isPlaying={isPlaying}
            isBuffering={isBuffering}
            resolving={resolving}
            currentTime={currentTime}
            duration={duration || currentSong?.durationSec || 0}
            volume={volume}
            quality={quality}
            playMode={playMode}
            queueCount={queue.length}
            activeLyric={lyricLines[activeLyricIndex]}
            showSpectrum={showSpectrum}
            sleepRemaining={sleepRemaining}
            onTogglePlay={() => void togglePlay()}
            onPrev={() => void playByQueueOffset(-1)}
            onNext={() => void playByQueueOffset(1)}
            onSeek={seekTo}
            onVolume={setVolume}
            onQuality={(next) => void changeQuality(next)}
            onPlayMode={playMode_cycle}
            onFavorite={() => currentSong && toggleFavorite(currentSong)}
            favorite={!!currentSong && isFavorite(currentSong)}
            onDownload={downloadCurrentSong}
            onOpenPlayer={() => setView("player")}
            onOpenQueue={() => setDrawer("queue")}
            onOpenLyrics={() => setDrawer("lyrics")}
            onOpenSettings={() => setDrawer("settings")}
          />
        )}
        </div>
      </div>

      {drawer && (
        <MusicDrawer
          drawer={drawer}
          queue={queue}
          currentSong={currentSong}
          lyricLines={lyricLines}
          getAudioTime={getLyricTime}
          lyricShowTrans={lyricShowTrans}
          lyricShowRoma={lyricShowRoma}
          lyricFontScale={lyricFontScale}
          lyricOffset={currentLyricOffset}
          onLyricShowTrans={setLyricShowTrans}
          onLyricShowRoma={setLyricShowRoma}
          onLyricFontScale={setLyricFontScale}
          onLyricOffset={(delta) =>
            currentSong &&
            setLyricOffset(musicSongKey(currentSong), currentLyricOffset + delta)
          }
          quality={quality}
          proxyEnabled={proxyEnabled}
          showSpectrum={showSpectrum}
          eqEnabled={eqEnabled}
          eqPreset={eqPreset}
          eqGains={eqGains}
          onEqToggle={setEqEnabled}
          onEqPreset={setEqPreset}
          onEqGain={setEqGain}
          desktopLyricOn={desktopLyricOn}
          onDesktopLyric={() => void toggleDesktopLyric()}
          sleepTimerEndAt={sleepTimerEndAt}
          sleepRemaining={sleepRemaining}
          onClose={() => setDrawer(null)}
          onPlay={(song) => void playSong(song, queue)}
          onRemoveQueue={(song) => removeFromQueue(musicSongKey(song))}
          onClearQueue={clearQueue}
          isFavorite={isFavorite}
          onFavorite={toggleFavorite}
          onAddToPlaylist={setAddToPlaylistSong}
          onSeek={(time) => {
            if (audioRef.current) audioRef.current.currentTime = time;
            setCurrentTime(time);
          }}
          onQuality={(next) => void changeQuality(next)}
          onProxy={setProxyEnabled}
          onSpectrum={setShowSpectrum}
          onSleep={(minutes) =>
            setSleepTimerEndAt(minutes > 0 ? Date.now() + minutes * 60 * 1000 : null)
          }
        />
      )}

      {sourceDialogOpen && (
        <SourceDialog
          sources={sources}
          importText={importText}
          lxBaseUrl={lxBaseUrl}
          lxToken={lxToken}
          neteaseBaseUrl={neteaseBaseUrl}
          onImportText={setImportText}
          onLxBaseUrl={setLxBaseUrl}
          onLxToken={setLxToken}
          onNeteaseBaseUrl={setNeteaseBaseUrl}
          cyreneBaseUrl={cyreneBaseUrl}
          cyreneMode={cyreneMode}
          onCyreneBaseUrl={setCyreneBaseUrl}
          onCyreneMode={setCyreneMode}
          onClose={() => setSourceDialogOpen(false)}
          onImport={() => void handleImport()}
          onAddLx={() => void addLxServer()}
          onAddNeteaseBuiltin={addNeteaseBuiltin}
          onAddNeteaseExternal={() => void addNeteaseExternal()}
          onAddCyrene={() => void addCyrene()}
          onToggle={toggleSource}
          onDelete={(source) => void deleteSource(source)}
          onRename={(source, name) => updateSource(source.id, { name })}
        />
      )}

      {mvPlay && (
        <MvModal url={mvPlay.url} title={mvPlay.title} onClose={() => setMvPlay(null)} />
      )}

      {importOpen && (
        <ImportPlaylistDialog
          busy={importBusy}
          onClose={() => setImportOpen(false)}
          onImport={(input) => void importPlaylist(input)}
        />
      )}

      {addToPlaylistSong && (
        <AddToPlaylistDialog
          song={addToPlaylistSong}
          playlists={playlists}
          newPlaylistName={newPlaylistName}
          onName={setNewPlaylistName}
          onClose={() => setAddToPlaylistSong(null)}
          onAdd={(playlistId) => handleAddToPlaylist(playlistId, addToPlaylistSong)}
          onCreate={handleCreatePlaylistForSong}
        />
      )}
    </div>
  );
}
