/**
 * 浏览器内对本地/远程视频抽取首帧作为缩略图。
 * 使用：HTMLVideoElement 元素加载 + currentTime seek + canvas drawImage。
 * 注意：在 Tauri 中 convertFileSrc 转换的 URL 可直接被 video 标签加载，无 CORS 问题。
 */
const MAX_W = 320;
const SEEK_RATIO = 0.18;
const SEEK_MIN = 1.5;
const SEEK_MAX = 8;
const LOAD_TIMEOUT_MS = 8000;
const SEEK_TIMEOUT_MS = 4000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

export async function captureFirstFrame(url: string): Promise<string> {
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.preload = "metadata";
  video.playsInline = true;
  video.crossOrigin = "anonymous";

  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        const onLoad = () => {
          cleanup();
          resolve();
        };
        const onErr = () => {
          cleanup();
          reject(new Error("video load failed"));
        };
        const cleanup = () => {
          video.removeEventListener("loadedmetadata", onLoad);
          video.removeEventListener("error", onErr);
        };
        video.addEventListener("loadedmetadata", onLoad);
        video.addEventListener("error", onErr);
      }),
      LOAD_TIMEOUT_MS,
      "metadata"
    );

    const duration = isFinite(video.duration) ? video.duration : SEEK_MIN;
    const targetTime = Math.min(
      SEEK_MAX,
      Math.max(SEEK_MIN, duration * SEEK_RATIO)
    );
    video.currentTime = targetTime;

    await withTimeout(
      new Promise<void>((resolve, reject) => {
        const onSeek = () => {
          cleanup();
          resolve();
        };
        const onErr = () => {
          cleanup();
          reject(new Error("seek failed"));
        };
        const cleanup = () => {
          video.removeEventListener("seeked", onSeek);
          video.removeEventListener("error", onErr);
        };
        video.addEventListener("seeked", onSeek);
        video.addEventListener("error", onErr);
      }),
      SEEK_TIMEOUT_MS,
      "seek"
    );

    const vw = video.videoWidth || 320;
    const vh = video.videoHeight || 180;
    const w = Math.min(MAX_W, vw);
    const h = Math.round((w * vh) / vw);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas context unavailable");
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.7);
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}

/**
 * 并发限流的批量缩略图生成器。
 */
export class ThumbnailQueue {
  private inFlight = 0;
  private queue: Array<() => Promise<void>> = [];

  constructor(private readonly concurrency = 2) {}

  enqueue(task: () => Promise<void>) {
    this.queue.push(task);
    this.drain();
  }

  cancel() {
    this.queue = [];
  }

  private drain() {
    while (this.inFlight < this.concurrency && this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.inFlight++;
      task().finally(() => {
        this.inFlight--;
        this.drain();
      });
    }
  }
}

/** sessionStorage 内缓存（key = url），避免同一会话内重复抽帧。 */
const SESSION_PREFIX = "douytv:thumb:";

export function readCachedThumb(url: string): string | undefined {
  try {
    return sessionStorage.getItem(SESSION_PREFIX + url) ?? undefined;
  } catch {
    return undefined;
  }
}

export function writeCachedThumb(url: string, dataUrl: string) {
  try {
    sessionStorage.setItem(SESSION_PREFIX + url, dataUrl);
  } catch {
    /* quota exceeded — ignore */
  }
}
