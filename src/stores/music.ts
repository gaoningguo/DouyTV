/**
 * Music store — 多 backend 后端配置 + 播放状态 + 历史 + 用户歌单 + 收藏 + 循环模式 + 音量 + 定时停止。
 *
 * 持久化：
 *  - `backends[]` + `activeBackendId` + `defaultPlatform` + `defaultQuality` + `repeatMode` + `volume`
 *    + `playbackRate` + `pluginUserVariables` → localStorage
 *  - 播放历史 / 用户歌单 / 收藏 → SQLite (music_history / music_playlists / music_playlist_items / music_favorites)
 *
 * **首次启动注入 builtin backend**：hydrate 检查到没有 builtin 时自动插入一条
 * `{ kind: 'builtin' }`，让用户开箱即用（搜索 / 榜单 / 歌词无需配置）。
 *
 * 旧数据迁移：若检测到 v1 的 `douytv:music-base-url` + `douytv:music-token`，
 * 自动生成一个 musicapi backend 塞进 backends，并 set 为 active。
 */
import { create } from "zustand";
import { getDb, isSqlAvailable } from "@/lib/db";
import type {
  MusicFavoriteRecord,
  MusicHistoryRecord,
  MusicPlaylistRecord,
  MusicQuality,
  MusicRepeatMode,
  MusicResolvedSong,
  MusicSong,
  MusicSource,
} from "@/lib/music/types";
import type {
  BuiltinBackend,
  MusicApiBackend,
  MusicBackend,
  MusicBackendKind,
} from "@/lib/music/backends/types";

const BACKENDS_KEY = "douytv:music-backends";
const ACTIVE_KEY = "douytv:music-active-backend";
const PLATFORM_KEY = "douytv:music-default-platform";
const QUALITY_KEY = "douytv:music-default-quality";
const REPEAT_KEY = "douytv:music-repeat";
const VOLUME_KEY = "douytv:music-volume";
const RATE_KEY = "douytv:music-rate";
const PLUGIN_VARS_KEY = "douytv:music-plugin-vars";
const TRANSLATION_KEY = "douytv:music-show-translation";
const LRC_SIZE_KEY = "douytv:music-lrc-size";
// 旧 v1 keys
const LEGACY_BASE_KEY = "douytv:music-base-url";
const LEGACY_TOKEN_KEY = "douytv:music-token";

interface HistoryRow {
  song_id: string;
  source: string;
  name: string;
  artist: string | null;
  album: string | null;
  cover: string | null;
  duration_sec: number;
  position_sec: number;
  last_played_at: number;
  play_count: number;
}

function rowToHistory(r: HistoryRow): MusicHistoryRecord {
  return {
    songId: r.song_id,
    source: r.source as MusicSource,
    name: r.name,
    artist: r.artist ?? undefined,
    album: r.album ?? undefined,
    cover: r.cover ?? undefined,
    durationSec: r.duration_sec || undefined,
    positionSec: r.position_sec,
    lastPlayedAt: r.last_played_at,
    playCount: r.play_count,
  };
}

function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function loadBackends(): { backends: MusicBackend[]; activeBackendId: string | null } {
  try {
    const raw = localStorage.getItem(BACKENDS_KEY);
    let backends: MusicBackend[] = [];
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) backends = parsed as MusicBackend[];
    }
    // 旧 v1 数据迁移
    if (backends.length === 0) {
      const legacyBase = localStorage.getItem(LEGACY_BASE_KEY) || "";
      const legacyToken = localStorage.getItem(LEGACY_TOKEN_KEY) || "";
      if (legacyBase) {
        const b: MusicApiBackend = {
          id: genId("mapi"),
          name: "MusicApi-V2",
          kind: "musicapi",
          baseUrl: legacyBase,
          token: legacyToken,
          enabled: true,
          addedAt: Date.now(),
        };
        backends = [b];
        try {
          localStorage.setItem(BACKENDS_KEY, JSON.stringify(backends));
          localStorage.setItem(ACTIVE_KEY, b.id);
          localStorage.removeItem(LEGACY_BASE_KEY);
          localStorage.removeItem(LEGACY_TOKEN_KEY);
        } catch {
          /* ignore */
        }
      }
    }
    const activeBackendId = localStorage.getItem(ACTIVE_KEY) || null;
    const exists = activeBackendId && backends.some((b) => b.id === activeBackendId);
    return {
      backends,
      activeBackendId: exists ? activeBackendId : backends[0]?.id ?? null,
    };
  } catch {
    return { backends: [], activeBackendId: null };
  }
}

