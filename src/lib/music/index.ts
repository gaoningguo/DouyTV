import { scriptFetch } from "@/source-script/fetch";
import { initStreamProxyPort, wrapAudioUrl } from "@/lib/proxy";
import { searchAggregate, resolveAggregate } from "./aggregate";
import { searchLxServer, resolveLxServer } from "./lxServer";
import { searchPlugin, resolvePlugin } from "./pluginAdapter";
import {
  searchNeteaseApi,
  resolveNeteaseApi,
  isExternalNetease,
  resolveNeteaseUnblockMatch,
} from "./neteaseApi";
import { searchCyrene, resolveCyrene } from "./cyreneApi";
import { unblockMatch, type UnblockSource } from "./unblock";
import { parseLxScript, looksLikeLxSource, type LxSourceParsed } from "./lxSource";
import { isMusicPreviewError } from "./playback";
import type {
  MusicPlayResult,
  MusicQuality,
  MusicSearchResult,
  MusicSourceDescriptor,
  NeteaseSourceMode,
} from "./types";
import { MUSIC_PLATFORMS } from "./types";
import { asRecord, asString, cleanBaseUrl, stableId, tryParseJson } from "./utils";

export * from "./types";
export * from "./discovery";
export * from "./discoveryAggregate";
export * from "./playback";
export * from "./neteaseApi";
export * from "./localMusic";
export * from "./localMusicDb";
export * from "./lxSource";
export * from "./lxRuntime";
export * from "./cyreneConfig";

const DEFAULT_LIMIT = 30;

export function normalizeMusicSourceDescriptor(
  input: Partial<MusicSourceDescriptor>
): MusicSourceDescriptor {
  const now = Date.now();
  const kind = input.kind ?? "lx-server";
  const neteaseMode: NeteaseSourceMode | undefined =
    kind === "netease-api"
      ? input.neteaseMode ?? (cleanBaseUrl(input.baseUrl) ? "external" : "builtin")
      : undefined;
  const name =
    input.name?.trim() ||
    (kind === "lx-server"
      ? "LX 音乐源"
      : kind === "netease-api"
        ? neteaseMode === "external"
          ? "网易云(自部署)"
          : "网易云(内置)"
        : kind === "cyrene-aggregate"
          ? "Cyrene 聚合源"
          : kind === "local"
            ? "本地音乐"
            : "音乐插件");
  const id =
    input.id?.trim() ||
    `music-${stableId(`${kind}:${name}:${input.baseUrl ?? input.code ?? now}`)}`;
  return {
    id,
    name,
    kind,
    enabled: input.enabled ?? true,
    description: input.description,
    baseUrl: cleanBaseUrl(input.baseUrl),
    token: input.token?.trim(),
    code: input.code,
    neteaseMode,
    cyreneMode: kind === "cyrene-aggregate" ? input.cyreneMode ?? "omni" : undefined,
    playBaseUrl: cleanBaseUrl(input.playBaseUrl) || undefined,
    urlPathTemplate: input.urlPathTemplate,
    lxMode:
      kind === "cyrene-aggregate" && (input.cyreneMode ?? "omni") === "lx"
        ? input.lxMode ?? "template"
        : undefined,
    defaultPlatform:
      input.defaultPlatform ??
      (kind === "lx-server" ? "all" : kind === "netease-api" ? "wy" : undefined),
    platforms:
      input.platforms && input.platforms.length > 0
        ? input.platforms
        : kind === "lx-server"
          ? MUSIC_PLATFORMS.map((item) => item.id)
          : undefined,
    headers: input.headers,
    searchUrl: input.searchUrl,
    playUrl: input.playUrl,
    lyricUrl: input.lyricUrl,
    searchMethod: input.searchMethod,
    playMethod: input.playMethod,
    lyricMethod: input.lyricMethod,
    searchBodyTemplate: input.searchBodyTemplate,
    playBodyTemplate: input.playBodyTemplate,
    lyricBodyTemplate: input.lyricBodyTemplate,
    itemPath: input.itemPath,
    fieldMap: input.fieldMap,
    installedAt: input.installedAt ?? now,
    updatedAt: now,
  };
}

