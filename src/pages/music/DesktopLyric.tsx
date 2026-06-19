import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  IconClose,
  IconLock,
  IconLockOpen,
  IconPause,
  IconPlay,
  IconSkipBackward,
  IconSkipForward,
} from "@/components/Icon";

/**
 * 桌面歌词独立窗口页（路由 /music/desktop-lyric，在专属透明 Tauri 窗口里渲染）。
 *
 * 关键设计（对照 CyreneMusic 踩坑修正）：
 *  - 透明背景：除 Rust 端 transparent + background_color 外，前端必须在
 *    useLayoutEffect 里把 html/body/整条父链的背景强制清成 transparent，
 *    否则会继承全局 styles.css 的不透明 --ink 底色 + CRT 扫描线背景图。
 *  - 后台时钟：透明置顶窗口长期失焦，浏览器会冻结 requestAnimationFrame，
 *    所以用 setInterval(1000/60) + 强制 setState 驱动扫光，规避节流。
 *  - 启动同步：窗口起得比主窗口推送晚，mount 后 emit("desktop-lyric-ready")
 *    让主窗口立即补发一次当前行 + 时间锚点。
 */
interface LyricWordPayload {
  text: string;
  start: number;
  end: number;
}

interface DesktopLyricPayload {
  text?: string;
  trans?: string;
  words?: LyricWordPayload[];
  lineStart?: number;
  lineEnd?: number;
  time?: number;
  playing?: boolean;
}

export function DesktopLyric() {
  const rootRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const [line, setLine] = useState<DesktopLyricPayload>({});
  const [hovered, setHovered] = useState(false);
  const [locked, setLocked] = useState(false);
  const [, setTick] = useState(0);

  const anchorRef = useRef<{ time: number; at: number; playing: boolean }>({
    time: 0,
    at: Date.now(),
    playing: false,
  });
  const lineRef = useRef<DesktopLyricPayload>({});

  // 1) 暴力清透明背景（含父链）。
  useLayoutEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const saved: Array<{ el: HTMLElement; bg: string; bgc: string }> = [];
    const clear = (el: HTMLElement) => {
      saved.push({ el, bg: el.style.background, bgc: el.style.backgroundColor });
      el.style.background = "transparent";
      el.style.backgroundColor = "transparent";
    };
    clear(html);
    clear(body);
    body.style.overflow = "hidden";
    let parent = rootRef.current?.parentElement ?? null;
    while (parent && parent !== body) {
      clear(parent);
      parent = parent.parentElement;
    }
    return () => {
      for (const s of saved) {
        s.el.style.background = s.bg;
        s.el.style.backgroundColor = s.bgc;
      }
    };
  }, []);

  // 2) 监听主窗口推送 + mount 时请求全量同步。
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    (async () => {
      try {
        const { listen, emit } = await import("@tauri-apps/api/event");
        unlisten = await listen<DesktopLyricPayload>("desktop-lyric", (event) => {
          const p = event.payload || {};
          anchorRef.current = {
            time: typeof p.time === "number" ? p.time : anchorRef.current.time,
            at: Date.now(),
            playing: !!p.playing,
          };
          if (typeof p.text === "string" || p.words) {
            lineRef.current = p;
            setLine(p);
          }
        });
        if (!disposed) await emit("desktop-lyric-ready", {});
      } catch {
        // 非 Tauri 环境忽略。
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // 3) setInterval 60fps 本地插值扫光（规避后台 RAF 冻结）。
  useEffect(() => {
    const timer = window.setInterval(() => {
      const { time, at, playing } = anchorRef.current;
      const now = playing ? time + (Date.now() - at) / 1000 : time;
      const current = lineRef.current;
      const fill = fillRef.current;
      if (fill) {
        let sweep = 0;
        if (current.words && current.words.length > 0) {
          const first = current.words[0].start;
          const last = current.words[current.words.length - 1].end;
          const span = Math.max(0.001, last - first);
          sweep = Math.min(1, Math.max(0, (now - first) / span));
        } else if (current.lineStart !== undefined) {
          const end = current.lineEnd ?? current.lineStart + 4;
          const span = Math.max(0.001, end - current.lineStart);
          sweep = Math.min(1, Math.max(0, (now - current.lineStart) / span));
        }
        fill.style.clipPath = `inset(0 ${(100 - sweep * 100).toFixed(2)}% 0 0)`;
      }
      // 续命：强制 React 重渲染（后台窗口否则被冻结）。
      setTick((v) => (v + 1) % 1000000);
    }, 1000 / 60);
    return () => window.clearInterval(timer);
  }, []);

  const command = async (cmd: string) => {
    try {
      const { emit } = await import("@tauri-apps/api/event");
      await emit("desktop-lyric-command", cmd);
    } catch {
      /* ignore */
    }
  };

  const closeWindow = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch {
      /* ignore */
    }
  };

  const toggleLock = async () => {
    const next = !locked;
    setLocked(next);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_desktop_lyric_passthrough", { ignore: next });
    } catch {
      /* ignore */
    }
  };

  const text = line.text || "♪ DouyTV Music ♪";
  const playing = anchorRef.current.playing;

  return (
    <div
      ref={rootRef}
      className="desktop-lyric-root"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="desktop-lyric-drag" data-tauri-drag-region={!locked || undefined} />
      <div className="desktop-lyric-line">
        <span className="desktop-lyric-base">{text}</span>
        <span ref={fillRef} className="desktop-lyric-fill" aria-hidden>
          {text}
        </span>
      </div>
      {line.trans && <div className="desktop-lyric-trans">{line.trans}</div>}

      {/* 悬浮控制条：hover 才显示。锁定后整窗鼠标穿透，无法 hover，故锁定按钮放在解锁路径里 */}
      <div className={hovered ? "desktop-lyric-bar is-show" : "desktop-lyric-bar"}>
        <button type="button" onClick={() => void command("prev")} title="上一首">
          <IconSkipBackward size={18} />
        </button>
        <button type="button" onClick={() => void command("toggle")} title="播放/暂停">
          {playing ? <IconPause size={18} /> : <IconPlay size={18} />}
        </button>
        <button type="button" onClick={() => void command("next")} title="下一首">
          <IconSkipForward size={18} />
        </button>
        <button
          type="button"
          onClick={() => void toggleLock()}
          title={locked ? "解锁" : "锁定（鼠标穿透）"}
        >
          {locked ? <IconLockOpen size={16} /> : <IconLock size={16} />}
        </button>
        <button type="button" onClick={() => void closeWindow()} title="关闭">
          <IconClose size={16} />
        </button>
      </div>
    </div>
  );
}
