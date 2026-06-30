/**
 * musicSdk 的统一 HTTP 出口适配层。
 *
 * lxserver/lx-music 的 musicSdk 各平台模块都 `import { httpFetch } from '../../request'`，
 * 调用形如 `httpFetch(url, options)` 返回 `{ promise, cancelHttp }`，promise resolve 成
 * `{ statusCode, headers, body }`（body 已按 json/text 解析）。原实现基于 Node 的 needle，
 * 这里把它桥接到本项目的 scriptFetch（Tauri 下走 Rust ureq，绕 WebView CORS、走用户代理），
 * 让整套 musicSdk 源码一行不改即可在前端运行。
 *
 * 仅实现 musicSdk 实际用到的子集：method / headers / body(json) / form(urlencoded)。
 * httpGet/httpPost/http_jsonp 在 musicSdk 里全是注释，提供空壳兼容导出即可。
 */
import { scriptFetch } from "@/source-script/fetch";

interface MusicSdkRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  /** JSON 请求体（对象）。 */
  body?: unknown;
  /** application/x-www-form-urlencoded 请求体（对象）。 */
  form?: unknown;
  /** multipart/form-data（musicSdk 基本不用，按 form 处理）。 */
  formData?: unknown;
  timeout?: number;
  /** 'json' | 'text'，默认 json。 */
  format?: string;
}

export interface MusicSdkResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface MusicSdkRequestObj {
  promise: Promise<MusicSdkResponse>;
  cancelHttp: () => void;
}

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function encodeForm(form: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) {
    if (v === undefined || v === null) continue;
    sp.append(k, String(v));
  }
  return sp.toString();
}

export const httpFetch = (
  url: string,
  options: MusicSdkRequestOptions = { method: "get" }
): MusicSdkRequestObj => {
  const method = (options.method || "get").toUpperCase();
  const headers: Record<string, string> = {
    "User-Agent": DEFAULT_UA,
    ...(options.headers ?? {}),
  };

  // 请求体：body=JSON，form/formData=urlencoded。
  let bodyStr: string | undefined;
  let jsonBody: unknown;
  if (options.body !== undefined) {
    jsonBody = options.body;
  } else if (options.form !== undefined) {
    bodyStr = encodeForm(options.form as Record<string, unknown>);
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
  } else if (options.formData !== undefined) {
    bodyStr = encodeForm(options.formData as Record<string, unknown>);
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
  }

  const wantJson = (options.format ?? "json") === "json";

  const promise = (async (): Promise<MusicSdkResponse> => {
    const res = await scriptFetch(url, {
      method,
      headers,
      json: jsonBody,
      body: bodyStr,
      timeout: options.timeout ?? 15000,
    });
    const text = await res.text();
    let body: unknown = text;
    if (wantJson) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { statusCode: res.status, headers: res.headers, body };
  })();

  // scriptFetch 不暴露中断句柄；musicSdk 的 cancelHttp 仅用于切歌时丢弃旧请求，
  // 这里做成 no-op（promise 仍会 resolve，但上层已忽略其结果）。
  return { promise, cancelHttp: () => undefined };
};

export const cancelHttp = (requestObj?: MusicSdkRequestObj): void => {
  requestObj?.cancelHttp?.();
};

// musicSdk 里 http/httpGet/httpPost/http_jsonp 全是注释，留空壳兼容潜在引用。
export const http = httpFetch;
export const httpGet = httpFetch;
export const httpPost = (url: string, _data: unknown, options?: MusicSdkRequestOptions) =>
  httpFetch(url, options);
export const http_jsonp = httpFetch;

export const checkUrl = async (url: string): Promise<void> => {
  const res = await scriptFetch(url, { method: "HEAD", timeout: 15000 });
  if (res.status !== 200) throw new Error(String(res.status));
};
