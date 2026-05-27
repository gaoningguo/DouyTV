/**
 * 网络直播插件接口 —— 把 adapter (运行时行为) 和 manifest (元数据/能力) 解耦,
 * 为未来外部插件 (用户自定义 JS) 铺路。
 *
 * 内置 30 个平台不强制改造,registry 层会从现有 adapter + NETLIVE_PLATFORMS
 * 自动桥接出 plugin 实例 (见 registry.ts#wrapAdapterAsPlugin)。
 *
 * 外部插件作者用 definePlugin() 包装,并显式声明 capabilities + engine 版本,
 * runtime 校验后才注册到 registry。
 */
import type { NetLiveAdapter, NetLivePlatformMeta } from "./types";

export const NETLIVE_API_VERSION = 1;

export interface NetLivePluginCapabilities {
  recommend?: boolean;
  search?: boolean;
  categories?: boolean;
  roomDetail?: boolean;
  liveStatus?: boolean;
}

export interface NetLivePlugin {
  manifest: NetLivePlatformMeta;
  create(): NetLiveAdapter;
  capabilities?: NetLivePluginCapabilities;
  engine?: { netliveApi: number };
}

export function definePlugin(p: NetLivePlugin): NetLivePlugin {
  return p;
}

export function deriveCapabilities(a: NetLiveAdapter): NetLivePluginCapabilities {
  return {
    recommend: typeof a.getRecommend === "function",
    search: typeof a.search === "function",
    categories: typeof a.getCategories === "function",
    roomDetail: typeof a.getRoomDetail === "function",
    liveStatus: typeof a.getLiveStatus === "function",
  };
}
