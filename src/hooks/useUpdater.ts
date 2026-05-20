/**
 * 自动更新 hook —— Tauri-only。
 * 桌面端：tauri-plugin-updater 从 GH Releases 拉 latest.json + 签名校验
 * 移动端 / 浏览器 dev：noop，状态留 idle
 *
 * 暴露：
 *   - status: idle | checking | up-to-date | available | downloading | installed | error
 *   - latest: Available 时的版本号 / 发布说明
 *   - check(): 主动触发检查
 *   - downloadAndInstall(): 下载+安装，安装完成后调用 relaunch
 */
import { useCallback, useEffect, useState } from "react";
import { isTauri, isMobile } from "@/lib/platform";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "installed"
  | "error";

export interface UpdateInfo {
  version: string;
  date?: string;
  body?: string;
}

export interface UpdaterState {
  status: UpdateStatus;
  available: UpdateInfo | null;
  progress: number; // 0-1
  error: string | null;
}

function isDesktopTauri(): boolean {
  return isTauri() && !isMobile();
}

export function useUpdater(autoCheckOnMount = false) {
  const [state, setState] = useState<UpdaterState>({
    status: "idle",
    available: null,
    progress: 0,
    error: null,
  });

  const check = useCallback(async () => {
    if (!isDesktopTauri()) {
      setState({
        status: "up-to-date",
        available: null,
        progress: 0,
        error: null,
      });
      return null;
    }
    setState((s) => ({ ...s, status: "checking", error: null }));
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const upd = await check();
      if (!upd) {
        setState({
          status: "up-to-date",
          available: null,
          progress: 0,
          error: null,
        });
        return null;
      }
      setState({
        status: "available",
        available: { version: upd.version, date: upd.date, body: upd.body },
        progress: 0,
        error: null,
      });
      return upd;
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      setState({
        status: "error",
        available: null,
        progress: 0,
        error: msg,
      });
      return null;
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (!isDesktopTauri()) return;
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const upd = await check();
      if (!upd) {
        setState((s) => ({ ...s, status: "up-to-date" }));
        return;
      }
      setState((s) => ({ ...s, status: "downloading", progress: 0 }));
      let total = 0;
      let downloaded = 0;
      await upd.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (total > 0) {
              setState((s) => ({ ...s, progress: downloaded / total }));
            }
            break;
          case "Finished":
            setState((s) => ({ ...s, status: "installed", progress: 1 }));
            break;
        }
      });
      // 安装完成 → 重启
      const { relaunch } = await import("@tauri-apps/plugin-process").catch(
        () => ({ relaunch: async () => {} })
      );
      await relaunch();
    } catch (e) {
      setState({
        status: "error",
        available: null,
        progress: 0,
        error: (e as Error).message ?? String(e),
      });
    }
  }, []);

  useEffect(() => {
    if (autoCheckOnMount) {
      void check();
    }
  }, [autoCheckOnMount, check]);

  return { state, check, downloadAndInstall };
}
