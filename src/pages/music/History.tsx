/**
 * 完整播放历史 —— 按时段分组（今天 / 昨天 / 7 天内 / 更早）。
 */
import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useMusicStore } from "@/stores/music";
import { wrapImage } from "@/lib/proxy";
import {
  IconArrowLeft,
  IconHistoryClock,
  IconMusic,
  IconTrash,
} from "@/components/Icon";
import { showMusicMenu } from "@/components/MusicContextMenu";
import type { MusicHistoryRecord } from "@/lib/music/types";

const DAY_MS = 24 * 60 * 60 * 1000;

function groupHistory(items: MusicHistoryRecord[]) {
  const now = Date.now();
  const todayStart = new Date(now).setHours(0, 0, 0, 0);
  const yesterdayStart = todayStart - DAY_MS;
  const weekStart = todayStart - 6 * DAY_MS;
  const groups: Record<string, MusicHistoryRecord[]> = {
    今天: [],
    昨天: [],
    "7 天内": [],
    更早: [],
  };
  for (const h of items) {
    if (h.lastPlayedAt >= todayStart) groups["今天"].push(h);
    else if (h.lastPlayedAt >= yesterdayStart) groups["昨天"].push(h);
    else if (h.lastPlayedAt >= weekStart) groups["7 天内"].push(h);
    else groups["更早"].push(h);
  }
  return Object.entries(groups).filter(([, list]) => list.length > 0);
}

export default function MusicHistory() {
  const navigate = useNavigate();
  const hydrate = useMusicStore((s) => s.hydrate);
  const history = useMusicStore((s) => s.history);
  const playQueue = useMusicStore((s) => s.playQueue);
  const clearHistory = useMusicStore((s) => s.clearHistory);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const groups = useMemo(() => groupHistory(history), [history]);

  const handleClear = async () => {
    if (!window.confirm("清空全部播放历史？此操作不可恢复")) return;
    if (!window.confirm("再次确认 — 清空全部播放历史？")) return;
    await clearHistory();
  };

  return (
    <div className="min-h-screen bg-ink text-cream p-4 pb-24">
      <div className="flex items-center gap-3 mb-5">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          aria-label="返回"
        >
          <IconArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
            MUSIC · HISTORY
          </p>
          <h1 className="font-display text-xl font-extrabold tracking-tight">播放历史</h1>
        </div>
        {history.length > 0 && (
          <button
            type="button"
            onClick={() => void handleClear()}
            className="w-9 h-9 flex items-center justify-center tap text-cream-faint"
            aria-label="清空"
          >
            <IconTrash size={14} />
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div
          className="rounded-xl p-6 text-center"
          style={{ background: "var(--ink-2)", border: "1px dashed var(--cream-line)" }}
        >
          <IconHistoryClock size={32} className="text-cream-faint mx-auto mb-2" />
          <p className="text-sm text-cream-dim">还没有播放记录</p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map(([title, list]) => (
            <section key={title}>
              <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
                {title.toUpperCase()} · {list.length}
              </p>
              <ul className="space-y-1.5">
                {list.map((h, i) => (
                  <li key={`${h.source}-${h.songId}-${h.lastPlayedAt}`}>
                    <button
                      type="button"
                      onClick={() => void playQueue(list, i)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        showMusicMenu(h);
                      }}
                      className="w-full flex items-center gap-3 p-2 rounded-lg tap text-left"
                      style={{
                        background: "var(--ink-2)",
                        border: "1px solid var(--cream-line)",
                      }}
                    >
                      {h.cover ? (
                        <img
                          src={wrapImage(h.cover)}
                          alt=""
                          loading="lazy"
                          className="w-10 h-10 rounded shrink-0 object-cover"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded shrink-0 flex items-center justify-center bg-ink-3">
                          <IconMusic size={16} className="text-cream-faint" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-display font-semibold line-clamp-1">
                          {h.name}
                        </p>
                        <p className="text-[10px] font-mono text-cream-faint line-clamp-1">
                          {h.artist || "—"}
                        </p>
                      </div>
                      <span className="font-mono text-[9px] text-cream-faint shrink-0">
                        ×{h.playCount}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