function persistBackends(backends: MusicBackend[]) {
  try {
    localStorage.setItem(BACKENDS_KEY, JSON.stringify(backends));
  } catch (e) {
    console.warn("[music] persist backends failed", e);
  }
}

async function sqlLoadHistory(): Promise<MusicHistoryRecord[]> {
  const db = await getDb();
  const rows = await db.select<HistoryRow[]>(
    "SELECT * FROM music_history ORDER BY last_played_at DESC LIMIT 200"
  );
  return rows.map(rowToHistory);
}

async function sqlLoadPlaylists(): Promise<MusicPlaylistRecord[]> {
  const db = await getDb();
  const rows = await db.select<
    Array<{
      id: string;
      name: string;
      description: string | null;
      cover: string | null;
      song_count: number;
      created_at: number;
      updated_at: number;
    }>
  >("SELECT * FROM music_playlists ORDER BY updated_at DESC");
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    cover: r.cover ?? undefined,
    songCount: r.song_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

interface FavoriteRow {
  song_id: string;
  source: string;
  name: string;
  artist: string | null;
  album: string | null;
  cover: string | null;
  duration_sec: number;
  favorited_at: number;
}

async function sqlLoadFavorites(): Promise<MusicFavoriteRecord[]> {
  const db = await getDb();
  const rows = await db.select<FavoriteRow[]>(
    "SELECT * FROM music_favorites ORDER BY favorited_at DESC"
  );
  return rows.map((r) => ({
    songId: r.song_id,
    source: r.source as MusicSource,
    name: r.name,
    artist: r.artist ?? undefined,
    album: r.album ?? undefined,
    cover: r.cover ?? undefined,
    durationSec: r.duration_sec || undefined,
    favoritedAt: r.favorited_at,
  }));
}

function loadPluginVars(): Record<string, Record<string, string>> {
  try {
    const raw = localStorage.getItem(PLUGIN_VARS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, Record<string, string>>;
    }
  } catch {
    /* private mode etc */
  }
  return {};
}

function persistPluginVars(vars: Record<string, Record<string, string>>) {
  try {
    localStorage.setItem(PLUGIN_VARS_KEY, JSON.stringify(vars));
  } catch (e) {
    console.warn("[music] persist plugin vars failed", e);
  }
}

/** Fisher-Yates 洗牌（不改原数组） */
function shuffleArray<T>(arr: readonly T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

interface MusicStore {
  // 多 backend 后端
  backends: MusicBackend[];
  activeBackendId: string | null;
  defaultPlatform: MusicSource;
  defaultQuality: MusicQuality;

  // 播放运行时
  current: MusicResolvedSong | null;
  queue: MusicSong[];
  queueOriginal: MusicSong[]; // shuffle 时保留原顺序
  queueIndex: number;
  paused: boolean;
  positionSec: number;
  durationSec: number;
  loading: boolean;
  error: string | null;
  /** 用户拖动进度时 audio.currentTime 需要 seek 的目标，由 MiniPlayer 监听消费后清回 -1 */
  pendingSeek: number;

  // 播放选项
  repeatMode: MusicRepeatMode;
  volume: number;
  playbackRate: number;
  showTranslation: boolean;
  lrcSize: 0 | 1 | 2 | 3; // S / M / L / XL

  // 插件用户变量（cookie 等）
  pluginUserVariables: Record<string, Record<string, string>>;

  // 定时停止（in-memory，重启不保留）
  sleepTimer: { fireAt: number } | null;

  // 持久化数据
  history: MusicHistoryRecord[];
  playlists: MusicPlaylistRecord[];
  favorites: MusicFavoriteRecord[];
  hydrated: boolean;

  hydrate: () => Promise<void>;
  setDefaultPlatform: (p: MusicSource) => void;
  setDefaultQuality: (q: MusicQuality) => void;
  setRepeatMode: (m: MusicRepeatMode) => void;
  setVolume: (v: number) => void;
  setPlaybackRate: (r: number) => void;
  setShowTranslation: (b: boolean) => void;
  setLrcSize: (n: 0 | 1 | 2 | 3) => void;

  // backend CRUD
  addBackend: (
    backend: Omit<MusicBackend, "id" | "addedAt"> & Partial<Pick<MusicBackend, "enabled">>
  ) => MusicBackend;
  updateBackend: (id: string, patch: Partial<MusicBackend>) => void;
  removeBackend: (id: string) => void;
  setActiveBackend: (id: string) => void;

  // 播放控制
  playQueue: (songs: MusicSong[], startIndex?: number) => Promise<void>;
  playNow: (song: MusicSong) => Promise<void>;
  /** 立即把一首歌插到 queueIndex+1 的位置 */
  playNext: (song: MusicSong) => void;
  /** 添加到队尾 */
  appendToQueue: (song: MusicSong) => void;
  /** 从队列移除某项（按 source + songId） */
  removeFromQueue: (song: MusicSong) => void;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  setPaused: (p: boolean) => void;
  setPosition: (sec: number) => void;
  setDuration: (sec: number) => void;
  setLoading: (b: boolean) => void;
  setError: (e: string | null) => void;
  /** 请求 audio seek 到 sec（MiniPlayer 监听 pendingSeek） */
  seekTo: (sec: number) => void;
  /** 内部：MiniPlayer 拿到 pendingSeek 后调用清空 */
  consumePendingSeek: () => void;
  resolveAndSet: (song: MusicSong) => Promise<void>;

  // 历史
  bumpHistory: (song: MusicSong, positionSec: number) => Promise<void>;
  clearHistory: () => Promise<void>;

  // 收藏
  toggleFavorite: (song: MusicSong) => Promise<void>;
  isFavorite: (song: MusicSong) => boolean;
  clearFavorites: () => Promise<void>;

  // 用户歌单
  createPlaylist: (
    name: string,
    description?: string
  ) => Promise<MusicPlaylistRecord>;
  deletePlaylist: (id: string) => Promise<void>;
  renamePlaylist: (id: string, name: string) => Promise<void>;
  addToPlaylist: (playlistId: string, song: MusicSong) => Promise<void>;
  removeFromPlaylist: (playlistId: string, song: MusicSong) => Promise<void>;
  loadPlaylistSongs: (playlistId: string) => Promise<MusicSong[]>;

  // 插件用户变量
  setPluginUserVariable: (pluginId: string, key: string, value: string) => void;
  removePluginUserVariables: (pluginId: string) => void;

  // 定时停止
  setSleepTimer: (minutes: number | null) => void;

  // 下载（仅桌面）
  downloads: DownloadRecord[];
  startDownload: (song: MusicSong) => Promise<void>;
  clearCompletedDownloads: () => void;
}

export interface DownloadRecord {
  id: string;
  song: MusicSong;
  status: "downloading" | "completed" | "failed";
  progress: number; // 0-1
  loadedBytes: number;
  totalBytes: number;
  filePath?: string;
  absolutePath?: string;
  error?: string;
  startedAt: number;
}

export const useMusicStore = create<MusicStore>((set, get) => ({
  backends: [],
  activeBackendId: null,
  defaultPlatform: "wy",
  defaultQuality: "320k",

  current: null,
  queue: [],
  queueOriginal: [],
  queueIndex: -1,
  paused: true,
  positionSec: 0,
  durationSec: 0,
  loading: false,
  error: null,
  pendingSeek: -1,

  repeatMode: "list",
  volume: 1,
  playbackRate: 1,
  showTranslation: false,
  lrcSize: 1,

  pluginUserVariables: {},
  sleepTimer: null,

  history: [],
  playlists: [],
  favorites: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      let { backends, activeBackendId } = loadBackends();

      // 首次注入 builtin backend（让用户开箱即用）
      if (!backends.some((b) => b.kind === "builtin")) {
        const builtin: BuiltinBackend = {
          id: "builtin-default",
          name: "内置音乐源 (lx-music)",
          kind: "builtin",
          enabled: true,
          addedAt: Date.now(),
        };
        backends = [builtin, ...backends];
        persistBackends(backends);
        // 如果之前没有任何 active backend，把 builtin 设为 active
        if (!activeBackendId) {
          activeBackendId = builtin.id;
          try {
            localStorage.setItem(ACTIVE_KEY, activeBackendId);
          } catch {
            /* ignore */
          }
        }
      }

      const dp = (localStorage.getItem(PLATFORM_KEY) || "wy") as MusicSource;
      const dq = (localStorage.getItem(QUALITY_KEY) || "320k") as MusicQuality;
      const repeat = (localStorage.getItem(REPEAT_KEY) || "list") as MusicRepeatMode;
      const volRaw = localStorage.getItem(VOLUME_KEY);
      const vol = volRaw !== null ? Math.max(0, Math.min(1, parseFloat(volRaw))) : 1;
      const rateRaw = localStorage.getItem(RATE_KEY);
      const rate = rateRaw !== null ? Math.max(0.5, Math.min(2, parseFloat(rateRaw))) : 1;
      const showTrans = localStorage.getItem(TRANSLATION_KEY) === "1";
      const lrcSizeRaw = parseInt(localStorage.getItem(LRC_SIZE_KEY) || "1", 10);
      const lrcSize = ([0, 1, 2, 3].includes(lrcSizeRaw) ? lrcSizeRaw : 1) as 0 | 1 | 2 | 3;
      const pluginUserVariables = loadPluginVars();
      set({
        backends,
        activeBackendId,
        defaultPlatform: dp,
        defaultQuality: dq,
        repeatMode: repeat,
        volume: vol,
        playbackRate: rate,
        showTranslation: showTrans,
        lrcSize,
        pluginUserVariables,
      });
    } catch {
      /* private mode */
    }
    if (isSqlAvailable()) {
      try {
        const [history, playlists, favorites] = await Promise.all([
          sqlLoadHistory(),
          sqlLoadPlaylists(),
          sqlLoadFavorites(),
        ]);
        set({ history, playlists, favorites });
      } catch (e) {
        console.error("[music] hydrate sql failed", e);
      }
    }
    set({ hydrated: true });
  },

  setDefaultPlatform: (p) => {
    try {
      localStorage.setItem(PLATFORM_KEY, p);
    } catch {
      /* private */
    }
    set({ defaultPlatform: p });
  },
  setDefaultQuality: (q) => {
    try {
      localStorage.setItem(QUALITY_KEY, q);
    } catch {
      /* private */
    }
    set({ defaultQuality: q });
  },
  setRepeatMode: (m) => {
    try {
      localStorage.setItem(REPEAT_KEY, m);
    } catch {
      /* private */
    }
    const s = get();
    if (m === "shuffle" && s.queueOriginal.length === 0 && s.queue.length > 0) {
      // 第一次开 shuffle，记录原顺序并打散
      const shuffled = shuffleArray(s.queue);
      const curId = s.current ? `${s.current.source}-${s.current.songId}` : null;
      const newIdx = curId
        ? shuffled.findIndex((q) => `${q.source}-${q.songId}` === curId)
        : 0;
      set({ repeatMode: m, queueOriginal: s.queue, queue: shuffled, queueIndex: Math.max(0, newIdx) });
    } else if (m !== "shuffle" && s.queueOriginal.length > 0) {
      // 关闭 shuffle，恢复原顺序
      const curId = s.current ? `${s.current.source}-${s.current.songId}` : null;
      const newIdx = curId
        ? s.queueOriginal.findIndex((q) => `${q.source}-${q.songId}` === curId)
        : 0;
      set({ repeatMode: m, queue: s.queueOriginal, queueOriginal: [], queueIndex: Math.max(0, newIdx) });
    } else {
      set({ repeatMode: m });
    }
  },
  setVolume: (v) => {
    const clamped = Math.max(0, Math.min(1, v));
    try {
      localStorage.setItem(VOLUME_KEY, String(clamped));
    } catch {
      /* private */
    }
    set({ volume: clamped });
  },
  setPlaybackRate: (r) => {
    const clamped = Math.max(0.5, Math.min(2, r));
    try {
      localStorage.setItem(RATE_KEY, String(clamped));
    } catch {
      /* private */
    }
    set({ playbackRate: clamped });
  },
  setShowTranslation: (b) => {
    try {
      localStorage.setItem(TRANSLATION_KEY, b ? "1" : "0");
    } catch {
      /* private */
    }
    set({ showTranslation: b });
  },
  setLrcSize: (n) => {
    try {
      localStorage.setItem(LRC_SIZE_KEY, String(n));
    } catch {
      /* private */
    }
    set({ lrcSize: n });
  },

  addBackend: (input) => {
    const now = Date.now();
    const id = genId(`m${(input as { kind: MusicBackendKind }).kind.slice(0, 3)}`);
    const full = {
      ...input,
      id,
      enabled: input.enabled ?? true,
      addedAt: now,
    } as MusicBackend;
    const all = [...get().backends, full];
    persistBackends(all);
    const next: Partial<MusicStore> = { backends: all };
    // 第一个 backend 自动 active
    if (!get().activeBackendId) {
      try {
        localStorage.setItem(ACTIVE_KEY, id);
      } catch {
        /* ignore */
      }
      next.activeBackendId = id;
    }
    set(next);
    return full;
  },

  updateBackend: (id, patch) => {
    const all = get().backends.map((b) =>
      b.id === id ? ({ ...b, ...patch } as MusicBackend) : b
    );
    persistBackends(all);
    set({ backends: all });
  },

  removeBackend: (id) => {
    const all = get().backends.filter((b) => b.id !== id);
    persistBackends(all);
    const update: Partial<MusicStore> = { backends: all };
    if (get().activeBackendId === id) {
      const nextId = all[0]?.id ?? null;
      try {
        if (nextId) localStorage.setItem(ACTIVE_KEY, nextId);
        else localStorage.removeItem(ACTIVE_KEY);
      } catch {
        /* ignore */
      }
      update.activeBackendId = nextId;
    }
    set(update);
  },

  setActiveBackend: (id) => {
    if (!get().backends.some((b) => b.id === id)) return;
    try {
      localStorage.setItem(ACTIVE_KEY, id);
    } catch {
      /* ignore */
    }
    set({ activeBackendId: id });
  },

  resolveAndSet: async (song) => {
    const { parseSong } = await import("@/lib/music/api");
    set({ loading: true, error: null });
    try {
      const resolved = await parseSong(song, get().defaultQuality);
      set({
        current: resolved,
        loading: false,
        paused: false,
        positionSec: 0,
      });
      void get().bumpHistory(song, 0);
    } catch (e) {
      set({ loading: false, error: (e as Error).message ?? String(e) });
    }
  },

  playQueue: async (songs, startIndex = 0) => {
    if (songs.length === 0) return;
    const idx = Math.max(0, Math.min(songs.length - 1, startIndex));
    const mode = get().repeatMode;
    if (mode === "shuffle") {
      // 把 startIndex 这首固定放在第 0 个，其余打散
      const fixed = songs[idx];
      const rest = songs.filter((_, i) => i !== idx);
      const shuffled = [fixed, ...shuffleArray(rest)];
      set({ queue: shuffled, queueOriginal: songs, queueIndex: 0 });
      await get().resolveAndSet(fixed);
    } else {
      set({ queue: songs, queueOriginal: [], queueIndex: idx });
      await get().resolveAndSet(songs[idx]);
    }
  },

  playNow: async (song) => {
    set({ queue: [song], queueOriginal: [], queueIndex: 0 });
    await get().resolveAndSet(song);
  },

  playNext: (song) => {
    const { queue, queueIndex } = get();
    if (queue.length === 0) {
      void get().playNow(song);
      return;
    }
    const insertAt = queueIndex + 1;
    const next = [...queue.slice(0, insertAt), song, ...queue.slice(insertAt)];
    set({ queue: next });
  },

  appendToQueue: (song) => {
    const { queue } = get();
    if (queue.length === 0) {
      void get().playNow(song);
      return;
    }
    set({ queue: [...queue, song] });
  },

  removeFromQueue: (song) => {
    const { queue, queueIndex, queueOriginal } = get();
    const key = `${song.source}-${song.songId}`;
    const newQueue = queue.filter((q) => `${q.source}-${q.songId}` !== key);
    const removedBeforeCurrent = queue
      .slice(0, queueIndex)
      .some((q) => `${q.source}-${q.songId}` === key);
    set({
      queue: newQueue,
      queueOriginal: queueOriginal.filter((q) => `${q.source}-${q.songId}` !== key),
      queueIndex: Math.max(-1, queueIndex - (removedBeforeCurrent ? 1 : 0)),
    });
  },

  next: async () => {
    const { queue, queueIndex, repeatMode } = get();
    if (queueIndex < 0 || queue.length === 0) return;
    if (repeatMode === "single") {
      // 单曲循环 — 重置位置，重新解析（如果 URL 过期）
      const song = queue[queueIndex];
      set({ pendingSeek: 0 });
      await get().resolveAndSet(song);
      return;
    }
    // list / shuffle（shuffle 已经在 setRepeatMode 时打散了 queue）
    const ni = (queueIndex + 1) % queue.length;
    set({ queueIndex: ni });
    await get().resolveAndSet(queue[ni]);
  },

  prev: async () => {
    const { queue, queueIndex } = get();
    if (queueIndex < 0 || queue.length === 0) return;
    const pi = (queueIndex - 1 + queue.length) % queue.length;
    set({ queueIndex: pi });
    await get().resolveAndSet(queue[pi]);
  },

  setPaused: (p) => set({ paused: p }),
  setPosition: (sec) => set({ positionSec: sec }),
  setDuration: (sec) => set({ durationSec: sec }),
  setLoading: (b) => set({ loading: b }),
  setError: (e) => set({ error: e }),
  seekTo: (sec) => set({ pendingSeek: sec }),
  consumePendingSeek: () => set({ pendingSeek: -1 }),

  bumpHistory: async (song, positionSec) => {
    if (!isSqlAvailable()) return;
    const now = Date.now();
    try {
      const db = await getDb();
      await db.execute(
        `INSERT INTO music_history (song_id, source, name, artist, album, cover, duration_sec, position_sec, last_played_at, play_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)
         ON CONFLICT(song_id, source) DO UPDATE SET
           position_sec = $8,
           last_played_at = $9,
           play_count = play_count + 1`,
        [
          song.songId,
          song.source,
          song.name,
          song.artist ?? null,
          song.album ?? null,
          song.cover ?? null,
          song.durationSec ?? 0,
          positionSec,
          now,
        ]
      );
      const history = await sqlLoadHistory();
      set({ history });
    } catch (e) {
      console.error("[music] bumpHistory failed", e);
    }
  },

  clearHistory: async () => {
    if (!isSqlAvailable()) {
      set({ history: [] });
      return;
    }
    try {
      const db = await getDb();
      await db.execute("DELETE FROM music_history");
      set({ history: [] });
    } catch (e) {
      console.error("[music] clearHistory failed", e);
    }
  },

  toggleFavorite: async (song) => {
    const key = `${song.source}-${song.songId}`;
    const isFav = get().favorites.some((f) => `${f.source}-${f.songId}` === key);
    if (isSqlAvailable()) {
      try {
        const db = await getDb();
        if (isFav) {
          await db.execute(
            "DELETE FROM music_favorites WHERE song_id = $1 AND source = $2",
            [song.songId, song.source]
          );
        } else {
          await db.execute(
            `INSERT OR REPLACE INTO music_favorites
             (song_id, source, name, artist, album, cover, duration_sec, favorited_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              song.songId,
              song.source,
              song.name,
              song.artist ?? null,
              song.album ?? null,
              song.cover ?? null,
              song.durationSec ?? 0,
              Date.now(),
            ]
          );
        }
        const favorites = await sqlLoadFavorites();
        set({ favorites });
      } catch (e) {
        console.error("[music] toggleFavorite failed", e);
      }
    } else {
      // 浏览器 dev 兜底：内存
      if (isFav) {
        set({
          favorites: get().favorites.filter((f) => `${f.source}-${f.songId}` !== key),
        });
      } else {
        set({
          favorites: [
            { ...song, favoritedAt: Date.now() } as MusicFavoriteRecord,
            ...get().favorites,
          ],
        });
      }
    }
  },

  isFavorite: (song) => {
    const key = `${song.source}-${song.songId}`;
    return get().favorites.some((f) => `${f.source}-${f.songId}` === key);
  },

  clearFavorites: async () => {
    if (!isSqlAvailable()) {
      set({ favorites: [] });
      return;
    }
    try {
      const db = await getDb();
      await db.execute("DELETE FROM music_favorites");
      set({ favorites: [] });
    } catch (e) {
      console.error("[music] clearFavorites failed", e);
    }
  },

  createPlaylist: async (name, description) => {
    const now = Date.now();
    const id = `pl-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const rec: MusicPlaylistRecord = {
      id,
      name,
      description,
      songCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    if (isSqlAvailable()) {
      try {
        const db = await getDb();
        await db.execute(
          "INSERT INTO music_playlists (id, name, description, song_count, created_at, updated_at) VALUES ($1,$2,$3,0,$4,$4)",
          [id, name, description ?? null, now]
        );
      } catch (e) {
        console.error("[music] createPlaylist sql failed", e);
      }
    }
    set((s) => ({ playlists: [rec, ...s.playlists] }));
    return rec;
  },

  deletePlaylist: async (id) => {
    if (isSqlAvailable()) {
      try {
        const db = await getDb();
        await db.execute("DELETE FROM music_playlist_items WHERE playlist_id = $1", [id]);
        await db.execute("DELETE FROM music_playlists WHERE id = $1", [id]);
      } catch (e) {
        console.error("[music] deletePlaylist sql failed", e);
      }
    }
    set((s) => ({ playlists: s.playlists.filter((p) => p.id !== id) }));
  },

  renamePlaylist: async (id, name) => {
    if (isSqlAvailable()) {
      try {
        const db = await getDb();
        await db.execute(
          "UPDATE music_playlists SET name = $1, updated_at = $2 WHERE id = $3",
          [name, Date.now(), id]
        );
        const playlists = await sqlLoadPlaylists();
        set({ playlists });
      } catch (e) {
        console.error("[music] renamePlaylist sql failed", e);
      }
    } else {
      set((s) => ({
        playlists: s.playlists.map((p) => (p.id === id ? { ...p, name } : p)),
      }));
    }
  },

  addToPlaylist: async (playlistId, song) => {
    if (!isSqlAvailable()) return;
    try {
      const db = await getDb();
      const now = Date.now();
      const max = await db.select<Array<{ pos: number }>>(
        "SELECT COALESCE(MAX(position), -1) AS pos FROM music_playlist_items WHERE playlist_id = $1",
        [playlistId]
      );
      const pos = (max[0]?.pos ?? -1) + 1;
      await db.execute(
        `INSERT OR REPLACE INTO music_playlist_items
         (playlist_id, song_id, source, position, name, artist, album, cover, duration_sec, added_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          playlistId,
          song.songId,
          song.source,
          pos,
          song.name,
          song.artist ?? null,
          song.album ?? null,
          song.cover ?? null,
          song.durationSec ?? 0,
          now,
        ]
      );
      await db.execute(
        "UPDATE music_playlists SET song_count = (SELECT COUNT(*) FROM music_playlist_items WHERE playlist_id = $1), updated_at = $2 WHERE id = $1",
        [playlistId, now]
      );
      const playlists = await sqlLoadPlaylists();
      set({ playlists });
    } catch (e) {
      console.error("[music] addToPlaylist failed", e);
    }
  },

  removeFromPlaylist: async (playlistId, song) => {
    if (!isSqlAvailable()) return;
    try {
      const db = await getDb();
      await db.execute(
        "DELETE FROM music_playlist_items WHERE playlist_id = $1 AND song_id = $2 AND source = $3",
        [playlistId, song.songId, song.source]
      );
      await db.execute(
        "UPDATE music_playlists SET song_count = (SELECT COUNT(*) FROM music_playlist_items WHERE playlist_id = $1), updated_at = $2 WHERE id = $1",
        [playlistId, Date.now()]
      );
      const playlists = await sqlLoadPlaylists();
      set({ playlists });
    } catch (e) {
      console.error("[music] removeFromPlaylist failed", e);
    }
  },

  loadPlaylistSongs: async (playlistId) => {
    if (!isSqlAvailable()) return [];
    try {
      const db = await getDb();
      const rows = await db.select<
        Array<{
          song_id: string;
          source: string;
          name: string;
          artist: string | null;
          album: string | null;
          cover: string | null;
          duration_sec: number;
        }>
      >(
        "SELECT song_id, source, name, artist, album, cover, duration_sec FROM music_playlist_items WHERE playlist_id = $1 ORDER BY position ASC",
        [playlistId]
      );
      return rows.map((r) => ({
        songId: r.song_id,
        source: r.source as MusicSource,
        name: r.name,
        artist: r.artist ?? undefined,
        album: r.album ?? undefined,
        cover: r.cover ?? undefined,
        durationSec: r.duration_sec || undefined,
      }));
    } catch (e) {
      console.error("[music] loadPlaylistSongs failed", e);
      return [];
    }
  },

  setPluginUserVariable: (pluginId, key, value) => {
    const vars = { ...get().pluginUserVariables };
    if (!vars[pluginId]) vars[pluginId] = {};
    if (value === "") delete vars[pluginId][key];
    else vars[pluginId] = { ...vars[pluginId], [key]: value };
    if (Object.keys(vars[pluginId]).length === 0) delete vars[pluginId];
    persistPluginVars(vars);
    set({ pluginUserVariables: vars });
  },

  removePluginUserVariables: (pluginId) => {
    const vars = { ...get().pluginUserVariables };
    delete vars[pluginId];
    persistPluginVars(vars);
    set({ pluginUserVariables: vars });
  },

  setSleepTimer: (minutes) => {
    if (minutes === null || minutes <= 0) {
      const t = get().sleepTimer;
      if (t) {
        set({ sleepTimer: null });
      }
      return;
    }
    const fireAt = Date.now() + minutes * 60 * 1000;
    set({ sleepTimer: { fireAt } });
    setTimeout(() => {
      const cur = get().sleepTimer;
      if (cur && cur.fireAt === fireAt) {
        get().setPaused(true);
        set({ sleepTimer: null });
      }
    }, minutes * 60 * 1000);
  },

  downloads: [],

  startDownload: async (song) => {
    const { isDesktop } = await import("@/lib/platform");
    if (!isDesktop()) {
      console.warn("[music] downloads are desktop-only");
      return;
    }
    const id = genId("dl");
    const record: DownloadRecord = {
      id,
      song,
      status: "downloading",
      progress: 0,
      loadedBytes: 0,
      totalBytes: 0,
      startedAt: Date.now(),
    };
    set({ downloads: [record, ...get().downloads] });
    try {
      const { downloadSong } = await import("@/lib/music/download");
      const quality = get().defaultQuality;
      const result = await downloadSong(song, quality, (p) => {
        const cur = get().downloads.find((d) => d.id === id);
        if (!cur) return;
        const next: DownloadRecord = {
          ...cur,
          loadedBytes: p.loaded,
          totalBytes: p.total,
          progress: p.total > 0 ? p.loaded / p.total : 0,
        };
        set({
          downloads: get().downloads.map((d) => (d.id === id ? next : d)),
        });
      });
      set({
        downloads: get().downloads.map((d) =>
          d.id === id
            ? {
                ...d,
                status: "completed",
                progress: 1,
                filePath: result.path,
                absolutePath: result.absolutePath,
              }
            : d
        ),
      });
    } catch (e) {
      set({
        downloads: get().downloads.map((d) =>
          d.id === id
            ? { ...d, status: "failed", error: (e as Error).message ?? String(e) }
            : d
        ),
      });
    }
  },

  clearCompletedDownloads: () => {
    set({
      downloads: get().downloads.filter((d) => d.status === "downloading"),
    });
  },
}));
