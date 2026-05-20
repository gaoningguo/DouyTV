/**
 * 专辑详情 — 头部专辑封面 / 信息，列表 + 长按菜单。
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getAlbumDetail } from "@/lib/music/api";
import type { MusicAlbumDetail, MusicSource } from "@/lib/music/types";
import { wrapImage } from "@/lib/proxy";
import { useMusicStore } from "@/stores/music";
import { showMusicMenu } from "@/components/MusicContextMenu";
import { IconArrowLeft, IconMusic, IconPlay } from "@/components/Icon";

export default function MusicAlbum() {
  const navigate = useNavigate();
  const { platform = "", id = "" } = useParams<{ platform: string; id: string }>();
  const playQueue = useMusicStore((s) => s.playQueue);
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
            MUSIC · ALBUM
          </p>
          <h1 className="font-display text-xl font-extrabold tracking-tight line-clamp-1">
            {detail?.name || "专辑"}
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
          <div className="flex gap-4 mb-5">
            {detail.cover ? (
              <img
                src={wrapImage(detail.cover)}
                alt=""
                loading="lazy"
                className="w-28 h-28 rounded-lg object-cover shrink-0 scanlines"
              />
            ) : (
              <div className="w-28 h-28 rounded-lg flex items-center justify-center bg-ink-2 shrink-0">
                <IconMusic size={40} className="text-cream-faint" />
              </div>
            )}
            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <p className="text-sm font-display font-extrabold line-clamp-2">
                {detail.name}
              </p>
              {detail.artistId && detail.artist ? (
                <Link
                  to={`/music/artist/${encodeURIComponent(platform)}/${encodeURIComponent(detail.artistId)}`}
                  className="text-[11px] text-ember font-mono mt-1"
                >
                  {detail.artist} →
                </Link>
              ) : (
                detail.artist && (
                  <p className="text-[11px] text-cream-dim mt-1">{detail.artist}</p>
                )
              )}
              {detail.publishDate && (
                <p className="text-[10px] font-mono text-cream-faint mt-1">
                  发行 · {detail.publishDate}
                </p>
              )}
              {detail.description && (
                <p className="text-[10px] text-cream-faint mt-1 line-clamp-2">
                  {detail.description}
                </p>
              )}
            </div>
          </div>

          {detail.songs.length > 0 && (
            <button
              type="button"
              onClick={() => void playQueue(detail.songs, 0)}
              className="w-full mb-4 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-display font-semibold tap"
              style={{ background: "var(--ember)", color: "var(--ink)" }}
            >
              <IconPlay size={14} />
              播放全部 ({detail.songs.length})
            </button>
          )}

          <ul className="space-y-1.5">
            {detail.songs.map((s, i) => (
              <li key={`${s.source}-${s.songId}`}>
                <button
                  type="button"
                  onClick={() => void playQueue(detail.songs, i)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    showMusicMenu(s, { hideViewAlbum: true });
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
      ) : null}
    </div>
  );
}
