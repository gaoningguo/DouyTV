import { isLikelyShortPreviewDuration } from "./types";

/** 解析结果只是试听片段时抛出，调用方可据此区分「试听」与「真正失败」。 */
export class MusicPreviewError extends Error {
  readonly preview = true;
  constructor(message = "当前解析源只返回试听片段，已跳过") {
    super(message);
    this.name = "MusicPreviewError";
  }
}

export function isMusicPreviewError(error: unknown): boolean {
  return (
    error instanceof MusicPreviewError ||
    (typeof error === "object" && error !== null && (error as { preview?: boolean }).preview === true)
  );
}

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
        fail(new MusicPreviewError());
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
