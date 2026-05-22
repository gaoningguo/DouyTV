/**
 * 歌手主页 —— 统一 DetailHeader (圆形头像) + SegmentedTab + 列表 / 专辑 grid。
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getArtistDetail, getArtistWorks } from "@/lib/music/api";
import type {
  MusicAlbum,
  MusicArtist,
  MusicSong,
  MusicSource,
} from "@/lib/music/types";
import { wrapImage } from "@/lib/proxy";
import { useMusicStore } from "@/stores/music";
import { showMusicMenu } from "@/components/MusicContextMenu";
import { MusicSegmentedTab } from "@/components/MusicSegmentedTab";
import { MusicListItem } from "@/components/MusicListItem";
import { MusicEmptyState } from "@/components/MusicEmptyState";
import {
  IconArtist as IconArtistI,
  IconMusic,
} from "@/components/Icon";

type Tab = "music" | "album";

function formatDuration(sec?: number) {
  if (!sec || !Number.isFinite(sec)) return undefined;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function MusicArtist() {
  const navigate = useNavigate();
  const { platform = "", id = "" } = useParams<{ platform: string; id: string }>();
  const playQueue = useMusicStore((s) => s.playQueue);

  const [artist, setArtist] = useState<MusicArtist | null>(null);
  const [tab, setTab] = useState<Tab>("music");
  const [songs, setSongs] = useState<MusicSong[]>([]);
  const [albums, setAlbums] = useState<MusicAlbum[]>([]);
  const [page, setPage] = useState(1);
  const [isEnd, setIsEnd] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const a = await getArtistDetail(platform as MusicSource, id);
        if (!cancelled) setArtist(a);
      } catch {
        /* artist detail 可空，不阻塞主体 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [platform, id]);

  const loadWorks = useCallback(
    async (t: Tab, p: number, append: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const r = await getArtistWorks(platform as MusicSource, id, p, t);
        if (t === "music") {
          setSongs((prev) =>
            append ? [...prev, ...(r.list as MusicSong[])] : (r.list as MusicSong[])
          );
        } else {
          setAlbums((prev) =>
            append ? [...prev, ...(r.list as MusicAlbum[])] : (r.list as MusicAlbum[])
          );
        }
        setPage(p);
        setIsEnd(r.isEnd ?? r.list.length === 0);
      } catch (e) {
        setError((e as Error).message ?? String(e));
      } finally {
        setLoading(false);
      }
    },
    [platform, id]
  );

  useEffect(() => {
    setSongs([]);
    setAlbums([]);
    setPage(1);
    setIsEnd(false);
    void loadWorks(tab, 1, false);
  }, [tab, loadWorks]);

  return (
    <div className="min-h-screen bg-ink text-cream p-4">
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

      {/* 歌手 hero —— 圆形头像 + 信息（不用 MusicDetailHeader 因为头像是圆形不是方形封面） */}
      <header
        className="flex items-center gap-4 p-4 mb-3 rounded-xl relative overflow-hidden"
        style={{
          background: "var(--ink-2)",
          border: "1px solid var(--cream-line)",
        }}
      >
        {artist?.avatar && (
          <>
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none"
              style={{
                backgroundImage: `url(${wrapImage(artist.avatar)})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                filter: "blur(40px) saturate(1.2)",
                opacity: 0.18,
              }}
            />
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "linear-gradient(to right, var(--ink-2) 30%, transparent 70%)",
              }}
            />
          </>
        )}
        {artist?.avatar ? (
          <img
            src={wrapImage(artist.avatar)}
            alt=""
            loading="lazy"
            className="w-20 h-20 sm:w-24 sm:h-24 rounded-full object-cover shrink-0 relative z-10"
            style={{ border: "2px solid var(--cream-line)" }}
          />
        ) : (
          <div
            className="w-20 h-20 sm:w-24 sm:h-24 rounded-full flex items-center justify-center bg-ink-3 shrink-0 relative z-10"
            style={{ border: "2px solid var(--cream-line)" }}
          >
            <IconArtistI size={36} className="text-cream-faint" />
          </div>
        )}
        <div className="flex-1 min-w-0 relative z-10">
          <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint mb-1">
            MUSIC · ARTIST
          </p>
          <h1 className="font-display text-lg sm:text-xl font-extrabold tracking-tight line-clamp-1">
            {artist?.name || "歌手"}
          </h1>
          {(artist?.worksNum != null || artist?.albumNum != null) && (
            <p className="font-mono text-[10px] text-cream-dim mt-1">
              {artist?.worksNum != null && `${artist.worksNum} 首作品`}
              {artist?.worksNum != null && artist?.albumNum != null ? "  ·  " : ""}
              {artist?.albumNum != null && `${artist.albumNum} 张专辑`}
            </p>
          )}
          {artist?.description && (
            <p className="text-[11px] text-cream-faint mt-1.5 line-clamp-2 leading-snug">
              {artist.description}
            </p>
          )}
        </div>
      </header>

      <MusicSegmentedTab
        tabs={[
          { id: "music" as const, label: "歌曲", count: songs.length },
          { id: "album" as const, label: "专辑", count: albums.length },
        ]}
        active={tab}
        onChange={setTab}
        columns={2}
      />

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

      {loading && songs.length === 0 && albums.length === 0 ? (
        <div className="signal-bars" style={{ height: 22 }}>
          <span></span>
          <span></span>
          <span></span>
        </div>
      ) : tab === "music" ? (
        songs.length === 0 ? (
          <MusicEmptyState
            icon={<IconMusic size={32} />}
            title="暂无歌曲"
            compact
          />
        ) : (
          <ul className="space-y-1.5">
            {songs.map((s, i) => (
              <li key={`${s.source}-${s.songId}`}>
                <MusicListItem
                  song={s}
                  index={i + 1}
                  duration={formatDuration(s.durationSec)}
                  onClick={() => void playQueue(songs, i)}
                  onMenu={() => showMusicMenu(s, { hideViewArtist: true })}
                />
              </li>
            ))}
          </ul>
        )
      ) : albums.length === 0 ? (
        <MusicEmptyState icon={<IconMusic size={32} />} title="暂无专辑" compact />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {albums.map((a) => (
            <Link
              key={a.id}
              to={`/music/album/${encodeURIComponent(a.source)}/${encodeURIComponent(a.id)}`}
              className="rounded-lg overflow-hidden tap transition-transform hover:-translate-y-0.5"
              style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            >
              {a.cover ? (
                <img
                  src={wrapImage(a.cover)}
                  alt=""
                  loading="lazy"
                  className="w-full aspect-square object-cover"
                />
              ) : (
                <div className="w-full aspect-square flex items-center justify-center bg-ink-3">
                  <IconMusic size={32} className="text-cream-faint" />
                </div>
              )}
              <div className="p-2">
                <p className="text-xs font-display font-semibold line-clamp-2">{a.name}</p>
                {a.publishDate && (
                  <p className="text-[10px] font-mono text-cream-faint mt-0.5">
                    {a.publishDate}
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {!isEnd && !loading && (songs.length > 0 || albums.length > 0) && (
        <button
          type="button"
          onClick={() => void loadWorks(tab, page + 1, true)}
          className="mt-4 w-full py-2 rounded-lg text-xs tap text-cream"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
        >
          加载更多
        </button>
      )}
    </div>
  );
}
