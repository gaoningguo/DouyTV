import {
  IconAlbum,
  IconBookmark,
  IconClose,
  IconHeart,
  IconHeartFill,
  IconPause,
  IconPlay,
  IconPlus,
} from "@/components/Icon";
import {
  formatDuration,
  musicSongKey,
  type MusicSong,
  type MusicSongListSummary,
} from "@/lib/music";
import { wrapImage } from "@/lib/proxy";
import { aggregateMusicLabel, aggregatePlaylistMeta } from "../utils";
import { CoverArt, EmptyBlock, IconButton } from "./ui";

export function SongList({
  songs,
  activeSong,
  activePlaying,
  loading,
  emptyText,
  compact,
  isFavorite,
  onPlay,
  onFavorite,
  onQueue,
  onAddToPlaylist,
  onRemove,
  hideFavorite,
  hideQueue,
  onOpenAlbumSong,
}: {
  songs: MusicSong[];
  activeSong: MusicSong | null;
  activePlaying?: boolean;
  loading?: boolean;
  emptyText: string;
  compact?: boolean;
  isFavorite: (song: MusicSong) => boolean;
  onPlay: (song: MusicSong) => void;
  onFavorite: (song: MusicSong) => void;
  onQueue: (song: MusicSong) => void;
  onAddToPlaylist: (song: MusicSong) => void;
  onRemove?: (song: MusicSong) => void;
  hideFavorite?: boolean;
  hideQueue?: boolean;
  /** 提供时，带 albumId 的歌曲的专辑名可点（跳专辑页，LX 源走 getLxAlbumSongs 路由）。 */
  onOpenAlbumSong?: (song: MusicSong) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: compact ? 6 : 10 }).map((_, index) => (
          <div key={index} className="h-14 rounded-lg skeleton-shimmer" />
        ))}
      </div>
    );
  }
  if (songs.length === 0) return <EmptyBlock text={emptyText} />;
  return (
    <div className={compact ? "space-y-1.5" : "space-y-2"}>
      {songs.map((song, index) => {
        const active = !!activeSong && musicSongKey(activeSong) === musicSongKey(song);
        const favorite = isFavorite(song);
        return (
          <article
            key={`${musicSongKey(song)}:${index}`}
            className="group rounded-lg px-3 py-2 flex items-center gap-3 transition-colors"
            style={{
              background: active ? "rgba(255,107,53,0.12)" : "rgba(242,232,213,0.045)",
              border: `1px solid ${active ? "rgba(255,107,53,0.38)" : "transparent"}`,
            }}
          >
            <button type="button" onClick={() => onPlay(song)} className="relative tap shrink-0" title="播放">
              <CoverArt src={wrapImage(song.cover)} title={song.title} size={compact ? "tiny" : "list"} />
              <span className="absolute inset-0 grid place-items-center rounded-lg opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: "rgba(0,0,0,0.48)" }}>
                {active && activePlaying ? <IconPause size={17} /> : <IconPlay size={17} />}
              </span>
              {active && activePlaying && (
                <span className="music-row-eq" aria-hidden>
                  <span /><span /><span />
                </span>
              )}
            </button>
            <div className="min-w-0 flex-1">
              <h3
                className="text-sm font-display font-semibold line-clamp-1"
                style={{ color: active ? "var(--ember)" : "var(--cream)" }}
              >
                {song.title}
              </h3>
              <div className="mt-1 flex items-center gap-2 text-xs text-cream-dim min-w-0">
                <span className="line-clamp-1">{song.artist}</span>
                <span className="hidden sm:inline text-cream-faint">/</span>
                {onOpenAlbumSong && song.album && song.albumId ? (
                  <button
                    type="button"
                    onClick={() => onOpenAlbumSong(song)}
                    className="hidden sm:inline line-clamp-1 hover:text-ember transition-colors tap text-left"
                    title="查看专辑"
                  >
                    {song.album}
                  </button>
                ) : (
                  <span className="hidden sm:inline line-clamp-1">{song.album || song.sourceName}</span>
                )}
              </div>
            </div>
            <span className="hidden sm:inline font-mono text-[11px] text-cream-faint w-12 text-right">
              {song.durationText || formatDuration(song.durationSec)}
            </span>
            <div className="flex items-center gap-1">
              {!hideFavorite && (
                <IconButton label="收藏" active={favorite} onClick={() => onFavorite(song)}>
                  {favorite ? <IconHeartFill size={15} /> : <IconHeart size={15} />}
                </IconButton>
              )}
              {!hideQueue && (
                <IconButton label="加入队列" onClick={() => onQueue(song)}>
                  <IconPlus size={15} />
                </IconButton>
              )}
              <IconButton label="加入歌单" onClick={() => onAddToPlaylist(song)}>
                <IconBookmark size={15} />
              </IconButton>
              {onRemove && (
                <IconButton label="移除" onClick={() => onRemove(song)}>
                  <IconClose size={15} />
                </IconButton>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function PlaylistGrid({
  items,
  onOpen,
  emptyText = "暂无推荐歌单",
}: {
  items: MusicSongListSummary[];
  onOpen: (item: MusicSongListSummary) => void;
  emptyText?: string;
}) {
  if (items.length === 0) return <EmptyBlock text={emptyText} />;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 gap-3">
      {items.map((item) => (
        <button
          key={`${item.source}:${item.id}`}
          type="button"
          onClick={() => onOpen(item)}
          className="text-left rounded-lg overflow-hidden tap group"
          style={{ background: "rgba(242,232,213,0.045)", border: "1px solid var(--cream-line)" }}
        >
          <div className="aspect-square bg-ink-3 overflow-hidden">
            {item.pic ? (
              <img src={wrapImage(item.pic)} alt="" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
            ) : (
              <div className="w-full h-full grid place-items-center text-cream-faint"><IconAlbum size={36} /></div>
            )}
          </div>
          <div className="p-2">
            <p className="text-xs font-display font-semibold line-clamp-2 text-cream min-h-[2rem]">
              {aggregateMusicLabel(item.name, "推荐歌单")}
            </p>
            <p className="mt-1 text-[10px] text-cream-faint line-clamp-1">
              {aggregatePlaylistMeta(item)}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}