export async function searchMusicSource(
  source: MusicSourceDescriptor,
  keyword: string,
  page = 1,
  limit = DEFAULT_LIMIT
): Promise<MusicSearchResult> {
  if (!source.enabled) return { list: [], page, limit, hasMore: false };
  switch (source.kind) {
    case "lx-server":
      return searchLxServer(source, keyword, page, limit);
    case "plugin-js":
      return searchPlugin(source, keyword, page, limit);
    case "aggregate-http":
      return searchAggregate(source, keyword, page, limit);
    case "netease-api":
      return searchNeteaseApi(source, keyword, page, limit);
    case "cyrene-aggregate":
      return searchCyrene(source, keyword, page, limit);
    case "local":
      // 本地音乐不按关键词搜索;曲库由 LocalView/musicLocal store 直接提供。
      return { list: [], page, limit, hasMore: false };
    default:
      return { list: [], page, limit, hasMore: false };
  }
}

export async function searchMusicSources(
  sources: MusicSourceDescriptor[],
  keyword: string,
  page = 1,
  limit = DEFAULT_LIMIT
): Promise<MusicSearchResult> {
  const enabled = sources.filter((source) => source.enabled);
  if (enabled.length === 0) throw new Error("请先启用音乐源");
  const settled = await Promise.allSettled(
    enabled.map((source) => searchMusicSource(source, keyword, page, limit))
  );
  const list = settled.flatMap((item) =>
    item.status === "fulfilled" ? item.value.list : []
  );
  if (list.length === 0) {
    const firstError = settled.find(
      (item): item is PromiseRejectedResult => item.status === "rejected"
    );
    if (firstError) throw firstError.reason;
  }
  return {
    list,
    page,
    limit,
    hasMore: settled.some(
      (item) => item.status === "fulfilled" && item.value.hasMore
    ),
  };
}

/**
 * 灰曲解灰上下文（由 UI 层从 music store 透传）。规则：
 *  - 有启用的外部网易云 API 源时，优先用其服务端 /song/url/match；
 *  - 否则（内置源/无外部源）走移植版 UNM（unblockMatch）。
 */
export interface UnblockContext {
  enabled: boolean;
  sources: UnblockSource[];
  /** 所有启用的源（用于挑外部网易 API）。 */
  allSources: MusicSourceDescriptor[];
}

interface ResolveOptions {
  proxy?: boolean;
  unblock?: UnblockContext;
}

/** 网易灰曲兜底解灰：返回直链字符串；不可用返回 undefined。 */
async function resolveNeteaseGray(
  song: Parameters<typeof resolveLxServer>[1],
  ctx: UnblockContext
): Promise<string | undefined> {
  if (!ctx.enabled) return undefined;
  const neteaseId = String(song.id);
  const sources = ctx.sources.map((s) => String(s));
  // 1) 优先外部网易云 API 的服务端解灰
  const external = ctx.allSources.find((s) => s.enabled && isExternalNetease(s));
  if (external) {
    const url = await resolveNeteaseUnblockMatch(external, neteaseId, sources);
    if (url) return url;
  }
  // 2) 回退移植版 UNM
  if (ctx.sources.length > 0) {
    const result = await unblockMatch(
      {
        neteaseId,
        name: song.title,
        artist: song.artist,
        durationMs: song.durationSec ? song.durationSec * 1000 : undefined,
      },
      ctx.sources
    );
    if (result) return result.url;
  }
  return undefined;
}

