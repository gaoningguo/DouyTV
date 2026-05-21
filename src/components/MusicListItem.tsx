/**
 * 通用歌曲行 —— Playlist / Favorites / Album / UserPlaylist / History / Search 结果统一复用。
 *
 * 设计：[序号] [封面] [标题/歌手] [时长] [♡] [⋯ optional]
 *
 * - 当前播放项左侧 ember 竖条 + 文字 ember 色高亮
 * - 点击 → onClick (play this)
 * - 长按 / 右键 → onMenu
 * - 移动端长按 300ms 触发 menu，桌面端右键直接触发
 */
import { useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { wrapImage } from "@/lib/proxy";
import { useMusicStore } from "@/stores/music";
import { MusicHeart } from "@/components/MusicHeart";
import { IconMusic } from "@/components/Icon";
import type { MusicSong } from "@/lib/music/types";

interface Props {
  song: MusicSong;
  /** 1-based 序号，未传不渲染 */
  index?: number;
  /** "3:45" 文本，未传不渲染 */
  duration?: string;
  onClick?: () => void;
  /** 长按 / 右键菜单触发 */
  onMenu?: () => void;
  /** 强制 active（已播放高亮），未传则按 store.current 自动判断 */
  active?: boolean;
  /** 隐藏心形按钮 */
  hideHeart?: boolean;
  /** 右侧额外节点（例如 "已下载" 徽章、播放次数） */
  trailing?: ReactNode;
}

export function MusicListItem({
  song,
  index,
  duration,
  onClick,
  onMenu,
  active,
  hideHeart,
  trailing,
}: Props) {
  const currentKey = useMusicStore(
    (s) => (s.current ? `${s.current.source}-${s.current.songId}` : null)
  );
  const myKey = `${song.source}-${song.songId}`;
  const isActive = active ?? currentKey === myKey;

  const longPressTimer = useRef<number | null>(null);
  const [pressOrigin, setPressOrigin] = useState<{ x: number; y: number } | null>(null);

  const clearLongPress = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!onMenu || e.pointerType === "mouse") return;
    setPressOrigin({ x: e.clientX, y: e.clientY });
    clearLongPress();
    longPressTimer.current = window.setTimeout(() => {
      onMenu();
      setPressOrigin(null);
    }, 380);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pressOrigin) return;
    const dx = Math.abs(e.clientX - pressOrigin.x);
    const dy = Math.abs(e.clientY - pressOrigin.y);
    if (dx > 8 || dy > 8) clearLongPress();
  };

  const handlePointerUp = () => clearLongPress();
  const handlePointerCancel = () => clearLongPress();

  const handleContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    if (!onMenu) return;
    e.preventDefault();
    onMenu();
  };

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onContextMenu={handleContextMenu}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      className="relative w-full flex items-center gap-3 p-2 rounded-lg tap text-left select-none cursor-pointer"
      style={{
        background: isActive
          ? "color-mix(in srgb, var(--ember) 10%, var(--ink-2))"
          : "var(--ink-2)",
        border: `1px solid ${isActive ? "color-mix(in srgb, var(--ember) 45%, var(--cream-line))" : "var(--cream-line)"}`,
      }}
    >
      {/* 当前播放项左侧 ember 竖条 */}
      {isActive && (
        <span
          aria-hidden
          className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r"
          style={{ background: "var(--ember)" }}
        />
      )}

      {index != null && (
        <span
          className="w-6 text-center font-mono text-[10px] shrink-0"
          style={{ color: isActive ? "var(--ember)" : "var(--cream-faint)" }}
        >
          {String(index).padStart(2, "0")}
        </span>
      )}

      {song.cover ? (
        <img
          src={wrapImage(song.cover)}
          alt=""
          loading="lazy"
          className="w-10 h-10 rounded shrink-0 object-cover"
        />
      ) : (
        <div className="w-10 h-10 rounded shrink-0 flex items-center justify-center bg-ink-3">
          <IconMusic size={14} className="text-cream-faint" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <p
          className="text-xs font-display font-semibold line-clamp-1"
          style={{ color: isActive ? "var(--ember)" : "var(--cream)" }}
        >
          {song.name || "未命名"}
        </p>
        <p className="text-[10px] font-mono text-cream-faint line-clamp-1">
          {song.artist || "—"}
          {song.album ? `  ·  ${song.album}` : ""}
        </p>
      </div>

      {duration && (
        <span className="font-mono text-[10px] text-cream-faint shrink-0">
          {duration}
        </span>
      )}

      {trailing}

      {!hideHeart && (
        <MusicHeart
          song={song}
          size={14}
          className="w-8 h-8 flex items-center justify-center"
        />
      )}
    </div>
  );
}

export default MusicListItem;
