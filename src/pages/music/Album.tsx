/**
 * 专辑详情 —— 统一头部 + PlayAllBar + 统一列表。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getAlbumDetail } from "@/lib/music/api";
import type { MusicAlbumDetail, MusicSource } from "@/lib/music/types";
import { useMusicStore } from "@/stores/music";
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

export default function MusicAlbum() {
  const navigate = useNavigate();
  const { platform = "", id = "" } = useParams<{ platform: string; id: string }>();
  const playQueue = useMusicStore((s) => s.playQueue);
  const setRepeatMode = useMusicStore((s) => s.setRepeatMode);
  const [detail, setDetail] = useState<MusicAlbumDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await getAlbumDetail(platform as MusicSource, id);
      setDetail(d);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [platform, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleShuffle = () => {
    if (!detail?.songs.length) return;
    setRepeatMode("shuffle");
    void playQueue(detail.songs, 0);
  };

  const meta = useMemo(() => {
    if (!detail) return [];
    return [
      detail.artist,
      `${detail.songs.length} 首`,
      detail.publishDate ? `发行 ${detail.publishDate}` : undefined,
    ];
  }, [detail]);

  return (
    <div className="min-h-screen bg-ink text-cream p-4 pb-24">
      <div className="flex items-center mb-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="font-mono text-[10px] tracking-[0.2em] text-cream-faint tap"
          aria-label="返回"
        >
          ← 返回
        </button>
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
          <MusicDetailHeader
            eyebrow="MUSIC · ALBUM"
            title={detail.name || "专辑"}
            cover={detail.cover}
            meta={meta}
            description={detail.description}
            footerSlot={
              detail.artistId && detail.artist ? (
                <Link
                  to={`/music/artist/${encodeURIComponent(platform)}/${encodeURIComponent(detail.artistId)}`}
                  className="text-[11px] text-ember font-mono mt-1.5 self-start"
                >
                  查看歌手 {detail.artist} →
                </Link>
              ) : undefined
            }
          />

          {detail.songs.length > 0 && (
            <MusicPlayAllBar
              count={detail.songs.length}
              onPlayAll={() => void playQueue(detail.songs, 0)}
              onShuffle={handleShuffle}
            />
          )}

          {detail.songs.length === 0 ? (
            <p className="text-center text-xs text-cream-faint font-mono py-12">
              暂无曲目
            </p>
          ) : (
            <ul className="space-y-1.5">
              {detail.songs.map((s, i) => (
                <li key={`${s.source}-${s.songId}`}>
                  <MusicListItem
                    song={s}
                    index={i + 1}
                    duration={formatDuration(s.durationSec)}
                    onClick={() => void playQueue(detail.songs, i)}
                    onMenu={() => showMusicMenu(s, { hideViewAlbum: true })}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </div>
  );
}
