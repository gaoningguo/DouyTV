import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import VideoFeed from "@/components/VideoFeed";
import InteractionBar from "@/components/InteractionBar";
import SourceSwitcher from "@/components/SourceSwitcher";
import DanmakuPanel, {
  loadDanmakuMemory,
  saveDanmakuMemory,
} from "@/components/DanmakuPanel";
import { useFeed } from "@/hooks/useFeed";
import { useLiveFeed } from "@/hooks/useLiveFeed";
import { useViewport } from "@/hooks/useViewport";
import { useLibraryStore } from "@/stores/library";
import { useNetLiveStore } from "@/stores/netlive";
import { useScriptStore } from "@/stores/scripts";
import { useDanmakuStore } from "@/stores/danmaku";
import {
  IconRefresh,
  IconStatic,
  IconDanmaku,
  IconLive,
  IconAlbum,
  IconQueue,
  IconPlay,
  IconHeart,
  IconHeartFill,
  IconBookmark,
  IconBookmarkFill,
  IconShare,
  IconMore,
} from "@/components/Icon";
import type { MediaItem } from "@/types/media";
import { NETLIVE_PLATFORMS, type NetLiveRoom } from "@/lib/netlive/types";
import type { ScriptPlayback } from "@/source-script/types";
import type { DanmakuSelection } from "@/lib/danmaku/types";

type FeedMode = "video" | "live" | "music";

interface HomeProps {
  feedPaused?: boolean;
}

const MUSIC_VISUALIZER_HEIGHTS = [
  42, 68, 24, 76, 52, 34, 86, 48, 28, 72, 18, 64, 82, 36, 54, 26, 74, 44,
  88, 32, 58, 20, 70, 46, 30, 80, 38, 62, 22, 66, 50, 84,
];

export default function Home({ feedPaused = false }: HomeProps) {
  const { isDesktop } = useViewport();
  const [mode, setMode] = useState<FeedMode>(() => {
    try {
      const saved = localStorage.getItem("douytv:home-feed-mode");
      return saved === "live" || saved === "music" ? saved : "video";
    } catch {
      return "video";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("douytv:home-feed-mode", mode);
    } catch {
      /* private mode */
    }
  }, [mode]);

  return mode === "live" ? (
    <LiveHomeFeed
      mode={mode}
      setMode={setMode}
      isDesktop={isDesktop}
      feedPaused={feedPaused}
    />
  ) : mode === "music" ? (
    <MusicHomePlaceholder mode={mode} setMode={setMode} isDesktop={isDesktop} />
  ) : (
    <VideoHomeFeed mode={mode} setMode={setMode} isDesktop={isDesktop} />
  );
}

