/**
 * 独立歌词窗口 — Tauri secondary window 内运行。
 *
 * 主窗口通过 `music-state` event 广播：
 *   { name, artist, lrc, positionSec, paused }
 *
 * 本窗口只渲染：当前行 + 上一行 / 下一行（轻量），点击可关闭。
 * 因为是 transparent + 无边框，整窗为 CRT 渐变背景。
 */
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { parseLyrics } from "@/lib/music/api";
import { IconClose } from "@/components/Icon";

interface MusicState {
  name: string;
  artist: string;
  lrc: string;
  positionSec: number;
  paused: boolean;
}

const EMPTY: MusicState = { name: "", artist: "", lrc: "", positionSec: 0, paused: true };

export default function MusicDesktopLyric() {
  const [state, setState] = useState<MusicState>(EMPTY);
  const [lines, setLines] = useState<Array<{ time: number; text: string }>>([]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void (async () => {
      unlisten = await listen<MusicState>("music-state", (e) => {
        setState(e.payload);
      });
    })();
    return () => {
      try {
        unlisten?.();
      } catch {
        /* ignore */
      }
    };
  }, []);

  useEffect(() => {
    setLines(parseLyrics(state.lrc));
  }, [state.lrc]);

  const activeIdx = (() => {
    if (lines.length === 0) return -1;
    let lo = 0,
      hi = lines.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lines[mid].time <= state.positionSec) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  })();

  const current = lines[activeIdx]?.text ?? state.name ?? "";
  const next = lines[activeIdx + 1]?.text ?? "";

  const close = () => {
    void invoke("close_lyric_window").catch(() => null);
  };

  return (
    <div
      className="w-screen h-screen flex flex-col items-center justify-center relative"
      data-tauri-drag-region
      style={{
        background:
          "linear-gradient(180deg, rgba(14,15,17,0.85) 0%, rgba(14,15,17,0.95) 100%)",
        borderRadius: 12,
        border: "1px solid var(--cream-line)",
        boxShadow: "0 12px 48px -16px rgba(0,0,0,0.6)",
      }}
    >
      <button
        type="button"
        onClick={close}
        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center tap text-cream-faint hover:text-cream"
        style={{
          background: "rgba(14,15,17,0.5)",
        }}
        aria-label="关闭歌词窗口"
      >
        <IconClose size={10} />
      </button>

      {state.name && (
        <p className="absolute top-1.5 left-3 font-mono text-[9px] tracking-[0.2em] text-cream-faint truncate max-w-[60%]">
          {state.name} · {state.artist || "—"}
        </p>
      )}

      <p
        className="text-center px-6 truncate w-full font-display"
        style={{
          color: "var(--ember)",
          textShadow: "0 0 12px var(--ember-glow)",
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: "0.01em",
        }}
      >
        {current || "—"}
      </p>
      {next && (
        <p
          className="text-center px-6 mt-1 truncate w-full text-cream-dim font-display"
          style={{ fontSize: 14 }}
        >
          {next}
        </p>
      )}
    </div>
  );
}