export async function resolveMusicSource(
  source: MusicSourceDescriptor,
  song: Parameters<typeof resolveLxServer>[1],
  quality: MusicQuality,
  options: ResolveOptions = {}
): Promise<MusicPlayResult> {
  if (source.kind === "local") {
    // 本地文件:directUrl 已是 convertFileSrc 后的 asset URL,直接播放,不走代理。
    const raw = (song.raw && typeof song.raw === "object" ? song.raw : {}) as { lyric?: string };
    const url = song.directUrl || song.id;
    return { url, directUrl: url, quality, lyric: raw.lyric || "" };
  }
  if (source.kind === "lx-server") await initStreamProxyPort();
  let result: MusicPlayResult;
  if (source.kind === "netease-api") {
    // 网易源:匿名直链拿不到(灰曲/VIP)时,按规则解灰兜底。
    try {
      result = await resolveNeteaseApi(source, song, quality);
    } catch (error) {
      const grayUrl = options.unblock
        ? await resolveNeteaseGray(song, options.unblock)
        : undefined;
      if (!grayUrl) throw error;
      result = { url: grayUrl, directUrl: grayUrl, quality };
    }
  } else {
    result =
      source.kind === "lx-server"
        ? await resolveLxServer(source, song, quality, {
            stableStream: options.proxy !== false,
          })
        : source.kind === "plugin-js"
          ? await resolvePlugin(source, song, quality)
          : source.kind === "cyrene-aggregate"
            ? await resolveCyrene(source, song, quality)
            : await resolveAggregate(source, song, quality);
  }
  if (options.proxy === false) return result;
  await initStreamProxyPort();
  // 已经是本地稳定流代理 URL（http://127.0.0.1:port/…）的就不再二次包装；
  // 仅对裸 CDN 直链套 wrapAudioUrl，保证 <audio crossOrigin> + Web Audio 不被跨域污染。
  if (/^https?:\/\/127\.0\.0\.1[:/]/.test(result.url)) return result;
  return {
    ...result,
    directUrl: result.directUrl ?? result.url,
    url: wrapAudioUrl(result.url, String(song.platform || ""), result.headers),
  };
}

// 音质降级链：高音质常无版权/超时，按此顺序回退到能放的档。
const QUALITY_FALLBACK: MusicQuality[] = ["flac24bit", "flac", "320k", "192k", "128k"];

/**
 * 带音质降级的解析：先试目标音质，失败（真错，非试听）则按 QUALITY_FALLBACK
 * 依次降级重试。试听片段错误（preview）直接抛出，交由上层跨平台候选逻辑处理。
 */
