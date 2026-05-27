/**
 * WebSocket 信令协议封装 —— 统一 Rust 端 WS 命令的 TS 调用接口。
 *
 * FC2 Live / MyFreeCams / AmateurTV 等平台需要先通过 WebSocket 信令
 * 获取 HLS URL 或建立媒体通道。这些 WS 逻辑在 Rust 端实现
 * (fc2_ws.rs / mfc_ws.rs / amateurtv_ws.rs)，TS 侧通过 Tauri invoke 调用。
 *
 * 本模块提供统一的调用封装，插件可以通过这些 helper 使用 WS 信令能力，
 * 而不需要直接 import Tauri API。
 */

export interface WsResolveOptions {
  proxy?: string | null;
}

export async function fc2ResolveHls(
  channelId: string,
  opts?: WsResolveOptions
): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("fc2_resolve_hls", {
    channelId,
    proxyUrl: opts?.proxy ?? null,
  });
}

export async function fc2Diagnose(
  channelId: string,
  opts?: WsResolveOptions
): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("fc2_diagnose", {
    channelId,
    proxyUrl: opts?.proxy ?? null,
  });
}

export interface MfcListItem {
  nm: string;
  uid: number;
  vs: number;
  topic?: string;
  camserv: number;
  hls_url?: string;
  thumb_url?: string;
  camscore?: number;
  rc?: number;
  country?: string;
}

export async function mfcListOnline(
  opts?: WsResolveOptions
): Promise<MfcListItem[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<MfcListItem[]>("mfc_list_online", {
    proxyUrl: opts?.proxy ?? null,
  });
}

export async function mfcDiagnose(
  opts?: WsResolveOptions
): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("mfc_diagnose", {
    proxyUrl: opts?.proxy ?? null,
  });
}
