/**
 * 兼容垫层 —— 旧代码 `import { searchMusic } from "@/lib/music/client"` 仍可工作。
 * 新代码请直接 `import from "@/lib/music/api"`。
 */
export {
  searchMusic,
  getToplists,
  getToplistDetail,
  getPlaylistDetail,
  parseSong,
  fetchLyrics,
  parseLyrics,
} from "./api";
