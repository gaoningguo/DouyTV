import { IconCalendar, IconPlay, IconRefresh } from "@/components/Icon";
import { type MusicSong } from "@/lib/music";
import { wrapImage } from "@/lib/proxy";
import { SongList } from "../components/SongList";

/**
 * 每日推荐页 —— 借鉴 Tabos「每日推荐」：大头部 + 推荐歌曲列表。
 * LX 无每日推荐 FM 接口，这里用收藏/历史/榜单聚合的歌曲填充，等后端接入再替换。
 */
export function RecommendView({
  songs,
  loading,
  currentSong,
  isPlaying,
  isFavorite,
  onPlayAll,
  onReload,
  onPlay,
  onFavorite,
  onQueue,
  onAddToPlaylist,
}: {
  songs: MusicSong[];
  loading: boolean;
  currentSong: MusicSong | null;
  isPlaying: boolean;
  isFavorite: (song: MusicSong) => boolean;
  onPlayAll: () => void;
  onReload: () => void;
  onPlay: (song: MusicSong, songs: MusicSong[]) => void;
  onFavorite: (song: MusicSong) => void;
  onQueue: (song: MusicSong) => void;
  onAddToPlaylist: (song: MusicSong) => void;
}) {
  const today = new Date();
  const cover = songs[0]?.cover ? wrapImage(songs[0].cover) : undefined;
  return (
    <div className="music-page-wrap space-y-6">
      {/* 大头部 */}
      <section className="music-recommend-hero">
        <div
          aria-hidden
          className="music-vinyl-hero-bg"
          style={
            cover
              ? { backgroundImage: `url(${cover})` }
              : {
                  background:
                    "linear-gradient(135deg, rgba(255,107,53,0.22), rgba(79,195,247,0.12))",
                }
          }
        />
        <div aria-hidden className="music-vinyl-hero-veil" />
        <div className="music-recommend-hero-body">
          <div className="music-recommend-date">
            <span className="music-recommend-day">{today.getDate()}</span>
            <span className="music-recommend-month">
              {today.getMonth() + 1} 月
            </span>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-ember">
              <IconCalendar size={16} />
              <span className="font-mono text-xs font-bold uppercase tracking-[0.16em]">
                每日推荐
              </span>
            </div>
            <h1 className="music-page-title text-glow mt-1">懂你的音乐</h1>
            <p className="music-page-sub">根据你的收藏与播放习惯，每天为你挑选</p>
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={onPlayAll}
                className="music-ob-play-btn"
                disabled={songs.length === 0}
              >
                <IconPlay size={18} />
                播放全部
              </button>
              <button type="button" onClick={onReload} className="music-ob-ghost-btn">
                <IconRefresh size={16} className={loading ? "animate-spin" : ""} />
                换一批
              </button>
            </div>
          </div>
        </div>
      </section>

      <SongList
        songs={songs}
        activeSong={currentSong}
        activePlaying={isPlaying}
        loading={loading}
        emptyText="多听几首歌后，这里会出现为你定制的推荐"
        isFavorite={isFavorite}
        onPlay={(song) => onPlay(song, songs)}
        onFavorite={onFavorite}
        onQueue={onQueue}
        onAddToPlaylist={onAddToPlaylist}
      />
    </div>
  );
}
