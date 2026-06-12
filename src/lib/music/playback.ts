import { isLikelyShortPreviewDuration } from "./types";

export async function waitForUsableMusicAudio(
  audio: HTMLAudioElement,
  expectedDuration?: number,
  timeoutMs = 4500
): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: number | undefined;

    const cleanup = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      audio.removeEventListener("loadedmetadata", check);
      audio.removeEventListener("durationchange", check);
      audio.removeEventListener("error", onError);
    };

    const finish = (duration?: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(duration);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const readDuration = () =>
      Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : undefined;

    function check() {
      const duration = readDuration();
      if (isLikelyShortPreviewDuration(duration, expectedDuration)) {
        fail(new Error("当前解析源只返回试听片段，已跳过"));
        return;
      }
      if (duration || audio.readyState >= 1) finish(duration);
    }

    function onError() {
      fail(new Error("音频加载失败"));
    }

    audio.addEventListener("loadedmetadata", check);
    audio.addEventListener("durationchange", check);
    audio.addEventListener("error", onError);
    timer = window.setTimeout(() => finish(readDuration()), timeoutMs);
    check();
  });
}
