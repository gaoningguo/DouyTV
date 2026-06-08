/**
 * 数据同步 store —— 通过 WebDAV 把 localStorage 数据 push/pull 到用户自部署服务。
 *
 * 同步范围：所有以 `douytv:` 前缀的 localStorage 键（与"导出备份"一致）。
 * 不同步：SQLite favorites/history —— 体量大且高频写，后续若有需要可单独做“历史同步”。
 *
 * 冲突策略 (MVP)：以 exportedAt 时间戳为准，远端较新 → 本地覆盖；本地较新 → push 时
 * 直接覆盖远端。pull 前如检测到本地有更新但未推送会提示用户。
 *
 * 自动同步：interval 分钟级，每次到点 push（不主动 pull，避免无感覆盖）。
 */
import { create } from "zustand";
import {
  getFile,
  putFile,
  ensureCollection,
  testConnection,
  type WebDAVConfig,
} from "@/lib/sync/webdav";

const BASE_URL_KEY = "douytv:sync-webdav-url";
const USER_KEY = "douytv:sync-webdav-user";
const PASS_KEY = "douytv:sync-webdav-pass";
const AUTO_INTERVAL_KEY = "douytv:sync-interval-min";
const LAST_SYNC_KEY = "douytv:sync-last-at";
const REMOTE_DIR = "douytv";
const REMOTE_PATH = "douytv/snapshot.json";

interface SyncPayload {
  app: "DouyTV";
  version: string;
  exportedAt: number;
  data: Record<string, unknown>;
}

function snapshot(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith("douytv:")) continue;
    // 同步设置本身不进 payload —— 避免远端配置覆盖本机配置（用户在不同设备可能想用不同 WebDAV）
    if (
      key === BASE_URL_KEY ||
      key === USER_KEY ||
      key === PASS_KEY ||
      key === AUTO_INTERVAL_KEY ||
      key === LAST_SYNC_KEY
    ) {
      continue;
    }
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    try {
      out[key] = JSON.parse(raw);
    } catch {
      out[key] = raw;
    }
  }
  return out;
}

function applySnapshot(data: Record<string, unknown>): number {
  let count = 0;
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith("douytv:")) continue;
    if (
      key === BASE_URL_KEY ||
      key === USER_KEY ||
      key === PASS_KEY ||
      key === AUTO_INTERVAL_KEY
    ) {
      continue;
    }
    try {
      localStorage.setItem(
        key,
        typeof value === "string" ? value : JSON.stringify(value)
      );
      count++;
    } catch (e) {
      console.warn("[sync] apply key failed", key, e);
    }
  }
  return count;
}

interface SyncStore {
  baseUrl: string;
  username: string;
  password: string;
  autoIntervalMin: number; // 0 = 关闭自动同步
  lastSyncAt: number | null;
  syncing: boolean;
  lastError: string | null;
  hydrated: boolean;

  hydrate: () => void;
  setBaseUrl: (s: string) => void;
  setUsername: (s: string) => void;
  setPassword: (s: string) => void;
  setAutoInterval: (min: number) => void;

  config: () => WebDAVConfig;
  testConnection: () => Promise<{ ok: boolean; message?: string }>;
  pushNow: () => Promise<{ ok: boolean; message?: string }>;
  pullNow: () => Promise<{
    ok: boolean;
    message?: string;
    remoteAt?: number;
    applied?: number;
  }>;
}

