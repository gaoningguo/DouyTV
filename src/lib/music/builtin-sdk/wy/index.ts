// @ts-nocheck
/** WY (网易云) 平台聚合 —— musicSearch / lyric / leaderboard / songList / musicUrl。 */
import musicSearch from "./musicSearch";
import getLyric from "./lyric";
import leaderboard from "./leaderboard";
import songList from "./songList";
import musicUrl from "./musicUrl";

export default {
  musicSearch,
  getLyric: (songInfo: { songmid: string }) => getLyric(songInfo.songmid),
  leaderboard,
  songList,
  musicUrl,
};