function VideoHomeFeed({
  mode,
  setMode,
  isDesktop,
}: {
  mode: FeedMode;
  setMode: (mode: FeedMode) => void;
  isDesktop: boolean;
}) {
  const {
    items,
    loading,
    error,
    loadMore,
    reload,
    changeEpisode,
    reresolveItem,
    swapSource,
  } = useFeed();
  const hydrateScripts = useScriptStore((s) => s.hydrate);
  const hydrateLib = useLibraryStore((s) => s.hydrate);
  const upsertHistory = useLibraryStore((s) => s.upsertHistory);
  const scripts = useScriptStore((s) => s.scripts);
  const enabledInFeed = useDanmakuStore((s) => s.enabledInFeed);
  const patchPrefs = useDanmakuStore((s) => s.patchPrefs);
  const bumpFeedRefresh = useDanmakuStore((s) => s.bumpFeedRefresh);

  const [activeIndex, setActiveIndex] = useState(0);
  const [switchSourceItem, setSwitchSourceItem] = useState<MediaItem | null>(null);
  const [danmakuPanelOpen, setDanmakuPanelOpen] = useState(false);
  const [danmakuSelTick, setDanmakuSelTick] = useState(0);

  useEffect(() => {
    hydrateScripts();
    hydrateLib();
  }, [hydrateScripts, hydrateLib]);

  const activeItem: MediaItem | undefined = items[activeIndex];

  const currentDanmakuSel: DanmakuSelection | null = useMemo(() => {
    if (!activeItem?.title) return null;
    return loadDanmakuMemory(activeItem.title) ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeItem?.title, danmakuSelTick]);

  const handleDanmakuPick = (selection: DanmakuSelection) => {
    setDanmakuPanelOpen(false);
    if (!activeItem?.title) return;
    saveDanmakuMemory(activeItem.title, selection);
    if (!enabledInFeed) patchPrefs({ enabledInFeed: true });
    bumpFeedRefresh();
    setDanmakuSelTick((n) => n + 1);
  };

  const switchPlaybacks: ScriptPlayback[] =
    switchSourceItem && switchSourceItem.episodes && switchSourceItem.episodes.length > 0
      ? [
          {
            sourceId: switchSourceItem.sourceId ?? "",
            sourceName: switchSourceItem.sourceName ?? "当前线路",
            episodes: switchSourceItem.episodes,
            episodes_titles: switchSourceItem.episodesTitles,
          },
        ]
      : [];
  const switchScript = switchSourceItem
    ? scripts.find((s) => s.key === switchSourceItem.scriptKey)
    : undefined;

  const topBar = (
    <HomeTopBar
      mode={mode}
      setMode={setMode}
      onRefresh={reload}
      activeItem={activeItem}
      variant={isDesktop ? "desktop" : "immersive"}
      videoActions={
        activeItem ? (
          <>
            <button
              type="button"
              onClick={() => patchPrefs({ enabledInFeed: !enabledInFeed })}
              className="w-9 h-9 rounded-full flex items-center justify-center tap backdrop-blur-md transition-colors"
              style={{
                background: "rgba(14,15,17,0.55)",
                border: `1px solid ${
                  enabledInFeed && currentDanmakuSel
                    ? "var(--ember)"
                    : "var(--cream-line)"
                }`,
                color:
                  enabledInFeed && currentDanmakuSel
                    ? "var(--ember)"
                    : "var(--cream-dim)",
              }}
              aria-label="弹幕开关"
              title={
                currentDanmakuSel
                  ? enabledInFeed
                    ? "关闭弹幕"
                    : "开启弹幕"
                  : "未选择弹幕源"
              }
            >
              <IconDanmaku size={16} />
            </button>
            <button
              type="button"
              onClick={() => setDanmakuPanelOpen(true)}
              className="hidden sm:flex px-3 h-9 items-center gap-1.5 rounded-full backdrop-blur-md tap font-display text-xs"
              style={{
                background: "rgba(14,15,17,0.55)",
                border: "1px solid var(--cream-line)",
                color: "var(--cream)",
              }}
            >
              {currentDanmakuSel ? (
                <>
                  <span
                    className="rec-dot"
                    style={{ width: 5, height: 5, background: "var(--phosphor)" }}
                  />
                  <span className="line-clamp-1 max-w-[100px]">
                    {currentDanmakuSel.episodeTitle ||
                      currentDanmakuSel.animeTitle ||
                      "已选弹幕"}
                  </span>
                </>
              ) : (
                "选择弹幕"
              )}
            </button>
          </>
        ) : null
      }
    />
  );

  if (loading && items.length === 0) {
    return (
      <HomeShell isDesktop={isDesktop}>
        {topBar}
        <FeedLoading label="TUNING VIDEO..." />
      </HomeShell>
    );
  }

  if (error) {
    return (
      <HomeShell isDesktop={isDesktop}>
        {topBar}
        <FeedError
          title="NO SIGNAL"
          message={error}
          actionLabel="重试连接"
          onRetry={reload}
        />
      </HomeShell>
    );
  }

  if (items.length === 0) {
    return (
      <HomeShell isDesktop={isDesktop}>
        {topBar}
        <FeedEmptyState
          icon={<IconStatic size={64} className="text-cream-faint mb-4" />}
          label="NO BROADCAST"
          title="还没有可用的视频内容"
          detail={
            <>
              已安装 <span className="font-mono text-cream-dim">{scripts.length}</span>{" "}
              个脚本，启用{" "}
              <span className="font-mono text-ember">
                {scripts.filter((s) => s.enabled).length}
              </span>{" "}
              个
            </>
          }
          primaryLabel="刷新"
          onPrimary={reload}
          secondaryTo="/settings"
          secondaryLabel="前往设置"
        />
      </HomeShell>
    );
  }

  return (
    <HomeShell isDesktop={isDesktop}>
      {topBar}
      <VideoFeed
        items={items}
        onLoadMore={loadMore}
        feedChrome="video"
        onIndexChange={setActiveIndex}
        onProgress={(item, position, duration) =>
          upsertHistory(item, { position, duration })
        }
        onItemEnded={(item) => {
          const cur = item.currentEpisodeIndex ?? 0;
          const total = item.episodes?.length ?? 0;
          if (total > 1 && cur + 1 < total) {
            void changeEpisode(item.id, cur + 1);
          }
        }}
        onRequestReresolve={(item) => reresolveItem(item.id)}
        onRequestSwitchSource={(item) => setSwitchSourceItem(item)}
        onChangeEpisode={(item, idx) => changeEpisode(item.id, idx)}
        heightMode={isDesktop ? "container" : "viewport"}
        renderOverlay={(item, i) => (
          <>
            <FeedShade />
            <FeedCaption item={item} index={i} desktop={isDesktop} />
            <InteractionBar
              item={item}
              onSelectEpisode={(idx) => changeEpisode(item.id, idx)}
            />
          </>
        )}
      />

      {switchSourceItem && (
        <SourceSwitcher
          open={!!switchSourceItem}
          playbacks={switchPlaybacks}
          currentIndex={0}
          episodeIndex={switchSourceItem.currentEpisodeIndex ?? 0}
          script={switchScript}
          videoTitle={switchSourceItem.title}
          onPick={() => setSwitchSourceItem(null)}
          onPickCrossScript={async (newScriptKey, newVodId) => {
            const targetId = switchSourceItem.id;
            setSwitchSourceItem(null);
            await swapSource(targetId, newScriptKey, newVodId);
          }}
          onClose={() => setSwitchSourceItem(null)}
        />
      )}

      {activeItem && (
        <DanmakuPanel
          open={danmakuPanelOpen}
          videoTitle={activeItem.title}
          currentEpisodeIndex={activeItem.currentEpisodeIndex ?? 0}
          currentSelection={currentDanmakuSel}
          onSelect={handleDanmakuPick}
          onClose={() => setDanmakuPanelOpen(false)}
        />
      )}
    </HomeShell>
  );
}

