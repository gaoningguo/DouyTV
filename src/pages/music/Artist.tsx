/**
 * 歌手主页 — 顶部信息 + tab 切换（歌曲 / 专辑）+ 分页加载。
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
import {
  IconArrowLeft,
  IconArtist as IconArtistI,
  IconMusic,
} from "@/components/Icon";

type Tab = "music" | "album";

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

  // 顶部信息只拉一次
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
            MUSIC · ARTIST
          </p>
          <h1 className="font-display text-xl font-extrabold tracking-tight line-clamp-1">
            {artist?.name || "歌手"}
          </h1>
        </div>
      </div>

      {artist && (
        <div className="flex gap-4 mb-5">
          {artist.avatar ? (
            <img
              src={wrapImage(artist.avatar)}
              alt=""
              loading="lazy"
              className="w-20 h-20 rounded-full object-cover shrink-0"
            />
          ) : (
            <div className="w-20 h-20 rounded-full flex items-center justify-center bg-ink-2 shrink-0">
              <IconArtistI size={32} className="text-cream-faint" />
            </div>
          )}
          <div className="flex-1 min-w-0 flex flex-col justify-center">
            <p className="text-base font-display font-extrabold line-clamp-1">
              {artist.name}
            </p>
            <p className="text-[10px] font-mono text-cream-faint mt-0.5">
              {artist.worksNum != null && `${artist.worksNum} 首作品 · `}
              {artist.albumNum != null && `${artist.albumNum} 张专辑`}
            </p>
            {artist.description && (
              <p className="text-[11px] text-cream-faint mt-1 line-clamp-2">
                {artist.description}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-1 mb-4">
        {(["music", "album"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className="py-2 rounded-md text-[11px] font-display font-semibold tap"
            style={{
              background: tab === t ? "var(--ember)" : "var(--ink-3)",
              color: tab === t ? "var(--ink)" : "var(--cream-dim)",
              border: "1px solid var(--cream-line)",
            }}
          >
            {t === "music" ? "歌曲" : "专辑"}
          </button>
        ))}
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

      {loading && songs.length === 0 && albums.length === 0 ? (
        <div className="signal-bars" style={{ height: 22 }}>
          <span></span>
          <span></span>
          <span></span>
        </div>
      ) : tab === "music" ? (
        <ul className="space-y-1.5">
          {songs.map((s, i) => (
            <li key={`${s.source}-${s.songId}`}>
              <button
                type="button"
                onClick={() => void playQueue(songs, i)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  showMusicMenu(s, { hideViewArtist: true });
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
                    <IconMusic size={14} className="text-cream-faint" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-display font-semibold line-clamp-1">
                    {s.name}
                  </p>
                  <p className="text-[10px] font-mono text-cream-faint line-clamp-1">
                    {s.album || "—"}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {albums.map((a) => (
            <Link
              key={a.id}
              to={`/music/album/${encodeURIComponent(a.source)}/${encodeURIComponent(a.id)}`}
              className="rounded-lg overflow-hidden tap"
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
