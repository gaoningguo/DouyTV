/**
 * LX 音源(洛雪自定义源)脚本解析器 —— 照搬 CyreneMusic lxMusicSourceService 的做法:
 * **不执行**脚本(洛雪脚本跑在 globalThis.lx 沙箱里,直接 new Function 跑会失败),
 * 而是解析头部 JSDoc 元数据 + 正则抽 apiUrl / urlPathTemplate,把它当「模板化 HTTP 源」用。
 * 播放时按 {apiUrl}{urlPathTemplate}(含 {source}/{songId}/{quality} 占位)直链解析。
 */
import { scriptFetch } from "@/source-script/fetch";

export interface LxSourceParsed {
  name: string;
  version: string;
  author: string;
  description: string;
  homepage: string;
  apiUrl: string;
  apiKey: string;
  urlPathTemplate: string;
}

const DEFAULT_URL_TEMPLATE = "/url/{source}/{songId}/{quality}";

/** 头部注释块(/* … *​/)里的 @name/@author/@version/@description/@homepage。 */
function parseHeaderMetadata(script: string): Record<string, string> {
  const metadata: Record<string, string> = {};
  const block = script.match(/\/\*[\s\S]*?\*\//);
  if (!block) return metadata;
  const content = block[0];
  const patterns: Record<string, RegExp> = {
    name: /@name\s+(.+)/,
    author: /@author\s+(.+)/,
    version: /@version\s+(.+)/,
    description: /@description\s+(.+)/,
    homepage: /@homepage\s+(.+)/,
  };
  for (const [key, pattern] of Object.entries(patterns)) {
    const match = content.match(pattern);
    if (match && match[1]) {
      let value = match[1].trim();
      if (value.startsWith("*")) value = value.substring(1).trim();
      if (value) metadata[key] = value;
    }
  }
  return metadata;
}

function extractRegex(content: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match && match[1]) return match[1].trim();
    if (match && match[0] && !pattern.source.includes("(")) return match[0].trim();
  }
  return null;
}

function cleanUrl(url: string): string {
  let cleaned = url.trim();
  while (cleaned.startsWith("'") || cleaned.startsWith('"')) cleaned = cleaned.substring(1);
  while (cleaned.endsWith("'") || cleaned.endsWith('"')) cleaned = cleaned.substring(0, cleaned.length - 1);
  return cleaned.replace(/\/$/, "");
}

function isValidApiUrl(url: string): boolean {
  // 排除脚本里常见的非业务 URL(CDN/仓库/示例)。
  const exclude = ["github.com", "jsdelivr.net", "cdnjs.com", "unpkg.com", "example.com", "localhost"];
  if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
  return !exclude.some((pattern) => url.includes(pattern));
}

function extractApiUrl(script: string): string {
  const patterns = [
    /apiUrl\s*[:=]\s*['"]([^'"]+)['"]/,
    /api[_-]?url\s*[:=]\s*['"]([^'"]+)['"]/,
    /host\s*[:=]\s*['"]([^'"]+)['"]/,
    /baseUrl\s*[:=]\s*['"]([^'"]+)['"]/,
    /['"]?((?:https?):\/\/[a-zA-Z0-9\-._~:/?#[\]@!$&()*+,;=%]+)['"]?/g,
  ];
  for (const pattern of patterns) {
    if (pattern.global) {
      for (const match of script.matchAll(pattern)) {
        const candidate = match[1] || match[0];
        if (isValidApiUrl(candidate)) {
          const cleaned = cleanUrl(candidate);
          if (cleaned) return cleaned;
        }
      }
    } else {
      const match = script.match(pattern);
      if (match) {
        const candidate = match[1] || match[0];
        if (isValidApiUrl(candidate)) return cleanUrl(candidate);
      }
    }
  }
  return "";
}

/** 是否「像」一个 LX 音源脚本(头部 @name / 洛雪沙箱标记 / 直链模板)。 */
export function looksLikeLxSource(content: string): boolean {
  return (
    /@name\s+/.test(content) ||
    /globalThis\.lx|window\.lx|EVENT_NAMES|MUSIC_QUALITY|musicUrl/.test(content) ||
    /\/url\/\{?[a-zA-Z]+\}?\/\{?[a-zA-Z]+\}?\/\{?[a-zA-Z]+\}?/.test(content)
  );
}

/** 解析脚本文本 → 元数据 + apiUrl + urlPathTemplate。无法抽到 apiUrl 时返回 null。 */
export function parseLxScript(scriptContent: string): LxSourceParsed | null {
  try {
    const header = parseHeaderMetadata(scriptContent);
    const name =
      header.name ||
      extractRegex(scriptContent, [
        /name\s*:\s*['"]([^'"]+)['"]/,
        /['"]name['"]\s*:\s*['"]([^'"]+)['"]/,
      ]) ||
      "洛雪音源";
    const version =
      header.version ||
      extractRegex(scriptContent, [/version\s*:\s*['"]([^'"]+)['"]/]) ||
      "1.0.0";
    const author =
      header.author || extractRegex(scriptContent, [/author\s*:\s*['"]([^'"]+)['"]/, /@author\s+(.+)/]) || "";
    const description =
      header.description ||
      extractRegex(scriptContent, [/description\s*:\s*['"]([^'"]+)['"]/, /@description\s+(.+)/]) ||
      "";
    const homepage = header.homepage || extractRegex(scriptContent, [/@homepage\s+(.+)/]) || "";
    const apiUrl = extractApiUrl(scriptContent);
    const apiKey =
      extractRegex(scriptContent, [
        /apiKey\s*[:=]\s*['"]([^'"]+)['"]/,
        /api[_-]?key\s*[:=]\s*['"]([^'"]+)['"]/,
        /token\s*[:=]\s*['"]([^'"]+)['"]/,
      ]) || "";
    const urlPathTemplate =
      extractRegex(scriptContent, [
        /urlPath\s*[:=]\s*['"]([^'"]+)['"]/,
        /\/url\/\{?[a-zA-Z]+\}?\/\{?[a-zA-Z]+\}?\/\{?[a-zA-Z]+\}?/,
      ]) || DEFAULT_URL_TEMPLATE;

    // 没有可用 apiUrl 的脚本无法当模板化 HTTP 源用(可能是纯沙箱脚本)。
    if (!apiUrl) return null;
    return { name, version, author, description, homepage, apiUrl, apiKey, urlPathTemplate };
  } catch {
    return null;
  }
}

/** 从 URL 下载脚本并解析。 */
export async function fetchAndParseLxScript(url: string): Promise<LxSourceParsed | null> {
  try {
    const res = await scriptFetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      },
      timeout: 15000,
    });
    if (!res.ok) return null;
    return parseLxScript(await res.text());
  } catch {
    return null;
  }
}
