import { useEffect, useState } from "react";
import { IconAlbum, IconArtist, IconFilm, IconWave } from "@/components/Icon";
import {
  getNeteaseArtistList,
  getNeteaseTopArtists,
  isNeteaseAntiBotError,
  getNeteaseMvList,
  getNeteaseRadioRecommend,
  type MusicSongListSummary,
  type MusicSourceDescriptor,
  type NeteaseArtist,
  type NeteaseMv,
} from "@/lib/music";
import { wrapImage } from "@/lib/proxy";
import { VideoCard } from "../components/VinylHero";
import { PageHeader, PlaceholderState } from "./shared";

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

const ARTIST_AREAS: Array<{ label: string; area: number }> = [
  { label: "全部", area: -1 },
  { label: "华语", area: 7 },
  { label: "欧美", area: 96 },
  { label: "日本", area: 8 },
  { label: "韩国", area: 16 },
  { label: "其他", area: 0 },
];
const ARTIST_PREFIXES = [
  "热门", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
  "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "#",
];

/**
 * 歌手广场 —— 对齐 SPlayer artist.ts：/artist/list（按区域 area + 首字母 initial 筛选）
 * 与 /top/artists（热门）。仅外部自部署网易源可用；内置源受 -462 反爬限制时降级提示。
 */
export function ArtistsView({
  source,
  onOpenArtist,
}: {
  source: MusicSourceDescriptor | null;
  onOpenArtist: (id: string) => void;
}) {
  const [area, setArea] = useState(-1);
  const [prefix, setPrefix] = useState("热门");
  const [artists, setArtists] = useState<NeteaseArtist[]>([]);
  const [loading, setLoading] = useState(false);
  const [restricted, setRestricted] = useState(false);

  useEffect(() => {
    if (!source) {
      setArtists([]);
      setRestricted(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setRestricted(false);
    (async () => {
      try {
        // initial：「热门」走 top/artists，「#」用 0，字母用其 charCode。
        const list =
          prefix === "热门"
            ? await getNeteaseTopArtists(source, 90)
            : await getNeteaseArtistList(source, {
                area,
                initial: prefix === "#" ? 0 : prefix.toLowerCase(),
                limit: 90,
              });
        if (!cancelled) setArtists(list);
      } catch (error) {
        if (!cancelled) {
          setArtists([]);
          if (isNeteaseAntiBotError(error)) setRestricted(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source?.id, area, prefix]);

  return (
    <div className="music-page-wrap space-y-5">
      <PageHeader title="歌手" subtitle="按区域与首字母浏览" />
      {!source || restricted ? (
        <PlaceholderState
          icon={<IconArtist size={40} />}
          title="歌手广场需自部署网易源"
          desc="内置网易源受官方反爬限制（-462），无法浏览歌手分类。在「音乐源」添加自部署 NeteaseCloudMusicApi 源后即可使用。"
        />
      ) : (
        <>
          <div className="music-artist-filter-row">
            {ARTIST_AREAS.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => setArea(item.area)}
                className="music-af-btn"
                data-active={area === item.area || undefined}
              >
                {item.label}
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
          {loading ? (
            <div className="music-artist-grid">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="aspect-square rounded-full skeleton-shimmer" />
              ))}
            </div>
          ) : artists.length === 0 ? (
            <PlaceholderState
              icon={<IconArtist size={40} />}
              title="暂无歌手"
              desc="该分类下没有取到歌手，换个区域或首字母试试。"
            />
          ) : (
            <div className="music-artist-grid">
              {artists.map((artist) => (
                <button
                  key={artist.id}
                  type="button"
                  onClick={() => onOpenArtist(artist.id)}
                  className="music-artist-card"
                >
                  <span className="music-artist-avatar">
                    {artist.cover ? (
                      <img
                        src={wrapImage(artist.cover)}
                        alt=""
                        className="h-full w-full object-cover"
                      />
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
        </>
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

