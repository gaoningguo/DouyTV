import { useEffect, useMemo, useState } from "react";
import {
  IconAlbum,
  IconArtist,
  IconClose,
  IconPlay,
} from "@/components/Icon";
import {
  searchNeteasePlaylists,
  type MusicSong,
  type MusicSongListSummary,
  type MusicSourceDescriptor,
} from "@/lib/music";
import { wrapImage } from "@/lib/proxy";
import { mostCommonArtist } from "../utils";
import { EmptyBlock, FilterChip } from "../components/ui";
import { SongList } from "../components/SongList";

export function SearchView({
  keyword,
  activeSourceId,
  sources,
  searching,
  results,
  hasMore,
  page,
  currentSong,
  isFavorite,
  onActiveSource,
  onLoadMore,
  onPlay,
  onFavorite,
  onQueue,
  onAddToPlaylist,
  onOpenAlbum,
  onOpenArtist,
  onClose,
  extrasSource,
  onOpenPlaylist,
}: {
  keyword: string;
  activeSourceId: string;
  sources: MusicSourceDescriptor[];
  searching: boolean;
  results: MusicSong[];
  hasMore: boolean;
  page: number;
  currentSong: MusicSong | null;
  isFavorite: (song: MusicSong) => boolean;
  onActiveSource: (id: string) => void;
  onLoadMore: () => void;
  onPlay: (song: MusicSong) => void;
  onFavorite: (song: MusicSong) => void;
  onQueue: (song: MusicSong) => void;
  onAddToPlaylist: (song: MusicSong) => void;
  onOpenAlbum: (album: string, artist?: string) => void;
  onOpenArtist: (artist: string) => void;
  onClose: () => void;
  extrasSource: MusicSourceDescriptor | null;
  onOpenPlaylist: (summary: MusicSongListSummary) => void;
}) {
  type CategoryType = "all" | "songs" | "artists" | "albums" | "playlists";
  const [category, setCategory] = useState<CategoryType>("all");
  const [playlists, setPlaylists] = useState<MusicSongListSummary[]>([]);
  const trimmed = keyword.trim();
  const hasResults = results.length > 0;

  // 网易歌单搜索（仅外部自部署网易源可用；其它源静默无结果）。
  useEffect(() => {
    if (!extrasSource || !trimmed) {
      setPlaylists([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const list = await searchNeteasePlaylists(extrasSource, trimmed, 18);
      if (!cancelled) setPlaylists(list);
    })();
    return () => {
      cancelled = true;
    };
  }, [trimmed, extrasSource]);

  const topSong = results[0];
  const topArtist = useMemo(() => mostCommonArtist(results), [results]);

  const artists = useMemo(() => {
    const map = new Map<string, { name: string; cover?: string; count: number; song: MusicSong }>();
    results.forEach((song) => {
      const name = (song.artist || "").split(/[/、,，&]| feat\.? | ft\.? /i)[0].trim();
      if (!name) return;
      const entry = map.get(name);
      if (entry) {
        entry.count += 1;
        if (!entry.cover && song.cover) entry.cover = song.cover;
      } else {
        map.set(name, { name, cover: song.cover, count: 1, song });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [results]);

  const albums = useMemo(() => {
    const map = new Map<string, { name: string; cover?: string; artist?: string; count: number; song: MusicSong }>();
    results.forEach((song) => {
      const name = (song.album || "").trim();
      if (!name) return;
      const entry = map.get(name);
      if (entry) {
        entry.count += 1;
        if (!entry.cover && song.cover) entry.cover = song.cover;
      } else {
        map.set(name, { name, cover: song.cover, artist: song.artist, count: 1, song });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [results]);

  const showSongs = category === "all" || category === "songs";
  const showArtists = (category === "all" || category === "artists") && artists.length > 0;
  const showAlbums = (category === "all" || category === "albums") && albums.length > 0;
  const showPlaylists = (category === "all" || category === "playlists") && playlists.length > 0;
  const songList = category === "songs" ? results : results.slice(0, 8);

  const CATEGORIES: Array<{ id: CategoryType; label: string }> = [
    { id: "all", label: "全部" },
    { id: "songs", label: "歌曲" },
    { id: "artists", label: "艺人" },
    { id: "albums", label: "专辑" },
    ...(playlists.length > 0
      ? [{ id: "playlists" as CategoryType, label: "歌单" }]
      : []),
  ];

  return (
    <div className="music-ob-search space-y-8 pb-4">
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-extrabold sm:text-3xl">
            搜索结果：<span className="text-ember">"{trimmed}"</span>
          </h1>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-lg grid place-items-center tap text-cream-dim hover:text-cream"
            title="关闭搜索"
          >
            <IconClose size={18} />
          </button>
        </div>

        {hasResults && (
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
            {CATEGORIES.map((item) => (
              <FilterChip
                key={item.id}
                active={category === item.id}
                onClick={() => setCategory(item.id)}
              >
                {item.label}
              </FilterChip>
            ))}
          </div>
        )}

        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
          <FilterChip active={activeSourceId === "all"} onClick={() => onActiveSource("all")}>
            全部源
          </FilterChip>
          {sources.map((source) => (
            <FilterChip
              key={source.id}
              active={activeSourceId === source.id}
              onClick={() => onActiveSource(source.id)}
            >
              {source.enabled ? source.name : `停用 / ${source.name}`}
            </FilterChip>
          ))}
        </div>
      </section>

      {searching && !hasResults && (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-16 rounded-lg skeleton-shimmer" />
          ))}
        </div>
      )}

      {!searching && !hasResults && (
        <EmptyBlock text="没有搜索结果，试试其他关键词" />
      )}

      {hasResults && (
        <div className="grid grid-cols-12 gap-6">
          {/* 最佳匹配 */}
          {(category === "all" || category === "artists") && topSong && (
            <div className="col-span-12 lg:col-span-5">
              <h2 className="mb-4 font-display text-lg font-bold">最佳匹配</h2>
              <button
                type="button"
                onClick={() => onOpenArtist(topArtist || topSong.artist)}
                className="music-ob-bestmatch group w-full text-left"
              >
                <div className="music-ob-bestmatch-cover">
                  {topSong.cover ? (
                    <img
                      src={wrapImage(topSong.cover)}
                      alt=""
                      className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
                    />
                  ) : (
                    <span className="grid h-full w-full place-items-center bg-ink-3 text-cream-faint">
                      <IconArtist size={48} />
                    </span>
                  )}
                  <span className="music-ob-bestmatch-play">
                    <IconPlay size={28} />
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-ember">
                    艺人
                  </span>
                  <h3 className="mt-1 line-clamp-2 font-display text-xl font-extrabold text-cream sm:text-2xl">
                    {topArtist || topSong.artist || topSong.title}
                  </h3>
                  <p className="mt-1 text-sm text-cream-dim">
                    {artists[0] ? `${artists[0].count} 首相关歌曲` : topSong.sourceName}
                  </p>
                </div>
              </button>
            </div>
          )}

          {/* 歌曲 */}
          {showSongs && (
            <div
              className={
                category === "all"
                  ? "col-span-12 lg:col-span-7"
                  : "col-span-12"
              }
            >
              <div className="mb-5 flex items-end justify-between">
                <h2 className="font-display text-lg font-bold">歌曲</h2>
                {category === "all" && results.length > songList.length && (
                  <button
                    type="button"
                    onClick={() => setCategory("songs")}
                    className="text-xs text-ember hover:underline underline-offset-4"
                  >
                    查看全部
                  </button>
                )}
              </div>
              <SongList
                songs={songList}
                activeSong={currentSong}
                emptyText="没有歌曲"
                isFavorite={isFavorite}
                onPlay={onPlay}
                onFavorite={onFavorite}
                onQueue={onQueue}
                onAddToPlaylist={onAddToPlaylist}
              />
            </div>
          )}

          {/* 艺人 */}
          {showArtists && (
            <div className="col-span-12">
              <h2 className="mb-5 font-display text-lg font-bold">艺人</h2>
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {artists.slice(0, category === "artists" ? 24 : 6).map((artist) => (
                  <button
                    key={artist.name}
                    type="button"
                    onClick={() => onOpenArtist(artist.name)}
                    className="group text-center"
                  >
                    <div className="music-ob-artist-cover">
                      {artist.cover ? (
                        <img
                          src={wrapImage(artist.cover)}
                          alt=""
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                        />
                      ) : (
                        <span className="grid h-full w-full place-items-center bg-ink-3 text-cream-faint">
                          <IconArtist size={32} />
                        </span>
                      )}
                    </div>
                    <h3 className="mt-3 line-clamp-1 font-display text-sm font-bold text-cream transition-colors group-hover:text-ember">
                      {artist.name}
                    </h3>
                    <p className="text-xs text-cream-faint">{artist.count} 首</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 专辑 */}
          {showAlbums && (
            <div className="col-span-12">
              <h2 className="mb-5 font-display text-lg font-bold">专辑</h2>
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {albums.slice(0, category === "albums" ? 24 : 6).map((album) => (
                  <button
                    key={album.name}
                    type="button"
                    onClick={() => onOpenAlbum(album.name, album.artist)}
                    className="group text-left"
                  >
                    <div className="music-ob-album-cover">
                      {album.cover ? (
                        <img
                          src={wrapImage(album.cover)}
                          alt=""
                          className="h-full w-full rounded-lg object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                      ) : (
                        <span className="grid h-full w-full place-items-center rounded-lg bg-ink-3 text-cream-faint">
                          <IconAlbum size={32} />
                        </span>
                      )}
                      <span className="music-ob-album-play">
                        <IconPlay size={20} />
                      </span>
                    </div>
                    <h3 className="mt-3 line-clamp-1 font-display text-sm font-semibold text-cream transition-colors group-hover:text-ember">
                      {album.name}
                    </h3>
                    <p className="line-clamp-1 text-xs text-cream-faint">{album.artist || "专辑"}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 歌单（网易外部源） */}
          {showPlaylists && (
            <div className="col-span-12">
              <h2 className="mb-5 font-display text-lg font-bold">歌单</h2>
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {playlists.slice(0, category === "playlists" ? 24 : 6).map((pl) => (
                  <button
                    key={pl.id}
                    type="button"
                    onClick={() => onOpenPlaylist(pl)}
                    className="group text-left"
                    title={pl.name}
                  >
                    <div className="music-ob-album-cover">
                      {pl.pic ? (
                        <img
                          src={wrapImage(pl.pic)}
                          alt=""
                          className="h-full w-full rounded-lg object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                      ) : (
                        <span className="grid h-full w-full place-items-center rounded-lg bg-ink-3 text-cream-faint">
                          <IconAlbum size={32} />
                        </span>
                      )}
                      <span className="music-ob-album-play">
                        <IconPlay size={20} />
                      </span>
                    </div>
                    <h3 className="mt-3 line-clamp-1 font-display text-sm font-semibold text-cream transition-colors group-hover:text-ember">
                      {pl.name}
                    </h3>
                    <p className="line-clamp-1 text-xs text-cream-faint">
                      {pl.author || "歌单"}
                      {pl.total ? ` · ${pl.total}首` : ""}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {hasResults && hasMore && (category === "all" || category === "songs") && (
        <div className="flex justify-center py-3">
          <button
            type="button"
            onClick={onLoadMore}
            className="h-9 px-4 rounded-lg text-xs tap"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          >
            加载更多，第 {page + 1} 页
          </button>
        </div>
      )}
    </div>
  );
}
