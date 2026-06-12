import { scriptFetch } from "@/source-script/fetch";
import { initStreamProxyPort, wrapAudioUrl } from "@/lib/proxy";
import { searchAggregate, resolveAggregate } from "./aggregate";
import { searchLxServer, resolveLxServer } from "./lxServer";
import { searchPlugin, resolvePlugin } from "./pluginAdapter";
import type {
  MusicPlayResult,
  MusicQuality,
  MusicSearchResult,
  MusicSourceDescriptor,
} from "./types";
import { MUSIC_PLATFORMS } from "./types";
import { asRecord, asString, cleanBaseUrl, stableId, tryParseJson } from "./utils";

export * from "./types";
export * from "./discovery";
export * from "./playback";

const DEFAULT_LIMIT = 30;

export function normalizeMusicSourceDescriptor(
  input: Partial<MusicSourceDescriptor>
): MusicSourceDescriptor {
  const now = Date.now();
  const kind = input.kind ?? "lx-server";
  const name =
    input.name?.trim() || (kind === "lx-server" ? "LX 音乐源" : "音乐插件");
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
    defaultPlatform: input.defaultPlatform ?? (kind === "lx-server" ? "all" : undefined),
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

export async function resolveMusicSource(
  source: MusicSourceDescriptor,
  song: Parameters<typeof resolveLxServer>[1],
  quality: MusicQuality,
  options: { proxy?: boolean } = {}
): Promise<MusicPlayResult> {
  if (source.kind === "lx-server") await initStreamProxyPort();
  const result =
    source.kind === "lx-server"
      ? await resolveLxServer(source, song, quality, {
          stableStream: options.proxy !== false,
        })
      : source.kind === "plugin-js"
        ? await resolvePlugin(source, song, quality)
        : await resolveAggregate(source, song, quality);
  if (source.kind === "lx-server") return result;
  if (options.proxy === false) return result;
  await initStreamProxyPort();
  return {
    ...result,
    directUrl: result.directUrl ?? result.url,
    url: wrapAudioUrl(result.url, String(song.platform || ""), result.headers),
  };
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

  return normalizeMusicSourceDescriptor({
    name: sourceNameFromCode(input),
    kind: "plugin-js",
    code: input,
  });
}
