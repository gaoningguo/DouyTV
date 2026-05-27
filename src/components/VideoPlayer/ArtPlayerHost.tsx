/**
 * ArtPlayer 5 wrapper — DouyTV 的新 VideoPlayer 底座。
 *
 * 替代了原 1482 行 `<video>` + 手写控件实现，对齐 MoonTV 的播放体验：
 *  - 全套控件：播放/暂停/进度/音量/PiP/全屏/网页全屏/截屏/锁定/长按倍速
 *  - 设置菜单：去广告 / 弹幕开关 / 跳过片头片尾 / 跳过配置 / 缓冲策略
 *  - HLS 通过 hls.js 自定义 customType.m3u8，带 ABR + 缓冲策略 + 403/404 错误识别
 *  - 弹幕通过 artplayer-plugin-danmuku
 *
 * 实例策略：每个 React 组件挂载一次 ArtPlayer，URL 切换走 `art.switch`，
 * 而不是 destroy + new。这是 MoonTV 的同款做法，避免 HLS / 弹幕实例反复销毁。
 *
 * 与外界 Props 接口保持不变（VideoFeed / Play.tsx 不需要改动）。
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import Artplayer from "artplayer";
import artplayerPluginDanmuku from "artplayer-plugin-danmuku";
import type { Danmu } from "artplayer-plugin-danmuku";
import Hls from "hls.js";
import mpegts from "mpegts.js";
import type { MediaItem } from "@/types/media";
import { wrapWithProxy } from "@/lib/proxy";
import { useProxyStore } from "@/stores/proxy";
import { useNetliveProxyStore, resolveProxyForPlatform } from "@/stores/netliveProxy";
import type { NetLivePlatformId } from "@/lib/netlive/types";
import { useDanmakuStore } from "@/stores/danmaku";
import { convertDanmakuFormat, getDanmakuById, matchAnime } from "@/lib/danmaku/api";
import { loadDanmakuMemory } from "@/components/DanmakuPanel";

// agora-rtc-sdk-ng 类型(实际 SDK 走动态 import 懒加载,不在 initial bundle)
type AgoraClient = {
  on: (ev: string, cb: (...args: unknown[]) => void) => void;
  subscribe: (user: AgoraRemoteUser, mediaType: "video" | "audio") => Promise<void>;
  join: (appId: string, channel: string, token: string, uid: number) => Promise<number>;
  leave: () => Promise<void>;
  setClientRole: (role: "host" | "audience") => Promise<void>;
};
type AgoraRemoteTrack = {
  play: (element?: HTMLElement | string) => void;
  stop: () => void;
  setVolume?: (v: number) => void;
};
type AgoraRemoteUser = {
  uid: number | string;
  videoTrack?: AgoraRemoteTrack;
  audioTrack?: AgoraRemoteTrack;
};

/**
 * Agora client / track 提升为模块级 singleton + 串行 leave queue。
 *
 * 为什么:Agora server 对同一个 (token, uid) 并发 join 会报 `UID_CONFLICT`。
 * React 18 StrictMode dev 模式双 mount/unmount,组件 ref 在第二次 mount 时已重置,
 * 看不到第一次的 client,于是用同一份 item.agora 再 join 一次 → 撞 server 还没释放的旧 connection。
 * 改成 module-level + leave chain:任何新 join 必须 `await agoraLeaveChain`,确保
 * 老 connection 在 server 端释放完毕。生产环境切主播每次拿新 token 也走同一条路,稳。
 */
let agoraGlobalClient: AgoraClient | null = null;
let agoraGlobalTracks: AgoraRemoteTrack[] = [];
let agoraLeaveChain: Promise<void> = Promise.resolve();

function scheduleAgoraLeave(client: AgoraClient, tracks: AgoraRemoteTrack[]) {
  const next = (async () => {
    await agoraLeaveChain;
    for (const t of tracks) { try { t.stop(); } catch { /* ignore */ } }
    try { await client.leave(); } catch { /* ignore */ }
  })();
  agoraLeaveChain = next;
  return next;
}

export interface VideoPlayerHandle {
  play: () => void;
  pause: () => void;
  seek: (sec: number) => void;
  getElement: () => HTMLVideoElement | null;
}

export interface VideoPlayerProps {
  item: MediaItem;
  active: boolean;
  preload?: "none" | "metadata" | "auto";
  loop?: boolean;
  muted?: boolean;
  hotkeys?: boolean;
  /**
   * `true` = 长片模式（Play 页），显示完整控件 + 设置菜单 + 全屏
   * `false` = 紧凑模式（Home 短视频流），仅保留弹幕层，所有 chrome 隐藏
   */
  controls?: boolean;
  startPosition?: number;
  onMutedChange?: (muted: boolean) => void;
  onProgress?: (position: number, duration: number) => void;
  onEnded?: () => void;
  onError?: (err: Error) => void;
  /** 错误页「重新解析」按钮：调用方应重新 callResolvePlayUrl 拿一个新 URL */
  onRequestReresolve?: () => Promise<void> | void;
  /** 错误页 / 工具栏「换源」按钮：调用方应打开线路选择面板 */
  onRequestSwitchSource?: () => void;
  /** 工具栏「上一集」按钮回调；不传 = 隐藏按钮（无合集 / 已到首集） */
  onPrevEpisode?: () => void;
  /** 工具栏「下一集」按钮回调；不传 = 隐藏按钮（无合集 / 已到末集） */
  onNextEpisode?: () => void;
  /** 弹幕数据。空数组时弹幕层仍挂载但无内容。 */
  danmuComments?: Danmu[];
  /** 弹幕是否显示。控件 toggle 和外部传值都会改这个。 */
  danmakuVisible?: boolean;
  /**
   * NetLive 平台 id —— 不为空时,代理 URL 走该平台的 per-platform 覆盖
   * (`stores/netliveProxy.ts`),不再读全局 `useProxyStore`。供直播页传入,
   * 视频流分片 fetch 跟列表 API 用同一份代理决策。
   */
  netlivePlatform?: NetLivePlatformId;
}

const FILTER_ADS_KEY = "douytv:filter-ads";
const BUFFER_KEY = "douytv:buffer-strategy";
// 工具栏用户偏好缓存（音量 / 倍速）—— 跨视频跨重启保留
// 弹幕显示开关由 Play.tsx 自己读写 douytv:player-danmaku-visible
const VOLUME_KEY = "douytv:player-volume";
const RATE_KEY = "douytv:player-playback-rate";
type BufferStrategy = "low" | "medium" | "high" | "ultra";

