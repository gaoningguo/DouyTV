import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { callResolvePlayUrl } from "@/source-script/runtime";
import type { ScriptDescriptor, ScriptEpisode } from "@/source-script/types";
import { getDownloadSettings } from "@/stores/downloadSettings";
import { getActiveProxyUrl } from "@/stores/proxy";
import { useVodAssetsStore, type DownloadTask } from "@/stores/vodAssets";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

interface VodDownloadProgressPayload {
  task_id: string;
  status: "downloading" | "paused" | "done" | "error";
  progress: number;
  downloaded: number;
  total?: number | null;
  path?: string | null;
  message?: string | null;
}

interface StartVodDownloadArgs {
  task: DownloadTask;
  script: ScriptDescriptor;
  episode: ScriptEpisode;
  sourceId: string;
}

let progressListenerReady = false;
let progressListenerPromise: Promise<void> | undefined;
const speedSamples = new Map<string, { bytes: number; at: number }>();
const inFlight = new Set<string>();
const queuedIds = new Set<string>();
const queue: Array<{
  args: StartVodDownloadArgs;
  resolve: () => void;
  reject: (error: unknown) => void;
}> = [];

function ensureProgressListener() {
  if (!isTauri || progressListenerReady) return Promise.resolve();
  if (progressListenerPromise) return progressListenerPromise;
  progressListenerPromise = listen<VodDownloadProgressPayload>(
    "vod-download-progress",
    (event) => {
      const payload = event.payload;
      if (!payload?.task_id) return;
      const now = Date.now();
      const prev = speedSamples.get(payload.task_id);
      const elapsed = prev ? Math.max(0, now - prev.at) : 0;
      const delta = prev ? Math.max(0, payload.downloaded - prev.bytes) : 0;
      const speed =
        payload.status === "downloading" && elapsed > 0
          ? (delta * 1000) / elapsed
          : 0;
      speedSamples.set(payload.task_id, { bytes: payload.downloaded, at: now });
      if (payload.status === "done" || payload.status === "error" || payload.status === "paused") {
        speedSamples.delete(payload.task_id);
      }
      useVodAssetsStore.getState().updateDownloadTask(payload.task_id, {
        status: payload.status,
        progress: payload.progress,
        downloadedBytes: payload.downloaded,
        totalBytes: payload.total ?? undefined,
        speedBytesPerSec: speed,
        localPath: payload.path ?? undefined,
        message: payload.message ?? undefined,
      });
    }
  ).then(() => {
    progressListenerReady = true;
  });
  return progressListenerPromise;
}

function detectStreamType(
  resolvedType: string | undefined,
  url: string
): "auto" | "mp4" | "hls" | "dash" | "flv" {
  if (
    resolvedType === "mp4" ||
    resolvedType === "hls" ||
    resolvedType === "dash" ||
    resolvedType === "flv"
  ) {
    return resolvedType;
  }
  const lower = url.toLowerCase();
  if (lower.includes(".m3u8") || lower.includes(".m3u?")) return "hls";
  if (lower.includes(".flv")) return "flv";
  if (lower.includes(".mpd")) return "dash";
  if (lower.includes(".mp4") || lower.includes(".m4v")) return "mp4";
  return "auto";
}

function pumpDownloadQueue() {
  const { concurrency } = getDownloadSettings();
  while (inFlight.size < concurrency && queue.length > 0) {
    const item = queue.shift()!;
    queuedIds.delete(item.args.task.id);
    void runVodDownload(item.args).then(item.resolve, item.reject).finally(() => {
      pumpDownloadQueue();
    });
  }
}

export function startVodDownload(args: StartVodDownloadArgs): Promise<void> {
  const taskId = args.task.id;
  if (inFlight.has(taskId) || queuedIds.has(taskId)) return Promise.resolve();
  useVodAssetsStore.getState().updateDownloadTask(taskId, {
    status: "queued",
    message: "等待下载",
  });
  return new Promise((resolve, reject) => {
    queuedIds.add(taskId);
    queue.push({ args, resolve, reject });
    pumpDownloadQueue();
  });
}

async function runVodDownload({
  task,
  script,
  episode,
  sourceId,
}: StartVodDownloadArgs): Promise<void> {
  if (inFlight.has(task.id)) return;
  inFlight.add(task.id);
  const store = useVodAssetsStore.getState();

  if (!isTauri) {
    store.updateDownloadTask(task.id, {
      status: "error",
      progress: 0,
      message: "浏览器预览环境不支持离线下载，请在 Tauri 应用中使用。",
    });
    inFlight.delete(task.id);
    return;
  }

  await ensureProgressListener();
  store.updateDownloadTask(task.id, {
    status: "downloading",
    progress: 0,
    message: "解析播放地址中",
  });

  try {
    const playUrl = typeof episode === "string" ? episode : episode.playUrl;
    const needResolve =
      typeof episode === "string" ? true : episode.needResolve !== false;
    const resolved = needResolve
      ? await callResolvePlayUrl(script, {
          playUrl,
          sourceId,
          episodeIndex: task.episodeIndex,
        })
      : { url: playUrl, type: "auto" as const, headers: {} };
    const streamType = detectStreamType(resolved.type, resolved.url);
    const headers = resolved.headers ?? {};
    const { downloadDir } = getDownloadSettings();

    store.updateDownloadTask(task.id, {
      url: resolved.url,
      streamType,
      headers,
      status: "downloading",
      progress: 1,
      message: "开始下载",
    });

    await invoke("vod_download_media", {
      req: {
        task_id: task.id,
        url: resolved.url,
        stream_type: streamType,
        headers,
        title: task.title,
        episode_title: task.episodeTitle,
        download_dir: downloadDir || null,
        proxy_url: getActiveProxyUrl() ?? null,
      },
    });
  } catch (e) {
    const message = (e as Error)?.message ?? String(e);
    if (message.includes("DOWNLOAD_PAUSED")) {
      store.updateDownloadTask(task.id, {
        status: "paused",
        message: "已暂停",
      });
      return;
    }
    store.updateDownloadTask(task.id, {
      status: "error",
      progress: 0,
      message,
    });
  } finally {
    inFlight.delete(task.id);
  }
}

export async function pauseVodDownload(taskId: string): Promise<void> {
  const queuedIndex = queue.findIndex((item) => item.args.task.id === taskId);
  if (queuedIndex >= 0) {
    const [item] = queue.splice(queuedIndex, 1);
    queuedIds.delete(taskId);
    item.resolve();
  }
  useVodAssetsStore.getState().updateDownloadTask(taskId, {
    status: "paused",
    message: "已暂停",
    speedBytesPerSec: 0,
  });
  if (isTauri) {
    await invoke("vod_set_download_paused", {
      taskId,
      paused: true,
    });
  }
}

export async function resumeVodDownload(taskId: string): Promise<void> {
  if (isTauri) {
    await invoke("vod_set_download_paused", {
      taskId,
      paused: false,
    });
  }
}

export async function openVodDownloadPath(path: string, reveal = false): Promise<void> {
  if (!isTauri) {
    throw new Error("浏览器预览环境不支持打开本地下载文件。");
  }
  await invoke("open_vod_download_path", {
    path,
    reveal,
  });
}
