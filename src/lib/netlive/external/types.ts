/**
 * 外部网络直播插件类型定义。
 *
 * 用户自定义 JS 脚本 `return { ... }` 一个符合此接口的对象，
 * runtime 编译后包装成 NetLivePlugin 注册到 registry。
 *
 * 脚本签名与 source-script 风格对齐：每个 hook 接收 (ctx, args)。
 */
import type { NetLiveCategory, NetLiveRoom, NetLiveStream } from "../types";

export const NETLIVE_SCRIPT_API_VERSION = 1;

export interface NetLiveScriptManifest {
  id: string;
  label: string;
  version?: string;
  author?: string;
  adult?: boolean;
  defaultProxy?: "direct" | "proxy";
  engine?: { netliveApi: number };
}

/**
 * 受控的 Rust 命令白名单 —— 插件只能调这些预定义命令,
 * 防止恶意插件 invoke 任意 Tauri command。
 *
 * 新增 Rust 命令时也需在此处加入 union,且在 runtime.ts buildContext 透传。
 */
export type AllowedTauriCommand =
  | "fc2_resolve_hls"
  | "fc2_diagnose"
  | "mfc_list_online"
  | "mfc_diagnose"
  | "get_stream_proxy_port"
  | "open_cf_challenge"
  | "set_mouflon_keys"
  | "get_mouflon_keys";

export interface NetLiveScriptContext {
  fetch: (url: string, init?: NetLiveScriptFetchInit) => Promise<NetLiveScriptFetchResponse>;
  invoke: <T = unknown>(cmd: AllowedTauriCommand, args?: Record<string, unknown>) => Promise<T>;
  log: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
  utils: {
    buildUrl: (base: string, query?: Record<string, unknown>) => string;
    sleep: (ms: number) => Promise<void>;
    base64Encode: (s: string) => string;
    base64Decode: (s: string) => string;
  };
  protocols: {
    hlsStream: (opts: { url: string; qn?: string; qnLabel?: string; referer?: string; ua?: string; alternatives?: Array<{ qn: string; label: string; url: string }> }) => NetLiveStream;
    flvStream: (opts: { url: string; qn?: string; qnLabel?: string; referer?: string; ua?: string; alternatives?: Array<{ qn: string; label: string; url: string }> }) => NetLiveStream;
    dashStream: (opts: { url: string; qn?: string; qnLabel?: string; referer?: string; ua?: string }) => NetLiveStream;
    mp4Stream: (opts: { url: string; qn?: string; qnLabel?: string; referer?: string; ua?: string }) => NetLiveStream;
    chunkedMp4Stream: (opts: { url: string; referer?: string; ua?: string }) => NetLiveStream;
    sampleAesMp4Stream: (opts: { url: string; referer?: string; ua?: string }) => NetLiveStream;
    agoraStream: (opts: { appId: string; channelId: string; token: string; uid: number; refresh?: () => Promise<{ channelId: string; token: string; uid: number }>; referer?: string; ua?: string }) => NetLiveStream;
    parseMasterPlaylist: (text: string, opts: { masterUrl: string; sortByBandwidthDesc?: boolean; labelStrategy?: "resolution" | "media-name" }) => Array<{ qn: string; label: string; url: string; bandwidth: number }>;
  };
}

export interface NetLiveScriptFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  http2?: boolean;
}

export interface NetLiveScriptFetchResponse {
  url: string;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  text: () => Promise<string>;
  json: <T = unknown>() => Promise<T>;
}

export interface NetLiveScriptModule {
  manifest: NetLiveScriptManifest;
  resolve: (ctx: NetLiveScriptContext, args: { roomId: string }) => Promise<NetLiveStream>;
  getRecommend?: (ctx: NetLiveScriptContext, args: { page: number; pageSize: number }) => Promise<{ list: NetLiveRoom[]; hasMore: boolean }>;
  search?: (ctx: NetLiveScriptContext, args: { keyword: string; page: number }) => Promise<{ list: NetLiveRoom[]; hasMore: boolean }>;
  getCategories?: (ctx: NetLiveScriptContext) => Promise<NetLiveCategory[]>;
  getCategoryRooms?: (ctx: NetLiveScriptContext, args: { categoryId: string; page: number }) => Promise<{ list: NetLiveRoom[]; hasMore: boolean }>;
  getRoomDetail?: (ctx: NetLiveScriptContext, args: { roomId: string }) => Promise<NetLiveRoom>;
  getLiveStatus?: (ctx: NetLiveScriptContext, args: { roomId: string }) => Promise<boolean>;
}

export interface NetLivePluginDescriptor {
  key: string;
  name: string;
  code: string;
  enabled: boolean;
  installedAt?: number;
  updatedAt?: number;
}
