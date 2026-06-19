import { useState } from "react";
import { IconAlbum, IconArtist, IconFilm } from "@/components/Icon";
import { musicSongKey, type MusicSong, type MusicSongListSummary } from "@/lib/music";
import { SongList } from "../components/SongList";
import { VideoCard } from "../components/VinylHero";
import { aggregateMusicLabel, aggregatePlaylistMeta } from "../utils";
import { PageHeader, PlaceholderState } from "./shared";

/** 最近播放页 —— 借鉴 Tabos FreeMusicRecent：历史列表。 */
export function RecentView({
  history,
  currentSong,
  isPlaying,
  isFavorite,
  onPlay,
  onFavorite,
  onQueue,
  onAddToPlaylist,
  onClear,
}: {
  history: MusicSong[];
  currentSong: MusicSong | null;
  isPlaying: boolean;
  isFavorite: (song: MusicSong) => boolean;
  onPlay: (song: MusicSong, songs: MusicSong[]) => void;
  onFavorite: (song: MusicSong) => void;
  onQueue: (song: MusicSong) => void;
  onAddToPlaylist: (song: MusicSong) => void;
  onClear: () => void;
}) {
  return (
    <div className="music-page-wrap space-y-6">
      <PageHeader
        title="最近播放"
        subtitle={`共 ${history.length} 首`}
        action={
          history.length > 0 ? (
            <button
              type="button"
              onClick={onClear}
              className="music-ob-ghost-btn !h-9 !px-4 !text-xs"
            >
              清空记录
            </button>
          ) : undefined
        }
      />
      <SongList
        songs={history}
        activeSong={currentSong}
        activePlaying={isPlaying}
        emptyText="还没有播放记录"
        isFavorite={isFavorite}
        onPlay={(song) => onPlay(song, history)}
        onFavorite={onFavorite}
        onQueue={onQueue}
        onAddToPlaylist={onAddToPlaylist}
      />
    </div>
  );
}

/** MV 广场 —— LX 无 MV 数据，用歌单封面占位为 16:9 视频卡（点击进歌单）。 */
export function MvView({
  songlists,
  onOpenSonglist,
}: {
  songlists: MusicSongListSummary[];
  onOpenSonglist: (item: MusicSongListSummary) => void;
}) {
  const cards = songlists.slice(0, 24);
  return (
    <div className="music-page-wrap space-y-6">
      <PageHeader title="MV 广场" subtitle="官方 MV、现场、翻唱与舞蹈视频" />
      {cards.length === 0 ? (
        <PlaceholderState
          icon={<IconFilm size={40} />}
          title="MV 广场即将到来"
          desc="后端接入 MV 数据源后，这里将展示官方 MV、现场、翻唱与舞蹈视频。"
        />
      ) : (
        <div className="music-mv-grid">
          {cards.map((item) => (
            <VideoCard
              key={`${item.source}:${item.id}`}
              cover={item.pic}
              title={aggregateMusicLabel(item.name, "推荐歌单")}
              subtitle={aggregatePlaylistMeta(item)}
              onClick={() => onOpenSonglist(item)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const ARTIST_CATEGORIES = ["全部", "华语", "欧美", "日本", "韩国", "其他"];
const ARTIST_PREFIXES = [
  "热门", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
  "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "#",
];

/** 歌手页 —— 借鉴 Tabos：分类 + 首字母筛选 + 头像网格（LX 无歌手榜，占位交互）。 */
export function ArtistsView({
  artists,
  onOpenArtist,
}: {
  artists: Array<{ name: string; cover?: string }>;
  onOpenArtist: (name: string) => void;
}) {
  const [category, setCategory] = useState("全部");
  const [prefix, setPrefix] = useState("热门");
  return (
    <div className="music-page-wrap space-y-5">
      <PageHeader title="歌手" subtitle="按分类与首字母浏览" />
      <div className="music-artist-filter-row">
        {ARTIST_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className="music-af-btn"
            data-active={category === c || undefined}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="music-artist-prefix-row">
        {ARTIST_PREFIXES.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPrefix(p)}
            className="music-af-btn music-af-btn-sm"
            data-active={prefix === p || undefined}
          >
            {p}
          </button>
        ))}
      </div>
      {artists.length === 0 ? (
        <PlaceholderState
          icon={<IconArtist size={40} />}
          title="按分类浏览歌手"
          desc="后端接入歌手榜数据后，这里会展示对应分类与首字母的歌手头像墙。"
        />
      ) : (
        <div className="music-artist-grid">
          {artists.map((artist) => (
            <button
              key={artist.name}
              type="button"
              onClick={() => onOpenArtist(artist.name)}
              className="music-artist-card"
            >
              <span className="music-artist-avatar">
                {artist.cover ? (
                  <img src={artist.cover} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="grid h-full w-full place-items-center bg-ink-3 text-cream-faint">
                    <IconAlbum size={28} />
                  </span>
                )}
              </span>
              <span className="music-artist-card-name line-clamp-1">{artist.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function isRecentActive(currentSong: MusicSong | null, song: MusicSong) {
  return !!currentSong && musicSongKey(currentSong) === musicSongKey(song);
}
