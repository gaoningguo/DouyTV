/**
 * 网络直播 adapter 注册表 —— 纯外部插件实现。
 *
 * 主仓库不再硬编码 platforms/*.ts，全部 30 个平台均通过外部插件提供
 * (DouyTV-plugins repo 的 JS 沙盒插件，由 useExternalPluginStore 加载)。
 */
import type { NetLiveAdapter, NetLivePlatformId } from "./types";
import type { NetLivePlugin } from "./plugin";

const externalPlugins = new Map<string, NetLivePlugin>();
const externalAdapters = new Map<string, NetLiveAdapter>();

export function getAdapter(platform: NetLivePlatformId): Promise<NetLiveAdapter> {
  const adapter = externalAdapters.get(platform);
  if (!adapter) {
    return Promise.reject(new Error(`暂不支持平台「${platform}」(请在设置→直播插件中安装)`));
  }
  return Promise.resolve(adapter);
}

export function listSupportedPlatforms(): NetLivePlatformId[] {
  return Array.from(externalAdapters.keys());
}

export function isPlatformSupported(platform: NetLivePlatformId): boolean {
  return externalAdapters.has(platform);
}

export function getPlugin(platform: NetLivePlatformId): Promise<NetLivePlugin> {
  const plugin = externalPlugins.get(platform);
  if (!plugin) {
    return Promise.reject(new Error(`暂不支持平台「${platform}」`));
  }
  return Promise.resolve(plugin);
}

export function registerPlugin(plugin: NetLivePlugin): () => void {
  const id = plugin.manifest.id;
  externalPlugins.set(id, plugin);
  externalAdapters.set(id, plugin.create());
  return () => {
    externalPlugins.delete(id);
    externalAdapters.delete(id);
  };
}

export function listRegisteredPlugins(): NetLivePlugin[] {
  return Array.from(externalPlugins.values());
}
