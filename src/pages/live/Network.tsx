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
import { useNetLiveStore } from "@/stores/netlive";
import { getAdapter, listSupportedPlatforms } from "@/lib/netlive/registry";
import {
  NETLIVE_PLATFORMS,
  type NetLiveCategory,
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
type Section = "recommend" | "favorites" | "history";

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

  const [list, setList] = useState<NetLiveRoom[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [resolved, setResolved] = useState<NetLiveStream | null>(null);
  const [activeRoom, setActiveRoom] = useState<NetLiveRoom | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [switchingQn, setSwitchingQn] = useState(false);

  const [danmaku, setDanmaku] = useState<DanmakuMessage[]>([]);
  const [danmakuStatus, setDanmakuStatus] = useState<string>("");
  const [danmakuOn, setDanmakuOn] = useState(true);
  const danmakuClientRef = useRef<DanmakuClient | null>(null);

  const [categories, setCategories] = useState<NetLiveCategory[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("recommend");
  /** 推荐 feed 的优先品类「加塞」列表 —— 与 list 拼合显示，dedup by roomId */
  const [boostedRooms, setBoostedRooms] = useState<NetLiveRoom[]>([]);

  /** 搜索：searchQuery 非空时 loadList 走 adapter.search 而不是 getRecommend/getCategoryRooms */
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");

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
        setList((prev) => (append ? [...prev, ...res.list] : res.list));
        setHasMore(res.hasMore);
      } catch (e) {
        if (gen !== loadGenRef.current) return;
        setError((e as Error).message ?? String(e));
        if (!append) setList([]);
        setHasMore(false);
      } finally {
        if (gen === loadGenRef.current) setLoading(false);
      }
    },
    []
  );

  // 切平台：清状态 + 拉默认推荐 + 异步拉分类
  useEffect(() => {
    setActiveCategory(null);
    setPage(1);
    setCategories([]);
    setSection("recommend");
    setSearchQuery("");
    setSearchInput("");
    setList([]); // 立刻清，避免显示老平台旧数据；后续 loading 期间走 skeleton
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
    [noteVisit]
  );

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

  /* ───────────── 弹幕：activeRoom 变化时启停 ───────────── */
  useEffect(() => {
    danmakuClientRef.current?.stop();
    danmakuClientRef.current = null;
    setDanmaku([]);
    setDanmakuStatus("");
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
  }, [activeRoom, danmakuOn]);

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
      void playRoom(r);
    },
    [playRoom]
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
    /* h-full + 子元素自管滚动：移动端整体 scroll + aside sticky；
       桌面 lg 双栏，main / aside 各自 overflow-y-auto，aside 永远在视野里 */
    <div className="h-full flex flex-col lg:flex-row gap-3 lg:gap-4 p-3 overflow-y-auto lg:overflow-hidden">
      {/* ───────────── 主区：tabs + 分类 + grid（卡片区独立滚动） ───────────── */}
      <div className="flex-1 min-w-0 lg:overflow-y-auto lg:min-h-0 order-2 lg:order-1 no-scrollbar">
        {/* sticky header —— 平台 tab + section chips + 分类 strip。
            **只在桌面 sticky**：移动端整页一起滚（root 已 overflow-y-auto），
            否则会和 aside 的 sticky top-0 在 root 内争同一 top:0 位置，
            导致 header z-20 把 player aside (z-10) 顶部盖住。 */}
        <div
          className="-mx-3 px-3 pt-1 pb-2 lg:sticky lg:top-0 lg:z-20"
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
        </div>

        {/* 错误条 —— 列表 unsupported 走 EmptyState 友好提示，否则红色错误条 */}
        {error && (
          isListUnsupportedMessage(error) ? (
            <EmptyState
              icon={<IconStats size={48} />}
              title={stripListUnsupportedPrefix(error)}
              subtitle="该平台未提供公开的列表 / 推荐接口。请使用上方搜索框查找主播，或直接输入房间 ID 访问。"
              className="mt-3 mb-3"
            />
          ) : (
            <div
              className="p-2 rounded-lg text-[11px] font-mono mt-3 mb-3"
              style={{
                background: "rgba(255,80,80,0.08)",
                color: "#FF6B6B",
                border: "1px solid rgba(255,80,80,0.25)",
              }}
            >
              ✗ {error}
            </div>
          )
        )}

        {/* Grid（顶部留 padding，避免被 sticky header 卡住开头一行） */}
        <div className="pt-3">
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

        {/* 加载更多（仅推荐 section 且有 hasMore） */}
        {section === "recommend" && sectionData.length > 0 && hasMore && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => {
                const np = page + 1;
                setPage(np);
                void loadList(activePlatform, np, true, activeCategory, searchQuery);
              }}
              disabled={loading}
              className="px-4 py-2 rounded-lg text-[11px] font-display font-semibold tap text-cream disabled:opacity-50"
              style={{
                background: "var(--ink-2)",
                border: "1px solid var(--cream-line)",
              }}
            >
              {loading ? "加载中…" : "加载更多"}
            </button>
          </div>
        )}
        </div>
      </div>

      {/* ───────────── 侧栏：player + resolutions + 弹幕。永远可见 ─────────────
           移动端：sticky 在视口顶端（DOM 顺序排第一，order-1）。
           桌面：右侧 420px 一栏，max-h-full + overflow-y-auto，
                 不随卡片区滚动，常驻视野。 */}
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
              <VideoPlayer item={mediaItem} active controls />
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
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
 * PlatformTabs —— 文本 tab + 底部 underline indicator
 * 复刻 pure_live `popular_page.dart` 的 TabBar 视觉。
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
  // 18+ 平台：未开启总开关时隐藏对应 tab
  const visiblePlatforms = NETLIVE_PLATFORMS.filter(
    (p) => adultEnabled || !p.adult
  );
  return (
    <div
      className="flex items-center gap-1 border-b overflow-x-auto"
      style={{ borderColor: "var(--cream-line)" }}
    >
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
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => enabled && onSelect(p.id)}
            disabled={!enabled}
            title={h?.msg ?? (h?.ok ? "可用" : "未检测")}
            className={`relative px-4 py-2 font-display whitespace-nowrap tap disabled:opacity-40 ${
              isActive
                ? "text-ember font-bold"
                : "text-cream-dim hover:text-cream font-medium"
            }`}
            style={{ fontSize: 13 }}
          >
            <span className="inline-flex items-center gap-1.5">
              {enabled && (
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{ background: dotColor }}
                />
              )}
              {p.label}
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
      <div className="ml-auto flex items-center gap-1.5 pb-1">{actions}</div>
    </div>
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
