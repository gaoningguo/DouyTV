import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import VideoFeed from "@/components/VideoFeed";
import InteractionBar from "@/components/InteractionBar";
import SourceSwitcher from "@/components/SourceSwitcher";
import DanmakuPanel, {
  loadDanmakuMemory,
  saveDanmakuMemory,
} from "@/components/DanmakuPanel";
import { useFeed } from "@/hooks/useFeed";
import { useLibraryStore } from "@/stores/library";
import { useScriptStore } from "@/stores/scripts";
import { useDanmakuStore } from "@/stores/danmaku";
import { IconRefresh, IconStatic, IconDanmaku } from "@/components/Icon";
import type { MediaItem } from "@/types/media";
import type { ScriptPlayback } from "@/source-script/types";
import type { DanmakuSelection } from "@/lib/danmaku/types";

export default function Home() {
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
  // ArtPlayer 设置菜单「换源 / 测速」触发 → 这里 set 当前 item，弹 SourceSwitcher
  const [switchSourceItem, setSwitchSourceItem] = useState<MediaItem | null>(null);
  // 浮层弹幕选择
  const [danmakuPanelOpen, setDanmakuPanelOpen] = useState(false);
  // 强制重渲染当前弹幕 selection（saveDanmakuMemory 完不会自动触发 React）
  const [danmakuSelTick, setDanmakuSelTick] = useState(0);

  useEffect(() => {
    hydrateScripts();
    hydrateLib();
  }, [hydrateScripts, hydrateLib]);

  const activeItem: MediaItem | undefined = items[activeIndex];

  const currentDanmakuSel: DanmakuSelection | null = useMemo(() => {
    if (!activeItem?.title) return null;
    return loadDanmakuMemory(activeItem.title) ?? null;
    // 依赖 danmakuSelTick 让选择完后立即更新
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

  // SourceSwitcher 需要的 playbacks（当前线路占位）+ script
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

  const TopBar = (
    <div
      className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-4 pb-2 pointer-events-none"
      style={{
        paddingTop: "calc(env(safe-area-inset-top) + 12px)",
        paddingLeft: "calc(env(safe-area-inset-left) + 16px)",
        paddingRight: "calc(env(safe-area-inset-right) + 16px)",
      }}
    >
      <div className="pointer-events-auto flex items-center gap-2.5">
        <span className="rec-dot" />
        <span className="font-display font-extrabold text-sm tracking-tight text-cream text-shadow">
          DOUY<span style={{ color: "var(--ember)" }}>TV</span>
        </span>
        <span className="font-mono text-[10px] tracking-[0.2em] text-cream-dim text-shadow">
          / LIVE FEED
        </span>
      </div>
      <div className="flex gap-2 pointer-events-auto">
        {/* Play 页风格弹幕开关 + 选择 —— 仅当有当前 item 时显示 */}
        {activeItem && (
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
              className="px-3 h-9 flex items-center gap-1.5 rounded-full backdrop-blur-md tap font-display text-xs"
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
        )}
        <button
          type="button"
          onClick={reload}
          className="w-9 h-9 rounded-full flex items-center justify-center tap text-cream backdrop-blur-md transition-colors"
          style={{
            background: "rgba(14,15,17,0.55)",
            border: "1px solid var(--cream-line)",
          }}
          aria-label="刷新"
        >
          <IconRefresh size={16} />
        </button>
      </div>
    </div>
  );

  if (loading && items.length === 0) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-ink text-cream-dim">
        <div className="signal-bars" style={{ height: 24 }}>
          <span></span>
          <span></span>
          <span></span>
        </div>
        <p className="mt-5 text-xs font-mono tracking-[0.25em] text-cream-faint">
          TUNING IN…
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-ink text-cream-dim p-6">
        <IconStatic size={56} className="text-cream-faint mb-4" />
        <p className="font-mono text-[10px] tracking-[0.2em] text-ember mb-2">
          NO SIGNAL
        </p>
        <p className="text-sm text-cream-dim mb-6 text-center">{error}</p>
        <button
          onClick={reload}
          className="px-5 py-2.5 rounded-full text-xs font-display font-semibold tracking-wider tap glow-ember"
          style={{ background: "var(--ember)", color: "var(--ink)" }}
        >
          重试连接
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-ink text-cream-dim p-6">
        {TopBar}
        <IconStatic size={64} className="text-cream-faint mb-4" />
        <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint mb-2">
          NO BROADCAST
        </p>
        <p className="mb-2 text-sm text-cream-dim">还没有可用的视频内容</p>
        <p className="text-xs text-cream-faint mb-6">
          已安装 <span className="font-mono text-cream-dim">{scripts.length}</span>{" "}
          个脚本，启用{" "}
          <span className="font-mono text-ember">
            {scripts.filter((s) => s.enabled).length}
          </span>{" "}
          个
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={reload}
            className="px-5 py-2.5 rounded-full text-xs tap text-cream"
            style={{
              background: "var(--ink-2)",
              border: "1px solid var(--cream-line)",
            }}
          >
            <IconRefresh size={14} className="inline mr-1.5 -mt-0.5" />
            刷新
          </button>
          <Link
            to="/settings"
            className="px-5 py-2.5 rounded-full text-xs font-display font-semibold tap glow-ember"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            前往设置
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-full overflow-hidden bg-ink">
      {TopBar}
      <VideoFeed
        items={items}
        onLoadMore={loadMore}
        controls
        onIndexChange={setActiveIndex}
        onProgress={(item, position, duration) =>
          upsertHistory(item, { position, duration })
        }
        onItemEnded={(item) => {
          // 合集自动下一集；不是合集的视频自然 loop=true（VideoPlayer 默认）
          const cur = item.currentEpisodeIndex ?? 0;
          const total = item.episodes?.length ?? 0;
          if (total > 1 && cur + 1 < total) {
            void changeEpisode(item.id, cur + 1);
          }
        }}
        onRequestReresolve={(item) => reresolveItem(item.id)}
        onRequestSwitchSource={(item) => setSwitchSourceItem(item)}
        onChangeEpisode={(item, idx) => changeEpisode(item.id, idx)}
        renderOverlay={(item, i) => (
          <>
            <div
              className="absolute left-4 right-20 text-cream pointer-events-none z-20"
              style={{
                bottom: "calc(env(safe-area-inset-bottom) + 56px + 16px)",
                paddingLeft: "env(safe-area-inset-left)",
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="chip-ch">CH {String(i + 1).padStart(2, "0")}</span>
                {item.sourceName && (
                  <span className="font-mono text-[10px] text-cream-dim text-shadow tracking-wider">
                    @{item.sourceName}
                  </span>
                )}
              </div>
              <p className="text-base font-display font-bold text-shadow leading-snug">
                {item.title}
              </p>
              {item.description && (
                <p className="text-xs text-cream-dim text-shadow mt-2 line-clamp-2 leading-relaxed">
                  {item.description}
                </p>
              )}
              {item.remarks && (
                <span
                  className="inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-mono tracking-wider"
                  style={{
                    background: "rgba(124,255,178,0.12)",
                    color: "var(--phosphor)",
                    border: "1px solid rgba(124,255,178,0.25)",
                  }}
                >
                  {item.remarks}
                </span>
              )}
            </div>
            <InteractionBar
              item={item}
              onSelectEpisode={(idx) => changeEpisode(item.id, idx)}
            />
          </>
        )}
      />

      {/* 跨脚本换源 / 测速 —— ArtPlayer 设置菜单触发 */}
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

      {/* 弹幕选择面板 */}
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
    </div>
  );
}