export const useSyncStore = create<SyncStore>((set, get) => ({
  baseUrl: "",
  username: "",
  password: "",
  autoIntervalMin: 0,
  lastSyncAt: null,
  syncing: false,
  lastError: null,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    try {
      const baseUrl = localStorage.getItem(BASE_URL_KEY) || "";
      const username = localStorage.getItem(USER_KEY) || "";
      const password = localStorage.getItem(PASS_KEY) || "";
      const intRaw = localStorage.getItem(AUTO_INTERVAL_KEY);
      const autoIntervalMin = intRaw ? Math.max(0, parseInt(intRaw, 10) || 0) : 0;
      const lastRaw = localStorage.getItem(LAST_SYNC_KEY);
      const lastSyncAt = lastRaw ? parseInt(lastRaw, 10) || null : null;
      set({
        baseUrl,
        username,
        password,
        autoIntervalMin,
        lastSyncAt,
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },

  setBaseUrl: (s) => {
    try {
      if (s) localStorage.setItem(BASE_URL_KEY, s);
      else localStorage.removeItem(BASE_URL_KEY);
    } catch {}
    set({ baseUrl: s });
  },
  setUsername: (s) => {
    try {
      if (s) localStorage.setItem(USER_KEY, s);
      else localStorage.removeItem(USER_KEY);
    } catch {}
    set({ username: s });
  },
  setPassword: (s) => {
    try {
      if (s) localStorage.setItem(PASS_KEY, s);
      else localStorage.removeItem(PASS_KEY);
    } catch {}
    set({ password: s });
  },
  setAutoInterval: (min) => {
    try {
      localStorage.setItem(AUTO_INTERVAL_KEY, String(min));
    } catch {}
    set({ autoIntervalMin: min });
  },

  config: () => {
    const s = get();
    return {
      baseUrl: s.baseUrl,
      username: s.username,
      password: s.password,
    };
  },

  testConnection: async () => {
    const cfg = get().config();
    if (!cfg.baseUrl) return { ok: false, message: "请先填 WebDAV URL" };
    const r = await testConnection(cfg);
    return { ok: r.ok, message: r.message };
  },

  pushNow: async () => {
    const cfg = get().config();
    if (!cfg.baseUrl) return { ok: false, message: "未配置 WebDAV" };
    set({ syncing: true, lastError: null });
    try {
      // 必须先建 douytv/ 子目录 —— 部分 WebDAV (坚果云/Nextcloud) 拒绝直接 PUT 到根路径
      const mk = await ensureCollection(cfg, REMOTE_DIR);
      if (!mk.ok && mk.status !== 405 && mk.status !== 301) {
        set({ syncing: false, lastError: `创建目录失败: ${mk.message}` });
        return { ok: false, message: mk.message };
      }
      const payload: SyncPayload = {
        app: "DouyTV",
        version: "1.0.1",
        exportedAt: Date.now(),
        data: snapshot(),
      };
      const r = await putFile(cfg, REMOTE_PATH, JSON.stringify(payload));
      if (!r.ok) {
        set({ syncing: false, lastError: r.message ?? "推送失败" });
        return { ok: false, message: r.message };
      }
      const now = Date.now();
      try {
        localStorage.setItem(LAST_SYNC_KEY, String(now));
      } catch {}
      set({ syncing: false, lastSyncAt: now });
      return { ok: true };
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      set({ syncing: false, lastError: msg });
      return { ok: false, message: msg };
    }
  },

  pullNow: async () => {
    const cfg = get().config();
    if (!cfg.baseUrl) return { ok: false, message: "未配置 WebDAV" };
    set({ syncing: true, lastError: null });
    try {
      const r = await getFile(cfg, REMOTE_PATH);
      if (!r.ok || !r.body) {
        const hint =
          r.status === 404
            ? "远端尚无快照（先点「推送」上传）"
            : r.message ?? "拉取失败";
        set({ syncing: false, lastError: hint });
        return { ok: false, message: hint };
      }
      const parsed = JSON.parse(r.body) as SyncPayload;
      if (!parsed || parsed.app !== "DouyTV" || !parsed.data) {
        set({ syncing: false, lastError: "远端文件格式不正确" });
        return { ok: false, message: "远端文件格式不正确" };
      }
      const applied = applySnapshot(parsed.data);
      const now = Date.now();
      try {
        localStorage.setItem(LAST_SYNC_KEY, String(now));
      } catch {}
      set({ syncing: false, lastSyncAt: now });
      return { ok: true, remoteAt: parsed.exportedAt, applied };
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      set({ syncing: false, lastError: msg });
      return { ok: false, message: msg };
    }
  },
}));

/** App 启动后调用：如启用自动同步，按间隔 push */
export function startAutoSyncTimer(): () => void {
  let timerId: number | null = null;
  const tick = async () => {
    const { autoIntervalMin, pushNow, syncing, baseUrl } =
      useSyncStore.getState();
    if (autoIntervalMin > 0 && baseUrl && !syncing) {
      const r = await pushNow();
      if (!r.ok) console.warn("[sync] auto push failed", r.message);
    }
  };
  const reschedule = () => {
    if (timerId !== null) window.clearTimeout(timerId);
    const min = useSyncStore.getState().autoIntervalMin;
    if (min <= 0) return;
    timerId = window.setTimeout(async () => {
      await tick();
      reschedule();
    }, min * 60 * 1000);
  };
  reschedule();
  // 订阅 interval 变化 → 重新排程
  const unsub = useSyncStore.subscribe((s, prev) => {
    if (s.autoIntervalMin !== prev.autoIntervalMin) reschedule();
  });
  return () => {
    if (timerId !== null) window.clearTimeout(timerId);
    unsub();
  };
}
