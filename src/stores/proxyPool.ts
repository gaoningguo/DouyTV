/**
 * 代理池 store —— 【服务端后端方案 / approach B,反应式极简版】
 *
 * 用户自建(或用公网实例)一个 proxypool 服务端(如 1837620622/proxypool:采集免费代理
 * → 存活检测 → REST API)。本 app 做【反应式薄客户端】,信任服务端返回的代理可用:
 *
 *   - 平时源脚本请求【正常发】(直连 / 全局 useProxyStore 代理),不主动走池;
 *   - 一旦某次请求遇到【429 / 403 封 IP】,才向 `GET {server}/api/random?...` 抓一个随机代理,
 *     切过去重试;之后的请求都用这个代理,直到它也被封,再抓下一个随机代理;
 *   - 服务端不可达 / 抓不到代理 → 保持原样(直连 / 全局代理),不比现状差。
 *
 * 【为什么这么简】不维护工作集、不轮询、不验活、不定时维护 —— 代理只在「被封了」这个明确信号
 * 下才启用,用一个换一个。信任服务端保证代理可用;万一抓到死的,那次重试会再触发一次换新。
 *
 * 【范围】仅源脚本 scriptFetch。不动全局三档代理(useProxyStore),不给播放/dyproxy 拉流走池。
 * 【SOCKS 限制】Rust 侧 ureq/reqwest 未编译 socks feature,只用 http(s) 代理,默认 protocol=http。
 */
import { create } from "zustand";
import { isTauri } from "@/lib/platform";
import { getActiveProxyUrl } from "./proxy";

const ENABLED_KEY = "douytv:proxy-pool-enabled";
const SERVER_KEY = "douytv:proxy-pool-server";
const PROTOCOL_KEY = "douytv:proxy-pool-protocol";
const SPEED_KEY = "douytv:proxy-pool-speed";

export type PoolProtocol = "http" | "https";
export type PoolSpeed = "fast" | "good" | ""; // "" = 不限速度

interface ProxyPoolStore {
  enabled: boolean;
  /** proxypool 服务端基址,如 "https://myproxypool.up.railway.app"。 */
  server: string;
  protocol: PoolProtocol;
  speed: PoolSpeed;
  /** 当前正在使用的代理 URL(被封后切换到的那个);空 = 未启用代理,走直连/全局。 */
  current: string;
  /** 最近一次切换到的代理的服务端上报延迟(ms),UI 展示用。 */
  currentLatency: number;
  /** 是否正在抓新代理(防并发重复抓)。 */
  rotating: boolean;
  hydrated: boolean;

  hydrate: () => void;
  setEnabled: (v: boolean) => void;
  setServer: (u: string) => void;
  setProtocol: (p: PoolProtocol) => void;
  setSpeed: (s: PoolSpeed) => void;
  /** 抓一个随机代理设为 current 并返回它(被封时调用)。抓不到返回 undefined。 */
  rotate: () => Promise<string | undefined>;
  /** 清掉当前代理(回到直连/全局)。 */
  clearCurrent: () => void;
}

function normalizeServer(u: string): string {
  return u.trim().replace(/\/+$/, "");
}

/**
 * 从服务端 /api/random 的返回里取【一个】代理 → {url, latency}。
 * 单条形态: { ip, port, protocol, latency } 或 { count, data:[...] };
 * 也兼容纯字符串 "ip:port" / "http://ip:port"。取不到返回 undefined。
 */
function parseOneProxy(
  data: unknown,
  fallbackProtocol: PoolProtocol
): { url: string; latency: number } | undefined {
  const rows: unknown[] = Array.isArray((data as { data?: unknown[] })?.data)
    ? (data as { data: unknown[] }).data
    : Array.isArray(data)
      ? (data as unknown[])
      : data
        ? [data]
        : [];
  for (const r of rows) {
    if (!r) continue;
    if (typeof r === "string") {
      const s = r.trim();
      if (!s) continue;
      return {
        url: /^\w+:\/\//i.test(s) ? s : fallbackProtocol + "://" + s,
        latency: 0,
      };
    }
    if (typeof r === "object") {
      const o = r as Record<string, unknown>;
      const ip = o.ip ?? o.host ?? o.address;
      const port = o.port;
      if (ip == null || port == null) continue;
      // 服务端 protocol 形如 "Http"/"Https"/"Socks5";socks 我们用不了,降级 http。
      let scheme = String(o.protocol || fallbackProtocol).toLowerCase();
      if (scheme !== "http" && scheme !== "https") scheme = fallbackProtocol;
      const latency = Number(o.latency);
      return {
        url: scheme + "://" + String(ip) + ":" + String(port),
        latency: isFinite(latency) && latency > 0 ? latency : 0,
      };
    }
  }
  return undefined;
}

