/**
 * 播放预解析缓存 —— 让「下一集 / 下一条」切换丝滑。
 *
 * 本项目是「单 ArtPlayer 实例 + art.switch」架构，做不到零缓冲无缝（那需要第二个
 * 隐藏播放器预热 HLS 缓冲）。这里做性价比最高的一层：把切换前最耗时的
 * `callResolvePlayUrl`（有的源要再请求一次拿真实地址）和 `callDetail` 结果提前算好、
 * 带 TTL 缓存。切集/切片时 usePlayback / useDetail 直接命中缓存，跳过「RESOLVING」等待。
 *
 * TTL：解析出的地址常带时效 token，故 TTL 取短（5min）；detail 变动少，取 10min。
 * 命中过期或没命中都会退回正常解析，最坏情况 = 现状，不会更差。
 */
import { callDetail, callResolvePlayUrl } from "@/source-script/runtime";
import type {
  ScriptDescriptor,
  ScriptDetailResult,
  ScriptResolveResult,
} from "@/source-script/types";

const RESOLVE_TTL = 5 * 60 * 1000;
const DETAIL_TTL = 10 * 60 * 1000;

interface Entry<T> {
  at: number;
  ttl: number;
  promise: Promise<T>;
  value?: T;
  error?: boolean;
}

const resolveCache = new Map<string, Entry<ScriptResolveResult>>();
const detailCache = new Map<string, Entry<ScriptDetailResult>>();

interface ResolveArgs {
  playUrl: string;
  sourceId?: string;
  episodeIndex?: number;
}

function resolveKey(desc: ScriptDescriptor, a: ResolveArgs): string {
  return `${desc.key}|${a.sourceId ?? ""}|${a.playUrl}`;
}

function fresh<T>(e: Entry<T> | undefined): e is Entry<T> {
  return !!e && !e.error && Date.now() - e.at < e.ttl;
}

/** 同步窥探已缓存的解析结果（仅返回已 settle 的值）—— usePlayback 用它避免 RESOLVING 闪烁。 */
export function peekResolved(
  desc: ScriptDescriptor,
  a: ResolveArgs
): ScriptResolveResult | undefined {
  const e = resolveCache.get(resolveKey(desc, a));
  return fresh(e) && e.value ? e.value : undefined;
}

/** 拿解析结果：命中新鲜缓存（含 in-flight 去重）直接复用，否则解析并写缓存。 */
export function getResolved(
  desc: ScriptDescriptor,
  a: ResolveArgs
): Promise<ScriptResolveResult> {
  const key = resolveKey(desc, a);
  const cached = resolveCache.get(key);
  if (fresh(cached)) return cached.promise;
  const entry: Entry<ScriptResolveResult> = {
    at: Date.now(),
    ttl: RESOLVE_TTL,
    promise: Promise.resolve({ url: a.playUrl }),
  };
  entry.promise = callResolvePlayUrl(desc, a)
    .then((v) => {
      entry.value = v;
      return v;
    })
    .catch((err) => {
      entry.error = true;
      throw err;
    });
  resolveCache.set(key, entry);
  return entry.promise;
}

/** 预取解析（fire-and-forget）。反复调用因去重而廉价。 */
export function prefetchResolved(desc: ScriptDescriptor, a: ResolveArgs): void {
  void getResolved(desc, a).catch(() => {});
}

/** 拿 detail：命中新鲜缓存直接复用，否则请求并写缓存。 */
export function getDetailCached(
  desc: ScriptDescriptor,
  vodId: string
): Promise<ScriptDetailResult> {
  const key = `${desc.key}|${vodId}`;
  const cached = detailCache.get(key);
  if (fresh(cached)) return cached.promise;
  const entry: Entry<ScriptDetailResult> = {
    at: Date.now(),
    ttl: DETAIL_TTL,
    promise: Promise.resolve({} as ScriptDetailResult),
  };
  entry.promise = callDetail(desc, { id: vodId })
    .then((v) => {
      entry.value = v;
      return v;
    })
    .catch((err) => {
      entry.error = true;
      throw err;
    });
  detailCache.set(key, entry);
  return entry.promise;
}

function firstPlayableEpisodeArgs(
  detail: ScriptDetailResult
): ResolveArgs | undefined {
  const pb = detail.playbacks.find((p) => p.episodes.length > 0);
  if (!pb) return undefined;
  const ep = pb.episodes[0];
  const playUrl = typeof ep === "string" ? ep : ep.playUrl;
  const needResolve = typeof ep === "string" ? true : ep.needResolve !== false;
  if (!needResolve) return undefined;
  return { playUrl, sourceId: pb.sourceId, episodeIndex: 0 };
}

/** 预取同一 playback 里指定集的解析地址。 */
export function prefetchEpisode(
  desc: ScriptDescriptor,
  playback: ScriptDetailResult["playbacks"][number],
  epIdx: number
): void {
  const ep = playback.episodes[epIdx];
  if (ep === undefined) return;
  const playUrl = typeof ep === "string" ? ep : ep.playUrl;
  const needResolve = typeof ep === "string" ? true : ep.needResolve !== false;
  if (!needResolve) return;
  prefetchResolved(desc, {
    playUrl,
    sourceId: playback.sourceId,
    episodeIndex: epIdx,
  });
}

/** 预取「下一条视频」：先取它的 detail，再预取首集解析地址。 */
export function prefetchItem(desc: ScriptDescriptor, vodId: string): void {
  void getDetailCached(desc, vodId)
    .then((detail) => {
      const args = firstPlayableEpisodeArgs(detail);
      if (args) prefetchResolved(desc, args);
    })
    .catch(() => {});
}
