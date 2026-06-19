import { useEffect, useState } from "react";
import { IconAlbum, IconArtist, IconFilm, IconWave } from "@/components/Icon";
import {
  getNeteaseMvList,
  getNeteaseRadioRecommend,
  musicSongKey,
  type MusicSong,
  type MusicSongListSummary,
  type MusicSourceDescriptor,
  type NeteaseMv,
} from "@/lib/music";
import { wrapImage } from "@/lib/proxy";
import { SongList } from "../components/SongList";
import { VideoCard } from "../components/VinylHero";
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

/** MV 广场 —— 对齐 SPlayer:个性化 MV 列表(/personalized/mv),点击经 /mv/url 播放视频。 */
export function MvView({
  source,
  onPlay,
}: {
  source: MusicSourceDescriptor | null;
  onPlay: (mv: NeteaseMv) => void;
}) {
  const [mvs, setMvs] = useState<NeteaseMv[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!source) {
      setMvs([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const list = await getNeteaseMvList(source);
        if (!cancelled) setMvs(list);
      } catch {
        if (!cancelled) setMvs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source?.id]);

  return (
    <div className="music-page-wrap space-y-6">
      <PageHeader title="MV 广场" subtitle="官方 MV、现场、翻唱与舞蹈视频" />
      {!source ? (
        <PlaceholderState
          icon={<IconFilm size={40} />}
          title="需要网易源"
          desc="在「音乐源」添加网易内置源即可浏览 MV。播放 MV 建议使用自部署 NeteaseCloudMusicApi 源（内置源受网易反爬限制）。"
        />
      ) : loading ? (
        <div className="music-mv-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-video rounded-xl skeleton-shimmer" />
          ))}
        </div>
      ) : mvs.length === 0 ? (
        <PlaceholderState
          icon={<IconFilm size={40} />}
          title="暂无 MV"
          desc="没有取到 MV 数据。"
        />
      ) : (
        <div className="music-mv-grid">
          {mvs.map((mv) => (
            <VideoCard
              key={mv.id}
              cover={mv.cover}
              title={mv.name}
              subtitle={mv.artist || "MV"}
              onClick={() => onPlay(mv)}
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

/** 电台/播客 —— 对齐 SPlayer:/dj/recommend 列表,点击载入全部节目(/dj/program)入队播放。 */
export function RadioView({
  source,
  onOpenRadio,
}: {
  source: MusicSourceDescriptor | null;
  onOpenRadio: (radio: MusicSongListSummary) => void;
}) {
  const [radios, setRadios] = useState<MusicSongListSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!source) {
      setRadios([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const list = await getNeteaseRadioRecommend(source);
      if (!cancelled) {
        setRadios(list);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source?.id]);

  return (
    <div className="music-page-wrap space-y-6">
      <PageHeader title="电台播客" subtitle="网易云电台推荐" />
      {!source ? (
        <PlaceholderState
          icon={<IconWave size={40} />}
          title="需要网易源"
          desc="在「音乐源」添加网易源即可浏览电台。播放节目建议使用自部署 NeteaseCloudMusicApi 源（内置源受网易反爬限制）。"
        />
      ) : loading ? (
        <div className="music-recommend-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-square rounded-xl skeleton-shimmer" />
          ))}
        </div>
      ) : radios.length === 0 ? (
        <PlaceholderState
          icon={<IconWave size={40} />}
          title="暂无电台"
          desc="没有取到电台数据（内置源可能受反爬限制，建议自部署 NeteaseCloudMusicApi 源）。"
        />
      ) : (
        <div className="music-recommend-grid">
          {radios.map((radio) => (
            <button
              key={radio.id}
              type="button"
              className="music-recommend-card tap"
              onClick={() => onOpenRadio(radio)}
              title={radio.name}
            >
              <div className="music-ob-album-cover">
                {radio.pic ? (
                  <img
                    src={wrapImage(radio.pic)}
                    alt=""
                    className="h-full w-full rounded-lg object-cover"
                  />
                ) : (
                  <span className="grid h-full w-full place-items-center rounded-lg bg-ink-3 text-cream-faint">
                    <IconWave size={28} />
                  </span>
                )}
              </div>
              <span className="music-recommend-name">{radio.name}</span>
              {radio.author && (
                <span className="line-clamp-1 text-xs text-cream-faint">{radio.author}</span>
              )}
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
