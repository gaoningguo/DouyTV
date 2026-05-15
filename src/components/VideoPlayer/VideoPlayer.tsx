import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import Hls from "hls.js";
import type { Level } from "hls.js";
import type { MediaItem } from "@/types/media";
import { wrapWithProxy } from "@/lib/proxy";
import { useProxyStore } from "@/stores/proxy";
import {
  IconPlay,
  IconPause,
  IconVolume,
  IconVolumeLow,
  IconVolumeMute,
  IconPiP,
  IconFullscreen,
  IconFullscreenExit,
  IconQuality,
  IconAdBlock,
  IconSubtitle,
  IconCamera,
  IconLock,
  IconLockOpen,
  IconABLoop,
  IconRetry,
  IconRefresh,
  IconMore,
  IconClose,
  IconWave,
} from "@/components/Icon";

export interface VideoPlayerHandle {
  play: () => void;
  pause: () => void;
  seek: (sec: number) => void;
  getElement: () => HTMLVideoElement | null;
}

interface Props {
  item: MediaItem;
  active: boolean;
  preload?: "none" | "metadata" | "auto";
  loop?: boolean;
  muted?: boolean;
  hotkeys?: boolean;
  controls?: boolean;
  startPosition?: number;
  onMutedChange?: (muted: boolean) => void;
  onProgress?: (position: number, duration: number) => void;
  onEnded?: () => void;
  onError?: (err: Error) => void;
  /** 错误页「重新解析」按钮：调用方应重新 callResolvePlayUrl 拿一个新 URL */
  onRequestReresolve?: () => Promise<void> | void;
}

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const DEFAULT_MUTED = !IS_TAURI;
const FILTER_ADS_KEY = "douytv:filter-ads";

function detectStream(item: MediaItem): "hls" | "dash" | "native" {
  if (item.streamType === "hls") return "hls";
  if (item.streamType === "dash") return "dash";
  if (item.streamType === "auto" || !item.streamType) {
    const u = item.url.toLowerCase();
    if (u.includes(".m3u8")) return "hls";
    if (u.includes(".mpd")) return "dash";
  }
  return "native";
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable === true
  );
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** 简单 SRT → WebVTT 转换（保留时间戳格式 + WEBVTT 头部）。 */
function srtToVtt(srt: string): string {
  return (
    "WEBVTT\n\n" +
    srt
      .replace(/\r/g, "")
      .replace(/^\s*\d+\s*\n/gm, "") // 去掉行号
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2") // , → .
  );
}