function getBufferConfig(strategy: BufferStrategy) {
  switch (strategy) {
    case "low":
      return { maxBufferLength: 30, backBufferLength: 15, maxBufferSize: 60 * 1024 * 1024 };
    case "high":
      return { maxBufferLength: 120, backBufferLength: 60, maxBufferSize: 240 * 1024 * 1024 };
    case "ultra":
      return { maxBufferLength: 240, backBufferLength: 90, maxBufferSize: 480 * 1024 * 1024 };
    default:
      // medium — 默认缓冲 90s（原 60s）。提高默认值，跳着看也能命中已缓冲段
      return { maxBufferLength: 90, backBufferLength: 30, maxBufferSize: 150 * 1024 * 1024 };
  }
}

function readNumberPref(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  } catch {
    return fallback;
  }
}

function writeNumberPref(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* private */
  }
}

function detectArtType(item: MediaItem): string | undefined {
  if (item.streamType === "hls") return "m3u8";
  if (item.streamType === "flv") return "flv";
  if (item.streamType === "dash") return "mpd";
  if (item.streamType === "mp4") return undefined; // 原生
  // chunked-mp4 = AmateurTV / Cam4 之类的 fragmented MP4 长连接(走 stream proxy 后,
  // body 看上去就是普通 .mp4,native <video> 直接能播)
  if (item.streamType === "chunked-mp4") return undefined;
  // sample-aes-mp4 = a0s.net 系平台 fmp4-hls。
  // iOS: 走 dyproxy m3u8 + 逐 segment CENC 解密 → 原生 HLS 播放器消费无加密 HLS。
  // 其它平台: Rust stream proxy 推明文 chunked fMP4 → native <video> 直接消费。
  if (item.streamType === "sample-aes-mp4") {
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1);
    return isIOS ? "m3u8" : undefined;
  }
  // agora-rtc = ManyVids 系 Agora WebRTC SFU。走 customType.agorartc 接管,
  // SDK 懒加载 + join 频道 + subscribe 远端 track,绕开 ArtPlayer 的 URL 加载机制。
  if (item.streamType === "agora-rtc") return "agorartc";
  const u = item.url.toLowerCase();
  if (u.includes(".m3u8")) return "m3u8";
  if (u.includes(".flv")) return "flv";
  if (u.includes(".mpd")) return "mpd";
  return undefined;
}

function readBufferStrategy(): BufferStrategy {
  try {
    const v = localStorage.getItem(BUFFER_KEY);
    if (v === "low" || v === "medium" || v === "high" || v === "ultra") return v;
  } catch {
    /* private mode */
  }
  return "medium";
}

function readFilterAds(): boolean {
  try {
    return localStorage.getItem(FILTER_ADS_KEY) !== "0";
  } catch {
    return true;
  }
}

