/**
 * Catalogue script-runtime —— 编译并执行用户 JS 形态的 catalogue source。
 *
 * 与 `src/source-script/runtime.ts` 结构对称：
 *   - `new Function('"use strict";\n' + code)` 沙盒
 *   - top-level `return { ... }` 一个对象（无 meta 字段，meta 由 descriptor 提供）
 *   - ctx 注入：fetch / request / html / cache / log / utils / config / source
 *
 * **安全提示**：`new Function` 不是真沙盒，能访问 globalThis。导入第三方 JS source 时 UI 必须警示。
 */
import { scriptFetch } from "@/source-script/fetch";
import { loadHtml } from "@/source-script/html";
import { createCache } from "@/source-script/cache";
import { createLog } from "@/source-script/log";
import { utils } from "@/source-script/utils";
import type {
  CatalogueCtx,
  CatalogueDescriptor,
  CatalogueDetail,
  CatalogueFetchInit,
  CatalogueFetchResponse,
  CatalogueFilter,
  CatalogueItem,
  CatalogueMeta,
  CatalogueSourceModule,
  CatalogueUnit,
  CatalogueUnitContent,
  FilterValues,
} from "./types";

interface UserScriptModule {
  popular?: CatalogueSourceModule["popular"];
  latest?: CatalogueSourceModule["latest"];
  search?: CatalogueSourceModule["search"];
  filters?: CatalogueSourceModule["filters"];
  categories?: CatalogueSourceModule["categories"];
  categoryItems?: CatalogueSourceModule["categoryItems"];
  detail?: CatalogueSourceModule["detail"];
  units?: CatalogueSourceModule["units"];
  unitContent?: CatalogueSourceModule["unitContent"];
}

interface CompiledEntry {
  codeHash: string;
  module: UserScriptModule;
}

const compiledCache = new Map<string, CompiledEntry>();

