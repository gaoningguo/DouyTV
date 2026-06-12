import type { MediaItem } from "@/types/media";

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// Tauri v2 自定义 URI Scheme 跨平台访问形式：
//   Windows / Android (WebView2 / Android WebView)：http://<scheme>.localhost
//   macOS / iOS / Linux (WKWebView / WebKitGTK)：<scheme>://localhost
// WebView2 拒绝 XHR/fetch 访问非标准协议，必须走 http://<scheme>.localhost。
const PROXY_ORIGIN = (() => {
  if (typeof navigator === "undefined") return "dyproxy://localhost";
  return /Windows|Android/i.test(navigator.userAgent)
    ? "http://dyproxy.localhost"
    : "dyproxy://localhost";
})();

// iOS 检测：WKWebView 内 <video> 无法访问 http://127.0.0.1 本地流代理，
// 且原生播放器不支持裸 chunked fMP4，需要走 dyproxy HLS + 逐 segment 解密。
const IS_IOS = (() => {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
})();

/**
 * 本地 hyper 流式代理端口 —— Tauri 启动时调一次 get_stream_proxy_port 缓存。
 * FLV / MPEG-TS 直播必须走这个 server（不是 dyproxy），因为 Tauri URI scheme
 * 不支持 chunked streaming，FLV 无限流必然 buffer 死。
 */
let cachedStreamProxyPort: number | null = null;

export async function initStreamProxyPort(): Promise<number | null> {
  if (!isTauri) return null;
  if (cachedStreamProxyPort !== null) return cachedStreamProxyPort;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const port = (await invoke("get_stream_proxy_port")) as number | null;
    if (typeof port === "number" && port > 0) {
      cachedStreamProxyPort = port;
      return port;
    }
  } catch (e) {
    console.warn("[proxy] init stream proxy port failed", e);
  }
  return null;
}

/** 同步读端口（init 之后才有）。给 wrapWithProxy 这种 sync 用。 */
export function getStreamProxyPort(): number | null {
  return cachedStreamProxyPort;
}

/** 不区分大小写读取 header，HLS 源脚本设头键大小写不一致。 */
function getHeader(
  headers: Record<string, string> | undefined,
  key: string
): string {
  if (!headers) return "";
  const lower = key.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) return headers[k] || "";
  }
  return "";
}

/** URL 启发式 — 是否疑似 HLS m3u8（含 .m3u8 / .m3u / format=m3u8 等）。 */
function urlLooksLikeHls(url: string): boolean {
  const lower = url.toLowerCase();
  if (lower.includes(".m3u8")) return true;
  if (lower.endsWith(".m3u") || lower.includes(".m3u?")) return true;
  if (/[?&](format|type|ext)=m3u8?\b/.test(lower)) return true;
  return false;
}

interface ProxyOpts {
  filterAds?: boolean;
  proxyUrl?: string;
  bypassSystemProxy?: boolean;
  cencDecrypt?: boolean;
}

/** 通用代理 URL 构造 — 用原生 URL API，杜绝拼接转义错误。 */
function buildProxyUrl(
  endpoint: "m3u8" | "stream" | "segment" | "key" | "image",
  upstream: string,
  params: {
    ua?: string;
    referer?: string;
  } & ProxyOpts = {}
): string {
  try {
    const u = new URL(`${PROXY_ORIGIN}/proxy/${endpoint}`);
    u.searchParams.set("url", upstream);
    if (params.ua) u.searchParams.set("ua", params.ua);
    if (params.referer) u.searchParams.set("referer", params.referer);
    if (params.filterAds === false) u.searchParams.set("filter_ads", "0");
    if (params.cencDecrypt) u.searchParams.set("cenc_decrypt", "1");
    if (params.bypassSystemProxy) {
      u.searchParams.set("bypass_proxy", "1");
    } else if (params.proxyUrl) {
      u.searchParams.set("proxy", params.proxyUrl);
    }
    return u.toString();
  } catch (e) {
    console.warn("[proxy] buildProxyUrl 失败，回退原始 URL：", upstream, e);
    return upstream;
  }
}