function readSkipMarks(itemId: string): { intro?: number; outro?: number } {
  try {
    const raw = localStorage.getItem(`douytv:skip-marks:${itemId}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return {
      intro: typeof parsed.intro === "number" ? parsed.intro : undefined,
      outro: typeof parsed.outro === "number" ? parsed.outro : undefined,
    };
  } catch {
    return {};
  }
}

function writeSkipMarks(itemId: string, marks: { intro?: number; outro?: number }) {
  try {
    localStorage.setItem(`douytv:skip-marks:${itemId}`, JSON.stringify(marks));
  } catch {
    /* private mode */
  }
}

/**
 * 简易跳过配置对话框 — 复刻 MoonTV `跳过配置` 的 UX。
 * 内嵌纯 DOM 而非 React Portal，是因为 ArtPlayer 全屏下 React 树不在 fullscreen 节点内，
 * Portal 渲染的弹窗会被浏览器吞掉。
 */
function openSkipConfigDialog(
  currentIntro: number,
  currentOutro: number,
  art: Artplayer,
  onSave: (intro: number, outro: number) => void
) {
  const container = document.createElement("div");
  container.style.cssText = `
    position: fixed; top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    background: var(--ink-2, #16181D);
    border: 1px solid var(--cream-line, rgba(242,232,213,.10));
    color: var(--cream, #F2E8D5);
    padding: 20px; border-radius: 14px; z-index: 99999;
    min-width: 320px; max-width: 90vw;
    font-family: "Bricolage Grotesque", "PingFang SC", system-ui, sans-serif;
    box-shadow: 0 24px 48px -24px rgba(0,0,0,0.8);
  `;
  container.innerHTML = `
    <div style="font-size:15px;font-weight:700;margin-bottom:14px;letter-spacing:-0.01em;">跳过片头片尾</div>
    <div style="display:flex;flex-direction:column;gap:12px;">
      <label style="display:flex;flex-direction:column;gap:6px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;opacity:0.6;">
        片头（秒）
        <div style="display:flex;gap:8px;">
          <input id="intro-input" type="number" min="0" step="1" value="${currentIntro}"
            style="flex:1;padding:8px 10px;border-radius:8px;border:1px solid var(--cream-line, rgba(242,232,213,.10));background:var(--ink, #0E0F11);color:var(--cream, #F2E8D5);font-family:'JetBrains Mono', monospace;font-size:14px;" />
          <button id="set-intro" type="button" style="padding:8px 12px;border-radius:8px;border:1px solid var(--cream-line, rgba(242,232,213,.10));background:var(--ink-3, #1F232B);color:var(--cream, #F2E8D5);font-size:12px;cursor:pointer;">当前时间</button>
        </div>
      </label>
      <label style="display:flex;flex-direction:column;gap:6px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;opacity:0.6;">
        片尾（秒）
        <div style="display:flex;gap:8px;">
          <input id="outro-input" type="number" min="0" step="1" value="${currentOutro}"
            style="flex:1;padding:8px 10px;border-radius:8px;border:1px solid var(--cream-line, rgba(242,232,213,.10));background:var(--ink, #0E0F11);color:var(--cream, #F2E8D5);font-family:'JetBrains Mono', monospace;font-size:14px;" />
          <button id="set-outro" type="button" style="padding:8px 12px;border-radius:8px;border:1px solid var(--cream-line, rgba(242,232,213,.10));background:var(--ink-3, #1F232B);color:var(--cream, #F2E8D5);font-size:12px;cursor:pointer;">剩余时长</button>
        </div>
      </label>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px;">
      <button id="cancel" type="button" style="padding:8px 16px;border-radius:8px;border:1px solid var(--cream-line, rgba(242,232,213,.10));background:transparent;color:var(--cream, #F2E8D5);font-size:13px;cursor:pointer;">取消</button>
      <button id="clear" type="button" style="padding:8px 16px;border-radius:8px;border:none;background:var(--ink-3, #1F232B);color:var(--cream, #F2E8D5);font-size:13px;cursor:pointer;">清除</button>
      <button id="confirm" type="button" style="padding:8px 16px;border-radius:8px;border:none;background:var(--ember, #FF6B35);color:#0E0F11;font-weight:600;font-size:13px;cursor:pointer;">保存</button>
    </div>
  `;
  document.body.appendChild(container);

  const introInput = container.querySelector("#intro-input") as HTMLInputElement;
  const outroInput = container.querySelector("#outro-input") as HTMLInputElement;
  const cleanup = () => container.remove();

  container.querySelector("#set-intro")?.addEventListener("click", () => {
    if (art.currentTime > 0) introInput.value = String(Math.floor(art.currentTime));
  });
  container.querySelector("#set-outro")?.addEventListener("click", () => {
    if (art.duration > 0 && art.currentTime > 0) {
      outroInput.value = String(Math.max(0, Math.floor(art.duration - art.currentTime)));
    }
  });
  container.querySelector("#cancel")?.addEventListener("click", cleanup);
  container.querySelector("#clear")?.addEventListener("click", () => {
    onSave(0, 0);
    cleanup();
  });
  container.querySelector("#confirm")?.addEventListener("click", () => {
    const intro = Math.max(0, Number(introInput.value) || 0);
    const outro = Math.max(0, Number(outroInput.value) || 0);
    onSave(intro, outro);
    cleanup();
  });
}

const ArtPlayerHost = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function ArtPlayerHost(props, ref) {
    const {
      item,
      active,
      loop = true,
      muted: mutedProp,
      hotkeys = true,
      controls = false,
      startPosition,
      onMutedChange,
      onProgress,
      onEnded,
      onError,
      onRequestReresolve,
      onRequestSwitchSource,
      danmuComments,
      danmakuVisible = true,
      netlivePlatform,
    } = props;

    const containerRef = useRef<HTMLDivElement>(null);
    const artRef = useRef<Artplayer | null>(null);
    // 工具栏上下集按钮 DOM 引用（mounted 时存，effect 改 display）
    const prevEpElRef = useRef<HTMLElement | null>(null);
    const nextEpElRef = useRef<HTMLElement | null>(null);
    // ArtPlayer settings / controls onClick 闭包在 mount 时一次性创建，会冻结彼时的 props。
    // 通过 ref 让闭包总能拿到最新的 prop 值（合集变 / 集号变后按钮仍能调对的 callback）。
    const propsRef = useRef(props);
    useEffect(() => {
      propsRef.current = props;
    });
    const hlsRef = useRef<Hls | null>(null);
    const mpegtsRef = useRef<mpegts.Player | null>(null);
    // Agora WebRTC(ManyVids 系)—— client + tracks 走 module-level singleton(见顶部
    // agoraGlobalClient / agoraLeaveChain 注释,解决 React StrictMode 双 mount 导致的
    // UID_CONFLICT)。组件这里只持有"我们当前组件挂的 Agora 容器"引用,cleanup 时
    // schedule leave。
    const agoraContainerRef = useRef<HTMLElement | null>(null);
    const lastProgressTs = useRef(0);
    const proxyEnabled = useProxyStore((s) => s.mode !== "off");
    const proxyUrl = useProxyStore((s) =>
      s.mode === "manual"
        ? s.manualUrl
        : s.mode === "auto"
          ? s.systemProxyUrl
          : ""
    );
    // NetLive 平台 per-platform 代理覆盖 —— 仅订阅当前 platform 那个 override 值,
    // 别的平台变更不会触发本组件 re-render。globalProxy 变化会让 resolveProxyForPlatform
    // 重算,所以同时也订阅 useProxyStore 上面那两行就够了。
    const platformOverride = useNetliveProxyStore((s) =>
      netlivePlatform ? s.overrides[netlivePlatform] : undefined,
    );
    // 用户在弹幕设置里勾的"首页 Feed 显示弹幕"。响应式读取，
    // 用户在设置页改了之后，Home 的播放器立即跟随显隐。
    const enabledInFeed = useDanmakuStore((s) => s.enabledInFeed);
    // InteractionBar 用户在首页选完弹幕源 bumpFeedRefresh() +1 → 触发下面 effect 重读 memory
    const feedRefreshNonce = useDanmakuStore((s) => s.feedRefreshNonce);

    const [filterAds, setFilterAds] = useState<boolean>(readFilterAds);
    const [error, setError] = useState<string | null>(null);
    // 视频实际宽高比 —— loadedmetadata 后读 videoWidth/Height 算出，
    // 让播放器容器自适应贴合视频画面，工具栏自然落在视频底部而非屏幕底部。
    // 默认 16/9 占位避免初次挂载时的 layout shift。仅 controls=true 时生效。
    const [videoAspect, setVideoAspect] = useState<number>(16 / 9);

    const wrappedUrl = useMemo(
      () => {
        // NetLive 场景:用 per-platform 覆盖决定 proxyUrl / bypass,这样
        // segment / m3u8 fetch 跟 adapter 列表 API 用同一份代理决策。
        if (netlivePlatform) {
          const { proxyUrl: pUrl, bypass } = resolveProxyForPlatform(netlivePlatform);
          return wrapWithProxy(item, {
            filterAds,
            proxyUrl: bypass ? undefined : pUrl,
            bypassSystemProxy: bypass,
          });
        }
        return wrapWithProxy(item, {
          filterAds,
          proxyUrl: proxyEnabled ? proxyUrl : undefined,
        });
      },
      [
        item.url,
        item.streamType,
        item.headers,
        filterAds,
        proxyEnabled,
        proxyUrl,
        netlivePlatform,
        platformOverride,
      ],
    );

    // hls.js loader + 错误识别。MoonTV 的 customType.m3u8 移植版（精简）。
    const attachHls = useCallback(
      (video: HTMLVideoElement, url: string) => {
        if (!Hls.isSupported()) {
          video.src = url;
          return;
        }
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
        const cfg = getBufferConfig(readBufferStrategy());
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: item.kind === "live",
          autoStartLoad: true,
          // ── 缓冲（用户可在「缓冲策略」里改） ──────────────
          maxBufferLength: cfg.maxBufferLength,
          maxMaxBufferLength: cfg.maxBufferLength * 2,
          backBufferLength: cfg.backBufferLength,
          maxBufferSize: cfg.maxBufferSize,
          // ── 秒播优化 ───────────────────────────────────
          // 1) 关闭起始带宽探测 — 直接拿默认估算选 level，省一次 RTT
          testBandwidth: false,
          // 2) 默认估算压到 250kbps — 强制首播选最低码率分片（更小、加载更快）
          //    一旦 ABR 见到真实带宽，会立即升级
          abrEwmaDefaultEstimate: 250_000,
          // 3) 起始 level 让 ABR 决策（结合上面的低估算 → 实际就是最低）
          startLevel: -1,
          // 4) Manifest 解析中就预取首片，省一次往返
          startFragPrefetch: true,
          // 5) 流式 (渐进) 解析 — 不等首片完整下载就开始解码
          progressive: true,
          // 6) 根据 video 元素物理尺寸限制 ABR 选 level —— 避免在小窗口里挑 4K
          capLevelToPlayerSize: true,
          // 7) 起始片饥饿期更短，更早触发降级
          maxStarvationDelay: 4,
          maxLoadingDelay: 4,
          highBufferWatchdogPeriod: 1,
          // ── Seek 平滑：跨过缓冲洞 / 找最近 segment ──────
          maxBufferHole: 0.5,
          // 找不到精确匹配片段时，容忍 1s 内的 segment 复用，避免每次拖动都重拉
          maxFragLookUpTolerance: 1.0,
          // 卡顿时 nudge 微调当前时间，最多重试 10 次
          nudgeMaxRetry: 10,
          nudgeOffset: 0.2,
          // ── 超时 / 重试 ────────────────────────────────
          manifestLoadingTimeOut: 10_000,
          manifestLoadingMaxRetry: 2,
          levelLoadingTimeOut: 10_000,
          levelLoadingMaxRetry: 2,
          fragLoadingTimeOut: 20_000,
          fragLoadingMaxRetry: 4,
        });
        hlsRef.current = hls;
        hls.loadSource(url);
        hls.attachMedia(video);
        // hls 实例挂到 video 上，方便 ArtPlayer 的清理钩子复用
        (video as HTMLVideoElement & { hls?: Hls }).hls = hls;

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          // 网络错误 → 上抛真实状态码 + 提示，UI 提供「重试」/「重新解析」
          const statusCode = data.response?.code;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            // 403 / 404 / 5xx → 源失效。直接进错误页让用户决定
            if (
              statusCode === 403 ||
              statusCode === 404 ||
              (typeof statusCode === "number" && statusCode >= 500)
            ) {
              setError(`HTTP ${statusCode}：${
                statusCode === 403
                  ? "防盗链或权限不足"
                  : statusCode === 404
                  ? "资源不存在"
                  : "服务端错误（可能是代理或上游 503）"
              }`);
              onError?.(new Error(`HLS ${data.details} (${statusCode})`));
              hls.destroy();
              hlsRef.current = null;
              return;
            }
            // 其它网络错误尝试 startLoad 恢复一次；如果 manifest 直接挂了也兜底显示
            if (data.details === "manifestLoadError") {
              setError("无法加载视频清单（manifest）");
              onError?.(new Error(`HLS manifestLoadError`));
              hls.destroy();
              hlsRef.current = null;
              return;
            }
            hls.startLoad();
            return;
          }
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
            return;
          }
          setError(`${data.type}: ${data.details}`);
          onError?.(new Error(`HLS ${data.type}: ${data.details}`));
          hls.destroy();
          hlsRef.current = null;
        });
      },
      [item.kind, onError]
    );

    // mpegts.js loader —— 处理 FLV / MPEG-TS over HTTP（斗鱼 / 虎牙 / 抖音 RTMP-over-FLV）。
    // mpegts.js 是 flv.js 的现代化 fork，体积小、能正常处理直播流的 HTTP chunked 响应。
    const attachFlv = useCallback(
      (video: HTMLVideoElement, url: string) => {
        if (!mpegts.getFeatureList().mseLivePlayback) {
          // 浏览器不支持 MSE Live —— 兜底走原生 src（多数会失败但给个机会）
          video.src = url;
          return;
        }
        if (mpegtsRef.current) {
          try {
            mpegtsRef.current.destroy();
          } catch {
            /* ignore */
          }
          mpegtsRef.current = null;
        }
        const isLive = item.kind === "live";
        const isMpegTs = /\.ts(\?|$)/i.test(url);
        const player = mpegts.createPlayer(
          {
            type: isMpegTs ? "mpegts" : "flv",
            url,
            isLive,
            cors: true,
          },
          {
            enableWorker: true,
            enableStashBuffer: !isLive, // 直播禁用 stash 减少延迟
            stashInitialSize: isLive ? 128 : 384,
            liveBufferLatencyChasing: isLive,
            liveBufferLatencyMaxLatency: 3,
            liveBufferLatencyMinRemain: 0.5,
            lazyLoad: false,
            autoCleanupSourceBuffer: true,
          }
        );
        mpegtsRef.current = player;
        // hls 同款 video.hls 字段；这里挂个 mpegtsPlayer 字段，cleanup 钩子认得到
        (video as HTMLVideoElement & { mpegtsPlayer?: mpegts.Player }).mpegtsPlayer = player;
        player.on(mpegts.Events.ERROR, (errType, errDetail) => {
          const msg = `FLV ${errType}${errDetail ? `: ${errDetail}` : ""}`;
          setError(msg);
          onError?.(new Error(msg));
          try {
            player.destroy();
          } catch {
            /* ignore */
          }
          mpegtsRef.current = null;
        });
        player.attachMediaElement(video);
        player.load();
        // 直播流 autoplay
        if (isLive) {
          try {
            const p = player.play() as unknown as Promise<void> | undefined;
            if (p && typeof (p as Promise<void>).catch === "function") {
              p.catch(() => {
                /* user gesture required */
              });
            }
          } catch {
            /* user gesture required */
          }
        }
      },
      [item.kind, onError]
    );

    // Agora WebRTC loader —— ManyVids 之类已迁移到 Agora WebRTC SFU 的平台。
    // 走动态 import() 懒加载 agora-rtc-sdk-ng(~500KB),只在 customType 命中时拉。
    // 凭证从 item.agora 取(adapter.resolve 透传)。SDK 会**在容器里新建一个 <video>**
    // (videoTrack.play(parentEl) 行为),所以我们传 video.parentElement,并把 ArtPlayer
    // 原 <video> 隐藏(否则会双视频堆叠 + 闪烁)。
    const attachAgora = useCallback(
      async (video: HTMLVideoElement, _url: string) => {
        const payload = item.agora;
        if (!payload?.appId) {
          setError("缺少 Agora App ID(见 manyvids.ts MANYVIDS_AGORA_APP_ID 注释)");
          onError?.(new Error("Agora payload missing appId"));
          return;
        }
        if (!payload.channelId || !payload.token) {
          setError("Agora 凭证不完整");
          onError?.(new Error("Agora payload missing channelId/token"));
          return;
        }

        // 旧 client 排队 leave(可能是同组件第二次 attachAgora,或 StrictMode 双 mount 残留)
        if (agoraGlobalClient) {
          scheduleAgoraLeave(agoraGlobalClient, agoraGlobalTracks);
          agoraGlobalClient = null;
          agoraGlobalTracks = [];
        }
        // 等所有 pending leave 完成 —— 保证 Agora server 端那个 (token, uid) 已释放,
        // 新 join 才不会撞 UID_CONFLICT。
        await agoraLeaveChain;

        // 每次 attach 都拿全新 (token, uid)。adapter 实现 refresh() = 每次 POST joinChannel。
        // StrictMode 双 mount 第二次会拿到独立 uid,不会跟第一次撞;生产切回同房间也是新 token。
        // refresh 失败时 fallback 用 payload 里的初始凭证试一次。
        let creds = { channelId: payload.channelId, token: payload.token, uid: payload.uid };
        if (payload.refresh) {
          try {
            creds = await payload.refresh();
          } catch (e) {
            console.warn("[ArtPlayerHost] agora refresh failed, using initial creds", e);
          }
        }

        // ArtPlayer 容器(.art-video-player) —— Agora 会在此插入它自己的 <video>
        const parent = video.parentElement;
        if (!parent) {
          setError("ArtPlayer 容器丢失");
          onError?.(new Error("video.parentElement is null"));
          return;
        }
        agoraContainerRef.current = parent;
        // 隐藏 ArtPlayer 原 <video>(它不会有 src,但占位 + 黑屏会盖住 Agora 创建的 video)
        video.style.display = "none";

        let AgoraRTC: { createClient: (cfg: { mode: string; codec: string }) => AgoraClient };
        try {
          const mod = await import("agora-rtc-sdk-ng");
          // ESM default export 兼容 cjs 互操作
          AgoraRTC = (mod as unknown as { default?: typeof AgoraRTC }).default ?? (mod as unknown as typeof AgoraRTC);
        } catch (e) {
          setError("Agora SDK 加载失败");
          onError?.(e instanceof Error ? e : new Error(String(e)));
          return;
        }

        const client = AgoraRTC.createClient({ mode: "live", codec: "vp8" });
        agoraGlobalClient = client;
        agoraGlobalTracks = [];
        try {
          await client.setClientRole("audience");
        } catch { /* SDK 某些版本不支持,忽略 */ }

        client.on("user-published", async (...args: unknown[]) => {
          const user = args[0] as AgoraRemoteUser;
          const mediaType = args[1] as "video" | "audio";
          if (client !== agoraGlobalClient) return; // 已切换/销毁
          console.log(`[agora] user-published uid=${user.uid} type=${mediaType}`);
          try {
            await client.subscribe(user, mediaType);
          } catch (e) {
            console.warn("[ArtPlayerHost] agora subscribe failed", e);
            return;
          }
          if (mediaType === "video" && user.videoTrack && agoraContainerRef.current) {
            // ArtPlayer 的 .art-poster / .art-mask / .art-loading 会盖住 Agora 创建的 video,
            // 把它们隐藏让画面露出来。Agora SDK 会在容器里 append:
            //   <div class="agora_video_player" id="agora-video-player-track-..."><video/></div>
            // 我们再 force 内部 video 全屏 fit。
            const parent = agoraContainerRef.current;
            const masks = parent.querySelectorAll<HTMLElement>(
              ".art-poster, .art-mask, .art-loading, .art-state, .art-bottom"
            );
            // 只藏视觉遮罩(.art-bottom 控件栏保留)。这里只隐藏会盖画面的层。
            parent.querySelectorAll<HTMLElement>(".art-poster, .art-mask, .art-loading, .art-state")
              .forEach((el) => { el.style.display = "none"; });
            void masks; // 仅记号,实际隐藏已在 querySelectorAll forEach 里
            console.log("[agora] playing videoTrack into container", parent);
            user.videoTrack.play(parent);
            agoraGlobalTracks.push(user.videoTrack);
            // play() 后 SDK 把它的 div 插到 container 末尾,确保 fit + 在顶层
            requestAnimationFrame(() => {
              const agoraDiv = parent.querySelector<HTMLElement>(".agora_video_player");
              if (agoraDiv) {
                agoraDiv.style.position = "absolute";
                agoraDiv.style.inset = "0";
                agoraDiv.style.width = "100%";
                agoraDiv.style.height = "100%";
                agoraDiv.style.zIndex = "10";
                const v = agoraDiv.querySelector("video");
                if (v) {
                  v.style.width = "100%";
                  v.style.height = "100%";
                  v.style.objectFit = "contain";
                }
                console.log("[agora] agora_video_player applied", agoraDiv);
              } else {
                console.warn("[agora] .agora_video_player not found in container after play()");
              }
            });
          }
          if (mediaType === "audio" && user.audioTrack) {
            console.log("[agora] playing audioTrack");
            user.audioTrack.play();
            agoraGlobalTracks.push(user.audioTrack);
          }
        });
        client.on("user-unpublished", (...args: unknown[]) => {
          const user = args[0] as AgoraRemoteUser;
          const mediaType = args[1] as "video" | "audio";
          const t = mediaType === "video" ? user.videoTrack : user.audioTrack;
          if (t) { try { t.stop(); } catch { /* ignore */ } }
        });
        client.on("exception", (...args: unknown[]) => {
          console.warn("[ArtPlayerHost] agora exception", args[0]);
        });

        try {
          await client.join(payload.appId, creds.channelId, creds.token, creds.uid);
        } catch (e) {
          setError(`Agora join 失败: ${e instanceof Error ? e.message : String(e)}`);
          onError?.(e instanceof Error ? e : new Error(String(e)));
          if (agoraGlobalClient === client) {
            scheduleAgoraLeave(client, agoraGlobalTracks);
            agoraGlobalClient = null;
            agoraGlobalTracks = [];
          }
        }
      },
      [item.agora, onError]
    );

    // 实例化 ArtPlayer（仅在挂载时一次）
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      // 切到新 item → 重置宽高比占位 + 清掉上一个 item 残留的错误遮罩(否则切到正常房间还盖着)
      setVideoAspect(16 / 9);
      setError(null);

      const initialType = detectArtType(item);
      const skipMarks = readSkipMarks(item.id);
      // 工具栏跨视频偏好：音量 + 倍速。换个视频不要被重置回默认
      const savedVolume = readNumberPref(VOLUME_KEY, 0.7, 0, 1);
      const savedRate = readNumberPref(RATE_KEY, 1, 0.25, 4);

      const art = new Artplayer({
        container: el,
        url: wrappedUrl,
        ...(initialType ? { type: initialType } : {}),
        ...(item.poster ? { poster: item.poster } : {}),
        volume: savedVolume,
        isLive: item.kind === "live",
        muted: mutedProp ?? false,
        autoplay: active,
        autoSize: false,
        autoMini: false,
        // 工具栏所有按钮在 Play / Feed 两种模式都开启 —— Feed 模式靠 CSS
        // 让 .art-bottom 默认隐藏，鼠标移到底部才显示（详见 styles.css）
        screenshot: true,
        setting: true,
        loop,
        flip: false,
        playbackRate: true,
        aspectRatio: false,
        fullscreen: true,
        fullscreenWeb: true,
        subtitleOffset: false,
        miniProgressBar: false,
        mutex: true,
        playsInline: true,
        autoPlayback: false,
        airplay: true,
        theme: "#FF6B35",
        lang: "zh-cn",
        // hotkey 跟随父组件传入 —— VideoFeed 把 hotkeys 设为 false（让 Feed 自己接管
        // J/K/↑↓），Play 页用默认 true 让 ArtPlayer 处理 space / F / M / ←→
        hotkey: false, // 改用我们自己的 window-level handler（见下方 useEffect），
        // 绕过 ArtPlayer 5 需要先点击播放器才能拿到焦点 / 触发 hotkey 的问题
        fastForward: true, // 长按 3 倍速
        autoOrientation: true,
        lock: true, // 移动端锁屏
        pip: true,
        gesture: true,
        backdrop: false,
        moreVideoAttr: {
          playsInline: true,
          "webkit-playsinline": "true",
          referrerPolicy: "no-referrer",
          preload: "auto",
          // 防止 <video> 获焦后浏览器吞掉 Space / 方向键 — 我们用 window-level
          // handler 自己处理快捷键
          tabIndex: -1,
        } as Partial<HTMLVideoElement>,
        customType: {
          m3u8: (video: HTMLVideoElement, url: string) => attachHls(video, url),
          flv: (video: HTMLVideoElement, url: string) => attachFlv(video, url),
          agorartc: (video: HTMLVideoElement, url: string) => { void attachAgora(video, url); },
        },
        // 工具栏左侧：上一集 / 下一集（合集时）。propsRef 让闭包始终读最新 prop，
        // 避免切集后按钮调用旧 callback。隐藏由 CSS .art-control[data-state="off"] 控制。
        controls: [
          {
            name: "prev-ep",
            position: "left",
            html: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 20L9 12l10-8v16zM5 19V5"/></svg>',
            tooltip: "上一集",
            style: { marginRight: "6px" },
            click: () => {
              const fn = propsRef.current.onPrevEpisode;
              if (fn) fn();
              else if (artRef.current?.notice) artRef.current.notice.show = "已是第一集";
            },
            mounted: (el: HTMLElement) => {
              prevEpElRef.current = el;
              el.style.display = propsRef.current.onPrevEpisode ? "" : "none";
            },
          },
          {
            name: "next-ep",
            position: "left",
            html: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4l10 8-10 8V4zM19 5v14"/></svg>',
            tooltip: "下一集",
            style: { marginRight: "10px" },
            click: () => {
              const fn = propsRef.current.onNextEpisode;
              if (fn) fn();
              else if (artRef.current?.notice) artRef.current.notice.show = "已是最后一集";
            },
            mounted: (el: HTMLElement) => {
              nextEpElRef.current = el;
              el.style.display = propsRef.current.onNextEpisode ? "" : "none";
            },
          },
        ],
        plugins: [
          artplayerPluginDanmuku({
            danmuku: danmuComments ?? [],
            speed: 5,
            opacity: 1,
            fontSize: 25,
            color: "#FFFFFF",
            mode: 0,
            margin: [10, "25%"],
            antiOverlap: true,
            synchronousPlayback: false,
            emitter: false,
            theme: "dark",
            visible: danmakuVisible && (danmuComments?.length ?? 0) > 0,
          }),
        ],
        // 自定义设置菜单 — Play 与 Feed 都挂载，统一交互
        settings: [
          {
            html: "去广告",
            icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 9l8 6M16 9l-8 6"/></svg>',
            tooltip: filterAds ? "已开启" : "已关闭",
            switch: filterAds,
            onSwitch(item) {
              const newVal = !item.switch;
              try {
                localStorage.setItem(FILTER_ADS_KEY, newVal ? "1" : "0");
              } catch {
                /* private */
              }
              setFilterAds(newVal);
              return newVal;
            },
          },
              {
                html: "跳过片头片尾",
                icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4l8 8-8 8M14 4v16"/></svg>',
                tooltip:
                  skipMarks.intro || skipMarks.outro
                    ? `片头 ${skipMarks.intro ?? 0}s · 片尾 ${skipMarks.outro ?? 0}s`
                    : "设置跳过区间",
                onClick: () => {
                  const current = readSkipMarks(item.id);
                  openSkipConfigDialog(
                    current.intro ?? 0,
                    current.outro ?? 0,
                    art,
                    (intro, outro) => {
                      const next = {
                        intro: intro > 0 ? intro : undefined,
                        outro: outro > 0 ? outro : undefined,
                      };
                      writeSkipMarks(item.id, next);
                    }
                  );
                  return "设置完成后自动保存";
                },
              },
              {
                html: "缓冲策略",
                icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>',
                selector: (["low", "medium", "high", "ultra"] as BufferStrategy[]).map(
                  (s) => ({
                    html: { low: "省流", medium: "均衡", high: "流畅", ultra: "极限" }[s],
                    value: s,
                    default: readBufferStrategy() === s,
                  })
                ),
                onSelect(it) {
                  try {
                    localStorage.setItem(BUFFER_KEY, String(it.value));
                  } catch {
                    /* private */
                  }
                  // 不立即 attachHls —— 立即重挂 manifest 会导致部分源 URL（带 token / 一次性 nonce）
                  // 二次拉取返回 403/404，HLS 报「无法加载视频清单」。保存后下次播放生效。
                  art.notice.show = "已保存，切到下一集 / 重新打开后生效";
                  return it.html as string;
                },
              },
              {
                html: "重新解析",
                icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5"/></svg>',
                tooltip: "URL 失效时换一个",
                onClick: () => {
                  if (onRequestReresolve) {
                    Promise.resolve(onRequestReresolve()).catch(() => {});
                    return "正在重新解析…";
                  }
                  return "此源不支持重新解析";
                },
              },
              {
                html: "换源 / 测速",
                icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0114-7M21 12a9 9 0 01-14 7M16 6h5V1M8 18H3v5"/></svg>',
                tooltip: "切换线路并测速",
                onClick: () => {
                  if (onRequestSwitchSource) {
                    onRequestSwitchSource();
                    return "已打开";
                  }
                  return "此视频只有 1 条线路";
                },
              },
        ],
      });
      artRef.current = art;

      // ready 后应用保存的倍速 + 起播点
      art.once("ready", () => {
        try {
          if (savedRate !== 1) art.playbackRate = savedRate;
          if (startPosition && startPosition > 0) art.currentTime = startPosition;
        } catch {
          /* duration 还没出来 */
        }
      });

      // 静音 + 音量同步：写回 localStorage 跨视频生效
      art.on("video:volumechange", () => {
        onMutedChange?.(art.muted);
        writeNumberPref(VOLUME_KEY, art.volume);
      });
      // 倍速变化：persist
      art.on("video:ratechange", () => {
        writeNumberPref(RATE_KEY, art.playbackRate);
      });

      // 进度上报（节流 2s，对齐原 VideoPlayer）
      art.on("video:timeupdate", () => {
        const now = Date.now();
        if (now - lastProgressTs.current < 2000) return;
        lastProgressTs.current = now;
        onProgress?.(art.currentTime, art.duration || 0);

        // 自动跳过片头/片尾
        const marks = readSkipMarks(item.id);
        if (marks.intro !== undefined && art.currentTime < marks.intro - 0.5) {
          art.currentTime = marks.intro;
        }
        if (
          marks.outro !== undefined &&
          art.duration > 0 &&
          art.currentTime >= art.duration - marks.outro
        ) {
          onEnded?.();
        }
      });

      // metadata 就绪 → 读视频真实宽高比；用于把容器收成视频实际比例，
      // 让 ArtPlayer 的 .art-bottom 工具栏自然贴在视频画面下沿。
      art.on("video:loadedmetadata", () => {
        const v = art.video as HTMLVideoElement | undefined;
        if (!v || !v.videoWidth || !v.videoHeight) return;
        const ratio = v.videoWidth / v.videoHeight;
        if (Number.isFinite(ratio) && ratio > 0) {
          setVideoAspect(ratio);
        }
      });

      art.on("video:ended", () => {
        onProgress?.(art.duration || 0, art.duration || 0);
        onEnded?.();
      });

      // 注意：以前在容器上 addEventListener("pointerdown", stopPropagation, true)
      // 来防止 framer-motion drag 误抢 click。但 capture 阶段 stopPropagation 会一并
      // 屏蔽 ArtPlayer 内部的 tap / double-tap / long-press 监听 —— 键盘 hotkey 也因
      // 焦点拿不到失效。framer-motion 自带 drag 阈值，单击不跨阈值时 click 仍能合成，
      // 所以这里直接放弃 pointer 拦截。

      return () => {
        try {
          if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
          }
          if (mpegtsRef.current) {
            try {
              mpegtsRef.current.destroy();
            } catch {
              /* ignore */
            }
            mpegtsRef.current = null;
          }
          // Agora WebRTC 清理:走 module-level singleton + leave chain,避免 StrictMode
          // 双 mount 时两次 join 同一 token 撞 UID_CONFLICT。schedule 立即返回,实际 leave
          // 异步排队执行;下次 attachAgora `await agoraLeaveChain` 会等它跑完。
          if (agoraGlobalClient) {
            scheduleAgoraLeave(agoraGlobalClient, agoraGlobalTracks);
            agoraGlobalClient = null;
            agoraGlobalTracks = [];
            agoraContainerRef.current = null;
          }
          art.destroy(false);
        } catch (e) {
          console.warn("[ArtPlayerHost] destroy failed", e);
        }
        artRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item.id]); // 仅在切换到不同 item 时重建；同 item URL 变化走 switch

    // URL 变化 → art.switch 而非重建实例
    useEffect(() => {
      const art = artRef.current;
      if (!art) return;
      if (art.url === wrappedUrl) return;
      const newType = detectArtType(item);
      if (newType) {
        art.option.type = newType;
      }
      art.switch = wrappedUrl;
    }, [wrappedUrl, item.streamType]);

    // 上下集按钮显隐随 prop 变化（切到首集/末集时按钮要消失）
    useEffect(() => {
      if (prevEpElRef.current) {
        prevEpElRef.current.style.display = props.onPrevEpisode ? "" : "none";
      }
      if (nextEpElRef.current) {
        nextEpElRef.current.style.display = props.onNextEpisode ? "" : "none";
      }
    }, [props.onPrevEpisode, props.onNextEpisode]);

    // active 切换 → 播放/暂停
    useEffect(() => {
      const art = artRef.current;
      if (!art) return;
      if (active) {
        art.play().catch(() => {});
      } else {
        art.pause();
      }
    }, [active]);

    // 键盘快捷键 — window 级监听（capture 阶段），不依赖 ArtPlayer 焦点。
    //   - Play 模式（controls=true）：所有键都处理（空格/方向/F/P/M/K）
    //   - Feed 模式（controls=false）：跳过 ↑↓，让 VideoFeed 接管翻页；
    //     其它（←→ seek / Space / F / P / M / K）仍交给当前 active 视频
    // 只有 active 视频响应，避免相邻预加载视频也吃键。
    useEffect(() => {
      if (!hotkeys) return;
      const onKey = (e: KeyboardEvent) => {
        const art = artRef.current;
        if (!art) return;
        if (!active) return;
        const t = e.target as HTMLElement | null;
        if (
          t &&
          (t.tagName === "INPUT" ||
            t.tagName === "TEXTAREA" ||
            t.tagName === "SELECT" ||
            t.isContentEditable)
        ) {
          return;
        }
        const code = e.code;
        const key = e.key;
        const isSpace = key === " " || code === "Space";
        const isLeft = code === "ArrowLeft" || key === "ArrowLeft";
        const isRight = code === "ArrowRight" || key === "ArrowRight";
        const isUp = code === "ArrowUp" || key === "ArrowUp";
        const isDown = code === "ArrowDown" || key === "ArrowDown";

        if ((isUp || isDown) && !controls) return;

        if (isSpace || key === "k" || key === "K") {
          e.preventDefault();
          if (art.playing) art.pause();
          else art.play().catch(() => {});
        } else if (isLeft) {
          e.preventDefault();
          art.currentTime = Math.max(0, art.currentTime - 5);
        } else if (isRight) {
          e.preventDefault();
          art.currentTime = Math.min(art.duration || 0, art.currentTime + 5);
        } else if (isUp) {
          e.preventDefault();
          art.volume = Math.min(1, art.volume + 0.1);
        } else if (isDown) {
          e.preventDefault();
          art.volume = Math.max(0, art.volume - 0.1);
        } else if (key === "m" || key === "M") {
          e.preventDefault();
          art.muted = !art.muted;
        } else if (key === "f" || key === "F") {
          e.preventDefault();
          art.fullscreen = !art.fullscreen;
        } else if (key === "p" || key === "P") {
          e.preventDefault();
          art.pip = !art.pip;
        }
      };
      window.addEventListener("keydown", onKey, true);
      return () => window.removeEventListener("keydown", onKey, true);
    }, [hotkeys, controls, active]);

    // muted 外部受控
    useEffect(() => {
      const art = artRef.current;
      if (!art) return;
      if (mutedProp !== undefined) art.muted = mutedProp;
    }, [mutedProp]);

    // 弹幕数据变化 → 调用插件的 load() 重载
    useEffect(() => {
      const art = artRef.current;
      if (!art) return;
      // ArtPlayer 把插件实例挂在 art.plugins.<pluginName> 上
      const plugin = (
        art.plugins as Record<string, { load?: (d: Danmu[]) => void; show?: () => void; hide?: () => void }>
      ).artplayerPluginDanmuku;
      if (!plugin) return;
      void plugin.load?.(danmuComments ?? []);
    }, [danmuComments]);

    // 弹幕显隐：
    //  - Play 页（controls=true）听父组件传入的 danmakuVisible
    //  - Feed 模式（controls=false）跟随 useDanmakuStore.enabledInFeed 响应式开关
    useEffect(() => {
      const art = artRef.current;
      if (!art) return;
      const plugin = (
        art.plugins as Record<string, { show?: () => void; hide?: () => void }>
      ).artplayerPluginDanmuku;
      if (!plugin) return;
      const visible = controls ? danmakuVisible : enabledInFeed;
      if (visible) plugin.show?.();
      else plugin.hide?.();
    }, [danmakuVisible, enabledInFeed, controls]);

    // Home Feed 弹幕自动加载（Play 模式由 Play.tsx 自己拉，不在这里）。
    //   1) 优先用 InteractionBar 手动选择过的弹幕源（DanmakuPanel memory 按 title）
    //   2) memory 不存在时 fallback 到 matchAnime（按 title 精确匹配）
    //   3) bumpFeedRefresh 后 effect 重跑读最新 memory
    const [feedDanmu, setFeedDanmu] = useState<Danmu[] | null>(null);
    useEffect(() => {
      if (controls) return;
      if (!active) return;
      if (danmuComments && danmuComments.length > 0) return;
      if (!enabledInFeed) return;
      if (!item.title) return;
      let cancelled = false;
      (async () => {
        try {
          const mem = loadDanmakuMemory(item.title);
          if (mem) {
            const comments = await getDanmakuById(mem.episodeId, item.title, 0, {
              animeId: mem.animeId,
              animeTitle: mem.animeTitle,
              episodeTitle: mem.episodeTitle,
            });
            if (cancelled || comments.length === 0) return;
            setFeedDanmu(convertDanmakuFormat(comments));
            return;
          }
          const matchRes = await matchAnime(item.title);
          if (cancelled) return;
          if (!matchRes.isMatched || matchRes.matches.length === 0) return;
          const first = matchRes.matches[0];
          const comments = await getDanmakuById(
            first.episodeId,
            item.title,
            0,
            {
              animeId: first.animeId,
              animeTitle: first.animeTitle,
              episodeTitle: first.episodeTitle,
            }
          );
          if (cancelled || comments.length === 0) return;
          setFeedDanmu(convertDanmakuFormat(comments));
        } catch (e) {
          console.warn("[ArtPlayerHost] feed danmaku load failed", e);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [controls, active, item.title, danmuComments, enabledInFeed, feedRefreshNonce]);

    // 把 Feed 自动匹配到的弹幕推给插件
    useEffect(() => {
      if (!feedDanmu) return;
      const art = artRef.current;
      if (!art) return;
      const plugin = (
        art.plugins as Record<string, { load?: (d: Danmu[]) => void; show?: () => void }>
      ).artplayerPluginDanmuku;
      if (!plugin) return;
      void plugin.load?.(feedDanmu);
      // enabledInFeed 时立即显示；用户随后从设置关掉走上面的 useEffect 隐藏
      if (enabledInFeed) plugin.show?.();
    }, [feedDanmu, enabledInFeed]);

    useImperativeHandle(
      ref,
      () => ({
        play: () => {
          artRef.current?.play().catch(() => {});
        },
        pause: () => artRef.current?.pause(),
        seek: (sec: number) => {
          if (artRef.current) artRef.current.currentTime = sec;
        },
        getElement: () =>
          (artRef.current?.video as HTMLVideoElement | undefined) ?? null,
      }),
      []
    );

    return (
      <div className="relative w-full h-full bg-black flex items-center justify-center overflow-hidden">
        <div
          ref={containerRef}
          // `art-host-feed` 触发 styles.css 里的 hover-to-show 规则，
          // Feed 模式下底栏默认不可见，鼠标进入 .art-bottom 区域才浮现
          className={`art-host ${controls ? "" : "art-host-feed"}`}
          style={
            controls
              ? {
                  // 把播放器尺寸收成视频实际宽高比，让 ArtPlayer 的 .art-bottom
                  // 工具栏自然落在视频画面下沿，而非全屏底部。
                  // width:100% + maxHeight:100% + aspectRatio 让浏览器在两条约束
                  // 间自动取小，保持比例 + fit 容器。
                  width: "100%",
                  maxHeight: "100%",
                  aspectRatio: String(videoAspect),
                }
              : {
                  // Feed (短视频) 模式仍铺满整屏，保持原沉浸感。
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                }
          }
        />
        {error && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 pointer-events-auto z-30"
            style={{ background: "rgba(14,15,17,0.92)" }}
          >
            <p className="font-mono text-[10px] tracking-[0.25em] text-ember mb-3">
              PLAYBACK · ERROR
            </p>
            <p className="text-sm text-cream-dim mb-5 max-w-xs">{error}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  // 强制重挂当前 URL(不重新解析)。按流类型分发,不能一律走 attachHls,
                  // 否则 Agora sentinel URL "agora-rtc://..." 会被 hls.js 当 m3u8 加载 → manifestLoadError。
                  const art = artRef.current;
                  const v = art?.video as HTMLVideoElement | undefined;
                  if (art && v) {
                    if (item.streamType === "agora-rtc") {
                      void attachAgora(v, wrappedUrl);
                    } else if (item.streamType === "flv") {
                      attachFlv(v, wrappedUrl);
                    } else {
                      attachHls(v, wrappedUrl);
                    }
                  }
                }}
                className="px-4 py-2 rounded-full text-xs font-display font-semibold tap text-cream"
                style={{
                  background: "var(--ink-2)",
                  border: "1px solid var(--cream-line)",
                }}
              >
                重试
              </button>
              {onRequestReresolve && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    Promise.resolve(onRequestReresolve()).catch(() => {});
                  }}
                  className="px-4 py-2 rounded-full text-xs font-display font-semibold tap text-cream"
                  style={{
                    background: "var(--ink-2)",
                    border: "1px solid var(--cream-line)",
                  }}
                >
                  重新解析
                </button>
              )}
              {onRequestSwitchSource && (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    onRequestSwitchSource();
                  }}
                  className="px-5 py-2 rounded-full text-xs font-display font-semibold tap glow-ember"
                  style={{ background: "var(--ember)", color: "var(--ink)" }}
                >
                  换源 / 测速
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }
);

export default ArtPlayerHost;
