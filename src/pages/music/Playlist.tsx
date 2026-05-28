/**
 * 在线歌单 / 榜单详情 —— 三段头部 + 播放全部条 + 统一列表行。
 *
 * 参考 lx-music `songList/Detail` 头部布局 (cover 左 / 描述中 / 操作右)
 * 与 MusicFree `sheetDetail/components/header` + `PlayAllBar` 模式。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMusicStore } from "@/stores/music";
import { getPlaylistDetail, getToplistDetail } from "@/lib/music/client";
import type { MusicPlaylistDetail, MusicSource } from "@/lib/music/types";
import { MusicDetailHeader } from "@/components/MusicDetailHeader";
import { MusicPlayAllBar } from "@/components/MusicPlayAllBar";
import { MusicListItem } from "@/components/MusicListItem";
import { showMusicMenu } from "@/components/MusicContextMenu";

function formatDuration(sec?: number): string | undefined {
  if (!sec || !Number.isFinite(sec)) return undefined;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatPlayCount(n?: number): string | undefined {
  if (n == null) return undefined;
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿播放`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万播放`;
  return `${n}播放`;
}

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

  const meta = useMemo(() => {
    if (!detail) return [];
    return [
      detail.creator,
      `${detail.songs.length} 首`,
      formatPlayCount(detail.playCount),
    ];
  }, [detail]);

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
            eyebrow={isToplist ? "MUSIC · TOPLIST" : "MUSIC · PLAYLIST"}
            title={detail.name || "歌单"}
            cover={detail.cover}
            meta={meta}
            description={detail.description}
          />

          <MusicPlayAllBar
            count={detail.songs.length}
            onPlayAll={() => void store.playQueue(detail.songs, 0)}
            onShuffle={handleShuffle}
          />

          {detail.songs.length === 0 ? (
            <p className="text-center text-xs text-cream-faint font-mono py-12">
              这个歌单是空的
            </p>
          ) : (
            <ul className="space-y-1.5">
              {detail.songs.map((s, i) => (
                <li key={`${s.source}-${s.songId}`}>
                  <MusicListItem
                    song={s}
                    index={i + 1}
                    duration={formatDuration(s.durationSec)}
                    onClick={() => void store.playQueue(detail.songs, i)}
                    onMenu={() => showMusicMenu(s)}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
      </div>
    </div>
  );
}
