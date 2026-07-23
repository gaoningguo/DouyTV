/**
 * 源站寻片浏览状态 store —— 让「源站寻片」列表页和「播放页播放列表抽屉」共享同一份数据。
 *
 * 原本这些状态散在 Search.tsx 的组件里（browseScriptKey / browseSourceId / browseResults …），
 * 弹层一关就丢，且详情/播放页拿不到列表。提到 store 后：
 *   - 源站寻片列表页（pages/SourceBrowse.tsx）读写这份状态，翻页 loadMore；
 *   - 播放页抽屉直接读 results，点一个即时开播，并能继续 loadMore 翻页。
 *
 * 数据来源仍是 lib/vodSourceDiscovery（带 1h 缓存 + 分页），本 store 只做状态编排。
 */
import { create } from "zustand";
import { useScriptStore } from "@/stores/scripts";
import {
  getSourceCategories,
  loadSourceCategoryVideos,
  searchSourceVideos,
} from "@/lib/vodSourceDiscovery";
import type { SearchResult } from "@/hooks/useSearch";
import type { ScriptSourceItem } from "@/source-script/types";

const BROWSE_SCRIPT_KEY = "douytv:browse-script";
const BROWSE_SOURCE_KEY = "douytv:browse-source";

export type BrowseMode = "browse" | "search";

function readStored(key: string): string {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeStored(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* private mode */
  }
}

interface VodBrowseStore {
  scriptKey: string;
  sourceId: string;
  subSources: ScriptSourceItem[];
  subLoading: boolean;
  results: SearchResult[];
  loading: boolean;
  error?: string;
  page: number;
  hasMore: boolean;
  mode: BrowseMode;
  searchKeyword: string;

  /** 首次进入或脚本列表变化时确保选中一个默认源，并拉分类。 */
  ensureInit: () => void;
  pickScript: (key: string) => void;
  pickSubSource: (id: string) => void;
  submitSearch: (keyword: string) => void;
  backToBrowse: () => void;
  /** 加载指定页；replace=true 覆盖，false 追加。默认沿用当前 mode/keyword。 */
  load: (
    page: number,
    replace: boolean,
    mode?: BrowseMode,
    keyword?: string
  ) => Promise<void>;
  loadMore: () => Promise<void>;
}

export const useVodBrowseStore = create<VodBrowseStore>((set, get) => {
  /** 拉当前选中源的子分类，成功后自动选中第一个分类。 */
  const loadCategories = async (scriptKey: string) => {
    const desc = useScriptStore
      .getState()
      .scripts.find((s) => s.enabled && s.key === scriptKey);
    if (!desc) {
      set({ subSources: [] });
      return;
    }
    set({ subLoading: true });
    try {
      const list = await getSourceCategories(desc);
      // 拉分类是异步的，期间用户可能已切到别的源 —— 丢弃过期结果。
      if (get().scriptKey !== scriptKey) return;
      const first = list[0]?.id || "";
      set({
        subSources: list,
        sourceId: first,
        results: [],
        page: 1,
        hasMore: true,
      });
      writeStored(BROWSE_SOURCE_KEY, first);
      if (first) void get().load(1, true, "browse");
    } catch (e) {
      if (get().scriptKey !== scriptKey) return;
      console.warn("[vodBrowse] getSources failed", e);
      set({ subSources: [] });
    } finally {
      if (get().scriptKey === scriptKey) set({ subLoading: false });
    }
  };

  return {
    scriptKey: readStored(BROWSE_SCRIPT_KEY),
    sourceId: readStored(BROWSE_SOURCE_KEY),
    subSources: [],
    subLoading: false,
    results: [],
    loading: false,
    error: undefined,
    page: 1,
    hasMore: true,
    mode: "browse",
    searchKeyword: "",

    ensureInit: () => {
      const enabled = useScriptStore
        .getState()
        .scripts.filter((s) => s.enabled);
      if (enabled.length === 0) return;
      let key = get().scriptKey;
      if (!key || !enabled.some((s) => s.key === key)) {
        key = enabled[0].key;
        set({ scriptKey: key });
        writeStored(BROWSE_SCRIPT_KEY, key);
      }
      // 没有子分类（首次进入 / 换源后未拉）时补拉。
      if (get().subSources.length === 0) void loadCategories(key);
    },

    pickScript: (key) => {
      set({
        scriptKey: key,
        sourceId: "",
        subSources: [],
        results: [],
        page: 1,
        hasMore: true,
        mode: "browse",
        searchKeyword: "",
        error: undefined,
      });
      writeStored(BROWSE_SCRIPT_KEY, key);
      writeStored(BROWSE_SOURCE_KEY, "");
      void loadCategories(key);
    },

    pickSubSource: (id) => {
      set({
        sourceId: id,
        results: [],
        page: 1,
        hasMore: true,
        mode: "browse",
        error: undefined,
      });
      writeStored(BROWSE_SOURCE_KEY, id);
      void get().load(1, true, "browse");
    },

    submitSearch: (keyword) => {
      const kw = keyword.trim();
      if (!kw || !get().scriptKey) return;
      set({
        mode: "search",
        searchKeyword: kw,
        results: [],
        page: 1,
        hasMore: true,
        error: undefined,
      });
      void get().load(1, true, "search", kw);
    },

    backToBrowse: () => {
      set({
        mode: "browse",
        searchKeyword: "",
        results: [],
        page: 1,
        hasMore: true,
        error: undefined,
      });
      const { scriptKey, sourceId } = get();
      if (scriptKey && sourceId) void get().load(1, true, "browse");
    },

    load: async (page, replace, mode, keyword) => {
      const state = get();
      const useMode = mode ?? state.mode;
      const useKeyword = keyword ?? state.searchKeyword;
      const { scriptKey, sourceId } = state;
      if (!scriptKey) return;
      if (useMode === "browse" && !sourceId) return;
      if (useMode === "search" && !useKeyword.trim()) return;
      const desc = useScriptStore
        .getState()
        .scripts.find((s) => s.enabled && s.key === scriptKey);
      if (!desc) return;
      set({ loading: true, error: undefined });
      try {
        const r =
          useMode === "search"
            ? await searchSourceVideos(desc, useKeyword.trim(), page)
            : await loadSourceCategoryVideos(desc, sourceId, page);
        // 期间用户可能已切源/切模式 —— 丢弃过期结果。
        const now = get();
        if (
          now.scriptKey !== scriptKey ||
          now.mode !== useMode ||
          (useMode === "search" && now.searchKeyword !== useKeyword.trim()) ||
          (useMode === "browse" && now.sourceId !== sourceId)
        ) {
          return;
        }
        set((prev) => ({
          results: replace ? r.rows : [...prev.results, ...r.rows],
          page,
          hasMore: (r.page || page) < (r.pageCount || page),
        }));
      } catch (e) {
        set({ error: (e as Error)?.message ?? String(e) });
      } finally {
        if (get().scriptKey === scriptKey) set({ loading: false });
      }
    },

    loadMore: async () => {
      const { loading, hasMore, page } = get();
      if (loading || !hasMore) return;
      await get().load(page + 1, false);
    },
  };
});
