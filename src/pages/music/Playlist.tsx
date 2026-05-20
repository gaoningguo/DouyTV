/**
 * 在线歌单 / 榜单详情 —— 长按菜单 + 心形按钮。
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMusicStore } from "@/stores/music";
import { getPlaylistDetail, getToplistDetail } from "@/lib/music/client";
import type { MusicPlaylistDetail, MusicSource } from "@/lib/music/types";
import { wrapImage } from "@/lib/proxy";
import { MusicHeart } from "@/components/MusicHeart";
import { showMusicMenu } from "@/components/MusicContextMenu";
import {
  IconArrowLeft,
  IconMusic,
  IconPlay,
  IconShuffle,
} from "@/components/Icon";

export default function MusicPlaylist() {
  const navigate = useNavigate();
  const { platform = "wy", id = "" } = useParams<{ platform: string; id: string }>();
  const [sp] = useSearchParams();
  const isToplist = sp.get("toplist") === "1";
  const store = useMusicStore();
  const setRepeatMode = useMusicStore((s) => s.setRepeatMode);

  const [detail, setDetail] = useState<MusicPlaylistDetail | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fn = isToplist ? getToplistDetail : getPlaylistDetail;
      const d = await fn(platform as MusicSource, id);
      setDetail(d);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [platform, id, isToplist]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleShuffle = () => {
    if (!detail?.songs.length) return;
    setRepeatMode("shuffle");
    void store.playQueue(detail.songs, 0);
  };

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
            {isToplist ? "MUSIC · TOPLIST" : "MUSIC · PLAYLIST"}
          </p>
          <h1 className="font-display text-xl font-extrabold tracking-tight line-clamp-1">
            {detail?.name || "歌单"}
          </h1>
        </div>
      </div>

      {error && (
        <p
          className="p-2 rounded text-xs font-mono mb-3"
          style={{
            background: "rgba(255,80,80,0.08)",
            color: "#FF6B6B",
            border: "1px solid rgba(255,80,80,0.25)",
          }}
        >
          {error}
        </p>
      )}

      {loading ? (
        <div className="signal-bars" style={{ height: 22 }}>
          <span></span>
          <span></span>
          <span></span>
        </div>
      ) : detail ? (
        <>
          {detail.songs.length > 0 && (
            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={() => void store.playQueue(detail.songs, 0)}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-display font-semibold tap"
                style={{ background: "var(--ember)", color: "var(--ink)" }}
              >
                <IconPlay size={14} />
                播放全部 ({detail.songs.length})
              </button>
              <button
                type="button"
                onClick={handleShuffle}
                className="px-3 py-2.5 rounded-lg text-sm tap text-cream"
                style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
                aria-label="随机播放"
              >
                <IconShuffle size={14} />
              </button>
            </div>
          )}

          <ul className="space-y-1.5">
            {detail.songs.map((s, i) => (
              <li key={`${s.source}-${s.songId}`}>
                <div
                  className="w-full flex items-center gap-3 p-2 rounded-lg tap text-left"
                  style={{
                    background: "var(--ink-2)",
                    border: "1px solid var(--cream-line)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => void store.playQueue(detail.songs, i)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      showMusicMenu(s);
                    }}
                    className="flex items-center gap-3 flex-1 min-w-0 text-left"
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
                  <MusicHeart song={s} size={14} className="w-8 h-8 flex items-center justify-center" />
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
