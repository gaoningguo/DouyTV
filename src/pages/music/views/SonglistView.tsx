import { IconAlbum, IconArrowLeft, IconPause, IconPlay } from "@/components/Icon";
import { musicSongKey, type MusicSong, type MusicSongListSummary } from "@/lib/music";
import { wrapImage } from "@/lib/proxy";
import { aggregateMusicLabel, aggregatePlaylistMeta } from "../utils";
import { SectionHeader } from "../components/ui";
import { SongList } from "../components/SongList";

export function SonglistView({
  item,
  songs,
  loading,
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
}: {
  item: MusicSongListSummary | null;
  songs: MusicSong[];
  loading: boolean;
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
}) {
  const cover = item?.pic ? wrapImage(item.pic) : undefined;
  const total = songs.length || (typeof item?.total === "number" ? item.total : undefined);
  return (
    <div className="music-detail-page space-y-5 pb-4">
      <section className="music-songlist-hero">
        <div
          aria-hidden
          className="music-songlist-hero-bg"
          style={
            cover
              ? { background: `url(${cover}) center/cover` }
              : { background: "linear-gradient(135deg, rgba(255,107,53,0.18), rgba(79,195,247,0.1))" }
          }
        />
        <div aria-hidden className="music-songlist-hero-veil" />
        <div className="music-songlist-hero-body">
          <button type="button" onClick={onBack} className="music-back-btn" title="返回">
            <IconArrowLeft size={18} />
          </button>
          <div className="flex items-end gap-4 sm:gap-5">
            <div className="music-songlist-cover">
              {cover ? (
                <img src={cover} alt="" className="h-full w-full object-cover" />
              ) : (
                <IconAlbum size={48} className="text-cream-faint" />
              )}
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <p className="font-mono text-[10px] font-semibold tracking-[0.18em] text-cream-dim">
                PLAYLIST
              </p>
              <h1 className="mt-1 line-clamp-2 font-display text-xl font-extrabold leading-tight sm:text-3xl">
                {aggregateMusicLabel(item?.name, "推荐歌单")}
              </h1>
              <p className="mt-2 line-clamp-1 text-xs text-cream-faint sm:text-sm">
                {item ? aggregatePlaylistMeta(item) : ""}
                {total ? ` · ${total} 首` : ""}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onPlayAll}
                  disabled={songs.length === 0}
                  className="music-primary-action disabled:opacity-40"
                >
                  <IconPlay size={16} />
                  播放全部
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {item?.desc && (
        <p className="px-1 text-xs leading-relaxed text-cream-faint line-clamp-3">{item.desc}</p>
      )}

      <section className="music-panel">
        <SongList
          songs={songs}
          activeSong={currentSong}
          activePlaying={isPlaying}
          loading={loading}
          emptyText="歌单暂无歌曲"
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
            title={relatedArtist ? `${relatedArtist} 的更多作品` : "更多作品"}
            meta="相关推荐"
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {relatedWorks.map((song, index) => {
              const active = !!currentSong && musicSongKey(currentSong) === musicSongKey(song);
              return (
                <button
                  key={`${musicSongKey(song)}:${index}`}
                  type="button"
                  onClick={() => onPlayRelated(song)}
                  className="group text-left rounded-lg overflow-hidden tap"
                  style={{
                    background: "rgba(242,232,213,0.045)",
                    border: `1px solid ${active ? "rgba(255,107,53,0.38)" : "var(--cream-line)"}`,
                  }}
                >
                  <div className="relative aspect-square bg-ink-3 overflow-hidden">
                    {song.cover ? (
                      <img
                        src={wrapImage(song.cover)}
                        alt=""
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      />
                    ) : (
                      <div className="grid h-full w-full place-items-center text-cream-faint">
                        <IconAlbum size={32} />
                      </div>
                    )}
                    <span
                      className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ background: "rgba(0,0,0,0.42)" }}
                    >
                      {active && isPlaying ? <IconPause size={20} /> : <IconPlay size={20} />}
                    </span>
                  </div>
                  <div className="p-2">
                    <p
                      className="line-clamp-1 font-display text-xs font-semibold"
                      style={{ color: active ? "var(--ember)" : "var(--cream)" }}
                    >
                      {song.title}
                    </p>
                    <p className="mt-1 line-clamp-1 text-[10px] text-cream-faint">
                      {song.album || song.artist}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
