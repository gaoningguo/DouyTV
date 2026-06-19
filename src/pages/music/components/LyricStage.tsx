import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LyricLine } from "../types";

/**
 * 逐字歌词舞台：requestAnimationFrame 直读 audio.currentTime（60fps），
 * 对当前行做词级 mask 扫光，非当前行模糊聚焦，点击行跳转。
 *
 * 设计取舍：
 *  - 不依赖 React 的 currentTime state（onTimeUpdate 只有 ~4Hz，扫光会一顿一顿）。
 *  - 进度通过 CSS 变量 --sweep 写到 DOM，避免每帧 setState 触发 React 重渲染。
 *  - 仅当前行用词级时间；无 words 的行退化为整行高亮。
 */
export function LyricStage({
  lines,
  getTime,
  onSeek,
  variant = "panel",
  showTrans = true,
  showRoma = true,
  fontScale = 1,
  emptyText = "暂无歌词",
}: {
  lines: LyricLine[];
  getTime: () => number;
  onSeek: (time: number) => void;
  variant?: "panel" | "fullscreen";
  showTrans?: boolean;
  showRoma?: boolean;
  fontScale?: number;
  emptyText?: string;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  // 用户手动滚动后，暂停自动滚动一小段时间，避免和滚轮打架。
  const userScrollUntilRef = useRef(0);

  const times = useMemo(() => lines.map((line) => line.time), [lines]);

  useEffect(() => {
    let raf = 0;
    let lastIndex = -1;
    const tick = () => {
      const t = getTime();
      // 二分找当前行
      let lo = 0;
      let hi = times.length - 1;
      let idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid] <= t) {
          idx = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (idx !== lastIndex) {
        lastIndex = idx;
        setActiveIndex(idx);
      }
      // 当前行词级扫光：写 CSS 变量，不触发 React 重渲染
      const el = lineRefs.current[idx];
      if (el) {
        const line = lines[idx];
        let sweep = 1;
        if (line?.words && line.words.length > 0) {
          const first = line.words[0].start;
          const last = line.words[line.words.length - 1].end;
          const span = Math.max(0.001, last - first);
          sweep = Math.min(1, Math.max(0, (t - first) / span));
        } else if (line) {
          const end = line.end ?? times[idx + 1] ?? line.time + 4;
          const span = Math.max(0.001, end - line.time);
          sweep = Math.min(1, Math.max(0, (t - line.time) / span));
        }
        el.style.setProperty("--sweep", `${(sweep * 100).toFixed(2)}%`);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getTime, lines, times]);

  // 自动滚动当前行居中
  useLayoutEffect(() => {
    if (activeIndex < 0) return;
    if (Date.now() < userScrollUntilRef.current) return;
    const el = lineRefs.current[activeIndex];
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIndex]);

  if (lines.length === 0) {
    return (
      <div className="grid h-full place-items-center text-sm text-cream-faint">
        {emptyText}
      </div>
    );
  }

  return (
    <div
      ref={stageRef}
      className={`lyric-stage lyric-stage-${variant}`}
      style={{ "--lyric-scale": fontScale } as React.CSSProperties}
      onWheel={() => {
        userScrollUntilRef.current = Date.now() + 2400;
      }}
    >
      {lines.map((line, index) => {
        const active = index === activeIndex;
        return (
          <button
            key={`${line.time}:${index}`}
            type="button"
            ref={(node) => {
              lineRefs.current[index] = node;
            }}
            data-active={active}
            onClick={() => onSeek(line.time)}
            className={active ? "lyric-line is-active" : "lyric-line"}
          >
            <span className="lyric-line-main">
              {active && line.words && line.words.length > 0 ? (
                <span className="lyric-words">
                  <span className="lyric-words-base">{line.text}</span>
                  <span className="lyric-words-fill" aria-hidden>
                    {line.text}
                  </span>
                </span>
              ) : (
                <span>{line.text || line.trans || line.roma}</span>
              )}
            </span>
            {showRoma && line.roma && line.text && (
              <span className="lyric-line-roma">{line.roma}</span>
            )}
            {showTrans && line.trans && line.text && (
              <span className="lyric-line-trans">{line.trans}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
