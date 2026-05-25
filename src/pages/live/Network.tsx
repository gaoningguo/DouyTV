/**
 * 网络直播面板 —— 嵌入 /live 页面的 "网络直播" tab。
 *
 * 布局参照 pure_live `modules/popular/popular_page.dart` + `modules/live_play/live_play_page.dart`：
 *   - 顶部 TabBar：6 平台（text + 底部 ember underline indicator），右侧 actions（健康检测 / 刷新）
 *   - 第二行：section 切换 (推荐 / 收藏 / 历史) + 分类 chip strip（仅推荐时显示）
 *   - lg 断点二栏：
 *       主区 (fluid)  ← MediaGrid + RoomCard
 *       侧栏 (420px) ← VideoPlayer + ResolutionsRow + DanmakuPane
 *   - 小屏（< lg）：垂直堆叠（player → ResolutionsRow → DanmakuPane → MediaGrid）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useViewport } from "@/hooks/useViewport";
import { useNetLiveStore } from "@/stores/netlive";
import { useNetLiveListStore } from "@/stores/netliveList";
import {
  useNetliveProxyStore,
  getEffectiveMode,
  getDefaultMode,
  type NetliveProxyMode,
} from "@/stores/netliveProxy";
import { getAdapter, listSupportedPlatforms } from "@/lib/netlive/registry";
import {
  NETLIVE_PLATFORMS,
  type NetLivePlatformId,
  type NetLiveRoom,
  type NetLiveStream,
  isListUnsupportedMessage,
  stripListUnsupportedPrefix,
} from "@/lib/netlive/types";
import { createDouyuDanmaku } from "@/lib/netlive/danmaku/douyu";
import type { DanmakuClient, DanmakuMessage } from "@/lib/netlive/danmaku/types";
import VideoPlayer from "@/components/VideoPlayer";
import { RoomCard, SkeletonCard } from "@/components/RoomCard";
import { MediaGrid } from "@/components/MediaGrid";
import { EmptyState } from "@/components/EmptyState";
import {
  IconRefresh,
  IconLive,
  IconHeart,
  IconClock,
  IconStats,
  IconFire,
  IconQuality,
  IconChevronDown,
  IconFullscreen,
} from "@/components/Icon";
import type { MediaItem } from "@/types/media";

const DANMAKU_MAX = 120;

/**
 * 优先品类关键字 —— 出现在分类名里的会被排到最前并在默认推荐里加塞。
 * 各平台叫法不同：B 站「舞蹈/颜值」、斗鱼「颜值/陪玩」、虎牙「美女主播/星秀」、
 * 快手/抖音「颜值/陪伴」…… 用 includes 命中通用关键字即可。
 */
const PRIORITY_KEYWORDS = [
  "舞蹈",
  "擦边",
  "颜值",
  "美女",
  "陪伴",
  "陪玩",
  "户外",
  "星秀",
  "唱见",
  "声活",
  "情感",
  "派对",
  "一起看",
];

function categoryPriority(name: string | undefined): number {
  if (!name) return PRIORITY_KEYWORDS.length;
  for (let i = 0; i < PRIORITY_KEYWORDS.length; i++) {
    if (name.includes(PRIORITY_KEYWORDS[i])) return i;
  }
  return PRIORITY_KEYWORDS.length;
}

