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
import type { MediaItem } from "@/types/media";
import { wrapWithProxy } from "@/lib/proxy";
import { useProxyStore } from "@/stores/proxy";
import { useDanmakuStore } from "@/stores/danmaku";
import { convertDanmakuFormat, getDanmakuById, matchAnime } from "@/lib/danmaku/api";

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
  /** 弹幕数据。空数组时弹幕层仍挂载但无内容。 */
  danmuComments?: Danmu[];
  /** 弹幕是否显示。控件 toggle 和外部传值都会改这个。 */
  danmakuVisible?: boolean;
}

const FILTER_ADS_KEY = "douytv:filter-ads";
const BUFFER_KEY = "douytv:buffer-strategy";
type BufferStrategy = "low" | "medium" | "high" | "ultra";

function getBufferConfig(strategy: BufferStrategy) {
  switch (strategy) {
    case "low":
      return { maxBufferLength: 20, backBufferLength: 15, maxBufferSize: 40 * 1024 * 1024 };
    case "high":
      return { maxBufferLength: 90, backBufferLength: 60, maxBufferSize: 180 * 1024 * 1024 };
    case "ultra":
      return { maxBufferLength: 180, backBufferLength: 90, maxBufferSize: 360 * 1024 * 1024 };
    default:
      // medium — 比 hls.js 默认更大一档，长片体验更顺，秒播开销可忽略
      return { maxBufferLength: 60, backBufferLength: 30, maxBufferSize: 100 * 1024 * 1024 };
  }
}

function detectArtType(item: MediaItem): string | undefined {
  if (item.streamType === "hls") return "m3u8";
  if (item.streamType === "flv") return "flv";
  if (item.streamType === "dash") return "mpd";
  if (item.streamType === "mp4") return undefined; // 原生
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
    } = props;

    const containerRef = useRef<HTMLDivElement>(null);
    const artRef = useRef<Artplayer | null>(null);
    const hlsRef = useRef<Hls | null>(null);
    const lastProgressTs = useRef(0);
    const proxyEnabled = useProxyStore((s) => s.enabled);
    const proxyUrl = useProxyStore((s) => s.url);
    // 用户在弹幕设置里勾的"首页 Feed 显示弹幕"。响应式读取，
    // 用户在设置页改了之后，Home 的播放器立即跟随显隐。
    const enabledInFeed = useDanmakuStore((s) => s.enabledInFeed);

    const [filterAds, setFilterAds] = useState<boolean>(readFilterAds);
    const [error, setError] = useState<string | null>(null);

    const wrappedUrl = useMemo(
      () =>
        wrapWithProxy(item, {
          filterAds,
          proxyUrl: proxyEnabled ? proxyUrl : undefined,
        }),
      [item.url, item.streamType, item.headers, filterAds, proxyEnabled, proxyUrl]
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

    // 实例化 ArtPlayer（仅在挂载时一次）
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      const initialType = detectArtType(item);
      const skipMarks = readSkipMarks(item.id);

      const art = new Artplayer({
        container: el,
        url: wrappedUrl,
        ...(initialType ? { type: initialType } : {}),
        ...(item.poster ? { poster: item.poster } : {}),
        volume: 0.7,
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
        } as Partial<HTMLVideoElement>,
        customType: {
          m3u8: (video: HTMLVideoElement, url: string) => attachHls(video, url),
        },
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
                  // 立即生效：重新 attach HLS
                  if (art.video) {
                    attachHls(art.video as HTMLVideoElement, art.url);
                  }
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

      // 加载完成后跳到起播点
      if (startPosition && startPosition > 0) {
        art.once("ready", () => {
          try {
            art.currentTime = startPosition;
          } catch {
            /* duration 还没出来 */
          }
        });
      }

      // 静音状态同步给父组件（Home Feed 的全局静音状态）
      art.on("video:volumechange", () => {
        onMutedChange?.(art.muted);
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

    // 键盘快捷键 — window 级监听，不依赖 ArtPlayer 焦点。
    // 仅 Play 模式启用（hotkeys=true && controls=true）。Feed 模式由 VideoFeed
    // 自己接管 ↑↓/J/K，避免重复处理。
    useEffect(() => {
      if (!hotkeys || !controls) return;
      const onKey = (e: KeyboardEvent) => {
        const art = artRef.current;
        if (!art) return;
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
        switch (e.key) {
          case " ":
          case "k":
          case "K":
            e.preventDefault();
            if (art.playing) art.pause();
            else art.play().catch(() => {});
            break;
          case "ArrowLeft":
            e.preventDefault();
            art.currentTime = Math.max(0, art.currentTime - 5);
            break;
          case "ArrowRight":
            e.preventDefault();
            art.currentTime = Math.min(art.duration || 0, art.currentTime + 5);
            break;
          case "ArrowUp":
            e.preventDefault();
            art.volume = Math.min(1, art.volume + 0.1);
            break;
          case "ArrowDown":
            e.preventDefault();
            art.volume = Math.max(0, art.volume - 0.1);
            break;
          case "m":
          case "M":
            e.preventDefault();
            art.muted = !art.muted;
            break;
          case "f":
          case "F":
            e.preventDefault();
            art.fullscreen = !art.fullscreen;
            break;
          case "p":
          case "P":
            e.preventDefault();
            art.pip = !art.pip;
            break;
        }
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [hotkeys, controls]);

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

    // Home Feed 自动匹配（仅 Feed 模式生效；Play 模式由 Play.tsx 自己拉 danmaku）：
    // active + 没有 props 传入的 danmuComments + 用户开启 enabledInFeed →
    // 按 title 触发 matchAnime → getDanmakuById。
    const [feedDanmu, setFeedDanmu] = useState<Danmu[] | null>(null);
    useEffect(() => {
      if (controls) return; // Play 页走 props 传入，不在这里自动匹配
      if (!active) return;
      if (danmuComments && danmuComments.length > 0) return;
      if (!enabledInFeed) return;
      if (!item.title) return;
      let cancelled = false;
      (async () => {
        try {
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
          console.warn("[ArtPlayerHost] feed danmaku auto-match failed", e);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [controls, active, item.title, danmuComments, enabledInFeed]);

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
      <div className="relative w-full h-full bg-black">
        <div
          ref={containerRef}
          // `art-host-feed` 触发 styles.css 里的 hover-to-show 规则，
          // Feed 模式下底栏默认不可见，鼠标进入 .art-bottom 区域才浮现
          className={`absolute inset-0 art-host ${controls ? "" : "art-host-feed"}`}
          style={{ width: "100%", height: "100%" }}
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
                  // 强制重挂当前 URL（不重新解析）
                  const art = artRef.current;
                  const v = art?.video as HTMLVideoElement | undefined;
                  if (art && v) {
                    attachHls(v, wrappedUrl);
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
                  className="px-5 py-2 rounded-full text-xs font-display font-semibold tap glow-ember"
                  style={{ background: "var(--ember)", color: "var(--ink)" }}
                >
                  换源 / 重新解析
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
