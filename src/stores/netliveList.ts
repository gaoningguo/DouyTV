/**
 * NetLive 列表/导航/选择态 —— 跨路由 keep-alive 用。
 *
 * 为什么单独一个 store:Network.tsx 在 React Router 切到 /live/room/* 再回来时会 unmount,
 * useState 全丢,导致回来就重刷列表。把 list / page / hasMore / categories /
 * boostedRooms / section / activeCategory / searchQuery / activeRoom / 滚动位置
 * 都放进这里,组件 mount 时直接读 store,不为空就跳过自动 loadList。
 *
 * 注意:resolved (NetLiveStream) 含 callback(agora.refresh),不能 serialize 跨 mount,
 * 仍留在 Network.tsx 的 useState 里。组件 mount 时如果 store.activeRoom 非空,
 * 重新调 adapter.resolve(activeRoom) 即可。
 */
import { create } from "zustand";
import type {
  NetLiveCategory,
  NetLivePlatformId,
  NetLiveRoom,
} from "@/lib/netlive/types";

export type Section = "recommend" | "favorites" | "history";

interface NetLiveListState {
  list: NetLiveRoom[];
  page: number;
  hasMore: boolean;
  categories: NetLiveCategory[];
  boostedRooms: NetLiveRoom[];
  section: Section;
  activeCategory: string | null;
  searchQuery: string;
  searchInput: string;
  activeRoom: NetLiveRoom | null;
  /** 列表上次滚动到的 scrollTop —— 返回时 restore */
  scrollTop: number;
  /**
   * 标记上次 loadList 对应的 (platform, category, search, section)
   * —— 组件 mount 时如果跟当前选中状态匹配且 list 非空,跳过自动 loadList。
   * 平台/分类/搜索切换会改变这个 key,触发重拉。
   */
  loadedKey: { platform: NetLivePlatformId; category: string | null; search: string; section: Section } | null;

  /* setters */
  setList: (list: NetLiveRoom[]) => void;
  appendList: (more: NetLiveRoom[]) => void;
  setPage: (p: number) => void;
  setHasMore: (v: boolean) => void;
  setCategories: (c: NetLiveCategory[]) => void;
  setBoostedRooms: (r: NetLiveRoom[]) => void;
  setSection: (s: Section) => void;
  setActiveCategory: (c: string | null) => void;
  setSearchQuery: (q: string) => void;
  setSearchInput: (q: string) => void;
  setActiveRoom: (r: NetLiveRoom | null) => void;
  setScrollTop: (n: number) => void;
  setLoadedKey: (k: NetLiveListState["loadedKey"]) => void;
  /** 切平台时调:清掉跟旧平台绑定的所有状态 */
  resetForPlatformSwitch: () => void;
}

export const useNetLiveListStore = create<NetLiveListState>((set) => ({
  list: [],
  page: 1,
  hasMore: false,
  categories: [],
  boostedRooms: [],
  section: "recommend",
  activeCategory: null,
  searchQuery: "",
  searchInput: "",
  activeRoom: null,
  scrollTop: 0,
  loadedKey: null,

  setList: (list) => set({ list }),
  appendList: (more) => set((s) => ({ list: [...s.list, ...more] })),
  setPage: (page) => set({ page }),
  setHasMore: (hasMore) => set({ hasMore }),
  setCategories: (categories) => set({ categories }),
  setBoostedRooms: (boostedRooms) => set({ boostedRooms }),
  setSection: (section) => set({ section }),
  setActiveCategory: (activeCategory) => set({ activeCategory }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSearchInput: (searchInput) => set({ searchInput }),
  setActiveRoom: (activeRoom) => set({ activeRoom }),
  setScrollTop: (scrollTop) => set({ scrollTop }),
  setLoadedKey: (loadedKey) => set({ loadedKey }),
  resetForPlatformSwitch: () =>
    set({
      list: [],
      page: 1,
      hasMore: false,
      categories: [],
      boostedRooms: [],
      section: "recommend",
      activeCategory: null,
      searchQuery: "",
      searchInput: "",
      scrollTop: 0,
      loadedKey: null,
      // activeRoom 保留:用户从一个平台回到列表想看到上次播的房间;切平台时上层主动决定是否清
    }),
}));