function hashCode(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

function compile(code: string): UserScriptModule {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const fn = new Function('"use strict";\n' + code);
  const mod = fn();
  if (!mod || typeof mod !== "object") {
    throw new Error(
      "catalogue script must `return { ... }` an object at top level"
    );
  }
  return mod as UserScriptModule;
}

function ensureCompiled(code: string, key: string): UserScriptModule {
  const hash = hashCode(code);
  const cached = compiledCache.get(key);
  if (cached && cached.codeHash === hash) return cached.module;
  const module = compile(code);
  compiledCache.set(key, { codeHash: hash, module });
  return module;
}

export function clearCompiledCache(key?: string) {
  if (key) compiledCache.delete(key);
  else compiledCache.clear();
}

/* ───────────────── ctx 构建 ───────────────── */

function adaptFetch(fetchInit?: CatalogueFetchInit): CatalogueFetchInit {
  return fetchInit ?? {};
}

function makeCtx(meta: CatalogueMeta, config: Record<string, unknown>): CatalogueCtx {
  const cacheKey = `cat:${meta.category}:${meta.id}`;
  return {
    fetch: (url, init) =>
      scriptFetch(url, adaptFetch(init)) as Promise<CatalogueFetchResponse>,
    request: {
      get: (url, init) =>
        scriptFetch(url, {
          ...adaptFetch(init),
          method: "GET",
        }) as Promise<CatalogueFetchResponse>,
      getJson: async <T = unknown>(url: string, init?: CatalogueFetchInit) => {
        const res = await scriptFetch(url, { ...adaptFetch(init), method: "GET" });
        return res.json<T>();
      },
      getHtml: async (url: string, init?: CatalogueFetchInit) => {
        const res = await scriptFetch(url, { ...adaptFetch(init), method: "GET" });
        return res.text();
      },
      post: (url, init) =>
        scriptFetch(url, {
          ...adaptFetch(init),
          method: "POST",
        }) as Promise<CatalogueFetchResponse>,
    },
    html: { load: loadHtml },
    cache: createCache(cacheKey),
    log: createLog(`catalogue:${meta.id}`),
    utils,
    source: meta,
    config: {
      get: (k: string) => config[k],
      require: (k: string) => {
        if (!(k in config)) {
          throw new Error(
            `catalogue source "${meta.id}" requires config key "${k}" but it was not provided`
          );
        }
        return config[k];
      },
      all: () => ({ ...config }),
    },
  };
}

/* ───────────────── 公共 API ───────────────── */

/**
 * 把一个 descriptor.code 编译并包成完整 `CatalogueSourceModule` —— meta 来自 descriptor.meta。
 * 对每个 hook 做存在性检查（mihon HttpSource 有 popular/latest/search 三套，我们对应 popular/latest/search）。
 */
export function buildScriptModule(
  desc: Extract<CatalogueDescriptor, { type: "script" }>
): CatalogueSourceModule {
  const compiled = ensureCompiled(desc.code, desc.meta.id);
  const ctx = makeCtx(desc.meta, desc.config ?? {});
  const m: CatalogueSourceModule = {
    meta: desc.meta,
    detail: async (_innerCtx, id) => {
      if (!compiled.detail) {
        throw new Error(`catalogue script ${desc.meta.id} has no detail hook`);
      }
      return (compiled.detail as (
        c: CatalogueCtx,
        id: string
      ) => Promise<CatalogueDetail>)(ctx, id);
    },
    units: async (_innerCtx, detail) => {
      if (!compiled.units) {
        throw new Error(`catalogue script ${desc.meta.id} has no units hook`);
      }
      return (compiled.units as (
        c: CatalogueCtx,
        d: CatalogueDetail
      ) => Promise<CatalogueUnit[]>)(ctx, detail);
    },
    unitContent: async (_innerCtx, unit, detail) => {
      if (!compiled.unitContent) {
        throw new Error(
          `catalogue script ${desc.meta.id} has no unitContent hook`
        );
      }
      return (compiled.unitContent as (
        c: CatalogueCtx,
        u: CatalogueUnit,
        d: CatalogueDetail
      ) => Promise<CatalogueUnitContent>)(ctx, unit, detail);
    },
  };
  if (compiled.popular) {
    m.popular = async (_c, p) =>
      (compiled.popular as (c: CatalogueCtx, p: number) => Promise<{
        list: CatalogueItem[];
        hasMore: boolean;
      }>)(ctx, p);
  }
  if (compiled.latest) {
    m.latest = async (_c, p) =>
      (compiled.latest as (c: CatalogueCtx, p: number) => Promise<{
        list: CatalogueItem[];
        hasMore: boolean;
      }>)(ctx, p);
  }
  if (compiled.search) {
    m.search = async (_c, q, p, f?: FilterValues) =>
      (compiled.search as (
        c: CatalogueCtx,
        q: string,
        p: number,
        f?: FilterValues
      ) => Promise<{ list: CatalogueItem[]; hasMore: boolean }>)(ctx, q, p, f);
  }
  if (compiled.filters) {
    m.filters = async (_c) =>
      (compiled.filters as (c: CatalogueCtx) => Promise<CatalogueFilter[]>)(ctx);
  }
  if (compiled.categories) {
    m.categories = async (_c) =>
      (compiled.categories as (c: CatalogueCtx) => Promise<
        Array<{ id: string; name: string; cover?: string; parent?: string }>
      >)(ctx);
  }
  if (compiled.categoryItems) {
    m.categoryItems = async (_c, cid, p) =>
      (compiled.categoryItems as (
        c: CatalogueCtx,
        cid: string,
        p: number
      ) => Promise<{ list: CatalogueItem[]; hasMore: boolean }>)(ctx, cid, p);
  }
  return m;
}

export function validateScriptDescriptor(d: unknown): boolean {
  if (!d || typeof d !== "object") return false;
  const v = d as Record<string, unknown>;
  if (v.type !== "script") return false;
  if (!v.meta || typeof v.meta !== "object") return false;
  if (typeof v.code !== "string" || v.code.length === 0) return false;
  return true;
}
