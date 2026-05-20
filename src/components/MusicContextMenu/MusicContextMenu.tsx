/**
 * 全局上下文菜单 — 长按 / 右键歌曲项时弹出。
 *
 * 用法：先在 App.tsx 挂 <MusicContextMenuRoot />；任意位置 import { showMusicMenu } 调用。
 * 状态通过模块内 zustand-like store 共享，所以菜单组件只渲染一次。
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { create } from "zustand";
import type { MusicSong } from "@/lib/music/types";
import { useMusicStore } from "@/stores/music";
import {
  IconAlbum,
  IconArtist,
  IconClose,
  IconDownload,
  IconHeart,
  IconHeartFill,
  IconPlus,
  IconQueue,
  IconSkipForward,
} from "@/components/Icon";
import { isDesktop } from "@/lib/platform";

interface MenuOpts {
  /** 隐藏 "查看专辑" 入口（已经在专辑页时） */
  hideViewAlbum?: boolean;
  /** 隐藏 "查看歌手" 入口（已经在歌手页时） */
  hideViewArtist?: boolean;
  /** 隐藏 "下一首播放" / "添加到队列"（处于无队列上下文时） */
  hideQueueActions?: boolean;
}

interface MenuState {
  song: MusicSong | null;
  opts: MenuOpts;
  open: boolean;
  show: (song: MusicSong, opts?: MenuOpts) => void;
  hide: () => void;
}

const useMenuStore = create<MenuState>((set) => ({
  song: null,
  opts: {},
  open: false,
  show: (song, opts = {}) => set({ song, opts, open: true }),
  hide: () => set({ open: false }),
}));

export function showMusicMenu(song: MusicSong, opts?: MenuOpts) {
  useMenuStore.getState().show(song, opts);
}

function PlaylistPicker({
  onPick,
  onClose,
}: {
  onPick: (playlistId: string) => void;
  onClose: () => void;
}) {
  const playlists = useMusicStore((s) => s.playlists);
  const createPlaylist = useMusicStore((s) => s.createPlaylist);
  const handleNew = async () => {
    const name = window.prompt("新建歌单名称");
    if (!name?.trim()) return;
    const rec = await createPlaylist(name.trim());
    onPick(rec.id);
  };
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={handleNew}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg tap text-left"
        style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
      >
        <IconPlus size={14} className="text-ember" />
        <span className="text-xs font-display font-semibold">新建歌单</span>
      </button>
      {playlists.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onPick(p.id)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg tap text-left"
          style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
        >
          <span className="text-xs font-display font-semibold line-clamp-1 text-cream">
            {p.name}
          </span>
          <span className="font-mono text-[10px] text-cream-faint shrink-0">
            {p.songCount}
          </span>
        </button>
      ))}
      <button
        type="button"
        onClick={onClose}
        className="w-full py-2 rounded-lg text-xs tap text-cream-dim"
      >
        取消
      </button>
    </div>
  );
}

