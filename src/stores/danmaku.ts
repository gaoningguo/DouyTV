/**
 * 弹幕用户偏好 + 后端配置。
 *
 * 持久化策略：localStorage 多键，避免一处更新触发整 blob 写。
 *   douytv:danmaku-source-type  builtin | custom
 *   douytv:danmaku-api-base     自定义后端 URL
 *   douytv:danmaku-token        自定义后端 token
 *   douytv:danmaku-prefs        显示设置 + 行为开关 + 过滤规则的 JSON
 *
 * 配套：弹幕的运行时 selection（当前 anime/episode）不在这里 —— 那是 per-video 状态，
 * 由 DanmakuPanel 自己管 localStorage["douytv:danmaku-memories"]。
 */
import { create } from "zustand";
import type {
  DanmakuFilterRule,
  DanmakuSourceType,
} from "@/lib/danmaku/types";

const SRC_KEY = "douytv:danmaku-source-type";
const BASE_KEY = "douytv:danmaku-api-base";
const TOKEN_KEY = "douytv:danmaku-token";
const PREFS_KEY = "douytv:danmaku-prefs";

interface Prefs {
  /** Play 页是否默认开启弹幕显示 */
  enabled: boolean;
  /** Play 页是否在打开时自动加载上次选过的 episode（按 title 记忆） */
  autoLoad: boolean;
  /** Home Feed 是否启用弹幕（默认关，避免短视频被刷屏） */
  enabledInFeed: boolean;
  /** 显示设置 */
  opacity: number; // 0-1
  fontSize: number; // px
  speed: number; // 3-20
  marginTop: number; // px
  marginBottom: number | string; // 像素或百分比
  maxlength: number; // 同屏最大弹幕数
  /** 过滤规则数组 */
  filterRules: DanmakuFilterRule[];
}

const DEFAULT_PREFS: Prefs = {
  enabled: true,
  autoLoad: true,
  enabledInFeed: false,
  opacity: 1,
  fontSize: 25,
  speed: 5,
  marginTop: 10,
  marginBottom: "25%",
  maxlength: 100,
  filterRules: [],
};

interface DanmakuStore extends Prefs {
  sourceType: DanmakuSourceType;
  apiBase: string;
  token: string;
  hydrated: boolean;

  hydrate: () => void;
  setSourceType: (t: DanmakuSourceType) => void;
  setApiBase: (s: string) => void;
  setToken: (s: string) => void;
  patchPrefs: (patch: Partial<Prefs>) => void;
  addFilterRule: (rule: DanmakuFilterRule) => void;
  removeFilterRule: (index: number) => void;
  toggleFilterRule: (index: number) => void;
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return DEFAULT_PREFS;
  }
}

function persistPrefs(prefs: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (e) {
    console.warn("[danmaku-store] prefs persist failed", e);
  }
}

export const useDanmakuStore = create<DanmakuStore>((set, get) => ({
  sourceType: "builtin",
  apiBase: "",
  token: "",
  hydrated: false,
  ...DEFAULT_PREFS,

  hydrate: () => {
    if (get().hydrated) return;
    let sourceType: DanmakuSourceType = "builtin";
    let apiBase = "";
    let token = "";
    try {
      const t = localStorage.getItem(SRC_KEY);
      if (t === "custom") sourceType = "custom";
      apiBase = localStorage.getItem(BASE_KEY) || "";
      token = localStorage.getItem(TOKEN_KEY) || "";
    } catch {
      /* private */
    }
    const prefs = loadPrefs();
    set({ sourceType, apiBase, token, ...prefs, hydrated: true });
  },

  setSourceType: (t) => {
    try {
      localStorage.setItem(SRC_KEY, t);
    } catch {
      /* private */
    }
    set({ sourceType: t });
  },

  setApiBase: (s) => {
    try {
      localStorage.setItem(BASE_KEY, s);
    } catch {
      /* private */
    }
    set({ apiBase: s });
  },

  setToken: (s) => {
    try {
      localStorage.setItem(TOKEN_KEY, s);
    } catch {
      /* private */
    }
    set({ token: s });
  },

  patchPrefs: (patch) => {
    const current: Prefs = {
      enabled: get().enabled,
      autoLoad: get().autoLoad,
      enabledInFeed: get().enabledInFeed,
      opacity: get().opacity,
      fontSize: get().fontSize,
      speed: get().speed,
      marginTop: get().marginTop,
      marginBottom: get().marginBottom,
      maxlength: get().maxlength,
      filterRules: get().filterRules,
    };
    const next = { ...current, ...patch };
    persistPrefs(next);
    set(next);
  },

  addFilterRule: (rule) => {
    const next = [...get().filterRules, rule];
    get().patchPrefs({ filterRules: next });
  },

  removeFilterRule: (index) => {
    const next = get().filterRules.filter((_, i) => i !== index);
    get().patchPrefs({ filterRules: next });
  },

  toggleFilterRule: (index) => {
    const next = get().filterRules.map((r, i) =>
      i === index ? { ...r, enabled: !r.enabled } : r
    );
    get().patchPrefs({ filterRules: next });
  },
}));

/**
 * 应用过滤规则到 artplayer-plugin-danmuku 的 filter 回调里。
 * 返回 true 保留，返回 false 屏蔽。
 */
export function makeDanmakuFilter(): (danmu: { text: string }) => boolean {
  return (danmu) => {
    const rules = useDanmakuStore.getState().filterRules;
    if (!rules || rules.length === 0) return true;
    for (const r of rules) {
      if (!r.enabled || !r.keyword) continue;
      try {
        if (r.type === "regex") {
          if (new RegExp(r.keyword).test(danmu.text)) return false;
        } else {
          if (danmu.text.includes(r.keyword)) return false;
        }
      } catch {
        // 正则解析失败时忽略该规则
      }
    }
    return true;
  };
}
