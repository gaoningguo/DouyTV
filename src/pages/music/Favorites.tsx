/**
 * 我喜欢的音乐 —— 完整收藏列表，统一头部 + PlayAllBar + 列表行。
 */
import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useMusicStore } from "@/stores/music";
import { IconHeart } from "@/components/Icon";
import { MusicDetailHeader } from "@/components/MusicDetailHeader";
import { MusicPlayAllBar } from "@/components/MusicPlayAllBar";
import { MusicListItem } from "@/components/MusicListItem";
import { showMusicMenu } from "@/components/MusicContextMenu";

function formatDuration(sec?: number) {
  if (!sec || !Number.isFinite(sec)) return undefined;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function MusicFavorites() {
  const navigate = useNavigate();
  const hydrate = useMusicStore((s) => s.hydrate);
  const favorites = useMusicStore((s) => s.favorites);
  const playQueue = useMusicStore((s) => s.playQueue);
  const setRepeatMode = useMusicStore((s) => s.setRepeatMode);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const sortedFavs = useMemo(
    () => [...favorites].sort((a, b) => (b.favoritedAt ?? 0) - (a.favoritedAt ?? 0)),
    [favorites]
  );

  const handleShuffle = () => {
    if (sortedFavs.length === 0) return;
    setRepeatMode("shuffle");
    void playQueue(sortedFavs, 0);
  };

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
        eyebrow="MUSIC · FAVORITES"
        title="我喜欢的音乐"
        meta={[`${sortedFavs.length} 首`]}
      />

      {sortedFavs.length === 0 ? (
        <div
          className="rounded-xl p-6 text-center"
          style={{ background: "var(--ink-2)", border: "1px dashed var(--cream-line)" }}
        >
          <IconHeart size={32} className="text-cream-faint mx-auto mb-2" />
          <p className="text-sm text-cream-dim mb-1">还没有收藏的歌曲</p>
          <p className="text-[11px] text-cream-faint">
            在搜索 / 榜单 / 歌单中点心形按钮即可收藏
          </p>
        </div>
      ) : (
        <>
          <MusicPlayAllBar
            count={sortedFavs.length}
            onPlayAll={() => void playQueue(sortedFavs, 0)}
            onShuffle={handleShuffle}
          />
          <ul className="space-y-1.5">
            {sortedFavs.map((s, i) => (
              <li key={`${s.source}-${s.songId}`}>
                <MusicListItem
                  song={s}
                  index={i + 1}
                  duration={formatDuration(s.durationSec)}
                  onClick={() => void playQueue(sortedFavs, i)}
                  onMenu={() => showMusicMenu(s)}
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
