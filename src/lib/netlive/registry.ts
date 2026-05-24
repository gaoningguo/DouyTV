/**
 * 网络直播 adapter 注册表。新增平台时在这里注册即可。
 *
 * 18+ 成人平台（chaturbate/stripchat/bongacams/camsoda/pandalive）在注册表里
 * 始终可获取，是否对 UI 暴露由 `useNetLiveStore.adultEnabled` 决定
 * （见 stores/netlive.ts）。
 */
import { bilibiliAdapter } from "./platforms/bilibili";
import { douyuAdapter } from "./platforms/douyu";
import { huyaAdapter } from "./platforms/huya";
import { douyinAdapter } from "./platforms/douyin";
import { kuaishouAdapter } from "./platforms/kuaishou";
import { ccAdapter } from "./platforms/cc";
import { twitchAdapter } from "./platforms/twitch";
import { youtubeAdapter } from "./platforms/youtube";
import { kickAdapter } from "./platforms/kick";
import { trovoAdapter } from "./platforms/trovo";
import { bigoAdapter } from "./platforms/bigo";
import { live17Adapter } from "./platforms/live17";
import { chaturbateAdapter } from "./platforms/chaturbate";
import { stripchatAdapter } from "./platforms/stripchat";
import { bongacamsAdapter } from "./platforms/bongacams";
import { camsodaAdapter } from "./platforms/camsoda";
import { pandaliveAdapter } from "./platforms/pandalive";
import { soopAdapter } from "./platforms/soop";
import { fc2liveAdapter } from "./platforms/fc2live";
// StreaMonitor 系成人 cam 平台 (2026-05 加 12 个,4 个含 listing + 8 个 resolve-only)
import { amateurtvAdapter } from "./platforms/amateurtv";
import { cam4Adapter } from "./platforms/cam4";
import { camscomAdapter } from "./platforms/camscom";
import { dreamcamAdapter } from "./platforms/dreamcam";
import { fanslyAdapter } from "./platforms/fansly";
import { flirt4freeAdapter } from "./platforms/flirt4free";
import { manyvidsAdapter } from "./platforms/manyvids";
import { myfreecamsAdapter } from "./platforms/myfreecams";
import { sexchathuAdapter } from "./platforms/sexchathu";
import { streamateAdapter } from "./platforms/streamate";
import { xlovecamAdapter } from "./platforms/xlovecam";
import type { NetLiveAdapter, NetLivePlatformId } from "./types";

const adapters: Partial<Record<NetLivePlatformId, NetLiveAdapter>> = {
  bilibili: bilibiliAdapter,
  douyu: douyuAdapter,
  huya: huyaAdapter,
  douyin: douyinAdapter,
  kuaishou: kuaishouAdapter,
  cc: ccAdapter,
  twitch: twitchAdapter,
  youtube: youtubeAdapter,
  kick: kickAdapter,
  trovo: trovoAdapter,
  bigo: bigoAdapter,
  live17: live17Adapter,
  chaturbate: chaturbateAdapter,
  stripchat: stripchatAdapter,
  bongacams: bongacamsAdapter,
  camsoda: camsodaAdapter,
  pandalive: pandaliveAdapter,
  soop: soopAdapter,
  fc2live: fc2liveAdapter,
  amateurtv: amateurtvAdapter,
  cam4: cam4Adapter,
  camscom: camscomAdapter,
  dreamcam: dreamcamAdapter,
  fansly: fanslyAdapter,
  flirt4free: flirt4freeAdapter,
  manyvids: manyvidsAdapter,
  myfreecams: myfreecamsAdapter,
  sexchathu: sexchathuAdapter,
  streamate: streamateAdapter,
  xlovecam: xlovecamAdapter,
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
