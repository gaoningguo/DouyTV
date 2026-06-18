import { useState } from "react";
import {
  IconAlbum,
  IconArrowLeft,
  IconArtist,
  IconChevronRight,
  IconPlay,
  IconPlus,
} from "@/components/Icon";
import { type MusicSong } from "@/lib/music";
import { wrapImage } from "@/lib/proxy";
import { EmptyBlock, SectionHeader } from "../components/ui";
import { SongList } from "../components/SongList";

export function ArtistView({
  name,
  songs,
  albums,
  similar,
  loading,
  currentSong,
  isPlaying,
  isFavorite,
  onBack,
  onPlay,
  onPlayAll,
  onFavorite,
  onQueue,
  onAddToPlaylist,
  onOpenAlbum,
  onOpenArtist,
}: {
  name: string;
  songs: MusicSong[];
  albums: Array<{ name: string; cover?: string; song: MusicSong }>;
  similar: Array<{ name: string; cover?: string; count: number; song: MusicSong }>;
  loading: boolean;
  currentSong: MusicSong | null;
  isPlaying: boolean;
  isFavorite: (song: MusicSong) => boolean;
  onBack: () => void;
  onPlay: (song: MusicSong) => void;
  onPlayAll: () => void;
  onFavorite: (song: MusicSong) => void;
  onQueue: (song: MusicSong) => void;
  onAddToPlaylist: (song: MusicSong) => void;
  onOpenAlbum: (album: string, artist?: string) => void;
  onOpenArtist: (artist: string) => void;
}) {
  const [showAllSongs, setShowAllSongs] = useState(false);
  const heroSong = songs.find((song) => song.cover) ?? songs[0];
  const heroCover = heroSong?.cover ? wrapImage(heroSong.cover) : undefined;
  const visibleSongs = showAllSongs ? songs : songs.slice(0, 8);
  return (
    <div className="music-album-page space-y-10 pb-4">
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
            <div className="music-ob-artist-avatar">
              {heroCover ? (
                <img src={heroCover} alt="" className="h-full w-full object-cover" />
              ) : (
                <IconArtist size={64} className="text-cream-faint" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <span className="music-ob-tag">认证艺术家</span>
              <h1 className="mt-3 line-clamp-2 font-display text-2xl font-extrabold leading-tight text-cream sm:text-4xl">
                {name}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-cream-dim">
                {songs.length > 0 && (
                  <span>
                    {songs.length} 首歌曲{albums.length > 0 ? ` · ${albums.length} 张专辑` : ""}
                  </span>
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
                  播放热门
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

      <div className="grid grid-cols-12 gap-10">
        <div className="col-span-12 lg:col-span-8 space-y-4">
          <SectionHeader title="热门歌曲" meta={songs.length > 0 ? `${songs.length} 首` : undefined} />
          <SongList
            songs={visibleSongs}
            activeSong={currentSong}
            activePlaying={isPlaying}
            loading={loading}
            emptyText="没有找到这位歌手的歌曲"
            isFavorite={isFavorite}
            onPlay={onPlay}
            onFavorite={onFavorite}
            onQueue={onQueue}
            onAddToPlaylist={onAddToPlaylist}
          />
          {!loading && songs.length > 8 && (
            <button
              type="button"
              onClick={() => setShowAllSongs((value) => !value)}
              className="font-mono text-xs uppercase tracking-[0.18em] text-cream-dim transition-colors hover:text-ember"
            >
              {showAllSongs ? "收起" : "查看全部歌曲"}
            </button>
          )}
        </div>

        <div className="col-span-12 lg:col-span-4 space-y-4">
          <SectionHeader title="粉丝也喜欢" />
          {similar.length === 0 ? (
            <EmptyBlock text="暂无相关歌手" />
          ) : (
            <div className="space-y-2">
              {similar.map((artist) => (
                <button
                  key={artist.name}
                  type="button"
                  onClick={() => onOpenArtist(artist.name)}
                  className="music-ob-quick-row group"
                >
                  <span className="h-14 w-14 shrink-0 overflow-hidden rounded-full bg-ink-3">
                    {artist.cover ? (
                      <img src={wrapImage(artist.cover)} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="grid h-full w-full place-items-center text-cream-faint">
                        <IconArtist size={24} />
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="line-clamp-1 block font-display text-sm font-bold text-cream">
                      {artist.name}
                    </span>
                    <span className="line-clamp-1 block text-xs text-cream-faint">
                      {artist.count} 首合作
                    </span>
                  </span>
                  <span className="text-ember opacity-0 transition-opacity group-hover:opacity-100">
                    <IconChevronRight size={20} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {albums.length > 0 && (
        <section>
          <SectionHeader title="专辑与发行" meta={`${albums.length} 张`} />
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {albums.map((album) => (
              <button
                key={album.name}
                type="button"
                onClick={() => onOpenAlbum(album.name, name)}
                className="group text-left"
              >
                <div className="music-ob-album-cover">
                  {album.cover ? (
                    <img
                      src={wrapImage(album.cover)}
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
                  {album.name}
                </h3>
                <p className="line-clamp-1 text-xs text-cream-faint">{name}</p>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
