// 小说 TTS —— 对标 MoonTVPlus src/lib/book-tts.ts,但换实现路径。
//
// MoonTVPlus 在 Node 服务端用 `edge-tts-universal` 库合成,前端 POST /api/books/tts。
// DouyTV 没有服务端,edge-tts-universal 是 Node WS 库(依赖 node crypto / ws),浏览器跑不了。
// 改用浏览器原生 WebSocket 直连微软 Edge 朗读服务的公开端点:
//   wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=...
// 发 SSML,收二进制音频帧(audio/mpeg)拼成 blob,同时收 WordBoundary metadata 做逐词高亮。
//
// 这是 edge-tts / edge-tts-universal 内部用的同一套协议,只是我们在 WebView 里手写握手。
// 音色列表走同源的 voices REST 端点(匿名可读)。

import type { BookTtsBoundary, BookTtsVoice } from "./types";

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const SYNTH_URL = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
const VOICES_URL = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`;

export interface BookTtsDefaults {
  voice: string;
  rate: string;
  pitch: string;
  volume: string;
  maxCharsPerChunk: number;
  prefetchChunks: number;
  maxTextLengthPerRequest: number;
}

export const BOOK_TTS_DEFAULTS: BookTtsDefaults = {
  voice: "zh-CN-XiaoxiaoNeural",
  rate: "+0%",
  pitch: "+0Hz",
  volume: "+0%",
  maxCharsPerChunk: 1200,
  prefetchChunks: 1,
  maxTextLengthPerRequest: 2000,
};

export interface BookTtsSynthesisResult {
  /** 合成音频的 blob（audio/mpeg）。 */
  blob: Blob;
  mimeType: string;
  boundaries: BookTtsBoundary[];
}

interface RawVoice {
  Name?: string;
  ShortName?: string;
  Locale?: string;
  Gender?: string;
  FriendlyName?: string;
}

function normalizeVoice(item: RawVoice): BookTtsVoice {
  const shortName = item.ShortName || item.Name || "";
  return {
    name: item.Name || shortName,
    shortName,
    locale: item.Locale || "",
    gender: item.Gender || undefined,
    displayName: item.FriendlyName || shortName,
  };
}

let voicesCache: BookTtsVoice[] | null = null;

/** 拉取 Edge 朗读音色列表(中文优先排序)。匿名可读,结果缓存整个会话。 */
export async function listBookTtsVoices(): Promise<BookTtsVoice[]> {
  if (voicesCache) return voicesCache;
  const res = await fetch(VOICES_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
      "Sec-MS-GEC": "",
      "Sec-MS-GEC-Version": "",
    },
  }).catch(() => null);
  if (!res || !res.ok) {
    // 端点偶尔需要 GEC token 才放行;失败时至少给一批常用中文音色兜底。
    voicesCache = FALLBACK_VOICES;
    return voicesCache;
  }
  const raw = (await res.json()) as RawVoice[];
  const voices = raw
    .map(normalizeVoice)
    .filter((item) => !!item.shortName)
    .sort((a, b) => {
      const zhA = a.locale.startsWith("zh") ? 0 : 1;
      const zhB = b.locale.startsWith("zh") ? 0 : 1;
      return (
        zhA - zhB ||
        a.locale.localeCompare(b.locale) ||
        a.shortName.localeCompare(b.shortName)
      );
    });
  voicesCache = voices.length > 0 ? voices : FALLBACK_VOICES;
  return voicesCache;
}

const FALLBACK_VOICES: BookTtsVoice[] = [
  { name: "Xiaoxiao", shortName: "zh-CN-XiaoxiaoNeural", locale: "zh-CN", gender: "Female", displayName: "晓晓 (女声)" },
  { name: "Yunxi", shortName: "zh-CN-YunxiNeural", locale: "zh-CN", gender: "Male", displayName: "云希 (男声)" },
  { name: "Yunyang", shortName: "zh-CN-YunyangNeural", locale: "zh-CN", gender: "Male", displayName: "云扬 (男声)" },
  { name: "Xiaoyi", shortName: "zh-CN-XiaoyiNeural", locale: "zh-CN", gender: "Female", displayName: "晓伊 (女声)" },
  { name: "Yunjian", shortName: "zh-CN-YunjianNeural", locale: "zh-CN", gender: "Male", displayName: "云健 (男声)" },
  { name: "HsiaoChen", shortName: "zh-TW-HsiaoChenNeural", locale: "zh-TW", gender: "Female", displayName: "曉臻 (台湾女声)" },
  { name: "HiuMaan", shortName: "zh-HK-HiuMaanNeural", locale: "zh-HK", gender: "Female", displayName: "曉曼 (粤语女声)" },
  { name: "Aria", shortName: "en-US-AriaNeural", locale: "en-US", gender: "Female", displayName: "Aria (English)" },
  { name: "Guy", shortName: "en-US-GuyNeural", locale: "en-US", gender: "Male", displayName: "Guy (English)" },
];

function connectId(): string {
  // edge-tts 要求 32 位十六进制无连字符 requestId。
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildSsml(text: string, voice: string, rate: string, pitch: string, volume: string): string {
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">` +
    `<voice name="${voice}">` +
    `<prosody rate="${rate}" pitch="${pitch}" volume="${volume}">` +
    `${escapeXml(text)}` +
    `</prosody></voice></speak>`
  );
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15) + "Z";
}

