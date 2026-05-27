/**
 * 外部网络直播插件编译运行时。
 *
 * 复用 source-script 的 `new Function()` 模式：
 *   1. 用户提供 JS 代码，顶层 `return { manifest, resolve, ... }`
 *   2. 编译后校验 engine 版本
 *   3. 包装成 NetLivePlugin 注册到 registry
 */
import type { NetLiveAdapter, NetLiveCategory, NetLivePlatformId, NetLiveRoom } from "../types";
import type { NetLivePlugin } from "../plugin";
import { definePlugin, deriveCapabilities } from "../plugin";
import { hlsStream, flvStream, dashStream, mp4Stream, chunkedMp4Stream, sampleAesMp4Stream, agoraStream, parseMasterPlaylist } from "../protocols";
import { createPlatformFetch } from "../scriptFetch";
import { resolveProxyForPlatform } from "@/stores/netliveProxy";
import type {
  NetLiveScriptModule,
  NetLiveScriptContext,
  NetLivePluginDescriptor,
} from "./types";
import { NETLIVE_SCRIPT_API_VERSION } from "./types";

const PROXY_AWARE_COMMANDS = new Set([
  "fc2_resolve_hls",
  "fc2_diagnose",
  "mfc_list_online",
  "mfc_diagnose",
]);

function dedupeRooms(list: unknown, platformId: string): NetLiveRoom[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: NetLiveRoom[] = [];
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const room = r as NetLiveRoom;
    const roomId = room.roomId != null ? String(room.roomId) : "";
    if (!roomId) continue;
    if (seen.has(roomId)) continue;
    seen.add(roomId);
    out.push({ ...room, platform: (room.platform ?? platformId) as NetLivePlatformId, roomId });
  }
  return out;
}

function dedupeCategories(list: unknown): NetLiveCategory[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: NetLiveCategory[] = [];
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const cat = c as NetLiveCategory;
    const id = cat.id != null ? String(cat.id) : "";
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ ...cat, id });
  }
  return out;
}

function normalizeListResult(
  result: unknown,
  platformId: string
): { list: NetLiveRoom[]; hasMore: boolean } {
  if (!result || typeof result !== "object") return { list: [], hasMore: false };
  const r = result as { list?: unknown; hasMore?: unknown };
  return { list: dedupeRooms(r.list, platformId), hasMore: !!r.hasMore };
}

function compile(code: string): NetLiveScriptModule {
  const fn = new Function('"use strict";\n' + code);
  const mod = fn();
  if (!mod || typeof mod !== "object" || !mod.manifest || !mod.resolve) {
    throw new Error(
      "netlive plugin must `return { manifest: {...}, resolve: async (ctx, {roomId}) => {...} }`"
    );
  }
  return mod as NetLiveScriptModule;
}

const ALLOWED_COMMANDS = new Set([
  "fc2_resolve_hls",
  "fc2_diagnose",
  "mfc_list_online",
  "mfc_diagnose",
  "get_stream_proxy_port",
  "open_cf_challenge",
  "set_mouflon_keys",
  "get_mouflon_keys",
]);

function buildContext(platformId: string): NetLiveScriptContext {
  const fetch = createPlatformFetch(platformId as NetLivePlatformId);
  return {
    fetch: async (url, init) => {
      const res = await fetch(url, init);
      return {
        url: res.url,
        status: res.status,
        ok: res.ok,
        headers: res.headers,
        text: () => res.text(),
        json: <T>() => res.json<T>(),
      };
    },
    invoke: async <T>(cmd: string, args?: Record<string, unknown>) => {
      if (!ALLOWED_COMMANDS.has(cmd)) {
        throw new Error(`插件不允许调用 Tauri 命令 "${cmd}"`);
      }
      let finalArgs = args;
      if (PROXY_AWARE_COMMANDS.has(cmd)) {
        const incoming = (args ?? {}) as Record<string, unknown>;
        const explicit = "proxyUrl" in incoming ? incoming.proxyUrl : undefined;
        if (explicit === undefined || explicit === null || explicit === "") {
          const { proxyUrl, bypass } = resolveProxyForPlatform(platformId as NetLivePlatformId);
          finalArgs = { ...incoming, proxyUrl: bypass ? null : (proxyUrl ?? null) };
        }
      }
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<T>(cmd, finalArgs);
    },
    log: {
      info: (...args) => console.info(`[netlive-plugin:${platformId}]`, ...args),
      warn: (...args) => console.warn(`[netlive-plugin:${platformId}]`, ...args),
      error: (...args) => console.error(`[netlive-plugin:${platformId}]`, ...args),
    },
    utils: {
      buildUrl: (base, query) => {
        const u = new URL(base);
        if (query) {
          for (const [k, v] of Object.entries(query)) {
            if (v != null) u.searchParams.set(k, String(v));
          }
        }
        return u.toString();
      },
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      base64Encode: (s) => btoa(s),
      base64Decode: (s) => atob(s),
    },
    protocols: {
      hlsStream,
      flvStream,
      dashStream,
      mp4Stream,
      chunkedMp4Stream,
      sampleAesMp4Stream,
      agoraStream,
      parseMasterPlaylist,
    },
  };
}

export function compileExternalPlugin(desc: NetLivePluginDescriptor): NetLivePlugin {
  const mod = compile(desc.code);

  const apiVersion = mod.manifest.engine?.netliveApi ?? 1;
  if (apiVersion > NETLIVE_SCRIPT_API_VERSION) {
    throw new Error(
      `插件 "${mod.manifest.label}" 需要 netliveApi v${apiVersion}，当前运行时仅支持 v${NETLIVE_SCRIPT_API_VERSION}`
    );
  }

  const platformId = mod.manifest.id;
  const ctx = buildContext(platformId);

  const adapter: NetLiveAdapter = {
    platform: platformId as NetLivePlatformId,
    resolve: (roomId) => mod.resolve(ctx, { roomId }),
    getRecommend: mod.getRecommend
      ? async (page, pageSize) => normalizeListResult(await mod.getRecommend!(ctx, { page, pageSize }), platformId)
      : async () => ({ list: [], hasMore: false }),
    search: mod.search
      ? async (keyword, page) => normalizeListResult(await mod.search!(ctx, { keyword, page }), platformId)
      : undefined,
    getCategories: mod.getCategories
      ? async () => dedupeCategories(await mod.getCategories!(ctx))
      : undefined,
    getCategoryRooms: mod.getCategoryRooms
      ? async (categoryId, page) => normalizeListResult(await mod.getCategoryRooms!(ctx, { categoryId, page }), platformId)
      : undefined,
    getRoomDetail: mod.getRoomDetail
      ? (roomId) => mod.getRoomDetail!(ctx, { roomId })
      : undefined,
    getLiveStatus: mod.getLiveStatus
      ? (roomId) => mod.getLiveStatus!(ctx, { roomId })
      : undefined,
  };

  return definePlugin({
    manifest: {
      id: platformId as NetLivePlatformId,
      label: mod.manifest.label,
      adult: mod.manifest.adult,
      defaultProxy: mod.manifest.defaultProxy,
    },
    create: () => adapter,
    capabilities: deriveCapabilities(adapter),
    engine: { netliveApi: apiVersion },
  });
}