export function MusicContextMenuRoot() {
  const navigate = useNavigate();
  const { song, opts, open, hide } = useMenuStore();
  const playNext = useMusicStore((s) => s.playNext);
  const appendToQueue = useMusicStore((s) => s.appendToQueue);
  const isFavorite = useMusicStore((s) => s.isFavorite);
  const toggleFavorite = useMusicStore((s) => s.toggleFavorite);
  const addToPlaylist = useMusicStore((s) => s.addToPlaylist);
  const startDownload = useMusicStore((s) => s.startDownload);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // mode: 'main' 主菜单 / 'pick-playlist' 选歌单
  const modeRef = useRef<"main" | "pick-playlist">("main");

  useEffect(() => {
    if (!open) modeRef.current = "main";
  }, [open]);

  if (!open || !song) return null;
  const isFav = isFavorite(song);
  const desktop = isDesktop();

  const close = () => hide();

  const handlePlayNext = () => {
    playNext(song);
    close();
  };
  const handleAppend = () => {
    appendToQueue(song);
    close();
  };
  const handleToggleFav = async () => {
    await toggleFavorite(song);
  };
  const handlePickList = (playlistId: string) => {
    void addToPlaylist(playlistId, song);
    close();
  };
  const handleCopyName = async () => {
    try {
      await navigator.clipboard.writeText(`${song.name} - ${song.artist ?? ""}`);
    } catch {
      /* ignore */
    }
    close();
  };
  const handleViewAlbum = () => {
    if (!song.albumId) return;
    navigate(`/music/album/${encodeURIComponent(song.source)}/${encodeURIComponent(song.albumId)}`);
    close();
  };
  const handleViewArtist = () => {
    if (!song.artistId) return;
    navigate(`/music/artist/${encodeURIComponent(song.source)}/${encodeURIComponent(song.artistId)}`);
    close();
  };
  const handleDownload = () => {
    void startDownload(song);
    close();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)", animation: "fade-in 160ms ease both" }}
      onClick={close}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-2xl p-4"
        style={{
          background: "var(--ink)",
          border: "1px solid var(--cream-line)",
          animation: "sheet-up 220ms ease both",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
              MUSIC · MENU
            </p>
            <p className="text-sm font-display font-semibold line-clamp-1 text-cream">
              {song.name}
            </p>
            <p className="text-[11px] text-cream-dim line-clamp-1">
              {song.artist || "—"}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="w-8 h-8 flex items-center justify-center tap text-cream-faint"
            aria-label="关闭"
          >
            <IconClose size={14} />
          </button>
        </div>

        {modeRef.current === "main" ? (
          <div className="space-y-1.5">
            <MenuRow
              icon={isFav ? <IconHeartFill size={14} /> : <IconHeart size={14} />}
              label={isFav ? "取消收藏" : "添加到我喜欢的音乐"}
              onClick={handleToggleFav}
            />
            <MenuRow
              icon={<IconPlus size={14} />}
              label="添加到歌单..."
              onClick={() => {
                modeRef.current = "pick-playlist";
                // 触发重渲染：用 hide+show
                hide();
                setTimeout(() => useMenuStore.getState().show(song, opts), 0);
                modeRef.current = "pick-playlist";
              }}
            />
            {!opts.hideQueueActions && (
              <>
                <MenuRow
                  icon={<IconSkipForward size={14} />}
                  label="下一首播放"
                  onClick={handlePlayNext}
                />
                <MenuRow
                  icon={<IconQueue size={14} />}
                  label="添加到队列末尾"
                  onClick={handleAppend}
                />
              </>
            )}
            {!opts.hideViewAlbum && song.albumId && (
              <MenuRow
                icon={<IconAlbum size={14} />}
                label="查看专辑"
                onClick={handleViewAlbum}
              />
            )}
            {!opts.hideViewArtist && song.artistId && (
              <MenuRow
                icon={<IconArtist size={14} />}
                label="查看歌手"
                onClick={handleViewArtist}
              />
            )}
            {desktop && (
              <MenuRow
                icon={<IconDownload size={14} />}
                label="下载到本地"
                onClick={handleDownload}
              />
            )}
            <MenuRow
              label="复制歌名 / 歌手"
              onClick={handleCopyName}
              icon={<span className="font-mono text-[10px] text-cream-faint">CP</span>}
            />
          </div>
        ) : (
          <PlaylistPicker onPick={handlePickList} onClose={close} />
        )}
      </div>
    </div>,
    document.body
  );
}

function MenuRow({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg tap text-left text-cream"
      style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
    >
      <span
        className="w-6 h-6 flex items-center justify-center rounded shrink-0"
        style={{ background: "var(--ink-2)", color: "var(--ember)" }}
      >
        {icon}
      </span>
      <span className="flex-1 text-xs font-display font-semibold">{label}</span>
    </button>
  );
}

export default MusicContextMenuRoot;
