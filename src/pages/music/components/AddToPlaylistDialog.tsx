import { IconBookmark, IconClose } from "@/components/Icon";
import { type MusicSong } from "@/lib/music";
import { type MusicUserPlaylist } from "@/stores/music";

export function AddToPlaylistDialog({
  song,
  playlists,
  newPlaylistName,
  onName,
  onClose,
  onAdd,
  onCreate,
}: {
  song: MusicSong;
  playlists: MusicUserPlaylist[];
  newPlaylistName: string;
  onName: (value: string) => void;
  onClose: () => void;
  onAdd: (playlistId: string) => void;
  onCreate: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <button type="button" aria-label="关闭" className="absolute inset-0 cursor-default" style={{ background: "rgba(0,0,0,0.68)" }} onClick={onClose} />
      <section className="relative w-full max-w-md rounded-xl overflow-hidden" style={{ background: "rgba(22,24,29,0.98)", border: "1px solid var(--cream-line)" }}>
        <header className="h-14 px-4 flex items-center gap-3" style={{ borderBottom: "1px solid var(--cream-line)" }}>
          <h2 className="font-display font-bold">加入歌单</h2>
          <button type="button" onClick={onClose} className="ml-auto w-9 h-9 rounded-lg grid place-items-center tap text-cream-dim"><IconClose size={17} /></button>
        </header>
        <div className="p-4 space-y-3">
          <p className="text-sm text-cream-dim line-clamp-1">{song.title} / {song.artist}</p>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {playlists.map((playlist) => (
              <button key={playlist.id} type="button" onClick={() => onAdd(playlist.id)} className="w-full h-10 px-3 rounded-lg flex items-center gap-2 text-left tap" style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}>
                <IconBookmark size={15} />
                <span className="min-w-0 flex-1 text-sm line-clamp-1">{playlist.name}</span>
                <span className="text-xs text-cream-faint">{playlist.songs.length}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={newPlaylistName} onChange={(event) => onName(event.target.value)} placeholder="新建歌单名称" className="h-10 min-w-0 flex-1 rounded-lg px-3 bg-ink text-sm text-cream" style={{ border: "1px solid var(--cream-line)" }} />
            <button type="button" onClick={onCreate} className="h-10 px-4 rounded-lg text-xs font-display font-bold tap" style={{ background: "var(--ember)", color: "var(--ink)" }}>新建并加入</button>
          </div>
        </div>
      </section>
    </div>
  );
}