/**
 * 把任意视频 URL 包装为 dyproxy 代理 URL，彻底绕过 WebView2 / CORS 限制。
 *
 * 策略（Tauri 环境内一律代理）：
 *   - HLS（显式 streamType=hls，或 URL 启发式判定）→ /proxy/m3u8
 *       Rust 端拉取并文本重写内部 fragment / key / init segment URI
 *   - 其它（mp4 / flv / ts / dash / 未知）→ /proxy/stream
 *       Rust 端二进制透传上游响应，附加跨域 / range 头
 *   - 浏览器 dev（非 Tauri）→ 原 URL（依赖远端 CORS）
 */
export function wrapWithProxy(
  item: MediaItem,
  opts: ProxyOpts = {}
): string {
  if (!isTauri || !item.url) return item.url || "";

  // Agora WebRTC SFU(ManyVids 系)—— SDK 自己管 WebSocket / WebRTC 网络栈,
  // dyproxy / stream proxy 都不掺和。url 是 sentinel "agora-rtc://{channelId}",
  // ArtPlayer customType.agorartc 拿到后从 item.agora 里读真实凭证。
  if (item.streamType === "agora-rtc") return item.url;

  const ua = getHeader(item.headers, "User-Agent");
  // 防盗链：源脚本未指定 Referer 时回落到 https://movie.douban.com/。
  // 与 MoonTV 的 video-proxy / image-proxy 默认 Referer 一致，绕过 Douban
  // 关联站的防盗链 (它们普遍只校验 Referer host 在 douban 列表里)。
  const referer =
    getHeader(item.headers, "Referer") || "https://movie.douban.com/";

  // streamType 判定：显式优先；"auto" / undefined / 未知 → URL 启发式
  let isHls: boolean;
  let isFlv: boolean;
  let isChunkedMp4: boolean;
  let isSampleAesMp4: boolean;
  switch (item.streamType) {
    case "hls":
      isHls = true;
      isFlv = false;
      isChunkedMp4 = false;
      isSampleAesMp4 = false;
      break;
    case "flv":
      isHls = false;
      isFlv = true;
      isChunkedMp4 = false;
      isSampleAesMp4 = false;
      break;
    case "chunked-mp4":
      // 平台返的 live.mp4?token=... fragmented MP4 长连接(AmateurTV / Cam4 / a0s.net 系)。
      // body 是合法 .mp4 但 Transfer-Encoding: chunked,必须走 hyper stream proxy,
      // 不能走 dyproxy URI scheme(后者拿完整 Vec<u8> 才响应 → 直播流读不到 EOF 卡死)。
      isHls = false;
      isFlv = false;
      isChunkedMp4 = true;
      isSampleAesMp4 = false;
      break;
    case "sample-aes-mp4":
      // a0s.net 系平台 fmp4-hls 端点:Rust 端拉 m3u8 + key.bin,SAMPLE-AES 逐 sample 解密
      // 后推明文 fMP4 给 native <video>。走 stream proxy + decrypt=sample-aes。
      isHls = false;
      isFlv = false;
      isChunkedMp4 = false;
      isSampleAesMp4 = true;
      break;
    case "mp4":
    case "dash":
      isHls = false;
      isFlv = false;
      isChunkedMp4 = false;
      isSampleAesMp4 = false;
      break;
    default:
      // "auto" / undefined / 任何未知值
      isHls = urlLooksLikeHls(item.url);
      isFlv = !isHls && /\.flv(\?|$)/i.test(item.url);
      isChunkedMp4 = false;
      isSampleAesMp4 = false;
  }

  // SAMPLE-AES 解密代理:
  // iOS: 走 dyproxy m3u8 + 逐 segment CENC 解密（iOS WKWebView <video> 无法访问 localhost HTTP,
  //       且原生播放器不支持裸 chunked fMP4）。Rust 端拉 m3u8、提取 key、strip #EXT-X-KEY,
  //       segment URL 注入 cenc_key/cenc_iv,segment handler 拉取+解密+返回明文 fMP4。
  //       iOS 原生 HLS 播放器看到的是无加密 CMAF HLS。
  // 其它平台: 走 stream proxy + decrypt=sample-aes（chunked fMP4 流式解密）。
  if (isSampleAesMp4) {
    if (IS_IOS) {
      return buildProxyUrl("m3u8", item.url, {
        ua,
        referer,
        filterAds: opts.filterAds,
        proxyUrl: opts.proxyUrl,
        bypassSystemProxy: opts.bypassSystemProxy,
        cencDecrypt: true,
      });
    }
    const port = getStreamProxyPort();
    if (port) {
      const u = new URL(`http://127.0.0.1:${port}/`);
      u.searchParams.set("url", item.url);
      u.searchParams.set("decrypt", "sample-aes");
      if (ua) u.searchParams.set("ua", ua);
      if (referer) u.searchParams.set("referer", referer);
      if (!opts.bypassSystemProxy && opts.proxyUrl) {
        u.searchParams.set("proxy", opts.proxyUrl);
      }
      return u.toString();
    }
    console.warn("[proxy] sample-aes-mp4 但 stream proxy 端口未就绪");
    return item.url;
  }

  // FLV / chunked-MP4 直播：都走本地 hyper 流代理(chunked streaming, dyproxy 做不了)
  if (isFlv || isChunkedMp4) {
    const port = getStreamProxyPort();
    if (port) {
      const u = new URL(`http://127.0.0.1:${port}/`);
      u.searchParams.set("url", item.url);
      if (ua) u.searchParams.set("ua", ua);
      if (referer) u.searchParams.set("referer", referer);
      // proxy 让 stream proxy 透传给 ureq / WS 桥(AmateurTV / Cam4 等海外平台必须走代理)
      if (!opts.bypassSystemProxy && opts.proxyUrl) {
        u.searchParams.set("proxy", opts.proxyUrl);
      }
      return u.toString();
    }
    // 端口未就绪 fallback：走 dyproxy（功能有限但起码 referer 注入到位）
    return buildProxyUrl("stream", item.url, {
      ua,
      referer,
      filterAds: opts.filterAds,
      proxyUrl: opts.proxyUrl,
      bypassSystemProxy: opts.bypassSystemProxy,
    });
  }

  const endpoint = isHls ? "m3u8" : "stream";
  return buildProxyUrl(endpoint, item.url, {
    ua,
    referer,
    filterAds: opts.filterAds,
    proxyUrl: opts.proxyUrl,
    bypassSystemProxy: opts.bypassSystemProxy,
  });
}

