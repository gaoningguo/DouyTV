// 小说模块配置读取 —— 替代 MoonTVPlus 服务端 getConfig()/env。
//
// MoonTVPlus 的 legado.client / opds.client 通过 `resolveLegadoConfig()` /
// `resolveOPDSConfig()` 从服务端 admin config + env 拿书源。DouyTV 没有服务端,
// 书源来自 book store 落到 localStorage 的三份数据:
//   - 手动添加的书源(OPDS/Legado 单条)         → douytv:book-sources
//   - Legado 订阅元数据(实际书源在 subscription-store 分块) → douytv:book-subscriptions
//   - 阅读/TTS 设置                               → douytv:book-settings
//
// 引擎(legado/opds client)直接读这里,避免和 zustand store 循环依赖。store 写、
// config 读,同一批 localStorage key。

import { legadoSubscriptionStore } from "./subscription-store";
import type { BookSource, LegadoSubscriptionMeta } from "./types";

export const BOOK_SOURCES_KEY = "douytv:book-sources";
export const BOOK_SUBSCRIPTIONS_KEY = "douytv:book-subscriptions";
export const BOOK_SETTINGS_KEY = "douytv:book-settings";

function loadArr<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/** 手动添加的书源(OPDS + Legado 单条),不含订阅书源。 */
export function loadManualBookSources(): BookSource[] {
  return loadArr<BookSource>(BOOK_SOURCES_KEY);
}

export function loadBookSubscriptions(): LegadoSubscriptionMeta[] {
  return loadArr<LegadoSubscriptionMeta>(BOOK_SUBSCRIPTIONS_KEY);
}

/** 手动书源 + 所有启用订阅展开后的书源,已按 enabled 过滤。 */
export async function resolveAllBookSources(): Promise<BookSource[]> {
  const manual = loadManualBookSources().filter(
    (source) => !!source.url && source.enabled !== false
  );
  const subs = loadBookSubscriptions();
  const subscriptionSources =
    await legadoSubscriptionStore.getSourcesForSubscriptions(subs);
  return [...manual, ...subscriptionSources];
}

/** 只要 OPDS 书源(手动,订阅目前只承载 Legado)。 */
export async function resolveOpdsSources(): Promise<BookSource[]> {
  return (await resolveAllBookSources()).filter(
    (source) => (source.type || "opds") === "opds" && !source.legado
  );
}

/** 只要 Legado 书源(手动 + 订阅)。 */
export async function resolveLegadoSources(): Promise<BookSource[]> {
  return (await resolveAllBookSources()).filter(
    (source) => source.type === "legado" || !!source.legado
  );
}
