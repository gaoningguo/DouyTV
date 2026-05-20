/**
 * 网络直播 adapter 注册表。新增平台时在这里注册即可。
 */
import { bilibiliAdapter } from "./platforms/bilibili";
import { douyuAdapter } from "./platforms/douyu";
import { huyaAdapter } from "./platforms/huya";
import { douyinAdapter } from "./platforms/douyin";
import { kuaishouAdapter } from "./platforms/kuaishou";
import { ccAdapter } from "./platforms/cc";
import type { NetLiveAdapter, NetLivePlatformId } from "./types";

const adapters: Partial<Record<NetLivePlatformId, NetLiveAdapter>> = {
  bilibili: bilibiliAdapter,
  douyu: douyuAdapter,
  huya: huyaAdapter,
  douyin: douyinAdapter,
  kuaishou: kuaishouAdapter,
  cc: ccAdapter,
};

export function getAdapter(platform: NetLivePlatformId): NetLiveAdapter {
  const a = adapters[platform];
  if (!a) throw new Error(`暂不支持平台「${platform}」`);
  return a;
}

export function listSupportedPlatforms(): NetLivePlatformId[] {
  return Object.keys(adapters) as NetLivePlatformId[];
}

export function isPlatformSupported(platform: NetLivePlatformId): boolean {
  return platform in adapters;
}
