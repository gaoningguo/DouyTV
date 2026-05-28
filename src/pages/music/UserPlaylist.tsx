/**
 * 自建歌单详情 —— 与 Playlist.tsx（在线歌单）严格分开，避免误删用户数据。
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMusicStore } from "@/stores/music";
import {
  IconMusic,
  IconTrash,
} from "@/components/Icon";
import { MusicDetailHeader } from "@/components/MusicDetailHeader";
import { MusicPlayAllBar } from "@/components/MusicPlayAllBar";
import { MusicListItem } from "@/components/MusicListItem";
import { showMusicMenu } from "@/components/MusicContextMenu";
import type { MusicSong } from "@/lib/music/types";

function formatDuration(sec?: number) {
  if (!sec || !Number.isFinite(sec)) return undefined;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function MusicUserPlaylist() {
  const navigate = useNavigate();
  const { id = "" } = useParams<{ id: string }>();
  const playlist = useMusicStore((s) =>
    s.playlists.find((p) => p.id === id)
  );
  const hydrate = useMusicStore((s) => s.hydrate);
  const loadPlaylistSongs = useMusicStore((s) => s.loadPlaylistSongs);
  const playQueue = useMusicStore((s) => s.playQueue);
  const setRepeatMode = useMusicStore((s) => s.setRepeatMode);
  const deletePlaylist = useMusicStore((s) => s.deletePlaylist);
  const renamePlaylist = useMusicStore((s) => s.renamePlaylist);
  const removeFromPlaylist = useMusicStore((s) => s.removeFromPlaylist);

  const [songs, setSongs] = useState<MusicSong[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const list = await loadPlaylistSongs(id);
    setSongs(list);
    setLoading(false);
  }, [id, loadPlaylistSongs]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleRename = async () => {
    const name = window.prompt("重命名歌单", playlist?.name ?? "");
    if (!name?.trim() || name === playlist?.name) return;
    await renamePlaylist(id, name.trim());
  };

  const handleDelete = async () => {
    if (!window.confirm(`删除歌单「${playlist?.name}」？此操作不可恢复`)) return;
    await deletePlaylist(id);
    navigate(-1);
  };

  const handleShuffle = () => {
    if (songs.length === 0) return;
    setRepeatMode("shuffle");
    void playQueue(songs, 0);
  };

  if (!playlist) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center bg-ink text-cream p-4">
        <p className="text-sm text-cream-dim mb-3">歌单不存在</p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-[11px] text-ember font-mono"
        >
          ← 返回
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-ink text-cream">
      <div className="shrink-0 px-4 pt-3 pb-1">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="font-mono text-[10px] tracking-[0.2em] text-cream-faint tap"
          aria-label="返回"
        >
          ← 返回
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4">

      <MusicDetailHeader
        eyebrow="MUSIC · MY PLAYLIST"
        title={playlist.name}
        cover={playlist.cover}
        meta={[`${songs.length} 首`]}
        rightSlot={
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => void handleRename()}
              className="px-2 py-1 rounded text-[10px] font-mono tap text-cream"
              style={{
                background: "var(--ink-2)",
                border: "1px solid var(--cream-line)",
              }}
            >
              重命名
            </button>
            <button
              type="button"
              onClick={() => void handleDelete()}
              className="px-2 py-1 rounded text-[10px] font-mono tap text-cream-faint hover:text-cream"
              style={{
                background: "var(--ink-2)",
                border: "1px solid var(--cream-line)",
              }}
              aria-label="删除歌单"
            >
              删除
            </button>
          </div>
        }
      />

      {loading ? (
        <div className="signal-bars" style={{ height: 22 }}>
          <span></span>
          <span></span>
          <span></span>
        </div>
      ) : songs.length === 0 ? (
        <div
          className="rounded-xl p-6 text-center"
          style={{ background: "var(--ink-2)", border: "1px dashed var(--cream-line)" }}
        >
          <IconMusic size={32} className="text-cream-faint mx-auto mb-2" />
          <p className="text-sm text-cream-dim mb-1">还没有添加歌曲</p>
          <p className="text-[11px] text-cream-faint">
            在任意歌曲长按 → "添加到歌单..." 即可
          </p>
        </div>
      ) : (
        <>
          <MusicPlayAllBar
            count={songs.length}
            onPlayAll={() => void playQueue(songs, 0)}
            onShuffle={handleShuffle}
          />
          <ul className="space-y-1.5">
            {songs.map((s, i) => (
              <li key={`${s.source}-${s.songId}`}>
                <MusicListItem
                  song={s}
                  index={i + 1}
                  duration={formatDuration(s.durationSec)}
                  onClick={() => void playQueue(songs, i)}
                  onMenu={() => showMusicMenu(s)}
                  trailing={
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        await removeFromPlaylist(id, s);
                        void reload();
                      }}
                      className="w-7 h-7 flex items-center justify-center tap text-cream-faint hover:text-cream"
                      aria-label="从歌单移除"
                    >
                      <IconTrash size={12} />
                    </button>
                  }
                />
              </li>
            ))}
          </ul>
        </>
      )}
      </div>
    </div>
  );
}