function LiveHomeFeed({
  mode,
  setMode,
  isDesktop,
  feedPaused,
}: {
  mode: FeedMode;
  setMode: (mode: FeedMode) => void;
  isDesktop: boolean;
  feedPaused: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    items,
    loading,
    error,
    loadMore,
    reload,
    activeIndex,
    setActiveIndex,
    reresolveItem,
  } = useLiveFeed({ enabled: true });
  const hydrateLibrary = useLibraryStore((s) => s.hydrate);
  const noteVisit = useNetLiveStore((s) => s.noteVisit);
  const activeItem = items[activeIndex];

  useEffect(() => {
    hydrateLibrary();
  }, [hydrateLibrary]);

  const openLiveDetail = (item: MediaItem) => {
    const room = mediaItemToNetLiveRoom(item);
    if (!room) return;
    noteVisit(room);
    navigate(
      `/live/room/${encodeURIComponent(room.platform)}/${encodeURIComponent(room.roomId)}`,
      { state: { room, backgroundLocation: location } }
    );
  };

  const topBar = (
    <HomeTopBar
      mode={mode}
      setMode={setMode}
      onRefresh={reload}
      activeItem={activeItem}
      variant={isDesktop ? "desktop" : "immersive"}
    />
  );

  if (loading && items.length === 0) {
    return (
      <HomeShell isDesktop={isDesktop}>
        {topBar}
        <FeedLoading label="TUNING LIVE..." />
      </HomeShell>
    );
  }

  if (error) {
    return (
      <HomeShell isDesktop={isDesktop}>
        {topBar}
        <FeedError
          title="LIVE SIGNAL LOST"
          message={error}
          actionLabel="刷新直播"
          onRetry={reload}
        />
      </HomeShell>
    );
  }

  if (items.length === 0) {
    return (
      <HomeShell isDesktop={isDesktop}>
        {topBar}
        <FeedEmptyState
          icon={<IconLive size={64} className="text-cream-faint mb-4" />}
          label="NO LIVE FEED"
          title="还没有可推荐的直播内容"
          primaryLabel="刷新"
          onPrimary={reload}
          secondaryTo="/settings/live-hub"
          secondaryLabel="添加直播源"
        />
      </HomeShell>
    );
  }

  return (
    <HomeShell isDesktop={isDesktop}>
      {topBar}
      <VideoFeed
        items={items}
        active={!feedPaused}
        initialIndex={activeIndex}
        onLoadMore={loadMore}
        feedChrome="live"
        onIndexChange={setActiveIndex}
        onRequestReresolve={(item) => reresolveItem(item.id)}
        heightMode={isDesktop ? "container" : "viewport"}
        renderOverlay={(item, i) => (
          <>
            <FeedShade />
            <LiveCaption
              item={item}
              index={i}
              desktop={isDesktop}
              onOpenDetail={openLiveDetail}
            />
            <LiveActionRail item={item} desktop={isDesktop} />
          </>
        )}
      />
    </HomeShell>
  );
}

