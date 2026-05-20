/**
 * 内置音乐源 SDK —— 移植自 lx-music-desktop/src/renderer/utils/musicSdk。
 *
 * **重要**：所有 SDK 文件用 // @ts-nocheck 跳过严格类型检查，因为 lx-music 原版 JS
 * 完全无类型注解；强行写完整类型会拖慢开发 5x。在 builtin.ts 中通过 boundary 类型断言
 * 把 SDK 返回结果映射回 MusicSong 等强类型。
 *
 * **当前覆盖**（first ship）：
 * - ✅ WY (网易云) — search / lyric / leaderboard（公开未签名端点）
 * - ✅ KW (酷我) — search / hotSearch（公开 r.s 端点）
 * - ⏳ TX (QQ) / KG (酷狗) / MG (咪咕) — 占位，需后续移植
 *
 * URL 解析：本 SDK 不负责，由 api.ts 的 parseRuntime() 回落到 musicapi/lxmusic/plugin backend。
 */
import wy from "./wy/index";
import kw from "./kw/index";
import kg from "./kg/index";
import tx from "./tx/index";
import mg from "./mg/index";

export { wy, kw, kg, tx, mg };

export type BuiltinSdkPlatform = {
  musicSearch?: {
    search: (q: string, page: number, limit?: number) => Promise<{
      list: Array<Record<string, unknown>>;
      total: number;
      allPage: number;
      limit: number;
      source: string;
    }>;
  };
  getLyric?: (info: { songmid: string }) => Promise<{ lyric: string; tlyric: string }>;
  hotSearch?: { getHotSearch: () => Promise<string[]> };
  leaderboard?: {
    getList?: () => Promise<Array<{ id: string; name: string; coverImgUrl?: string; description?: string }>>;
    getDetail?: (id: string) => Promise<{
      name: string;
      cover?: string;
      description?: string;
      list: Array<Record<string, unknown>>;
    }>;
  };
};

export function getPlatformSdk(id: string): BuiltinSdkPlatform | undefined {
  switch (id) {
    case "wy":
      return wy as BuiltinSdkPlatform;
    case "kw":
      return kw as BuiltinSdkPlatform;
    case "kg":
      return kg as BuiltinSdkPlatform;
    case "tx":
      return tx as BuiltinSdkPlatform;
    case "mg":
      return mg as BuiltinSdkPlatform;
    default:
      return undefined;
  }
}

export const SUPPORTED_PLATFORMS = ["wy", "tx", "kw", "kg", "mg"] as const;
