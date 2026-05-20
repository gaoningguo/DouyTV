/**
 * 抽离的歌词视图 — Player.tsx + 桌面歌词窗口共用。
 *
 * 特性：
 * - 双语显示（rawLrc + translation 行合并）
 * - 字号 +/- 持久化（store.lrcSize 0-3）
 * - 自动滚动到当前行
 * - 点击行 → seek 到该行（store.seekTo）
 * - 当前行 ember + 大字号；远离 5+ 行渐淡到 0.4
 */
import { useEffect, useMemo, useRef } from "react";
import { useMusicStore } from "@/stores/music";
import {
  fetchLyrics,
  fetchTranslatedLyrics,
  mergeLyricsWithTranslation,
  parseLyrics,
} from "@/lib/music/api";

const FONT_SIZES = [12, 14, 16, 18] as const;
const FONT_SIZES_LG = [14, 16, 18, 22] as const;

interface LyricLine {
  time: number;
  text: string;
  translation?: string;
}

export function MusicLyricView({
  showTimeline = true,
  largeMode = false,
}: {
  /** 是否显示当前行左侧的小时间刻度（桌面 Player 用，迷你视图不用） */
  showTimeline?: boolean;
  /** 大模式：桌面 Player / 独立歌词窗口用更大字号 */
  largeMode?: boolean;
}) {
  const current = useMusicStore((s) => s.current);
  const positionSec = useMusicStore((s) => s.positionSec);
  const showTranslation = useMusicStore((s) => s.showTranslation);
  const lrcSize = useMusicStore((s) => s.lrcSize);
  const seekTo = useMusicStore((s) => s.seekTo);

  // 缓存：歌词数据按 song key 缓存（避免 fetch 重入）
  const cacheRef = useRef<Map<string, LyricLine[]>>(new Map());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const linesRef = useRef<LyricLine[]>([]);

  // 用 forceUpdate 触发渲染
  const tick = useRef(0);
  const forceUpdate = () => {
    tick.current++;
    if (containerRef.current) {
      containerRef.current.dataset.tick = String(tick.current);
    }
  };

  useEffect(() => {
    if (!current) {
      linesRef.current = [];
      forceUpdate();
      return;
    }
    const key = `${current.source}:${current.songId}`;
    const cached = cacheRef.current.get(key);
    if (cached) {
      linesRef.current = cached;
      forceUpdate();
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [raw, translation] = await Promise.all([
          fetchLyrics(current),
          fetchTranslatedLyrics(current),
        ]);
        if (cancelled) return;
        const lines: LyricLine[] = translation
          ? mergeLyricsWithTranslation(raw, translation)
          : parseLyrics(raw);
        cacheRef.current.set(key, lines);
        linesRef.current = lines;
        forceUpdate();
      } catch {
        if (!cancelled) {
          linesRef.current = [];
          forceUpdate();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [current?.source, current?.songId]);

  const currentIdx = useMemo(() => {
    const lrc = linesRef.current;
    if (lrc.length === 0) return -1;
    let idx = 0;
    for (let i = 0; i < lrc.length; i++) {
      if (lrc[i].time <= positionSec) idx = i;
      else break;
    }
    return idx;
  }, [positionSec, tick.current]);

  // 滚到当前行
  useEffect(() => {
    if (currentIdx < 0) return;
    const el = containerRef.current?.querySelector<HTMLElement>(
      `[data-lrc-idx="${currentIdx}"]`
    );
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [currentIdx]);

  const sizePx = (largeMode ? FONT_SIZES_LG : FONT_SIZES)[lrcSize];
  const lrc = linesRef.current;

  if (lrc.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-cream-faint font-mono">无歌词</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="overflow-y-auto no-scrollbar h-full"
      style={{
        maskImage:
          "linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)",
      }}
    >
      <ul className="space-y-3 py-[30vh]">
        {lrc.map((line, i) => {
          const dist = Math.abs(i - currentIdx);
          const isActive = i === currentIdx;
          return (
            <li
              key={i}
              data-lrc-idx={i}
              className="text-center cursor-pointer tap"
              onClick={() => seekTo(line.time)}
              style={{
                fontSize: isActive ? `${sizePx + 2}px` : `${sizePx}px`,
                color: isActive ? "var(--ember)" : "var(--cream-dim)",
                fontWeight: isActive ? 700 : 400,
                opacity: dist > 5 ? 0.35 : 1 - dist * 0.12,
                transition: "all 200ms ease",
              }}
            >
              {showTimeline && isActive && (
                <span className="font-mono text-[9px] text-cream-faint mr-2">
                  {formatTime(line.time)}
                </span>
              )}
              <span>{line.text}</span>
              {showTranslation && line.translation && (
                <span
                  className="block text-[0.85em] mt-1"
                  style={{
                    color: isActive ? "var(--phosphor)" : "var(--cream-faint)",
                  }}
                >
                  {line.translation}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default MusicLyricView;
