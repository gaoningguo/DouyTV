import { create } from "zustand";

export interface LiveChannel {
  id: string;
  name: string;
  url: string;
  logo?: string;
  category?: string;
  /** XMLTV EPG channel id (匹配 EPG 节目表)。一般来自 M3U 的 tvg-id。 */
  epgId?: string;
  /** 自定义 User-Agent (绕过部分直播源的播放器检测，如 AptvPlayer/1.4.10)。 */
  ua?: string;
  /** 自定义 Referer (防盗链)。 */
  referer?: string;
  /** 频道来自哪个订阅源 (LiveSubscription.id)。手动添加的频道没有。 */
  sourceId?: string;
}

const STORAGE_KEY = "douytv:live-channels";
const FIRSTRUN_KEY = "douytv:live-firstrun-done";

const BUILTIN: LiveChannel[] = [];

interface LiveStore {
  channels: LiveChannel[];
  hydrated: boolean;
  hydrate: () => void;
  add: (ch: LiveChannel) => void;
  remove: (id: string) => void;
  importM3U: (
    text: string,
    options?: { defaultUa?: string; defaultCategory?: string; defaultReferer?: string; sourceId?: string }
  ) => number;
  removeByCategory: (category: string) => number;
  removeBySourceId: (sourceId: string) => number;
}

function persist(channels: LiveChannel[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(channels));
  } catch (e) {
    console.warn("[live] persist failed", e);
  }
}

function loadStored(): LiveChannel[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LiveChannel[]) : [];
  } catch {
    return [];
  }
}

/**
 * 解析简单 m3u 订阅，支持 `#EXTINF:-1 tvg-id="..." tvg-logo="..." group-title="...",名称` 后跟一行 URL。
 * 也识别 `#EXTVLCOPT:http-user-agent=...` 和 `#EXTVLCOPT:http-referrer=...`。
 */
function parseM3U(text: string): LiveChannel[] {
  const lines = text.split(/\r?\n/);
  const out: LiveChannel[] = [];
  let current: Partial<LiveChannel> = {};
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF")) {
      const m = line.match(/,(.+)$/);
      const idM = line.match(/tvg-id="([^"]*)"/);
      const logoM = line.match(/tvg-logo="([^"]*)"/);
      const groupM = line.match(/group-title="([^"]*)"/);
      current = {
        name: m?.[1]?.trim() ?? "未命名",
        epgId: idM?.[1] || undefined,
        logo: logoM?.[1],
        category: groupM?.[1],
      };
    } else if (line.startsWith("#EXTVLCOPT:")) {
      const eq = line.indexOf("=");
      if (eq > 0) {
        const key = line.slice("#EXTVLCOPT:".length, eq).toLowerCase().trim();
        const value = line.slice(eq + 1).trim();
        if (key === "http-user-agent") current.ua = value;
        else if (key === "http-referrer" || key === "http-referer") current.referer = value;
      }
    } else if (line.startsWith("#")) {
      continue;
    } else {
      out.push({
        id: `m3u-${Date.now()}-${out.length}`,
        name: current.name ?? "未命名",
        url: line,
        logo: current.logo,
        category: current.category,
        epgId: current.epgId,
        ua: current.ua,
        referer: current.referer,
      });
      current = {};
    }
  }
  return out;
}

export const useLiveStore = create<LiveStore>((set, get) => ({
  channels: [],
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    const stored = loadStored();
    // 仅在「首次启动」（用户从未操作过 channels）时注入 BUILTIN 测试源。
    // 用户删过任何频道或主动添加过后，FIRSTRUN_KEY 被设；以后永远不再恢复 BUILTIN。
    let channels = stored;
    let didFirstRun = false;
    try {
      didFirstRun = localStorage.getItem(FIRSTRUN_KEY) === "1";
    } catch {
      didFirstRun = true; // 私有模式：不再注入避免反复
    }
    if (!didFirstRun && stored.length === 0) {
      channels = [...BUILTIN];
      try {
        localStorage.setItem(FIRSTRUN_KEY, "1");
      } catch {}
      persist(channels);
    }
    set({ channels, hydrated: true });
  },
  add: (ch) => {
    try {
      localStorage.setItem(FIRSTRUN_KEY, "1");
    } catch {}
    const all = [...get().channels.filter((c) => c.id !== ch.id), ch];
    set({ channels: all });
    persist(all);
  },
  remove: (id) => {
    try {
      localStorage.setItem(FIRSTRUN_KEY, "1");
    } catch {}
    const all = get().channels.filter((c) => c.id !== id);
    set({ channels: all });
    persist(all);
  },
  importM3U: (text, options) => {
    try {
      localStorage.setItem(FIRSTRUN_KEY, "1");
    } catch {}
    const parsed = parseM3U(text);
    const adjusted = parsed.map((ch) => ({
      ...ch,
      ua: ch.ua || options?.defaultUa,
      referer: ch.referer || options?.defaultReferer,
      category: ch.category || options?.defaultCategory,
      sourceId: options?.sourceId,
    }));
    // 同 url 的新频道覆盖老的（确保新导入打上 sourceId 标，而非被旧的无 sourceId 频道挡住）
    const newUrls = new Set(adjusted.map((c) => c.url));
    const kept = get().channels.filter((c) => !newUrls.has(c.url));
    const merged = [...kept, ...adjusted];
    set({ channels: merged });
    persist(merged);
    return adjusted.length;
  },
  removeByCategory: (category) => {
    try {
      localStorage.setItem(FIRSTRUN_KEY, "1");
    } catch {}
    const before = get().channels;
    const after = before.filter((c) => c.category !== category);
    const removed = before.length - after.length;
    set({ channels: after });
    persist(after);
    return removed;
  },
  removeBySourceId: (sourceId) => {
    try {
      localStorage.setItem(FIRSTRUN_KEY, "1");
    } catch {}
    const before = get().channels;
    const after = before.filter((c) => c.sourceId !== sourceId);
    const removed = before.length - after.length;
    set({ channels: after });
    persist(after);
    return removed;
  },
}));
