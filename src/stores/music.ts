import { create } from "zustand";
import {
  createBuiltinNeteaseSource,
  createLocalMusicSource,
  createMusicSdkSource,
  musicSongKey,
  normalizeMusicSourceDescriptor,
  type MusicHistoryRecord,
  type MusicPlayMode,
  type MusicQuality,
  type MusicSong,
  type MusicSourceDescriptor,
} from "@/lib/music";
import { UNBLOCK_SOURCES, type UnblockSource } from "@/lib/music/unblock";

export interface MusicUserPlaylistSong extends MusicSong {
  addedAt: number;
}

/** 桌面歌词外观（字号 / 主色（已唱）/ 描边色 / 未唱底色 / 字重 / 背景板透明度 / 逐字填色 / 显示翻译）。 */
export interface DesktopLyricStyle {
  fontSize: number;
  /** 已唱（填充）文字色。 */
  color: string;
  strokeColor: string;
  /** 未唱（底层）文字色。 */
  idleColor: string;
  /** 字重（400~900）。 */
  fontWeight: number;
  /** 背景板透明度 0~1（0=全透明无底板）。 */
  bgOpacity: number;
  /** 逐字卡拉OK填色（true=按词时间逐字填，false=整行线性扫光）。 */
  karaoke: boolean;
  /** 是否显示翻译行。 */
  showTrans: boolean;
}

export const DEFAULT_DESKTOP_LYRIC_STYLE: DesktopLyricStyle = {
  fontSize: 30,
  color: "#FF6B35",
  strokeColor: "#0E0F11",
  idleColor: "#FFFFFF",
  fontWeight: 800,
  bgOpacity: 0,
  karaoke: true,
  showTrans: true,
};

