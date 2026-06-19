import type { LyricLine, LyricWord } from "../types";

/**
 * 歌词解析器：把多种格式统一成带可选词级时间的 LyricLine[]。
 *
 * 支持三类输入：
 *  1. 标准 LRC：`[mm:ss.xx]文本`（仅行级时间）。
 *  2. 增强型 LRC（逐字内联标签）：`[mm:ss.xx]<mm:ss.xx>字<mm:ss.xx>字...`
 *     —— 酷狗/部分网易源会用，旧的 parseLyric 直接把 `<...>` 剥掉了。
 *  3. YRC / QRC（毫秒词级）：行头 `[start,duration]`，词为 `字(start,duration)` 或 `(start,duration)字`。
 *     —— 网易云 yrc / QQ qrc 解密后的明文形态。
 *
 * 翻译（tlyric/罗马音 romalrc）始终按行级时间就近对齐到主歌词。
 */

const LINE_TAG = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
// 增强 LRC 内联逐字：冒号绝对时间 `<mm:ss.xx>`。
const INLINE_WORD_TAG = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>/g;
// LX/KRC 内联逐字：`<offset_ms,duration_ms>`（offset 相对行首毫秒），如 `<0,232>未<232,232>经`。
const INLINE_MS_TAG = /<(\d+),(\d+)>/g;
// 同时剥离两种内联标签，得到纯文本。
const INLINE_ANY_TAG = /<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>|<\d+,\d+>/g;
// YRC/QRC 行头：[起始ms,时长ms] 或 [起始ms,时长ms,...]
const YRC_LINE_HEAD = /^\[(\d+),(\d+)\]/;
// 单个时间标签 (start,duration[,extra])
const YRC_TIME = /\((\d+),(\d+)(?:,\d+)?\)/g;

function tagToSeconds(min: string, sec: string, frac?: string): number {
  const m = Number(min);
  const s = Number(sec);
  // 两位当百分秒、三位当毫秒。
  const ms = frac ? Number(frac.length === 2 ? `${frac}0` : frac.padEnd(3, "0").slice(0, 3)) : 0;
  if (!Number.isFinite(m) || !Number.isFinite(s)) return 0;
  return m * 60 + s + ms / 1000;
}

function isYrcFormat(text: string): boolean {
  // 至少两行命中 `[ms,ms]` 行头才认定为 YRC/QRC，避免误判。
  let hits = 0;
  for (const line of text.split("\n")) {
    if (YRC_LINE_HEAD.test(line.trim())) {
      hits += 1;
      if (hits >= 2) return true;
    }
  }
  return false;
}