export default function NetworkLivePanel() {
  const navigate = useNavigate();
  const { isDesktop } = useViewport();
  const activePlatform = useNetLiveStore((s) => s.activePlatform);
  const favorites = useNetLiveStore((s) => s.favorites);
  const history = useNetLiveStore((s) => s.history);
  const health = useNetLiveStore((s) => s.health);
  const checking = useNetLiveStore((s) => s.checking);
  const adultEnabled = useNetLiveStore((s) => s.adultEnabled);
  const setActivePlatform = useNetLiveStore((s) => s.setActivePlatform);
  const toggleFavorite = useNetLiveStore((s) => s.toggleFavorite);
  const isFavorite = useNetLiveStore((s) => s.isFavorite);
  const noteVisit = useNetLiveStore((s) => s.noteVisit);
  const clearHistory = useNetLiveStore((s) => s.clearHistory);
  const checkAll = useNetLiveStore((s) => s.checkAll);
  const hydrate = useNetLiveStore((s) => s.hydrate);

  // 列表 / 导航 / 选择态 走 keep-alive store(切到 /live/room/* 再返回时保留)
  const list = useNetLiveListStore((s) => s.list);
  const setList = useNetLiveListStore((s) => s.setList);
  const appendList = useNetLiveListStore((s) => s.appendList);
  const page = useNetLiveListStore((s) => s.page);
  const setPage = useNetLiveListStore((s) => s.setPage);
  const hasMore = useNetLiveListStore((s) => s.hasMore);
  const setHasMore = useNetLiveListStore((s) => s.setHasMore);
  const categories = useNetLiveListStore((s) => s.categories);
  const setCategories = useNetLiveListStore((s) => s.setCategories);
  const boostedRooms = useNetLiveListStore((s) => s.boostedRooms);
  const setBoostedRooms = useNetLiveListStore((s) => s.setBoostedRooms);
  const section = useNetLiveListStore((s) => s.section);
  const setSection = useNetLiveListStore((s) => s.setSection);
  const activeCategory = useNetLiveListStore((s) => s.activeCategory);
  const setActiveCategory = useNetLiveListStore((s) => s.setActiveCategory);
  const searchQuery = useNetLiveListStore((s) => s.searchQuery);
  const setSearchQuery = useNetLiveListStore((s) => s.setSearchQuery);
  const searchInput = useNetLiveListStore((s) => s.searchInput);
  const setSearchInput = useNetLiveListStore((s) => s.setSearchInput);
  const activeRoom = useNetLiveListStore((s) => s.activeRoom);
  const setActiveRoom = useNetLiveListStore((s) => s.setActiveRoom);
  const loadedKey = useNetLiveListStore((s) => s.loadedKey);
  const setLoadedKey = useNetLiveListStore((s) => s.setLoadedKey);
  const resetForPlatformSwitch = useNetLiveListStore((s) => s.resetForPlatformSwitch);
  const storedScrollTop = useNetLiveListStore((s) => s.scrollTop);
  const setStoredScrollTop = useNetLiveListStore((s) => s.setScrollTop);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [resolved, setResolved] = useState<NetLiveStream | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [switchingQn, setSwitchingQn] = useState(false);

  const [danmaku, setDanmaku] = useState<DanmakuMessage[]>([]);
  const [danmakuStatus, setDanmakuStatus] = useState<string>("");
  const [danmakuOn, setDanmakuOn] = useState(true);
  const danmakuClientRef = useRef<DanmakuClient | null>(null);

  const supported = useMemo(() => listSupportedPlatforms(), []);

  /**
   * 列表加载 generation token —— 切平台 / 切分类时旧请求若仍在 await，
   * 解决后通过比对 gen 决定是否丢弃结果（adapter 接口未带 AbortSignal，
   * 一律走"忽略陈旧结果"模式比改 7 个 adapter 干净）。
   */
  const loadGenRef = useRef(0);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  /* ───────────── 列表加载 ───────────── */
  const loadList = useCallback(
    async (
      platform: NetLivePlatformId,
      p: number,
      append: boolean,
      categoryId: string | null,
      query: string
    ) => {
      const gen = ++loadGenRef.current;
      setLoading(true);
      setError(null);
      try {
        const adapter = getAdapter(platform);
        const res = query.trim() && adapter.search
          ? await adapter.search(query.trim(), p)
          : categoryId && adapter.getCategoryRooms
            ? await adapter.getCategoryRooms(categoryId, p)
            : await adapter.getRecommend(p, 30);
        if (gen !== loadGenRef.current) return; // 陈旧请求，丢弃
        if (append) appendList(res.list);
        else setList(res.list);
        setHasMore(res.hasMore);
        setLoadedKey({ platform, category: categoryId, search: query, section: "recommend" });
      } catch (e) {
        if (gen !== loadGenRef.current) return;
        setError((e as Error).message ?? String(e));
        if (!append) setList([]);
        setHasMore(false);
      } finally {
        if (gen === loadGenRef.current) setLoading(false);
      }
    },
    [appendList, setList, setHasMore, setLoadedKey]
  );

  // 切平台:清状态 + 拉默认推荐 + 异步拉分类
  // 关键:从 /live/room/* 路由返回时组件重 mount,如果 loadedKey 匹配当前 activePlatform 且 list 非空,
  // 跳过 reset + 重拉(保留滚动 / 列表内容),只补拉缺失的 categories。真的切平台时才 reset。
  const platformInitedRef = useRef(false);
  useEffect(() => {
    const cachedMatchesPlatform =
      loadedKey?.platform === activePlatform && list.length > 0;
    if (!platformInitedRef.current && cachedMatchesPlatform) {
      // 首次 mount 且 store 已有当前平台数据 → 直接复用,只补 categories
      platformInitedRef.current = true;
      if (categories.length === 0) {
        const adapter = (() => {
          try { return getAdapter(activePlatform); } catch { return null; }
        })();
        if (adapter?.getCategories) {
          let cancelled = false;
          adapter.getCategories()
            .then((cats) => { if (!cancelled) setCategories(cats); })
            .catch((e) => console.warn("[netlive] categories failed", e));
          return () => { cancelled = true; };
        }
      }
      return;
    }
    platformInitedRef.current = true;
    // 真的切平台(或首次 mount 且无缓存) → reset 全部 + 重拉
    resetForPlatformSwitch();
    void loadList(activePlatform, 1, false, null, "");
    const adapter = (() => {
      try {
        return getAdapter(activePlatform);
      } catch {
        return null;
      }
    })();
    if (!adapter?.getCategories) return;
    let cancelled = false;
    adapter
      .getCategories()
      .then((cats) => {
        if (!cancelled) setCategories(cats);
      })
      .catch((e) => console.warn("[netlive] categories failed", e));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlatform, loadList]);

  // 切分类 → 重拉第一页（搜索模式不受分类影响）
  useEffect(() => {
    if (section !== "recommend") return;
    setPage(1);
    setList([]); // 同上：清旧数据 → 显 skeleton
    void loadList(activePlatform, 1, false, activeCategory, searchQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory]);

  // 搜索：执行搜索 / 清空搜索时重拉
  useEffect(() => {
    if (section !== "recommend") return;
    setPage(1);
    setList([]);
    // 搜索模式下不应用 activeCategory（搜索全平台）
    void loadList(activePlatform, 1, false, searchQuery ? null : activeCategory, searchQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  /* ───────────── 播放 ───────────── */
  const playRoom = useCallback(
    async (room: NetLiveRoom) => {
      setResolvingId(`${room.platform}:${room.roomId}`);
      setError(null);
      try {
        const stream = await getAdapter(room.platform).resolve(room.roomId);
        setResolved(stream);
        setActiveRoom(room);
        noteVisit(room);
      } catch (e) {
        setError((e as Error).message ?? String(e));
      } finally {
        setResolvingId(null);
      }
    },
    [noteVisit, setActiveRoom]
  );

  // 跨路由 mount 时 store.activeRoom 还在但 resolved (本地 useState) 已丢 → 自动重 resolve
  // 让 player aside 恢复播放。NetLiveStream 含 callback 不能 serialize,只能现拉。
  // 仅桌面端,移动端 aside 不渲染就不必 resolve。
  const reresolvedOnceRef = useRef(false);
  useEffect(() => {
    if (!isDesktop) return;
    if (reresolvedOnceRef.current) return;
    if (!activeRoom || resolved) return;
    reresolvedOnceRef.current = true;
    void playRoom(activeRoom);
  }, [isDesktop, activeRoom, resolved, playRoom]);

  // 滚动位置 save/restore —— 桌面 lg+ 滚 mainScrollRef,移动端滚外层 rootScrollRef。
  // mount 时 restore,unmount 时记入 store。
  const rootScrollRef = useRef<HTMLDivElement>(null);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootScrollRef.current;
    const main = mainScrollRef.current;
    if (storedScrollTop > 0) {
      // 内容渲染后再 scrollTo,否则容器还没高度
      const id = window.requestAnimationFrame(() => {
        if (main && main.scrollHeight > main.clientHeight) main.scrollTop = storedScrollTop;
        else if (root) root.scrollTop = storedScrollTop;
      });
      return () => window.cancelAnimationFrame(id);
    }
    return;
    // 只在 mount 时 restore,storedScrollTop 后续变化不应触发重置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    return () => {
      const main = mainScrollRef.current;
      const root = rootScrollRef.current;
      const top = Math.max(main?.scrollTop ?? 0, root?.scrollTop ?? 0);
      setStoredScrollTop(top);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchQuality = useCallback(
    async (qn: string, fallbackUrl: string) => {
      if (!activeRoom || !resolved) return;
      if (fallbackUrl) {
        setResolved({ ...resolved, url: fallbackUrl, qn });
        return;
      }
      setSwitchingQn(true);
      try {
        const fresh = await getAdapter(activeRoom.platform).resolve(
          activeRoom.roomId
        );
        const match = fresh.alternatives?.find((a) => a.qn === qn);
        const url = match?.url || fresh.url;
        setResolved({ ...fresh, url, qn });
      } catch (e) {
        setError((e as Error).message ?? String(e));
      } finally {
        setSwitchingQn(false);
      }
    },
    [activeRoom, resolved]
  );

  /* ───────────── 弹幕：activeRoom 变化时启停（仅桌面端 aside 可见时） ───────────── */
  useEffect(() => {
    danmakuClientRef.current?.stop();
    danmakuClientRef.current = null;
    setDanmaku([]);
    setDanmakuStatus("");
    if (!isDesktop) return;
    if (!activeRoom || !danmakuOn) return;
    if (activeRoom.platform !== "douyu") return;
    const client = createDouyuDanmaku(activeRoom.roomId, {
      onMessage: (msg) => {
        setDanmaku((prev) => {
          const next =
            prev.length >= DANMAKU_MAX ? prev.slice(-DANMAKU_MAX + 1) : prev;
          return [...next, msg];
        });
      },
      onReady: () => setDanmakuStatus("已连接"),
      onClose: (reason) => setDanmakuStatus(reason),
    });
    danmakuClientRef.current = client;
    setDanmakuStatus("连接中…");
    client.start();
    return () => {
      client.stop();
    };
  }, [isDesktop, activeRoom, danmakuOn]);

  /* ───────────── MediaItem 给 VideoPlayer ───────────── */
  const mediaItem = useMemo<MediaItem | undefined>(() => {
    if (!resolved || !activeRoom) return undefined;
    const headers: Record<string, string> = {};
    if (resolved.ua) headers["User-Agent"] = resolved.ua;
    if (resolved.referer) headers["Referer"] = resolved.referer;
    return {
      id: `netlive:${activeRoom.platform}:${activeRoom.roomId}`,
      kind: "live",
      title: activeRoom.title,
      url: resolved.url,
      streamType: resolved.streamType ?? "hls",
      poster: activeRoom.cover,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      agora: resolved.agora,
    };
  }, [resolved, activeRoom]);

  /* ───────────── 优先品类排序 + 默认推荐加塞 ───────────── */
  const sortedCategories = useMemo(() => {
    const list = [...categories];
    list.sort((a, b) => {
      const pa = categoryPriority(a.name);
      const pb = categoryPriority(b.name);
      if (pa !== pb) return pa - pb;
      return 0; // 同优先级保留原顺序
    });
    return list;
  }, [categories]);

  // 当 section=recommend 且未选分类时，挑命中的优先品类各抓 1 页前 6 个房间，
  // 拼到推荐列表前面。换平台 / 切 section / 选了分类都会清空。
  useEffect(() => {
    setBoostedRooms([]);
    if (section !== "recommend" || activeCategory !== null) return;
    if (categories.length === 0) return;
    const adapter = (() => {
      try {
        return getAdapter(activePlatform);
      } catch {
        return null;
      }
    })();
    if (!adapter?.getCategoryRooms) return;
    const fetchCatRooms = adapter.getCategoryRooms.bind(adapter);
    const targets = sortedCategories
      .filter((c) => categoryPriority(c.name) < PRIORITY_KEYWORDS.length)
      .slice(0, 3);
    if (targets.length === 0) return;
    let cancelled = false;
    Promise.allSettled(targets.map((c) => fetchCatRooms(c.id, 1))).then(
      (results) => {
        if (cancelled) return;
        const rooms: NetLiveRoom[] = [];
        for (const r of results) {
          if (r.status === "fulfilled") rooms.push(...r.value.list.slice(0, 8));
        }
        setBoostedRooms(rooms);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [activePlatform, section, activeCategory, sortedCategories, categories.length]);

  /* ───────────── 当前 section 数据 ───────────── */
  const sectionData = useMemo(() => {
    if (section === "favorites") return favorites;
    if (section === "history") return history.slice(0, 24);
    // recommend 默认（无分类）→ 优先品类房间拼到前面
    if (activeCategory !== null || boostedRooms.length === 0) return list;
    const seen = new Set<string>();
    const merged: NetLiveRoom[] = [];
    for (const r of [...boostedRooms, ...list]) {
      const k = `${r.platform}:${r.roomId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(r);
    }
    return merged;
  }, [section, favorites, history, list, boostedRooms, activeCategory]);

  const sectionEmpty = sectionData.length === 0 && !loading && !error;
  // 推荐 section 首屏空 + 加载中 → 显 skeleton；收藏 / 历史 是本地数据，不会有这种状态
  const showSkeleton =
    section === "recommend" && loading && sectionData.length === 0;

  /* ───────────── 卡片回调：稳定引用，配合 RoomCard memo 减 re-render ───────────── */
  const handleSelectRoom = useCallback(
    (r: NetLiveRoom) => {
      if (!isDesktop) {
        // 移动端：跳转全屏房间页（斗鱼/虎牙模式）
        navigate(
          `/live/room/${r.platform}/${encodeURIComponent(r.roomId)}`,
          { state: { room: r } }
        );
        noteVisit(r);
        return;
      }
      void playRoom(r);
    },
    [isDesktop, navigate, noteVisit, playRoom]
  );
  const handleFavToggle = useCallback(
    (r: NetLiveRoom) => {
      toggleFavorite(r);
    },
    [toggleFavorite]
  );

  const resolvingKey = resolvingId;
  const activeKey = activeRoom
    ? `${activeRoom.platform}:${activeRoom.roomId}`
    : null;

  return (
    /* h-full + overflow-hidden：顶部 header 固定，中间 grid 独立滚动。
       桌面 lg 双栏，main / aside 各自 overflow-y-auto，aside 永远在视野里 */
    <div ref={rootScrollRef} className="h-full flex flex-col lg:flex-row gap-0 lg:gap-4 p-0 lg:p-3 overflow-hidden">
      {/* ───────────── 主区：tabs + 分类 + grid（卡片区独立滚动） ───────────── */}
      <div className="flex-1 min-w-0 flex flex-col lg:min-h-0 order-2 lg:order-1">
        {/* 固定 header —— 平台 tab + section chips + 分类 strip。
            移动端和桌面端都固定在顶部，不随列表滚动。 */}
        <div
          className="px-3 pt-1 pb-2 shrink-0 z-20"
          style={{
            background: "var(--ink)",
            borderBottom: "1px solid var(--cream-line)",
          }}
        >
          {/* Tab bar */}
          <PlatformTabs
            active={activePlatform}
            supported={supported}
            health={health}
            adultEnabled={adultEnabled}
            onSelect={setActivePlatform}
            actions={
              <>
                <ToolbarButton
                  onClick={() => void checkAll()}
                  disabled={checking}
                  title="挨个调每平台的推荐接口探活"
                >
                  {checking ? "检测中…" : "检测全部"}
                </ToolbarButton>
                <ToolbarButton
                  onClick={() => {
                    setPage(1);
                    void loadList(activePlatform, 1, false, activeCategory, searchQuery);
                  }}
                  disabled={loading}
                  title="刷新"
                >
                  <IconRefresh size={12} className="inline mr-1" />
                  刷新
                </ToolbarButton>
              </>
            }
          />

          {/* Section chips */}
          <div className="flex items-center gap-2 mt-2 mb-1 flex-wrap">
            <SectionChip
              icon={<IconLive size={11} />}
              label="推荐"
              active={section === "recommend"}
              onClick={() => setSection("recommend")}
            />
            <SectionChip
              icon={<IconHeart size={11} />}
              label={`收藏 ${favorites.length || ""}`}
              active={section === "favorites"}
              onClick={() => setSection("favorites")}
            />
            <SectionChip
              icon={<IconClock size={11} />}
              label={`历史 ${history.length || ""}`}
              active={section === "history"}
              onClick={() => setSection("history")}
            />
            {section === "history" && history.length > 0 && (
              <button
                type="button"
                onClick={clearHistory}
                className="ml-auto text-[10px] font-mono text-cream-faint hover:text-ember tap"
              >
                清空
              </button>
            )}
          </div>

          {/* 搜索栏（仅推荐 section 显示）—— 搜索模式下走 adapter.search 替代推荐 / 分类列表 */}
          {section === "recommend" && (
            <form
              className="mt-2 flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setSearchQuery(searchInput.trim());
              }}
            >
              <div
                className="flex items-center gap-1.5 flex-1 px-2 py-1 rounded"
                style={{
                  background: "var(--ink-2, rgba(255,255,255,0.04))",
                  border: "1px solid var(--cream-line)",
                }}
              >
                <span style={{ color: "var(--cream-faint)" }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                </span>
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder={`在 ${NETLIVE_PLATFORMS.find((p) => p.id === activePlatform)?.label ?? activePlatform} 搜主播 / 房间`}
                  className="flex-1 bg-transparent outline-none text-[12px] font-mono"
                  style={{ color: "var(--cream)" }}
                />
                {searchInput && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchInput("");
                      setSearchQuery("");
                    }}
                    className="text-[10px] font-mono text-cream-faint hover:text-ember tap"
                    title="清空搜索"
                  >
                    ✕
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={!searchInput.trim()}
                className="text-[11px] font-mono px-2.5 py-1 rounded tap disabled:opacity-40"
                style={{
                  background: searchQuery
                    ? "var(--ember)"
                    : "transparent",
                  color: searchQuery ? "var(--ink)" : "var(--cream)",
                  border: "1px solid var(--cream-line)",
                }}
              >
                {searchQuery ? "搜索中" : "搜索"}
              </button>
            </form>
          )}

          {/* 分类 strip（仅推荐 section 且非搜索模式时显示），舞蹈/颜值/陪伴 等优先品类排到最前 */}
          {section === "recommend" && !searchQuery && sortedCategories.length > 0 && (
            <div className="flex items-center gap-1.5 mt-1 overflow-x-auto pb-1 ">
              <CategoryChip
                label="推荐"
                active={activeCategory === null}
                onClick={() => setActiveCategory(null)}
              />
              {sortedCategories.slice(0, 80).map((c) => {
                const priority =
                  categoryPriority(c.name) < PRIORITY_KEYWORDS.length;
                return (
                  <CategoryChip
                    key={c.id}
                    label={c.name}
                    title={c.parent ? `${c.parent} · ${c.name}` : c.name}
                    active={activeCategory === c.id}
                    highlight={priority}
                    onClick={() => setActiveCategory(c.id)}
                  />
                );
              })}
            </div>
          )}
          {/* 红色错误条 —— 放在 sticky header 内,滚到底也能看见(不滚出视口)。
              List unsupported 的友好 EmptyState 留在 grid 上方,跟着 grid 一起滚。 */}
          {error && !isListUnsupportedMessage(error) && (
            <div
              className="mt-2 p-2 rounded-lg text-[11px] font-mono"
              style={{
                background: "rgba(255,80,80,0.08)",
                color: "#FF6B6B",
                border: "1px solid rgba(255,80,80,0.25)",
              }}
            >
              ✗ {error}
            </div>
          )}
        </div>

        {/* Grid 滚动区 —— 唯一可滚动区域,header 固定不动 */}
        <div ref={mainScrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 pt-3 no-scrollbar">
        {/* 列表无公开端点 → 友好 EmptyState */}
        {error && isListUnsupportedMessage(error) && (
          <EmptyState
            icon={<IconStats size={48} />}
            title={stripListUnsupportedPrefix(error)}
            subtitle="该平台未提供公开的列表 / 推荐接口。请使用上方搜索框查找主播，或直接输入房间 ID 访问。"
            className="mt-3 mb-3"
          />
        )}

        {showSkeleton ? (
          <MediaGrid dense>
            {Array.from({ length: 12 }).map((_, i) => (
              <SkeletonCard key={`sk-${i}`} dense />
            ))}
          </MediaGrid>
        ) : sectionEmpty ? (
          <EmptyState
            icon={<IconLive size={48} />}
            title={
              section === "favorites"
                ? "还没有收藏的房间"
                : section === "history"
                ? "还没有浏览记录"
                : "暂无直播间"
            }
            subtitle={
              section === "recommend"
                ? "试试切换平台 / 分类，或点右上「刷新」"
                : section === "favorites"
                ? "在房间卡片上点 ♥ 即可收藏"
                : "看过的房间会自动出现在这里"
            }
          />
        ) : (
          <MediaGrid dense>
            {sectionData.map((room) => {
              const key = `${room.platform}:${room.roomId}`;
              return (
                <RoomCard
                  key={`${section}:${key}`}
                  room={room}
                  dense
                  active={activeKey === key}
                  resolving={resolvingKey === key}
                  fav={isFavorite(room.platform, room.roomId)}
                  onSelect={handleSelectRoom}
                  onFavToggle={handleFavToggle}
                />
              );
            })}
          </MediaGrid>
        )}

        {/* 加载更多：移动端 IntersectionObserver 自动触发，桌面端保留按钮。
            底部留 BottomTabBar + safe-area 空间,
            否则移动端按钮被底部导航条遮挡点不到。桌面端 lg+ 没 BottomTabBar,留 safe-area 即可。 */}
        {section === "recommend" && sectionData.length > 0 && hasMore && (
          <LoadMoreTrigger
            loading={loading}
            isDesktop={isDesktop}
            onLoadMore={() => {
              const np = page + 1;
              setPage(np);
              void loadList(activePlatform, np, true, activeCategory, searchQuery);
            }}
          />
        )}
        </div>
      </div>

      {/* ───────────── 侧栏：player + resolutions + 弹幕。仅桌面端显示 ─────────────
           移动端点击卡片直接跳全屏房间页，不需要 inline player。
           桌面：右侧 420px 一栏，max-h-full + overflow-y-auto，
                 不随卡片区滚动，常驻视野。 */}
      {isDesktop && (
      <aside
        className="
          order-1 lg:order-2
          w-full lg:w-[420px] lg:shrink-0
          sticky top-0 z-10 lg:static
          lg:max-h-full lg:overflow-y-auto
          flex flex-col gap-2
          pb-2 lg:pb-0
        "
        style={{
          // mobile sticky 时背景必须实色，避免下面卡片透出
          background: "var(--ink)",
        }}
      >
        <div
          className="aspect-video rounded-xl overflow-hidden relative"
          style={{
            background: "var(--ink-3)",
            border: "1px solid var(--cream-line)",
          }}
        >
          {mediaItem ? (
            <>
              <VideoPlayer
                item={mediaItem}
                active
                controls
                netlivePlatform={activeRoom?.platform}
              />
              {/* 大屏 / 沉浸 按钮：跳转 /live/room/:p/:rid */}
              {activeRoom && (
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/live/room/${activeRoom.platform}/${encodeURIComponent(
                        activeRoom.roomId
                      )}`,
                      { state: { room: activeRoom } }
                    )
                  }
                  className="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center tap z-10"
                  style={{
                    background: "rgba(0,0,0,0.55)",
                    color: "white",
                    backdropFilter: "blur(4px)",
                    WebkitBackdropFilter: "blur(4px)",
                  }}
                  title="打开大屏直播间"
                  aria-label="打开大屏直播间"
                >
                  <IconFullscreen size={14} />
                </button>
              )}
            </>
          ) : (
            <EmptyState
              icon={<IconLive size={36} />}
              title="选择一个直播间"
              subtitle="点左侧卡片开始观看"
              className="!py-8 h-full justify-center"
            />
          )}
        </div>

        {/* Resolutions row */}
        {activeRoom && (
          <ResolutionsRow
            stream={resolved}
            online={activeRoom.online}
            switching={switchingQn}
            onSwitch={(qn, url) => void switchQuality(qn, url)}
          />
        )}

        {/* 房间信息 */}
        {activeRoom && (
          <div
            className="px-3 py-2 rounded-lg"
            style={{
              background: "var(--ink-2)",
              border: "1px solid var(--cream-line)",
            }}
          >
            <p className="font-display font-bold text-sm line-clamp-2 text-cream">
              {activeRoom.title}
            </p>
            <p className="font-mono text-[11px] text-cream-faint mt-1">
              {activeRoom.uname ?? "—"}
              {activeRoom.category ? ` · ${activeRoom.category}` : ""}
            </p>
          </div>
        )}

        {/* 弹幕 pane（仅 douyu） */}
        {activeRoom && activeRoom.platform === "douyu" && (
          <DanmakuPane
            messages={danmaku}
            status={danmakuStatus}
            on={danmakuOn}
            onToggle={() => setDanmakuOn((v) => !v)}
            onClear={() => setDanmaku([])}
          />
        )}
      </aside>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
 * PlatformTabs —— 文本 tab + 底部 underline indicator
 * 复刻 pure_live `popular_page.dart` 的 TabBar 视觉。
 * 每个 tab 内嵌一个代理状态指示(▴=代理 / ─=直连),长按 / 右键打开
 * PlatformProxyMenu 切换该平台的 per-platform 代理覆盖。
 * ═══════════════════════════════════════════════════════════ */
function PlatformTabs({
  active,
  supported,
  health,
  adultEnabled,
  onSelect,
  actions,
}: {
  active: NetLivePlatformId;
  supported: NetLivePlatformId[];
  health: ReturnType<typeof useNetLiveStore.getState>["health"];
  adultEnabled: boolean;
  onSelect: (p: NetLivePlatformId) => void;
  actions: React.ReactNode;
}) {
  // 订阅 overrides 整体 —— 任一平台 override 变化都让 tab 状态指示器重画
  const overrides = useNetliveProxyStore((s) => s.overrides);
  const [menuFor, setMenuFor] = useState<NetLivePlatformId | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  // 长按 timer
  const longPressTimerRef = useRef<number | null>(null);
  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const openMenu = (platform: NetLivePlatformId, x: number, y: number) => {
    setMenuFor(platform);
    setMenuPos({ x, y });
  };

  // 18+ 平台：未开启总开关时隐藏对应 tab
  const visiblePlatforms = NETLIVE_PLATFORMS.filter(
    (p) => adultEnabled || !p.adult
  );
  return (
    <div
      className="flex items-stretch gap-1 border-b"
      style={{ borderColor: "var(--cream-line)" }}
    >
      {/* tabs 横滚区(actions 不参与,避免平台多时按钮跑右屏外) */}
      <div className="flex items-center gap-0.5 overflow-x-auto overflow-y-auto h-11 flex-1 min-w-0 no-scrollbar-x">
  
      {visiblePlatforms.map((p) => {
        const enabled = supported.includes(p.id);
        const isActive = active === p.id;
        const h = health[p.id];
        const dotColor = !enabled
          ? "transparent"
          : h
          ? h.ok
            ? "#3DDC84"
            : "#FF6B6B"
          : "var(--cream-faint)";
        // effective = override (if any) > meta.defaultProxy > "direct"
        const effective: NetliveProxyMode =
          overrides[p.id] ?? getEffectiveMode(p.id);
        const isProxy = effective === "proxy";
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => enabled && onSelect(p.id)}
            disabled={!enabled}
            title={`${h?.msg ?? (h?.ok ? "可用" : "未检测")}\n${isProxy ? "走代理" : "直连"}(长按/右键切换)`}
            onContextMenu={(e) => {
              if (!enabled) return;
              e.preventDefault();
              openMenu(p.id, e.clientX, e.clientY);
            }}
            onPointerDown={(e) => {
              if (!enabled) return;
              clearLongPress();
              const x = e.clientX;
              const y = e.clientY;
              longPressTimerRef.current = window.setTimeout(() => {
                openMenu(p.id, x, y);
                longPressTimerRef.current = null;
              }, 550);
            }}
            onPointerUp={clearLongPress}
            onPointerLeave={clearLongPress}
            onPointerCancel={clearLongPress}
            className={`relative px-2.5 lg:px-4 py-2 font-display whitespace-nowrap tap disabled:opacity-40 ${
              isActive
                ? "text-ember font-bold"
                : "text-cream-dim hover:text-cream font-medium"
            }`}
            style={{ fontSize: 12 }}
          >
            <span className="inline-flex items-center gap-1.5">
              {enabled && (
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ background: dotColor }}
                />
              )}
              {p.label}
              {enabled && (
                <span
                  className="font-mono text-[9px] leading-none"
                  style={{
                    color: isProxy ? "var(--ember)" : "var(--cream-faint)",
                    opacity: isProxy ? 0.95 : 0.55,
                  }}
                >
                  {isProxy ? "▴" : "─"}
                </span>
              )}
              {!enabled && (
                <span className="text-[9px] font-mono text-cream-faint ml-1">
                  即将
                </span>
              )}
            </span>
            {isActive && (
              <span
                className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full"
                style={{ background: "var(--ember)" }}
              />
            )}
          </button>
        );
      })}
      </div>
      {/* actions 固定在右侧,带左侧分隔线,平台 tabs 多时横滚不影响这里 */}
      <div
        className="flex items-center gap-1.5 pb-1 pl-2 flex-shrink-0"
        style={{ borderLeft: "1px solid var(--cream-line)" }}
      >
        {actions}
      </div>
      {menuFor && menuPos && (
        <PlatformProxyMenu
          platform={menuFor}
          x={menuPos.x}
          y={menuPos.y}
          onClose={() => {
            setMenuFor(null);
            setMenuPos(null);
          }}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
 * PlatformProxyMenu —— 平台代理覆盖切换浮层
 * 右键 / 长按 tab 触发,fixed 定位在点击点附近。
 * ═══════════════════════════════════════════════════════════ */
function PlatformProxyMenu({
  platform,
  x,
  y,
  onClose,
}: {
  platform: NetLivePlatformId;
  x: number;
  y: number;
  onClose: () => void;
}) {
  const setOverride = useNetliveProxyStore((s) => s.setOverride);
  const override = useNetliveProxyStore((s) => s.overrides[platform]);
  const meta = NETLIVE_PLATFORMS.find((p) => p.id === platform);
  const def = getDefaultMode(platform);
  const effective: NetliveProxyMode = override ?? def;

  const setAndClose = (val: NetliveProxyMode | null) => {
    setOverride(platform, val);
    onClose();
  };

  // 简易屏内 clamp —— menu 估算宽 200 高 140
  const clampedX = Math.min(x, window.innerWidth - 220);
  const clampedY = Math.min(y, window.innerHeight - 160);

  return (
    <>
      {/* 点击遮罩外部关闭 */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="fixed z-50 rounded-lg shadow-2xl p-1.5"
        style={{
          left: clampedX,
          top: clampedY,
          background: "var(--ink-2)",
          border: "1px solid var(--cream-line)",
          minWidth: 200,
        }}
      >
        <div
          className="px-2 py-1 mb-1 text-[10px] font-mono uppercase tracking-wider text-cream-faint"
          style={{ borderBottom: "1px solid var(--cream-line)" }}
        >
          {meta?.label ?? platform} · 代理
        </div>
        <ProxyMenuItem
          label="🔌  走代理"
          active={effective === "proxy"}
          isOverride={override === "proxy"}
          onClick={() => setAndClose("proxy")}
        />
        <ProxyMenuItem
          label="🚀  直连"
          active={effective === "direct"}
          isOverride={override === "direct"}
          onClick={() => setAndClose("direct")}
        />
        {override !== undefined && (
          <ProxyMenuItem
            label={`↺  恢复推荐 (${def === "proxy" ? "代理" : "直连"})`}
            active={false}
            isOverride={false}
            onClick={() => setAndClose(null)}
          />
        )}
      </div>
    </>
  );
}

function ProxyMenuItem({
  label,
  active,
  isOverride,
  onClick,
}: {
  label: string;
  active: boolean;
  isOverride: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full text-left px-2.5 py-1.5 rounded text-xs font-display tap"
      style={{
        background: active ? "var(--ink-3)" : "transparent",
        color: active ? "var(--ember)" : "var(--cream-dim)",
        fontWeight: active ? 600 : 400,
      }}
    >
      <span className="inline-flex items-center gap-1.5">
        {label}
        {active && (
          <span className="text-[9px] font-mono text-phosphor">
            {isOverride ? "[当前]" : "[默认]"}
          </span>
        )}
      </span>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════
 * ResolutionsRow —— 热度 | 清晰度 dropdown | 线路 dropdown
 * 复刻 pure_live `live_play_page.dart#ResolutionsRow`。
 * 这里"线路"暂用 alternatives 充当；后续可扩展多 CDN line。
 * ═══════════════════════════════════════════════════════════ */
function ResolutionsRow({
  stream,
  online,
  switching,
  onSwitch,
}: {
  stream: NetLiveStream | null;
  online?: number;
  switching: boolean;
  onSwitch: (qn: string, url: string) => void;
}) {
  if (!stream) return null;
  const alts = stream.alternatives ?? [];
  return (
    <div
      className="flex items-center justify-between px-3 py-1.5 rounded-lg"
      style={{
        background: "var(--ink-2)",
        border: "1px solid var(--cream-line)",
      }}
    >
      {/* 左：热度 */}
      <div className="flex items-center gap-1.5 text-cream-faint">
        <IconFire size={13} className="text-ember" />
        <span className="font-mono text-[11px]">
          {typeof online === "number"
            ? formatOnlineShort(online)
            : "—"}
        </span>
      </div>

      {/* 右：清晰度 dropdown */}
      <div className="flex items-center gap-2">
        {alts.length > 1 && (
          <QualityDropdown
            stream={stream}
            switching={switching}
            onSwitch={onSwitch}
          />
        )}
        {alts.length <= 1 && stream.qnLabel && (
          <span className="font-mono text-[11px] text-cream-faint inline-flex items-center gap-1">
            <IconQuality size={12} />
            {stream.qnLabel}
          </span>
        )}
      </div>
    </div>
  );
}

function QualityDropdown({
  stream,
  switching,
  onSwitch,
}: {
  stream: NetLiveStream;
  switching: boolean;
  onSwitch: (qn: string, url: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  // 点击外侧关
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const alts = stream.alternatives ?? [];
  const current =
    alts.find((a) => a.qn === stream.qn) ?? { label: stream.qnLabel ?? "原画", qn: stream.qn ?? "" };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={switching}
        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono tap text-ember disabled:opacity-50"
        style={{
          background: "var(--ember-soft)",
          border: "1px solid rgba(255,107,53,0.3)",
        }}
      >
        <IconQuality size={12} />
        {current.label || current.qn || "原画"}
        <IconChevronDown size={10} />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 rounded-lg overflow-hidden z-20 min-w-[110px]"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
            boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
          }}
        >
          {alts.map((alt) => {
            const active = alt.qn === stream.qn;
            return (
              <button
                key={alt.qn}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onSwitch(alt.qn, alt.url);
                }}
                className="block w-full text-left px-3 py-1.5 text-[11px] font-mono tap hover:bg-ink-3"
                style={{
                  color: active ? "var(--ember)" : "var(--cream-dim)",
                  background: active ? "var(--ember-soft)" : "transparent",
                }}
              >
                {alt.label || alt.qn}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function formatOnlineShort(n: number): string {
  if (n >= 100_0000) return `${(n / 100_0000).toFixed(1)}千万`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/* ═══════════════════════════════════════════════════════════
 * Section chip / Category chip / Toolbar button —— 小型样式件
 * ═══════════════════════════════════════════════════════════ */
function SectionChip({
  icon,
  label,
  active,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-display font-semibold tap whitespace-nowrap"
      style={{
        background: active ? "var(--ember-soft)" : "var(--ink-2)",
        border: `1px solid ${
          active ? "rgba(255,107,53,0.4)" : "var(--cream-line)"
        }`,
        color: active ? "var(--ember)" : "var(--cream-dim)",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function CategoryChip({
  label,
  title,
  active,
  highlight,
  onClick,
}: {
  label: string;
  title?: string;
  active: boolean;
  highlight?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="px-2.5 py-1 rounded-full text-[10px] font-mono tap whitespace-nowrap inline-flex items-center gap-1"
      style={{
        background: active
          ? "var(--ember-soft)"
          : highlight
          ? "rgba(255,107,53,0.08)"
          : "var(--ink-2)",
        border: `1px solid ${
          active
            ? "rgba(255,107,53,0.5)"
            : highlight
            ? "rgba(255,107,53,0.25)"
            : "var(--cream-line)"
        }`,
        color: active
          ? "var(--ember)"
          : highlight
          ? "var(--cream)"
          : "var(--cream-faint)",
      }}
    >
      {highlight && !active && (
        <span
          className="inline-block w-1 h-1 rounded-full"
          style={{ background: "var(--ember)" }}
        />
      )}
      {label}
    </button>
  );
}

function ToolbarButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="px-2.5 py-1 rounded-full text-[10px] tap text-cream-faint hover:text-cream disabled:opacity-50 inline-flex items-center"
      style={{
        background: "var(--ink-2)",
        border: "1px solid var(--cream-line)",
      }}
    >
      {children}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════
 * LoadMoreTrigger —— 移动端 IntersectionObserver 自动加载,
 * 桌面端保留按钮(避免误触)。
 * ═══════════════════════════════════════════════════════════ */
function LoadMoreTrigger({
  loading,
  isDesktop,
  onLoadMore,
}: {
  loading: boolean;
  isDesktop: boolean;
  onLoadMore: () => void;
}) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isDesktop) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !loading) {
            onLoadMore();
            break;
          }
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [isDesktop, loading, onLoadMore]);

  return (
    <div
      ref={sentinelRef}
      className="mt-4 flex justify-center"
      style={{
        paddingBottom:
          "calc(var(--bottom-tab-h, env(safe-area-inset-bottom)) + 12px)",
      }}
    >
      {isDesktop ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loading}
          className="px-4 py-2 rounded-lg text-[11px] font-display font-semibold tap text-cream disabled:opacity-50"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
        >
          {loading ? "加载中…" : "加载更多"}
        </button>
      ) : (
        <span className="text-[10px] font-mono text-cream-faint">
          {loading ? "加载中…" : "下滑加载更多"}
        </span>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
 * DanmakuPane —— 弹幕侧栏。沿用原实现。
 * ═══════════════════════════════════════════════════════════ */
function DanmakuPane({
  messages,
  status,
  on,
  onToggle,
  onClear,
}: {
  messages: DanmakuMessage[];
  status: string;
  on: boolean;
  onToggle: () => void;
  onClear: () => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);
  return (
    <div
      className="rounded-lg overflow-hidden flex flex-col flex-1 min-h-[260px]"
      style={{
        background: "var(--ink-2)",
        border: "1px solid var(--cream-line)",
      }}
    >
      <div
        className="flex items-center justify-between px-2.5 py-1.5"
        style={{ borderBottom: "1px solid var(--cream-line)" }}
      >
        <div className="flex items-center gap-2">
          <IconStats size={12} className={on ? "text-ember" : "text-cream-faint"} />
          <span
            className="font-mono text-[10px] tracking-[0.2em]"
            style={{ color: on ? "var(--ember)" : "var(--cream-faint)" }}
          >
            DANMAKU
          </span>
          {status && (
            <span className="font-mono text-[9px] text-cream-faint">
              · {status}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onClear}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono tap text-cream-faint hover:text-cream"
            style={{ background: "var(--ink-3)" }}
          >
            清空
          </button>
          <button
            type="button"
            onClick={onToggle}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono tap"
            style={{
              background: on ? "var(--ember-soft)" : "var(--ink-3)",
              color: on ? "var(--ember)" : "var(--cream-faint)",
            }}
          >
            {on ? "ON" : "OFF"}
          </button>
        </div>
      </div>
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-2.5 py-1.5 space-y-1"
      >
        {messages.length === 0 ? (
          <p className="font-mono text-[10px] text-cream-faint text-center py-4">
            等待弹幕…
          </p>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className="text-[11px] font-mono leading-snug break-words"
            >
              <span className="text-cream-faint mr-1.5">{m.uname}:</span>
              <span style={{ color: m.color ?? "var(--cream)" }}>{m.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