function MusicHomePlaceholder({
  mode,
  setMode,
  isDesktop,
}: {
  mode: FeedMode;
  setMode: (mode: FeedMode) => void;
  isDesktop: boolean;
}) {
  return (
    <HomeShell
      isDesktop={isDesktop}
      contentClassName="text-cream"
    >
      <HomeTopBar mode={mode} setMode={setMode} variant={isDesktop ? "desktop" : "immersive"} />
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 28% 22%, rgba(79,195,247,0.24), transparent 32%), radial-gradient(circle at 76% 18%, rgba(255,107,53,0.22), transparent 34%), radial-gradient(circle at 50% 74%, rgba(124,255,178,0.1), transparent 42%), linear-gradient(180deg, #070809 0%, #0E0F11 72%, #050505 100%)",
          }}
        />
        <div
          className="absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              "repeating-radial-gradient(circle at 52% 46%, rgba(242,232,213,0.06) 0 1px, transparent 1px 9px)",
          }}
        />
        <div className="absolute inset-0 bg-black/35" />
      </div>

      <main className="absolute inset-0 flex items-center justify-center">
        <div className="relative z-10 flex flex-col items-center">
          <div className="relative w-64 h-64 sm:w-80 sm:h-80">
            <div
              className="absolute -inset-6 rounded-full blur-2xl opacity-60 music-pulse"
              style={{ background: "rgba(79,195,247,0.28)" }}
            />
            <div
              className="absolute inset-0 rounded-full music-vinyl-spin"
              style={{
                background:
                  "radial-gradient(circle, #08090b 0 18%, rgba(242,232,213,0.11) 19% 20%, #101114 21% 44%, rgba(79,195,247,0.18) 45% 46%, #090a0c 47% 68%, rgba(255,107,53,0.18) 69% 70%, #050506 71%)",
                border: "16px solid #090909",
                boxShadow: "0 0 70px rgba(79,195,247,0.28)",
              }}
            >
              <div
                className="absolute inset-0 rounded-full opacity-45"
                style={{
                  backgroundImage:
                    "repeating-radial-gradient(circle, transparent 0 4px, rgba(242,232,213,0.05) 5px 6px)",
                }}
              />
              <div
                className="absolute inset-[27%] rounded-full grid place-items-center overflow-hidden"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(79,195,247,0.92), rgba(255,107,53,0.76))",
                  border: "4px solid #050506",
                }}
              >
                <IconAlbum size={54} className="text-ink" />
              </div>
            </div>
            <button
              type="button"
              className="absolute inset-0 m-auto w-16 h-16 rounded-full grid place-items-center tap"
              style={{
                background: "rgba(14,15,17,0.58)",
                color: "var(--cream)",
                border: "1px solid var(--cream-line)",
                backdropFilter: "blur(14px)",
              }}
              aria-label="播放音乐"
            >
              <IconPlay size={24} />
            </button>
          </div>
        </div>

        <div
          className="absolute right-4 sm:right-6 flex flex-col items-center gap-5 z-20"
          style={{
            bottom: isDesktop
              ? 118
              : "calc(var(--bottom-tab-h, 56px) + env(safe-area-inset-bottom) + 88px)",
          }}
        >
          <MusicSideAction icon={<IconHeart size={21} />} label="1.2W" tone="ember" />
          <MusicSideAction icon={<IconQueue size={21} />} label="歌单" tone="vhs" />
          <MusicSideAction icon={<IconShare size={20} />} label="分享" />
          <MusicSideAction icon={<IconMore size={20} />} label="更多" />
        </div>

        <div
          className="absolute left-5 sm:left-8 z-20 max-w-[70%]"
          style={{
            bottom: isDesktop
              ? 118
              : "calc(var(--bottom-tab-h, 56px) + env(safe-area-inset-bottom) + 88px)",
          }}
        >
          <h1
            className="font-display text-2xl sm:text-3xl font-extrabold leading-tight text-shadow"
            style={{ color: "var(--vhs)", textShadow: "0 0 14px rgba(79,195,247,0.72)" }}
          >
            霓虹夜行者
          </h1>
          <div className="mt-2 flex items-center gap-2">
            <span
              className="px-2 py-0.5 rounded text-[10px] font-mono font-bold"
              style={{ background: "var(--ember)", color: "var(--ink)" }}
            >
              STATIC
            </span>
            <p className="text-sm text-cream text-shadow">@数字幻象 Digital Mirage</p>
          </div>
          <div className="mt-2 overflow-hidden whitespace-nowrap opacity-75">
            <p className="music-marquee font-mono text-[10px] tracking-[0.12em] text-cream-dim">
              正在播放：霓虹夜行者 - 数字幻象 - 专辑：赛博夜航 - 音乐推荐详情播放占位
            </p>
          </div>
        </div>

        <div
          className="absolute left-0 right-0 z-20 px-5 sm:px-8"
          style={{
            bottom: isDesktop
              ? 44
              : "calc(var(--bottom-tab-h, 56px) + env(safe-area-inset-bottom) + 18px)",
          }}
        >
          <div className="h-8 mb-2 flex items-end justify-center gap-1 overflow-hidden">
            {MUSIC_VISUALIZER_HEIGHTS.map((height, index) => (
              <span
                key={`${height}-${index}`}
                className="music-visualizer-bar"
                style={{
                  height: `${height}%`,
                  animationDelay: `${index * 48}ms`,
                }}
              />
            ))}
          </div>
          <div className="relative w-full h-1 rounded-full bg-white/20 overflow-hidden">
            <div
              className="absolute left-0 top-0 h-full rounded-full"
              style={{
                width: "33%",
                background: "var(--vhs)",
                boxShadow: "0 0 12px rgba(79,195,247,0.9)",
              }}
            />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[10px] text-cream-faint">
            <span>01:12</span>
            <span>03:45</span>
          </div>
        </div>
      </main>
    </HomeShell>
  );
}

function MusicSideAction({
  icon,
  label,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  tone?: "ember" | "vhs";
}) {
  const color =
    tone === "ember" ? "var(--ember)" : tone === "vhs" ? "var(--vhs)" : "var(--cream)";
  return (
    <div className="flex flex-col items-center gap-1 text-cream">
      <button
        type="button"
        className="w-11 h-11 sm:w-12 sm:h-12 rounded-full grid place-items-center tap"
        style={{
          background: "rgba(242,232,213,0.08)",
          border: "1px solid var(--cream-line)",
          color,
          backdropFilter: "blur(16px)",
        }}
        aria-label={label}
      >
        {icon}
      </button>
      <span className="font-mono text-[10px] text-cream-dim text-shadow">{label}</span>
    </div>
  );
}

