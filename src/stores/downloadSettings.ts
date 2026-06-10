import { create } from "zustand";

interface DownloadSettingsStore {
  downloadDir: string;
  concurrency: number;
  hydrated: boolean;
  hydrate: () => void;
  setDownloadDir: (value: string) => void;
  setConcurrency: (value: number) => void;
}

const DOWNLOAD_DIR_KEY = "douytv:download-dir";
const DOWNLOAD_CONCURRENCY_KEY = "douytv:download-concurrency";

function clampConcurrency(value: number) {
  if (!Number.isFinite(value)) return 2;
  return Math.max(1, Math.min(4, Math.round(value)));
}

export const useDownloadSettingsStore = create<DownloadSettingsStore>((set, get) => ({
  downloadDir: "",
  concurrency: 2,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    try {
      const downloadDir = localStorage.getItem(DOWNLOAD_DIR_KEY) || "";
      const concurrency = clampConcurrency(
        Number(localStorage.getItem(DOWNLOAD_CONCURRENCY_KEY) || 2)
      );
      set({ downloadDir, concurrency, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  setDownloadDir: (value) => {
    try {
      const clean = value.trim();
      if (clean) localStorage.setItem(DOWNLOAD_DIR_KEY, clean);
      else localStorage.removeItem(DOWNLOAD_DIR_KEY);
    } catch {}
    set({ downloadDir: value });
  },

  setConcurrency: (value) => {
    const concurrency = clampConcurrency(value);
    try {
      localStorage.setItem(DOWNLOAD_CONCURRENCY_KEY, String(concurrency));
    } catch {}
    set({ concurrency });
  },
}));

export function getDownloadSettings() {
  useDownloadSettingsStore.getState().hydrate();
  const state = useDownloadSettingsStore.getState();
  return {
    downloadDir: state.downloadDir.trim(),
    concurrency: clampConcurrency(state.concurrency),
  };
}
