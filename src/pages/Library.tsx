import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLibraryStore } from "@/stores/library";
import { useScriptStore } from "@/stores/scripts";
import { useLiveStore } from "@/stores/live";
import {
  IconHeart,
  IconClock,
  IconStats,
  IconKeyboard,
  IconChevronDown,
  IconFilm,
} from "@/components/Icon";

function formatTime(sec: number): string {
  if (!sec || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const dd = d.getDate().toString().padStart(2, "0");
  const hh = d.getHours().toString().padStart(2, "0");
  const mi = d.getMinutes().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

const HOTKEYS: Array<[string, string]> = [
  ["空格 / K", "播放 / 暂停（单视频页）"],
  ["← / →", "后退 / 前进 5 秒"],
  ["↑ / ↓", "上一个 / 下一个视频（首页滑动）"],
  ["M", "静音切换"],
  ["F", "全屏切换"],
  ["P", "画中画"],
  ["J / PgDn / 滚轮↓", "下一个视频（首页）"],
  ["K / PgUp / 滚轮↑", "上一个视频（首页）"],
];

export default function Library() {
  const favorites = useLibraryStore((s) => s.favorites);
  const history = useLibraryStore((s) => s.history);
  const hydrate = useLibraryStore((s) => s.hydrate);
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);
  const clearHistory = useLibraryStore((s) => s.clearHistory);

  const scripts = useScriptStore((s) => s.scripts);
  const hydrateScripts = useScriptStore((s) => s.hydrate);
  const channels = useLiveStore((s) => s.channels);
  const hydrateLive = useLiveStore((s) => s.hydrate);

  const [showHotkeys, setShowHotkeys] = useState(false);

  useEffect(() => {
    hydrate();
    hydrateScripts();
    hydrateLive();
  }, [hydrate, hydrateScripts, hydrateLive]);

  const totalWatchSeconds = history.reduce(
    (acc, h) => acc + (h.position || 0),
    0
  );
  const completedCount = history.filter((h) => h.completed).length;
  const sourceUsage = (() => {
    const m = new Map<string, number>();
    for (const h of history) {
      const k = h.sourceName || h.scriptKey || "未知";
      m.set(k, (m.get(k) || 0) + 1);
    }
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
  })();

  function formatHours(sec: number): string {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h >= 1) return `${h} 小时 ${m} 分钟`;
    return `${m} 分钟`;
  }

  return (
    <div className="min-h-screen bg-ink text-cream p-4 pb-20">
      <div className="mb-5">
        <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
          PROFILE · LIBRARY
        </p>
        <h1 className="font-display text-2xl font-extrabold tracking-tight mt-1">
          我的
        </h1>
      </div>

      <section className="grid grid-cols-4 gap-2 mb-5">
        {[
          { to: "/scripts", value: scripts.length, label: "SOURCES", color: "ember" as const },
          { to: undefined as string | undefined, value: favorites.length, label: "LIKED", color: "ember" as const },
          { to: undefined as string | undefined, value: history.length, label: "WATCHED", color: "vhs" as const },
          { to: "/live", value: channels.length, label: "CHANNELS", color: "phosphor" as const },
        ].map((s, i) => {
          const accentVar = `var(--${s.color})`;
          const content = (
            <>
              <p
                className="font-display text-2xl font-extrabold leading-none mb-1"
                style={{ color: accentVar }}
              >
                {s.value}
              </p>
              <p className="font-mono text-[9px] tracking-wider text-cream-faint">
                {s.label}
              </p>
            </>
          );
          const baseClass =
            "p-3 rounded-xl text-center tap relative overflow-hidden block";
          const baseStyle = {
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          };
          return s.to ? (
            <Link key={i} to={s.to} className={baseClass} style={baseStyle}>
              {content}
            </Link>
          ) : (
            <div key={i} className={baseClass} style={baseStyle}>
              {content}
            </div>
          );
        })}
      </section>

      {history.length > 0 && (
        <section
          className="rounded-xl p-4 mb-6"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <IconStats size={14} className="text-cream-faint" />
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
              STATS
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="font-mono text-[10px] text-cream-faint mb-1">
                累计观看
              </p>
              <p className="font-display font-bold text-base text-ember">
                {formatHours(totalWatchSeconds)}
              </p>
            </div>
            <div>
              <p className="font-mono text-[10px] text-cream-faint mb-1">
                看完
              </p>
              <p className="font-display font-bold text-base text-ember">
                {completedCount} 部
              </p>
            </div>
          </div>
          {sourceUsage.length > 0 && (
            <div className="mt-3 pt-3 border-t border-cream-line">
              <p className="font-mono text-[10px] text-cream-faint mb-1.5">
                常看来源
              </p>
              <div className="flex flex-wrap gap-1.5">
                {sourceUsage.map(([k, n]) => (
                  <span
                    key={k}
                    className="text-[11px] px-2 py-0.5 rounded"
                    style={{
                      background: "var(--ember-soft)",
                      color: "var(--ember)",
                      border: "1px solid rgba(255,107,53,0.25)",
                    }}
                  >
                    {k} · {n}
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <section className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <IconHeart size={16} className="text-ember" />
          <h2 className="font-display text-base font-bold">收藏</h2>
          <span className="font-mono text-[10px] text-cream-faint">
            ({String(favorites.length).padStart(2, "0")})
          </span>
        </div>
        {favorites.length === 0 ? (
          <p className="text-sm text-cream-faint">
            还没有收藏。在视频右侧点击 <IconHeart size={12} className="inline -mt-0.5" />
          </p>
        ) : (
          <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2">
            {favorites.map((f) => (
              <div
                key={f.itemId}
                className="aspect-[3/4] rounded-lg overflow-hidden flex flex-col relative group"
                style={{
                  background: "var(--ink-2)",
                  border: "1px solid var(--cream-line)",
                }}
              >
                <Link
                  to={`/detail/${encodeURIComponent(f.scriptKey)}/${encodeURIComponent(f.vodId)}`}
                  className="flex-1 relative scanlines tap"
                >
                  {f.poster ? (
                    <img
                      src={f.poster}
                      alt={f.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-cream-faint">
                      <IconFilm size={28} />
                    </div>
                  )}
                </Link>
                <div className="p-2 flex flex-col gap-1">
                  <Link
                    to={`/detail/${encodeURIComponent(f.scriptKey)}/${encodeURIComponent(f.vodId)}`}
                    className="text-xs line-clamp-1 text-cream tap"
                  >
                    {f.title}
                  </Link>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      toggleFavorite({
                        id: f.itemId,
                        kind: "video",
                        title: f.title,
                        url: "",
                        poster: f.poster,
                        sourceName: f.sourceName,
                      });
                    }}
                    className="text-[10px] font-mono tap text-ember text-left"
                  >
                    取消收藏
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <IconClock size={16} className="text-cream-dim" />
            <h2 className="font-display text-base font-bold">历史</h2>
            <span className="font-mono text-[10px] text-cream-faint">
              ({String(history.length).padStart(2, "0")})
            </span>
          </div>
          {history.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (confirm("清空所有播放历史？")) clearHistory();
              }}
              className="text-[10px] font-mono tracking-wider text-cream-faint hover:text-ember tap"
            >
              CLEAR
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <p className="text-sm text-cream-faint">还没有观看记录</p>
        ) : (
          <ul className="space-y-2">
            {history.slice(0, 30).map((h) => {
              const ratio = h.duration > 0 ? h.position / h.duration : 0;
              const continueHref = `/play/${encodeURIComponent(h.scriptKey)}/${encodeURIComponent(h.vodId)}/0/${h.episodeIndex}`;
              return (
                <li
                  key={h.itemId}
                  className="rounded-lg overflow-hidden"
                  style={{
                    background: "var(--ink-2)",
                    border: "1px solid var(--cream-line)",
                  }}
                >
                  <Link
                    to={continueHref}
                    className="flex gap-3 p-2 tap"
                  >
                    {h.poster ? (
                      <img
                        src={h.poster}
                        alt={h.title}
                        className="w-16 h-20 object-cover rounded scanlines"
                      />
                    ) : (
                      <div
                        className="w-16 h-20 rounded flex items-center justify-center text-cream-faint"
                        style={{ background: "var(--ink-3)" }}
                      >
                        <IconFilm size={20} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-display line-clamp-1 text-cream">
                        {h.title}
                      </p>
                      {h.sourceName && (
                        <p className="font-mono text-[10px] text-cream-faint mt-0.5">
                          @{h.sourceName}
                        </p>
                      )}
                      <p className="font-mono text-[10px] text-cream-faint mt-0.5">
                        {formatTime(h.position)} / {formatTime(h.duration)}
                        {h.completed && (
                          <span className="ml-2 text-phosphor">已看完</span>
                        )}
                        {!h.completed && h.position > 5 && (
                          <span className="ml-2 text-ember">继续播放 ▸</span>
                        )}
                      </p>
                      <div
                        className="h-1 rounded-full mt-2 overflow-hidden"
                        style={{ background: "rgba(242,232,213,0.08)" }}
                      >
                        <div
                          className="h-full"
                          style={{
                            background: "var(--ember)",
                            width: `${Math.min(100, ratio * 100)}%`,
                          }}
                        />
                      </div>
                      <p className="font-mono text-[10px] text-cream-faint mt-1">
                        {formatDate(h.updatedAt)}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
            {history.length > 30 && (
              <p className="text-center font-mono text-[10px] text-cream-faint mt-2 tracking-wider">
                — SHOWING LATEST 30 OF {history.length} —
              </p>
            )}
          </ul>
        )}
      </section>

      <section className="mb-6">
        <button
          type="button"
          onClick={() => setShowHotkeys((x) => !x)}
          className="w-full text-left flex items-center justify-between mb-3 tap"
        >
          <div className="flex items-center gap-2">
            <IconKeyboard size={16} className="text-cream-dim" />
            <h2 className="font-display text-base font-bold">键盘快捷键</h2>
          </div>
          <IconChevronDown
            size={16}
            className="text-cream-faint transition-transform"
            style={{
              transform: showHotkeys ? "rotate(180deg)" : "rotate(0)",
            }}
          />
        </button>
        {showHotkeys && (
          <ul className="space-y-1.5">
            {HOTKEYS.map(([key, desc]) => (
              <li
                key={key}
                className="flex items-center justify-between p-2 rounded text-xs"
                style={{
                  background: "var(--ink-2)",
                  border: "1px solid var(--cream-line)",
                }}
              >
                <code className="text-ember font-mono text-[11px]">{key}</code>
                <span className="text-cream-dim">{desc}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="font-mono text-[10px] text-cream-faint mt-2 text-center tracking-[0.2em]">
        更多设置 → 底部「设置」 tab
      </p>
    </div>
  );
}
