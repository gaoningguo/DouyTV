import { IconAlbum, IconArrowLeft, IconPlay, IconPlus } from "@/components/Icon";
import { formatDuration, musicSongKey, type MusicSong } from "@/lib/music";
import { wrapImage } from "@/lib/proxy";
import { mostCommonArtist } from "../utils";
import { SectionHeader } from "../components/ui";
import { SongList } from "../components/SongList";

export function AlbumView({
  name,
  artist,
  cover,
  songs,
  loading,
  restricted,
  currentSong,
  isPlaying,
  isFavorite,
  relatedArtist,
  relatedWorks,
  onBack,
  onPlay,
  onPlayAll,
  onFavorite,
  onQueue,
  onAddToPlaylist,
  onPlayRelated,
  onOpenArtist,
}: {
  name: string;
  artist?: string;
  cover?: string;
  songs: MusicSong[];
  loading: boolean;
  restricted?: boolean;
  currentSong: MusicSong | null;
  isPlaying: boolean;
  isFavorite: (song: MusicSong) => boolean;
  relatedArtist: string;
  relatedWorks: MusicSong[];
  onBack: () => void;
  onPlay: (song: MusicSong) => void;
  onPlayAll: () => void;
  onFavorite: (song: MusicSong) => void;
  onQueue: (song: MusicSong) => void;
  onAddToPlaylist: (song: MusicSong) => void;
  onPlayRelated: (song: MusicSong) => void;
  onOpenArtist: (artist: string) => void;
}) {
  const heroCover = cover ? wrapImage(cover) : songs.find((s) => s.cover)?.cover ? wrapImage(songs.find((s) => s.cover)!.cover) : undefined;
  const totalSec = songs.reduce((sum, song) => sum + (song.durationSec || 0), 0);
  const albumArtist = artist || relatedArtist || mostCommonArtist(songs);
  return (
    <div className="music-album-page space-y-10 pb-4">
      {restricted && (
        <div
          className="rounded-lg px-4 py-2.5 text-xs text-cream-dim"
          style={{ background: "rgba(255,107,53,0.08)", border: "1px solid rgba(255,107,53,0.3)" }}
        >
          完整专辑曲目需自部署 NeteaseCloudMusicApi 源；当前为搜索派生数据。
        </div>
      )}
      <section className="music-ob-album-hero">
        <div
          aria-hidden
          className="music-ob-album-hero-bg"
          style={
            heroCover
              ? { backgroundImage: `url(${heroCover})` }
              : { background: "linear-gradient(135deg, rgba(255,107,53,0.22), rgba(79,195,247,0.12))" }
          }
        />
        <div aria-hidden className="music-ob-album-hero-veil" />
        <div className="music-ob-album-hero-body">
          <button type="button" onClick={onBack} className="music-back-btn" title="返回">
            <IconArrowLeft size={18} />
          </button>
          <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-end">
            <div className="music-ob-album-cover-lg">
              {heroCover ? (
                <img src={heroCover} alt="" className="h-full w-full object-cover" />
              ) : (
                <IconAlbum size={64} className="text-cream-faint" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <span className="music-ob-tag">录音室专辑</span>
              <h1 className="mt-3 line-clamp-2 font-display text-xl font-extrabold leading-tight text-cream sm:text-3xl">
                {name}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-cream-dim">
                {albumArtist && (
                  <button
                    type="button"
                    onClick={() => onOpenArtist(albumArtist)}
                    className="font-display font-bold text-cream transition-colors hover:text-ember"
                  >
                    {albumArtist}
                  </button>
                )}
                {songs.length > 0 && (
                  <>
                    <span className="h-1 w-1 rounded-full bg-cream-faint" />
                    <span>
                      {songs.length} 首歌曲{totalSec > 0 ? `, ${formatDuration(totalSec)}` : ""}
                    </span>
                  </>
                )}
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onPlayAll}
                  disabled={songs.length === 0}
                  className="music-ob-play-btn disabled:opacity-40"
                >
                  <IconPlay size={18} />
                  播放专辑
                </button>
                {songs[0] && (
                  <button type="button" onClick={() => onQueue(songs[0])} className="music-ob-icon-btn" title="加入队列">
                    <IconPlus size={18} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="music-panel">
        <SongList
          songs={songs}
          activeSong={currentSong}
          activePlaying={isPlaying}
          loading={loading}
          emptyText="没有找到该专辑的曲目"
          isFavorite={isFavorite}
          onPlay={onPlay}
          onFavorite={onFavorite}
          onQueue={onQueue}
          onAddToPlaylist={onAddToPlaylist}
        />
      </section>

      {relatedWorks.length > 0 && (
        <section>
          <SectionHeader
            title={albumArtist ? `${albumArtist} 的更多作品` : "更多作品"}
            meta="相关专辑"
          />
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {relatedWorks.map((song, index) => (
                <button
                  key={`${musicSongKey(song)}:${index}`}
                  type="button"
                  onClick={() => onPlayRelated(song)}
                  className="group text-left"
                >
                  <div className="music-ob-album-cover">
                    {song.cover ? (
                      <img
                        src={wrapImage(song.cover)}
                        alt=""
                        className="h-full w-full rounded-lg object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <span className="grid h-full w-full place-items-center rounded-lg bg-ink-3 text-cream-faint">
                        <IconAlbum size={32} />
                      </span>
                    )}
                    <span className="music-ob-album-play">
                      <IconPlay size={20} />
                    </span>
                  </div>
                  <h3 className="mt-3 line-clamp-1 font-display text-sm font-semibold text-cream transition-colors group-hover:text-ember">
                    {song.album || song.title}
                  </h3>
                  <p className="line-clamp-1 text-xs text-cream-faint">{song.artist}</p>
                </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
