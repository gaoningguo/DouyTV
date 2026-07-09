// TTS 文本分块 + 辅助纯函数 —— 移植自 MoonTVPlus books read page 的 chunkTtsText 等。
// 整章正文按 ~1200 字切块(段落→句子→硬切),逐块合成朗读,支持自动续播 / 断点续读。

export interface TtsChunk {
  index: number;
  text: string;
  /** 该块在整章文本中的起始字符偏移(断点续读定位用)。 */
  start: number;
  end: number;
}

const DEFAULT_MAX_CHARS = 1200;

/** 去掉多余空白 / nbsp,压缩空行。 */
export function sanitizeTtsText(text: string): string {
  return (text || "")
    .replace(/ /g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 从 HTML 正文里抽纯文本(去标签 + 解实体基本子集)。 */
export function htmlToPlainText(html: string): string {
  const withBreaks = (html || "")
    .replace(/<br\s*\/?>(?=)/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  const decoded = withBreaks
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return sanitizeTtsText(decoded);
}

/**
 * 把整章文本切成 <= maxChars 的块:段落优先,超长段落按句子切,超长句子硬切。
 * 保留每块的字符偏移(start/end),供断点续读定位。
 */
export function chunkTtsText(text: string, maxChars = DEFAULT_MAX_CHARS): TtsChunk[] {
  const clean = sanitizeTtsText(text);
  if (!clean) return [];
  const chunks: TtsChunk[] = [];
  let cursor = 0;

  const push = (body: string, startOffset: number) => {
    const trimmed = body.trim();
    if (!trimmed) return;
    chunks.push({
      index: chunks.length,
      text: trimmed,
      start: startOffset,
      end: startOffset + body.length,
    });
  };

  const paragraphs = clean.split(/\n{2,}/);
  let buffer = "";
  let bufferStart = 0;

  const flush = () => {
    if (buffer) {
      push(buffer, bufferStart);
      buffer = "";
    }
  };

  const packSentences = (para: string, paraStart: number) => {
    // 句子按中英文标点切
    const sentences = para.split(/(?<=[。！？!?；;])/);
    let sentBuf = "";
    let sentStart = paraStart;
    for (const s of sentences) {
      if (s.length > maxChars) {
        // 硬切超长句
        if (sentBuf) {
          push(sentBuf, sentStart);
          sentStart += sentBuf.length;
          sentBuf = "";
        }
        for (let i = 0; i < s.length; i += maxChars) {
          push(s.slice(i, i + maxChars), sentStart + i);
        }
        sentStart += s.length;
        continue;
      }
      if ((sentBuf + s).length > maxChars) {
        push(sentBuf, sentStart);
        sentStart += sentBuf.length;
        sentBuf = s;
      } else {
        sentBuf += s;
      }
    }
    if (sentBuf) push(sentBuf, sentStart);
  };

  for (const para of paragraphs) {
    const paraStart = cursor;
    cursor += para.length + 2; // +2 for the \n\n separator
    if (para.length > maxChars) {
      flush();
      packSentences(para, paraStart);
      continue;
    }
    const candidate = buffer ? `${buffer}\n\n${para}` : para;
    if (candidate.length > maxChars) {
      flush();
      buffer = para;
      bufferStart = paraStart;
    } else {
      if (!buffer) bufferStart = paraStart;
      buffer = candidate;
    }
  }
  flush();

  // 重新编号(flush 顺序即最终顺序)
  return chunks.map((c, i) => ({ ...c, index: i }));
}

/** 秒 → m:ss。 */
export function formatDurationTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** base64 音频 → Blob。 */
export function decodeBase64Audio(base64: string, mimeType: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || "audio/mpeg" });
}

// —— 有符号步进值(语速/音调/音量滑块)——
export const TTS_RATE_STEPS = [-20, -10, 0, 10, 20, 35];
export const TTS_PITCH_STEPS = [-10, 0, 10, 20];
export const TTS_VOLUME_STEPS = [-10, 0, 10, 20];

export function parseSignedNumber(value: string): number {
  const m = /([+-]?\d+)/.exec(value || "");
  return m ? Number(m[1]) : 0;
}

export function formatSignedValue(n: number, unit: "%" | "Hz"): string {
  return `${n >= 0 ? "+" : ""}${n}${unit}`;
}
