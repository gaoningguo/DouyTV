/**
 * Catalogue registry —— 三模块共享的源解析路由表。
 *
 * 工作流程：
 *   1. native adapter（如 `netlive/platforms/bilibili.ts`）启动时调用 `registerNative()` 把自己挂到注册表。
 *   2. UI / store 持有 descriptor list（legado-json / script / native），需要查源时调 `resolveModule(desc)`。
 *   3. 该函数按 type 走对应路径：
 *        - `native` → 从内置注册表里取
 *        - `legado-json` → 用 legado-bridge 把 JSON 包成 module
 *        - `script` → 用 script-runtime 编译 user JS
 *
 * Registry 对模块的访问完全无副作用 —— 状态管理由各模块的 zustand store 自己处理。
 */
import type {
  CatalogueCategory,
  CatalogueDescriptor,
  CatalogueSourceModule,
} from "./types";
import {
  legadoBookBridge,
  legadoMangaBridge,
  bookSourceToMeta,
  mangaSourceToMeta,
} from "./legado-bridge";
import { buildScriptModule } from "./script-runtime";
import type { BookSourceV2 } from "@/lib/booksources/types";
import type { MangaSourceV2 } from "@/lib/mangasources/types";

/* ───────────────── Native adapter registry ───────────────── */

const nativeAdapters = new Map<string, CatalogueSourceModule>();

function nativeKey(category: CatalogueCategory, id: string): string {
  return `${category}:${id}`;
}

export function registerNative(module: CatalogueSourceModule): void {
  const key = nativeKey(module.meta.category, module.meta.id);
  nativeAdapters.set(key, module);
}

export function unregisterNative(category: CatalogueCategory, id: string): void {
  nativeAdapters.delete(nativeKey(category, id));
}

export function listNativeAdapters(
  category?: CatalogueCategory
): CatalogueSourceModule[] {
  const all = Array.from(nativeAdapters.values());
  return category ? all.filter((m) => m.meta.category === category) : all;
}

/* ───────────────── Descriptor → Module ───────────────── */

export function resolveModule(desc: CatalogueDescriptor): CatalogueSourceModule {
  if (desc.type === "native") {
    const m = nativeAdapters.get(nativeKey(desc.meta.category, desc.meta.id));
    if (!m) {
      throw new Error(
        `native adapter not registered: ${desc.meta.category}/${desc.meta.id}`
      );
    }
    return m;
  }
  if (desc.type === "script") {
    return buildScriptModule(desc);
  }
  // legado-json
  if (desc.meta.category === "book") {
    return legadoBookBridge(desc.legado as BookSourceV2, desc.meta);
  }
  if (desc.meta.category === "manga") {
    return legadoMangaBridge(desc.legado as MangaSourceV2, desc.meta);
  }
  throw new Error(
    `legado-json source not supported for category "${desc.meta.category}"`
  );
}

/* ───────────────── 兼容旧 store 的便捷构造 ───────────────── */

export function descriptorForBookSource(s: BookSourceV2): CatalogueDescriptor {
  return {
    type: "legado-json",
    meta: bookSourceToMeta(s),
    legado: s,
  };
}

export function descriptorForMangaSource(
  s: MangaSourceV2
): CatalogueDescriptor {
  return {
    type: "legado-json",
    meta: mangaSourceToMeta(s),
    legado: s,
  };
}