/**
 * 合成一段文本为音频 blob + 逐词边界。单次文本不宜过长(见 maxTextLengthPerRequest),
 * 上层按段落切块预取。
 */
export function synthesizeBookTts(input: {
  text: string;
  voice?: string;
  rate?: string;
  pitch?: string;
  volume?: string;
  signal?: AbortSignal;
}): Promise<BookTtsSynthesisResult> {
  const text = input.text.trim();
  if (!text) return Promise.reject(new Error("缺少朗读文本"));

  const voice = input.voice || BOOK_TTS_DEFAULTS.voice;
  const rate = input.rate || BOOK_TTS_DEFAULTS.rate;
  const pitch = input.pitch || BOOK_TTS_DEFAULTS.pitch;
  const volume = input.volume || BOOK_TTS_DEFAULTS.volume;

  return new Promise<BookTtsSynthesisResult>((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(SYNTH_URL);
    } catch (e) {
      reject(e instanceof Error ? e : new Error("无法建立 TTS 连接"));
      return;
    }
    ws.binaryType = "arraybuffer";

    const audioChunks: Uint8Array[] = [];
    const boundaries: BookTtsBoundary[] = [];
    let mimeType = "audio/mpeg";
    let settled = false;

    const cleanup = () => {
      input.signal?.removeEventListener("abort", onAbort);
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      } catch {
        /* ignore */
      }
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (audioChunks.length === 0) {
        reject(new Error("TTS 未返回音频"));
        return;
      }
      resolve({
        blob: new Blob(audioChunks as BlobPart[], { type: mimeType }),
        mimeType,
        boundaries,
      });
    };

    const onAbort = () => fail(new Error("TTS 已取消"));
    input.signal?.addEventListener("abort", onAbort);

    ws.onopen = () => {
      const reqId = connectId();
      // 1) 配置帧:声明输出音频格式。
      const configMsg =
        `X-Timestamp:${timestamp()}\r\n` +
        `Content-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n` +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: true },
                outputFormat: "audio-24khz-48kbitrate-mono-mp3",
              },
            },
          },
        });
      ws.send(configMsg);

      // 2) SSML 帧。
      const ssml = buildSsml(text, voice, rate, pitch, volume);
      const ssmlMsg =
        `X-RequestId:${reqId}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${timestamp()}\r\n` +
        `Path:ssml\r\n\r\n` +
        ssml;
      ws.send(ssmlMsg);
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        // 文本控制帧:header\r\n\r\nbody。turn.end 表示合成结束。
        const text = event.data;
        const headerEnd = text.indexOf("\r\n\r\n");
        const header = headerEnd >= 0 ? text.slice(0, headerEnd) : text;
        const body = headerEnd >= 0 ? text.slice(headerEnd + 4) : "";
        if (/Path:turn\.end/i.test(header)) {
          succeed();
          return;
        }
        if (/Path:audio\.metadata/i.test(header)) {
          try {
            const meta = JSON.parse(body);
            const items = Array.isArray(meta?.Metadata) ? meta.Metadata : [];
            for (const m of items) {
              if (m?.Type === "WordBoundary" && m?.Data) {
                boundaries.push({
                  offset: Number(m.Data.Offset || 0),
                  duration: Number(m.Data.Duration || 0),
                  text: String(m.Data.text?.Text ?? m.Data.Text ?? ""),
                });
              }
            }
          } catch {
            /* ignore malformed metadata */
          }
        }
        return;
      }

      // 二进制帧:前 2 字节大端表示 header 长度,header 后是音频负载。
      const buf = new Uint8Array(event.data as ArrayBuffer);
      if (buf.length < 2) return;
      const headerLen = (buf[0] << 8) | buf[1];
      const headerStr = new TextDecoder("utf-8").decode(buf.subarray(2, 2 + headerLen));
      const ctMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);
      if (ctMatch) mimeType = ctMatch[1].trim();
      const payload = buf.subarray(2 + headerLen);
      if (payload.length > 0) audioChunks.push(payload);
    };

    ws.onerror = () => fail(new Error("TTS 连接出错(可能被网络/代理拦截)"));
    ws.onclose = () => {
      // 正常结束会在 turn.end 时 succeed;若没拿到 turn.end 就断,视作已收到的音频可用。
      if (!settled) {
        if (audioChunks.length > 0) succeed();
        else fail(new Error("TTS 连接意外关闭"));
      }
    };
  });
}
