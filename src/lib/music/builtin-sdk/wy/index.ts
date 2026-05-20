// @ts-nocheck
/** WY (网易云) 平台聚合 — 暴露 musicSearch / lyric / leaderboard 模块（公开未签名端点）。 */
import musicSearch from "./musicSearch";
import getLyric from "./lyric";
import leaderboard from "./leaderboard";

export default {
  musicSearch,
  getLyric: (songInfo: { songmid: string }) => getLyric(songInfo.songmid),
  leaderboard,
};
