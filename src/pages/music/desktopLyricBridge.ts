import { isTauri } from "@/lib/proxy";
import type { LyricLine } from "./types";

/**
 * 桌面歌词窗口控制 + 推送（主窗口侧）。非 Tauri 环境全部 no-op。
 */
async function invokeSafe<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauri) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke(cmd, args)) as T;
  } catch (error) {
    console.warn(`[desktopLyric] ${cmd} failed`, error);
    return null;
  }
}

export function openDesktopLyric(): Promise<boolean | null> {
  return invokeSafe<boolean>("open_desktop_lyric");
}

export function closeDesktopLyric(): Promise<void> {
  return invokeSafe<void>("close_desktop_lyric").then(() => undefined);
}

export function isDesktopLyricOpen(): Promise<boolean> {
  return invokeSafe<boolean>("is_desktop_lyric_open").then((v) => !!v);
}

export interface DesktopLyricPush {
  text?: string;
  trans?: string;
  words?: Array<{ text: string; start: number; end: number }>;
  lineStart?: number;
  lineEnd?: number;
  time?: number;
  playing?: boolean;
}

/** 推送一整行（切行时调用）。 */
export function pushDesktopLyricLine(
  line: LyricLine | undefined,
  time: number,
  playing: boolean
): void {
  void invokeSafe("push_desktop_lyric", {
    payload: {
      text: line?.text ?? "",
      trans: line?.trans,
      words: line?.words,
      lineStart: line?.time,
      lineEnd: line?.end,
      time,
      playing,
    } satisfies DesktopLyricPush,
  });
}

/** 只推时间锚点（周期性 / 播放态变化时调用）。 */
export function pushDesktopLyricTime(time: number, playing: boolean): void {
  void invokeSafe("push_desktop_lyric", {
    payload: { time, playing } satisfies DesktopLyricPush,
  });
}
