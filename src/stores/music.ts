import { create } from "zustand";
import {
  musicSongKey,
  normalizeMusicSourceDescriptor,
  type MusicHistoryRecord,
  type MusicPlayMode,
  type MusicQuality,
  type MusicSong,
  type MusicSourceDescriptor,
} from "@/lib/music";

export interface MusicUserPlaylistSong extends MusicSong {
  addedAt: number;
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
  sleepTimerEndAt?: number | null;
  queue?: MusicSong[];
  currentSong?: MusicSong | null;
  favorites?: MusicSong[];
  history?: MusicHistoryRecord[];
  playlists?: MusicUserPlaylist[];
}

interface MusicStore {
  sources: MusicSourceDescriptor[];
  hydrated: boolean;
  activeSourceId: string;
  quality: MusicQuality;
  playMode: MusicPlayMode;
  volume: number;
  proxyEnabled: boolean;
  showSpectrum: boolean;
  sleepTimerEndAt: number | null;
  queue: MusicSong[];
  currentSong: MusicSong | null;
  favorites: MusicSong[];
  history: MusicHistoryRecord[];
  playlists: MusicUserPlaylist[];
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
  setSleepTimerEndAt: (endAt: number | null) => void;
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
}

const STORAGE_KEY = "douytv:music";
const HISTORY_LIMIT = 300;
const QUEUE_LIMIT = 500;
const PLAYLIST_LIMIT = 1000;

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
    sleepTimerEndAt: state.sleepTimerEndAt,
    queue: state.queue,
    currentSong: state.currentSong,
    favorites: state.favorites,
    history: state.history,
    playlists: state.playlists,
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
  sleepTimerEndAt: null,
  queue: [],
  currentSong: null,
  favorites: [],
  history: [],
  playlists: [],
  hydrate: () => {
    if (get().hydrated) return;
    const stored = loadState();
    const sources = (stored.sources ?? []).map((source) =>
      normalizeMusicSourceDescriptor(source)
    );
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
      sleepTimerEndAt:
        typeof stored.sleepTimerEndAt === "number" && stored.sleepTimerEndAt > Date.now()
          ? stored.sleepTimerEndAt
          : null,
      queue: dedupeSongs(stored.queue ?? []).slice(0, QUEUE_LIMIT),
      currentSong: stored.currentSong ?? null,
      favorites: dedupeSongs(stored.favorites ?? []),
      history: (stored.history ?? []).slice(0, HISTORY_LIMIT),
      playlists: (stored.playlists ?? []).map(normalizePlaylist),
      hydrated: true,
    });
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
  setSleepTimerEndAt: (sleepTimerEndAt) => {
    set({ sleepTimerEndAt });
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
}));
