import { invoke } from "@tauri-apps/api/core";
import type { ScriptFetchInit, ScriptFetchResponse } from "./types";
import { getActiveProxyUrl } from "@/stores/proxy";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

interface RustHttpResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
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

function buildBody(init: ScriptFetchInit): {
  bodyStr: string | null;
  headers: Record<string, string>;
} {
  const headers = { ...(init.headers ?? {}) };
  let bodyStr: string | null = null;
  if (init.json !== undefined) {
    bodyStr = JSON.stringify(init.json);
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json";
    }
  } else if (typeof init.body === "string") {
    bodyStr = init.body;
  } else if (init.body instanceof Uint8Array) {
    bodyStr = new TextDecoder().decode(init.body);
  }
  return { bodyStr, headers };
}

function makeResponse(
  url: string,
  status: number,
  headers: Record<string, string>,
  body: string
): ScriptFetchResponse {
  return {
    url,
    status,
    headers,
    ok: status >= 200 && status < 300,
    text: async () => body,
    json: async <T = unknown>() => JSON.parse(body) as T,
    bytes: async () => new TextEncoder().encode(body),
  };
}

async function tauriFetch(
  url: string,
  init: ScriptFetchInit
): Promise<ScriptFetchResponse> {
  const finalUrl = appendQuery(url, init.query);
  const { bodyStr, headers } = buildBody(init);
  const method = init.method ?? (bodyStr !== null ? "POST" : "GET");
  const proxyUrl = getActiveProxyUrl();

  const res = await invoke<RustHttpResponse>("script_http", {
    req: {
      url: finalUrl,
      method,
      headers,
      body: bodyStr,
      timeout_ms: init.timeout ?? null,
      proxy_url: proxyUrl ?? null,
    },
  });

  const lowered: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers)) lowered[k.toLowerCase()] = v;
  return makeResponse(res.url, res.status, lowered, res.body);
}

async function browserFetch(
  url: string,
  init: ScriptFetchInit
): Promise<ScriptFetchResponse> {
  const finalUrl = appendQuery(url, init.query);
  const { bodyStr, headers } = buildBody(init);
  const method = init.method ?? (bodyStr !== null ? "POST" : "GET");

  const signal = init.timeout ? AbortSignal.timeout(init.timeout) : undefined;
  const res = await fetch(finalUrl, {
    method,
    headers,
    body: bodyStr ?? undefined,
    signal,
  });

  const responseHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    responseHeaders[k.toLowerCase()] = v;
  });
  const body = await res.text();
  return makeResponse(res.url || finalUrl, res.status, responseHeaders, body);
}

/**
 * 脚本中调用的 fetch 入口。
 * - 在 Tauri 环境走自定义 `script_http` invoke 命令（Rust 端用 ureq，绕 CORS）
 * - 在浏览器 dev 环境用原生 fetch（受 CORS 限制，仅供开发期验证）
 */
export async function scriptFetch(
  url: string,
  init: ScriptFetchInit = {}
): Promise<ScriptFetchResponse> {
  return isTauri ? tauriFetch(url, init) : browserFetch(url, init);
}
