import { useEffect, useState } from "react";

/**
 * 响应式视口 hook。
 * - Web 浏览器：按窗口宽度 768px 切桌面/移动
 * - Tauri 桌面（Windows/macOS/Linux）：始终走桌面布局，即使用户拖窄窗口
 * - Tauri 移动（iOS/Android）：始终走移动布局
 */
const DESKTOP_BREAKPOINT = 768;

const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const UA = typeof navigator !== "undefined" ? navigator.userAgent : "";
const IS_MOBILE_OS = /Android|iPhone|iPad|iPod/i.test(UA);
const IS_TAURI_DESKTOP = IS_TAURI && !IS_MOBILE_OS;
const IS_TAURI_MOBILE = IS_TAURI && IS_MOBILE_OS;

export interface Viewport {
  width: number;
  height: number;
  isDesktop: boolean;
}

function read(): Viewport {
  if (typeof window === "undefined") {
    return { width: 1024, height: 768, isDesktop: true };
  }
  const w = window.innerWidth;
  const h = window.innerHeight;
  let isDesktop: boolean;
  if (IS_TAURI_DESKTOP) isDesktop = true;
  else if (IS_TAURI_MOBILE) isDesktop = false;
  else isDesktop = w >= DESKTOP_BREAKPOINT;
  return { width: w, height: h, isDesktop };
}

export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(read);

  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setVp(read()));
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return vp;
}
