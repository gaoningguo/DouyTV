/**
 * LX 音源「运行时执行」模式 —— 完整移植 CyreneMusic lxMusicRuntimeService 的 **iframe 沙箱**方案。
 *
 * 为什么用 iframe 而非主上下文 new Function：
 *   洛雪脚本顶层大量用 `globalThis.lx` / `window.lx` 解构、注册 `lx.on('request')`，
 *   且常假设运行在一个干净的全局环境里（自带 setTimeout/fetch 垫片、不污染宿主）。
 *   在主上下文 new Function 跑会因全局污染 / this 绑定 / 严格模式差异导致部分脚本失败。
 *   照参考项目用隐藏 iframe 做沙箱，脚本在 iframe 自己的 window 里 new Function 执行，
 *   与洛雪桌面版环境最接近，兼容性最好。
 *
 * 网络层：沙箱内 `lx.request` → postMessage 到主线程 → 用本项目已有的 scriptFetch
 *   （Rust script_http 代理，绕 CORS、走用户代理）发请求 → 结果 postMessage 回沙箱。
 *   不引新 Rust 命令。
 */
import { scriptFetch } from "@/source-script/fetch";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

interface Sandbox {
  iframe: HTMLIFrameElement;
  /** 当前已加载脚本的缓存键；为空表示尚未加载。 */
  loadedKey: string;
  /** 脚本是否已 inited（lx.send('inited')）。 */
  ready: boolean;
  /** 等待 musicUrl 结果的请求表。 */
  pending: Map<string, PendingRequest>;
  /** 等待 ready 的 resolver（loadScript 用）。 */
  readyResolvers: Array<() => void>;
  messageHandler: (event: MessageEvent) => void;
  reqCounter: number;
}

let sandbox: Sandbox | null = null;

