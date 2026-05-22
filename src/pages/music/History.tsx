/**
 * 完整播放历史 —— 按时段分组（今天 / 昨天 / 7 天内 / 更早），统一头部 + 统一行。
 */
import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useMusicStore } from "@/stores/music";
import {
  IconHistoryClock,
  IconTrash,
} from "@/components/Icon";
import { MusicDetailHeader } from "@/components/MusicDetailHeader";
import { MusicListItem } from "@/components/MusicListItem";
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

function formatDuration(sec?: number) {
  if (!sec || !Number.isFinite(sec)) return undefined;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
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
    <div className="min-h-screen bg-ink text-cream p-4">
      <div className="flex items-center mb-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="font-mono text-[10px] tracking-[0.2em] text-cream-faint tap"
          aria-label="返回"
        >
          ← 返回
        </button>
      </div>

      <MusicDetailHeader
        eyebrow="MUSIC · HISTORY"
        title="播放历史"
        meta={[`${history.length} 首`]}
        rightSlot={
          history.length > 0 ? (
            <button
              type="button"
              onClick={() => void handleClear()}
              className="w-9 h-9 flex items-center justify-center rounded tap text-cream-faint hover:text-cream"
              style={{
                background: "var(--ink-2)",
                border: "1px solid var(--cream-line)",
              }}
              aria-label="清空播放历史"
              title="清空播放历史"
            >
              <IconTrash size={14} />
            </button>
          ) : undefined
        }
      />

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
                    <MusicListItem
                      song={h}
                      duration={formatDuration(h.durationSec)}
                      onClick={() => void playQueue(list, i)}
                      onMenu={() => showMusicMenu(h)}
                      trailing={
                        <span className="font-mono text-[9px] text-cream-faint shrink-0 mr-1">
                          ×{h.playCount}
                        </span>
                      }
                    />
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
