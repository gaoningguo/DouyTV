import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { appAlert, appConfirm } from "@/components/AppDialog";
import {
  IconAlbum,
  IconArrowLeft,
  IconArtist,
  IconBookmark,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconCheck,
  IconClock,
  IconClose,
  IconDownload,
  IconHeart,
  IconHeartFill,
  IconPause,
  IconPlay,
  IconPlus,
  IconQueue,
  IconRefresh,
  IconRepeat,
  IconRepeatOne,
  IconSearch,
  IconSettings,
  IconShuffle,
  IconSkipBackward,
  IconSkipForward,
  IconStats,
  IconTrash,
  IconVolume,
  IconVolumeMute,
} from "@/components/Icon";
import {
  formatDuration,
  getAllMusicSonglistTags,
  getAllMusicSonglists,
  getMusicBoardSongs,
  getMusicBoards,
  getMusicHotSearch,
  getMusicSonglistDetail,
  importMusicSourceFromText,
  isMusicPreviewError,
  musicSongKey,
  normalizeMusicPlatform,
  normalizeMusicSourceDescriptor,
  resolveMusicSource,
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
} from "@/lib/music";
import { wrapImage } from "@/lib/proxy";
import { useMusicStore, type MusicUserPlaylist } from "@/stores/music";

type MusicView = "discover" | "songlists" | "search" | "library" | "sources" | "player" | "songlist" | "album" | "artist";
type LibraryTab = "favorites" | "history" | "playlists";
type DrawerView = "queue" | "lyrics" | "settings" | null;

interface LyricLine {
  time: number;
  text: string;
  trans?: string;
}

const QUALITY_OPTIONS: Array<{ id: MusicQuality; label: string }> = [
  { id: "128k", label: "标准" },
  { id: "320k", label: "高品" },
  { id: "flac", label: "无损" },
  { id: "flac24bit", label: "臻品" },
];

const PLAY_MODE_ICON: Record<MusicPlayMode, ReactNode> = {
  loop: <IconRepeat size={17} />,
  single: <IconRepeatOne size={17} />,
  random: <IconShuffle size={17} />,
};

const PLAY_MODE_LABEL: Record<MusicPlayMode, string> = {
  loop: "列表循环",
  single: "单曲循环",
  random: "随机播放",
};

function aggregateMusicLabel(value?: string, fallback = "聚合推荐") {
  const cleaned = (value || "")
    .replace(/网易云音乐|网易云|网易|QQ音乐|QQ|酷我音乐|酷我|酷狗音乐|酷狗|咪咕音乐|咪咕/gi, "")
    .replace(/^[\s·\-_/｜|]+|[\s·\-_/｜|]+$/g, "")
    .trim();
  return cleaned || fallback;
}

function aggregatePlaylistMeta(item: MusicSongListSummary) {
  return formatCount(item.playCount) || item.author || "聚合歌单";
}

