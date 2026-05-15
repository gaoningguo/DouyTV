import { createContext } from "./context";
import { makeCmsScriptModule } from "./cms";
import type {
  ScriptContext,
  ScriptDescriptor,
  ScriptDetailResult,
  ScriptModule,
  ScriptResolveResult,
  ScriptSearchResult,
  ScriptSourceItem,
} from "./types";

interface CompiledEntry {
  codeHash: string;
  module: ScriptModule;
}

const compiledCache = new Map<string, CompiledEntry>();

function hashCode(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

function compile(code: string): ScriptModule {
  const fn = new Function('"use strict";\n' + code);
  const mod = fn();
  if (!mod || typeof mod !== "object") {
    throw new Error("source-script must `return { ... }` an object at top level");
  }
  return mod as ScriptModule;
}

export function loadScript(desc: ScriptDescriptor): ScriptModule {
  const cacheKey = desc.key;
  const type = desc.type ?? "script";

  if (type === "cms") {
    // CMS 源不需要源码哈希，直接用 api+ua+referer 组合做缓存键
    const fingerprint = `cms|${desc.api ?? ""}|${desc.ua ?? ""}|${desc.referer ?? ""}|${desc.detail ?? ""}`;
    const cached = compiledCache.get(cacheKey);
    if (cached && cached.codeHash === fingerprint) return cached.module;
    const module = makeCmsScriptModule(desc);
    compiledCache.set(cacheKey, { codeHash: fingerprint, module });
    return module;
  }

  // type === 'script'
  if (!desc.code) {
    throw new Error(`script source "${desc.key}" missing code`);
  }
  const hash = hashCode(desc.code);
  const cached = compiledCache.get(cacheKey);
  if (cached && cached.codeHash === hash) return cached.module;
  const module = compile(desc.code);
  compiledCache.set(cacheKey, { codeHash: hash, module });
  return module;
}

export function clearCompiledCache(key?: string) {
  if (key) compiledCache.delete(key);
  else compiledCache.clear();
}

function ctxFor(desc: ScriptDescriptor, sourceId?: string): ScriptContext {
  return createContext({
    scriptKey: desc.key,
    sourceId,
    config: desc.config,
  });
}

export async function callGetSources(
  desc: ScriptDescriptor
): Promise<ScriptSourceItem[]> {
  const mod = loadScript(desc);
  if (!mod.getSources) {
    return [{ id: "default", name: mod.meta?.name ?? desc.name }];
  }
  return mod.getSources(ctxFor(desc));
}

export async function callSearch(
  desc: ScriptDescriptor,
  args: { keyword: string; page: number; sourceId?: string }
): Promise<ScriptSearchResult> {
  const mod = loadScript(desc);
  if (!mod.search) {
    throw new Error(`script ${desc.key} has no \`search\` hook`);
  }
  return mod.search(ctxFor(desc, args.sourceId), args);
}

export async function callRecommend(
  desc: ScriptDescriptor,
  args: { page: number; sourceId?: string }
): Promise<ScriptSearchResult> {
  const mod = loadScript(desc);
  if (!mod.recommend) {
    return { list: [], page: args.page, pageCount: 0, total: 0 };
  }
  return mod.recommend(ctxFor(desc, args.sourceId), args);
}

export async function callDetail(
  desc: ScriptDescriptor,
  args: { id: string; sourceId?: string }
): Promise<ScriptDetailResult> {
  const mod = loadScript(desc);
  if (!mod.detail) {
    throw new Error(`script ${desc.key} has no \`detail\` hook`);
  }
  return mod.detail(ctxFor(desc, args.sourceId), args);
}

export async function callResolvePlayUrl(
  desc: ScriptDescriptor,
  args: { playUrl: string; sourceId?: string; episodeIndex?: number }
): Promise<ScriptResolveResult> {
  const mod = loadScript(desc);
  if (!mod.resolvePlayUrl) {
    return { url: args.playUrl, type: "auto", headers: {} };
  }
  return mod.resolvePlayUrl(ctxFor(desc, args.sourceId), args);
}

export function validateDescriptor(desc: unknown): desc is ScriptDescriptor {
  if (!desc || typeof desc !== "object") return false;
  const d = desc as Record<string, unknown>;
  if (typeof d.key !== "string" || typeof d.name !== "string") return false;
  if (d.enabled !== undefined && typeof d.enabled !== "boolean") return false;
  const type = (d.type as string | undefined) ?? "script";
  if (type === "script") return typeof d.code === "string";
  if (type === "cms") return typeof d.api === "string" && d.api.length > 0;
  return false;
}