/**
 * 包装单个分片 / 任意子资源 URL。
 * 前端一般不直接用 —— Rust 端 m3u8 重写会自动产出 segment 代理 URL。
 * 仅 fallback / 手动重写场景使用。
 */
export function wrapSegment(
  absUrl: string,
  headers?: Record<string, string>
): string {
  if (!isTauri || !absUrl) return absUrl || "";
  return buildProxyUrl("segment", absUrl, {
    ua: getHeader(headers, "User-Agent"),
    referer: getHeader(headers, "Referer"),
  });
}

/**
 * 包装图片资源（海报 / Logo / 缩略图），解决 <img> 标签触发的防盗链。
 * 与 segment 共享后端 binary passthrough 逻辑，仅 endpoint 不同便于服务端区分缓存。
 */
export function wrapImage(
  imgUrl: string | undefined,
  headers?: Record<string, string>
): string | undefined {
  if (!imgUrl) return imgUrl;
  if (!isTauri) return imgUrl;
  return buildProxyUrl("image", imgUrl, {
    ua: getHeader(headers, "User-Agent"),
    referer: getHeader(headers, "Referer"),
  });
}

function musicReferer(platform?: string, url?: string): string {
  switch ((platform || "").toLowerCase()) {
    case "wy":
    case "netease":
      return "https://music.163.com/";
    case "tx":
    case "qq":
      return "https://y.qq.com/";
    case "kw":
    case "kuwo":
      return "https://www.kuwo.cn/";
    case "kg":
    case "kugou":
      return "https://www.kugou.com/";
    case "mg":
    case "migu":
      return "https://music.migu.cn/";
    default:
      try {
        return url ? new URL(url).origin + "/" : "https://music.163.com/";
      } catch {
        return "https://music.163.com/";
      }
  }
}