function dedupeSongs(songs: MusicSong[]) {
  const seen = new Set<string>();
  return songs.filter((song) => {
    const key = musicSongKey(song);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mostCommonArtist(songs: MusicSong[]) {
  const counts = new Map<string, number>();
  songs.forEach((song) => {
    const name = (song.artist || "").trim();
    if (!name) return;
    // 多歌手时只取第一位，避免「A/B」「A、B」当成独立歌手。
    const primary = name.split(/[/、,，&]| feat\.? | ft\.? /i)[0].trim();
    if (!primary) return;
    counts.set(primary, (counts.get(primary) ?? 0) + 1);
  });
  let best = "";
  let bestCount = 0;
  counts.forEach((count, name) => {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  });
  return best;
}

function normalizeSongText(value?: string) {
  return (value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function musicSearchKey(song: MusicSong) {
  const title = normalizeSongText(song.title);
  const artist = normalizeSongText(song.artist);
  if (!title && !artist) return musicSongKey(song);
  return `${title}:${artist}`;
}

function dedupeSearchSongs(songs: MusicSong[]) {
  const seen = new Set<string>();
  return songs.filter((song) => {
    const key = musicSearchKey(song);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mergeSongCandidates(
  map: Map<string, MusicSong[]>,
  songs: MusicSong[]
) {
  const next = new Map(map);
  songs.forEach((song) => {
    const key = musicSearchKey(song);
    const group = next.get(key) ?? [];
    if (!group.some((item) => musicSongKey(item) === musicSongKey(song))) {
      next.set(key, [...group, song]);
    }
  });
  return next;
}

function tagToSeconds(min: string, sec: string, frac?: string): number {
  const m = Number(min);
  const s = Number(sec);
  const ms = frac ? Number(frac.padEnd(3, "0")) : 0;
  if (!Number.isFinite(m) || !Number.isFinite(s)) return 0;
  return m * 60 + s + ms / 1000;
}

function parseLyric(lyricText: string, tlyricText?: string): LyricLine[] {
  const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;
  const wordTagRegex = /<(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?>/g;

  // 解析翻译（只取行级时间 → 文本）
  const parseTrans = (text: string) => {
    const map = new Map<number, string>();
    text.split("\n").forEach((line) => {
      const matches = Array.from(line.matchAll(timeRegex));
      if (matches.length === 0) return;
      const content = line.replace(timeRegex, "").replace(wordTagRegex, "").trim();
      matches.forEach((match) => {
        const t = tagToSeconds(match[1], match[2], match[3]);
        if (content) map.set(t, content);
      });
    });
    return map;
  };

  // 解析主歌词为带时间的「行」
  type RawLine = { time: number; raw: string };
  const rawLines: RawLine[] = [];
  (lyricText || "").split("\n").forEach((line) => {
    const stamps = Array.from(line.matchAll(timeRegex));
    if (stamps.length === 0) return;
    const body = line.replace(timeRegex, "").replace(wordTagRegex, "").trim();
    stamps.forEach((match) => {
      const t = tagToSeconds(match[1], match[2], match[3]);
      rawLines.push({ time: t, raw: body });
    });
  });
  rawLines.sort((a, b) => a.time - b.time);

  const trans = parseTrans(tlyricText || "");
  const transTimes = Array.from(trans.keys()).sort((a, b) => a - b);
  const transNear = (t: number): string | undefined => {
    // 翻译时间未必与主歌词完全相等，取最接近且 ≤0.4s 的那一条
    let best: string | undefined;
    let bestDiff = 0.4;
    for (const tt of transTimes) {
      const diff = Math.abs(tt - t);
      if (diff <= bestDiff) {
        bestDiff = diff;
        best = trans.get(tt);
      }
    }
    return best;
  };

  const lines: LyricLine[] = rawLines.map((line) => ({
    time: line.time,
    text: line.raw,
    trans: transNear(line.time),
  }));

  // 主歌词为空但有翻译时，退化成纯翻译行
  if (lines.length === 0 && transTimes.length > 0) {
    return transTimes.map((t) => ({ time: t, text: trans.get(t) || "" }));
  }

  return lines.filter((line) => line.text || line.trans);
}

function formatCount(value?: string | number) {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+(\.\d+)?$/.test(value)
        ? Number(value)
        : undefined;
  if (!numeric) return value ? String(value) : "";
  if (numeric >= 100_000_000) return `${(numeric / 100_000_000).toFixed(1)}亿`;
  if (numeric >= 10_000) return `${(numeric / 10_000).toFixed(1)}万`;
  return String(Math.round(numeric));
}

function safeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "music";
}

function deriveView(pathname: string): MusicView {
  if (pathname.startsWith("/music/search")) return "search";
  if (pathname.startsWith("/music/library")) return "library";
  if (pathname.startsWith("/music/sources")) return "sources";
  if (pathname.startsWith("/music/player")) return "player";
  if (pathname.startsWith("/music/songlists")) return "songlists";
  if (pathname.startsWith("/music/songlist")) return "songlist";
  if (pathname.startsWith("/music/album")) return "album";
  if (pathname.startsWith("/music/artist")) return "artist";
  return "discover";
}

function useHorizontalRail<T extends HTMLElement>() {
  // 用 state 持有节点（而非 useRef）——当容器是条件渲染、异步挂载时，
  // 回调 ref 会触发 setNode，下方 effect 才能在节点真正挂上后重新绑定监听，
  // 否则箭头永远不会出现（节点首次渲染时还不存在）。
  const [node, setNode] = useState<T | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const ref = useCallback((el: T | null) => setNode(el), []);

  const update = useCallback(() => {
    if (!node) {
      setCanLeft(false);
      setCanRight(false);
      return;
    }
    const max = node.scrollWidth - node.clientWidth;
    setCanLeft(node.scrollLeft > 2);
    setCanRight(max > 2 && node.scrollLeft < max - 2);
  }, [node]);

  useEffect(() => {
    if (!node) return;
    update();
    const onScroll = () => update();
    node.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", update);
    const raf = window.requestAnimationFrame(update);
    // 内容异步加载后 scrollWidth 变化，需要重新计算箭头显隐
    const observer = new ResizeObserver(() => update());
    observer.observe(node);
    return () => {
      node.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", update);
      window.cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [node, update]);

  const slide = useCallback(
    (dir: -1 | 1) => {
      if (!node) return;
      node.scrollBy({ left: dir * Math.round(node.clientWidth * 0.82), behavior: "smooth" });
    },
    [node]
  );

  return { ref, canLeft, canRight, update, slide };
}

export default function Music() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playRequestRef = useRef(0);
  const lastHistorySaveRef = useRef(0);
  const pendingAutoPlayRef = useRef(false);
  const searchCandidatesRef = useRef<Map<string, MusicSong[]>>(new Map());
  // 「全平台试听则自动下一首」相关：避免整队列都是试听时无限跳转
  const playByQueueOffsetRef = useRef<((offset: number) => Promise<void>) | null>(null);
  const previewSkipChainRef = useRef(0);
  const queueRef = useRef<MusicSong[]>([]);
  // 「为你推荐」防抖动：只在真正影响排序的输入变化时重算，并丢弃过期的异步结果
  const recommendSignatureRef = useRef("");
  const recommendRunRef = useRef(0);
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
    const artist = new URLSearchParams(location.search).get("artist") || "";
    return { name: decodeURIComponent(match[1]), artist };
  }, [location.pathname, location.search]);
  const artistParams = useMemo(() => {
    const match = location.pathname.match(/^\/music\/artist\/([^/]+)/);
    if (!match) return null;
    return { name: decodeURIComponent(match[1]) };
  }, [location.pathname]);
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("favorites");
  const [drawer, setDrawer] = useState<DrawerView>(null);
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<MusicSong[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
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
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [lxBaseUrl, setLxBaseUrl] = useState("http://35.208.239.12:9527/");
  const [lxToken, setLxToken] = useState("");
  const [boards, setBoards] = useState<MusicDiscoveryBoard[]>([]);
  const [selectedBoard, setSelectedBoard] = useState<MusicDiscoveryBoard | null>(null);
  const [boardSongs, setBoardSongs] = useState<MusicSong[]>([]);
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
    Array<{ name: string; cover?: string; song: MusicSong }>
  >([]);
  const [artistSimilar, setArtistSimilar] = useState<
    Array<{ name: string; cover?: string; count: number; song: MusicSong }>
  >([]);
  const [artistLoading, setArtistLoading] = useState(false);
  const [addToPlaylistSong, setAddToPlaylistSong] = useState<MusicSong | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [sleepRemaining, setSleepRemaining] = useState(0);

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
  const sleepTimerEndAt = useMusicStore((state) => state.sleepTimerEndAt);
  const setSleepTimerEndAt = useMusicStore((state) => state.setSleepTimerEndAt);
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

  useEffect(() => {
    hydrate();
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

  // 「为你推荐」纯粹基于用户个人行为（播放历史 / 收藏 / 搜索）生成，
  // 不混入热门搜索 —— 热门搜索是单独的「热门搜索」分区。
  // 评分维度：播放次数 × 近因衰减 × 完成度，叠加收藏与搜索信号。
  useEffect(() => {
    // 排序只关心歌手 / 播放次数 / 收藏 / 搜索词，不关心每 10 秒刷新的播放进度。
    // 用这些字段拼一个签名，签名不变就不重算，避免播放过程中频繁抖动。
    const signature = JSON.stringify({
      h: history
        .slice(0, 80)
        .map((r) => `${r.artist}|${r.playCount || 0}`),
      f: favorites.slice(0, 60).map((s) => s.artist),
      s: recentSearches.slice(0, 8),
      src: sources.filter((x) => x.enabled).map((x) => x.id),
    });
    if (signature === recommendSignatureRef.current) return;
    recommendSignatureRef.current = signature;
    const runId = ++recommendRunRef.current;
    const isStale = () => runId !== recommendRunRef.current;

    const generateRecommendations = async () => {
      // ---- 提取候选歌手：主歌手归一，过滤过长/过短噪声 ----
      const primaryArtist = (raw?: string) => {
        const name = (raw || "")
          .split(/[/、,，&]| feat\.? | ft\.? /i)[0]
          .trim();
        return name.length >= 2 && name.length <= 15 ? name : "";
      };

      // 近因衰减：以「天」为半衰期，越近的播放权重越高（7 天衰减到约一半）。
      const now = Date.now();
      const recencyFactor = (timestamp?: number) => {
        if (!timestamp) return 0.5;
        const ageDays = Math.max(0, (now - timestamp) / 86_400_000);
        return 0.3 + 0.7 * Math.pow(0.5, ageDays / 7);
      };

      // 完成度：听完整首 → 满权重；早早跳过 → 降权（只有 position 数据时才计算）。
      const completionFactor = (position?: number, duration?: number) => {
        if (!duration || duration <= 0 || position === undefined) return 1;
        const ratio = position / duration;
        if (ratio >= 0.6) return 1;
        if (ratio >= 0.25) return 0.7;
        return 0.4; // 听了不到 1/4 就切走，几乎不算偏好
      };

      // 加权歌手分：历史(次数 × 近因 × 完成度) > 收藏 > 搜索词
      const artistScore = new Map<string, number>();
      const bump = (artist: string, weight: number) => {
        if (!artist || weight <= 0) return;
        artistScore.set(artist, (artistScore.get(artist) || 0) + weight);
      };

      // 1. 播放历史 —— 最强信号
      history.slice(0, 80).forEach((record) => {
        const artist = primaryArtist(record.artist);
        const base = 3 * Math.min(record.playCount || 1, 5);
        bump(
          artist,
          base *
            recencyFactor(record.lastPlayedAt) *
            completionFactor(record.position, record.duration)
        );
      });

      // 2. 收藏 —— 明确的喜好信号
      favorites.slice(0, 60).forEach((song) => {
        bump(primaryArtist(song.artist), 2);
      });

      // 3. 搜索历史 —— 把像歌手名的搜索词也算作信号
      const recentSearchTerms = recentSearches.slice(0, 8);
      recentSearchTerms.forEach((term, index) => {
        if (term.length >= 2 && term.length <= 8 && !/歌|曲|音乐|专辑|榜|热门/.test(term)) {
          // 越靠前的搜索越近，给一点点近因加成
          bump(term, 1.5 * (1 - index * 0.06));
        }
      });

      // 搜索词集合：用于去重，避免「为你推荐」与上方「近期搜索」展示同一个词
      const recentSearchSet = new Set(recentSearches.map((t) => t.trim()));

      const topArtists = Array.from(artistScore.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([artist]) => artist);

      // 推荐里优先放「不是刚搜过」的歌手，已搜过的留作种子但不直接展示
      const keywords = new Set<string>(
        topArtists.filter((artist) => !recentSearchSet.has(artist))
      );

      // ---- 流派偏好：综合历史 / 收藏 / 搜索词 ----
      const genreMap = new Map<string, number>();
      const detectGenre = (text: string, weight: number) => {
        const t = text.toLowerCase();
        if (/民谣|acoustic|folk/.test(t)) genreMap.set("民谣", (genreMap.get("民谣") || 0) + weight);
        if (/摇滚|rock|punk/.test(t)) genreMap.set("摇滚", (genreMap.get("摇滚") || 0) + weight);
        if (/说唱|rap|hip.?hop/.test(t)) genreMap.set("说唱", (genreMap.get("说唱") || 0) + weight);
        if (/古风|国风/.test(t)) genreMap.set("古风", (genreMap.get("古风") || 0) + weight);
        if (/粤语|cantonese/.test(t)) genreMap.set("粤语", (genreMap.get("粤语") || 0) + weight);
        if (/电子|edm|house/.test(t)) genreMap.set("电子", (genreMap.get("电子") || 0) + weight);
        if (/爵士|jazz/.test(t)) genreMap.set("爵士", (genreMap.get("爵士") || 0) + weight);
      };
      history.slice(0, 60).forEach((r) =>
        detectGenre(`${r.title} ${r.artist || ""}`, recencyFactor(r.lastPlayedAt))
      );
      favorites.slice(0, 40).forEach((s) => detectGenre(`${s.title} ${s.artist || ""}`, 0.8));
      recentSearchTerms.forEach((term) => detectGenre(term, 2));

      Array.from(genreMap.entries())
        .filter(([, score]) => score >= 1.5)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .forEach(([genre]) => keywords.add(genre));

      // 没有任何个人信号时，「为你推荐」留空（不退化成热门搜索）
      if (keywords.size === 0 && topArtists.length === 0) {
        if (!isStale()) setRecommendedKeywords([]);
        return;
      }

      // 即时展示（先给出轻量结果，避免等待网络）
      if (keywords.size > 0 && !isStale()) {
        setRecommendedKeywords(Array.from(keywords).slice(0, 6));
      }

      // ---- 异步扩展：挖掘「相关 / 相似」歌手 ----
      // 种子优先用最近一次搜索词 —— 让「为你推荐」明显贴合用户刚搜过的内容；
      // 没有可用搜索词时再退回到历史里分最高的歌手。
      const enabledSourceList = sources.filter((s) => s.enabled);
      const searchSeed = recentSearchTerms.find(
        (term) =>
          term.length >= 2 && term.length <= 8 && !/歌|曲|音乐|专辑|榜|热门/.test(term)
      );
      const seedArtist = searchSeed || topArtists[0];
      if (enabledSourceList.length > 0 && seedArtist && keywords.size < 6) {
        try {
          const searchResults = await searchMusicSources(enabledSourceList, seedArtist, 1, 20);
          const relatedArtists: string[] = [];
          const seen = new Set<string>();
          searchResults.list.forEach((song: MusicSong) => {
            const artist = primaryArtist(song.artist);
            // 排除种子本身、已在推荐里的、以及与搜索词完全相同的（那是「近期搜索」分区的内容）
            if (
              artist &&
              artist !== seedArtist &&
              !keywords.has(artist) &&
              !recentSearchSet.has(artist) &&
              !seen.has(artist)
            ) {
              seen.add(artist);
              relatedArtists.push(artist);
            }
          });
          // 相关歌手放在前面，确保「贴合搜索」的结果优先于历史推荐占满有限的位置
          const merged = new Set<string>([
            ...relatedArtists.slice(0, Math.max(2, 6 - keywords.size)),
            ...keywords,
          ]);
          if (!isStale()) setRecommendedKeywords(Array.from(merged).slice(0, 6));
        } catch {
          // 网络失败时保留即时结果
        }
      }
    };

    void generateRecommendations();
  }, [recentSearches, favorites, history, sources]);

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

  const lyricLines = useMemo(
    () => parseLyric(lyricText, tlyricText),
    [lyricText, tlyricText]
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
  const librarySongs = libraryTab === "favorites" ? favorites : history;

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
          const play = await resolveMusicSource(source, candidate, quality, {
            proxy: proxyEnabled,
          });
          if (requestId !== playRequestRef.current) return "stale";
          const audio = audioRef.current;
          if (audio) {
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
          setCurrentTime(0);
          noteHistory(candidate, 0, candidate.durationSec ?? 0);
          if (audio) {
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
    [noteHistory, proxyEnabled, quality, setCurrentSong, setQueue, sources]
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
        audio.pause();
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
      setQuality,
      sources,
      tlyricText,
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
    [activeSource, activeSourceId, enabledSources, keyword, saveRecentSearch]
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
      } else {
        setBoards([]);
        setBoardSongs([]);
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
    (album: string, artist?: string) => {
      const name = (album || "").trim();
      if (!name) return;
      navigate(
        `/music/album/${encodeURIComponent(name)}${artist ? `?artist=${encodeURIComponent(artist)}` : ""}`
      );
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
    setAlbumLoading(true);
    (async () => {
      try {
        // 没有专辑详情接口：按「专辑名 歌手」搜索，再筛出同专辑曲目。
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
  }, [albumParams?.name, albumParams?.artist, enabledSources.length]);

  const openArtist = useCallback(
    (artist?: string) => {
      const name = (artist || "")
        .split(/[/、,，&]| feat\.? | ft\.? /i)[0]
        .trim();
      if (!name) return;
      navigate(`/music/artist/${encodeURIComponent(name)}`);
    },
    [navigate]
  );

  useEffect(() => {
    if (!artistParams) return;
    if (enabledSources.length === 0) return;
    let cancelled = false;
    setArtistSongs([]);
    setArtistAlbums([]);
    setArtistSimilar([]);
    setArtistLoading(true);
    (async () => {
      try {
        // 没有歌手详情接口：按歌手名搜索，再从结果里聚合热门歌曲、专辑与合作歌手。
        const response = await searchMusicSources(enabledSources, artistParams.name, 1, 60);
        if (cancelled) return;
        const target = normalizeSongText(artistParams.name);
        const songs = dedupeSearchSongs(response.list);
        // 优先展示歌手名匹配的曲目，其它作为补充。
        const primary = songs.filter((song) =>
          normalizeSongText(song.artist).includes(target)
        );
        const ordered = primary.length > 0 ? primary : songs;
        setArtistSongs(ordered);

        // 专辑与发行：按专辑名聚合，每张取首封面。
        const byAlbum = new Map<string, { name: string; cover?: string; song: MusicSong }>();
        ordered.forEach((song) => {
          const name = (song.album || "").trim();
          if (!name) return;
          const key = normalizeSongText(name);
          if (!key) return;
          const entry = byAlbum.get(key);
          if (entry) {
            if (!entry.cover && song.cover) entry.cover = song.cover;
          } else {
            byAlbum.set(key, { name, cover: song.cover, song });
          }
        });
        setArtistAlbums(Array.from(byAlbum.values()).slice(0, 12));

        // 粉丝也喜欢：从结果里的合作歌手聚合（排除歌手本人）。
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
  }, [artistParams?.name, enabledSources.length]);

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
    const link = document.createElement("a");
    link.href = audioUrl;
    link.download = `${safeFilename(currentSong.artist)} - ${safeFilename(currentSong.title)}.mp3`;
    document.body.appendChild(link);
    link.click();
    link.remove();
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

  const isPlayerRoute = view === "player";

  return (
    <div className="music-page relative h-full overflow-hidden bg-ink text-cream">
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

      <div className="relative z-10 h-full min-h-0 flex flex-col overflow-hidden">
        {!isPlayerRoute && (
          <header className="music-topbar shrink-0 px-4 sm:px-6">
            <div className="h-16 flex items-center gap-3">
              <span className="rec-dot" />
              <span className="font-display font-extrabold text-sm tracking-tight">
                DOUY<span style={{ color: "var(--ember)" }}>TV</span>
              </span>
              <nav className="ml-3 flex items-center gap-6 min-w-0 overflow-x-auto scrollbar-hide" aria-label="音乐导航">
                <TextTab active={view === "discover"} onClick={() => setView("discover")}>
                  发现
                </TextTab>
                <TextTab active={view === "songlists" || view === "songlist"} onClick={() => setView("songlists")}>
                  歌单
                </TextTab>
              </nav>

              {/* Search Bar */}
              <div className="ml-auto flex items-center gap-2 sm:gap-3">
                <div className="relative">
                  <div className="search-field-shell music-search-field h-10 w-44 sm:w-64 flex items-center gap-2 px-3">
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
                      placeholder="搜索"
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
              className="fixed overflow-y-auto rounded-xl shadow-2xl z-[999] left-4 right-4 sm:left-auto sm:right-6 sm:w-96 max-h-[calc(100vh-6rem)] sm:max-h-[32rem]"
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

              {/* Personalized Recommendations */}
              {recommendedKeywords.length > 0 && (
                <div className="p-4 border-b" style={{ borderColor: "var(--cream-line)" }}>
                  <h3 className="text-xs font-semibold text-cream-dim mb-3">为你推荐</h3>
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
            activeLyricIndex={activeLyricIndex}
            showSpectrum={showSpectrum}
            sleepTimerEndAt={sleepTimerEndAt}
            sleepRemaining={sleepRemaining}
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
                  onOpenAlbum={(album, artist) => openAlbum(album, artist)}
                  onOpenArtist={(artist) => openArtist(artist)}
                />
              ) : view === "album" ? (
                <AlbumView
                  name={albumParams?.name || "专辑"}
                  artist={albumArtist}
                  songs={albumSongs}
                  loading={albumLoading}
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
                  onDeletePlaylist={(id) => void deletePlaylist(id)}
                  onClearPlaylist={(id) => clearPlaylist(id)}
                  onRemoveFromPlaylist={removeFromPlaylist}
                  librarySongs={librarySongs}
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

      {drawer && (
        <MusicDrawer
          drawer={drawer}
          queue={queue}
          currentSong={currentSong}
          lyricLines={lyricLines}
          activeLyricIndex={activeLyricIndex}
          quality={quality}
          proxyEnabled={proxyEnabled}
          showSpectrum={showSpectrum}
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
          onImportText={setImportText}
          onLxBaseUrl={setLxBaseUrl}
          onLxToken={setLxToken}
          onClose={() => setSourceDialogOpen(false)}
          onImport={() => void handleImport()}
          onAddLx={() => void addLxServer()}
          onToggle={toggleSource}
          onDelete={(source) => void deleteSource(source)}
          onRename={(source, name) => updateSource(source.id, { name })}
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

function DiscoverView({
  source,
  loading,
  currentSong,
  currentCover,
  isPlaying,
  resolving,
  hotSearch,
  boards,
  selectedBoard,
  boardSongs,
  boardLoading,
  songlists,
  onSearch,
  onReload,
  onBoard,
  onPlay,
  onQueue,
  onFavorite,
  isFavorite,
  onAddToPlaylist,
  onOpenSonglist,
  onMore,
}: {
  source?: MusicSourceDescriptor;
  loading: boolean;
  currentSong: MusicSong | null;
  currentCover?: string;
  isPlaying: boolean;
  resolving: boolean;
  hotSearch: MusicHotSearchItem[];
  boards: MusicDiscoveryBoard[];
  selectedBoard: MusicDiscoveryBoard | null;
  boardSongs: MusicSong[];
  boardLoading: boolean;
  songlists: MusicSongListSummary[];
  onSearch: (keyword: string) => void;
  onReload: () => void;
  onBoard: (board: MusicDiscoveryBoard) => void;
  onPlay: (song: MusicSong, songs: MusicSong[]) => void;
  onQueue: (song: MusicSong) => void;
  onFavorite: (song: MusicSong) => void;
  isFavorite: (song: MusicSong) => boolean;
  onAddToPlaylist: (song: MusicSong) => void;
  onOpenSonglist: (item: MusicSongListSummary) => void;
  onMore: () => void;
}) {
  const discoveryRail = useHorizontalRail<HTMLDivElement>();
  const boardRail = useHorizontalRail<HTMLDivElement>();
  if (!source) {
    return (
      <section className="music-empty-hero h-[64vh] grid place-items-center text-center text-cream-dim">
        <div>
          <IconAlbum size={48} className="mx-auto mb-3 text-cream-faint" />
          <p className="font-display font-semibold">发现页需要 LX Music API Server 源</p>
          <p className="mt-1 text-xs text-cream-faint">
            导入 MoonTV 同款 LX 服务后，榜单和热搜会自动显示。
          </p>
        </div>
      </section>
    );
  }

  const heroSong = currentSong || boardSongs[0];
  const heroCover =
    currentCover || (heroSong?.cover ? wrapImage(heroSong.cover) : undefined);
  const heroTitle = heroSong?.title || "为你推荐";
  const heroArtist = heroSong
    ? `${heroSong.artist || "未知歌手"}${heroSong.album ? ` • ${heroSong.album}` : heroSong.sourceName ? ` • ${heroSong.sourceName}` : ""}`
    : "全源聚合音乐发现流";
  const heroPlaying =
    isPlaying && !!currentSong && !!heroSong && musicSongKey(currentSong) === musicSongKey(heroSong);
  const discoveryCards = songlists.slice(0, 8);
  const quickPicks = songlists.slice(8, 14);

  return (
    <div className="music-obsidian-home space-y-12 pb-4">
      {/* 沉浸式正在播放 */}
      <section className="music-ob-hero">
        <div
          aria-hidden
          className="music-ob-hero-bg"
          style={
            heroCover
              ? { backgroundImage: `url(${heroCover})` }
              : { background: "linear-gradient(135deg, rgba(255,107,53,0.22), rgba(79,195,247,0.12))" }
          }
        />
        <div aria-hidden className="music-ob-hero-veil" />
        <div className="music-ob-hero-body">
          <div className="flex items-center gap-3">
            <span className="music-ob-tag">{resolving ? "解析中" : heroPlaying ? "正在播放" : "今日推荐"}</span>
            <span className="text-xs text-cream-dim">{heroArtist}</span>
          </div>
          <h1 className="music-ob-hero-title text-glow">{heroTitle}</h1>
          <div className="flex flex-wrap items-center gap-3">
            {heroSong && (
              <button
                type="button"
                onClick={() => onPlay(heroSong, boardSongs.length ? boardSongs : [heroSong])}
                className="music-ob-play-btn"
              >
                {heroPlaying ? <IconPause size={18} /> : <IconPlay size={18} />}
                {heroPlaying ? "暂停" : "立即播放"}
              </button>
            )}
            <button type="button" onClick={onReload} className="music-ob-ghost-btn">
              <IconRefresh size={16} className={loading ? "animate-spin" : ""} />
              换一批
            </button>
            {heroSong && (
              <button
                type="button"
                onClick={() => onQueue(heroSong)}
                className="music-ob-icon-btn"
                title="加入队列"
              >
                <IconPlus size={18} />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {hotSearch.slice(0, 6).map((item) => (
              <button
                key={`${item.source}:${item.keyword}`}
                type="button"
                onClick={() => onSearch(item.keyword)}
                className="music-soft-chip"
              >
                {item.keyword}
              </button>
            ))}
          </div>
        </div>
        <div className="music-ob-hero-eq" aria-hidden>
          {[60, 100, 80, 40, 90].map((height, index) => (
            <span
              key={index}
              className={heroPlaying ? "is-active" : undefined}
              style={{ height: `${height}%`, animationDelay: `${index * 120}ms` }}
            />
          ))}
        </div>
      </section>

      {/* 新发现 */}
      {discoveryCards.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-end justify-between">
            <h2 className="font-display text-lg font-extrabold text-cream">新发现</h2>
            <button
              type="button"
              onClick={onMore}
              className="text-xs text-ember hover:underline underline-offset-4"
            >
              查看全部
            </button>
          </div>
          <div className="group/rail relative">
            <div
              ref={discoveryRail.ref}
              className="flex gap-5 overflow-x-auto scrollbar-hide pb-2"
            >
              {discoveryCards.map((item) => (
                <button
                  key={`${item.source}:${item.id}`}
                  type="button"
                  onClick={() => onOpenSonglist(item)}
                  className="music-ob-discovery-card group"
                >
                  {item.pic ? (
                    <img
                      src={wrapImage(item.pic)}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                    />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center bg-ink-3 text-cream-faint">
                      <IconAlbum size={40} />
                    </div>
                  )}
                  <span aria-hidden className="music-ob-discovery-veil" />
                  <span className="music-ob-discovery-body">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-ember">
                      精选歌单
                    </span>
                    <span className="line-clamp-1 font-display text-sm font-bold text-cream">
                      {aggregateMusicLabel(item.name, "推荐歌单")}
                    </span>
                    <span className="line-clamp-1 text-xs text-cream-dim">
                      {aggregatePlaylistMeta(item)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            {discoveryRail.canLeft && (
              <button
                type="button"
                onClick={() => discoveryRail.slide(-1)}
                className="music-ob-rail-arrow left-0 -translate-x-1/2"
                aria-label="向左滚动"
              >
                <IconChevronLeft size={20} />
              </button>
            )}
            {discoveryRail.canRight && (
              <button
                type="button"
                onClick={() => discoveryRail.slide(1)}
                className="music-ob-rail-arrow right-0 translate-x-1/2"
                aria-label="向右滚动"
              >
                <IconChevronRight size={20} />
              </button>
            )}
          </div>
        </section>
      )}

      {/* 热门榜单 + 快捷推荐 */}
      <section className="grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-extrabold text-cream">热门榜单</h2>
            <IconButton label="刷新" onClick={onReload}>
              <IconRefresh size={15} className={loading ? "animate-spin" : ""} />
            </IconButton>
          </div>
          <div className="group/rail relative">
            <div
              ref={boardRail.ref}
              className="flex gap-2 overflow-x-auto scrollbar-hide pb-1"
            >
              {boards.map((board) => (
                <FilterChip
                  key={`${board.source}:${board.id}`}
                  active={selectedBoard?.id === board.id && selectedBoard?.source === board.source}
                  onClick={() => onBoard(board)}
                >
                  {aggregateMusicLabel(board.name, "Ranking")}
                </FilterChip>
              ))}
            </div>
            {boardRail.canLeft && (
              <button
                type="button"
                onClick={() => boardRail.slide(-1)}
                className="music-ob-rail-arrow music-ob-rail-arrow-sm left-0 -translate-x-1/2"
                aria-label="向左滚动"
              >
                <IconChevronLeft size={16} />
              </button>
            )}
            {boardRail.canRight && (
              <button
                type="button"
                onClick={() => boardRail.slide(1)}
                className="music-ob-rail-arrow music-ob-rail-arrow-sm right-0 translate-x-1/2"
                aria-label="向右滚动"
              >
                <IconChevronRight size={16} />
              </button>
            )}
          </div>
          {boardLoading ? (
            <div className="music-ob-chart-scroll space-y-2">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="h-[68px] rounded-lg skeleton-shimmer" />
              ))}
            </div>
          ) : boardSongs.length === 0 ? (
            <EmptyBlock text="暂无榜单歌曲" />
          ) : (
            <div className="music-ob-chart-scroll space-y-1">
              {boardSongs.map((song, index) => {
                const active = !!currentSong && musicSongKey(currentSong) === musicSongKey(song);
                const playing = active && isPlaying;
                const favorite = isFavorite(song);
                return (
                  <article
                    key={`${musicSongKey(song)}:${index}`}
                    className="music-ob-chart-row group"
                    style={
                      active
                        ? { background: "rgba(255,107,53,0.10)" }
                        : undefined
                    }
                  >
                    <span
                      className="w-8 text-center font-display text-lg font-bold"
                      style={{ color: active ? "var(--ember)" : "var(--cream-faint)" }}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <button
                      type="button"
                      onClick={() => onPlay(song, boardSongs)}
                      className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg tap"
                      title="播放"
                    >
                      {song.cover ? (
                        <img src={wrapImage(song.cover)} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="grid h-full w-full place-items-center bg-ink-3 text-cream-faint">
                          <IconAlbum size={22} />
                        </span>
                      )}
                      <span className="absolute inset-0 grid place-items-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                        {playing ? <IconPause size={20} /> : <IconPlay size={20} />}
                      </span>
                    </button>
                    <div className="min-w-0 flex-1">
                      <h3
                        className="line-clamp-1 font-display text-sm font-bold"
                        style={{ color: active ? "var(--ember)" : "var(--cream)" }}
                      >
                        {song.title}
                      </h3>
                      <p className="line-clamp-1 text-xs text-cream-dim">{song.artist}</p>
                    </div>
                    <span className="hidden truncate px-4 text-xs text-cream-faint md:block md:max-w-[160px]">
                      {song.album || song.sourceName}
                    </span>
                    <span className="font-mono text-xs text-cream-faint">
                      {song.durationText || formatDuration(song.durationSec)}
                    </span>
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <IconButton label="收藏" active={favorite} onClick={() => onFavorite(song)}>
                        {favorite ? <IconHeartFill size={15} /> : <IconHeart size={15} />}
                      </IconButton>
                      <IconButton label="加入队列" onClick={() => onQueue(song)}>
                        <IconPlus size={15} />
                      </IconButton>
                      <IconButton label="加入歌单" onClick={() => onAddToPlaylist(song)}>
                        <IconBookmark size={15} />
                      </IconButton>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <div className="col-span-12 lg:col-span-4 space-y-4">
          <h2 className="font-display text-lg font-extrabold text-cream">快捷推荐</h2>
          <div className="music-ob-quick-panel space-y-2">
            {quickPicks.length === 0 ? (
              <EmptyBlock text="暂无推荐歌单" />
            ) : (
              <>
                {quickPicks.map((item) => (
                  <button
                    key={`${item.source}:${item.id}`}
                    type="button"
                    onClick={() => onOpenSonglist(item)}
                    className="music-ob-quick-row group"
                  >
                    {item.pic ? (
                      <img src={wrapImage(item.pic)} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-ink-3 text-cream-faint">
                        <IconAlbum size={20} />
                      </span>
                    )}
                    <span className="min-w-0 flex-1 text-left">
                      <span className="line-clamp-1 block font-display text-sm font-bold text-cream">
                        {aggregateMusicLabel(item.name, "推荐歌单")}
                      </span>
                      <span className="line-clamp-1 block text-xs text-cream-faint">
                        {aggregatePlaylistMeta(item)}
                      </span>
                    </span>
                    <span className="text-ember opacity-0 transition-opacity group-hover:opacity-100">
                      <IconPlay size={20} />
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={onMore}
                  className="mt-2 w-full rounded-full border border-cream-line py-3 text-sm font-bold text-cream-dim transition-colors hover:bg-cream-pale"
                >
                  查看全部推荐
                </button>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function SonglistsView({
  source,
  loading,
  songlists,
  tags,
  sorts,
  selectedTag,
  selectedSort,
  keyword,
  searchResults,
  searching,
  onKeyword,
  onSearch,
  onTag,
  onSort,
  onOpenSonglist,
}: {
  source?: MusicSourceDescriptor;
  loading: boolean;
  songlists: MusicSongListSummary[];
  tags: MusicSongListTag[];
  sorts: MusicSongListTag[];
  selectedTag: string;
  selectedSort: string;
  keyword: string;
  searchResults: MusicSongListSummary[] | null;
  searching: boolean;
  onKeyword: (value: string) => void;
  onSearch: (keyword: string) => void;
  onTag: (tagId: string) => void;
  onSort: (sortId: string) => void;
  onOpenSonglist: (item: MusicSongListSummary) => void;
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSearch(keyword);
  };
  if (!source) {
    return (
      <section className="music-empty-hero h-[64vh] grid place-items-center text-center text-cream-dim">
        <div>
          <IconAlbum size={48} className="mx-auto mb-3 text-cream-faint" />
          <p className="font-display font-semibold">歌单需要 LX Music API Server 源</p>
          <p className="mt-1 text-xs text-cream-faint">
            导入 MoonTV 同款 LX 服务后，歌单浏览与搜索会自动可用。
          </p>
        </div>
      </section>
    );
  }
  const searchMode = searchResults !== null;
  const list = searchMode ? searchResults : songlists;
  return (
    <div className="music-songlists-page space-y-5 pb-4">
      <form onSubmit={submit} className="flex gap-2">
        <label className="search-field-shell music-search-field h-11 flex-1 min-w-0 flex items-center gap-2 px-3">
          <IconSearch size={17} className="text-cream-faint shrink-0" />
          <input
            value={keyword}
            onChange={(event) => onKeyword(event.target.value)}
            placeholder="搜索歌单名称、风格、心情"
            className="search-field-input min-w-0 flex-1 bg-transparent text-sm text-cream placeholder:text-cream-faint"
          />
          {keyword && (
            <button
              type="button"
              onClick={() => {
                onKeyword("");
                onSearch("");
              }}
              className="text-cream-faint hover:text-cream"
              title="清除"
            >
              <IconClose size={15} />
            </button>
          )}
        </label>
        <button type="submit" className="music-search-submit !h-11 !w-11" title="搜索歌单">
          {searching ? <IconRefresh size={17} className="animate-spin" /> : <IconSearch size={17} />}
        </button>
      </form>

      {!searchMode && (
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
          <FilterChip active={!selectedTag} onClick={() => onTag("")}>全部</FilterChip>
          {tags.slice(0, 16).map((tag) => (
            <FilterChip key={tag.id} active={selectedTag === tag.id} onClick={() => onTag(tag.id)}>
              {tag.name}
            </FilterChip>
          ))}
          {sorts.slice(0, 4).map((sort) => (
            <FilterChip key={sort.id} active={selectedSort === sort.id} onClick={() => onSort(sort.id)}>
              {sort.name}
            </FilterChip>
          ))}
        </div>
      )}

      <SectionHeader
        title={searchMode ? "歌单搜索结果" : "推荐歌单"}
        meta={list.length > 0 ? `${list.length} 个` : "全源聚合"}
      />

      {loading || searching ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 12 }).map((_, index) => (
            <div key={index} className="aspect-[3/4] rounded-lg skeleton-shimmer" />
          ))}
        </div>
      ) : (
        <PlaylistGrid
          items={list}
          onOpen={onOpenSonglist}
          emptyText={searchMode ? "没有找到匹配的歌单" : "暂无推荐歌单"}
        />
      )}
    </div>
  );
}

function SearchView({
  keyword,
  activeSourceId,
  sources,
  searching,
  results,
  hasMore,
  page,
  currentSong,
  isFavorite,
  onActiveSource,
  onLoadMore,
  onPlay,
  onFavorite,
  onQueue,
  onAddToPlaylist,
  onOpenAlbum,
  onOpenArtist,
  onClose,
}: {
  keyword: string;
  activeSourceId: string;
  sources: MusicSourceDescriptor[];
  searching: boolean;
  results: MusicSong[];
  hasMore: boolean;
  page: number;
  currentSong: MusicSong | null;
  isFavorite: (song: MusicSong) => boolean;
  onActiveSource: (id: string) => void;
  onLoadMore: () => void;
  onPlay: (song: MusicSong) => void;
  onFavorite: (song: MusicSong) => void;
  onQueue: (song: MusicSong) => void;
  onAddToPlaylist: (song: MusicSong) => void;
  onOpenAlbum: (album: string, artist?: string) => void;
  onOpenArtist: (artist: string) => void;
  onClose: () => void;
}) {
  type CategoryType = "all" | "songs" | "artists" | "albums";
  const [category, setCategory] = useState<CategoryType>("all");
  const trimmed = keyword.trim();
  const hasResults = results.length > 0;

  const topSong = results[0];
  const topArtist = useMemo(() => mostCommonArtist(results), [results]);

  const artists = useMemo(() => {
    const map = new Map<string, { name: string; cover?: string; count: number; song: MusicSong }>();
    results.forEach((song) => {
      const name = (song.artist || "").split(/[/、,，&]| feat\.? | ft\.? /i)[0].trim();
      if (!name) return;
      const entry = map.get(name);
      if (entry) {
        entry.count += 1;
        if (!entry.cover && song.cover) entry.cover = song.cover;
      } else {
        map.set(name, { name, cover: song.cover, count: 1, song });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [results]);

  const albums = useMemo(() => {
    const map = new Map<string, { name: string; cover?: string; artist?: string; count: number; song: MusicSong }>();
    results.forEach((song) => {
      const name = (song.album || "").trim();
      if (!name) return;
      const entry = map.get(name);
      if (entry) {
        entry.count += 1;
        if (!entry.cover && song.cover) entry.cover = song.cover;
      } else {
        map.set(name, { name, cover: song.cover, artist: song.artist, count: 1, song });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [results]);

  const showSongs = category === "all" || category === "songs";
  const showArtists = (category === "all" || category === "artists") && artists.length > 0;
  const showAlbums = (category === "all" || category === "albums") && albums.length > 0;
  const songList = category === "songs" ? results : results.slice(0, 8);

  const CATEGORIES: Array<{ id: CategoryType; label: string }> = [
    { id: "all", label: "全部" },
    { id: "songs", label: "歌曲" },
    { id: "artists", label: "艺人" },
    { id: "albums", label: "专辑" },
  ];

  return (
    <div className="music-ob-search space-y-8 pb-4">
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-extrabold sm:text-3xl">
            搜索结果：<span className="text-ember">"{trimmed}"</span>
          </h1>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-lg grid place-items-center tap text-cream-dim hover:text-cream"
            title="关闭搜索"
          >
            <IconClose size={18} />
          </button>
        </div>

        {hasResults && (
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
            {CATEGORIES.map((item) => (
              <FilterChip
                key={item.id}
                active={category === item.id}
                onClick={() => setCategory(item.id)}
              >
                {item.label}
              </FilterChip>
            ))}
          </div>
        )}

        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
          <FilterChip active={activeSourceId === "all"} onClick={() => onActiveSource("all")}>
            全部源
          </FilterChip>
          {sources.map((source) => (
            <FilterChip
              key={source.id}
              active={activeSourceId === source.id}
              onClick={() => onActiveSource(source.id)}
            >
              {source.enabled ? source.name : `停用 / ${source.name}`}
            </FilterChip>
          ))}
        </div>
      </section>

      {searching && !hasResults && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-16 rounded-lg skeleton-shimmer" />
          ))}
        </div>
      )}

      {!searching && !hasResults && (
        <EmptyBlock text="没有搜索结果，试试其他关键词" />
      )}

      {hasResults && (
        <div className="grid grid-cols-12 gap-6">
          {/* 最佳匹配 */}
          {(category === "all" || category === "artists") && topSong && (
            <div className="col-span-12 lg:col-span-5">
              <h2 className="mb-4 font-display text-lg font-bold">最佳匹配</h2>
              <button
                type="button"
                onClick={() => onOpenArtist(topArtist || topSong.artist)}
                className="music-ob-bestmatch group w-full text-left"
              >
                <div className="music-ob-bestmatch-cover">
                  {topSong.cover ? (
                    <img
                      src={wrapImage(topSong.cover)}
                      alt=""
                      className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                    />
                  ) : (
                    <span className="grid h-full w-full place-items-center bg-ink-3 text-cream-faint">
                      <IconArtist size={48} />
                    </span>
                  )}
                  <span className="music-ob-bestmatch-play">
                    <IconPlay size={28} />
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-ember">
                    艺人
                  </span>
                  <h3 className="mt-1 line-clamp-2 font-display text-xl font-extrabold text-cream sm:text-2xl">
                    {topArtist || topSong.artist || topSong.title}
                  </h3>
                  <p className="mt-1 text-sm text-cream-dim">
                    {artists[0] ? `${artists[0].count} 首相关歌曲` : topSong.sourceName}
                  </p>
                </div>
              </button>
            </div>
          )}

          {/* 歌曲 */}
          {showSongs && (
            <div
              className={
                category === "all"
                  ? "col-span-12 lg:col-span-7"
                  : "col-span-12"
              }
            >
              <div className="mb-5 flex items-end justify-between">
                <h2 className="font-display text-lg font-bold">歌曲</h2>
                {category === "all" && results.length > songList.length && (
                  <button
                    type="button"
                    onClick={() => setCategory("songs")}
                    className="text-xs text-ember hover:underline underline-offset-4"
                  >
                    查看全部
                  </button>
                )}
              </div>
              <SongList
                songs={songList}
                activeSong={currentSong}
                emptyText="没有歌曲"
                isFavorite={isFavorite}
                onPlay={onPlay}
                onFavorite={onFavorite}
                onQueue={onQueue}
                onAddToPlaylist={onAddToPlaylist}
              />
            </div>
          )}

          {/* 艺人 */}
          {showArtists && (
            <div className="col-span-12">
              <h2 className="mb-5 font-display text-lg font-bold">艺人</h2>
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {artists.slice(0, category === "artists" ? 24 : 6).map((artist) => (
                  <button
                    key={artist.name}
                    type="button"
                    onClick={() => onOpenArtist(artist.name)}
                    className="group text-center"
                  >
                    <div className="music-ob-artist-cover">
                      {artist.cover ? (
                        <img
                          src={wrapImage(artist.cover)}
                          alt=""
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                        />
                      ) : (
                        <span className="grid h-full w-full place-items-center bg-ink-3 text-cream-faint">
                          <IconArtist size={32} />
                        </span>
                      )}
                    </div>
                    <h3 className="mt-3 line-clamp-1 font-display text-sm font-bold text-cream transition-colors group-hover:text-ember">
                      {artist.name}
                    </h3>
                    <p className="text-xs text-cream-faint">{artist.count} 首</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 专辑 */}
          {showAlbums && (
            <div className="col-span-12">
              <h2 className="mb-5 font-display text-lg font-bold">专辑</h2>
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {albums.slice(0, category === "albums" ? 24 : 6).map((album) => (
                  <button
                    key={album.name}
                    type="button"
                    onClick={() => onOpenAlbum(album.name, album.artist)}
                    className="group text-left"
                  >
                    <div className="music-ob-album-cover">
                      {album.cover ? (
                        <img
                          src={wrapImage(album.cover)}
                          alt=""
                          className="h-full w-full rounded-lg object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                      ) : (
                        <span className="grid h-full w-full place-items-center rounded-lg bg-ink-3 text-cream-faint">
                          <IconAlbum size={32} />
                        </span>
                      )}
                      <span className="music-ob-album-play">
                        <IconPlay size={20} />
                      </span>
                    </div>
                    <h3 className="mt-3 line-clamp-1 font-display text-sm font-semibold text-cream transition-colors group-hover:text-ember">
                      {album.name}
                    </h3>
                    <p className="line-clamp-1 text-xs text-cream-faint">{album.artist || "专辑"}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {hasResults && hasMore && (category === "all" || category === "songs") && (
        <div className="flex justify-center py-3">
          <button
            type="button"
            onClick={onLoadMore}
            className="h-9 px-4 rounded-lg text-xs tap"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          >
            加载更多，第 {page + 1} 页
          </button>
        </div>
      )}
    </div>
  );
}

function LibraryView({
  tab,
  onTab,
  favorites,
  history,
  playlists,
  currentSong,
  isFavorite,
  onPlay,
  onFavorite,
  onQueue,
  onAddToPlaylist,
  onClearHistory,
  onCreatePlaylist,
  onDeletePlaylist,
  onClearPlaylist,
  onRemoveFromPlaylist,
  librarySongs,
}: {
  tab: LibraryTab;
  onTab: (tab: LibraryTab) => void;
  favorites: MusicSong[];
  history: MusicSong[];
  playlists: MusicUserPlaylist[];
  currentSong: MusicSong | null;
  isFavorite: (song: MusicSong) => boolean;
  onPlay: (song: MusicSong, songs: MusicSong[]) => void;
  onFavorite: (song: MusicSong) => void;
  onQueue: (song: MusicSong) => void;
  onAddToPlaylist: (song: MusicSong) => void;
  onClearHistory: () => void;
  onCreatePlaylist: () => void;
  onDeletePlaylist: (id: string) => void;
  onClearPlaylist: (id: string) => void;
  onRemoveFromPlaylist: (id: string, songKey: string) => void;
  librarySongs: MusicSong[];
}) {
  const favoriteCover = favorites.find((song) => song.cover)?.cover;
  const recentCover = history.find((song) => song.cover)?.cover;

  return (
    <div className="music-library space-y-8 pb-4">
      {/* Hero Section: 我的最爱 */}
      <section className="relative overflow-hidden rounded-3xl aspect-[21/9] md:aspect-[3/1] glass-card p-8 md:p-12 flex flex-col justify-end">
        <div className="absolute inset-0 z-0">
          {favoriteCover || recentCover ? (
            <img
              src={wrapImage(favoriteCover || recentCover)}
              alt=""
              className="w-full h-full object-cover opacity-40 scale-110 blur-sm"
            />
          ) : (
            <div className="w-full h-full" style={{ background: "linear-gradient(135deg, rgba(255,107,53,0.22), rgba(79,195,247,0.12))" }} />
          )}
        </div>
        <div className="relative z-10 space-y-4 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border text-label-sm" style={{ background: "rgba(255,107,53,0.2)", borderColor: "rgba(255,107,53,0.3)", color: "var(--ember)" }}>
            <IconHeartFill size={14} />
            <span>专属推荐</span>
          </div>
          <h2 className="font-headline-lg text-headline-lg md:text-display-lg font-extrabold tracking-tight">我的最爱</h2>
          <p className="text-on-surface-variant font-body-md max-w-lg">
            你最常听的 {favorites.length} 首曲目，由 DouyTV 实时更新。
          </p>
          <div className="flex items-center gap-4 pt-4">
            <button
              type="button"
              disabled={favorites.length === 0}
              onClick={() => favorites[0] && onPlay(favorites[0], favorites)}
              className="px-8 py-3 bg-primary text-on-primary-container font-bold rounded-full flex items-center gap-2 hover:scale-105 active:scale-95 transition-transform disabled:opacity-40"
            >
              <IconPlay size={18} />
              <span>立即播放</span>
            </button>
            <button
              type="button"
              disabled={favorites.length === 0}
              onClick={() => {
                if (favorites.length > 0) {
                  const shuffled = [...favorites].sort(() => Math.random() - 0.5);
                  onPlay(shuffled[0], shuffled);
                }
              }}
              className="px-8 py-3 text-white font-bold rounded-full border transition-all disabled:opacity-40"
              style={{ background: "rgba(255,255,255,0.1)", backdropFilter: "blur(8px)", borderColor: "rgba(255,255,255,0.1)" }}
            >
              <span>随机播放</span>
            </button>
          </div>
        </div>
      </section>

      {/* Library Filter Tabs */}
      <div className="flex items-center gap-8 border-b overflow-x-auto scrollbar-hide pb-0" style={{ borderColor: "var(--cream-line)" }}>
        <button
          type="button"
          onClick={() => onTab("favorites")}
          className="pb-4 font-medium whitespace-nowrap transition-colors"
          style={{
            color: tab === "favorites" ? "var(--ember)" : "var(--cream-dim)",
            borderBottom: tab === "favorites" ? "2px solid var(--ember)" : "2px solid transparent",
            fontWeight: tab === "favorites" ? "bold" : "medium",
          }}
        >
          全部
        </button>
        <button
          type="button"
          onClick={() => onTab("playlists")}
          className="pb-4 font-medium whitespace-nowrap transition-colors"
          style={{
            color: tab === "playlists" ? "var(--ember)" : "var(--cream-dim)",
            borderBottom: tab === "playlists" ? "2px solid var(--ember)" : "2px solid transparent",
            fontWeight: tab === "playlists" ? "bold" : "medium",
          }}
        >
          已创建的歌单
        </button>
        <button
          type="button"
          onClick={() => onTab("history")}
          className="pb-4 font-medium whitespace-nowrap transition-colors"
          style={{
            color: tab === "history" ? "var(--ember)" : "var(--cream-dim)",
            borderBottom: tab === "history" ? "2px solid var(--ember)" : "2px solid transparent",
            fontWeight: tab === "history" ? "bold" : "medium",
          }}
        >
          最近播放
        </button>
        <button
          type="button"
          className="pb-4 text-cream-dim font-medium whitespace-nowrap opacity-40 cursor-not-allowed"
          disabled
        >
          下载内容
        </button>
        {tab === "history" && history.length > 0 && (
          <button
            type="button"
            onClick={onClearHistory}
            className="ml-auto pb-4 text-xs text-cream-faint hover:text-ember tap"
          >
            清空历史
          </button>
        )}
        {tab === "playlists" && (
          <button
            type="button"
            onClick={onCreatePlaylist}
            className="ml-auto pb-4 px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 text-xs font-semibold tap"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            <IconPlus size={14} />
            新建歌单
          </button>
        )}
      </div>

      {/* Content based on selected tab */}
      {tab === "playlists" && (
        <>
          {playlists.length === 0 ? (
            <EmptyBlock text="还没有歌单，点击「新建歌单」创建" />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {playlists.map((playlist) => (
                <PlaylistPanel
                  key={playlist.id}
                  playlist={playlist}
                  currentSong={currentSong}
                  isFavorite={isFavorite}
                  onPlay={(song) => onPlay(song, playlist.songs)}
                  onFavorite={onFavorite}
                  onQueue={onQueue}
                  onAddToPlaylist={onAddToPlaylist}
                  onDelete={() => onDeletePlaylist(playlist.id)}
                  onClear={() => onClearPlaylist(playlist.id)}
                  onRemove={(song) => onRemoveFromPlaylist(playlist.id, musicSongKey(song))}
                />
              ))}
            </div>
          )}
        </>
      )}

      {(tab === "favorites" || tab === "history") && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-bold">
              {tab === "favorites" ? "收藏的曲目" : "最近播放的曲目"}
            </h3>
            {librarySongs.length > 10 && (
              <span className="text-xs text-cream-faint">
                显示 {Math.min(20, librarySongs.length)} / {librarySongs.length}
              </span>
            )}
          </div>
          <div className="space-y-1">
            {librarySongs.length === 0 ? (
              <EmptyBlock text={tab === "favorites" ? "还没有收藏歌曲" : "还没有播放历史"} />
            ) : (
              librarySongs.slice(0, 20).map((song, index) => {
                const active = !!currentSong && musicSongKey(currentSong) === musicSongKey(song);
                const favorite = isFavorite(song);
                return (
                  <div
                    key={`${musicSongKey(song)}:${index}`}
                    className="group flex items-center gap-4 p-3 rounded-xl transition-all hover:bg-white/5"
                    style={{ background: active ? "rgba(255,107,53,0.1)" : "transparent" }}
                  >
                    <div className="w-12 h-12 rounded overflow-hidden relative shrink-0" style={{ background: "var(--ink-3)" }}>
                      {song.cover ? (
                        <img
                          src={wrapImage(song.cover)}
                          alt=""
                          className="w-full h-full object-cover"
                          style={{ opacity: 0.5 }}
                        />
                      ) : (
                        <span className="grid h-full w-full place-items-center text-cream-faint">
                          <IconAlbum size={20} />
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => onPlay(song, librarySongs)}
                        className="absolute inset-0 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ background: "rgba(0,0,0,0.6)" }}
                      >
                        <IconPlay size={20} />
                      </button>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-semibold truncate"
                        style={{ color: active ? "var(--ember)" : "var(--cream)" }}
                      >
                        {song.title}
                      </p>
                      <p className="text-xs text-cream-dim truncate">
                        {song.artist} {song.album ? `• ${song.album}` : ""}
                      </p>
                    </div>
                    <div className="hidden md:block text-xs text-cream-faint w-16 text-right">
                      {song.durationText || formatDuration(song.durationSec)}
                    </div>
                    <div className="flex items-center gap-1">
                      <IconButton
                        label="收藏"
                        active={favorite}
                        onClick={() => onFavorite(song)}
                      >
                        {favorite ? <IconHeartFill size={16} /> : <IconHeart size={16} />}
                      </IconButton>
                      <IconButton label="更多" onClick={() => onAddToPlaylist(song)}>
                        <IconBookmark size={16} />
                      </IconButton>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function SourcesView({
  sources,
  activeSourceId,
  onActive,
  onOpen,
  onToggle,
  onDelete,
  onRename,
}: {
  sources: MusicSourceDescriptor[];
  activeSourceId: string;
  onActive: (id: string) => void;
  onOpen: () => void;
  onToggle: (id: string) => void;
  onDelete: (source: MusicSourceDescriptor) => void;
  onRename: (source: MusicSourceDescriptor, name: string) => void;
}) {
  return (
    <div className="space-y-3 pb-4">
      <SectionHeader
        title="音乐源"
        meta={`${sources.filter((item) => item.enabled).length} 个已启用`}
        action={
          <button type="button" onClick={onOpen} className="h-8 px-3 rounded-lg inline-flex items-center gap-1.5 text-xs tap" style={{ background: "var(--ember)", color: "var(--ink)" }}>
            <IconPlus size={14} />
            导入
          </button>
        }
      />
      <div className="space-y-2">
        {sources.length === 0 ? (
          <EmptyBlock text="导入 LX Server、LX JS、MusicFree 或聚合源" />
        ) : (
          sources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              active={activeSourceId === source.id}
              onActive={() => onActive(source.id)}
              onToggle={() => onToggle(source.id)}
              onDelete={() => onDelete(source)}
              onRename={(name) => onRename(source, name)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function PlayerBar({
  currentSong,
  audioUrl,
  currentCover,
  isPlaying,
  isBuffering,
  resolving,
  currentTime,
  duration,
  volume,
  quality,
  playMode,
  queueCount,
  activeLyric,
  showSpectrum,
  sleepRemaining,
  favorite,
  onTogglePlay,
  onPrev,
  onNext,
  onSeek,
  onVolume,
  onQuality,
  onPlayMode,
  onFavorite,
  onDownload,
  onOpenPlayer,
  onOpenQueue,
  onOpenLyrics,
  onOpenSettings,
}: {
  currentSong: MusicSong | null;
  audioUrl: string;
  currentCover?: string;
  isPlaying: boolean;
  isBuffering: boolean;
  resolving: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  quality: MusicQuality;
  playMode: MusicPlayMode;
  queueCount: number;
  activeLyric?: LyricLine;
  showSpectrum: boolean;
  sleepRemaining: number;
  favorite: boolean;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (time: number) => void;
  onVolume: (volume: number) => void;
  onQuality: (quality: MusicQuality) => void;
  onPlayMode: () => void;
  onFavorite: () => void;
  onDownload: () => void;
  onOpenPlayer: () => void;
  onOpenQueue: () => void;
  onOpenLyrics: () => void;
  onOpenSettings: () => void;
}) {
  const safeDuration = duration > 0 && Number.isFinite(duration) ? duration : 0;
  const progressValue = Math.min(currentTime, safeDuration || 1);
  const progressPercent =
    safeDuration > 0 ? Math.min(100, Math.max(0, (progressValue / safeDuration) * 100)) : 0;
  return (
    <footer className="music-player-shell shrink-0">
      <div
        className="music-player music-player-obsidian"
        style={{ "--music-progress": `${progressPercent}%` } as CSSProperties}
      >
        <div className="music-obsidian-progress">
          <span className="music-obsidian-progress-fill" />
          <input
            type="range"
            min={0}
            max={safeDuration || 1}
            value={progressValue}
            onChange={(event) => onSeek(Number(event.target.value))}
            className="music-progress-hitbox"
            title="播放进度"
          />
        </div>

        <div className="music-obsidian-main">
          <div className="music-obsidian-track">
            <button
              type="button"
              onClick={onOpenPlayer}
              className="music-obsidian-cover tap"
              title="播放详情"
            >
              <CoverArt src={currentCover} title={currentSong?.title} size="small" spinning={isPlaying} />
              {showSpectrum && <span className="music-cover-ring" />}
              <span className="music-obsidian-cover-overlay">
                <IconChevronRight size={18} />
              </span>
            </button>
            <button
              type="button"
              onClick={onOpenPlayer}
              className="min-w-0 flex-1 text-left tap"
              title="播放详情"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="line-clamp-1 font-display text-sm font-bold text-cream">
                  {currentSong?.title || "未播放"}
                </span>
                {(resolving || isBuffering) && (
                  <span className="music-status-pill">{resolving ? "解析" : "缓冲"}</span>
                )}
                {sleepRemaining > 0 && (
                  <span className="music-status-pill">睡眠 {formatDuration(sleepRemaining)}</span>
                )}
              </span>
              <span className="mt-1 block line-clamp-1 text-xs text-cream-faint">
                {activeLyric?.text || currentSong?.artist || "导入音乐源后开始播放"}
              </span>
            </button>
            <IconButton label="收藏" active={favorite} onClick={onFavorite}>
              {favorite ? <IconHeartFill size={16} /> : <IconHeart size={16} />}
            </IconButton>
          </div>

          <div className="music-obsidian-controls">
            <IconButton label={PLAY_MODE_LABEL[playMode]} onClick={onPlayMode}>
              {PLAY_MODE_ICON[playMode]}
            </IconButton>
            <IconButton label="上一首" onClick={onPrev}>
              <IconSkipBackward size={24} />
            </IconButton>
            <button
              type="button"
              onClick={onTogglePlay}
              disabled={resolving || (!currentSong && !audioUrl)}
              className="music-obsidian-play disabled:opacity-45"
              title={isPlaying ? "暂停" : "播放"}
            >
              {isPlaying ? <IconPause size={26} /> : <IconPlay size={26} />}
            </button>
            <IconButton label="下一首" onClick={onNext}>
              <IconSkipForward size={24} />
            </IconButton>
          </div>

          <div className="music-obsidian-tools">
            {showSpectrum && <MiniSpectrum active={isPlaying && !isBuffering} />}
            <IconButton label="歌词" onClick={onOpenLyrics}>
              <IconAlbum size={16} />
            </IconButton>
            <IconButton label={`队列 ${queueCount}`} onClick={onOpenQueue}>
              <IconQueue size={16} />
            </IconButton>
            <IconButton label="下载" onClick={onDownload}>
              <IconDownload size={16} />
            </IconButton>
            <div className="music-obsidian-volume">
              {volume <= 0.01 ? <IconVolumeMute size={16} /> : <IconVolume size={16} />}
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(event) => onVolume(Number(event.target.value))}
                title="音量"
              />
            </div>
            <select
              value={quality}
              onChange={(event) => onQuality(event.target.value as MusicQuality)}
              className="music-obsidian-quality"
              title="音质"
            >
              {QUALITY_OPTIONS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <IconButton label="设置" onClick={onOpenSettings}>
              <IconSettings size={16} />
            </IconButton>
          </div>
        </div>
      </div>
    </footer>
  );
}

function SongList({
  songs,
  activeSong,
  activePlaying,
  loading,
  emptyText,
  compact,
  isFavorite,
  onPlay,
  onFavorite,
  onQueue,
  onAddToPlaylist,
  onRemove,
  hideFavorite,
  hideQueue,
}: {
  songs: MusicSong[];
  activeSong: MusicSong | null;
  activePlaying?: boolean;
  loading?: boolean;
  emptyText: string;
  compact?: boolean;
  isFavorite: (song: MusicSong) => boolean;
  onPlay: (song: MusicSong) => void;
  onFavorite: (song: MusicSong) => void;
  onQueue: (song: MusicSong) => void;
  onAddToPlaylist: (song: MusicSong) => void;
  onRemove?: (song: MusicSong) => void;
  hideFavorite?: boolean;
  hideQueue?: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: compact ? 6 : 10 }).map((_, index) => (
          <div key={index} className="h-14 rounded-lg skeleton-shimmer" />
        ))}
      </div>
    );
  }
  if (songs.length === 0) return <EmptyBlock text={emptyText} />;
  return (
    <div className={compact ? "space-y-1.5" : "space-y-2"}>
      {songs.map((song, index) => {
        const active = !!activeSong && musicSongKey(activeSong) === musicSongKey(song);
        const favorite = isFavorite(song);
        return (
          <article
            key={`${musicSongKey(song)}:${index}`}
            className="group rounded-lg px-3 py-2 flex items-center gap-3 transition-colors"
            style={{
              background: active ? "rgba(255,107,53,0.12)" : "rgba(242,232,213,0.045)",
              border: `1px solid ${active ? "rgba(255,107,53,0.38)" : "transparent"}`,
            }}
          >
            <button type="button" onClick={() => onPlay(song)} className="relative tap shrink-0" title="播放">
              <CoverArt src={wrapImage(song.cover)} title={song.title} size={compact ? "tiny" : "list"} />
              <span className="absolute inset-0 grid place-items-center rounded-lg opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: "rgba(0,0,0,0.48)" }}>
                {active && activePlaying ? <IconPause size={17} /> : <IconPlay size={17} />}
              </span>
              {active && activePlaying && (
                <span className="music-row-eq" aria-hidden>
                  <span /><span /><span />
                </span>
              )}
            </button>
            <div className="min-w-0 flex-1">
              <h3
                className="text-sm font-display font-semibold line-clamp-1"
                style={{ color: active ? "var(--ember)" : "var(--cream)" }}
              >
                {song.title}
              </h3>
              <div className="mt-1 flex items-center gap-2 text-xs text-cream-dim min-w-0">
                <span className="line-clamp-1">{song.artist}</span>
                <span className="hidden sm:inline text-cream-faint">/</span>
                <span className="hidden sm:inline line-clamp-1">{song.album || song.sourceName}</span>
              </div>
            </div>
            <span className="hidden sm:inline font-mono text-[11px] text-cream-faint w-12 text-right">
              {song.durationText || formatDuration(song.durationSec)}
            </span>
            <div className="flex items-center gap-1">
              {!hideFavorite && (
                <IconButton label="收藏" active={favorite} onClick={() => onFavorite(song)}>
                  {favorite ? <IconHeartFill size={15} /> : <IconHeart size={15} />}
                </IconButton>
              )}
              {!hideQueue && (
                <IconButton label="加入队列" onClick={() => onQueue(song)}>
                  <IconPlus size={15} />
                </IconButton>
              )}
              <IconButton label="加入歌单" onClick={() => onAddToPlaylist(song)}>
                <IconBookmark size={15} />
              </IconButton>
              {onRemove && (
                <IconButton label="移除" onClick={() => onRemove(song)}>
                  <IconClose size={15} />
                </IconButton>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function PlaylistGrid({
  items,
  onOpen,
  emptyText = "暂无推荐歌单",
}: {
  items: MusicSongListSummary[];
  onOpen: (item: MusicSongListSummary) => void;
  emptyText?: string;
}) {
  if (items.length === 0) return <EmptyBlock text={emptyText} />;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-3">
      {items.map((item) => (
        <button
          key={`${item.source}:${item.id}`}
          type="button"
          onClick={() => onOpen(item)}
          className="text-left rounded-lg overflow-hidden tap group"
          style={{ background: "rgba(242,232,213,0.045)", border: "1px solid var(--cream-line)" }}
        >
          <div className="aspect-square bg-ink-3 overflow-hidden">
            {item.pic ? (
              <img src={wrapImage(item.pic)} alt="" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
            ) : (
              <div className="w-full h-full grid place-items-center text-cream-faint"><IconAlbum size={36} /></div>
            )}
          </div>
          <div className="p-2">
            <p className="text-xs font-display font-semibold line-clamp-2 text-cream min-h-[2rem]">
              {aggregateMusicLabel(item.name, "推荐歌单")}
            </p>
            <p className="mt-1 text-[10px] text-cream-faint line-clamp-1">
              {aggregatePlaylistMeta(item)}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}

function PlaylistPanel({
  playlist,
  onPlay,
  onDelete,
  onClear,
}: {
  playlist: MusicUserPlaylist;
  currentSong: MusicSong | null;
  isFavorite: (song: MusicSong) => boolean;
  onPlay: (song: MusicSong) => void;
  onFavorite: (song: MusicSong) => void;
  onQueue: (song: MusicSong) => void;
  onAddToPlaylist: (song: MusicSong) => void;
  onDelete: () => void;
  onClear: () => void;
  onRemove: (song: MusicSong) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const cover = playlist.cover
    ? wrapImage(playlist.cover)
    : playlist.songs.find((s) => s.cover)?.cover
      ? wrapImage(playlist.songs.find((s) => s.cover)!.cover)
      : undefined;

  return (
    <button
      type="button"
      onClick={() => playlist.songs[0] && onPlay(playlist.songs[0])}
      className="group text-left"
    >
      <div className="aspect-square rounded-xl overflow-hidden relative mb-3" style={{ background: "var(--ink-3)" }}>
        {cover ? (
          <img
            src={cover}
            alt=""
            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
          />
        ) : (
          <div className="grid w-full h-full place-items-center text-cream-faint">
            <IconAlbum size={40} />
          </div>
        )}
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.4)" }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              playlist.songs[0] && onPlay(playlist.songs[0]);
            }}
            className="w-10 h-10 bg-primary rounded-full flex items-center justify-center text-on-primary-container"
          >
            <IconPlay size={20} />
          </button>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          className="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: "rgba(0,0,0,0.6)" }}
        >
          <IconSettings size={14} />
        </button>
        {showMenu && (
          <div
            className="absolute top-10 right-2 rounded-lg shadow-2xl p-1 z-20"
            style={{ background: "var(--ink)", border: "1px solid var(--cream-line)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
                setShowMenu(false);
              }}
              className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-ember-soft hover:text-ember rounded transition-colors w-full text-left whitespace-nowrap"
            >
              <IconTrash size={14} />
              清空歌单
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
                setShowMenu(false);
              }}
              className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-ember-soft hover:text-ember rounded transition-colors w-full text-left whitespace-nowrap"
            >
              <IconClose size={14} />
              删除歌单
            </button>
          </div>
        )}
      </div>
      <h4 className="text-sm font-semibold text-cream truncate">{playlist.name}</h4>
      <p className="text-xs text-cream-faint">{playlist.songs.length} 首歌曲</p>
    </button>
  );
}

function MusicDrawer({
  drawer,
  queue,
  currentSong,
  lyricLines,
  activeLyricIndex,
  quality,
  proxyEnabled,
  showSpectrum,
  sleepTimerEndAt,
  sleepRemaining,
  onClose,
  onPlay,
  onRemoveQueue,
  onClearQueue,
  isFavorite,
  onFavorite,
  onAddToPlaylist,
  onSeek,
  onQuality,
  onProxy,
  onSpectrum,
  onSleep,
}: {
  drawer: Exclude<DrawerView, null>;
  queue: MusicSong[];
  currentSong: MusicSong | null;
  lyricLines: LyricLine[];
  activeLyricIndex: number;
  quality: MusicQuality;
  proxyEnabled: boolean;
  showSpectrum: boolean;
  sleepTimerEndAt: number | null;
  sleepRemaining: number;
  onClose: () => void;
  onPlay: (song: MusicSong) => void;
  onRemoveQueue: (song: MusicSong) => void;
  onClearQueue: () => void;
  isFavorite: (song: MusicSong) => boolean;
  onFavorite: (song: MusicSong) => void;
  onAddToPlaylist: (song: MusicSong) => void;
  onSeek: (time: number) => void;
  onQuality: (quality: MusicQuality) => void;
  onProxy: (enabled: boolean) => void;
  onSpectrum: (enabled: boolean) => void;
  onSleep: (minutes: number) => void;
}) {
  const title =
    drawer === "queue"
      ? "播放队列"
      : drawer === "lyrics"
        ? "沉浸歌词"
        : "音效与设置";
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="关闭" className="absolute inset-0 cursor-default" style={{ background: "rgba(0,0,0,0.58)" }} onClick={onClose} />
      <aside className={drawer === "lyrics" ? "music-drawer music-drawer-wide animate-slide-right" : "music-drawer animate-slide-right"}>
        <header className="h-14 px-4 flex items-center gap-3 shrink-0" style={{ borderBottom: "1px solid var(--cream-line)" }}>
          <h2 className="font-display font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="ml-auto w-9 h-9 rounded-lg grid place-items-center tap text-cream-dim">
            <IconClose size={17} />
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {drawer === "queue" ? (
            <>
              <div className="mb-3 flex items-center gap-2">
                <span className="text-xs text-cream-faint">{queue.length} 首</span>
                {queue.length > 0 && (
                  <button type="button" onClick={onClearQueue} className="ml-auto text-xs text-cream-faint hover:text-ember tap">清空</button>
                )}
              </div>
              <SongList
                songs={queue}
                activeSong={currentSong}
                emptyText="队列为空"
                isFavorite={isFavorite}
                onPlay={onPlay}
                onFavorite={onFavorite}
                onQueue={() => undefined}
                onAddToPlaylist={onAddToPlaylist}
                onRemove={onRemoveQueue}
              />
            </>
          ) : drawer === "lyrics" ? (
            <div className="music-lyrics-stage">
              {lyricLines.length === 0 ? (
                <EmptyBlock text="暂无歌词" />
              ) : (
                lyricLines.map((line, index) => (
                  <button
                    key={`${line.time}:${index}`}
                    type="button"
                    onClick={() => onSeek(line.time)}
                    className={index === activeLyricIndex ? "music-lyric-line music-lyric-line-active" : "music-lyric-line"}
                    style={{
                      color: index === activeLyricIndex ? "var(--cream)" : "var(--cream-faint)",
                    }}
                  >
                    <p className="font-display font-semibold">
                      {line.text || line.trans}
                    </p>
                    {line.trans && <p className="mt-2 text-sm text-cream-faint">{line.trans}</p>}
                  </button>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <SettingRow title="稳定流代理" desc="LX 源默认走本地稳定流，避免只播放试听片段。">
                <Switch checked={proxyEnabled} onChange={onProxy} />
              </SettingRow>
              <SettingRow title="频谱动画" desc="播放时显示轻量音频状态动画。">
                <Switch checked={showSpectrum} onChange={onSpectrum} />
              </SettingRow>
              <section>
                <h3 className="font-display text-sm font-semibold mb-2">音质</h3>
                <div className="grid grid-cols-2 gap-2">
                  {QUALITY_OPTIONS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onQuality(item.id)}
                      className="h-10 rounded-lg text-xs tap"
                      style={{
                        background: quality === item.id ? "var(--ember-soft)" : "var(--ink-2)",
                        color: quality === item.id ? "var(--ember)" : "var(--cream-dim)",
                        border: `1px solid ${quality === item.id ? "var(--ember)" : "var(--cream-line)"}`,
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <h3 className="font-display text-sm font-semibold mb-2">睡眠定时</h3>
                <div className="grid grid-cols-4 gap-2">
                  {[0, 15, 30, 60].map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      onClick={() => onSleep(minutes)}
                      className="h-10 rounded-lg text-xs tap"
                      style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
                    >
                      {minutes === 0 ? "关闭" : `${minutes}分`}
                    </button>
                  ))}
                </div>
                {sleepTimerEndAt && (
                  <p className="mt-2 text-xs text-cream-faint">剩余 {formatDuration(sleepRemaining)} 后暂停</p>
                )}
              </section>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function SourceDialog({
  sources,
  importText,
  lxBaseUrl,
  lxToken,
  onImportText,
  onLxBaseUrl,
  onLxToken,
  onClose,
  onImport,
  onAddLx,
  onToggle,
  onDelete,
  onRename,
}: {
  sources: MusicSourceDescriptor[];
  importText: string;
  lxBaseUrl: string;
  lxToken: string;
  onImportText: (value: string) => void;
  onLxBaseUrl: (value: string) => void;
  onLxToken: (value: string) => void;
  onClose: () => void;
  onImport: () => void;
  onAddLx: () => void;
  onToggle: (id: string) => void;
  onDelete: (source: MusicSourceDescriptor) => void;
  onRename: (source: MusicSourceDescriptor, name: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <button type="button" aria-label="关闭" className="absolute inset-0 cursor-default" style={{ background: "rgba(0,0,0,0.68)" }} onClick={onClose} />
      <section className="relative w-full max-w-3xl max-h-full overflow-hidden rounded-xl flex flex-col" style={{ background: "rgba(22,24,29,0.98)", border: "1px solid var(--cream-line)", boxShadow: "0 28px 90px -35px rgba(0,0,0,0.9)" }}>
        <header className="h-14 px-4 flex items-center gap-3 shrink-0" style={{ borderBottom: "1px solid var(--cream-line)" }}>
          <IconSettings size={19} style={{ color: "var(--ember)" }} />
          <h2 className="font-display font-bold">音乐源管理</h2>
          <button type="button" onClick={onClose} className="ml-auto w-9 h-9 rounded-lg grid place-items-center tap text-cream-dim">
            <IconClose size={17} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <section>
            <h3 className="text-sm font-display font-bold mb-2">添加 LX Music API Server</h3>
            <div className="grid md:grid-cols-[1fr_180px_auto] gap-2">
              <input value={lxBaseUrl} onChange={(event) => onLxBaseUrl(event.target.value)} placeholder="http://35.208.239.12:9527/" className="h-10 rounded-lg px-3 bg-ink text-sm outline-none text-cream" style={{ border: "1px solid var(--cream-line)" }} />
              <input value={lxToken} onChange={(event) => onLxToken(event.target.value)} placeholder="Token（可选）" className="h-10 rounded-lg px-3 bg-ink text-sm outline-none text-cream" style={{ border: "1px solid var(--cream-line)" }} />
              <button type="button" onClick={onAddLx} className="h-10 px-4 rounded-lg text-xs font-display font-bold tap" style={{ background: "var(--ember)", color: "var(--ink)" }}>添加</button>
            </div>
          </section>
          <section>
            <h3 className="text-sm font-display font-bold mb-2">导入插件 / 聚合源</h3>
            <textarea
              value={importText}
              onChange={(event) => onImportText(event.target.value)}
              placeholder="粘贴 lx-music-source / MusicFree 插件源码、JS URL、LX Server URL，或 aggregate-http JSON 配置"
              className="w-full h-32 rounded-lg p-3 bg-ink text-sm text-cream outline-none resize-none"
              style={{ border: "1px solid var(--cream-line)" }}
            />
            <div className="mt-2 flex items-center gap-2">
              <p className="text-xs text-cream-faint flex-1">
                当前优先兼容 LX API Server；JS/MusicFree/聚合源保留统一导入入口。
              </p>
              <button type="button" onClick={onImport} className="h-9 px-4 rounded-lg text-xs font-display font-bold tap" style={{ background: "var(--vhs)", color: "var(--ink)" }}>导入</button>
            </div>
          </section>
          <section>
            <h3 className="text-sm font-display font-bold mb-2">已安装源</h3>
            <div className="space-y-2">
              {sources.length === 0 ? (
                <EmptyBlock text="暂无音乐源" />
              ) : (
                sources.map((source) => (
                  <SourceRow
                    key={source.id}
                    source={source}
                    active={false}
                    onActive={() => undefined}
                    onToggle={() => onToggle(source.id)}
                    onDelete={() => onDelete(source)}
                    onRename={(name) => onRename(source, name)}
                  />
                ))
              )}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

function SourceRow({
  source,
  active,
  onActive,
  onToggle,
  onDelete,
  onRename,
}: {
  source: MusicSourceDescriptor;
  active: boolean;
  onActive: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}) {
  return (
    <article className="rounded-lg px-3 py-3 flex items-center gap-3" style={{ background: active ? "rgba(255,107,53,0.10)" : "rgba(242,232,213,0.045)", border: `1px solid ${active ? "rgba(255,107,53,0.38)" : "transparent"}` }}>
      <button type="button" onClick={onActive} className="w-9 h-9 rounded-lg grid place-items-center shrink-0 tap" style={{ background: source.enabled ? "var(--phosphor-soft)" : "rgba(242,232,213,0.05)", color: source.enabled ? "var(--phosphor)" : "var(--cream-faint)" }}>
        {source.enabled ? <IconCheck size={16} /> : <IconSettings size={16} />}
      </button>
      <div className="min-w-0 flex-1">
        <input value={source.name} onChange={(event) => onRename(event.target.value)} className="w-full bg-transparent text-sm font-display font-semibold text-cream outline-none" />
        <p className="text-xs text-cream-faint line-clamp-1">
          {source.kind} {source.baseUrl ? `/ ${source.baseUrl}` : source.description || ""}
        </p>
      </div>
      <button type="button" onClick={onToggle} className="h-8 px-3 rounded-lg text-xs tap" style={{ background: source.enabled ? "var(--phosphor-soft)" : "var(--ink-3)", color: source.enabled ? "var(--phosphor)" : "var(--cream-dim)" }}>
        {source.enabled ? "启用" : "停用"}
      </button>
      <IconButton label="删除" onClick={onDelete}>
        <IconTrash size={15} />
      </IconButton>
    </article>
  );
}

function AddToPlaylistDialog({
  song,
  playlists,
  newPlaylistName,
  onName,
  onClose,
  onAdd,
  onCreate,
}: {
  song: MusicSong;
  playlists: MusicUserPlaylist[];
  newPlaylistName: string;
  onName: (value: string) => void;
  onClose: () => void;
  onAdd: (playlistId: string) => void;
  onCreate: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <button type="button" aria-label="关闭" className="absolute inset-0 cursor-default" style={{ background: "rgba(0,0,0,0.68)" }} onClick={onClose} />
      <section className="relative w-full max-w-md rounded-xl overflow-hidden" style={{ background: "rgba(22,24,29,0.98)", border: "1px solid var(--cream-line)" }}>
        <header className="h-14 px-4 flex items-center gap-3" style={{ borderBottom: "1px solid var(--cream-line)" }}>
          <h2 className="font-display font-bold">加入歌单</h2>
          <button type="button" onClick={onClose} className="ml-auto w-9 h-9 rounded-lg grid place-items-center tap text-cream-dim"><IconClose size={17} /></button>
        </header>
        <div className="p-4 space-y-3">
          <p className="text-sm text-cream-dim line-clamp-1">{song.title} / {song.artist}</p>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {playlists.map((playlist) => (
              <button key={playlist.id} type="button" onClick={() => onAdd(playlist.id)} className="w-full h-10 px-3 rounded-lg flex items-center gap-2 text-left tap" style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}>
                <IconBookmark size={15} />
                <span className="min-w-0 flex-1 text-sm line-clamp-1">{playlist.name}</span>
                <span className="text-xs text-cream-faint">{playlist.songs.length}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={newPlaylistName} onChange={(event) => onName(event.target.value)} placeholder="新建歌单名称" className="h-10 min-w-0 flex-1 rounded-lg px-3 bg-ink text-sm text-cream" style={{ border: "1px solid var(--cream-line)" }} />
            <button type="button" onClick={onCreate} className="h-10 px-4 rounded-lg text-xs font-display font-bold tap" style={{ background: "var(--ember)", color: "var(--ink)" }}>新建并加入</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function SonglistView({
  item,
  songs,
  loading,
  currentSong,
  isPlaying,
  isFavorite,
  relatedArtist,
  relatedWorks,
  onBack,
  onPlay,
  onPlayAll,
  onFavorite,
  onQueue,
  onAddToPlaylist,
  onPlayRelated,
}: {
  item: MusicSongListSummary | null;
  songs: MusicSong[];
  loading: boolean;
  currentSong: MusicSong | null;
  isPlaying: boolean;
  isFavorite: (song: MusicSong) => boolean;
  relatedArtist: string;
  relatedWorks: MusicSong[];
  onBack: () => void;
  onPlay: (song: MusicSong) => void;
  onPlayAll: () => void;
  onFavorite: (song: MusicSong) => void;
  onQueue: (song: MusicSong) => void;
  onAddToPlaylist: (song: MusicSong) => void;
  onPlayRelated: (song: MusicSong) => void;
}) {
  const cover = item?.pic ? wrapImage(item.pic) : undefined;
  const total = songs.length || (typeof item?.total === "number" ? item.total : undefined);
  return (
    <div className="music-detail-page space-y-5 pb-4">
      <section className="music-songlist-hero">
        <div
          aria-hidden
          className="music-songlist-hero-bg"
          style={
            cover
              ? { background: `url(${cover}) center/cover` }
              : { background: "linear-gradient(135deg, rgba(255,107,53,0.18), rgba(79,195,247,0.1))" }
          }
        />
        <div aria-hidden className="music-songlist-hero-veil" />
        <div className="music-songlist-hero-body">
          <button type="button" onClick={onBack} className="music-back-btn" title="返回">
            <IconArrowLeft size={18} />
          </button>
          <div className="flex items-end gap-4 sm:gap-5">
            <div className="music-songlist-cover">
              {cover ? (
                <img src={cover} alt="" className="h-full w-full object-cover" />
              ) : (
                <IconAlbum size={48} className="text-cream-faint" />
              )}
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <p className="font-mono text-[10px] font-semibold tracking-[0.18em] text-cream-dim">
                PLAYLIST
              </p>
              <h1 className="mt-1 line-clamp-2 font-display text-xl font-extrabold leading-tight sm:text-3xl">
                {aggregateMusicLabel(item?.name, "推荐歌单")}
              </h1>
              <p className="mt-2 line-clamp-1 text-xs text-cream-faint sm:text-sm">
                {item ? aggregatePlaylistMeta(item) : ""}
                {total ? ` · ${total} 首` : ""}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onPlayAll}
                  disabled={songs.length === 0}
                  className="music-primary-action disabled:opacity-40"
                >
                  <IconPlay size={16} />
                  播放全部
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {item?.desc && (
        <p className="px-1 text-xs leading-relaxed text-cream-faint line-clamp-3">{item.desc}</p>
      )}

      <section className="music-panel">
        <SongList
          songs={songs}
          activeSong={currentSong}
          activePlaying={isPlaying}
          loading={loading}
          emptyText="歌单暂无歌曲"
          isFavorite={isFavorite}
          onPlay={onPlay}
          onFavorite={onFavorite}
          onQueue={onQueue}
          onAddToPlaylist={onAddToPlaylist}
        />
      </section>

      {relatedWorks.length > 0 && (
        <section>
          <SectionHeader
            title={relatedArtist ? `${relatedArtist} 的更多作品` : "更多作品"}
            meta="相关推荐"
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {relatedWorks.map((song, index) => {
              const active = !!currentSong && musicSongKey(currentSong) === musicSongKey(song);
              return (
                <button
                  key={`${musicSongKey(song)}:${index}`}
                  type="button"
                  onClick={() => onPlayRelated(song)}
                  className="group text-left rounded-lg overflow-hidden tap"
                  style={{
                    background: "rgba(242,232,213,0.045)",
                    border: `1px solid ${active ? "rgba(255,107,53,0.38)" : "var(--cream-line)"}`,
                  }}
                >
                  <div className="relative aspect-square bg-ink-3 overflow-hidden">
                    {song.cover ? (
                      <img
                        src={wrapImage(song.cover)}
                        alt=""
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-cream-faint">
                        <IconAlbum size={32} />
                      </div>
                    )}
                    <span
                      className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ background: "rgba(0,0,0,0.42)" }}
                    >
                      {active && isPlaying ? <IconPause size={20} /> : <IconPlay size={20} />}
                    </span>
                  </div>
                  <div className="p-2">
                    <p
                      className="line-clamp-1 font-display text-xs font-semibold"
                      style={{ color: active ? "var(--ember)" : "var(--cream)" }}
                    >
                      {song.title}
                    </p>
                    <p className="mt-1 line-clamp-1 text-[10px] text-cream-faint">
                      {song.album || song.artist}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function AlbumView({
  name,
  artist,
  cover,
  songs,
  loading,
  currentSong,
  isPlaying,
  isFavorite,
  relatedArtist,
  relatedWorks,
  onBack,
  onPlay,
  onPlayAll,
  onFavorite,
  onQueue,
  onAddToPlaylist,
  onPlayRelated,
  onOpenArtist,
}: {
  name: string;
  artist?: string;
  cover?: string;
  songs: MusicSong[];
  loading: boolean;
  currentSong: MusicSong | null;
  isPlaying: boolean;
  isFavorite: (song: MusicSong) => boolean;
  relatedArtist: string;
  relatedWorks: MusicSong[];
  onBack: () => void;
  onPlay: (song: MusicSong) => void;
  onPlayAll: () => void;
  onFavorite: (song: MusicSong) => void;
  onQueue: (song: MusicSong) => void;
  onAddToPlaylist: (song: MusicSong) => void;
  onPlayRelated: (song: MusicSong) => void;
  onOpenArtist: (artist: string) => void;
}) {
  const heroCover = cover ? wrapImage(cover) : songs.find((s) => s.cover)?.cover ? wrapImage(songs.find((s) => s.cover)!.cover) : undefined;
  const totalSec = songs.reduce((sum, song) => sum + (song.durationSec || 0), 0);
  const albumArtist = artist || relatedArtist || mostCommonArtist(songs);
  return (
    <div className="music-album-page space-y-10 pb-4">
      <section className="music-ob-album-hero">
        <div
          aria-hidden
          className="music-ob-album-hero-bg"
          style={
            heroCover
              ? { backgroundImage: `url(${heroCover})` }
              : { background: "linear-gradient(135deg, rgba(255,107,53,0.22), rgba(79,195,247,0.12))" }
          }
        />
        <div aria-hidden className="music-ob-album-hero-veil" />
        <div className="music-ob-album-hero-body">
          <button type="button" onClick={onBack} className="music-back-btn" title="返回">
            <IconArrowLeft size={18} />
          </button>
          <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-end">
            <div className="music-ob-album-cover-lg">
              {heroCover ? (
                <img src={heroCover} alt="" className="h-full w-full object-cover" />
              ) : (
                <IconAlbum size={64} className="text-cream-faint" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <span className="music-ob-tag">录音室专辑</span>
              <h1 className="mt-3 line-clamp-2 font-display text-xl font-extrabold leading-tight text-cream sm:text-3xl">
                {name}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-cream-dim">
                {albumArtist && (
                  <button
                    type="button"
                    onClick={() => onOpenArtist(albumArtist)}
                    className="font-display font-bold text-cream transition-colors hover:text-ember"
                  >
                    {albumArtist}
                  </button>
                )}
                {songs.length > 0 && (
                  <>
                    <span className="h-1 w-1 rounded-full bg-cream-faint" />
                    <span>
                      {songs.length} 首歌曲{totalSec > 0 ? `, ${formatDuration(totalSec)}` : ""}
                    </span>
                  </>
                )}
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onPlayAll}
                  disabled={songs.length === 0}
                  className="music-ob-play-btn disabled:opacity-40"
                >
                  <IconPlay size={18} />
                  播放专辑
                </button>
                {songs[0] && (
                  <button type="button" onClick={() => onQueue(songs[0])} className="music-ob-icon-btn" title="加入队列">
                    <IconPlus size={18} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="music-panel">
        <SongList
          songs={songs}
          activeSong={currentSong}
          activePlaying={isPlaying}
          loading={loading}
          emptyText="没有找到该专辑的曲目"
          isFavorite={isFavorite}
          onPlay={onPlay}
          onFavorite={onFavorite}
          onQueue={onQueue}
          onAddToPlaylist={onAddToPlaylist}
        />
      </section>

      {relatedWorks.length > 0 && (
        <section>
          <SectionHeader
            title={albumArtist ? `${albumArtist} 的更多作品` : "更多作品"}
            meta="相关专辑"
          />
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {relatedWorks.map((song, index) => (
                <button
                  key={`${musicSongKey(song)}:${index}`}
                  type="button"
                  onClick={() => onPlayRelated(song)}
                  className="group text-left"
                >
                  <div className="music-ob-album-cover">
                    {song.cover ? (
                      <img
                        src={wrapImage(song.cover)}
                        alt=""
                        className="h-full w-full rounded-lg object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <span className="grid h-full w-full place-items-center rounded-lg bg-ink-3 text-cream-faint">
                        <IconAlbum size={32} />
                      </span>
                    )}
                    <span className="music-ob-album-play">
                      <IconPlay size={20} />
                    </span>
                  </div>
                  <h3 className="mt-3 line-clamp-1 font-display text-sm font-semibold text-cream transition-colors group-hover:text-ember">
                    {song.album || song.title}
                  </h3>
                  <p className="line-clamp-1 text-xs text-cream-faint">{song.artist}</p>
                </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ArtistView({
  name,
  songs,
  albums,
  similar,
  loading,
  currentSong,
  isPlaying,
  isFavorite,
  onBack,
  onPlay,
  onPlayAll,
  onFavorite,
  onQueue,
  onAddToPlaylist,
  onOpenAlbum,
  onOpenArtist,
}: {
  name: string;
  songs: MusicSong[];
  albums: Array<{ name: string; cover?: string; song: MusicSong }>;
  similar: Array<{ name: string; cover?: string; count: number; song: MusicSong }>;
  loading: boolean;
  currentSong: MusicSong | null;
  isPlaying: boolean;
  isFavorite: (song: MusicSong) => boolean;
  onBack: () => void;
  onPlay: (song: MusicSong) => void;
  onPlayAll: () => void;
  onFavorite: (song: MusicSong) => void;
  onQueue: (song: MusicSong) => void;
  onAddToPlaylist: (song: MusicSong) => void;
  onOpenAlbum: (album: string, artist?: string) => void;
  onOpenArtist: (artist: string) => void;
}) {
  const [showAllSongs, setShowAllSongs] = useState(false);
  const heroSong = songs.find((song) => song.cover) ?? songs[0];
  const heroCover = heroSong?.cover ? wrapImage(heroSong.cover) : undefined;
  const visibleSongs = showAllSongs ? songs : songs.slice(0, 8);
  return (
    <div className="music-album-page space-y-10 pb-4">
      <section className="music-ob-album-hero">
        <div
          aria-hidden
          className="music-ob-album-hero-bg"
          style={
            heroCover
              ? { backgroundImage: `url(${heroCover})` }
              : { background: "linear-gradient(135deg, rgba(255,107,53,0.22), rgba(79,195,247,0.12))" }
          }
        />
        <div aria-hidden className="music-ob-album-hero-veil" />
        <div className="music-ob-album-hero-body">
          <button type="button" onClick={onBack} className="music-back-btn" title="返回">
            <IconArrowLeft size={18} />
          </button>
          <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-end">
            <div className="music-ob-artist-avatar">
              {heroCover ? (
                <img src={heroCover} alt="" className="h-full w-full object-cover" />
              ) : (
                <IconArtist size={64} className="text-cream-faint" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <span className="music-ob-tag">认证艺术家</span>
              <h1 className="mt-3 line-clamp-2 font-display text-2xl font-extrabold leading-tight text-cream sm:text-4xl">
                {name}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-cream-dim">
                {songs.length > 0 && (
                  <span>
                    {songs.length} 首歌曲{albums.length > 0 ? ` · ${albums.length} 张专辑` : ""}
                  </span>
                )}
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onPlayAll}
                  disabled={songs.length === 0}
                  className="music-ob-play-btn disabled:opacity-40"
                >
                  <IconPlay size={18} />
                  播放热门
                </button>
                {songs[0] && (
                  <button type="button" onClick={() => onQueue(songs[0])} className="music-ob-icon-btn" title="加入队列">
                    <IconPlus size={18} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-12 gap-10">
        <div className="col-span-12 lg:col-span-8 space-y-4">
          <SectionHeader title="热门歌曲" meta={songs.length > 0 ? `${songs.length} 首` : undefined} />
          <SongList
            songs={visibleSongs}
            activeSong={currentSong}
            activePlaying={isPlaying}
            loading={loading}
            emptyText="没有找到这位歌手的歌曲"
            isFavorite={isFavorite}
            onPlay={onPlay}
            onFavorite={onFavorite}
            onQueue={onQueue}
            onAddToPlaylist={onAddToPlaylist}
          />
          {!loading && songs.length > 8 && (
            <button
              type="button"
              onClick={() => setShowAllSongs((value) => !value)}
              className="font-mono text-xs uppercase tracking-[0.18em] text-cream-dim transition-colors hover:text-ember"
            >
              {showAllSongs ? "收起" : "查看全部歌曲"}
            </button>
          )}
        </div>

        <div className="col-span-12 lg:col-span-4 space-y-4">
          <SectionHeader title="粉丝也喜欢" />
          {similar.length === 0 ? (
            <EmptyBlock text="暂无相关歌手" />
          ) : (
            <div className="space-y-2">
              {similar.map((artist) => (
                <button
                  key={artist.name}
                  type="button"
                  onClick={() => onOpenArtist(artist.name)}
                  className="music-ob-quick-row group"
                >
                  <span className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-ink-3">
                    {artist.cover ? (
                      <img src={wrapImage(artist.cover)} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="grid h-full w-full place-items-center text-cream-faint">
                        <IconArtist size={24} />
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="line-clamp-1 block font-display text-sm font-bold text-cream">
                      {artist.name}
                    </span>
                    <span className="line-clamp-1 block text-xs text-cream-faint">
                      {artist.count} 首合作
                    </span>
                  </span>
                  <span className="text-ember opacity-0 transition-opacity group-hover:opacity-100">
                    <IconChevronRight size={20} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {albums.length > 0 && (
        <section>
          <SectionHeader title="专辑与发行" meta={`${albums.length} 张`} />
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {albums.map((album) => (
              <button
                key={album.name}
                type="button"
                onClick={() => onOpenAlbum(album.name, name)}
                className="group text-left"
              >
                <div className="music-ob-album-cover">
                  {album.cover ? (
                    <img
                      src={wrapImage(album.cover)}
                      alt=""
                      className="h-full w-full rounded-lg object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <span className="grid h-full w-full place-items-center rounded-lg bg-ink-3 text-cream-faint">
                      <IconAlbum size={32} />
                    </span>
                  )}
                  <span className="music-ob-album-play">
                    <IconPlay size={20} />
                  </span>
                </div>
                <h3 className="mt-3 line-clamp-1 font-display text-sm font-semibold text-cream transition-colors group-hover:text-ember">
                  {album.name}
                </h3>
                <p className="line-clamp-1 text-xs text-cream-faint">{name}</p>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PlayerView({
  currentSong,
  currentCover,
  isPlaying,
  isBuffering,
  resolving,
  currentTime,
  duration,
  volume,
  quality,
  playMode,
  queue,
  lyricLines,
  activeLyricIndex,
  showSpectrum,
  sleepTimerEndAt,
  sleepRemaining,
  favorite,
  onBack,
  onTogglePlay,
  onPrev,
  onNext,
  onSeek,
  onVolume,
  onQuality,
  onPlayMode,
  onFavorite,
  onDownload,
  onAddToPlaylist,
  onPlayFromQueue,
  onRemoveQueue,
  onClearQueue,
  onSpectrum,
  onSleep,
}: {
  currentSong: MusicSong | null;
  currentCover?: string;
  isPlaying: boolean;
  isBuffering: boolean;
  resolving: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  quality: MusicQuality;
  playMode: MusicPlayMode;
  queue: MusicSong[];
  lyricLines: LyricLine[];
  activeLyricIndex: number;
  showSpectrum: boolean;
  sleepTimerEndAt: number | null;
  sleepRemaining: number;
  favorite: boolean;
  onBack: () => void;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (time: number) => void;
  onVolume: (volume: number) => void;
  onQuality: (quality: MusicQuality) => void;
  onPlayMode: () => void;
  onFavorite: () => void;
  onDownload: () => void;
  onAddToPlaylist: (song: MusicSong) => void;
  onPlayFromQueue: (song: MusicSong) => void;
  onRemoveQueue: (song: MusicSong) => void;
  onClearQueue: () => void;
  onSpectrum: (enabled: boolean) => void;
  onSleep: (minutes: number) => void;
}) {
  const [panel, setPanel] = useState<"lyrics" | "queue">("lyrics");
  const lyricRef = useRef<HTMLDivElement>(null);
  const safeDuration = duration > 0 && Number.isFinite(duration) ? duration : 0;
  const progressValue = Math.min(currentTime, safeDuration || 1);

  useEffect(() => {
    if (panel !== "lyrics") return;
    const stage = lyricRef.current;
    if (!stage) return;
    const active = stage.querySelector<HTMLElement>("[data-active='true']");
    if (active) {
      active.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [activeLyricIndex, panel]);

  return (
    <section className="music-now-playing flex-1 min-h-0">
      <div
        aria-hidden
        className="music-now-bg"
        style={
          currentCover
            ? { backgroundImage: `url(${currentCover})` }
            : undefined
        }
      />
      <div aria-hidden className="music-now-veil" />

      <div className="music-now-inner">
        <header className="music-now-topbar">
          <button type="button" onClick={onBack} className="music-back-btn" title="返回">
            <IconChevronDown size={20} />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p className="font-mono text-[10px] font-semibold tracking-[0.18em] text-cream-dim">
              {resolving ? "解析中" : isBuffering ? "缓冲中" : isPlaying ? "正在播放" : "已暂停"}
            </p>
            <p className="line-clamp-1 text-xs text-cream-faint">
              {currentSong?.sourceName || "DouyTV Music"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => currentSong && onAddToPlaylist(currentSong)}
            className="music-back-btn"
            title="加入歌单"
          >
            <IconBookmark size={18} />
          </button>
        </header>

        <div className="music-now-body">
          <div className="music-now-art-col">
            <div className="music-now-art">
              <CoverArt src={currentCover} title={currentSong?.title} size="detail" spinning={isPlaying} />
              {showSpectrum && isPlaying && (
                <div className="music-now-equalizer" aria-hidden>
                  {Array.from({ length: 14 }).map((_, index) => (
                    <span key={index} style={{ animationDelay: `${index * 70}ms` }} />
                  ))}
                </div>
              )}
            </div>
            <div className="mt-6 w-full max-w-md text-center">
              <h1 className="line-clamp-2 font-display text-xl font-extrabold sm:text-2xl">
                {currentSong?.title || "未播放"}
              </h1>
              <p className="mt-2 line-clamp-1 text-sm text-cream-dim">
                {currentSong?.artist || "选择一首歌开始播放"}
                {currentSong?.album ? ` · ${currentSong.album}` : ""}
              </p>
            </div>
          </div>

          <div className="music-now-panel">
            <div className="music-now-panel-tabs">
              <button
                type="button"
                onClick={() => setPanel("lyrics")}
                className={panel === "lyrics" ? "is-active" : undefined}
              >
                歌词
              </button>
              <button
                type="button"
                onClick={() => setPanel("queue")}
                className={panel === "queue" ? "is-active" : undefined}
              >
                队列 {queue.length > 0 ? queue.length : ""}
              </button>
              {panel === "queue" && queue.length > 0 && (
                <button
                  type="button"
                  onClick={onClearQueue}
                  className="ml-auto text-xs text-cream-faint hover:text-ember tap"
                >
                  清空
                </button>
              )}
            </div>
            {panel === "lyrics" ? (
              <div ref={lyricRef} className="music-now-lyrics">
                {lyricLines.length === 0 ? (
                  <div className="grid h-full place-items-center text-sm text-cream-faint">
                    暂无歌词
                  </div>
                ) : (
                  lyricLines.map((line, index) => (
                    <button
                      key={`${line.time}:${index}`}
                      type="button"
                      data-active={index === activeLyricIndex}
                      onClick={() => onSeek(line.time)}
                      className={
                        index === activeLyricIndex
                          ? "music-now-lyric music-now-lyric-active"
                          : "music-now-lyric"
                      }
                    >
                      <span>
                        {line.text || line.trans}
                      </span>
                      {line.trans && line.text && (
                        <span className="music-now-lyric-trans">{line.trans}</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            ) : (
              <div className="music-now-queue">
                <SongList
                  songs={queue}
                  activeSong={currentSong}
                  activePlaying={isPlaying}
                  compact
                  emptyText="队列为空"
                  isFavorite={() => favorite && false}
                  onPlay={onPlayFromQueue}
                  onFavorite={() => undefined}
                  onQueue={() => undefined}
                  onAddToPlaylist={onAddToPlaylist}
                  onRemove={onRemoveQueue}
                  hideFavorite
                  hideQueue
                />
              </div>
            )}
          </div>
        </div>

        <div className="music-now-controls">
          <div className="music-now-seek">
            <span className="font-mono text-[10px] text-cream-faint">{formatDuration(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={safeDuration || 1}
              value={progressValue}
              onChange={(event) => onSeek(Number(event.target.value))}
              className="music-progress flex-1"
              title="播放进度"
            />
            <span className="font-mono text-[10px] text-cream-faint">{formatDuration(safeDuration)}</span>
          </div>

          <div className="music-now-transport">
            <IconButton label={PLAY_MODE_LABEL[playMode]} onClick={onPlayMode}>
              {PLAY_MODE_ICON[playMode]}
            </IconButton>
            <IconButton label="上一首" onClick={onPrev}>
              <IconSkipBackward size={26} />
            </IconButton>
            <button
              type="button"
              onClick={onTogglePlay}
              disabled={resolving || !currentSong}
              className="music-now-play disabled:opacity-45"
              title={isPlaying ? "暂停" : "播放"}
            >
              {isPlaying ? <IconPause size={30} /> : <IconPlay size={30} />}
            </button>
            <IconButton label="下一首" onClick={onNext}>
              <IconSkipForward size={26} />
            </IconButton>
            <IconButton label="收藏" active={favorite} onClick={onFavorite}>
              {favorite ? <IconHeartFill size={20} /> : <IconHeart size={20} />}
            </IconButton>
          </div>

          <div className="music-now-tools">
            <div className="music-now-volume">
              {volume <= 0.01 ? <IconVolumeMute size={16} /> : <IconVolume size={16} />}
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(event) => onVolume(Number(event.target.value))}
                title="音量"
              />
            </div>
            <select
              value={quality}
              onChange={(event) => onQuality(event.target.value as MusicQuality)}
              className="music-obsidian-quality"
              title="音质"
            >
              {QUALITY_OPTIONS.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.label}
                </option>
              ))}
            </select>
            <IconButton label="下载" onClick={onDownload}>
              <IconDownload size={17} />
            </IconButton>
            <IconButton
              label={showSpectrum ? "关闭频谱" : "开启频谱"}
              active={showSpectrum}
              onClick={() => onSpectrum(!showSpectrum)}
            >
              <IconStats size={17} />
            </IconButton>
            <IconButton
              label={sleepTimerEndAt ? `定时 ${formatDuration(sleepRemaining)}` : "睡眠定时"}
              active={!!sleepTimerEndAt}
              onClick={() => onSleep(sleepTimerEndAt ? 0 : 30)}
            >
              <IconClock size={17} />
            </IconButton>
          </div>
        </div>
      </div>
    </section>
  );
}

function CoverArt({
  src,
  title,
  size = "list",
  spinning,
}: {
  src?: string;
  title?: string;
  size?: "tiny" | "small" | "list" | "hero" | "detail";
  spinning?: boolean;
}) {
  const className =
    size === "detail"
      ? "w-56 h-56 sm:w-72 sm:h-72"
      : size === "hero"
      ? "w-32 h-32 sm:w-44 sm:h-44"
      : size === "list"
        ? "w-12 h-12"
        : size === "small"
          ? "w-11 h-11"
          : "w-10 h-10";
  return (
    <div className={`${className} rounded-lg overflow-hidden shrink-0 grid place-items-center`} style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}>
      {src ? (
        <img src={src} alt={title || ""} className={`w-full h-full object-cover ${spinning ? "music-vinyl-spin rounded-full scale-90" : ""}`} />
      ) : (
        <IconAlbum size={size === "hero" || size === "detail" ? 52 : 24} className="text-cream-faint" />
      )}
    </div>
  );
}

function SectionHeader({ title, meta, action }: { title: string; meta?: string; action?: ReactNode }) {
  return (
    <div className="music-section-header h-10 flex items-center gap-3 mb-2">
      <h2 className="font-display text-base font-bold">{title}</h2>
      {meta && <span className="font-mono text-[10px] text-cream-faint">{meta}</span>}
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

function TextTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="relative h-9 px-1 text-sm font-display tap transition-colors" style={{ color: active ? "var(--cream)" : "var(--cream-faint)" }}>
      {children}
      <span className="absolute left-0 right-0 bottom-1 mx-auto h-0.5 rounded-full transition-all" style={{ width: active ? 20 : 0, background: "var(--ember)", boxShadow: active ? "0 0 8px var(--ember-glow)" : undefined }} />
    </button>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="shrink-0 h-8 px-3 rounded-full text-xs tap" style={{ border: `1px solid ${active ? "var(--ember)" : "var(--cream-line)"}`, color: active ? "var(--ember)" : "var(--cream-dim)", background: active ? "var(--ember-soft)" : "transparent" }}>
      {children}
    </button>
  );
}

function IconButton({ active, label, onClick, children }: { active?: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="w-8 h-8 rounded-lg grid place-items-center tap transition-colors" style={{ color: active ? "var(--ember)" : "var(--cream-dim)", background: active ? "var(--ember-soft)" : "transparent" }}>
      {children}
    </button>
  );
}

function EmptyBlock({ text }: { text: string }) {
  return (
    <div className="h-48 rounded-lg grid place-items-center text-center text-cream-dim" style={{ background: "rgba(242,232,213,0.03)", border: "1px solid var(--cream-line)" }}>
      <div>
        <IconAlbum size={38} className="mx-auto mb-2 text-cream-faint" />
        <p className="text-sm">{text}</p>
      </div>
    </div>
  );
}

function EmptyMusicState({ onOpenSource }: { onOpenSource: () => void }) {
  return (
    <section className="h-[68vh] grid place-items-center text-center">
      <div>
        <IconAlbum size={56} className="mx-auto mb-4 text-cream-faint" />
        <h1 className="font-display text-xl font-bold">还没有音乐源</h1>
        <p className="mt-2 text-sm text-cream-dim max-w-md">
          添加 MoonTV 同款 LX Music API Server 后，搜索、榜单、歌单和完整播放会自动可用。
        </p>
        <button type="button" onClick={onOpenSource} className="mt-5 h-10 px-4 rounded-lg inline-flex items-center gap-2 text-sm font-display font-bold tap" style={{ background: "var(--ember)", color: "var(--ink)" }}>
          <IconPlus size={16} />
          添加音乐源
        </button>
      </div>
    </section>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="w-12 h-7 rounded-full p-1 tap" style={{ background: checked ? "var(--ember)" : "var(--ink-3)" }}>
      <span className="block w-5 h-5 rounded-full transition-transform" style={{ background: checked ? "var(--ink)" : "var(--cream-dim)", transform: checked ? "translateX(20px)" : "translateX(0)" }} />
    </button>
  );
}

function SettingRow({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <div className="rounded-lg p-3 flex items-center gap-3" style={{ background: "rgba(242,232,213,0.045)", border: "1px solid var(--cream-line)" }}>
      <div className="min-w-0 flex-1">
        <h3 className="font-display text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs text-cream-faint">{desc}</p>
      </div>
      {children}
    </div>
  );
}

function MiniSpectrum({ active }: { active: boolean }) {
  return (
    <div className="hidden md:flex h-8 items-end gap-1 px-2" aria-hidden>
      {Array.from({ length: 10 }).map((_, index) => (
        <span
          key={index}
          className="music-visualizer-bar"
          style={{
            height: active ? 8 + ((index * 7) % 20) : 5,
            animationDelay: `${index * 70}ms`,
            opacity: active ? undefined : 0.28,
          }}
        />
      ))}
    </div>
  );
}
