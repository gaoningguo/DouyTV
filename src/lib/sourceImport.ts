/**
 * 通用书源 / 漫画源 / RSS 等 legado 系导入工具。
 * 抽出来给 novelsource / mangasource store 共用，避免每个 store 各自维护 import 逻辑。
 *
 * 复刻 legado `ui/association/ImportBookSourceViewModel.kt#importSource(text)`：
 *
 *   1. 文本预处理：strip UTF-8 BOM
 *   2. 输入形态识别：
 *      - JSON 对象：
 *          - 含 `sourceUrls`（数组）—— legado 订阅 wrap，依次 fetch 每个 URL 合并
 *          - 否则视作单源对象，包成 [source]
 *      - JSON 数组 —— 直接当源数组
 *      - 纯 URL —— 当 importByUrl 调用
 *   3. URL 支持 `#requestWithoutUA` 后缀（legado 同款，对部分 UA 校验严的源生效）
 *   4. 错误信息明确（"不是 JSON" / "缺 sourceUrl 字段" / "HTTP 状态码"）
 */
import { scriptFetch } from "@/source-script/fetch";

// U+FEFF (Zero-Width No-Break Space / UTF-8 BOM)
const BOM_RE = /^﻿/;

export function stripBom(text: string): string {
  return text.replace(BOM_RE, "");
}

