/**
 * 弹幕 API base 解析。
 *
 * MoonTV 的 danmu_api 协议：
 *   - 内置共享源 BUILTIN：https://mtvpls-danmu.netlify.app/87654321
 *   - 自定义源：用户填 apiBase + token，最终拼成 `${apiBase}/${token}` 作为请求根
 *   - 当 token === BUILTIN_TOKEN 时省略 token 段，避免双重 token
 */
import type { DanmakuSourceType } from "./types";

export const BUILTIN_DANMAKU_API_BASE = "https://mtvpls-danmu.netlify.app/87654321";
export const BUILTIN_DANMAKU_API_TOKEN = "87654321";

function trimTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

export interface DanmakuConfig {
  sourceType: DanmakuSourceType;
  apiBase?: string;
  token?: string;
}

export function getDanmakuApiBaseUrl(cfg: DanmakuConfig): string {
  if (cfg.sourceType === "builtin") return BUILTIN_DANMAKU_API_BASE;
  const base = trimTrailingSlash(cfg.apiBase || "http://localhost:9321");
  const token = (cfg.token || BUILTIN_DANMAKU_API_TOKEN).trim();
  return token === BUILTIN_DANMAKU_API_TOKEN ? base : `${base}/${token}`;
}