/** 解析翻译/罗马音：行级时间 → 文本。 */
function parseSideText(text: string): Array<{ time: number; text: string }> {
  const out: Array<{ time: number; text: string }> = [];
  if (!text) return out;
  for (const line of text.split("\n")) {
    const stamps = Array.from(line.matchAll(LINE_TAG));
    if (stamps.length === 0) continue;
    const content = line
      .replace(LINE_TAG, "")
      .replace(INLINE_ANY_TAG, "")
      .trim();
    if (!content) continue;
    for (const m of stamps) {
      out.push({ time: tagToSeconds(m[1], m[2], m[3]), text: content });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

/** 把翻译/罗马音就近对齐到主歌词行（±0.4s）。 */
function nearestSide(
  side: Array<{ time: number; text: string }>,
  time: number
): string | undefined {
  let best: string | undefined;
  let bestDiff = 0.4;
  for (const item of side) {
    const diff = Math.abs(item.time - time);
    if (diff <= bestDiff) {
      bestDiff = diff;
      best = item.text;
    }
  }
  return best;
}

/** 解析增强型 LRC 的单行逐字标签，返回词级时间。支持两种内联格式：
 *  A. 冒号绝对时间 `<mm:ss.xx>字`
 *  B. 逗号相对毫秒 `<offset_ms,duration_ms>字`（offset 相对行首，需加 lineStart）
 */
function parseInlineWords(body: string, lineStart: number): LyricWord[] | undefined {
  // 先试逗号毫秒格式（LX/KRC），它更具体。
  INLINE_MS_TAG.lastIndex = 0;
  const msMatches = Array.from(body.matchAll(INLINE_MS_TAG));
  if (msMatches.length > 0) {
    const words: LyricWord[] = [];
    for (let i = 0; i < msMatches.length; i += 1) {
      const m = msMatches[i];
      const offset = Number(m[1]) / 1000;
      const dur = Number(m[2]) / 1000;
      const textStart = (m.index ?? 0) + m[0].length;
      const textEnd =
        i + 1 < msMatches.length ? msMatches[i + 1].index ?? body.length : body.length;
      const text = body.slice(textStart, textEnd);
      if (!text) continue;
      const start = lineStart + offset;
      words.push({ text, start, end: start + dur });
    }
    // 时长为 0 的字（如标点）用下一字起点兜底。
    for (let i = 0; i < words.length; i += 1) {
      if (words[i].end <= words[i].start) {
        words[i].end = words[i + 1]?.start ?? words[i].start + 0.3;
      }
    }
    return words.length > 0 ? words : undefined;
  }

  // 冒号绝对时间格式。
  INLINE_WORD_TAG.lastIndex = 0;
  const matches = Array.from(body.matchAll(INLINE_WORD_TAG));
  if (matches.length === 0) return undefined;
  const words: LyricWord[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const start = tagToSeconds(m[1], m[2], m[3]);
    const textStart = (m.index ?? 0) + m[0].length;
    const textEnd = i + 1 < matches.length ? matches[i + 1].index ?? body.length : body.length;
    const text = body.slice(textStart, textEnd);
    if (!text) continue;
    const next = matches[i + 1];
    const end = next ? tagToSeconds(next[1], next[2], next[3]) : start;
    words.push({ text, start: Math.max(start, lineStart), end });
  }
  // 末词 end 缺失时给一个兜底（行内最后一个标签没有后继）。
  for (let i = 0; i < words.length; i += 1) {
    if (words[i].end <= words[i].start) {
      words[i].end = words[i + 1]?.start ?? words[i].start + 0.4;
    }
  }
  return words.length > 0 ? words : undefined;
}

function parseLrc(lyricText: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const line of lyricText.split("\n")) {
    const stamps = Array.from(line.matchAll(LINE_TAG));
    if (stamps.length === 0) continue;
    const afterTags = line.replace(LINE_TAG, "");
    const plain = afterTags.replace(INLINE_ANY_TAG, "").trim();
    for (const m of stamps) {
      const time = tagToSeconds(m[1], m[2], m[3]);
      const words = parseInlineWords(afterTags, time);
      lines.push({ time, text: plain, words });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

function parseYrc(lyricText: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const rawLine of lyricText.split("\n")) {
    const line = rawLine.trim();
    const head = line.match(YRC_LINE_HEAD);
    if (!head) {
      // 网易 yrc 偶尔混入 JSON 元信息行（{"t":...}），忽略。
      continue;
    }
    const lineStart = Number(head[1]) / 1000;
    const lineDur = Number(head[2]) / 1000;
    const body = line.slice(head[0].length);

    // 收集所有时间标签的位置；文本段在标签之间。
    YRC_TIME.lastIndex = 0;
    const tags: Array<{ start: number; dur: number; index: number; len: number }> = [];
    let tm: RegExpExecArray | null;
    while ((tm = YRC_TIME.exec(body)) !== null) {
      tags.push({
        start: Number(tm[1]) / 1000,
        dur: Number(tm[2]) / 1000,
        index: tm.index,
        len: tm[0].length,
      });
    }

    const words: LyricWord[] = [];
    if (tags.length > 0) {
      // 判定排布：标签前有文本 → QQ 式「字(t)」；行首即标签 → 网易式「(t)字」。
      const leadText = body.slice(0, tags[0].index).trim().length > 0;
      if (leadText) {
        // 字(t) 字(t)：文本归属其后的标签时间。
        let cursor = 0;
        for (const tag of tags) {
          const text = body.slice(cursor, tag.index);
          if (text) words.push({ text, start: tag.start, end: tag.start + tag.dur });
          cursor = tag.index + tag.len;
        }
      } else {
        // (t)字 (t)字：文本归属其前的标签时间。
        for (let i = 0; i < tags.length; i += 1) {
          const tag = tags[i];
          const textStart = tag.index + tag.len;
          const textEnd = i + 1 < tags.length ? tags[i + 1].index : body.length;
          const text = body.slice(textStart, textEnd);
          if (text) words.push({ text, start: tag.start, end: tag.start + tag.dur });
        }
      }
    }

    const text = (words.length > 0 ? words.map((w) => w.text).join("") : body.replace(YRC_TIME, "")).trim();
    if (!text && words.length === 0) continue;
    lines.push({
      time: lineStart,
      end: lineStart + lineDur,
      text,
      words: words.length > 0 ? words : undefined,
    });
  }
  return lines.sort((a, b) => a.time - b.time);
}

export interface ParseLyricInput {
  /** 主歌词：LRC 或增强 LRC */
  lyric?: string;
  /** 翻译 */
  tlyric?: string;
  /** 逐字歌词原文：网易 yrc / QQ qrc（毫秒词级），优先级高于 lyric */
  yrc?: string;
  /** 罗马音 */
  romalrc?: string;
}

/**
 * 统一入口：根据可用字段选最佳来源解析。
 * 逐字源（yrc/qrc）若存在且解析出词级时间，则优先使用，否则回退到 LRC。
 */
export function parseLyric(input: ParseLyricInput | string, tlyricText?: string): LyricLine[] {
  const data: ParseLyricInput =
    typeof input === "string" ? { lyric: input, tlyric: tlyricText } : input;

  let lines: LyricLine[] = [];

  // 1) 优先逐字源
  if (data.yrc && data.yrc.trim()) {
    lines = isYrcFormat(data.yrc) ? parseYrc(data.yrc) : parseLrc(data.yrc);
  }

  // 2) 逐字源不可用 → 主歌词
  if (lines.length === 0 && data.lyric) {
    lines = isYrcFormat(data.lyric) ? parseYrc(data.lyric) : parseLrc(data.lyric);
  }

  // 3) 计算每行 end（用于间奏检测 + 行内进度兜底）
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].end === undefined) {
      const lastWord = lines[i].words?.[lines[i].words!.length - 1];
      lines[i].end = lastWord?.end ?? lines[i + 1]?.time ?? lines[i].time + 4;
    }
  }

  // 4) 翻译 / 罗马音对齐
  const trans = parseSideText(data.tlyric || "");
  const roma = parseSideText(data.romalrc || "");
  if (trans.length > 0 || roma.length > 0) {
    for (const line of lines) {
      if (trans.length > 0) line.trans = nearestSide(trans, line.time);
      if (roma.length > 0) line.roma = nearestSide(roma, line.time);
    }
  }

  // 5) 主歌词为空但有翻译 → 退化成纯翻译行
  if (lines.length === 0 && trans.length > 0) {
    return trans.map((t) => ({ time: t.time, text: t.text }));
  }

  return lines.filter((line) => line.text || line.trans || line.roma);
}