export function looksLikeUrl(text: string): boolean {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

/** 把 legado 风格输入解析成"原始 source 对象数组"。返回数组 + 是否有 sourceUrls wrap 需要外层 fetch */
export interface ParsedSourceInput {
  /** 直接拿到的源对象数组（已剥离 wrap） */
  sources: Array<Record<string, unknown>>;
  /** legado `sourceUrls` wrap：需要外层调 fetch 每条 URL */
  sourceUrls: string[];
}

/**
 * legado 的"分享/导出"管线把书源/漫画源 / RSS 源压缩成 base64 + DEFLATE 字节流：
 *
 *   JSON → UTF-8 → zlib deflate → base64 (URL-safe 或标准)
 *
 * 典型特征：整段文本仅含 base64 字符、无换行；inflate 后第一字节是 `[` 或 `{`。
 * 我们用 DecompressionStream('deflate') 解（Tauri WebView2 / WebKit / Chromium 都原生支持）。
 */
const BASE64_LIKE_RE = /^[A-Za-z0-9+/=_-]+$/;
async function tryDecodeLegadoDeflate(text: string): Promise<string | null> {
  // 仅当看起来像 base64、且大小够（>= 64 字节，避免误判）才尝试
  const trimmed = text.replace(/\s+/g, "");
  if (trimmed.length < 64 || !BASE64_LIKE_RE.test(trimmed)) return null;
  if (typeof DecompressionStream === "undefined") return null;
  // URL-safe base64 → 标准 base64
  let b64 = trimmed.replace(/-/g, "+").replace(/_/g, "/");
  // 补齐 padding
  while (b64.length % 4 !== 0) b64 += "=";
  let buffer: ArrayBuffer;
  try {
    const bin = atob(b64);
    buffer = new ArrayBuffer(bin.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  } catch {
    return null;
  }
  // zlib 流首字节是 0x78（zlib header）。其它如纯 deflate / gzip 一般 legado 不用，但兜底试 deflate-raw / gzip。
  const candidates: Array<"deflate" | "deflate-raw" | "gzip"> = ["deflate", "deflate-raw", "gzip"];
  for (const format of candidates) {
    try {
      const blob = new Blob([buffer]);
      const stream = blob.stream().pipeThrough(
        new DecompressionStream(format as CompressionFormat)
      );
      const buf = await new Response(stream).arrayBuffer();
      const decoded = new TextDecoder("utf-8", { fatal: false }).decode(buf);
      const head = decoded.trimStart()[0];
      if (head === "[" || head === "{") return decoded;
    } catch {
      /* 试下一个 format */
    }
  }
  return null;
}

export async function parseLegadoLikeAsync(text: string): Promise<ParsedSourceInput> {
  const cleaned = stripBom(text).trim();
  if (!cleaned) throw new Error("输入为空");

  // 先尝试 legado 压缩格式（.txt 导出常见）
  const inflated = await tryDecodeLegadoDeflate(cleaned);
  const jsonText = inflated ?? cleaned;
  return parseLegadoLike(jsonText);
}

export function parseLegadoLike(text: string): ParsedSourceInput {
  const cleaned = stripBom(text).trim();
  if (!cleaned) {
    throw new Error("输入为空");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(
      `JSON 解析失败: ${(e as Error).message}（请检查是否完整 JSON，是否粘贴了 HTML 页面内容；legado .txt 压缩导出请通过"一键导入 URL"按钮拉取，会自动解码）`
    );
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const urls = obj.sourceUrls;
    if (Array.isArray(urls)) {
      const list: string[] = [];
      for (const u of urls) {
        if (typeof u === "string" && u.trim()) list.push(u.trim());
      }
      return { sources: [], sourceUrls: list };
    }
    // 单源对象
    return { sources: [obj], sourceUrls: [] };
  }
  if (Array.isArray(parsed)) {
    return {
      sources: parsed.filter(
        (x): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x)
      ),
      sourceUrls: [],
    };
  }
  throw new Error("JSON 不是对象 / 数组（不像 legado 书源格式）");
}

/** 拉取单个 URL → 文本（剥离 BOM）。支持 #requestWithoutUA 后缀。 */
export async function fetchSourceText(url: string): Promise<string> {
  let target = url;
  let withoutUa = false;
  if (url.endsWith("#requestWithoutUA")) {
    target = url.slice(0, -"#requestWithoutUA".length);
    withoutUa = true;
  }
  const headers: Record<string, string> = {};
  if (withoutUa) headers["User-Agent"] = "";
  try {
    const res = await scriptFetch(target, {
      method: "GET",
      headers,
      timeout: 30_000,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${target}`);
    }
    return stripBom(await res.text());
  } catch (e) {
    // GitHub raw 直连在国内常被卡（os error 10060 / timeout）。
    // 自动重试一次镜像 raw.gitmirror.com（1:1 host 替换，521xueweihan 维护）。
    // 仅对 raw.githubusercontent.com 启用；其它域名透传原错误。
    const mirror = githubRawMirror(target);
    if (mirror && mirror !== target) {
      try {
        const res2 = await scriptFetch(mirror, {
          method: "GET",
          headers,
          timeout: 30_000,
        });
        if (res2.ok) return stripBom(await res2.text());
      } catch {
        /* 镜像也失败：保留原错误抛出 */
      }
    }
    throw e;
  }
}

/** raw.githubusercontent.com → raw.gitmirror.com 的同路径镜像。其它 host 返回 null。 */
function githubRawMirror(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "raw.githubusercontent.com") {
      u.hostname = "raw.gitmirror.com";
      return u.toString();
    }
  } catch {
    /* not a valid URL */
  }
  return null;
}

/**
 * 高层导入：把任意输入（URL / JSON 文本 / `sourceUrls` wrap）变成"原始源对象数组"。
 * 调用方再用自己 store 的 mapper（如 `parseLegadoJson` 或 `parseMangaSourceJson`）转成 store 接受的形态。
 */
export async function loadSourceObjects(
  input: string
): Promise<Array<Record<string, unknown>>> {
  const trimmed = input.trim();
  if (looksLikeUrl(trimmed)) {
    return loadSourceObjectsFromUrl(trimmed);
  }
  // 文本可能是 legado 压缩格式（.txt 导出），用 async 版本自动解码
  const parsed = await parseLegadoLikeAsync(trimmed);
  if (parsed.sourceUrls.length > 0) {
    return loadSourceObjectsFromUrls(parsed.sourceUrls);
  }
  return parsed.sources;
}

export async function loadSourceObjectsFromUrl(
  url: string
): Promise<Array<Record<string, unknown>>> {
  const text = await fetchSourceText(url);
  const parsed = await parseLegadoLikeAsync(text);
  if (parsed.sourceUrls.length > 0) {
    return loadSourceObjectsFromUrls(parsed.sourceUrls);
  }
  return parsed.sources;
}

async function loadSourceObjectsFromUrls(
  urls: string[]
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  // 并发拉取，部分失败不影响整体
  const settled = await Promise.allSettled(
    urls.map((u) => loadSourceObjectsFromUrl(u))
  );
  for (const r of settled) {
    if (r.status === "fulfilled") out.push(...r.value);
    else console.warn("[source-import] sub url failed", r.reason);
  }
  return out;
}
