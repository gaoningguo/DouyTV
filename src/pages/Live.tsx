import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { useLiveStore, type LiveChannel } from "@/stores/live";
import { useLiveSubStore } from "@/stores/liveSubscription";
import { useNetLiveStore } from "@/stores/netlive";
import { useEpgStore } from "@/stores/epg";
import type { EpgProgramme } from "@/lib/epg";
import {
  findCurrent,
  findUpcoming,
  formatProgrammeTime,
} from "@/lib/epg";
import {
  NETLIVE_PLATFORMS,
  type NetLiveRoom,
} from "@/lib/netlive/types";
import VideoPlayer from "@/components/VideoPlayer";
import NetworkLivePanel from "@/pages/live/Network";
import { EmptyState } from "@/components/EmptyState";
import { appConfirm } from "@/components/AppDialog";
import type { MediaItem } from "@/types/media";
import {
  IconAntenna,
  IconArtist,
  IconChevronRight,
  IconClock,
  IconClose,
  IconHeart,
  IconHome,
  IconLive,
  IconList,
  IconSettings,
} from "@/components/Icon";

const PER_GROUP_LIMIT = 200;
const ALL_SOURCE = "__ALL__";
const NO_SOURCE = "__NONE__"; // 手动添加（无 sourceId）的频道

