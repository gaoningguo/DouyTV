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

/* ───────────────────── Cloudflare 人机验证流程 ───────────────────── */
//
// 检测响应是不是 CF challenge,如果是就调用 Rust 端的 open_cf_challenge 弹独立窗口
// 让用户手动通过,然后重试原请求一次。第二次仍 challenge 就放弃,把原响应给上层走友好提示。
//
// 关键不变量:
//   - 同一时间同 host 只跑一个 open_cf_challenge —— 多个并发请求共享 promise
//   - 单次 scriptFetch 调用只重试一次,避免死循环
//   - 传给 open_cf_challenge 的 UA 必须和后续 ureq 请求字节级一致(CF clearance 绑定 UA),
//     所以这里直接复用调用方传入的 headers["User-Agent"](脚本/adapter 都显式设置)

const cfInFlight = new Map<string, Promise<boolean>>();

function headerLookup(
  headers: Record<string, string>,
  name: string
): string | undefined {
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target) return v;
  }
  return undefined;
}

function looksLikeCfChallenge(res: RustHttpResponse): boolean {
  if (res.status !== 403 && res.status !== 503) return false;
  const cfMit = (headerLookup(res.headers, "cf-mitigated") ?? "").toLowerCase();
  if (cfMit === "challenge") return true;
  const server = (headerLookup(res.headers, "server") ?? "").toLowerCase();
  if (!server.includes("cloudflare")) return false;
  // body 是否包含典型 CF 挑战页关键字
  return /just a moment|challenge-platform|cf-chl-bypass|cf_chl_|__cf_chl_|enable javascript and cookies/i.test(
    res.body
  );
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin + "/";
  } catch {
    return null;
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

async function openCfChallengeDedup(
  origin: string,
  ua: string | undefined,
  proxyUrl: string | undefined
): Promise<boolean> {
  const host = hostOf(origin);
  if (!host) return false;
  const existing = cfInFlight.get(host);
  if (existing) return existing;
  console.info(
    "[cf-challenge] opening verification window for",
    origin,
    "(ua:",
    ua ? ua.slice(0, 40) + "..." : "<default>",
    ", proxy:",
    proxyUrl || "<none>",
    ")"
  );
  const p = invoke<boolean>("open_cf_challenge", {
    url: origin,
    ua: ua && ua.length > 0 ? ua : null,
    proxyUrl: proxyUrl && proxyUrl.length > 0 ? proxyUrl : null,
  })
    .then((ok) => {
      console.info(
        "[cf-challenge] window closed, clearance obtained:",
        ok
      );
      return ok;
    })
    .catch((e) => {
      console.error(
        "[cf-challenge] invoke failed (Rust 端是否已 cargo check 通过并重启 pnpm tauri dev?):",
        e
      );
      return false;
    })
    .finally(() => {
      cfInFlight.delete(host);
    });
  cfInFlight.set(host, p);
  return p;
}

/* ───────────────────────────────────────────────────────────────── */

async function tauriFetchRaw(
  url: string,
  init: ScriptFetchInit
): Promise<RustHttpResponse> {
  const finalUrl = appendQuery(url, init.query);
  const { bodyStr, headers } = buildBody(init);
  const method = init.method ?? (bodyStr !== null ? "POST" : "GET");
  // proxyOverride: undefined → 全局, string → 显式, null → 强制直连
  const proxyUrl =
    init.proxyOverride === null
      ? null
      : (init.proxyOverride ?? getActiveProxyUrl() ?? null);

  return invoke<RustHttpResponse>(
    init.http2 ? "script_http_h2" : "script_http",
    {
      req: {
        url: finalUrl,
        method,
        headers,
        body: bodyStr,
        timeout_ms: init.timeout ?? null,
        proxy_url: proxyUrl,
      },
    }
  );
}

async function tauriFetch(
  url: string,
  init: ScriptFetchInit
): Promise<ScriptFetchResponse> {
  let res = await tauriFetchRaw(url, init);

  if (looksLikeCfChallenge(res)) {
    console.info(
      "[cf-challenge] detected on",
      url,
      "(status:",
      res.status,
      ")"
    );
    const origin = originOf(res.url || url);
    console.info("[cf-challenge] computed origin:", origin);
    if (origin) {
      const ua = headerLookup(init.headers ?? {}, "User-Agent");
      // cf-challenge 弹窗也要遵循 per-platform / 显式 override —— 否则 stripchat
      // 用代理过完人机后,主请求又被全局直连发出,等于白做。
      const proxyUrl =
        init.proxyOverride === null
          ? undefined
          : (init.proxyOverride ?? getActiveProxyUrl());
      console.info("[cf-challenge] about to invoke open_cf_challenge");
      let passed = false;
      try {
        passed = await openCfChallengeDedup(origin, ua, proxyUrl);
      } catch (e) {
        console.error("[cf-challenge] dedup threw unexpectedly:", e);
      }
      console.info("[cf-challenge] dedup returned:", passed);
      if (passed) {
        console.info("[cf-challenge] retrying original request");
        res = await tauriFetchRaw(url, init);
      }
    } else {
      console.warn("[cf-challenge] could not parse origin from", res.url || url);
    }
  }

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
 * - 在 Tauri 环境走自定义 `script_http` invoke 命令（Rust 端用 ureq，绕 CORS），
 *   并自动处理 Cloudflare 人机验证(弹窗 → 重试)
 * - 在浏览器 dev 环境用原生 fetch（受 CORS 限制，仅供开发期验证）
 */
export async function scriptFetch(
  url: string,
  init: ScriptFetchInit = {}
): Promise<ScriptFetchResponse> {
  return isTauri ? tauriFetch(url, init) : browserFetch(url, init);
}
