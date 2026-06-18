import { useState } from "react";
import {
  IconAlbum,
  IconClose,
  IconPlay,
  IconSettings,
  IconTrash,
} from "@/components/Icon";
import { type MusicSong } from "@/lib/music";
import { wrapImage } from "@/lib/proxy";
import { type MusicUserPlaylist } from "@/stores/music";

export function PlaylistPanel({
  playlist,
  onPlay,
  onDelete,
  onClear,
}: {
  playlist: MusicUserPlaylist;
  currentSong: MusicSong | null;
  isFavorite: (song: MusicSong) => boolean;
  onPlay: (song: MusicSong) => void;
  onFavorite: (song: MusicSong) => void;
  onQueue: (song: MusicSong) => void;
  onAddToPlaylist: (song: MusicSong) => void;
  onDelete: () => void;
  onClear: () => void;
  onRemove: (song: MusicSong) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const cover = playlist.cover
    ? wrapImage(playlist.cover)
    : playlist.songs.find((s) => s.cover)?.cover
      ? wrapImage(playlist.songs.find((s) => s.cover)!.cover)
      : undefined;

  return (
    <button
      type="button"
      onClick={() => playlist.songs[0] && onPlay(playlist.songs[0])}
      className="group text-left"
    >
      <div className="aspect-square rounded-xl overflow-hidden relative mb-3" style={{ background: "var(--ink-3)" }}>
        {cover ? (
          <img
            src={cover}
            alt=""
            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
          />
        ) : (
          <div className="grid w-full h-full place-items-center text-cream-faint">
            <IconAlbum size={40} />
          </div>
        )}
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.4)" }}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              playlist.songs[0] && onPlay(playlist.songs[0]);
            }}
            className="w-10 h-10 bg-primary rounded-full flex items-center justify-center text-on-primary-container"
          >
            <IconPlay size={20} />
          </button>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowMenu(!showMenu);
          }}
          className="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: "rgba(0,0,0,0.6)" }}
        >
          <IconSettings size={14} />
        </button>
        {showMenu && (
          <div
            className="absolute top-10 right-2 rounded-lg shadow-2xl p-1 z-20"
            style={{ background: "var(--ink)", border: "1px solid var(--cream-line)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
                setShowMenu(false);
              }}
              className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-ember-soft hover:text-ember rounded transition-colors w-full text-left whitespace-nowrap"
            >
              <IconTrash size={14} />
              清空歌单
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
                setShowMenu(false);
              }}
              className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-ember-soft hover:text-ember rounded transition-colors w-full text-left whitespace-nowrap"
            >
              <IconClose size={14} />
              删除歌单
            </button>
          </div>
        )}
      </div>
      <h4 className="text-sm font-semibold text-cream truncate">{playlist.name}</h4>
      <p className="text-xs text-cream-faint">{playlist.songs.length} 首歌曲</p>
    </button>
  );
}
