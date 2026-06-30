/**
 * musicSdk 统一入口（前端封装）。
 *
 * musicSdk 整目录原样移植自 lxserver `src/modules/utils/musicSdk`，提供六平台
 * （kw/kg/tx/wy/mg/bd）的搜索/榜单/歌单/歌词/专辑/热搜等「列表层」能力，免配置可用。
 * 网络层经 `sdk/request.ts` 桥接到本项目 scriptFetch（Rust ureq 出网，绕 CORS、走代理）。
 *
 * 播放层（getMusicUrl）不在 SDK 内实现：见 `sdk/musicSdk/api-source.js`，
 * 由外部注册解析源（洛雪脚本 / OmniParse）后才能取直链——对齐 lx-music-desktop。
 */
import musicSdk from "./musicSdk/index.js";
export { registerMusicUrlResolver } from "./musicSdk/api-source.js";

/** SDK 支持的平台 id。 */
export type MusicSdkPlatform = "kw" | "kg" | "tx" | "wy" | "mg" | "bd";

/** SDK 各平台模块（搜索/榜单/歌单/歌词等）。运行时为移植 JS，按需断言取用。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sdk = musicSdk as any;