function normalizeDesktopLyricStyle(input?: Partial<DesktopLyricStyle>): DesktopLyricStyle {
  if (!input || typeof input !== "object") return { ...DEFAULT_DESKTOP_LYRIC_STYLE };
  const d = DEFAULT_DESKTOP_LYRIC_STYLE;
  const num = (v: unknown, lo: number, hi: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  return {
    fontSize: num(input.fontSize, 18, 80, d.fontSize),
    color: typeof input.color === "string" ? input.color : d.color,
    strokeColor: typeof input.strokeColor === "string" ? input.strokeColor : d.strokeColor,
    idleColor: typeof input.idleColor === "string" ? input.idleColor : d.idleColor,
    fontWeight: num(input.fontWeight, 400, 900, d.fontWeight),
    bgOpacity: num(input.bgOpacity, 0, 1, d.bgOpacity),
    karaoke: typeof input.karaoke === "boolean" ? input.karaoke : d.karaoke,
    showTrans: typeof input.showTrans === "boolean" ? input.showTrans : d.showTrans,
  };
}

export interface MusicUserPlaylist {
  id: string;
  name: string;
  description?: string;
  cover?: string;
  songs: MusicUserPlaylistSong[];
  createdAt: number;
  updatedAt: number;
}

interface PersistedMusicState {
  sources?: MusicSourceDescriptor[];
  activeSourceId?: string;
  quality?: MusicQuality;
  playMode?: MusicPlayMode;
  volume?: number;
  proxyEnabled?: boolean;
  showSpectrum?: boolean;
  eqEnabled?: boolean;
  eqPreset?: string;
  eqGains?: number[];
  replayGainEnabled?: boolean;
  lyricShowTrans?: boolean;
  lyricShowRoma?: boolean;
  lyricFontScale?: number;
  lyricOffsets?: Record<string, number>;
  desktopLyricStyle?: DesktopLyricStyle;
  sleepTimerEndAt?: number | null;
  sleepAfterCurrent?: boolean;
  playbackRate?: number;
  crossfadeSec?: number;
  queue?: MusicSong[];
  currentSong?: MusicSong | null;
  favorites?: MusicSong[];
  history?: MusicHistoryRecord[];
  playlists?: MusicUserPlaylist[];
  /** 是否已注入过内置网易源（只注一次，尊重用户删除）。 */
  neteaseBuiltinSeeded?: boolean;
  /** 灰曲解灰总开关。 */
  unblockEnabled?: boolean;
  /** 启用的解灰音源（移植自 UNM 的可前端化 provider）。 */
  unblockSources?: string[];
}

interface MusicStore {
  sources: MusicSourceDescriptor[];
  hydrated: boolean;
  activeSourceId: string;
  quality: MusicQuality;
  playMode: MusicPlayMode;
  volume: number;
  proxyEnabled: boolean;
  unblockEnabled: boolean;
  unblockSources: UnblockSource[];
  showSpectrum: boolean;
  eqEnabled: boolean;
  eqPreset: string;
  eqGains: number[];
  replayGainEnabled: boolean;
  lyricShowTrans: boolean;
  lyricShowRoma: boolean;
  lyricFontScale: number;
  lyricOffsets: Record<string, number>;
  desktopLyricStyle: DesktopLyricStyle;
  sleepTimerEndAt: number | null;
  sleepAfterCurrent: boolean;
  playbackRate: number;
  crossfadeSec: number;
  queue: MusicSong[];
  currentSong: MusicSong | null;
  favorites: MusicSong[];
  history: MusicHistoryRecord[];
  playlists: MusicUserPlaylist[];
  neteaseBuiltinSeeded: boolean;
  hydrate: () => void;
  installSource: (source: MusicSourceDescriptor) => void;
  uninstallSource: (id: string) => void;
  updateSource: (id: string, patch: Partial<MusicSourceDescriptor>) => void;
  toggleSource: (id: string) => void;
  setActiveSource: (id: string) => void;
  setQuality: (quality: MusicQuality) => void;
  setPlayMode: (mode: MusicPlayMode) => void;
  setVolume: (volume: number) => void;
  setProxyEnabled: (enabled: boolean) => void;
  setShowSpectrum: (enabled: boolean) => void;
  setUnblockEnabled: (enabled: boolean) => void;
  setUnblockSources: (sources: UnblockSource[]) => void;
  setEqEnabled: (enabled: boolean) => void;
  setEqPreset: (preset: string, gains: number[]) => void;
  setEqGain: (index: number, gain: number) => void;
  setReplayGainEnabled: (enabled: boolean) => void;
  setLyricShowTrans: (show: boolean) => void;
  setLyricShowRoma: (show: boolean) => void;
  setLyricFontScale: (scale: number) => void;
  setLyricOffset: (songKey: string, offset: number) => void;
  setDesktopLyricStyle: (patch: Partial<DesktopLyricStyle>) => void;
  setSleepTimerEndAt: (endAt: number | null) => void;
  setSleepAfterCurrent: (enabled: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  setCrossfadeSec: (sec: number) => void;
  setQueue: (songs: MusicSong[], current?: MusicSong) => void;
  appendToQueue: (song: MusicSong) => void;
  removeFromQueue: (songKey: string) => void;
  clearQueue: () => void;
  setCurrentSong: (song: MusicSong | null) => void;
  isFavorite: (song: MusicSong) => boolean;
  toggleFavorite: (song: MusicSong) => void;
  noteHistory: (song: MusicSong, position: number, duration: number) => void;
  clearHistory: () => void;
  createPlaylist: (name: string, description?: string) => string;
  updatePlaylist: (id: string, patch: Partial<Pick<MusicUserPlaylist, "name" | "description" | "cover">>) => void;
  deletePlaylist: (id: string) => void;
  addToPlaylist: (id: string, song: MusicSong) => void;
  removeFromPlaylist: (id: string, songKey: string) => void;
  clearPlaylist: (id: string) => void;
  isInPlaylist: (id: string, song: MusicSong) => boolean;
  /** WebDAV 拉取后:把远端音乐数据合并进当前 store(收藏/历史/歌单 union 去重),非覆盖。 */
  importMerge: (remote: unknown) => { favorites: number; history: number; playlists: number };
}

const STORAGE_KEY = "douytv:music";
const HISTORY_LIMIT = 300;
const QUEUE_LIMIT = 500;
const PLAYLIST_LIMIT = 1000;
const EQ_BAND_COUNT = 9;

function normalizeEqGains(input?: number[]): number[] {
  const base = Array.from({ length: EQ_BAND_COUNT }, () => 0);
  if (!Array.isArray(input)) return base;
  for (let i = 0; i < EQ_BAND_COUNT; i += 1) {
    const value = input[i];
    if (typeof value === "number" && Number.isFinite(value)) {
      base[i] = Math.min(12, Math.max(-12, value));
    }
  }
  return base;
}

function normalizeUnblockSources(input?: string[]): UnblockSource[] {
  if (!Array.isArray(input)) return [...UNBLOCK_SOURCES];
  const valid = input.filter((s): s is UnblockSource =>
    (UNBLOCK_SOURCES as string[]).includes(s)
  );
  return valid.length > 0 ? valid : [...UNBLOCK_SOURCES];
}

function loadState(): PersistedMusicState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persist(state: MusicStore) {
  const payload: PersistedMusicState = {
    sources: state.sources,
    activeSourceId: state.activeSourceId,
    quality: state.quality,
    playMode: state.playMode,
    volume: state.volume,
    proxyEnabled: state.proxyEnabled,
    showSpectrum: state.showSpectrum,
    eqEnabled: state.eqEnabled,
    eqPreset: state.eqPreset,
    eqGains: state.eqGains,
    replayGainEnabled: state.replayGainEnabled,
    lyricShowTrans: state.lyricShowTrans,
    lyricShowRoma: state.lyricShowRoma,
    lyricFontScale: state.lyricFontScale,
    lyricOffsets: state.lyricOffsets,
    desktopLyricStyle: state.desktopLyricStyle,
    sleepTimerEndAt: state.sleepTimerEndAt,
    sleepAfterCurrent: state.sleepAfterCurrent,
    playbackRate: state.playbackRate,
    crossfadeSec: state.crossfadeSec,
    queue: state.queue,
    currentSong: state.currentSong,
    favorites: state.favorites,
    history: state.history,
    playlists: state.playlists,
    neteaseBuiltinSeeded: state.neteaseBuiltinSeeded,
    unblockEnabled: state.unblockEnabled,
    unblockSources: state.unblockSources,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("[music] persist failed", error);
  }
}

function dedupeSongs<T extends MusicSong>(songs: T[]): T[] {
  const seen = new Set<string>();
  return songs.filter((song) => {
    const key = musicSongKey(song);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createId(prefix: string) {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function normalizePlaylist(input: MusicUserPlaylist): MusicUserPlaylist {
  const now = Date.now();
  const songs = dedupeSongs(input.songs ?? [])
    .slice(0, PLAYLIST_LIMIT)
    .map((song) => ({
      ...song,
      addedAt: typeof song.addedAt === "number" ? song.addedAt : now,
    }));
  return {
    id: input.id || createId("playlist"),
    name: input.name?.trim() || "未命名歌单",
    description: input.description,
    cover: input.cover || songs.find((song) => song.cover)?.cover,
    songs,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
}

function updatePlaylistCover(playlist: MusicUserPlaylist): MusicUserPlaylist {
  return {
    ...playlist,
    cover: playlist.cover || playlist.songs.find((song) => song.cover)?.cover,
  };
}

function ensureActiveSource(activeSourceId: string | undefined, sources: MusicSourceDescriptor[]) {
  if (!activeSourceId) return "all";
  if (activeSourceId === "all") return activeSourceId;
  return sources.some((source) => source.id === activeSourceId) ? activeSourceId : "all";
}

export const useMusicStore = create<MusicStore>((set, get) => ({
  sources: [],
  hydrated: false,
  activeSourceId: "all",
  quality: "320k",
  playMode: "loop",
  volume: 0.82,
  proxyEnabled: true,
  showSpectrum: true,
  eqEnabled: false,
  eqPreset: "flat",
  eqGains: normalizeEqGains(),
  replayGainEnabled: false,
  lyricShowTrans: true,
  lyricShowRoma: true,
  lyricFontScale: 1,
  lyricOffsets: {},
  desktopLyricStyle: { ...DEFAULT_DESKTOP_LYRIC_STYLE },
  sleepTimerEndAt: null,
  sleepAfterCurrent: false,
  playbackRate: 1,
  crossfadeSec: 0,
  queue: [],
  currentSong: null,
  favorites: [],
  history: [],
  playlists: [],
  neteaseBuiltinSeeded: false,
  unblockEnabled: true,
  unblockSources: [...UNBLOCK_SOURCES],
  hydrate: () => {
    if (get().hydrated) return;
    const stored = loadState();
    let sources = (stored.sources ?? []).map((source) =>
      normalizeMusicSourceDescriptor(source)
    );
    // 首次注入一个开箱即用的内置网易源（只注一次，之后尊重用户删除）。
    const seeded = stored.neteaseBuiltinSeeded ?? false;
    if (!seeded && !sources.some((source) => source.kind === "netease-api")) {
      sources = [createBuiltinNeteaseSource(), ...sources];
    }
    // 始终确保内置多平台源(musicSdk)存在:它是免配置的「列表壳子」,
    // 提供发现/榜单/歌单/搜索/歌词(六平台),播放取直链需另启用解析源
    // (洛雪脚本 / OmniParse)。对齐 lx-music-desktop 的内置 musicSdk,常驻不可删。
    if (!sources.some((source) => source.id === "music-sdk-builtin")) {
      sources = [createMusicSdkSource(), ...sources];
    }
    // 始终确保本地音乐源存在(播放本地曲走 directUrl;曲库由 musicLocal store 提供)。
    if (!sources.some((source) => source.id === "music-local")) {
      sources = [...sources, createLocalMusicSource()];
    }
    set({
      sources,
      activeSourceId: ensureActiveSource(stored.activeSourceId, sources),
      quality: stored.quality ?? "320k",
      playMode: stored.playMode ?? "loop",
      volume:
        typeof stored.volume === "number"
          ? Math.min(1, Math.max(0, stored.volume))
          : 0.82,
      proxyEnabled: stored.proxyEnabled ?? true,
      showSpectrum: stored.showSpectrum ?? true,
      eqEnabled: stored.eqEnabled ?? false,
      eqPreset: stored.eqPreset ?? "flat",
      eqGains: normalizeEqGains(stored.eqGains),
      replayGainEnabled: stored.replayGainEnabled ?? false,
      lyricShowTrans: stored.lyricShowTrans ?? true,
      lyricShowRoma: stored.lyricShowRoma ?? true,
      lyricFontScale:
        typeof stored.lyricFontScale === "number"
          ? Math.min(1.6, Math.max(0.7, stored.lyricFontScale))
          : 1,
      lyricOffsets:
        stored.lyricOffsets && typeof stored.lyricOffsets === "object"
          ? stored.lyricOffsets
          : {},
      desktopLyricStyle: normalizeDesktopLyricStyle(stored.desktopLyricStyle),
      sleepTimerEndAt:
        typeof stored.sleepTimerEndAt === "number" && stored.sleepTimerEndAt > Date.now()
          ? stored.sleepTimerEndAt
          : null,
      sleepAfterCurrent: stored.sleepAfterCurrent ?? false,
      playbackRate:
        typeof stored.playbackRate === "number"
          ? Math.min(3, Math.max(0.5, stored.playbackRate))
          : 1,
      crossfadeSec:
        typeof stored.crossfadeSec === "number"
          ? Math.min(12, Math.max(0, stored.crossfadeSec))
          : 0,
      queue: dedupeSongs(stored.queue ?? []).slice(0, QUEUE_LIMIT),
      currentSong: stored.currentSong ?? null,
      favorites: dedupeSongs(stored.favorites ?? []),
      history: (stored.history ?? []).slice(0, HISTORY_LIMIT),
      playlists: (stored.playlists ?? []).map(normalizePlaylist),
      unblockEnabled: stored.unblockEnabled ?? true,
      unblockSources: normalizeUnblockSources(stored.unblockSources),
      neteaseBuiltinSeeded: true,
      hydrated: true,
    });
    // 锁定首次注入结果（内置网易源 + seeded 标记），避免下次重复注入。
    if (!seeded) persist(get());
  },
  installSource: (source) => {
    const normalized = normalizeMusicSourceDescriptor(source);
    const next = [
      normalized,
      ...get().sources.filter((item) => item.id !== normalized.id),
    ];
    set({ sources: next, activeSourceId: normalized.id });
    persist(get());
  },
  uninstallSource: (id) => {
    const next = get().sources.filter((source) => source.id !== id);
    set({ sources: next, activeSourceId: ensureActiveSource(get().activeSourceId, next) });
    persist(get());
  },
  updateSource: (id, patch) => {
    const next = get().sources.map((source) =>
      source.id === id
        ? normalizeMusicSourceDescriptor({ ...source, ...patch, id })
        : source
    );
    set({ sources: next });
    persist(get());
  },
  toggleSource: (id) => {
    const next = get().sources.map((source) =>
      source.id === id
        ? { ...source, enabled: !source.enabled, updatedAt: Date.now() }
        : source
    );
    set({ sources: next });
    persist(get());
  },
  setActiveSource: (id) => {
    set({ activeSourceId: id });
    persist(get());
  },
  setQuality: (quality) => {
    set({ quality });
    persist(get());
  },
  setPlayMode: (playMode) => {
    set({ playMode });
    persist(get());
  },
  setVolume: (volume) => {
    set({ volume: Math.min(1, Math.max(0, volume)) });
    persist(get());
  },
  setProxyEnabled: (proxyEnabled) => {
    set({ proxyEnabled });
    persist(get());
  },
  setShowSpectrum: (showSpectrum) => {
    set({ showSpectrum });
    persist(get());
  },
  setUnblockEnabled: (unblockEnabled) => {
    set({ unblockEnabled });
    persist(get());
  },
  setUnblockSources: (sources) => {
    set({ unblockSources: normalizeUnblockSources(sources) });
    persist(get());
  },
  setEqEnabled: (eqEnabled) => {
    set({ eqEnabled });
    persist(get());
  },
  setEqPreset: (eqPreset, gains) => {
    set({ eqPreset, eqGains: normalizeEqGains(gains) });
    persist(get());
  },
  setEqGain: (index, gain) => {
    const next = [...get().eqGains];
    if (index >= 0 && index < next.length) {
      next[index] = Math.min(12, Math.max(-12, gain));
      // 手动调任一频段即视为自定义。
      set({ eqGains: next, eqPreset: "custom" });
      persist(get());
    }
  },
  setReplayGainEnabled: (replayGainEnabled) => {
    set({ replayGainEnabled });
    persist(get());
  },
  setSleepTimerEndAt: (sleepTimerEndAt) => {
    set({ sleepTimerEndAt });
    persist(get());
  },
  setSleepAfterCurrent: (sleepAfterCurrent) => {
    // 「播完当前曲」与定时互斥:开启播完即停时清掉倒计时。
    set({ sleepAfterCurrent, sleepTimerEndAt: sleepAfterCurrent ? null : get().sleepTimerEndAt });
    persist(get());
  },
  setPlaybackRate: (rate) => {
    set({ playbackRate: Math.min(3, Math.max(0.5, rate)) });
    persist(get());
  },
  setCrossfadeSec: (sec) => {
    set({ crossfadeSec: Math.min(12, Math.max(0, Math.round(sec))) });
    persist(get());
  },
  setLyricShowTrans: (lyricShowTrans) => {
    set({ lyricShowTrans });
    persist(get());
  },
  setLyricShowRoma: (lyricShowRoma) => {
    set({ lyricShowRoma });
    persist(get());
  },
  setLyricFontScale: (scale) => {
    set({ lyricFontScale: Math.min(1.6, Math.max(0.7, scale)) });
    persist(get());
  },
  setLyricOffset: (songKey, offset) => {
    const clamped = Math.min(10, Math.max(-10, offset));
    const next = { ...get().lyricOffsets };
    if (Math.abs(clamped) < 0.05) delete next[songKey];
    else next[songKey] = Math.round(clamped * 10) / 10;
    set({ lyricOffsets: next });
    persist(get());
  },
  setDesktopLyricStyle: (patch) => {
    set({ desktopLyricStyle: normalizeDesktopLyricStyle({ ...get().desktopLyricStyle, ...patch }) });
    persist(get());
  },
  setQueue: (songs, current) => {
    set({
      queue: dedupeSongs(songs).slice(0, QUEUE_LIMIT),
      currentSong: current ?? songs[0] ?? null,
    });
    persist(get());
  },
  appendToQueue: (song) => {
    const next = dedupeSongs([...get().queue, song]).slice(0, QUEUE_LIMIT);
    set({ queue: next });
    persist(get());
  },
  removeFromQueue: (songKey) => {
    const next = get().queue.filter((song) => musicSongKey(song) !== songKey);
    const current = get().currentSong;
    set({
      queue: next,
      currentSong:
        current && musicSongKey(current) === songKey
          ? next[0] ?? null
          : current,
    });
    persist(get());
  },
  clearQueue: () => {
    set({ queue: [], currentSong: null });
    persist(get());
  },
  setCurrentSong: (currentSong) => {
    set({ currentSong });
    persist(get());
  },
  isFavorite: (song) =>
    get().favorites.some((item) => musicSongKey(item) === musicSongKey(song)),
  toggleFavorite: (song) => {
    const key = musicSongKey(song);
    const exists = get().favorites.some((item) => musicSongKey(item) === key);
    const favorites = exists
      ? get().favorites.filter((item) => musicSongKey(item) !== key)
      : [song, ...get().favorites];
    set({ favorites });
    persist(get());
  },
  noteHistory: (song, position, duration) => {
    const key = musicSongKey(song);
    const existing = get().history.find((item) => musicSongKey(item) === key);
    const countAsNewPlay =
      !existing || Date.now() - existing.lastPlayedAt > 30_000;
    const record: MusicHistoryRecord = {
      ...song,
      position,
      duration,
      playCount: (existing?.playCount ?? 0) + (countAsNewPlay ? 1 : 0),
      lastPlayedAt: Date.now(),
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      lastQuality: get().quality,
    };
    const history = [
      record,
      ...get().history.filter((item) => musicSongKey(item) !== key),
    ].slice(0, HISTORY_LIMIT);
    set({ history });
    persist(get());
  },
  clearHistory: () => {
    set({ history: [] });
    persist(get());
  },
  createPlaylist: (name, description) => {
    const id = createId("playlist");
    const now = Date.now();
    const playlist: MusicUserPlaylist = {
      id,
      name: name.trim() || "未命名歌单",
      description: description?.trim() || undefined,
      songs: [],
      createdAt: now,
      updatedAt: now,
    };
    set({ playlists: [playlist, ...get().playlists] });
    persist(get());
    return id;
  },
  updatePlaylist: (id, patch) => {
    const now = Date.now();
    const playlists = get().playlists.map((playlist) =>
      playlist.id === id
        ? updatePlaylistCover({
            ...playlist,
            ...patch,
            name: patch.name?.trim() || playlist.name,
            description:
              patch.description !== undefined
                ? patch.description.trim() || undefined
                : playlist.description,
            updatedAt: now,
          })
        : playlist
    );
    set({ playlists });
    persist(get());
  },
  deletePlaylist: (id) => {
    set({ playlists: get().playlists.filter((playlist) => playlist.id !== id) });
    persist(get());
  },
  addToPlaylist: (id, song) => {
    const key = musicSongKey(song);
    const now = Date.now();
    const playlists = get().playlists.map((playlist) => {
      if (playlist.id !== id) return playlist;
      const exists = playlist.songs.some((item) => musicSongKey(item) === key);
      const songs = exists
        ? playlist.songs
        : [{ ...song, addedAt: now }, ...playlist.songs].slice(0, PLAYLIST_LIMIT);
      return updatePlaylistCover({ ...playlist, songs, updatedAt: now });
    });
    set({ playlists });
    persist(get());
  },
  removeFromPlaylist: (id, songKey) => {
    const now = Date.now();
    const playlists = get().playlists.map((playlist) =>
      playlist.id === id
        ? updatePlaylistCover({
            ...playlist,
            songs: playlist.songs.filter((song) => musicSongKey(song) !== songKey),
            updatedAt: now,
          })
        : playlist
    );
    set({ playlists });
    persist(get());
  },
  clearPlaylist: (id) => {
    const now = Date.now();
    const playlists = get().playlists.map((playlist) =>
      playlist.id === id
        ? { ...playlist, songs: [], cover: undefined, updatedAt: now }
        : playlist
    );
    set({ playlists });
    persist(get());
  },
  isInPlaylist: (id, song) => {
    const playlist = get().playlists.find((item) => item.id === id);
    if (!playlist) return false;
    const key = musicSongKey(song);
    return playlist.songs.some((item) => musicSongKey(item) === key);
  },
  importMerge: (remote) => {
    const state = get();
    const r = (remote && typeof remote === "object" ? remote : {}) as PersistedMusicState;
    const remoteFavorites = Array.isArray(r.favorites) ? r.favorites : [];
    const remoteHistory = Array.isArray(r.history) ? r.history : [];
    const remotePlaylists = Array.isArray(r.playlists) ? r.playlists : [];
    // 收藏:union 去重(本地优先顺序)。
    const favorites = dedupeSongs([...remoteFavorites, ...state.favorites]);
    // 历史:按 key 合并,保留 playCount 较大、lastPlayedAt 较新的。
    const historyMap = new Map<string, MusicHistoryRecord>();
    for (const rec of [...state.history, ...remoteHistory]) {
      const key = musicSongKey(rec);
      const exist = historyMap.get(key);
      if (!exist) {
        historyMap.set(key, rec);
      } else {
        historyMap.set(key, {
          ...exist,
          playCount: Math.max(exist.playCount ?? 0, rec.playCount ?? 0),
          lastPlayedAt: Math.max(exist.lastPlayedAt ?? 0, rec.lastPlayedAt ?? 0),
          position: (rec.lastPlayedAt ?? 0) > (exist.lastPlayedAt ?? 0) ? rec.position : exist.position,
        });
      }
    }
    const history = [...historyMap.values()]
      .sort((a, b) => (b.lastPlayedAt ?? 0) - (a.lastPlayedAt ?? 0))
      .slice(0, HISTORY_LIMIT);
    // 歌单:按 id 合并(同 id union 歌曲去重;新 id 追加)。
    const playlistMap = new Map<string, MusicUserPlaylist>();
    for (const pl of state.playlists) playlistMap.set(pl.id, pl);
    for (const pl of remotePlaylists.map(normalizePlaylist)) {
      const exist = playlistMap.get(pl.id);
      if (!exist) {
        playlistMap.set(pl.id, pl);
      } else {
        playlistMap.set(pl.id, updatePlaylistCover({
          ...exist,
          songs: dedupeSongs([...exist.songs, ...pl.songs]).slice(0, PLAYLIST_LIMIT),
          updatedAt: Math.max(exist.updatedAt, pl.updatedAt),
        }));
      }
    }
    const playlists = [...playlistMap.values()];
    set({ favorites, history, playlists });
    persist(get());
    return { favorites: favorites.length, history: history.length, playlists: playlists.length };
  },
}));
