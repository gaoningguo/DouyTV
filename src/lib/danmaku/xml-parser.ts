/**
 * Bilibili 风格的弹幕 XML 解析。
 *
 * 格式：
 *   <i>
 *     <d p="时间,类型,字体,颜色,时间戳,弹幕池,用户Hash,弹幕ID">文本</d>
 *     ...
 *   </i>
 *
 * 用正则提取而非 DOMParser/xml2js：
 *  - 体积极小（避免引入 xml2js ~30KB）
 *  - 性能更稳定（单次扫描 vs 全量构建 DOM）
 *  - DanDanPlay/danmu_api 的 XML 结构非常规整，简单正则足够覆盖
 */
import type { DanmakuComment } from "./types";

const D_TAG_RE = /<d\s+p="([^"]+)"[^>]*>([^<]*)<\/d>/g;

export function parseXmlDanmaku(xmlText: string): DanmakuComment[] {
  const out: DanmakuComment[] = [];
  let match: RegExpExecArray | null;
  while ((match = D_TAG_RE.exec(xmlText)) !== null) {
    const p = match[1];
    const m = match[2];
    const parts = p.split(",");
    const cid = parts[7] ? parseInt(parts[7], 10) || 0 : 0;
    out.push({ p, m, cid });
  }
  // 重置 lastIndex，避免 g 标记的全局正则在并发调用时跨实例污染
  D_TAG_RE.lastIndex = 0;
  return out;
}

/** 将 DanDanPlay v2 JSON 弹幕格式（{cid, p, m}）规范化 — 仅在某些后端用 JSON 而非 XML 时调用 */
export function parseJsonDanmaku(arr: unknown[]): DanmakuComment[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((c): c is { p: string; m: string; cid?: number } => {
      if (!c || typeof c !== "object") return false;
      const obj = c as Record<string, unknown>;
      return typeof obj.p === "string" && typeof obj.m === "string";
    })
    .map((c) => ({
      p: c.p,
      m: c.m,
      cid: typeof c.cid === "number" ? c.cid : 0,
    }));
}
