/**
 * 跨平台运行环境检测。
 * - isTauri: 是否在 Tauri webview 内（vs 纯浏览器 dev）
 * - isMobile: Android / iOS（仅在 Tauri 下识别）
 * - isDesktop: Windows / macOS / Linux 桌面 Tauri
 *
 * 在 Tauri 下读 navigator.userAgent + __TAURI_INTERNALS__；纯浏览器
 * dev 时 isTauri = false。
 */

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function ua(): string {
  if (typeof navigator === "undefined") return "";
  return navigator.userAgent || "";
}

export function isAndroid(): boolean {
  return /Android/i.test(ua());
}

export function isIOS(): boolean {
  // iPadOS 13+ 上的 Safari UA 不再包含 iPad —— 但 Tauri WebKit 仍然带 iPad/iPhone/iPod
  return /iPad|iPhone|iPod/i.test(ua());
}

export function isMobile(): boolean {
  return isAndroid() || isIOS();
}

export function isDesktop(): boolean {
  return isTauri() && !isMobile();
}
