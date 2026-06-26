/**
 * 网易云灰曲解灰 —— 调用 Rust 后端 `music_unblock` 命令(移植自 UnblockNeteaseMusic)。
 *
 * 为什么走 Rust 而非前端 scriptFetch:解灰要打 kuwo/kugou/migu/bodian 等平台的
 * 老接口,这些接口对 UA/header 敏感、返回非标准 JSON,且部分要 MD5 签名。
 * 放 Rust 用 ureq 出网(绕 WebView CORS、走用户代理),命中率和稳定性远高于前端复刻。
 *
 * 移植范围(照 UNM src/provider/*):kuwo / kugou / migu / bodian / pyncmd。
 * 编排照 UNM match.js:每个源「搜索关键词 → 按时长 ±5s 匹配 → 取直链」,
 * 按 sources 给定顺序返回首个拿到直链的结果。
 *
 * 调用方:neteaseApi.resolveNeteaseApi 在网易匿名直链为 null(灰曲)时兜底。
 * 优先级规则(见 index.resolveMusicSource):有启用的外部网易云 API 源时,
 * 优先用其服务端 /song/url/match;否则(内置源/其他源)走本模块。
 */
import { invoke } from "@tauri-apps/api/core";
import { getActiveProxyUrl } from "@/stores/proxy";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** 可前端移植的 UNM 音源代号。 */
export type UnblockSource = "kuwo" | "kugou" | "migu" | "bodian" | "pyncmd";

export const UNBLOCK_SOURCES: UnblockSource[] = [
  "kuwo",
  "kugou",
  "migu",
  "bodian",
  "pyncmd",
];

export const UNBLOCK_SOURCE_LABELS: Record<UnblockSource, string> = {
  kuwo: "酷我",
  kugou: "酷狗",
  migu: "咪咕",
  bodian: "波点",
  pyncmd: "GD音乐台",
};

/** 解灰匹配用的目标曲信息(对齐 UNM 的 info 结构)。 */
export interface UnblockTarget {
  /** 网易云歌曲 id（pyncmd 直接用它打 GD 音乐台）。 */
  neteaseId: string;
  /** 歌名。 */
  name: string;
  /** 歌手（多位用 / 或 & 连接）。 */
  artist: string;
  /** 期望时长（毫秒），用于在搜索结果里挑最接近的版本。 */
  durationMs?: number;
}

export interface UnblockResult {
  url: string;
  source: UnblockSource;
}

interface RustUnblockResult {
  url: string;
  source: string;
}

/**
 * 灰曲解灰:调 Rust `music_unblock` 命令,按 sources 顺序返回首个拿到直链的结果。
 * 非 Tauri 环境(纯 dev 浏览器)直接返回 null —— 解灰必须经原生出网。
 */
export async function unblockMatch(
  target: UnblockTarget,
  sources: UnblockSource[]
): Promise<UnblockResult | null> {
  if (!isTauri || sources.length === 0 || !target.name) return null;
  try {
    const result = await invoke<RustUnblockResult | null>("music_unblock", {
      req: {
        netease_id: target.neteaseId,
        name: target.name,
        artist: target.artist,
        duration_ms: target.durationMs,
        sources,
        proxy_url: getActiveProxyUrl() ?? null,
        enable_flac: false,
      },
    });
    if (result && result.url) {
      return { url: result.url, source: result.source as UnblockSource };
    }
    return null;
  } catch (error) {
    console.warn("[unblock] music_unblock failed", error);
    return null;
  }
}