const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer(
  {
    item,
    active,
    preload = "metadata",
    loop = true,
    muted: mutedProp = DEFAULT_MUTED,
    hotkeys = true,
    controls = false,
    startPosition,
    onMutedChange,
    onProgress,
    onEnded,
    onError,
    onRequestReresolve,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const lastProgressTs = useRef(0);
  const seekedForUrl = useRef<string | null>(null);
  const subtitleUrlRef = useRef<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const originalRateRef = useRef<number>(1);
  const lastTapRef = useRef<{ t: number; x: number } | null>(null);
  const dragSeekRef = useRef<{ startX: number; startTime: number } | null>(null);
  const pinchStartRef = useRef<{ dist: number; scale: number } | null>(null);
  const navigate = useNavigate();

  const [muted, setMuted] = useState(mutedProp);
  const [volume, setVolume] = useState(1);
  const [showVolumeBar, setShowVolumeBar] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showMenu, setShowMenu] = useState<
    "speed" | "quality" | "more" | undefined
  >();
  const [pipActive, setPipActive] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [levels, setLevels] = useState<Level[]>([]);
  const [currentLevel, setCurrentLevel] = useState<number>(-1);
  const [bandwidth, setBandwidth] = useState<number>(0);
  const [vidQuality, setVidQuality] = useState<{ w: number; h: number } | null>(
    null
  );
  const [filterAds, setFilterAds] = useState<boolean>(() => {
    try {
      return localStorage.getItem(FILTER_ADS_KEY) !== "0";
    } catch {
      return true;
    }
  });
  // 代理覆盖：'bypass' 强制直连（即使开启了系统代理），undefined 跟随系统
  const [proxyOverride, setProxyOverride] = useState<"bypass" | undefined>();
  const proxyEnabled = useProxyStore((s) => s.enabled);
  const proxyUrl = useProxyStore((s) => s.url);
  const [error, setError] = useState<{ msg: string; retries: number } | null>(
    null
  );
  const [locked, setLocked] = useState(false);
  const [abLoop, setAbLoop] = useState<{ a?: number; b?: number }>({});
  const [scale, setScale] = useState(1);
  const [hoverTime, setHoverTime] = useState<{ time: number; x: number } | null>(
    null
  );
  const [gestureHint, setGestureHint] = useState<string | undefined>();
  const [showInfo, setShowInfo] = useState(false);
  const skipMarkKey = `douytv:skip-marks:${item.id}`;

  useImperativeHandle(ref, () => ({
    play: () => videoRef.current?.play().catch(() => {}),
    pause: () => videoRef.current?.pause(),
    seek: (sec) => {
      if (videoRef.current) videoRef.current.currentTime = sec;
    },
    getElement: () => videoRef.current,
  }));

  const streamKind = useMemo(
    () => detectStream(item),
    [item.url, item.streamType]
  );

  const playUrl = useMemo(
    () =>
      wrapWithProxy(item, {
        filterAds,
        proxyUrl: proxyEnabled && proxyOverride !== "bypass" ? proxyUrl : undefined,
        bypassSystemProxy: proxyOverride === "bypass",
      }),
    [item.url, item.streamType, item.headers, filterAds, proxyEnabled, proxyUrl, proxyOverride]
  );

  // ─── HLS 装载 ──────────────────────────────────────────
  const attachHls = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setLoading(true);
    setError(null);

    if (streamKind === "hls" && Hls.isSupported()) {
      const isLive = item.kind === "live";
      // 秒播优化：低码率起播 + 预取首片 + 减小重试超时（失败更早暴露）
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: isLive,
        // ABR 第一次估计偏低，让首播选低码率分片（更快开始 → 后续自动升）
        abrEwmaDefaultEstimate: 500_000,
        startLevel: -1,
        startFragPrefetch: true,
        // buffer 控制
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        backBufferLength: 30,
        // 失败更早放弃避免长时间转圈
        manifestLoadingTimeOut: 10_000,
        manifestLoadingMaxRetry: 2,
        levelLoadingTimeOut: 10_000,
        levelLoadingMaxRetry: 2,
        fragLoadingTimeOut: 20_000,
        fragLoadingMaxRetry: 4,
      });
      hlsRef.current = hls;
      hls.loadSource(playUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLevels(hls.levels.slice());
        if (active) video.play().catch(() => {});
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        setCurrentLevel(data.level);
      });
      hls.on(Hls.Events.FRAG_LOADED, () => {
        setBandwidth(hls.bandwidthEstimate || 0);
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          setError((prev) => {
            const retries = (prev?.retries ?? 0) + 1;
            if (retries > 6) return prev; // 超过上限不再触发，避免死循环
            return { msg: `${data.type}: ${data.details}`, retries };
          });
          onError?.(new Error(`HLS ${data.type}: ${data.details}`));
        }
      });
    } else if (
      streamKind === "hls" &&
      video.canPlayType("application/vnd.apple.mpegurl")
    ) {
      video.src = playUrl;
    } else {
      video.src = playUrl;
    }
  }, [playUrl, streamKind, active, item.kind, onError]);

  useEffect(() => {
    let disposed = false;
    attachHls();
    return () => {
      disposed = true;
      void disposed;
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [playUrl, streamKind]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (active) video.play().catch(() => {});
    else video.pause();
  }, [active]);

  useEffect(() => {
    setMuted(mutedProp);
  }, [mutedProp]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.playbackRate = playbackRate;
      video.volume = volume;
    }
  }, [playbackRate, volume]);

  useEffect(() => {
    const onFsChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const enter = () => setPipActive(true);
    const leave = () => setPipActive(false);
    video.addEventListener("enterpictureinpicture", enter);
    video.addEventListener("leavepictureinpicture", leave);
    return () => {
      video.removeEventListener("enterpictureinpicture", enter);
      video.removeEventListener("leavepictureinpicture", leave);
    };
  }, []);

  // 跳过片头：每次切到新视频时，position 到达 introEnd 之前自动跳过
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let intro: number | undefined;
    let outro: number | undefined;
    try {
      const raw = localStorage.getItem(skipMarkKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        intro = typeof parsed.intro === "number" ? parsed.intro : undefined;
        outro = typeof parsed.outro === "number" ? parsed.outro : undefined;
      }
    } catch {}
    if (intro === undefined && outro === undefined) return;
    const onTick = () => {
      if (intro !== undefined && video.currentTime < intro - 0.5) {
        video.currentTime = intro;
        setGestureHint(`已跳过片头 → ${formatTime(intro)}`);
        window.setTimeout(() => setGestureHint(undefined), 1500);
      }
      if (outro !== undefined && video.duration && video.currentTime >= outro) {
        onEnded?.();
      }
    };
    video.addEventListener("timeupdate", onTick);
    return () => video.removeEventListener("timeupdate", onTick);
  }, [skipMarkKey, onEnded]);

  // A-B 循环
  useEffect(() => {
    const video = videoRef.current;
    if (!video || abLoop.a === undefined || abLoop.b === undefined) return;
    const onTick = () => {
      if (video.currentTime >= abLoop.b!) {
        video.currentTime = abLoop.a!;
      }
    };
    video.addEventListener("timeupdate", onTick);
    return () => video.removeEventListener("timeupdate", onTick);
  }, [abLoop]);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setPosition(video.currentTime);
    setDuration(video.duration || 0);
    const tracks = (video as HTMLVideoElement & {
      getVideoPlaybackQuality?: () => { totalVideoFrames: number };
    }).getVideoPlaybackQuality?.();
    if (tracks && (video.videoWidth || video.videoHeight)) {
      setVidQuality({ w: video.videoWidth, h: video.videoHeight });
    }
    const now = Date.now();
    if (now - lastProgressTs.current > 2000) {
      lastProgressTs.current = now;
      onProgress?.(video.currentTime, video.duration || 0);
    }
  }, [onProgress]);

  const flushProgress = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    lastProgressTs.current = Date.now();
    onProgress?.(video.currentTime, video.duration || 0);
  }, [onProgress]);

  // ─── 控制 actions ─────────────────────────────────────
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
    onMutedChange?.(video.muted);
  }, [onMutedChange]);

  const handleVolumeChange = useCallback(
    (v: number) => {
      const next = Math.max(0, Math.min(1, v));
      setVolume(next);
      const video = videoRef.current;
      if (video) {
        video.volume = next;
        if (next === 0 && !video.muted) {
          video.muted = true;
          setMuted(true);
        } else if (next > 0 && video.muted) {
          video.muted = false;
          setMuted(false);
        }
      }
    },
    []
  );

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  }, []);

  const togglePiP = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if ("requestPictureInPicture" in video) {
        await video.requestPictureInPicture();
      }
    } catch (e) {
      console.warn("PiP toggle failed", e);
    }
  }, []);

  const setQuality = useCallback((level: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = level; // -1 = Auto
      setCurrentLevel(level);
    }
  }, []);

  const toggleFilterAds = useCallback(() => {
    setFilterAds((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(FILTER_ADS_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
    // playUrl 会因 filterAds 变化而重新计算，触发 HLS reload
  }, []);

  const retryPlayback = useCallback(() => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    seekedForUrl.current = null;
    attachHls();
  }, [attachHls]);

  // 字幕加载
  const handleSubtitleFile = useCallback(
    async (file: File) => {
      const video = videoRef.current;
      if (!video) return;
      const text = await file.text();
      const vtt = file.name.toLowerCase().endsWith(".vtt")
        ? text
        : srtToVtt(text);
      const blob = new Blob([vtt], { type: "text/vtt" });
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      subtitleUrlRef.current = url;
      // 移除老的 track
      Array.from(video.querySelectorAll("track")).forEach((t) => t.remove());
      const track = document.createElement("track");
      track.kind = "subtitles";
      track.label = file.name;
      track.srclang = "und";
      track.src = url;
      track.default = true;
      video.appendChild(track);
      setGestureHint(`字幕已加载：${file.name}`);
      window.setTimeout(() => setGestureHint(undefined), 1500);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  // 截图
  const takeScreenshot = useCallback(() => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    try {
      ctx.drawImage(video, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${item.title || "screenshot"}-${Math.floor(video.currentTime)}s.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }, "image/png");
      setGestureHint("截图已保存");
      window.setTimeout(() => setGestureHint(undefined), 1500);
    } catch (e) {
      setGestureHint("截图失败（视频可能跨域）");
      window.setTimeout(() => setGestureHint(undefined), 1500);
    }
  }, [item.title]);

  // 跳过片头/片尾标记
  const markIntroEnd = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const at = video.currentTime;
    try {
      const raw = localStorage.getItem(skipMarkKey);
      const parsed = raw ? JSON.parse(raw) : {};
      parsed.intro = at;
      localStorage.setItem(skipMarkKey, JSON.stringify(parsed));
    } catch {}
    setGestureHint(`已标记片头结束 @ ${formatTime(at)}`);
    window.setTimeout(() => setGestureHint(undefined), 1800);
  }, [skipMarkKey]);

  const markOutroStart = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const at = video.currentTime;
    try {
      const raw = localStorage.getItem(skipMarkKey);
      const parsed = raw ? JSON.parse(raw) : {};
      parsed.outro = at;
      localStorage.setItem(skipMarkKey, JSON.stringify(parsed));
    } catch {}
    setGestureHint(`已标记片尾起始 @ ${formatTime(at)}`);
    window.setTimeout(() => setGestureHint(undefined), 1800);
  }, [skipMarkKey]);

  const clearSkipMarks = useCallback(() => {
    try {
      localStorage.removeItem(skipMarkKey);
    } catch {}
    setGestureHint("已清除片头/片尾标记");
    window.setTimeout(() => setGestureHint(undefined), 1500);
  }, [skipMarkKey]);

  // A-B 循环：双击进度条标记
  const toggleABLoop = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (abLoop.a === undefined) {
      setAbLoop({ a: video.currentTime });
      setGestureHint(`A 点 = ${formatTime(video.currentTime)}`);
    } else if (abLoop.b === undefined) {
      if (video.currentTime > abLoop.a) {
        setAbLoop({ a: abLoop.a, b: video.currentTime });
        setGestureHint(
          `A-B 循环开启 ${formatTime(abLoop.a)} ↔ ${formatTime(video.currentTime)}`
        );
      } else {
        setAbLoop({ a: video.currentTime });
        setGestureHint(`A 点 = ${formatTime(video.currentTime)}`);
      }
    } else {
      setAbLoop({});
      setGestureHint("已取消 A-B 循环");
    }
    window.setTimeout(() => setGestureHint(undefined), 1500);
  }, [abLoop]);

  // ─── seek bar ─────────────────────────────────────────
  const handleSeek = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (locked) return;
      const video = videoRef.current;
      if (!video || !duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width)
      );
      video.currentTime = ratio * duration;
    },
    [duration, locked]
  );

  const handleSeekHover = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width)
      );
      setHoverTime({ time: ratio * duration, x: e.clientX - rect.left });
    },
    [duration]
  );

  // ─── 手势（移动端） ────────────────────────────────────
  // 在 isDesktop 时跳过 — 用 matchMedia 检测
  const isMobile = useMemo(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 767px)").matches;
  }, []);

  const handleVideoPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (locked) return;
      if (!isMobile) return;
      // 长按 → 2x
      if (longPressTimerRef.current) {
        window.clearTimeout(longPressTimerRef.current);
      }
      const video = videoRef.current;
      if (video) originalRateRef.current = video.playbackRate;
      longPressTimerRef.current = window.setTimeout(() => {
        if (video) {
          video.playbackRate = 2;
          setPlaybackRate(2);
        }
        setGestureHint("2× 倍速 ▸");
      }, 450);
      dragSeekRef.current = {
        startX: e.clientX,
        startTime: video?.currentTime ?? 0,
      };
    },
    [isMobile, locked]
  );

  const handleVideoPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (locked || !isMobile) return;
      if (!dragSeekRef.current) return;
      const dx = e.clientX - dragSeekRef.current.startX;
      if (Math.abs(dx) < 12) return; // dead zone
      // 进入拖动 seek 模式 — 取消长按
      if (longPressTimerRef.current) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      const video = videoRef.current;
      if (!video) return;
      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
      // 拖动 1 个屏幕宽度 = 全片长度
      const ratio = dx / rect.width;
      const target = Math.max(
        0,
        Math.min(video.duration || 0, dragSeekRef.current.startTime + ratio * (video.duration || 0))
      );
      setGestureHint(
        `${formatTime(target)} / ${formatTime(video.duration || 0)}`
      );
      setHoverTime({ time: target, x: 0 });
    },
    [isMobile, locked]
  );

  const handleVideoPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (locked || !isMobile) return;
      // 清长按
      if (longPressTimerRef.current) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      const video = videoRef.current;
      if (!video) return;
      // 如果倍速被改为 2x，恢复
      if (video.playbackRate !== originalRateRef.current) {
        video.playbackRate = originalRateRef.current;
        setPlaybackRate(originalRateRef.current);
        setGestureHint(undefined);
      }
      // 应用拖动 seek
      if (dragSeekRef.current) {
        const dx = e.clientX - dragSeekRef.current.startX;
        if (Math.abs(dx) >= 12) {
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
          const ratio = dx / rect.width;
          const target = Math.max(
            0,
            Math.min(
              video.duration || 0,
              dragSeekRef.current.startTime + ratio * (video.duration || 0)
            )
          );
          video.currentTime = target;
        } else {
          // 短按 = tap，检查双击
          const now = Date.now();
          const last = lastTapRef.current;
          if (last && now - last.t < 320 && Math.abs(last.x - e.clientX) < 28) {
            // 双击
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            const x = e.clientX - rect.left;
            if (x < rect.width * 0.33) {
              // 左 1/3 = 后退 10s
              video.currentTime = Math.max(0, video.currentTime - 10);
              setGestureHint("⟲ -10s");
            } else if (x > rect.width * 0.67) {
              // 右 1/3 = 前进 10s
              video.currentTime = Math.min(
                video.duration || Infinity,
                video.currentTime + 10
              );
              setGestureHint("+10s ⟳");
            } else {
              // 中央 = 暂停/播放
              togglePlay();
            }
            window.setTimeout(() => setGestureHint(undefined), 700);
            lastTapRef.current = null;
          } else {
            lastTapRef.current = { t: now, x: e.clientX };
          }
        }
      }
      dragSeekRef.current = null;
      window.setTimeout(() => setHoverTime(null), 500);
    },
    [isMobile, locked, togglePlay]
  );

  // 双指捏合缩放
  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        pinchStartRef.current = { dist, scale };
      }
    },
    [scale]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (e.touches.length === 2 && pinchStartRef.current) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const ratio = dist / pinchStartRef.current.dist;
        const next = Math.max(0.8, Math.min(2.0, pinchStartRef.current.scale * ratio));
        setScale(next);
      }
    },
    []
  );

  const handleTouchEnd = useCallback(() => {
    pinchStartRef.current = null;
  }, []);

  // ─── 键盘快捷键 ────────────────────────────────────────
  useEffect(() => {
    if (!hotkeys) return;
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const video = videoRef.current;
      if (!video) return;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          video.currentTime = Math.max(0, video.currentTime - 5);
          break;
        case "ArrowRight":
          e.preventDefault();
          video.currentTime = Math.min(
            video.duration || Infinity,
            video.currentTime + 5
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          handleVolumeChange(volume + 0.1);
          break;
        case "ArrowDown":
          e.preventDefault();
          handleVolumeChange(volume - 0.1);
          break;
        case "m":
        case "M":
          toggleMute();
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
        case "p":
        case "P":
          void togglePiP();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkeys, togglePlay, toggleMute, toggleFullscreen, togglePiP, handleVolumeChange, volume]);

  // ─── 渲染 ─────────────────────────────────────────────
  const subtitleInputRef = useRef<HTMLInputElement>(null);
  const volumeIcon =
    muted || volume === 0
      ? IconVolumeMute
      : volume < 0.5
      ? IconVolumeLow
      : IconVolume;
  const VolIcon = volumeIcon;

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full bg-black overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <video
        ref={videoRef}
        className="h-full w-full object-contain transition-transform duration-150"
        style={{ transform: scale !== 1 ? `scale(${scale})` : undefined }}
        loop={loop}
        muted={muted}
        playsInline
        preload={preload}
        poster={item.poster}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          flushProgress();
        }}
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => {
          flushProgress();
          onEnded?.();
        }}
        onWaiting={() => setLoading(true)}
        onCanPlay={() => setLoading(false)}
        onLoadedMetadata={() => {
          setLoading(false);
          if (
            startPosition !== undefined &&
            startPosition > 1 &&
            videoRef.current &&
            seekedForUrl.current !== playUrl
          ) {
            try {
              videoRef.current.currentTime = startPosition;
            } catch {}
            seekedForUrl.current = playUrl;
          }
        }}
        onError={(e) => {
          const msg = e.currentTarget.error?.message ?? "unknown";
          setError((prev) => {
            const retries = (prev?.retries ?? 0) + 1;
            if (retries > 6) return prev;
            return { msg, retries };
          });
          onError?.(new Error("video error: " + msg));
        }}
      />

      {/* 手势捕获层（移动端） + 桌面点击切播放/暂停 */}
      <div
        className="absolute inset-0 z-[2]"
        onPointerDown={handleVideoPointerDown}
        onPointerMove={handleVideoPointerMove}
        onPointerUp={handleVideoPointerUp}
        onClick={() => {
          if (locked) return;
          if (!isMobile) togglePlay();
        }}
      />

      {/* 锁屏覆盖层 */}
      {locked && (
        <div className="absolute inset-0 z-30 flex items-center justify-center">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              // 双击解锁
              const now = Date.now();
              const last = lastTapRef.current;
              if (last && now - last.t < 360) {
                setLocked(false);
                lastTapRef.current = null;
                setGestureHint("已解锁");
                window.setTimeout(() => setGestureHint(undefined), 1000);
              } else {
                lastTapRef.current = { t: now, x: 0 };
                setGestureHint("再次点击解锁");
                window.setTimeout(() => setGestureHint(undefined), 1500);
              }
            }}
            className="w-14 h-14 rounded-full backdrop-blur-md flex items-center justify-center text-cream tap"
            style={{
              background: "rgba(14,15,17,0.72)",
              border: "1px solid var(--cream-line)",
            }}
          >
            <IconLock size={22} />
          </button>
        </div>
      )}

      {loading && !locked && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <span className="signal-bars" style={{ height: 28 }}>
            <span />
            <span />
            <span />
          </span>
        </div>
      )}

      {!playing && !loading && !locked && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
          aria-hidden
        >
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center backdrop-blur-sm"
            style={{ background: "rgba(14,15,17,0.5)" }}
          >
            <IconPlay size={28} className="text-cream" />
          </div>
        </div>
      )}

      {/* 错误状态 */}
      {error && error.retries < 6 && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-ink/85 backdrop-blur-sm">
          <p className="font-mono text-[10px] tracking-[0.25em] text-ember">
            NO SIGNAL
          </p>
          <p className="text-xs text-cream-dim text-center max-w-xs px-4">{error.msg}</p>
          <div className="flex flex-wrap gap-2 justify-center px-4">
            <button
              type="button"
              onClick={retryPlayback}
              className="px-4 py-2 rounded-full text-xs font-display font-semibold tap glow-ember flex items-center gap-1.5"
              style={{ background: "var(--ember)", color: "var(--ink)" }}
            >
              <IconRetry size={13} />
              重试 ({error.retries})
            </button>
            {onRequestReresolve && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await onRequestReresolve();
                    setError(null);
                  } catch (e) {
                    setError({ msg: `重新解析失败: ${(e as Error).message}`, retries: (error?.retries ?? 0) + 1 });
                  }
                }}
                className="px-4 py-2 rounded-full text-xs font-display tap flex items-center gap-1.5 text-cream"
                style={{
                  background: "var(--ink-2)",
                  border: "1px solid var(--cream-line)",
                }}
                title="重新向源端解析播放地址"
              >
                <IconRefresh size={13} />
                换源
              </button>
            )}
            {proxyUrl ? (
              <button
                type="button"
                onClick={() => {
                  setProxyOverride((prev) => (prev === "bypass" ? undefined : "bypass"));
                  // playUrl 变 → useEffect 自动 re-attach
                  setError(null);
                }}
                className="px-4 py-2 rounded-full text-xs font-display tap flex items-center gap-1.5 text-cream"
                style={{
                  background: "var(--ink-2)",
                  border: "1px solid var(--cream-line)",
                }}
                title={
                  proxyOverride === "bypass" || !proxyEnabled
                    ? "当前直连，点击改走代理"
                    : "当前走代理，点击切换直连"
                }
              >
                <IconWave size={13} />
                {proxyOverride === "bypass" || !proxyEnabled ? "尝试代理" : "切换直连"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navigate("/settings/proxy")}
                className="px-4 py-2 rounded-full text-xs font-display tap flex items-center gap-1.5 text-cream"
                style={{
                  background: "var(--ink-2)",
                  border: "1px solid var(--cream-line)",
                }}
                title="代理设置"
              >
                <IconWave size={13} />
                配置代理
              </button>
            )}
          </div>
          {(proxyOverride === "bypass" || (proxyEnabled && proxyUrl)) && (
            <p className="text-[10px] font-mono text-cream-faint">
              {proxyOverride === "bypass"
                ? "PROXY · BYPASSED"
                : proxyEnabled
                ? "PROXY · ACTIVE"
                : ""}
            </p>
          )}
        </div>
      )}

      {/* 手势提示 toast */}
      {gestureHint && (
        <div
          className="absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 px-4 py-2 backdrop-blur-md pointer-events-none animate-fade-in font-mono text-xs tracking-wider rounded-lg"
          style={{
            background: "rgba(14, 15, 17, 0.86)",
            border: "1px solid var(--cream-line)",
            color: "var(--cream)",
          }}
        >
          {gestureHint}
        </div>
      )}

      {/* mute 提示（仅 muted 且未交互过） */}
      {muted && !locked && (
        <button
          type="button"
          className="absolute top-4 right-4 z-20 px-3 py-1.5 rounded-full text-xs backdrop-blur-sm tap text-cream flex items-center gap-1.5"
          style={{
            background: "rgba(14,15,17,0.55)",
            border: "1px solid var(--cream-line)",
          }}
          onPointerDownCapture={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            toggleMute();
          }}
        >
          <IconVolumeMute size={13} />
          点击开声音
        </button>
      )}

      {/* 控制条 */}
      {controls && !locked && (
        <div
          className="absolute bottom-3 left-3 right-3 z-20"
          onClick={(e) => e.stopPropagation()}
          onPointerDownCapture={(e) => e.stopPropagation()}
        >
          {/* 进度条 */}
          <div
            className="relative h-1.5 mb-2 cursor-pointer group"
            onPointerDown={handleSeek}
            onPointerMove={handleSeekHover}
            onPointerLeave={() => setHoverTime(null)}
            onDoubleClick={toggleABLoop}
          >
            <div
              className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full"
              style={{ background: "rgba(242,232,213,0.16)" }}
            />
            <div
              className="absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full"
              style={{
                width: `${duration ? (position / duration) * 100 : 0}%`,
                background: "var(--ember)",
                boxShadow: "0 0 8px var(--ember-glow)",
              }}
            />
            {abLoop.a !== undefined && duration > 0 && (
              <div
                className="absolute top-1/2 -translate-y-1/2 w-0.5 h-3"
                style={{
                  left: `${(abLoop.a / duration) * 100}%`,
                  background: "var(--phosphor)",
                }}
              />
            )}
            {abLoop.b !== undefined && duration > 0 && (
              <div
                className="absolute top-1/2 -translate-y-1/2 w-0.5 h-3"
                style={{
                  left: `${(abLoop.b / duration) * 100}%`,
                  background: "var(--phosphor)",
                }}
              />
            )}
            {hoverTime && (
              <div
                className="absolute -top-7 px-2 py-0.5 rounded text-[10px] font-mono pointer-events-none -translate-x-1/2"
                style={{
                  left: hoverTime.x,
                  background: "var(--ink)",
                  border: "1px solid var(--cream-line)",
                  color: "var(--cream)",
                }}
              >
                {formatTime(hoverTime.time)}
              </div>
            )}
          </div>

          {/* 主控制行 */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={togglePlay}
              className="w-9 h-9 rounded-full flex items-center justify-center tap text-cream"
              style={{
                background: "rgba(14,15,17,0.6)",
                border: "1px solid var(--cream-line)",
              }}
            >
              {playing ? <IconPause size={16} /> : <IconPlay size={16} />}
            </button>

            <div className="font-mono text-[11px] text-cream text-shadow whitespace-nowrap">
              {formatTime(position)} / {formatTime(duration)}
            </div>

            {/* 音量 */}
            <div
              className="relative ml-auto"
              onMouseEnter={() => setShowVolumeBar(true)}
              onMouseLeave={() => setShowVolumeBar(false)}
            >
              <button
                type="button"
                onClick={() => {
                  if (isMobile) setShowVolumeBar((x) => !x);
                  else toggleMute();
                }}
                className="w-8 h-8 rounded-full flex items-center justify-center tap text-cream"
                style={{ background: "rgba(14,15,17,0.6)", border: "1px solid var(--cream-line)" }}
                title="音量 (M)"
              >
                <VolIcon size={15} />
              </button>
              {showVolumeBar && (
                <div
                  className="absolute bottom-10 left-1/2 -translate-x-1/2 p-3 rounded-lg flex items-center justify-center"
                  style={{
                    background: "rgba(14,15,17,0.95)",
                    border: "1px solid var(--cream-line)",
                    height: 100,
                  }}
                >
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.02}
                    value={muted ? 0 : volume}
                    onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                    className="w-2 h-20 accent-[var(--ember)]"
                    style={{ writingMode: "vertical-lr" as const, direction: "rtl" }}
                  />
                </div>
              )}
            </div>

            {/* 字幕 */}
            <button
              type="button"
              onClick={() => subtitleInputRef.current?.click()}
              className="w-8 h-8 rounded-full flex items-center justify-center tap text-cream"
              style={{ background: "rgba(14,15,17,0.6)", border: "1px solid var(--cream-line)" }}
              title="加载字幕"
            >
              <IconSubtitle size={14} />
            </button>
            <input
              ref={subtitleInputRef}
              type="file"
              accept=".srt,.vtt,text/vtt"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleSubtitleFile(f);
                e.target.value = "";
              }}
              className="hidden"
            />

            {/* 截图 */}
            <button
              type="button"
              onClick={takeScreenshot}
              className="hidden md:flex w-8 h-8 rounded-full items-center justify-center tap text-cream"
              style={{ background: "rgba(14,15,17,0.6)", border: "1px solid var(--cream-line)" }}
              title="截图"
            >
              <IconCamera size={14} />
            </button>

            {/* 锁屏（移动） */}
            <button
              type="button"
              onClick={() => setLocked(true)}
              className="md:hidden w-8 h-8 rounded-full flex items-center justify-center tap text-cream"
              style={{ background: "rgba(14,15,17,0.6)", border: "1px solid var(--cream-line)" }}
              title="锁屏"
            >
              <IconLockOpen size={14} />
            </button>

            {/* 速度 */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowMenu((m) => (m === "speed" ? undefined : "speed"))}
                className="px-2.5 h-8 rounded-full flex items-center text-cream font-mono text-[11px] tap"
                style={{
                  background: showMenu === "speed" ? "var(--ember)" : "rgba(14,15,17,0.6)",
                  color: showMenu === "speed" ? "var(--ink)" : "var(--cream)",
                  border: "1px solid var(--cream-line)",
                }}
              >
                {playbackRate}×
              </button>
              {showMenu === "speed" && (
                <div
                  className="absolute bottom-9 right-0 rounded-lg overflow-hidden backdrop-blur-md"
                  style={{
                    background: "rgba(14,15,17,0.96)",
                    border: "1px solid var(--cream-line)",
                  }}
                >
                  {PLAYBACK_RATES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => {
                        setPlaybackRate(r);
                        setShowMenu(undefined);
                      }}
                      className="block w-full px-4 py-1.5 text-xs text-left whitespace-nowrap font-mono tap"
                      style={{
                        color: r === playbackRate ? "var(--ember)" : "var(--cream)",
                        background: r === playbackRate ? "var(--ember-soft)" : "transparent",
                      }}
                    >
                      {r}×
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 分辨率 — 仅多码率时显示 */}
            {levels.length > 1 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowMenu((m) => (m === "quality" ? undefined : "quality"))}
                  className="w-8 h-8 rounded-full flex items-center justify-center tap text-cream"
                  style={{
                    background: showMenu === "quality" ? "var(--ember)" : "rgba(14,15,17,0.6)",
                    color: showMenu === "quality" ? "var(--ink)" : "var(--cream)",
                    border: "1px solid var(--cream-line)",
                  }}
                  title="分辨率"
                >
                  <IconQuality size={13} />
                </button>
                {showMenu === "quality" && (
                  <div
                    className="absolute bottom-9 right-0 rounded-lg overflow-hidden backdrop-blur-md min-w-[100px]"
                    style={{
                      background: "rgba(14,15,17,0.96)",
                      border: "1px solid var(--cream-line)",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setQuality(-1);
                        setShowMenu(undefined);
                      }}
                      className="block w-full px-3 py-1.5 text-xs text-left whitespace-nowrap font-mono tap"
                      style={{
                        color: currentLevel === -1 ? "var(--ember)" : "var(--cream)",
                        background: currentLevel === -1 ? "var(--ember-soft)" : "transparent",
                      }}
                    >
                      Auto
                    </button>
                    {levels.map((lv, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setQuality(idx);
                          setShowMenu(undefined);
                        }}
                        className="block w-full px-3 py-1.5 text-xs text-left whitespace-nowrap font-mono tap"
                        style={{
                          color: currentLevel === idx ? "var(--ember)" : "var(--cream)",
                          background: currentLevel === idx ? "var(--ember-soft)" : "transparent",
                        }}
                      >
                        {lv.height}p
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 去广告 */}
            <button
              type="button"
              onClick={toggleFilterAds}
              className="w-8 h-8 rounded-full flex items-center justify-center tap"
              style={{
                background: filterAds ? "var(--phosphor-soft)" : "rgba(14,15,17,0.6)",
                color: filterAds ? "var(--phosphor)" : "var(--cream)",
                border: `1px solid ${filterAds ? "rgba(124,255,178,0.4)" : "var(--cream-line)"}`,
              }}
              title={filterAds ? "去广告：开启" : "去广告：关闭"}
            >
              <IconAdBlock size={13} />
            </button>

            {/* 更多 */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowMenu((m) => (m === "more" ? undefined : "more"))}
                className="w-8 h-8 rounded-full flex items-center justify-center tap text-cream"
                style={{
                  background: showMenu === "more" ? "var(--ember)" : "rgba(14,15,17,0.6)",
                  color: showMenu === "more" ? "var(--ink)" : "var(--cream)",
                  border: "1px solid var(--cream-line)",
                }}
                title="更多"
              >
                <IconMore size={14} />
              </button>
              {showMenu === "more" && (
                <div
                  className="absolute bottom-9 right-0 rounded-lg overflow-hidden backdrop-blur-md min-w-[180px]"
                  style={{
                    background: "rgba(14,15,17,0.96)",
                    border: "1px solid var(--cream-line)",
                  }}
                >
                  <MoreItem onClick={() => { takeScreenshot(); setShowMenu(undefined); }} Icon={IconCamera} label="截图" />
                  <MoreItem onClick={() => { markIntroEnd(); setShowMenu(undefined); }} Icon={IconABLoop} label="标记片头结束" />
                  <MoreItem onClick={() => { markOutroStart(); setShowMenu(undefined); }} Icon={IconABLoop} label="标记片尾起始" />
                  <MoreItem onClick={() => { clearSkipMarks(); setShowMenu(undefined); }} Icon={IconClose} label="清除片头/片尾标记" />
                  <MoreItem onClick={() => { toggleABLoop(); setShowMenu(undefined); }} Icon={IconABLoop} label={abLoop.a === undefined ? "标记 A 点（A-B 循环）" : abLoop.b === undefined ? "标记 B 点（A-B 循环）" : "取消 A-B 循环"} />
                  <MoreItem onClick={() => { setLocked(true); setShowMenu(undefined); }} Icon={IconLock} label="锁屏" />
                  <MoreItem onClick={() => { setShowInfo((x) => !x); setShowMenu(undefined); }} Icon={IconQuality} label={showInfo ? "隐藏码率信息" : "显示码率信息"} />
                </div>
              )}
            </div>

            {/* PiP */}
            {"requestPictureInPicture" in HTMLVideoElement.prototype && (
              <button
                type="button"
                onClick={togglePiP}
                className="w-8 h-8 rounded-full flex items-center justify-center tap"
                style={{
                  background: pipActive ? "var(--ember)" : "rgba(14,15,17,0.6)",
                  color: pipActive ? "var(--ink)" : "var(--cream)",
                  border: "1px solid var(--cream-line)",
                }}
                title="画中画 (P)"
              >
                <IconPiP size={14} />
              </button>
            )}

            {/* 全屏 */}
            <button
              type="button"
              onClick={toggleFullscreen}
              className="w-8 h-8 rounded-full flex items-center justify-center tap text-cream"
              style={{
                background: fullscreen ? "var(--ember)" : "rgba(14,15,17,0.6)",
                color: fullscreen ? "var(--ink)" : "var(--cream)",
                border: "1px solid var(--cream-line)",
              }}
              title="全屏 (F)"
            >
              {fullscreen ? <IconFullscreenExit size={14} /> : <IconFullscreen size={14} />}
            </button>
          </div>

          {/* 码率信息（可选） */}
          {showInfo && (
            <div className="mt-2 font-mono text-[10px] text-cream-dim tracking-wider flex flex-wrap gap-3">
              {vidQuality && (
                <span>
                  {vidQuality.w}×{vidQuality.h}
                </span>
              )}
              {bandwidth > 0 && (
                <span>{(bandwidth / 1_000_000).toFixed(2)} Mbps</span>
              )}
              {currentLevel >= 0 && levels[currentLevel] && (
                <span>L{currentLevel}: {levels[currentLevel].height}p</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

function MoreItem({
  Icon,
  label,
  onClick,
}: {
  Icon: (p: { size?: number }) => JSX.Element;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left text-cream tap hover:bg-ink-3"
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

export default VideoPlayer;
