import { useEffect } from "react";
import { Link } from "react-router-dom";
import VideoFeed from "@/components/VideoFeed";
import InteractionBar from "@/components/InteractionBar";
import { useFeed } from "@/hooks/useFeed";
import { useLibraryStore } from "@/stores/library";
import { useScriptStore } from "@/stores/scripts";
import { IconRefresh, IconStatic } from "@/components/Icon";

export default function Home() {
  const { items, loading, error, loadMore, reload, changeEpisode, reresolveItem } = useFeed();
  const hydrateScripts = useScriptStore((s) => s.hydrate);
  const hydrateLib = useLibraryStore((s) => s.hydrate);
  const upsertHistory = useLibraryStore((s) => s.upsertHistory);
  const scripts = useScriptStore((s) => s.scripts);

  useEffect(() => {
    hydrateScripts();
    hydrateLib();
  }, [hydrateScripts, hydrateLib]);

  const TopBar = (
    <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-4 pt-3 pb-2 pointer-events-none">
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
        onProgress={(item, position, duration) =>
          upsertHistory(item, { position, duration })
        }
        onRequestReresolve={(item) => reresolveItem(item.id)}
        renderOverlay={(item, i) => (
          <>
            <div className="absolute left-4 right-20 bottom-20 md:bottom-20 text-cream pointer-events-none z-20">
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
    </div>
  );
}