function originFromReferer(referer: string): string {
  try {
    return new URL(referer).origin;
  } catch {
    return referer.replace(/\/+$/, "");
  }
}

function defaultAudioUa(): string {
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
}

export interface LxMusicStreamSong {
  id: string;
  title: string;
  artist: string;
  platform?: string;
  songmid?: string;
  durationText?: string;
  hash?: string;
  copyrightId?: string;
  albumId?: string;
  lrcUrl?: string;
  mrcUrl?: string;
  trcUrl?: string;
}

export function buildLxMusicStreamUrl({
  baseUrl,
  token,
  song,
  quality,
  headers,
}: {
  baseUrl?: string;
  token?: string;
  song: LxMusicStreamSong;
  quality: string;
  headers?: Record<string, string>;
}): string {
  if (!isTauri) return "";
  const port = getStreamProxyPort();
  if (!port || !baseUrl) return "";
  const platform = song.platform || "kw";
  const songmid = song.songmid || song.id.split("_").slice(1).join("_") || song.id;
  const referer = getHeader(headers, "Referer") || musicReferer(platform);
  const ua = getHeader(headers, "User-Agent") || defaultAudioUa();
  const u = new URL(`http://127.0.0.1:${port}/`);
  u.searchParams.set("music_base", baseUrl);
  if (token) u.searchParams.set("music_token", token);
  u.searchParams.set("quality", quality);
  u.searchParams.set("song_id", song.id);
  u.searchParams.set("source", platform);
  u.searchParams.set("songmid", songmid);
  u.searchParams.set("name", song.title);
  u.searchParams.set("artist", song.artist);
  if (song.durationText) u.searchParams.set("durationText", song.durationText);
  if (song.hash) u.searchParams.set("hash", song.hash);
  if (song.copyrightId) u.searchParams.set("copyrightId", song.copyrightId);
  if (song.albumId) u.searchParams.set("albumId", song.albumId);
  if (song.lrcUrl) u.searchParams.set("lrcUrl", song.lrcUrl);
  if (song.mrcUrl) u.searchParams.set("mrcUrl", song.mrcUrl);
  if (song.trcUrl) u.searchParams.set("trcUrl", song.trcUrl);
  u.searchParams.set("ua", ua);
  u.searchParams.set("referer", referer);
  u.searchParams.set("origin", originFromReferer(referer));
  return u.toString();
}

export function wrapAudioUrl(
  absUrl: string,
  platform?: string,
  headers?: Record<string, string>
): string {
  if (!absUrl) return "";
  if (!isTauri) return absUrl;
  const ua = getHeader(headers, "User-Agent") || defaultAudioUa();
  const referer = getHeader(headers, "Referer") || musicReferer(platform, absUrl);
  if (!IS_IOS) {
    const port = getStreamProxyPort();
    if (port) {
      const u = new URL(`http://127.0.0.1:${port}/`);
      u.searchParams.set("url", absUrl);
      u.searchParams.set("ua", ua);
      u.searchParams.set("referer", referer);
      u.searchParams.set("origin", originFromReferer(referer));
      return u.toString();
    }
  }
  return buildProxyUrl("stream", absUrl, {
    ua,
    referer,
  });
}

/** 平台 → Referer 默认值（NetEase MP3 CDN 等节点对盗链有 host 校验）。 */

/**
 * 包装音频 URL 走 dyproxy 的 segment 端点 ——
 *  - Rust ureq follows 302 redirects 自动（NetEase outer/url 跳到 m702 CDN）
 *  - 注入 source-aware Referer，对应平台 CDN 才放行
 *  - 拿到 binary passthrough + CORS 头，<audio> 元素能直接消费
 *
 * 非 Tauri 环境（dev 浏览器）直接返回原始 URL（受 CORS 限制，多数会失败）。
 */
