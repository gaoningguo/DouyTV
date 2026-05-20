/**
 * 收藏切换按钮 — 复用在 MiniPlayer / Player / Search row / Album / Artist。
 *
 * 用法：<MusicHeart song={song} size={16} />
 */
import type { MouseEvent, PointerEvent } from "react";
import { useMusicStore } from "@/stores/music";
import type { MusicSong } from "@/lib/music/types";
import { IconHeart, IconHeartFill } from "@/components/Icon";

interface Props {
  song: MusicSong;
  size?: number;
  className?: string;
}

export function MusicHeart({ song, size = 14, className }: Props) {
  const isFav = useMusicStore((s) => s.isFavorite(song));
  const toggleFavorite = useMusicStore((s) => s.toggleFavorite);
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    void toggleFavorite(song);
  };
  // 拦截 framer-motion drag 捕获（VideoFeed 用过这种模式）
  const handleDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      onPointerDownCapture={handleDown}
      className={`tap ${className ?? ""}`}
      style={{ color: isFav ? "var(--ember)" : "var(--cream-dim)" }}
      aria-label={isFav ? "取消收藏" : "收藏"}
    >
      {isFav ? <IconHeartFill size={size} /> : <IconHeart size={size} />}
    </button>
  );
}

export default MusicHeart;
