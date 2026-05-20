// @ts-nocheck
/**
 * scriptFetch shim 兼容 lx-music 的 `httpFetch` API。
 *
 * lx-music 使用方式：
 *   const reqObj = httpFetch(url, { method, headers, body, form })
 *   reqObj.promise.then(({ body, headers, statusCode }) => ...)
 *   reqObj.cancelHttp()  // 取消（我们 noop）
 *
 * 我们把 body 自动按 content-type 解析（JSON / 文本），与 lx-music ureq 行为一致。
 */
import { scriptFetch } from "@/source-script/fetch";

interface HttpFetchOpts {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Record<string, unknown>;
  form?: Record<string, string>;
  formData?: Record<string, string>;
  timeout?: number;
}

export function httpFetch(url: string, opts: HttpFetchOpts = {}) {
  const method = (opts.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  let body: string | undefined;

  if (opts.body !== undefined && opts.body !== null) {
    if (typeof opts.body === "string") {
      body = opts.body;
    } else {
      body = JSON.stringify(opts.body);
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
      }
    }
  } else if (opts.form) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.form)) sp.set(k, String(v));
    body = sp.toString();
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
  } else if (opts.formData) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(opts.formData)) fd.append(k, String(v));
    body = undefined;
    // 让浏览器自动设 Content-Type（含 boundary）
    delete headers["Content-Type"];
    delete headers["content-type"];
    // 备注：scriptFetch 在 Tauri 下走 ureq 不能传 FormData，这里降级 form
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.formData)) sp.set(k, String(v));
    body = sp.toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  const promise = scriptFetch(url, {
    method,
    headers,
    body,
    timeout: opts.timeout ?? 30_000,
  }).then(async (res) => {
    const text = await res.text();
    let parsedBody: unknown = text;
    try {
      parsedBody = JSON.parse(text);
    } catch {
      // 文本响应
    }
    return {
      statusCode: res.status,
      headers: res.headers,
      body: parsedBody,
      raw: text,
    };
  });

  return {
    promise,
    cancelHttp: () => {
      /* scriptFetch 不支持取消，noop */
    },
  };
}

export const cancelHttp = () => {
  /* noop */
};

export default httpFetch;
