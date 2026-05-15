import { create } from "zustand";
import { scriptFetch } from "@/source-script/fetch";
import { parseXmlTv, type EpgProgramme } from "@/lib/epg";

const URL_KEY = "douytv:epg-url";
const CACHE_KEY = "douytv:epg-cache";
const CACHE_TTL_MS = 6 * 3600 * 1000;
const CACHE_MAX_BYTES = 5 * 1024 * 1024; // 5MB — 更大就跳过 parse 直接重新拉

interface EpgStore {
  url: string;
  programmes: Record<string, EpgProgramme[]>;
  loading: boolean;
  error?: string;
  updatedAt?: number;
  hydrated: boolean;
  hydrate: () => void;
  setUrl: (url: string) => void;
  refresh: () => Promise<void>;
  clear: () => void;
}

export const useEpgStore = create<EpgStore>((set, get) => ({
  url: "",
  programmes: {},
  loading: false,
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    // 先同步读 url（小），缓存 parse 异步化避免主线程阻塞数 MB JSON
    let url = "";
    try {
      url = localStorage.getItem(URL_KEY) || "";
    } catch {}
    set({ url, hydrated: true });

    const parseAsync = () => {
      let programmes: Record<string, EpgProgramme[]> = {};
      let updatedAt: number | undefined;
      let oversized = false;
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
          if (raw.length > CACHE_MAX_BYTES) {
            oversized = true;
          } else {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") {
              programmes = parsed.programmes || {};
              updatedAt = parsed.updatedAt;
            }
          }
        }
      } catch {
        /* ignore */
      }
      set({ programmes, updatedAt });
      const needRefresh =
        url &&
        (oversized || !updatedAt || Date.now() - updatedAt > CACHE_TTL_MS);
      if (needRefresh) void get().refresh();
    };

    if (typeof window !== "undefined") {
      window.setTimeout(parseAsync, 0);
    } else {
      parseAsync();
    }
  },
  setUrl: (url) => {
    try {
      if (url) localStorage.setItem(URL_KEY, url);
      else localStorage.removeItem(URL_KEY);
    } catch {}
    set({ url });
    if (url) void get().refresh();
    else set({ programmes: {}, updatedAt: undefined });
  },
  refresh: async () => {
    const { url } = get();
    if (!url) return;
    set({ loading: true, error: undefined });
    try {
      const res = await scriptFetch(url, { timeout: 30_000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const programmes = parseXmlTv(xml);
      const updatedAt = Date.now();
      set({ programmes, updatedAt, loading: false });
      try {
        localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ programmes, updatedAt })
        );
      } catch {
        /* quota — keep in memory only */
      }
    } catch (e) {
      set({ loading: false, error: (e as Error)?.message ?? String(e) });
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(URL_KEY);
      localStorage.removeItem(CACHE_KEY);
    } catch {}
    set({ url: "", programmes: {}, updatedAt: undefined });
  },
}));
