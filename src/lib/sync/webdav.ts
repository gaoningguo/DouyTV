/**
 * 最小 WebDAV 客户端 —— 走 scriptFetch（Tauri ureq）以绕开 WebView CORS。
 *
 * 支持：
 *  - PUT / GET 单文件
 *  - MKCOL 建集合（目录）
 *  - HEAD 探活 + 触发 401 验证认证
 *
 * 不支持的 OPTIONS / PROPFIND 等 MVP 不需要。
 */
import { scriptFetch } from "@/source-script/fetch";

export interface WebDAVConfig {
  baseUrl: string; // 例如 https://example.com/dav/douytv —— 末尾可不带 /
  username: string;
  password: string;
}

function authHeader(c: WebDAVConfig): Record<string, string> {
  if (!c.username && !c.password) return {};
  const token = btoa(`${c.username}:${c.password}`);
  return { Authorization: `Basic ${token}` };
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = path.replace(/^\/+/, "");
  return `${b}/${p}`;
}

export interface UploadResult {
  ok: boolean;
  status: number;
  message?: string;
}

export async function putFile(
  cfg: WebDAVConfig,
  path: string,
  body: string,
  contentType = "application/json"
): Promise<UploadResult> {
  const url = joinUrl(cfg.baseUrl, path);
  try {
    const res = await scriptFetch(url, {
      method: "PUT",
      headers: { ...authHeader(cfg), "Content-Type": contentType },
      body,
      timeout: 30_000,
    });
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
    return { ok: false, status: res.status, message: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, message: (e as Error).message ?? String(e) };
  }
}

export interface DownloadResult {
  ok: boolean;
  status: number;
  body?: string;
  message?: string;
}

export async function getFile(
  cfg: WebDAVConfig,
  path: string
): Promise<DownloadResult> {
  const url = joinUrl(cfg.baseUrl, path);
  try {
    const res = await scriptFetch(url, {
      method: "GET",
      headers: authHeader(cfg),
      timeout: 30_000,
    });
    if (res.status >= 200 && res.status < 300) {
      const body = await res.text();
      return { ok: true, status: res.status, body };
    }
    return { ok: false, status: res.status, message: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, message: (e as Error).message ?? String(e) };
  }
}

export async function ensureCollection(
  cfg: WebDAVConfig,
  path: string
): Promise<UploadResult> {
  // 标准 WebDAV MKCOL 创建集合；已存在返回 405，视为成功
  const url = joinUrl(cfg.baseUrl, path);
  try {
    const res = await scriptFetch(url, {
      method: "MKCOL",
      headers: authHeader(cfg),
      timeout: 15_000,
    });
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
    if (res.status === 405) return { ok: true, status: 405 }; // 已存在
    return { ok: false, status: res.status, message: `MKCOL HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, message: (e as Error).message ?? String(e) };
  }
}

export async function testConnection(
  cfg: WebDAVConfig
): Promise<{ ok: boolean; status: number; message?: string }> {
  // 用 PROPFIND depth:0 触发认证，绝大多数 WebDAV 实现都支持
  const url = joinUrl(cfg.baseUrl, "");
  try {
    const res = await scriptFetch(url, {
      method: "PROPFIND",
      headers: { ...authHeader(cfg), Depth: "0" },
      timeout: 15_000,
    });
    if (res.status === 207 || (res.status >= 200 && res.status < 300)) {
      return { ok: true, status: res.status };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, message: "认证失败" };
    }
    if (res.status === 404) {
      return { ok: false, status: 404, message: "路径不存在" };
    }
    return { ok: false, status: res.status, message: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, message: (e as Error).message ?? String(e) };
  }
}