/** 沙箱 HTML —— 内置 MD5、模拟洛雪桌面版 lx API，照搬 CyreneMusic generateSandboxHtml。 */
function generateSandboxHtml(): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>LxMusic Sandbox</title></head>
<body>
<script>
(function() {
  'use strict';
  let requestHandler = null;
  const pendingHttpRequests = new Map();
  let httpRequestCounter = 0;

  function sendToParent(type, data) {
    window.parent.postMessage({ type: type, ...data }, '*');
  }

  // ── MD5（与 CyreneMusic 沙箱一致）──
  const md5 = (function() {
    function md5cycle(x, k) {
      let a = x[0], b = x[1], c = x[2], d = x[3];
      a = ff(a, b, c, d, k[0], 7, -680876936);
      d = ff(d, a, b, c, k[1], 12, -389564586);
      c = ff(c, d, a, b, k[2], 17, 606105819);
      b = ff(b, c, d, a, k[3], 22, -1044525330);
      a = ff(a, b, c, d, k[4], 7, -176418897);
      d = ff(d, a, b, c, k[5], 12, 1200080426);
      c = ff(c, d, a, b, k[6], 17, -1473231341);
      b = ff(b, c, d, a, k[7], 22, -45705983);
      a = ff(a, b, c, d, k[8], 7, 1770035416);
      d = ff(d, a, b, c, k[9], 12, -1958414417);
      c = ff(c, d, a, b, k[10], 17, -42063);
      b = ff(b, c, d, a, k[11], 22, -1990404162);
      a = ff(a, b, c, d, k[12], 7, 1804603682);
      d = ff(d, a, b, c, k[13], 12, -40341101);
      c = ff(c, d, a, b, k[14], 17, -1502002290);
      b = ff(b, c, d, a, k[15], 22, 1236535329);
      a = gg(a, b, c, d, k[1], 5, -165796510);
      d = gg(d, a, b, c, k[6], 9, -1069501632);
      c = gg(c, d, a, b, k[11], 14, 643717713);
      b = gg(b, c, d, a, k[0], 20, -373897302);
      a = gg(a, b, c, d, k[5], 5, -701558691);
      d = gg(d, a, b, c, k[10], 9, 38016083);
      c = gg(c, d, a, b, k[15], 14, -660478335);
      b = gg(b, c, d, a, k[4], 20, -405537848);
      a = gg(a, b, c, d, k[9], 5, 568446438);
      d = gg(d, a, b, c, k[14], 9, -1019803690);
      c = gg(c, d, a, b, k[3], 14, -187363961);
      b = gg(b, c, d, a, k[8], 20, 1163531501);
      a = gg(a, b, c, d, k[13], 5, -1444681467);
      d = gg(d, a, b, c, k[2], 9, -51403784);
      c = gg(c, d, a, b, k[7], 14, 1735328473);
      b = gg(b, c, d, a, k[12], 20, -1926607734);
      a = hh(a, b, c, d, k[5], 4, -378558);
      d = hh(d, a, b, c, k[8], 11, -2022574463);
      c = hh(c, d, a, b, k[11], 16, 1839030562);
      b = hh(b, c, d, a, k[14], 23, -35309556);
      a = hh(a, b, c, d, k[1], 4, -1530992060);
      d = hh(d, a, b, c, k[4], 11, 1272893353);
      c = hh(c, d, a, b, k[7], 16, -155497632);
      b = hh(b, c, d, a, k[10], 23, -1094730640);
      a = hh(a, b, c, d, k[13], 4, 681279174);
      d = hh(d, a, b, c, k[0], 11, -358537222);
      c = hh(c, d, a, b, k[3], 16, -722521979);
      b = hh(b, c, d, a, k[6], 23, 76029189);
      a = hh(a, b, c, d, k[9], 4, -640364487);
      d = hh(d, a, b, c, k[12], 11, -421815835);
      c = hh(c, d, a, b, k[15], 16, 530742520);
      b = hh(b, c, d, a, k[2], 23, -995338651);
      a = ii(a, b, c, d, k[0], 6, -198630844);
      d = ii(d, a, b, c, k[7], 10, 1126891415);
      c = ii(c, d, a, b, k[14], 15, -1416354905);
      b = ii(b, c, d, a, k[5], 21, -57434055);
      a = ii(a, b, c, d, k[12], 6, 1700485571);
      d = ii(d, a, b, c, k[3], 10, -1894986606);
      c = ii(c, d, a, b, k[10], 15, -1051523);
      b = ii(b, c, d, a, k[1], 21, -2054922799);
      a = ii(a, b, c, d, k[8], 6, 1873313359);
      d = ii(d, a, b, c, k[15], 10, -30611744);
      c = ii(c, d, a, b, k[6], 15, -1560198380);
      b = ii(b, c, d, a, k[13], 21, 1309151649);
      a = ii(a, b, c, d, k[4], 6, -145523070);
      d = ii(d, a, b, c, k[11], 10, -1120210379);
      c = ii(c, d, a, b, k[2], 15, 718787259);
      b = ii(b, c, d, a, k[9], 21, -343485551);
      x[0] = add32(a, x[0]);
      x[1] = add32(b, x[1]);
      x[2] = add32(c, x[2]);
      x[3] = add32(d, x[3]);
    }
    function cmn(q, a, b, x, s, t) {
      a = add32(add32(a, q), add32(x, t));
      return add32((a << s) | (a >>> (32 - s)), b);
    }
    function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
    function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
    function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
    function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }
    function md51(s) {
      const n = s.length;
      let state = [1732584193, -271733879, -1732584194, 271733878], i;
      for (i = 64; i <= s.length; i += 64) md5cycle(state, md5blk(s.substring(i - 64, i)));
      s = s.substring(i - 64);
      const tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (i = 0; i < s.length; i++) tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
      tail[i >> 2] |= 0x80 << ((i % 4) << 3);
      if (i > 55) {
        md5cycle(state, tail);
        for (i = 0; i < 16; i++) tail[i] = 0;
      }
      tail[14] = n * 8;
      md5cycle(state, tail);
      return state;
    }
    function md5blk(s) {
      const md5blks = [];
      for (let i = 0; i < 64; i += 4) md5blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
      return md5blks;
    }
    const hex_chr = '0123456789abcdef'.split('');
    function rhex(n) {
      let s = '', j = 0;
      for (; j < 4; j++) s += hex_chr[(n >> (j * 8 + 4)) & 0x0F] + hex_chr[(n >> (j * 8)) & 0x0F];
      return s;
    }
    function hex(x) {
      for (let i = 0; i < x.length; i++) x[i] = rhex(x[i]);
      return x.join('');
    }
    function add32(a, b) { return (a + b) & 0xFFFFFFFF; }
    return function(s) { return hex(md51(s)); };
  })();

  const utils = {
    crypto: {
      aesEncrypt: function(buf) { return buf; },
      rsaEncrypt: function(buf) { return buf; },
      randomBytes: function(size) {
        const bytes = new Uint8Array(size);
        crypto.getRandomValues(bytes);
        return bytes;
      },
      md5: function(str) {
        if (typeof str !== 'string') str = new TextDecoder().decode(str);
        return md5(str);
      }
    },
    buffer: {
      from: function(data, enc) {
        if (typeof data === 'string') {
          if (enc === 'base64') return Uint8Array.from(atob(data), function(c) { return c.charCodeAt(0); });
          return new TextEncoder().encode(data);
        }
        return new Uint8Array(data);
      },
      bufToString: function(buf, fmt) {
        const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
        if (fmt === 'hex') return Array.from(u8).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
        if (fmt === 'base64') return btoa(String.fromCharCode.apply(null, u8));
        return new TextDecoder().decode(u8);
      }
    }
  };

  window.lx = {
    EVENT_NAMES: { request: 'request', inited: 'inited', updateAlert: 'updateAlert' },
    request: function(url, opts, cb) {
      const rid = 'http_' + (++httpRequestCounter);
      pendingHttpRequests.set(rid, cb);
      sendToParent('lx-request', { requestId: rid, url: url, options: opts || {} });
      return function() { pendingHttpRequests.delete(rid); };
    },
    on: function(evt, h) { if (evt === 'request') requestHandler = h; },
    send: function(evt, data) {
      if (evt === 'inited') sendToParent('lx-inited', { data: data });
      return Promise.resolve();
    },
    utils: utils,
    version: '2.0.0',
    env: 'desktop',
    currentScriptInfo: {}
  };
  globalThis.lx = window.lx;

  window.addEventListener('message', function(event) {
    const d = event.data || {};
    const type = d.type;
    if (type === 'lx-handle-http-response') {
      const cb = pendingHttpRequests.get(d.requestId);
      if (cb) {
        pendingHttpRequests.delete(d.requestId);
        if (d.error) cb(new Error(d.error), null, null);
        else cb(null, d.response, d.response.body);
      }
    } else if (type === 'lx-load-script') {
      requestHandler = null;
      window.lx.currentScriptInfo = { rawScript: d.scriptContent };
      try {
        (new Function(d.scriptContent))();
        sendToParent('lx-loaded', {});
      } catch (e) {
        sendToParent('lx-on-error', { data: (e && e.message) || String(e) });
      }
    } else if (type === 'lx-send-request') {
      if (!requestHandler) {
        sendToParent('lx-on-response', { requestKey: d.requestKey, success: false, error: '脚本未注册 request 处理器' });
        return;
      }
      try {
        Promise.resolve(requestHandler({ source: d.source, action: d.action, info: d.info }))
          .then(function(result) {
            sendToParent('lx-on-response', { requestKey: d.requestKey, success: true, result: result });
          })
          .catch(function(err) {
            sendToParent('lx-on-response', { requestKey: d.requestKey, success: false, error: (err && err.message) || String(err) });
          });
      } catch (err) {
        sendToParent('lx-on-response', { requestKey: d.requestKey, success: false, error: (err && err.message) || String(err) });
      }
    }
  });
})();
</script>
</body>
</html>`;
}

/** 沙箱内 lx.request 的网络代理：用 scriptFetch 发，结果回传沙箱。 */
async function proxyRequest(
  iframe: HTMLIFrameElement,
  requestId: string,
  url: string,
  options: Record<string, unknown>
): Promise<void> {
  try {
    const method = String(options.method || "GET").toUpperCase();
    const headers: Record<string, string> = {};
    if (options.headers && typeof options.headers === "object") {
      for (const [k, v] of Object.entries(options.headers as Record<string, unknown>)) {
        headers[k] = String(v);
      }
    }
    if (!Object.keys(headers).some((k) => k.toLowerCase() === "user-agent")) {
      headers["User-Agent"] = "lx-music-request";
    }
    const body = options.body;
    const res = await scriptFetch(url, {
      method,
      headers,
      json: body && typeof body === "object" ? (body as object) : undefined,
      body: typeof body === "string" ? body : undefined,
      timeout: 15000,
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    iframe.contentWindow?.postMessage(
      {
        type: "lx-handle-http-response",
        requestId,
        response: { statusCode: res.status, headers: res.headers, body: parsed },
      },
      "*"
    );
  } catch (error) {
    iframe.contentWindow?.postMessage(
      {
        type: "lx-handle-http-response",
        requestId,
        error: error instanceof Error ? error.message : String(error),
      },
      "*"
    );
  }
}

/** 创建（或复用）隐藏 iframe 沙箱。 */
function ensureSandbox(): Sandbox {
  if (sandbox) return sandbox;
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.setAttribute("aria-hidden", "true");
  iframe.id = "lx-music-sandbox";
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document || iframe.contentDocument;
  if (doc) {
    doc.open();
    doc.write(generateSandboxHtml());
    doc.close();
  }

  const sb: Sandbox = {
    iframe,
    loadedKey: "",
    ready: false,
    pending: new Map(),
    readyResolvers: [],
    reqCounter: 0,
    messageHandler: () => undefined,
  };

  sb.messageHandler = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return;
    const d = (event.data || {}) as Record<string, unknown>;
    switch (d.type) {
      case "lx-request":
        void proxyRequest(
          iframe,
          String(d.requestId),
          String(d.url),
          (d.options as Record<string, unknown>) || {}
        );
        break;
      case "lx-loaded":
      case "lx-inited": {
        // 脚本执行完（或 inited）即视为就绪。
        sb.ready = true;
        const resolvers = sb.readyResolvers.splice(0);
        for (const r of resolvers) r();
        break;
      }
      case "lx-on-response": {
        const key = String(d.requestKey);
        const p = sb.pending.get(key);
        if (p) {
          sb.pending.delete(key);
          if (d.success) p.resolve(d.result);
          else p.reject(new Error(String(d.error || "洛雪脚本执行失败")));
        }
        break;
      }
      case "lx-on-error":
        console.warn("[lxRuntime] 脚本错误:", d.data);
        break;
    }
  };
  window.addEventListener("message", sb.messageHandler);
  sandbox = sb;
  return sb;
}

/** 把脚本加载进沙箱（若当前已加载同一 cacheKey 则复用）。等待就绪，最多 10s。 */
async function loadScript(cacheKey: string, scriptContent: string): Promise<Sandbox> {
  if (!scriptContent.trim()) throw new Error("洛雪脚本源码为空");
  const sb = ensureSandbox();
  if (sb.loadedKey === cacheKey && sb.ready) return sb;

  sb.ready = false;
  sb.loadedKey = cacheKey;
  // 切换脚本时丢弃旧脚本的在途请求。
  for (const p of sb.pending.values()) p.reject(new Error("脚本已切换"));
  sb.pending.clear();

  const readyPromise = new Promise<void>((resolve, reject) => {
    sb.readyResolvers.push(resolve);
    setTimeout(() => reject(new Error("洛雪脚本加载超时")), 10000);
  });

  // iframe 可能还在 doc.write 之后未完全就绪，poll 一下 contentWindow。
  const post = () => {
    if (sb.iframe.contentWindow) {
      sb.iframe.contentWindow.postMessage(
        { type: "lx-load-script", scriptContent },
        "*"
      );
    } else {
      setTimeout(post, 30);
    }
  };
  post();

  await readyPromise;
  return sb;
}

/** 该脚本是否「需要运行时执行」(注册了 request 处理器,且没法当静态模板源)。 */
export function canRunLxScript(scriptContent: string): boolean {
  // 覆盖多种 handler 注册写法：lx.on(/on(/解构 on、EVENT_NAMES.request、
  // globalThis.lx/window.lx 引用、send('inited')、musicUrl action 等洛雪沙箱标记。
  return /(?:lx|globalThis|window)\.on\s*\(|(?:^|[^.\w])on\s*\(\s*(?:EVENT_NAMES|['"]request['"])|EVENT_NAMES\s*\.\s*request|globalThis\.lx|window\.lx|\.send\s*\(\s*['"]?(?:inited|EVENT_NAMES)|musicUrl/.test(
    scriptContent
  );
}

/** 把酷狗 id(hash:albumId) / 普通 id 还原成洛雪 handler 期望的 musicInfo。 */
function buildMusicInfo(source: string, songId: string): Record<string, unknown> {
  if (source === "kg" && songId.includes(":")) {
    const [hash, albumId] = songId.split(":");
    return { hash: hash.toUpperCase(), albumId: albumId || "", songmid: hash.toUpperCase() };
  }
  return { songmid: songId, copyrightId: songId, hash: songId };
}

function extractUrlFromResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const rec = result as Record<string, unknown>;
    for (const key of ["url", "playUrl", "src"]) {
      if (typeof rec[key] === "string") return rec[key] as string;
    }
  }
  return "";
}

/**
 * 运行时执行模式取直链：加载脚本进 iframe 沙箱 → 调脚本的 request 处理器(action=musicUrl)。30s 超时。
 * @param cacheKey  脚本缓存键(建议 `${sourceId}:${updatedAt}`)
 */
export async function getLxRuntimeMusicUrl(
  cacheKey: string,
  scriptContent: string,
  source: string,
  songId: string,
  quality: string
): Promise<string> {
  const sb = await loadScript(cacheKey, scriptContent);
  const requestKey = `req_${++sb.reqCounter}_${Date.now()}`;

  const resultPromise = new Promise<unknown>((resolve, reject) => {
    sb.pending.set(requestKey, { resolve, reject });
    setTimeout(() => {
      if (sb.pending.has(requestKey)) {
        sb.pending.delete(requestKey);
        reject(new Error("洛雪脚本解析超时"));
      }
    }, 30000);
  });

  sb.iframe.contentWindow?.postMessage(
    {
      type: "lx-send-request",
      requestKey,
      source,
      action: "musicUrl",
      info: { musicInfo: buildMusicInfo(source, songId), type: quality },
    },
    "*"
  );

  const result = await resultPromise;
  const url = extractUrlFromResult(result);
  if (!url) throw new Error("洛雪脚本未返回播放地址");
  return url;
}

/**
 * 同上，但直接传入完整 musicInfo（musicSdk 列表层歌曲的 raw 即洛雪脚本期望的 musicInfo，
 * 含各平台原生 id 编码 songmid/hash/copyrightId 等，无需 buildMusicInfo 重构）。30s 超时。
 */
export async function getLxRuntimeMusicUrlByInfo(
  cacheKey: string,
  scriptContent: string,
  source: string,
  musicInfo: Record<string, unknown>,
  quality: string
): Promise<string> {
  const sb = await loadScript(cacheKey, scriptContent);
  const requestKey = `req_${++sb.reqCounter}_${Date.now()}`;

  const resultPromise = new Promise<unknown>((resolve, reject) => {
    sb.pending.set(requestKey, { resolve, reject });
    setTimeout(() => {
      if (sb.pending.has(requestKey)) {
        sb.pending.delete(requestKey);
        reject(new Error("洛雪脚本解析超时"));
      }
    }, 30000);
  });

  sb.iframe.contentWindow?.postMessage(
    {
      type: "lx-send-request",
      requestKey,
      source,
      action: "musicUrl",
      info: { musicInfo, type: quality },
    },
    "*"
  );

  const result = await resultPromise;
  const url = extractUrlFromResult(result);
  if (!url) throw new Error("洛雪脚本未返回播放地址");
  return url;
}
