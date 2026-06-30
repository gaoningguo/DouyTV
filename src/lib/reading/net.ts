import { invoke } from "@tauri-apps/api/core";
import { scriptFetch } from "@/source-script/fetch";
import { getActiveProxyUrl } from "@/stores/proxy";
import type { ScriptFetchInit } from "@/source-script/types";

/**
 * 阅读模块(漫画 / 小说)共用的网络层。
 *
 * 与视频源不同,小说源(尤其国内 Legado 书源)大量返回 GBK/GB18030 编码的页面,
 * `script_http` 走 `read_to_string` 做 UTF-8 lossy 解码会把正文糊成乱码;epub 这类
 * 二进制也无法承载。所以这里用 Rust 端 `script_http_bytes` 拿原始字节(base64),
 * 在前端按 content-type 里的 charset 用 TextDecoder 解码 —— 浏览器/WebView 原生
 * 支持 gbk / gb18030 / big5 等中文编码。
 *
 * 非 Tauri(浏览器 dev)环境降级走 scriptFetch(原生 fetch,受 CORS 限制,仅供迭代)。
 */

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface ReadingFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  timeout?: number;
  /** 显式字符集(优先于响应头嗅探),Legado 书源 ,{charset:"gbk"} 用。 */
  charset?: string;
  proxyOverride?: string | null;
}

export interface ReadingBytesResponse {
  url: string;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  bytes: Uint8Array;
}

export interface ReadingTextResponse {
  url: string;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  text: string;
}

interface RustBytesResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  body_base64: string;
}

function appendQuery(
  url: string,
  query?: Record<string, string | number | boolean | undefined | null>
): string {
  if (!query) return url;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    sp.append(k, String(v));
  }
  const qs = sp.toString();
  if (!qs) return url;
  return url + (url.includes("?") ? "&" : "?") + qs;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const len = bin.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function lowerHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase()] = v;
  return out;
}

/** 从 content-type 里嗅探 charset,缺省返回 undefined。 */
function sniffCharset(contentType?: string): string | undefined {
  if (!contentType) return undefined;
  const m = contentType.match(/charset=["']?([^;"'\s]+)/i);
  return m?.[1]?.trim().toLowerCase();
}

/** 从 HTML <meta charset> / <meta http-equiv> 嗅探(响应头没给时的兜底)。 */
function sniffCharsetFromHtml(bytes: Uint8Array): string | undefined {
  // 只看前 1024 字节的 ASCII 近似,meta 标签一定在 <head> 靠前
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  const m =
    head.match(/<meta[^>]+charset=["']?([\w-]+)/i) ||
    head.match(/charset=["']?([\w-]+)/i);
  return m?.[1]?.trim().toLowerCase();
}

/** 归一 charset 名,把常见别名映射到 TextDecoder 认得的标签。 */
function normalizeCharset(charset?: string): string {
  const c = (charset || "").trim().toLowerCase();
  if (!c) return "utf-8";
  if (c === "gbk" || c === "gb2312" || c === "gb-2312") return "gb18030";
  if (c === "utf8") return "utf-8";
  return c;
}

function decodeBytes(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(normalizeCharset(charset)).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function resolveProxy(init: ReadingFetchInit): string | null {
  if (init.proxyOverride === null) return null;
  return init.proxyOverride ?? getActiveProxyUrl() ?? null;
}

/** 拿原始字节(base64 over IPC)。epub/图片/需要按 charset 解码的页面都走它。 */
export async function readingFetchBytes(
  url: string,
  init: ReadingFetchInit = {}
): Promise<ReadingBytesResponse> {
  const finalUrl = appendQuery(url, init.query);
  if (!isTauri) {
    const res = await scriptFetch(finalUrl, toScriptInit(init));
    const bytes = await res.bytes();
    return {
      url: res.url || finalUrl,
      status: res.status,
      ok: res.ok,
      headers: res.headers,
      bytes,
    };
  }
  const method = init.method ?? (init.body ? "POST" : "GET");
  const raw = await invoke<RustBytesResponse>("script_http_bytes", {
    req: {
      url: finalUrl,
      method,
      headers: init.headers ?? {},
      body: init.body ?? null,
      timeout_ms: init.timeout ?? null,
      proxy_url: resolveProxy(init),
    },
  });
  return {
    url: raw.url,
    status: raw.status,
    ok: raw.status >= 200 && raw.status < 300,
    headers: lowerHeaders(raw.headers),
    bytes: base64ToBytes(raw.body_base64),
  };
}

/** 拿文本,自动按 charset 解码(显式 > 响应头 > HTML meta > utf-8)。 */
export async function readingFetchText(
  url: string,
  init: ReadingFetchInit = {}
): Promise<ReadingTextResponse> {
  const res = await readingFetchBytes(url, init);
  const headerCharset = sniffCharset(res.headers["content-type"]);
  const charset =
    init.charset ||
    headerCharset ||
    sniffCharsetFromHtml(res.bytes) ||
    "utf-8";
  return {
    url: res.url,
    status: res.status,
    ok: res.ok,
    headers: res.headers,
    text: decodeBytes(res.bytes, charset),
  };
}

function toScriptInit(init: ReadingFetchInit): ScriptFetchInit {
  return {
    method: init.method,
    headers: init.headers,
    body: init.body,
    query: init.query,
    timeout: init.timeout,
    proxyOverride: init.proxyOverride,
  };
}

export { isTauri as isTauriReading };
