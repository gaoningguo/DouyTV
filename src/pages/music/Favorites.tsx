/**
 * 我喜欢的音乐 —— 完整收藏列表。
 */
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMusicStore } from "@/stores/music";
import { wrapImage } from "@/lib/proxy";
import { IconArrowLeft, IconHeart, IconMusic, IconPlay } from "@/components/Icon";
import { showMusicMenu } from "@/components/MusicContextMenu";

export default function MusicFavorites() {
  const navigate = useNavigate();
  const hydrate = useMusicStore((s) => s.hydrate);
  const favorites = useMusicStore((s) => s.favorites);
  const playQueue = useMusicStore((s) => s.playQueue);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <div className="min-h-screen bg-ink text-cream p-4 pb-24">
      <div className="flex items-center gap-3 mb-5">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          aria-label="返回"
        >
          <IconArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
            MUSIC · FAVORITES
          </p>
          <h1 className="font-display text-xl font-extrabold tracking-tight">
            我喜欢的音乐
          </h1>
        </div>
      </div>

      {favorites.length === 0 ? (
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
          <button
            type="button"
            onClick={() => void playQueue(favorites, 0)}
            className="w-full mb-4 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-display font-semibold tap"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            <IconPlay size={14} />
            播放全部 ({favorites.length})
          </button>
          <ul className="space-y-1.5">
            {favorites.map((s, i) => (
              <li key={`${s.source}-${s.songId}`}>
                <button
                  type="button"
                  onClick={() => void playQueue(favorites, i)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    showMusicMenu(s);
                  }}
                  className="w-full flex items-center gap-3 p-2 rounded-lg tap text-left"
                  style={{
                    background: "var(--ink-2)",
                    border: "1px solid var(--cream-line)",
                  }}
                >
                  <span className="w-6 text-center font-mono text-[10px] text-cream-faint shrink-0">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {s.cover ? (
                    <img
                      src={wrapImage(s.cover)}
                      alt=""
                      loading="lazy"
                      className="w-10 h-10 rounded shrink-0 object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded shrink-0 flex items-center justify-center bg-ink-3">
                      <IconMusic size={16} className="text-cream-faint" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-display font-semibold line-clamp-1">
                      {s.name}
                    </p>
                    <p className="text-[10px] font-mono text-cream-faint line-clamp-1">
                      {s.artist || "—"}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