const ChannelRow = memo(function ChannelRow({
  ch,
  idx,
  isActive,
  currentTitle,
  onSelect,
  onRemove,
}: {
  ch: LiveChannel;
  idx: number;
  isActive: boolean;
  currentTitle?: string;
  onSelect: (id: string) => void;
  onRemove: (id: string, name: string) => void;
}) {
  return (
    <li
      onClick={() => onSelect(ch.id)}
      className="p-2 rounded-lg flex items-center gap-3 cursor-pointer tap"
      style={{
        background: isActive ? "var(--ember-soft)" : "var(--ink-2)",
        border: `1px solid ${
          isActive ? "rgba(255,107,53,0.4)" : "var(--cream-line)"
        }`,
      }}
    >
      <div
        className="w-10 h-10 rounded-md flex items-center justify-center text-lg shrink-0 overflow-hidden"
        style={{
          background: "var(--ink-3)",
          border: "1px solid var(--cream-line)",
        }}
      >
        {ch.logo ? (
          <img
            src={ch.logo}
            alt=""
            loading="lazy"
            className="w-full h-full object-contain"
          />
        ) : (
          <span className="font-mono text-[10px] text-cream-faint">
            {String(idx + 1).padStart(2, "0")}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-display font-semibold line-clamp-1 text-cream">
          {ch.name}
        </p>
        {currentTitle ? (
          <p className="text-[11px] text-ember line-clamp-1">{currentTitle}</p>
        ) : ch.category ? (
          <p className="font-mono text-[10px] text-cream-faint line-clamp-1">
            {ch.category}
          </p>
        ) : (
          <p className="font-mono text-[10px] text-cream-faint line-clamp-1">
            {ch.url}
          </p>
        )}
      </div>
      {isActive && (
        <span className="signal-bars">
          <span />
          <span />
          <span />
        </span>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(ch.id, ch.name);
        }}
        className="text-cream-faint hover:text-ember px-2 tap"
        title="删除频道"
      >
        <IconClose size={14} />
      </button>
    </li>
  );
});

export default function Live() {
  // 顶级 tab —— IPTV (传统 m3u 频道) / Network (直播平台房间)
  const [tab, setTab] = useState<"iptv" | "network">(() => {
    try {
      const v = localStorage.getItem("douytv:live-tab");
      return v === "network" ? "network" : "iptv";
    } catch {
      return "iptv";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("douytv:live-tab", tab);
    } catch {
      /* private */
    }
  }, [tab]);
  const [view, setView] = useState<"home" | "mine">("home");

  return (
    <div className="flex-1 min-h-0 bg-ink text-cream flex flex-col overflow-hidden">
      <div
        className="relative shrink-0 flex items-center justify-between gap-3 px-4 pt-4 pb-3 backdrop-blur-xl"
        style={{
          background: "rgba(14,15,17,0.92)",
          borderBottom: "1px solid var(--cream-line)",
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="rec-dot" />
          <span className="hidden sm:inline font-display text-sm font-extrabold text-cream">
            直播
          </span>
            <span className="hidden sm:inline font-mono text-[10px] tracking-[0.2em] text-cream-faint">
              / MY LIVE
            </span>
          
        </div>

        {view === "home" && (
          <nav
            className="absolute left-1/2 top-0 -translate-x-1/2 flex items-center gap-6"
            style={{ paddingTop: 16 }}
            aria-label="直播类型"
          >
            <LiveModeButton active={tab === "iptv"} onClick={() => setTab("iptv")}>
              IPTV
            </LiveModeButton>
            <LiveModeButton active={tab === "network"} onClick={() => setTab("network")}>
              网络直播
            </LiveModeButton>
          </nav>
        )}

        <button
          type="button"
          onClick={() => setView(view === "mine" ? "home" : "mine")}
          className="w-10 h-10 rounded-full flex items-center justify-center tap text-cream-dim hover:text-ember"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          aria-label={view === "mine" ? "返回首页" : "我的"}
          title={view === "mine" ? "首页" : "我的"}
        >
          {view === "mine" ? <IconHome size={16} /> : <IconArtist size={16} />}
        </button>
      </div>
      <div className="flex-1 min-h-0">
        {view === "mine" ? (
          <LiveMine />
        ) : tab === "iptv" ? (
          <IPTVLive />
        ) : (
          <NetworkLivePanel />
        )}
      </div>
    </div>
  );
}

function LiveModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative pb-2 font-display text-sm whitespace-nowrap tap transition-colors ${
        active ? "text-cream font-extrabold" : "text-cream-dim hover:text-cream font-semibold"
      }`}
    >
      {children}
      {active && (
        <span
          className="absolute left-1/2 -translate-x-1/2 -bottom-px h-0.5 w-5 rounded-full"
          style={{ background: "var(--ember)" }}
        />
      )}
    </button>
  );
}

function LiveMine() {
  const favorites = useNetLiveStore((s) => s.favorites);
  const history = useNetLiveStore((s) => s.history);
  const hydrateNetLive = useNetLiveStore((s) => s.hydrate);
  const toggleFavorite = useNetLiveStore((s) => s.toggleFavorite);
  const clearHistory = useNetLiveStore((s) => s.clearHistory);

  useEffect(() => {
    hydrateNetLive();
  }, [hydrateNetLive]);

  return (
    <div
      className="h-full overflow-y-auto px-4 py-4"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 24px)" }}
    >
      <div className="mx-auto w-full max-w-6xl space-y-5">
        <section>
          <LiveMineSectionTitle
            eyebrow="NET LIVE"
            title="收藏主播"
            action={<span>{favorites.length}</span>}
          />
          {favorites.length === 0 ? (
            <LiveMineEmpty icon={<IconHeart size={26} />} title="还没有收藏的直播间" />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {favorites.slice(0, 12).map((room) => (
                <LiveRoomMiniCard
                  key={`${room.platform}:${room.roomId}`}
                  room={room}
                  actionLabel="取消收藏"
                  onAction={() => toggleFavorite(room)}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <LiveMineSectionTitle
            eyebrow="HISTORY"
            title="观看历史"
            action={
              history.length > 0 ? (
                <button type="button" onClick={clearHistory} className="hover:text-ember tap">
                  清空
                </button>
              ) : (
                <span>0</span>
              )
            }
          />
          {history.length === 0 ? (
            <LiveMineEmpty icon={<IconClock size={26} />} title="还没有直播观看记录" />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {history.slice(0, 12).map((room) => (
                <LiveRoomMiniCard
                  key={`${room.platform}:${room.roomId}`}
                  room={room}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function LiveMineSectionTitle({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <p className="font-mono text-[10px] tracking-[0.22em] text-cream-faint">{eyebrow}</p>
        <h2 className="font-display text-lg font-extrabold text-cream">{title}</h2>
      </div>
      {action && <div className="font-mono text-[10px] text-cream-faint">{action}</div>}
    </div>
  );
}

function LiveRoomMiniCard({
  room,
  actionLabel,
  onAction,
}: {
  room: NetLiveRoom;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const platform = NETLIVE_PLATFORMS.find((p) => p.id === room.platform)?.label ?? room.platform;
  return (
    <div
      className="rounded-lg overflow-hidden flex"
      style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
    >
      <Link
        to={`/live/room/${room.platform}/${encodeURIComponent(room.roomId)}`}
        state={{ room }}
        className="flex-1 min-w-0 flex items-center gap-3 p-2 tap text-cream"
      >
        <div
          className="w-20 h-12 rounded-md overflow-hidden shrink-0 relative"
          style={{ background: "var(--ink-3)" }}
        >
          {room.cover ? (
            <img
              src={room.cover.replace("http://", "https://")}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-cream-faint">
              <IconLive size={22} />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-display font-semibold line-clamp-1">{room.title || "直播间"}</p>
          <p className="font-mono text-[10px] text-cream-faint mt-0.5 line-clamp-1">
            @{room.uname || platform}
            {room.category ? ` · ${room.category}` : ""}
          </p>
          <p className="font-mono text-[10px] text-cream-faint mt-0.5 line-clamp-1">
            {platform} · {room.live ? "直播中" : "未开播"}
          </p>
        </div>
      </Link>
      {onAction && (
        <button
          type="button"
          onClick={onAction}
          className="w-10 shrink-0 grid place-items-center tap text-cream-faint hover:text-ember"
          style={{ borderLeft: "1px solid var(--cream-line)" }}
          aria-label={actionLabel}
          title={actionLabel}
        >
          <IconClose size={14} />
        </button>
      )}
    </div>
  );
}

function LiveMineEmpty({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div
      className="rounded-lg p-6 text-center text-cream-faint"
      style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
    >
      <div className="mx-auto mb-2 w-12 h-12 rounded-full grid place-items-center" style={{ background: "var(--ink-3)" }}>
        {icon}
      </div>
      <p className="font-display text-sm font-semibold text-cream">{title}</p>
    </div>
  );
}

function IPTVLive() {
  const channels = useLiveStore((s) => s.channels);
  const hydrate = useLiveStore((s) => s.hydrate);
  const remove = useLiveStore((s) => s.remove);

  const subscriptions = useLiveSubStore((s) => s.subscriptions);
  const hydrateSubs = useLiveSubStore((s) => s.hydrate);

  const epgUrl = useEpgStore((s) => s.url);
  const programmes = useEpgStore((s) => s.programmes);
  const hydrateEpg = useEpgStore((s) => s.hydrate);

  const [activeId, setActiveId] = useState<string | undefined>();
  const [activeSource, setActiveSource] = useState<string>(ALL_SOURCE);
  const [filter, setFilter] = useState("");
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [groupPage, setGroupPage] = useState<Record<string, number>>({});
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    hydrate();
    hydrateSubs();
    hydrateEpg();
  }, [hydrate, hydrateSubs, hydrateEpg]);

  const enabledSourceIds = useMemo(
    () => new Set(subscriptions.filter((s) => s.enabled !== false).map((s) => s.id)),
    [subscriptions]
  );

  const visibleChannels = useMemo(
    () =>
      channels.filter((c) => !c.sourceId || enabledSourceIds.has(c.sourceId)),
    [channels, enabledSourceIds]
  );

  useEffect(() => {
    if (
      activeSource !== ALL_SOURCE &&
      activeSource !== NO_SOURCE &&
      !enabledSourceIds.has(activeSource)
    ) {
      setActiveSource(ALL_SOURCE);
    }
  }, [activeSource, enabledSourceIds]);

  useEffect(() => {
    if (activeId && !visibleChannels.some((c) => c.id === activeId)) {
      setActiveId(visibleChannels[0]?.id);
      return;
    }
    if (!activeId && visibleChannels.length > 0) setActiveId(visibleChannels[0].id);
  }, [visibleChannels, activeId]);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);

  // ESC 关闭面板
  useEffect(() => {
    if (!panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanelOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen]);

  const active = visibleChannels.find((c) => c.id === activeId);
  const epgKey = active?.epgId || active?.name;
  const channelProgs = epgKey ? programmes[epgKey] : undefined;
  const currentProg = findCurrent(channelProgs, now);
  const upcoming = findUpcoming(channelProgs, 3, now);

  const mediaItem = useMemo<MediaItem | undefined>(() => {
    if (!active) return undefined;
    const headers: Record<string, string> = {};
    if (active.ua) headers["User-Agent"] = active.ua;
    if (active.referer) headers["Referer"] = active.referer;
    return {
      id: `live:${active.id}`,
      kind: "live",
      title: active.name,
      url: active.url,
      streamType: "hls",
      poster: active.logo,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    };
  }, [active]);

  // 各订阅的频道数 — 用于 pills 上的数字
  const sourceCounts = useMemo(() => {
    const m = new Map<string, number>();
    let noneCount = 0;
    for (const c of visibleChannels) {
      if (c.sourceId) m.set(c.sourceId, (m.get(c.sourceId) || 0) + 1);
      else noneCount += 1;
    }
    return { bySource: m, none: noneCount };
  }, [visibleChannels]);

  // 按 activeSource + 搜索 过滤
  const filtered = useMemo(() => {
    const kw = filter.trim().toLowerCase();
    return visibleChannels.filter((c) => {
      if (activeSource === NO_SOURCE) {
        if (c.sourceId) return false;
      } else if (activeSource !== ALL_SOURCE) {
        if (c.sourceId !== activeSource) return false;
      }
      if (kw) {
        if (
          !c.name.toLowerCase().includes(kw) &&
          !(c.category ?? "").toLowerCase().includes(kw)
        )
          return false;
      }
      return true;
    });
  }, [visibleChannels, activeSource, filter]);

  useEffect(() => {
    setExpandedGroups(new Set());
    setGroupPage({});
  }, [activeSource, filter]);

  // 按 category 分组
  const grouped = useMemo(() => {
    const map = new Map<string, LiveChannel[]>();
    for (const c of filtered) {
      const key = c.category || "未分类";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return Array.from(map.entries());
  }, [filtered]);

  // 搜索 / 单组时强制展开,默认仅展开第一组(避免初次渲染卡死)
  useEffect(() => {
    if (grouped.length === 0) return;
    if (filter.trim() || grouped.length === 1) {
      setExpandedGroups(new Set(grouped.map(([g]) => g)));
    } else {
      setExpandedGroups((prev) =>
        prev.size > 0 ? prev : new Set([grouped[0][0]])
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, grouped.length]);

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const loadMoreInGroup = (group: string) => {
    setGroupPage((prev) => ({ ...prev, [group]: (prev[group] || 1) + 1 }));
  };

  // 仅对已展开+可见的频道算当前节目
  const visibleNowMap = useMemo(() => {
    const out = new Map<string, EpgProgramme | undefined>();
    for (const [group, list] of grouped) {
      if (!expandedGroups.has(group)) continue;
      const limit = (groupPage[group] || 1) * PER_GROUP_LIMIT;
      for (const ch of list.slice(0, limit)) {
        const key = ch.epgId || ch.name;
        const prog = key ? programmes[key] : undefined;
        out.set(ch.id, findCurrent(prog, now));
      }
    }
    return out;
  }, [grouped, expandedGroups, groupPage, programmes, now]);

  const handleRemoveChannel = async (id: string, name: string) => {
    if (await appConfirm(`删除频道「${name}」？`, { tone: "danger" })) remove(id);
  };

  const activeSourceLabel =
    activeSource === ALL_SOURCE
      ? "全部"
      : activeSource === NO_SOURCE
      ? "未分类"
      : subscriptions.find((s) => s.id === activeSource)?.name ?? "未知源";

  return (
    <div className="h-full bg-ink text-cream flex flex-col overflow-hidden">
      {/* 顶部 sticky bar */}
      <div
        className="flex items-center gap-2 p-3 shrink-0 backdrop-blur-xl z-20"
        style={{
          background: "rgba(14,15,17,0.94)",
          borderBottom: "1px solid var(--cream-line)",
        }}
      >
        <div className="flex-1 min-w-0">
         
        </div>

        {/* 频道选择按钮 - 显示当前源 + 频道数 */}
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          className="flex items-center gap-2 h-9 px-3 rounded-full tap text-cream"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
          title="选择频道"
        >
          <IconList size={15} />
          <span className="text-xs font-display max-w-[120px] line-clamp-1">
            {activeSourceLabel}
          </span>
          <span className="font-mono text-[10px] text-cream-faint">
            {String(filtered.length).padStart(2, "0")}
          </span>
        </button>

        
      </div>

      {/* 主区: 全屏播放器 + EPG */}
      <div className="flex-1 flex flex-col min-h-0 overflow-auto">
        <div
          className="aspect-video bg-black relative scanlines shrink-0 mx-auto w-full"
          style={{ maxHeight: "calc(100vh - 56px)" }}
        >
          {mediaItem ? (
            <VideoPlayer
              item={mediaItem}
              active
              loop={false}
              muted={false}
              controls
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-cream-faint gap-3 px-6 text-center">
              <IconLive size={48} className="opacity-40" />
              <p className="font-mono text-[10px] tracking-[0.25em]">
                NO CHANNEL SELECTED
              </p>
              <button
                type="button"
                onClick={() => setPanelOpen(true)}
                className="mt-2 px-4 py-2 rounded-full text-xs font-display font-semibold tap glow-ember inline-flex items-center gap-1.5"
                style={{ background: "var(--ember)", color: "var(--ink)" }}
              >
                <IconList size={13} />
                选择频道
              </button>
            </div>
          )}
          {active && (
            <div className="absolute bottom-2 left-3 right-3 text-cream pointer-events-none z-10">
              <div className="flex items-center gap-2 mb-1">
                <span className="rec-dot" />
                <span className="font-mono text-[10px] tracking-[0.2em] text-cream text-shadow">
                  LIVE
                </span>
              </div>
              <p className="text-sm font-display font-bold text-shadow line-clamp-1">
                {active.name}
              </p>
              {active.category && (
                <p className="text-[11px] opacity-70 text-shadow">{active.category}</p>
              )}
            </div>
          )}
        </div>

        {/* EPG */}
        {active && currentProg && (
          <div
            className="px-4 py-3 mx-auto w-full max-w-3xl"
            style={{
              background: "var(--ember-soft)",
              borderBottom: "1px solid var(--cream-line)",
            }}
          >
            <p className="font-mono text-[10px] tracking-[0.2em] text-ember">
              NOW · PLAYING
            </p>
            <p className="text-sm font-display font-semibold mt-0.5 line-clamp-1">
              {currentProg.title}
            </p>
            <p className="font-mono text-[10px] text-cream-dim mt-0.5">
              {formatProgrammeTime(currentProg.start)} →{" "}
              {formatProgrammeTime(currentProg.stop)}
            </p>
            <div
              className="h-1 rounded-full mt-1.5 overflow-hidden"
              style={{ background: "rgba(242,232,213,0.08)" }}
            >
              <div
                className="h-full"
                style={{
                  background: "var(--ember)",
                  boxShadow: "0 0 8px var(--ember-glow)",
                  width: `${Math.min(
                    100,
                    Math.max(
                      0,
                      ((now - currentProg.start) /
                        (currentProg.stop - currentProg.start)) *
                        100
                    )
                  )}%`,
                }}
              />
            </div>
            {upcoming.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {upcoming.map((u) => (
                  <p
                    key={`${u.start}`}
                    className="text-[10px] text-cream-faint line-clamp-1"
                  >
                    <span className="font-mono text-cream-dim">
                      {formatProgrammeTime(u.start)}
                    </span>{" "}
                    {u.title}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {active && !currentProg && epgUrl && channelProgs === undefined && (
          <p className="px-4 py-2 text-[10px] text-cream-faint mx-auto w-full max-w-3xl">
            ⓘ 此频道没有匹配的 EPG（缺少 tvg-id 或与 EPG 中 channel id 不一致）
          </p>
        )}
      </div>

      {/* 频道面板 - 从右侧 slide-in 的覆盖层（透明背景，不挡住播放） */}
      {panelOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-40 flex animate-fade-in"
            onClick={() => setPanelOpen(false)}
          >
            {/* 左侧透明区 - 点击关闭。轻微暗化便于聚焦 panel */}
            <div
              className="flex-1"
              style={{ background: "rgba(0,0,0,0.25)" }}
            />

            {/* 右侧 panel */}
            <aside
              onClick={(e) => e.stopPropagation()}
              className="w-full sm:w-[400px] h-full flex flex-col animate-slide-right backdrop-blur-xl"
              style={{
                background: "rgba(14,15,17,0.88)",
                borderLeft: "1px solid var(--cream-line)",
                boxShadow: "-12px 0 32px -8px rgba(0,0,0,0.6)",
                // 横屏刘海 + Home Indicator 让位
                paddingRight: "env(safe-area-inset-right)",
                paddingBottom: "env(safe-area-inset-bottom)",
              }}
            >
              {/* Panel 头 */}
              <div
                className="flex items-center gap-2 p-3 shrink-0"
                style={{
                  borderBottom: "1px solid var(--cream-line)",
                  paddingTop: "calc(env(safe-area-inset-top) + 12px)",
                }}
              >
                <div className="flex-1">
                  <p className="font-mono text-[9px] tracking-[0.25em] text-cream-faint">
                    CHANNELS
                  </p>
                  <p className="font-display text-sm font-semibold mt-0.5">
                    选择频道
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPanelOpen(false)}
                  className="w-8 h-8 rounded-full flex items-center justify-center tap text-cream-faint hover:text-cream"
                  style={{
                    background: "var(--ink-2)",
                    border: "1px solid var(--cream-line)",
                  }}
                >
                  <IconClose size={14} />
                </button>
              </div>

              {/* 订阅源切换 pills */}
              <div
                className="px-3 py-2.5 shrink-0"
                style={{ borderBottom: "1px solid var(--cream-line)" }}
              >
                <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
                  SOURCE · 订阅源
                </p>
                <div className="flex gap-2 overflow-x-auto no-scrollbar">
                  <SourcePill
                    label="全部"
                    count={visibleChannels.length}
                    active={activeSource === ALL_SOURCE}
                    onClick={() => setActiveSource(ALL_SOURCE)}
                  />
                  {subscriptions.filter((sub) => sub.enabled !== false).map((sub) => {
                    const count = sourceCounts.bySource.get(sub.id) || 0;
                    return (
                      <SourcePill
                        key={sub.id}
                        label={sub.name}
                        count={count}
                        active={activeSource === sub.id}
                        onClick={() => setActiveSource(sub.id)}
                      />
                    );
                  })}
                  {sourceCounts.none > 0 && (
                    <SourcePill
                      label="未分类"
                      count={sourceCounts.none}
                      active={activeSource === NO_SOURCE}
                      onClick={() => setActiveSource(NO_SOURCE)}
                    />
                  )}
                </div>
                {subscriptions.filter((sub) => sub.enabled !== false).length === 0 && sourceCounts.none === 0 && (
                  <p className="text-[10px] text-cream-faint mt-1">
                    还没有订阅源
                    <Link to="/settings/live-hub" className="text-ember ml-1">
                      去添加 →
                    </Link>
                  </p>
                )}
              </div>

              {/* 搜索 */}
              {visibleChannels.length > 0 && (
                <div className="px-3 pt-3 shrink-0">
                  <input
                    type="text"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="搜索频道名…"
                    className="w-full px-3 py-2 rounded-full text-xs outline-none text-cream placeholder:text-cream-faint"
                    style={{
                      background: "var(--ink-2)",
                      border: "1px solid var(--cream-line)",
                    }}
                  />
                </div>
              )}

              {/* 频道列表（垂直滚动） */}
              <div className="flex-1 overflow-y-auto p-3 min-h-0">
                {visibleChannels.length === 0 ? (
                  <EmptyState
                    icon={<IconAntenna size={48} />}
                    title="还没有频道"
                    subtitle="前往设置添加频道或订阅 M3U"
                    action={
                      <Link
                        to="/settings"
                        onClick={() => setPanelOpen(false)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-display font-semibold tap glow-ember"
                        style={{ background: "var(--ember)", color: "var(--ink)" }}
                      >
                        <IconSettings size={13} />
                        前往设置
                      </Link>
                    }
                  />
                ) : filtered.length === 0 ? (
                  <EmptyState
                    icon={<IconAntenna size={40} />}
                    title="无匹配频道"
                    subtitle={filter ? `没有匹配「${filter}」的频道` : "切换订阅源 / 改搜索词试试"}
                  />
                ) : (
                  grouped.map(([group, list]) => {
                    const isExpanded = expandedGroups.has(group);
                    const pageNum = groupPage[group] || 1;
                    const limit = pageNum * PER_GROUP_LIMIT;
                    const visibleList = list.slice(0, limit);
                    const hasMore = list.length > visibleList.length;
                    return (
                      <div key={group} className="mb-4">
                        <button
                          type="button"
                          onClick={() => toggleGroup(group)}
                          className="w-full flex items-center justify-between font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2 py-1.5 px-2 rounded tap"
                          style={{ background: "rgba(14,15,17,0.6)" }}
                        >
                          <span className="flex items-center gap-2">
                            <IconChevronRight
                              size={12}
                              className="transition-transform"
                              style={{
                                transform: isExpanded ? "rotate(90deg)" : "rotate(0)",
                              }}
                            />
                            {group.toUpperCase()}
                          </span>
                          <span className="text-cream-dim">
                            {String(list.length).padStart(2, "0")}
                          </span>
                        </button>
                        {isExpanded && (
                          <ul className="space-y-1.5">
                            {visibleList.map((ch, idx) => (
                              <ChannelRow
                                key={ch.id}
                                ch={ch}
                                idx={idx}
                                isActive={activeId === ch.id}
                                currentTitle={visibleNowMap.get(ch.id)?.title}
                                onSelect={(id) => {
                                  setActiveId(id);
                                  setPanelOpen(false);
                                }}
                                onRemove={handleRemoveChannel}
                              />
                            ))}
                            {hasMore && (
                              <li>
                                <button
                                  type="button"
                                  onClick={() => loadMoreInGroup(group)}
                                  className="w-full py-2 rounded-lg text-[11px] font-mono tracking-wider text-cream-dim tap"
                                  style={{
                                    background: "var(--ink-2)",
                                    border: "1px dashed var(--cream-line)",
                                  }}
                                >
                                  + 加载更多（{list.length - visibleList.length} 剩余）
                                </button>
                              </li>
                            )}
                          </ul>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </aside>
          </div>,
          document.body
        )}
    </div>
  );
}

function SourcePill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 px-3 py-1.5 rounded-full text-xs font-display tap flex items-center gap-1.5 whitespace-nowrap"
      style={{
        background: active ? "var(--ember)" : "var(--ink-2)",
        color: active ? "var(--ink)" : "var(--cream)",
        border: active
          ? "1px solid var(--ember)"
          : "1px solid var(--cream-line)",
        fontWeight: active ? 600 : 400,
        boxShadow: active
          ? "0 0 0 1px rgba(255,107,53,0.35), 0 6px 18px -6px rgba(255,107,53,0.4)"
          : undefined,
      }}
    >
      <span className="max-w-[120px] line-clamp-1">{label}</span>
      <span
        className="font-mono text-[10px] opacity-80"
        style={{ color: active ? "var(--ink)" : "var(--cream-faint)" }}
      >
        {count}
      </span>
    </button>
  );
}