function HomeShell({
  isDesktop,
  contentClassName = "",
  children,
}: {
  isDesktop: boolean;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  if (!isDesktop) {
    return (
      <div
        className={`relative h-screen w-full overflow-hidden bg-ink ${contentClassName}`}
      >
        {children}
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden bg-ink">
      <main
        className={`relative h-full min-h-0 overflow-hidden rounded-lg bg-black ${contentClassName}`}
        style={{
          border: "1px solid var(--cream-line)",
          boxShadow: "0 24px 70px -48px rgba(0,0,0,0.95)",
        }}
      >
        {children}
      </main>
    </div>
  );
}

function FeedEmptyState({
  icon,
  label,
  title,
  detail,
  primaryLabel,
  onPrimary,
  secondaryTo,
  secondaryLabel,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  detail?: React.ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryTo?: string;
  secondaryLabel?: string;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-ink text-cream-dim p-6 text-center">
      {icon}
      <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint mb-2">
        {label}
      </p>
      <p className="mb-2 text-sm text-cream-dim">{title}</p>
      {detail && <p className="text-xs text-cream-faint mb-6">{detail}</p>}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onPrimary}
          className="px-5 py-2.5 rounded-full text-xs tap text-cream"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
        >
          <IconRefresh size={14} className="inline mr-1.5 -mt-0.5" />
          {primaryLabel}
        </button>
        {secondaryTo && secondaryLabel && (
          <Link
            to={secondaryTo}
            className="px-5 py-2.5 rounded-full text-xs font-display font-semibold tap glow-ember"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            {secondaryLabel}
          </Link>
        )}
      </div>
    </div>
  );
}

function HomeTopBar({
  mode,
  setMode,
  onRefresh,
  activeItem,
  videoActions,
  variant = "immersive",
}: {
  mode: FeedMode;
  setMode: (mode: FeedMode) => void;
  onRefresh?: () => void;
  activeItem?: MediaItem;
  videoActions?: React.ReactNode;
  variant?: "immersive" | "desktop";
}) {
  return (
    <div
      className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-4 pb-2 pointer-events-none"
      style={{
        paddingTop:
          variant === "desktop" ? 12 : "calc(env(safe-area-inset-top) + 12px)",
        paddingLeft:
          variant === "desktop" ? 16 : "calc(env(safe-area-inset-left) + 16px)",
        paddingRight:
          variant === "desktop" ? 16 : "calc(env(safe-area-inset-right) + 16px)",
      }}
    >
      <div className="pointer-events-auto flex items-center gap-2.5 min-w-0">
        <span className="rec-dot" />
        <span className="hidden sm:inline font-display font-extrabold text-sm tracking-tight text-cream text-shadow">
          DOUY<span style={{ color: "var(--ember)" }}>TV</span>
        </span>
        <span className="hidden sm:inline font-mono text-[10px] tracking-[0.2em] text-cream-dim text-shadow">
          /{" "}
          {mode === "live"
            ? "LIVE RECS"
            : mode === "music"
              ? "MUSIC RECS"
              : "VIDEO FEED"}
        </span>
      </div>
      <nav
        className="absolute left-1/2 top-0 -translate-x-1/2 flex items-center gap-6 pointer-events-auto"
        style={{
          paddingTop:
            variant === "desktop" ? 16 : "calc(env(safe-area-inset-top) + 16px)",
        }}
        aria-label="首页推荐类型"
      >
        <FeedModeButton active={mode === "video"} onClick={() => setMode("video")}>
          视频
        </FeedModeButton>
        <FeedModeButton active={mode === "live"} onClick={() => setMode("live")}>
          直播
        </FeedModeButton>
        <FeedModeButton active={mode === "music"} onClick={() => setMode("music")}>
          音乐
        </FeedModeButton>
      </nav>
      <div className="flex gap-2 pointer-events-auto">
        {videoActions}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="w-9 h-9 rounded-full flex items-center justify-center tap text-cream backdrop-blur-md transition-colors"
            style={{
              background: "rgba(14,15,17,0.55)",
              border: "1px solid var(--cream-line)",
            }}
            aria-label="刷新"
            title={activeItem ? `刷新 ${activeItem.title}` : "刷新"}
          >
            <IconRefresh size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

function FeedModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative h-7 px-0.5 text-sm font-display tap text-shadow transition-colors"
      style={{
        background: "transparent",
        color: active ? "var(--cream)" : "var(--cream-dim)",
        fontWeight: active ? 800 : 500,
      }}
    >
      {children}
      {active && (
        <span
          className="absolute left-1/2 -translate-x-1/2 rounded-full"
          style={{
            bottom: -2,
            width: 18,
            height: 2,
            background: "var(--ember)",
            boxShadow: "0 0 10px var(--ember-glow)",
          }}
        />
      )}
    </button>
  );
}

function FeedShade() {
  return (
    <div
      className="absolute inset-0 pointer-events-none z-10"
      style={{
        background:
          "linear-gradient(180deg, rgba(0,0,0,0.42) 0%, transparent 28%, transparent 52%, rgba(0,0,0,0.72) 100%)",
      }}
    />
  );
}

function FeedCaption({
  item,
  index,
  desktop = false,
}: {
  item: MediaItem;
  index: number;
  desktop?: boolean;
}) {
  return (
    <div
      className="absolute left-4 right-24 text-cream pointer-events-none z-20"
      style={{
        bottom: desktop
          ? 86
          : "calc(var(--bottom-tab-h, 56px) + env(safe-area-inset-bottom) + 36px)",
        paddingLeft: desktop ? 0 : "env(safe-area-inset-left)",
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="px-2 py-0.5 rounded font-mono text-[10px] font-bold text-shadow"
          style={{
            background: "rgba(255,107,53,0.16)",
            color: "var(--ember)",
            border: "1px solid rgba(255,107,53,0.32)",
          }}
        >
          CH {String(index + 1).padStart(2, "0")}
        </span>
        {item.sourceName && (
          <span className="font-mono text-[10px] text-cream-dim text-shadow line-clamp-1">
            {item.sourceName}
          </span>
        )}
      </div>
      <h2 className="text-base font-display font-bold text-cream leading-relaxed text-shadow line-clamp-2 max-w-xl">
        {item.title}
      </h2>
      {item.description && item.description !== item.title && (
        <p className="text-xs text-cream-dim text-shadow mt-1 line-clamp-2 leading-relaxed max-w-xl">
          {item.description}
        </p>
      )}
      <div className="flex items-center gap-2 mt-2 text-cream-dim">
        <IconAlbum size={14} />
        <span className="font-mono text-[10px] tracking-[0.12em] animate-pulse">
          原声 - {item.typeName || item.remarks || `CH ${String(index + 1).padStart(2, "0")}`}
        </span>
      </div>
      {item.remarks && (
        <span
          className="inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-mono tracking-wider"
          style={{
            background: "rgba(242,232,213,0.08)",
            color: "var(--cream-dim)",
            border: "1px solid var(--cream-line)",
          }}
        >
          {item.remarks}
        </span>
      )}
    </div>
  );
}

function LiveCaption({
  item,
  index,
  desktop = false,
  onOpenDetail,
}: {
  item: MediaItem;
  index: number;
  desktop?: boolean;
  onOpenDetail?: (item: MediaItem) => void;
}) {
  const hasRoomDetail = !!item.netlivePlatform && !!item.netliveRoomId;
  const sourceLabel = formatLiveSource(item);

  return (
    <>
      <div
        className="absolute left-4 right-24 text-cream pointer-events-none z-20"
        style={{
          bottom: desktop
            ? 82
            : "calc(var(--bottom-tab-h, 56px) + env(safe-area-inset-bottom) + 38px)",
          paddingLeft: desktop ? 0 : "env(safe-area-inset-left)",
        }}
      >
        <button
          type="button"
          disabled={!hasRoomDetail || !onOpenDetail}
          onPointerDownCapture={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOpenDetail?.(item);
          }}
          className="pointer-events-auto block text-left tap disabled:cursor-default"
          aria-label={hasRoomDetail ? `进入${item.title}` : item.title}
        >
          <div className="flex items-center gap-2.5 mb-2">
            <FeedAvatar label={item.author || sourceLabel || item.title} live />
            <div className="min-w-0">
              <p className="font-display text-lg font-bold line-clamp-1 text-shadow text-cream">
                {item.author || item.title || "LIVE"}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full font-mono text-[10px] font-bold"
                  style={{ background: "rgba(255,107,53,0.84)", color: "var(--ink)" }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-ink animate-pulse" />
                  直播中
                </span>
                <span
                  className="px-2 py-0.5 rounded-full font-mono text-[10px] text-cream-dim"
                  style={{
                    background: "rgba(14,15,17,0.44)",
                    border: "1px solid var(--cream-line)",
                  }}
                >
                  来自 {sourceLabel}
                </span>
              </div>
            </div>
          </div>
          <h2 className="text-base font-display font-bold text-shadow line-clamp-2 max-w-xl text-cream">
            {item.title}
          </h2>
          {item.description && item.description !== item.title && (
            <p className="text-xs text-cream-dim text-shadow mt-1 line-clamp-2 leading-relaxed max-w-xl">
              {item.description}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className="px-2 py-1 rounded text-[11px] font-mono backdrop-blur-md text-cream-dim"
              style={{
                background: "rgba(14,15,17,0.42)",
                border: "1px solid var(--cream-line)",
              }}
            >
              {formatLiveViewers(index)} 观看
            </span>
            <span
              className="px-2 py-1 rounded text-[11px] font-mono backdrop-blur-md text-cream-dim"
              style={{
                background: "rgba(14,15,17,0.42)",
                border: "1px solid var(--cream-line)",
              }}
            >
              # {item.typeName || item.remarks || "直播推荐"}
            </span>
            {hasRoomDetail && (
              <span
                className="px-2 py-1 rounded text-[11px] font-mono backdrop-blur-md"
                style={{
                  background: "rgba(255,107,53,0.16)",
                  border: "1px solid rgba(255,107,53,0.34)",
                  color: "var(--ember)",
                }}
              >
                进入直播间
              </span>
            )}
          </div>
        </button>
      </div>
      <div
        className="absolute left-1/2 -translate-x-1/2 z-20 flex flex-col items-center pointer-events-none opacity-45 animate-drag-hint"
        style={{
          bottom: desktop
            ? 30
            : "calc(var(--bottom-tab-h, 56px) + env(safe-area-inset-bottom) + 8px)",
        }}
      >
        <span className="text-lg text-cream">⌃</span>
        <span className="font-mono text-[10px] text-cream-faint">下滑查看更多</span>
      </div>
    </>
  );
}

function FeedAvatar({ label, live = false }: { label?: string; live?: boolean }) {
  const initial = (label || "D").trim().slice(0, 1).toUpperCase();
  return (
    <span
      className="relative w-10 h-10 rounded-full grid place-items-center shrink-0 font-display font-extrabold text-sm"
      style={{
        background: live
          ? "linear-gradient(135deg, var(--ember), var(--vhs))"
          : "linear-gradient(135deg, var(--vhs), var(--phosphor))",
        color: "var(--ink)",
        border: live ? "2px solid var(--ember)" : "2px solid var(--vhs)",
        boxShadow: live
          ? "0 0 18px rgba(255,107,53,0.42)"
          : "0 0 18px rgba(79,195,247,0.38)",
      }}
    >
      {initial}
      {live && (
        <span
          className="absolute -right-0.5 -bottom-0.5 w-3 h-3 rounded-full"
          style={{ background: "var(--ember)", border: "2px solid var(--ink)" }}
        />
      )}
    </span>
  );
}

function LiveActionRail({ item, desktop }: { item: MediaItem; desktop?: boolean }) {
  const [liked, setLiked] = useState(() => loadLiked(item.id));
  const [toast, setToast] = useState<string | undefined>();
  const toggleNetLiveFavorite = useNetLiveStore((s) => s.toggleFavorite);
  const isNetLiveFavorite = useNetLiveStore((s) => s.isFavorite);
  const isMediaFavorite = useLibraryStore((s) => s.isFavorite(item.id));
  const toggleMediaFavorite = useLibraryStore((s) => s.toggleFavorite);
  const room = mediaItemToNetLiveRoom(item);
  const isFavorite = room
    ? isNetLiveFavorite(room.platform, room.roomId)
    : isMediaFavorite;

  useEffect(() => {
    setLiked(loadLiked(item.id));
  }, [item.id]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(undefined), 1300);
  };

  const handleLike = () => {
    const next = !liked;
    setLiked(next);
    saveLiked(item.id, next);
    showToast(next ? "已点赞" : "已取消点赞");
  };

  const handleFavorite = () => {
    if (room) toggleNetLiveFavorite(room);
    else toggleMediaFavorite(item);
    showToast(isFavorite ? "已取消收藏" : "已收藏");
  };

  const handleShare = async () => {
    const shareUrl = liveShareUrl(item);
    const shareData = {
      title: item.title,
      text: item.description ?? "",
      url: shareUrl,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast("已复制链接");
    } catch {
      showToast(shareUrl);
    }
  };

  return (
    <>
      <div
        className="absolute right-4 z-30 flex flex-col items-center gap-4 pointer-events-auto"
        style={{
          bottom: desktop
            ? 106
            : "calc(var(--bottom-tab-h, 56px) + env(safe-area-inset-bottom) + 92px)",
          paddingRight: desktop ? 0 : "env(safe-area-inset-right)",
        }}
        onPointerDownCapture={(e) => e.stopPropagation()}
      >
        <FeedActionButton
          icon={liked ? <IconHeartFill size={22} /> : <IconHeart size={22} />}
          label={liked ? "已赞" : "点赞"}
          active={liked}
          tone="ember"
          onClick={handleLike}
        />
        <FeedActionButton
          icon={
            isFavorite ? <IconBookmarkFill size={21} /> : <IconBookmark size={21} />
          }
          label={isFavorite ? "已收藏" : "收藏"}
          active={isFavorite}
          onClick={handleFavorite}
        />
        <FeedActionButton
          icon={<IconShare size={20} />}
          label="分享"
          onClick={() => void handleShare()}
        />
      </div>
      {toast && (
        <div
          className="absolute left-1/2 top-1/2 z-30 px-5 py-2.5 backdrop-blur-md pointer-events-none animate-toast-in font-mono text-xs tracking-wider"
          style={{
            background: "rgba(14, 15, 17, 0.86)",
            border: "1px solid var(--cream-line)",
            borderRadius: 10,
            color: "var(--cream)",
            boxShadow:
              "0 0 0 1px rgba(255,107,53,0.18), 0 12px 32px -8px rgba(0,0,0,0.6)",
          }}
        >
          <span className="rec-dot" style={{ marginRight: 8 }} />
          {toast}
        </div>
      )}
    </>
  );
}

function FeedActionButton({
  icon,
  label,
  tone,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  tone?: "ember" | "vhs";
  active?: boolean;
  onClick?: () => void;
}) {
  const color =
    active || tone === "ember"
      ? "var(--ember)"
      : tone === "vhs"
        ? "var(--vhs)"
        : "var(--cream)";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className={`feed-action-button group flex flex-col items-center gap-1 select-none ${
        active ? "feed-action-button-active" : ""
      }`}
      style={{ color }}
    >
      <span
        className="feed-action-icon w-12 h-12 rounded-full grid place-items-center backdrop-blur-md"
      >
        {icon}
      </span>
      <span className="font-mono text-[10px] text-cream text-shadow">{label}</span>
    </button>
  );
}

function formatLiveViewers(index: number) {
  const count = 3.6 + ((index * 7) % 23) / 10;
  return `${count.toFixed(1)}万`;
}

const FALLBACK_PLATFORM_LABELS: Record<string, string> = {
  bilibili: "哔哩哔哩",
  douyu: "斗鱼",
  huya: "虎牙",
  douyin: "抖音",
  kuaishou: "快手",
  cc: "网易 CC",
  twitch: "Twitch",
  youtube: "YouTube",
  kick: "Kick",
  trovo: "Trovo",
  bigo: "Bigo Live",
  live17: "17 Live",
  chaturbate: "Chaturbate",
  stripchat: "Stripchat",
  bongacams: "BongaCams",
  camsoda: "CamSoda",
};

function formatPlatformLabel(platform?: string): string {
  if (!platform) return "IPTV";
  return (
    NETLIVE_PLATFORMS.find((meta) => meta.id === platform)?.label ??
    FALLBACK_PLATFORM_LABELS[platform] ??
    platform
  );
}

function formatLiveSource(item: MediaItem): string {
  if (item.netlivePlatform) return formatPlatformLabel(item.netlivePlatform);
  return item.sourceName ? `IPTV / ${item.sourceName}` : "IPTV";
}

function mediaItemToNetLiveRoom(item: MediaItem): NetLiveRoom | null {
  if (!item.netlivePlatform || !item.netliveRoomId) return null;
  return {
    platform: item.netlivePlatform,
    roomId: item.netliveRoomId,
    title: item.title,
    uname: item.author,
    avatar: item.poster,
    cover: item.poster,
    category: item.typeName || item.remarks,
    introduction: item.description,
    live: true,
  };
}

function liveShareUrl(item: MediaItem): string {
  if (item.netlivePlatform && item.netliveRoomId) {
    return `${window.location.origin}/live/room/${encodeURIComponent(item.netlivePlatform)}/${encodeURIComponent(item.netliveRoomId)}`;
  }
  return item.url || window.location.href;
}

function likeKey(itemId: string): string {
  return `douytv:liked:${itemId}`;
}

function loadLiked(itemId: string): boolean {
  try {
    return localStorage.getItem(likeKey(itemId)) === "1";
  } catch {
    return false;
  }
}

function saveLiked(itemId: string, liked: boolean) {
  try {
    if (liked) localStorage.setItem(likeKey(itemId), "1");
    else localStorage.removeItem(likeKey(itemId));
  } catch {
    /* ignore */
  }
}

function FeedLoading({ label }: { label: string }) {
  return (
    <div
      className="absolute inset-x-0 bottom-0 flex items-center justify-center text-cream-dim"
      style={{
        top: "64px",
      }}
    >
      <div
        className="px-6 py-5 rounded-lg flex flex-col items-center"
        style={{
          background: "rgba(14,15,17,0.62)",
          border: "1px solid var(--cream-line)",
          backdropFilter: "blur(10px)",
        }}
      >
        <div className="signal-bars" style={{ height: 24 }}>
          <span />
          <span />
          <span />
        </div>
        <p className="mt-5 text-xs font-mono tracking-[0.25em] text-cream-faint">
          {label}
        </p>
      </div>
    </div>
  );
}

function FeedError({
  title,
  message,
  actionLabel,
  onRetry,
}: {
  title: string;
  message: string;
  actionLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-ink text-cream-dim p-6">
      <IconStatic size={56} className="text-cream-faint mb-4" />
      <p className="font-mono text-[10px] tracking-[0.2em] text-ember mb-2">
        {title}
      </p>
      <p className="text-sm text-cream-dim mb-6 text-center">{message}</p>
      <button
        onClick={onRetry}
        className="px-5 py-2.5 rounded-full text-xs font-display font-semibold tracking-wider tap glow-ember"
        style={{ background: "var(--ember)", color: "var(--ink)" }}
      >
        {actionLabel}
      </button>
    </div>
  );
}
