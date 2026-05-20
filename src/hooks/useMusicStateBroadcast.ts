/**
 * 桌面歌词广播 — 把当前歌曲 + 位置广播给 lyric 副窗口。
 *
 * 由 App.tsx 在桌面端挂载一次。订阅 useMusicStore，按需 emit `music-state`。
 *
 * **仅在主窗口运行**：副窗口 (label="lyric") 自己监听 event，不再次发出。
 */
import { useEffect, useRef } from "react";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useMusicStore } from "@/stores/music";
import { fetchLyrics } from "@/lib/music/api";
import { isDesktop, isTauri } from "@/lib/platform";

interface MusicState {
  name: string;
  artist: string;
  lrc: string;
  positionSec: number;
  paused: boolean;
}

function isMainWindow(): boolean {
  if (!isTauri()) return false;
  try {
    return getCurrentWindow().label === "main";
  } catch {
    return false;
  }
}

export function useMusicStateBroadcast() {
  const current = useMusicStore((s) => s.current);
  const positionSec = useMusicStore((s) => s.positionSec);
  const paused = useMusicStore((s) => s.paused);
  const lrcRef = useRef<{ key: string; text: string } | null>(null);
  const lastEmitRef = useRef(0);

  // 切歌时拉歌词（独立歌词窗口只显示原文）
  useEffect(() => {
    if (!isDesktop() || !isMainWindow() || !current) {
      lrcRef.current = null;
      return;
    }
    const key = `${current.source}-${current.songId}`;
    if (lrcRef.current?.key === key) return;
    let cancelled = false;
    void (async () => {
      try {
        const raw = await fetchLyrics(current);
        if (!cancelled) lrcRef.current = { key, text: raw };
      } catch {
        if (!cancelled) lrcRef.current = { key, text: "" };
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [current]);

  // 节流广播
  useEffect(() => {
    if (!isDesktop() || !isMainWindow()) return;
    const now = Date.now();
    if (now - lastEmitRef.current < 200) return;
    lastEmitRef.current = now;
    const payload: MusicState = {
      name: current?.name ?? "",
      artist: current?.artist ?? "",
      lrc: lrcRef.current?.text ?? "",
      positionSec,
      paused,
    };
    void emit("music-state", payload).catch(() => null);
  }, [current, positionSec, paused]);
}
