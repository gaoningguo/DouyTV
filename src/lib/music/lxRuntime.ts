/**
 * LX 音源「运行时执行」模式 —— 照 CyreneMusic lxMusicRuntimeService 的协议实现,
 * 但用本项目已有的 scriptFetch(Rust script_http 代理)做网络,且在主上下文 new Function
 * 执行(与 pluginAdapter 一致的安全姿态),不另开 iframe / Rust 命令。
 *
 * 用途:洛雪脚本里有一类「播放链需脚本运行时算签名/MD5」的源,没有静态 apiUrl,
 * lxSource.parseLxScript 抽不出模板 → 只能真执行脚本。脚本通过 globalThis.lx.on(
 * 'request', handler) 注册处理器,我们调 handler({source, action:'musicUrl', info})
 * 拿直链。
 */
import { scriptFetch } from "@/source-script/fetch";
import { md5 } from "./md5";

// ── lx API 环境 ──

type LxRequestCallback = (
  err: Error | null,
  resp: { statusCode: number; headers: Record<string, string>; body: unknown } | null,
  body: unknown
) => void;

interface LxApi {
  EVENT_NAMES: { request: string; inited: string; updateAlert: string };
  request: (url: string, opts: Record<string, unknown>, cb: LxRequestCallback) => () => void;
  on: (evt: string, handler: LxRequestHandler) => void;
  send: (evt: string, data: unknown) => Promise<void>;
  utils: {
    crypto: {
      aesEncrypt: (buf: unknown) => unknown;
      rsaEncrypt: (buf: unknown) => unknown;
      randomBytes: (size: number) => Uint8Array;
      md5: (str: string | Uint8Array) => string;
    };
    buffer: {
      from: (data: string | ArrayBuffer | Uint8Array, enc?: string) => Uint8Array;
      bufToString: (buf: Uint8Array | ArrayBuffer, fmt?: string) => string;
    };
  };
  version: string;
  env: string;
  currentScriptInfo: Record<string, unknown>;
}

type LxRequestHandler = (params: {
  source: string;
  action: string;
  info: unknown;
}) => Promise<unknown>;

interface LoadedLxScript {
  lx: LxApi;
  handler: LxRequestHandler | null;
  inited: boolean;
  sources: Record<string, unknown>;
}

/** 把 scriptFetch 响应交给 lx.request 回调:body 能解析成 JSON 就给对象,否则给字符串。 */
async function runLxRequest(
  url: string,
  opts: Record<string, unknown>,
  cb: LxRequestCallback
): Promise<void> {
  try {
    const method = String(opts.method || "GET").toUpperCase();
    const headers: Record<string, string> = {};
    if (opts.headers && typeof opts.headers === "object") {
      for (const [k, v] of Object.entries(opts.headers as Record<string, unknown>)) {
        headers[k] = String(v);
      }
    }
    if (!Object.keys(headers).some((k) => k.toLowerCase() === "user-agent")) {
      headers["User-Agent"] = "lx-music-request";
    }
    const body = opts.body;
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
    const resp = { statusCode: res.status, headers: res.headers, body: parsed };
    cb(null, resp, parsed);
  } catch (error) {
    cb(error instanceof Error ? error : new Error(String(error)), null, null);
  }
}

function createLxApi(loaded: LoadedLxScript): LxApi {
  const api: LxApi = {
    EVENT_NAMES: { request: "request", inited: "inited", updateAlert: "updateAlert" },
    request: (url, opts, cb) => {
      void runLxRequest(url, opts || {}, cb);
      return () => undefined;
    },
    on: (evt, handler) => {
      if (evt === "request") loaded.handler = handler;
    },
    send: (evt, data) => {
      if (evt === "inited") {
        loaded.inited = true;
        const rec = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
        const sources = rec.sources;
        if (sources && typeof sources === "object") {
          loaded.sources = sources as Record<string, unknown>;
        }
      }
      return Promise.resolve();
    },
    utils: {
      crypto: {
        aesEncrypt: (buf) => buf,
        rsaEncrypt: (buf) => buf,
        randomBytes: (size) => {
          const bytes = new Uint8Array(size);
          crypto.getRandomValues(bytes);
          return bytes;
        },
        md5: (str) => md5(typeof str === "string" ? str : new TextDecoder().decode(str)),
      },
      buffer: {
        from: (data, enc) => {
          if (typeof data === "string") {
            if (enc === "base64") return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
            return new TextEncoder().encode(data);
          }
          return new Uint8Array(data);
        },
        bufToString: (buf, fmt) => {
          const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
          if (fmt === "hex")
            return Array.from(u8)
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("");
          if (fmt === "base64") return btoa(String.fromCharCode(...u8));
          return new TextDecoder().decode(u8);
        },
      },
    },
    version: "2.0.0",
    env: "desktop",
    currentScriptInfo: {},
  };
  return api;
}

