/**
 * 代理 store —— 三档模式：
 *  - "auto":   读 OS 系统代理 (Rust sysproxy 命令)，无则直连
 *  - "manual": 用户填的 manualUrl
 *  - "off":    强制直连
 *
 * iOS / Android 上 VPN / 系统代理已在网络栈层透明转发，应用不需要再
 * 显式指定 proxy_url。在这两个平台 mode 锁死为 "auto" 且 systemProxyUrl
 * 永远为空 —— scriptFetch 拿到 undefined，ureq 直连，OS VPN 接管。
 */
import { create } from "zustand";
import { isTauri, isMobile } from "@/lib/platform";

const MODE_KEY = "douytv:proxy-mode";
const MANUAL_URL_KEY = "douytv:proxy-manual-url";
// 兼容旧 key（< 1.0.2 用的 enabled + url 双字段）
const LEGACY_ENABLED_KEY = "douytv:proxy-enabled";
const LEGACY_URL_KEY = "douytv:proxy-url";

export type ProxyMode = "auto" | "manual" | "off";

interface ProxyStore {
  mode: ProxyMode;
  manualUrl: string;
  systemProxyUrl: string;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setMode: (m: ProxyMode) => void;
  setManualUrl: (u: string) => void;
  refreshSystemProxy: () => Promise<void>;
}

async function detectSystemProxy(): Promise<string> {
  if (!isTauri() || isMobile()) return "";
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<string | null>("read_system_proxy");
    return typeof result === "string" ? result : "";
  } catch (e) {
    console.warn("[proxy] read_system_proxy failed", e);
    return "";
  }
}

function migrateLegacy(): { mode: ProxyMode; manualUrl: string } | null {
  try {
    const legacyEnabled = localStorage.getItem(LEGACY_ENABLED_KEY);
    const legacyUrl = localStorage.getItem(LEGACY_URL_KEY) || "";
    if (legacyEnabled === null && !legacyUrl) return null;
    const mode: ProxyMode =
      legacyEnabled === "1" ? (legacyUrl ? "manual" : "auto") : "off";
    try {
      localStorage.setItem(MODE_KEY, mode);
      if (legacyUrl) localStorage.setItem(MANUAL_URL_KEY, legacyUrl);
      localStorage.removeItem(LEGACY_ENABLED_KEY);
      localStorage.removeItem(LEGACY_URL_KEY);
    } catch {
      /* ignore */
    }
    return { mode, manualUrl: legacyUrl };
  } catch {
    return null;
  }
}

export const useProxyStore = create<ProxyStore>((set, get) => ({
  mode: "auto",
  manualUrl: "",
  systemProxyUrl: "",
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return;
    let mode: ProxyMode = "auto";
    let manualUrl = "";
    try {
      const legacy = migrateLegacy();
      if (legacy) {
        mode = legacy.mode;
        manualUrl = legacy.manualUrl;
      } else {
        const stored = localStorage.getItem(MODE_KEY);
        if (stored === "auto" || stored === "manual" || stored === "off") {
          mode = stored;
        }
        manualUrl = localStorage.getItem(MANUAL_URL_KEY) || "";
      }
    } catch {
      /* private mode */
    }
    // 移动端：固定 auto + 不读 sysproxy，VPN 透明转发
    if (isMobile()) {
      mode = "auto";
    }
    const systemProxyUrl = await detectSystemProxy();
    set({ mode, manualUrl, systemProxyUrl, hydrated: true });
  },
  setMode: (m) => {
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
    set({ mode: m });
  },
  setManualUrl: (u) => {
    try {
      if (u) localStorage.setItem(MANUAL_URL_KEY, u);
      else localStorage.removeItem(MANUAL_URL_KEY);
    } catch {
      /* ignore */
    }
    set({ manualUrl: u });
  },
  refreshSystemProxy: async () => {
    const systemProxyUrl = await detectSystemProxy();
    set({ systemProxyUrl });
  },
}));

/** 给非 React 代码（如 scriptFetch / VideoPlayer 切源）同步读取激活的代理 URL */
export function getActiveProxyUrl(): string | undefined {
  const s = useProxyStore.getState();
  if (s.mode === "off") return undefined;
  if (s.mode === "manual") {
    const url = s.manualUrl.trim();
    return url || undefined;
  }
  // auto
  const url = s.systemProxyUrl.trim();
  return url || undefined;
}