/**
 * 向服务端 /api/random 抓一个随机代理。走全局代理(墙内靠 clash 才能到服务端);短超时。
 * 先按 speed 抓;服务端没做 speed 分级(返空)时去掉 speed 再抓一次。失败返 undefined。
 */
async function fetchOneRandom(
  server: string,
  protocol: PoolProtocol,
  speed: PoolSpeed
): Promise<{ url: string; latency: number } | undefined> {
  const { invoke } = await import("@tauri-apps/api/core");
  const doFetch = async (sp: PoolSpeed) => {
    const q = new URLSearchParams();
    q.set("protocol", protocol);
    if (sp) q.set("speed", sp);
    q.set("count", "1");
    try {
      const res = await invoke<{ status: number; body: string }>("script_http", {
        req: {
          url: server + "/api/random?" + q.toString(),
          method: "GET",
          headers: { Accept: "application/json" },
          body: null,
          timeout_ms: 12000,
          proxy_url: getActiveProxyUrl() ?? null,
        },
      });
      if (res.status < 200 || res.status >= 300) return undefined;
      return parseOneProxy(JSON.parse(res.body), protocol);
    } catch {
      return undefined;
    }
  };
  let one = await doFetch(speed);
  if (!one && speed) one = await doFetch("");
  return one;
}

export const useProxyPoolStore = create<ProxyPoolStore>((set, get) => ({
  enabled: false,
  server: "",
  protocol: "http",
  speed: "fast",
  current: "",
  currentLatency: 0,
  rotating: false,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    let enabled = false;
    let server = "";
    let protocol: PoolProtocol = "http";
    let speed: PoolSpeed = "fast";
    try {
      enabled = localStorage.getItem(ENABLED_KEY) === "1";
      server = normalizeServer(localStorage.getItem(SERVER_KEY) || "");
      const p = localStorage.getItem(PROTOCOL_KEY);
      if (p === "http" || p === "https") protocol = p;
      const s = localStorage.getItem(SPEED_KEY);
      if (s === "fast" || s === "good" || s === "") speed = s;
    } catch {
      /* private mode */
    }
    if (!server) enabled = false; // 没填服务端不算启用
    set({ enabled, server, protocol, speed, hydrated: true });
  },

  setEnabled: (v) => {
    try {
      localStorage.setItem(ENABLED_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
    // 关闭时顺手清掉当前代理。
    set({ enabled: v && !!get().server, current: v ? get().current : "", currentLatency: 0 });
  },

  setServer: (u) => {
    const server = normalizeServer(u);
    try {
      if (server) localStorage.setItem(SERVER_KEY, server);
      else localStorage.removeItem(SERVER_KEY);
    } catch {
      /* ignore */
    }
    // 换服务端 → 清掉当前代理,若新地址为空则同时停用。
    set({ server, current: "", currentLatency: 0, enabled: get().enabled && !!server });
  },

  setProtocol: (protocol) => {
    try {
      localStorage.setItem(PROTOCOL_KEY, protocol);
    } catch {
      /* ignore */
    }
    set({ protocol, current: "", currentLatency: 0 });
  },

  setSpeed: (speed) => {
    try {
      localStorage.setItem(SPEED_KEY, speed);
    } catch {
      /* ignore */
    }
    set({ speed, current: "", currentLatency: 0 });
  },

  clearCurrent: () => set({ current: "", currentLatency: 0 }),

  rotate: async () => {
    const { server, protocol, speed, rotating } = get();
    if (!server || rotating || !isTauri()) return undefined;
    set({ rotating: true });
    try {
      const one = await fetchOneRandom(server, protocol, speed);
      if (!one) return undefined;
      set({ current: one.url, currentLatency: one.latency });
      return one.url;
    } catch {
      return undefined;
    } finally {
      set({ rotating: false });
    }
  },
}));

/* ─────────────── 非 React 同步 API(供 scriptFetch 用)─────────────── */

/** 池是否处于「可用」状态(启用 + 有服务端)。 */
export function isPoolActive(): boolean {
  const s = useProxyPoolStore.getState();
  return s.enabled && !!s.server;
}

/** 当前正在用的代理 URL(被封后切到的那个);没有则 undefined(走直连/全局)。 */
export function getCurrentPoolProxy(): string | undefined {
  const s = useProxyPoolStore.getState();
  if (!s.enabled || !s.server) return undefined;
  return s.current || undefined;
}

/**
 * 被封(429/403)时调用:抓一个随机代理切过去,返回新代理 URL(供本次立即重试)。
 * 抓不到返回 undefined。
 */
export function rotatePoolProxy(): Promise<string | undefined> {
  const s = useProxyPoolStore.getState();
  if (!s.enabled || !s.server) return Promise.resolve(undefined);
  return s.rotate();
}
