import type { SVGProps } from "react";

/**
 * 自绘 SVG 图标库 — 替代所有 emoji，确保跨平台一致
 *
 * 视觉系统：
 * - 24×24 viewBox，stroke=1.6，linecap/linejoin=round
 * - 用 currentColor 做色，外层调 className=text-...
 * - 整套带轻微"老电视"线性气质（圆头线、几何）
 */

type Props = SVGProps<SVGSVGElement> & { size?: number };

const base = (p: Props) => ({
  width: p.size ?? 22,
  height: p.size ?? 22,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...p,
});

// ─── 导航 ────────────────────────────────────────────────
export const IconHome = (p: Props) => (
  <svg {...base(p)}>
    {/* 老电视外形 + 顶部天线 */}
    <path d="M8 4l4 3 4-3" />
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <circle cx="17.5" cy="17" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

export const IconSearch = (p: Props) => (
  <svg {...base(p)}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M20 20l-4.5-4.5" />
  </svg>
);

export const IconLive = (p: Props) => (
  <svg {...base(p)}>
    {/* 信号波 + 中心圆 */}
    <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    <path d="M8.5 8.5a5 5 0 000 7" />
    <path d="M15.5 15.5a5 5 0 000-7" />
    <path d="M5.5 5.5a9 9 0 000 13" />
    <path d="M18.5 18.5a9 9 0 000-13" />
  </svg>
);

export const IconLocal = (p: Props) => (
  <svg {...base(p)}>
    {/* 文件夹但带电视感 */}
    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    <path d="M7 12h10" />
  </svg>
);

export const IconLibrary = (p: Props) => (
  <svg {...base(p)}>
    {/* 心形 outline */}
    <path d="M12 20s-7-4.5-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.5-7 10-7 10z" />
  </svg>
);

// ─── 媒体控制 ────────────────────────────────────────────
export const IconPlay = (p: Props) => (
  <svg {...base(p)}>
    <path d="M7 5l12 7-12 7V5z" fill="currentColor" />
  </svg>
);

export const IconPause = (p: Props) => (
  <svg {...base(p)}>
    <rect x="6.5" y="5" width="3.5" height="14" rx="0.8" fill="currentColor" stroke="none" />
    <rect x="14" y="5" width="3.5" height="14" rx="0.8" fill="currentColor" stroke="none" />
  </svg>
);

export const IconPiP = (p: Props) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <rect x="12" y="11" width="7" height="6" rx="1" fill="currentColor" stroke="none" />
  </svg>
);

export const IconFullscreen = (p: Props) => (
  <svg {...base(p)}>
    <path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" />
  </svg>
);

export const IconFullscreenExit = (p: Props) => (
  <svg {...base(p)}>
    <path d="M9 4v4H5M15 4v4h4M9 20v-4H5M15 20v-4h4" />
  </svg>
);

export const IconVolumeMute = (p: Props) => (
  <svg {...base(p)}>
    <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
    <path d="M17 9l4 4M21 9l-4 4" />
  </svg>
);

// ─── 交互 ────────────────────────────────────────────────
export const IconHeart = (p: Props) => (
  <svg {...base(p)}>
    <path d="M12 20s-7-4.5-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.5-7 10-7 10z" />
  </svg>
);

export const IconHeartFill = (p: Props) => (
  <svg {...base(p)}>
    <path
      d="M12 20s-7-4.5-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.5-7 10-7 10z"
      fill="currentColor"
    />
  </svg>
);

export const IconShare = (p: Props) => (
  <svg {...base(p)}>
    <path d="M12 4v11" />
    <path d="M8 8l4-4 4 4" />
    <path d="M5 13v5a2 2 0 002 2h10a2 2 0 002-2v-5" />
  </svg>
);

export const IconEpisodes = (p: Props) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

// ─── 操作 ────────────────────────────────────────────────
export const IconRefresh = (p: Props) => (
  <svg {...base(p)}>
    <path d="M3 12a9 9 0 0115-6.7L20 8" />
    <path d="M20 4v4h-4" />
    <path d="M21 12a9 9 0 01-15 6.7L4 16" />
    <path d="M4 20v-4h4" />
  </svg>
);

export const IconClose = (p: Props) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconArrowLeft = (p: Props) => (
  <svg {...base(p)}>
    <path d="M15 5l-7 7 7 7" />
    <path d="M8 12h12" />
  </svg>
);

export const IconCheck = (p: Props) => (
  <svg {...base(p)}>
    <path d="M5 12l5 5L20 6" />
  </svg>
);

export const IconPlus = (p: Props) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconTrash = (p: Props) => (
  <svg {...base(p)}>
    <path d="M4 7h16" />
    <path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" />
    <path d="M6 7l1 13a2 2 0 002 2h6a2 2 0 002-2l1-13" />
    <path d="M10 11v7M14 11v7" />
  </svg>
);

export const IconUpload = (p: Props) => (
  <svg {...base(p)}>
    <path d="M12 4v12" />
    <path d="M7 9l5-5 5 5" />
    <path d="M4 19h16" />
  </svg>
);

export const IconDownload = (p: Props) => (
  <svg {...base(p)}>
    <path d="M12 4v12" />
    <path d="M7 11l5 5 5-5" />
    <path d="M4 19h16" />
  </svg>
);

// ─── 杂项 ────────────────────────────────────────────────
export const IconScript = (p: Props) => (
  <svg {...base(p)}>
    {/* { } 代码括号 */}
    <path d="M9 4c-3 0-3 4-3 4s0 4-3 4c3 0 3 4 3 4s0 4 3 4" />
    <path d="M15 4c3 0 3 4 3 4s0 4 3 4c-3 0-3 4-3 4s0 4-3 4" />
  </svg>
);

