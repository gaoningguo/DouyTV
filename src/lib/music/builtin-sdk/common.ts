// @ts-nocheck
/**
 * 共享工具 —— 移植自 lx-music musicSdk/index.js 中导出的辅助函数。
 */

export const formatPlayTime = (time: number): string => {
  if (!time || !Number.isFinite(time)) return "0:00";
  const m = Math.floor(time / 60);
  const s = Math.floor(time % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

export const sizeFormate = (size: number): string => {
  if (!size) return "0B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = size;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(2)} ${units[i]}`;
};

/** 解码 HTML 实体名 — lx-music 用于解码歌手名带 &amp; 的情况 */
export const decodeName = (str: unknown): string => {
  if (typeof str !== "string") return String(str ?? "");
  const NAMED: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
  };
  return str
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(+code))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&[a-z]+;/g, (m) => NAMED[m] ?? m);
};

/** dummy — lx-music 用 dns 模块做 GFW 绕过，我们走 Tauri ureq + 代理不需要 */
export const dnsLookup = () => undefined;

/** 我们不算 MD5（仅 KW/KG 用到的简单签名），导出 noop；调用方需自行 fallback */
export const toMD5 = (s: string): string => s;
