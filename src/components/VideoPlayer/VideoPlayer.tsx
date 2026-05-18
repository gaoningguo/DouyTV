/**
 * 历史保留路径 — 实际实现已迁移到 `ArtPlayerHost.tsx`。
 *
 * 旧的 1482 行 `<video>` + 手写 UI 实现已替换为 ArtPlayer 5 wrapper，
 * 以对齐 MoonTV 的播放体验（完整控件、长按倍速、移动锁屏、设置菜单、弹幕插件）。
 *
 * 外部 import 仍走 `@/components/VideoPlayer` —— index.ts 重导出本文件的 default。
 */
import ArtPlayerHost from "./ArtPlayerHost";
export type { VideoPlayerHandle, VideoPlayerProps } from "./ArtPlayerHost";
export default ArtPlayerHost;