export const IconAntenna = (p: Props) => (
  <svg {...base(p)}>
    {/* 信号塔 — 用于直播订阅 */}
    <path d="M5 19l3-7" />
    <path d="M19 19l-3-7" />
    <path d="M9 12h6" />
    <path d="M12 4l-3 8h6l-3-8z" fill="currentColor" />
  </svg>
);

export const IconCalendar = (p: Props) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18" />
    <path d="M8 3v4M16 3v4" />
  </svg>
);

export const IconList = (p: Props) => (
  <svg {...base(p)}>
    <path d="M4 7h16M4 12h16M4 17h10" />
  </svg>
);

export const IconSettings = (p: Props) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
  </svg>
);

export const IconKeyboard = (p: Props) => (
  <svg {...base(p)}>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12" />
  </svg>
);

export const IconFilm = (p: Props) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M7 3v18M17 3v18M3 8h4M17 8h4M3 16h4M17 16h4M3 12h18" />
  </svg>
);

export const IconStatic = (p: Props) => (
  <svg {...base(p)}>
    {/* TV 雪花点 — empty state */}
    <rect x="3" y="4" width="18" height="14" rx="1.5" />
    <path d="M9 21h6" />
    <path d="M12 18v3" />
    <circle cx="7" cy="9" r="0.5" fill="currentColor" stroke="none" />
    <circle cx="11" cy="8" r="0.5" fill="currentColor" stroke="none" />
    <circle cx="15" cy="10" r="0.5" fill="currentColor" stroke="none" />
    <circle cx="9" cy="12" r="0.5" fill="currentColor" stroke="none" />
    <circle cx="14" cy="13" r="0.5" fill="currentColor" stroke="none" />
    <circle cx="17" cy="14" r="0.5" fill="currentColor" stroke="none" />
    <circle cx="6" cy="14" r="0.5" fill="currentColor" stroke="none" />
    <circle cx="11" cy="15" r="0.5" fill="currentColor" stroke="none" />
  </svg>
);

export const IconClock = (p: Props) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const IconStats = (p: Props) => (
  <svg {...base(p)}>
    <path d="M4 19V9M10 19V5M16 19v-7M22 19h-20" />
  </svg>
);

export const IconChevronDown = (p: Props) => (
  <svg {...base(p)}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const IconChevronRight = (p: Props) => (
  <svg {...base(p)}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

// ─── 播放器扩展 ────────────────────────────────────────────
export const IconVolume = (p: Props) => (
  <svg {...base(p)}>
    <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
    <path d="M15.5 9a4 4 0 010 6" />
    <path d="M18 6.5a8 8 0 010 11" />
  </svg>
);

export const IconVolumeLow = (p: Props) => (
  <svg {...base(p)}>
    <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" stroke="none" />
    <path d="M15.5 10a3 3 0 010 4" />
  </svg>
);

export const IconQuality = (p: Props) => (
  <svg {...base(p)}>
    {/* HD 标志 — 圆角矩形 + 内部 H D 等距线 */}
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M7 10v4M7 12h3M10 10v4" />
    <path d="M14 10v4h2.5a2 2 0 002-2v0a2 2 0 00-2-2H14z" />
  </svg>
);

export const IconAdBlock = (p: Props) => (
  <svg {...base(p)}>
    {/* 盾牌 + 内部 X */}
    <path d="M12 3l8 3v5c0 5-4 9-8 10-4-1-8-5-8-10V6l8-3z" />
    <path d="M9 9l6 6M15 9l-6 6" />
  </svg>
);

export const IconSubtitle = (p: Props) => (
  <svg {...base(p)}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M6 11h3M11 11h7M6 15h7M15 15h3" />
  </svg>
);

export const IconCamera = (p: Props) => (
  <svg {...base(p)}>
    <path d="M4 8l3-3h10l3 3v10a2 2 0 01-2 2H6a2 2 0 01-2-2V8z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

export const IconLock = (p: Props) => (
  <svg {...base(p)}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 018 0v4" />
  </svg>
);

export const IconLockOpen = (p: Props) => (
  <svg {...base(p)}>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 017.6-1.7" />
  </svg>
);

export const IconSkipForward = (p: Props) => (
  <svg {...base(p)}>
    <path d="M5 5l9 7-9 7V5z" fill="currentColor" stroke="none" />
    <path d="M19 5v14" />
  </svg>
);

export const IconSkipBackward = (p: Props) => (
  <svg {...base(p)}>
    <path d="M19 5l-9 7 9 7V5z" fill="currentColor" stroke="none" />
    <path d="M5 5v14" />
  </svg>
);

export const IconRetry = (p: Props) => (
  <svg {...base(p)}>
    <path d="M21 12a9 9 0 11-3-6.7" />
    <path d="M21 4v5h-5" />
  </svg>
);

export const IconABLoop = (p: Props) => (
  <svg {...base(p)}>
    <path d="M3 12a9 9 0 0114-7" />
    <path d="M21 12a9 9 0 01-14 7" />
    <text x="12" y="14" font-size="6" text-anchor="middle" fill="currentColor" stroke="none" font-family="monospace" font-weight="700">AB</text>
  </svg>
);

export const IconMore = (p: Props) => (
  <svg {...base(p)}>
    <circle cx="5" cy="12" r="1.4" fill="currentColor" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    <circle cx="19" cy="12" r="1.4" fill="currentColor" />
  </svg>
);

export const IconWave = (p: Props) => (
  <svg {...base(p)}>
    {/* 信号波 — 直播状态/正在播 */}
    <path d="M3 12c0-3 2-3 2 0s2 5 2 0 2-7 2 0 2 9 2 0 2-7 2 0 2 5 2 0 2-3 2 0" />
  </svg>
);
