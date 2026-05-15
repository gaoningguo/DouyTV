import { create } from "zustand";

const ENABLED_KEY = "douytv:proxy-enabled";
const URL_KEY = "douytv:proxy-url";

interface ProxyStore {
  enabled: boolean;
  url: string;
  hydrated: boolean;
  hydrate: () => void;
  setEnabled: (b: boolean) => void;
  setUrl: (u: string) => void;
}

export const useProxyStore = create<ProxyStore>((set, get) => ({
  enabled: false,
  url: "",
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    let enabled = false;
    let url = "";
    try {
      enabled = localStorage.getItem(ENABLED_KEY) === "1";
      url = localStorage.getItem(URL_KEY) || "";
    } catch {}
    set({ enabled, url, hydrated: true });
  },
  setEnabled: (b) => {
    try {
      localStorage.setItem(ENABLED_KEY, b ? "1" : "0");
    } catch {}
    set({ enabled: b });
  },
  setUrl: (u) => {
    try {
      if (u) localStorage.setItem(URL_KEY, u);
      else localStorage.removeItem(URL_KEY);
    } catch {}
    set({ url: u });
  },
}));

/** 给非 React 代码（如 wrapWithProxy）调用的同步读取 */
export function getActiveProxyUrl(): string | undefined {
  const s = useProxyStore.getState();
  if (!s.enabled) return undefined;
  const url = s.url.trim();
  return url || undefined;
}