const scriptCache = new Map<string, LoadedLxScript>();

/** 编译并执行洛雪脚本,捕获其 request 处理器。缓存按 (id, updatedAt) 键。 */
function loadLxScript(cacheKey: string, scriptContent: string): LoadedLxScript {
  const cached = scriptCache.get(cacheKey);
  if (cached) return cached;
  if (!scriptContent.trim()) throw new Error("洛雪脚本源码为空");

  const loaded: LoadedLxScript = { lx: null as unknown as LxApi, handler: null, inited: false, sources: {} };
  const lx = createLxApi(loaded);
  loaded.lx = lx;
  lx.currentScriptInfo = { rawScript: scriptContent };

  // 脚本顶层多以 globalThis.lx / window.lx 解构;执行前注入,执行时即完成绑定与 on() 注册。
  const prev = (globalThis as Record<string, unknown>).lx;
  (globalThis as Record<string, unknown>).lx = lx;
  try {
    const runner = new Function("lx", "globalThis", "window", `${scriptContent}`);
    runner(lx, globalThis, globalThis);
  } finally {
    (globalThis as Record<string, unknown>).lx = prev;
  }

  if (!loaded.handler) throw new Error("洛雪脚本未注册 request 处理器(可能不是可执行音源)");
  scriptCache.set(cacheKey, loaded);
  return loaded;
}

/** 该脚本是否「需要运行时执行」(注册了 request 处理器,且没法当静态模板源)。 */
export function canRunLxScript(scriptContent: string): boolean {
  return /lx\.on\s*\(|EVENT_NAMES\.request|globalThis\.lx|window\.lx/.test(scriptContent);
}

/** 把酷狗 id(hash:albumId) / 普通 id 还原成洛雪 handler 期望的 musicInfo。 */
function buildMusicInfo(source: string, songId: string): Record<string, unknown> {
  if (source === "kg" && songId.includes(":")) {
    const [hash, albumId] = songId.split(":");
    return { hash: hash.toUpperCase(), albumId: albumId || "", songmid: hash.toUpperCase() };
  }
  return { songmid: songId, copyrightId: songId, hash: songId };
}

/**
 * 运行时执行模式取直链:加载脚本 → 调 request 处理器(action=musicUrl)。30s 超时。
 * @param cacheKey  脚本缓存键(建议 `${sourceId}:${updatedAt}`)
 */
export async function getLxRuntimeMusicUrl(
  cacheKey: string,
  scriptContent: string,
  source: string,
  songId: string,
  quality: string
): Promise<string> {
  const loaded = loadLxScript(cacheKey, scriptContent);
  if (!loaded.handler) throw new Error("洛雪脚本无可用处理器");

  // 调用期间把 globalThis.lx 指回该脚本的实例,兼容 handler 内直接引用全局 lx 的写法。
  const prev = (globalThis as Record<string, unknown>).lx;
  (globalThis as Record<string, unknown>).lx = loaded.lx;
  try {
    const result = await Promise.race([
      loaded.handler({
        source,
        action: "musicUrl",
        info: { musicInfo: buildMusicInfo(source, songId), type: quality },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("洛雪脚本解析超时")), 30000)
      ),
    ]);
    const url = typeof result === "string" ? result : extractUrlFromResult(result);
    if (!url) throw new Error("洛雪脚本未返回播放地址");
    return url;
  } finally {
    (globalThis as Record<string, unknown>).lx = prev;
  }
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
