/**
 * NetLive 平台专用的 fetch 包装层 —— 在调用底层 scriptFetch 之前,根据 per-platform
 * 代理覆盖(见 stores/netliveProxy.ts)注入显式 proxyOverride。
 *
 * 用法 —— 每个 adapter 在文件顶部:
 *
 *   import { createPlatformFetch } from "@/lib/netlive/scriptFetch";
 *   const scriptFetch = createPlatformFetch("camsoda");
 *
 * 之后 adapter 内部代码完全不变,所有 scriptFetch 调用自动遵循该平台的 override。
 */
import { scriptFetch as baseScriptFetch } from "@/source-script/fetch";
import type { ScriptFetchInit, ScriptFetchResponse } from "@/source-script/types";
import { resolveProxyForPlatform } from "@/stores/netliveProxy";
import type { NetLivePlatformId } from "./types";

export type PlatformFetch = (
  url: string,
  init?: ScriptFetchInit,
) => Promise<ScriptFetchResponse>;

export function createPlatformFetch(platform: NetLivePlatformId): PlatformFetch {
  return (url, init = {}) => {
    // 如果调用方已经显式传了 proxyOverride,尊重调用方 —— 平台默认让位给精细控制
    if (init.proxyOverride !== undefined) {
      return baseScriptFetch(url, init);
    }
    const { proxyUrl, bypass } = resolveProxyForPlatform(platform);
    const override: string | null = bypass ? null : (proxyUrl ?? null);
    return baseScriptFetch(url, { ...init, proxyOverride: override });
  };
}