export async function resolveMusicSourceWithFallback(
  source: MusicSourceDescriptor,
  song: Parameters<typeof resolveLxServer>[1],
  quality: MusicQuality,
  options: ResolveOptions = {}
): Promise<MusicPlayResult> {
  const start = QUALITY_FALLBACK.indexOf(quality);
  const chain = start >= 0 ? QUALITY_FALLBACK.slice(start) : [quality];
  let lastError: unknown;
  for (const q of chain) {
    try {
      return await resolveMusicSource(source, song, q, options);
    } catch (error) {
      // 试听片段不是「音质问题」，降级也没用，直接上抛。
      if (isMusicPreviewError(error)) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("获取播放地址失败");
}

// ── 下一首预取缓存（命中即秒播）──
interface PrefetchEntry {
  result: MusicPlayResult;
  at: number;
}
const PREFETCH_TTL = 5 * 60 * 1000;
const prefetchCache = new Map<string, PrefetchEntry>();

function prefetchKey(sourceId: string, songId: string, quality: string): string {
  return `${sourceId}:${songId}:${quality}`;
}

/** 后台预取（失败静默）。重复调用同 key 直接跳过。 */
export async function prefetchMusicSource(
  source: MusicSourceDescriptor,
  song: Parameters<typeof resolveLxServer>[1] & { id: string },
  quality: MusicQuality,
  options: ResolveOptions = {}
): Promise<void> {
  const key = prefetchKey(source.id, song.id, quality);
  const hit = prefetchCache.get(key);
  if (hit && Date.now() - hit.at < PREFETCH_TTL) return;
  try {
    const result = await resolveMusicSource(source, song, quality, options);
    prefetchCache.set(key, { result, at: Date.now() });
    // 控制缓存体积。
    if (prefetchCache.size > 16) {
      const oldest = [...prefetchCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) prefetchCache.delete(oldest[0]);
    }
  } catch {
    // 预取失败无所谓，正式播放时再正常解析。
  }
}

/** 取并消费预取结果（命中后移除，避免播放过期 URL）。 */
export function takePrefetchedSource(
  sourceId: string,
  songId: string,
  quality: string
): MusicPlayResult | null {
  const key = prefetchKey(sourceId, songId, quality);
  const hit = prefetchCache.get(key);
  if (!hit) return null;
  prefetchCache.delete(key);
  if (Date.now() - hit.at >= PREFETCH_TTL) return null;
  return hit.result;
}

function sourceNameFromCode(code: string): string {
  const nameMatch =
    code.match(/name\s*[:=]\s*["'`]([^"'`]+)["'`]/) ||
    code.match(/platform\s*[:=]\s*["'`]([^"'`]+)["'`]/);
  return nameMatch?.[1] ? `插件 / ${nameMatch[1]}` : "音乐 JS 插件";
}

function descriptorFromObject(input: Record<string, unknown>): MusicSourceDescriptor {
  const type = asString(input.type) || asString(input.kind);
  const kind =
    type === "plugin-js" || type === "plugin" || type === "musicfree"
      ? "plugin-js"
      : type === "aggregate-http" || type === "http"
        ? "aggregate-http"
        : type === "netease-api" || type === "netease" || type === "ncm"
          ? "netease-api"
          : type === "cyrene-aggregate" || type === "cyrene" || type === "nekofun"
            ? "cyrene-aggregate"
            : "lx-server";
  return normalizeMusicSourceDescriptor({
    id: asString(input.id) || asString(input.key),
    name: asString(input.name),
    kind,
    enabled: input.enabled !== false,
    description: asString(input.description),
    baseUrl: asString(input.baseUrl) || asString(input.api),
    token: asString(input.token),
    code: asString(input.code) || asString(input.script),
    neteaseMode: asString(input.neteaseMode) as MusicSourceDescriptor["neteaseMode"],
    cyreneMode: asString(input.cyreneMode) as MusicSourceDescriptor["cyreneMode"],
    playBaseUrl: asString(input.playBaseUrl),
    urlPathTemplate: asString(input.urlPathTemplate),
    lxMode: asString(input.lxMode) as MusicSourceDescriptor["lxMode"],
    defaultPlatform: asString(input.defaultPlatform) as MusicSourceDescriptor["defaultPlatform"],
    headers: asRecord(input.headers) as Record<string, string> | undefined,
    searchUrl: asString(input.searchUrl),
    playUrl: asString(input.playUrl),
    lyricUrl: asString(input.lyricUrl),
    searchMethod: asString(input.searchMethod) as MusicSourceDescriptor["searchMethod"],
    playMethod: asString(input.playMethod) as MusicSourceDescriptor["playMethod"],
    lyricMethod: asString(input.lyricMethod) as MusicSourceDescriptor["lyricMethod"],
    searchBodyTemplate: asString(input.searchBodyTemplate),
    playBodyTemplate: asString(input.playBodyTemplate),
    lyricBodyTemplate: asString(input.lyricBodyTemplate),
    itemPath: asString(input.itemPath),
    fieldMap: asRecord(input.fieldMap) as MusicSourceDescriptor["fieldMap"],
  });
}

function descriptorFromJsonPayload(payload: unknown): MusicSourceDescriptor | null {
  const record = asRecord(payload);
  if (record) return descriptorFromObject(record);
  if (Array.isArray(payload)) {
    const firstRecord = payload.map(asRecord).find(Boolean);
    if (firstRecord) return descriptorFromObject(firstRecord);
  }
  return null;
}

async function fetchRemoteText(url: string): Promise<string> {
  const res = await scriptFetch(url, { timeout: 15000 });
  if (!res.ok) throw new Error((await res.text()) || `下载失败 ${res.status}`);
  return res.text();
}

/** 内置网易源（前端直连 music.163.com，开箱即用，免部署）。 */
export function createBuiltinNeteaseSource(): MusicSourceDescriptor {
  return normalizeMusicSourceDescriptor({
    id: "music-netease-builtin",
    name: "网易云(内置)",
    kind: "netease-api",
    neteaseMode: "builtin",
    description: "前端直连 music.163.com · 免部署",
  });
}

/** 本地音乐源(占位:曲库由 musicLocal store 提供,播放走 directUrl asset)。 */
export function createLocalMusicSource(): MusicSourceDescriptor {
  return normalizeMusicSourceDescriptor({
    id: "music-local",
    name: "本地音乐",
    kind: "local",
    description: "本机音频文件",
  });
}

/** 把解析出的 LX 音源脚本元数据 → cyrene-aggregate(lx 模式)描述符。
 * template 模式走「{apiUrl}{urlPathTemplate}」直链;runtime 模式留源码执行算签名取链。 */
export function createLxSourceDescriptor(parsed: LxSourceParsed): MusicSourceDescriptor {
  const runtime = parsed.mode === "runtime";
  return normalizeMusicSourceDescriptor({
    name: parsed.name || "洛雪音源",
    kind: "cyrene-aggregate",
    cyreneMode: "lx",
    lxMode: parsed.mode,
    baseUrl: parsed.apiUrl || undefined,
    playBaseUrl: parsed.apiUrl || undefined,
    urlPathTemplate: parsed.urlPathTemplate,
    code: runtime ? parsed.code : undefined,
    token: parsed.apiKey || undefined,
    description: [parsed.version && `v${parsed.version}`, parsed.author, runtime && "执行模式"]
      .filter(Boolean)
      .join(" · ") || "洛雪自定义音源",
    defaultPlatform: "all",
    platforms: MUSIC_PLATFORMS.map((item) => item.id),
  });
}

export async function importMusicSourceFromText(
  rawInput: string
): Promise<MusicSourceDescriptor> {
  const input = rawInput.trim();
  if (!input) throw new Error("请输入音乐源地址、JSON 或插件源码");
  const parsed = tryParseJson(input);
  const parsedRecord = asRecord(parsed);
  if (parsedRecord) return descriptorFromObject(parsedRecord);

  if (/^https?:\/\//i.test(input)) {
    if (/\.(js|mjs)(\?|#|$)/i.test(input)) {
      const code = await fetchRemoteText(input);
      // 先按 LX 音源脚本解析(头部元数据 + apiUrl + 直链模板);抽不到 apiUrl 再当 MusicFree 插件。
      if (looksLikeLxSource(code)) {
        const lx = parseLxScript(code);
        if (lx) return createLxSourceDescriptor(lx);
      }
      return normalizeMusicSourceDescriptor({
        name: sourceNameFromCode(code),
        kind: "plugin-js",
        code,
        description: input,
      });
    }
    if (/\.json(\?|#|$)/i.test(input)) {
      const text = await fetchRemoteText(input);
      const descriptor = descriptorFromJsonPayload(tryParseJson(text));
      if (descriptor) return descriptor;
      throw new Error("音乐源 JSON 格式不支持");
    }
    return normalizeMusicSourceDescriptor({
      name: "LX Music API Server",
      kind: "lx-server",
      baseUrl: input,
      defaultPlatform: "all",
      platforms: MUSIC_PLATFORMS.map((item) => item.id),
    });
  }

  // 粘贴的源码:先试 LX 音源脚本解析,失败再当 MusicFree 插件。
  if (looksLikeLxSource(input)) {
    const lx = parseLxScript(input);
    if (lx) return createLxSourceDescriptor(lx);
  }
  return normalizeMusicSourceDescriptor({
    name: sourceNameFromCode(input),
    kind: "plugin-js",
    code: input,
  });
}
