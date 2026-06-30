import { useEffect, useState } from "react";
import { IconAlbum, IconArtist, IconFilm, IconList, IconWave } from "@/components/Icon";
import {
  getNeteaseArtistList,
  getNeteaseTopArtists,
  isNeteaseAntiBotError,
  getNeteaseMvList,
  getNeteaseTopMv,
  getNeteaseFirstMv,
  getNeteaseRadioRecommend,
  getNeteaseDjHot,
  getNeteaseDjToplist,
  getNeteaseDjProgramRecommend,
  getNeteaseDjBanner,
  getNeteaseTopPlaylists,
  getNeteasePlaylistCatlist,
  getNeteaseNewAlbums,
  getNeteaseHighqualityPlaylists,
  getNeteaseHotPlaylistTags,
  getNeteaseNewestAlbums,
  getNeteaseTopAlbums,
  type MusicSongListSummary,
  type MusicSourceDescriptor,
  type NeteaseArtist,
  type NeteaseMv,
} from "@/lib/music";
import { wrapImage } from "@/lib/proxy";
import { VideoCard } from "../components/VinylHero";
import { PageHeader, PlaceholderState } from "./shared";

/** MV 广场 —— 对齐 SPlayer:个性化 MV(/personalized/mv)、MV 排行(/top/mv)、最新 MV(/mv/first)。点击经 /mv/url 播放。 */
const MV_TABS: Array<{ key: "rec" | "top" | "new"; label: string }> = [
  { key: "rec", label: "推荐" },
  { key: "top", label: "排行榜" },
  { key: "new", label: "最新" },
];

export function MvView({
  source,
  onPlay,
}: {
  source: MusicSourceDescriptor | null;
  onPlay: (mv: NeteaseMv) => void;
}) {
  const [tab, setTab] = useState<"rec" | "top" | "new">("rec");
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
        const list =
          tab === "top"
            ? await getNeteaseTopMv(source)
            : tab === "new"
              ? await getNeteaseFirstMv(source)
              : await getNeteaseMvList(source);
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
  }, [source?.id, tab]);

  return (
    <div className="music-page-wrap space-y-6">
      <PageHeader title="MV 广场" subtitle="官方 MV、现场、翻唱与舞蹈视频" />
      {!source ? (
        <PlaceholderState
          icon={<IconFilm size={40} />}
          title="需要网易源"
          desc="在「音乐源」添加网易内置源即可浏览 MV。播放 MV 建议使用自部署 NeteaseCloudMusicApi 源（内置源受网易反爬限制）。"
        />
      ) : (
        <>
          <div className="music-artist-filter-row">
            {MV_TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className="music-af-btn"
                data-active={tab === item.key || undefined}
              >
                {item.label}
              </button>
            ))}
          </div>
          {loading ? (
            <div className="music-mv-grid">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="aspect-video rounded-xl skeleton-shimmer" />
              ))}
            </div>
          ) : mvs.length === 0 ? (
            <PlaceholderState
              icon={<IconFilm size={40} />}
              title="暂无 MV"
              desc={
                tab === "rec"
                  ? "没有取到 MV 数据。"
                  : "排行榜/最新 MV 需自部署 NeteaseCloudMusicApi 源（内置源受网易反爬限制）。"
              }
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
        </>
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

/** 电台/播客 —— 对齐 SPlayer:推荐(/dj/recommend)/热门(/dj/hot)/榜单(/dj/toplist)/精选节目(/personalized/djprogram),点击载入全部节目入队播放。 */
const RADIO_TABS: Array<{ key: "rec" | "hot" | "top" | "program"; label: string }> = [
  { key: "rec", label: "推荐" },
  { key: "hot", label: "热门" },
  { key: "top", label: "榜单" },
  { key: "program", label: "精选节目" },
];

export function RadioView({
  source,
  onOpenRadio,
}: {
  source: MusicSourceDescriptor | null;
  onOpenRadio: (radio: MusicSongListSummary) => void;
}) {
  const [tab, setTab] = useState<"rec" | "hot" | "top" | "program">("rec");
  const [radios, setRadios] = useState<MusicSongListSummary[]>([]);
  const [banners, setBanners] = useState<{ pic: string; url?: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!source) {
      setRadios([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const list =
          tab === "hot"
            ? await getNeteaseDjHot(source)
            : tab === "top"
              ? await getNeteaseDjToplist(source)
              : tab === "program"
                ? await getNeteaseDjProgramRecommend(source)
                : await getNeteaseRadioRecommend(source);
        if (!cancelled) setRadios(list);
      } catch {
        if (!cancelled) setRadios([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source?.id, tab]);

  // 电台 banner（/dj/banner）：顶部横幅，失败留空不影响列表。
  useEffect(() => {
    if (!source) {
      setBanners([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await getNeteaseDjBanner(source);
        if (!cancelled) setBanners(list);
      } catch {
        if (!cancelled) setBanners([]);
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
      ) : (
        <>
          <div className="music-artist-filter-row">
            {RADIO_TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className="music-af-btn"
                data-active={tab === item.key || undefined}
              >
                {item.label}
              </button>
            ))}
          </div>
          {banners.length > 0 && (
            <div className="flex gap-3 overflow-x-auto scrollbar-hide pb-1">
              {banners.map((b, i) => (
                <img
                  key={i}
                  src={wrapImage(b.pic)}
                  alt=""
                  className="h-24 shrink-0 rounded-xl object-cover"
                  style={{ aspectRatio: "3 / 1", border: "1px solid var(--cream-line)" }}
                />
              ))}
            </div>
          )}
          {loading ? (
            <div className="music-recommend-grid">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="aspect-square rounded-xl skeleton-shimmer" />
              ))}
            </div>
          ) : radios.length === 0 ? (
            <PlaceholderState
              icon={<IconWave size={40} />}
              title="暂无电台"
              desc={
                tab === "rec"
                  ? "没有取到电台数据（内置源可能受反爬限制，建议自部署 NeteaseCloudMusicApi 源）。"
                  : "热门/榜单/精选节目需自部署 NeteaseCloudMusicApi 源（内置源受网易反爬限制）。"
              }
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
        </>
      )}
    </div>
  );
}

/**
 * 歌单广场 —— 对齐 SPlayer:/top/playlist(按分类 cat 筛选,order=hot),点击打开歌单详情。
 * 分类标签取自 /playlist/catlist,并在最前加「精品」特殊入口(/top/playlist/highquality)。
 * 仅外部自部署网易源可用(内置源受 -462 反爬限制)。
 */
const HIGHQUALITY_CAT = "精品";

export function PlaylistSquareView({
  source,
  onOpenSonglist,
}: {
  source: MusicSourceDescriptor | null;
  onOpenSonglist: (item: MusicSongListSummary) => void;
}) {
  const [cat, setCat] = useState("全部");
  const [cats, setCats] = useState<string[]>([]);
  const [lists, setLists] = useState<MusicSongListSummary[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!source) {
      setCats([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // 热门标签(/playlist/hot)置顶 + 全部分类(/playlist/catlist)去重合并。
        const [hot, all] = await Promise.all([
          getNeteaseHotPlaylistTags(source).catch(() => [] as string[]),
          getNeteasePlaylistCatlist(source).then((r) => r.map((c) => c.name)).catch(() => [] as string[]),
        ]);
        if (cancelled) return;
        const seen = new Set<string>();
        const merged = [...hot, ...all].filter((name) => {
          if (!name || seen.has(name)) return false;
          seen.add(name);
          return true;
        });
        setCats(merged);
      } catch {
        if (!cancelled) setCats([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source?.id]);

  useEffect(() => {
    if (!source) {
      setLists([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const result =
          cat === HIGHQUALITY_CAT
            ? await getNeteaseHighqualityPlaylists(source)
            : (await getNeteaseTopPlaylists(source, { cat, limit: 50, order: "hot" })).list;
        if (!cancelled) setLists(result);
      } catch {
        if (!cancelled) setLists([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source?.id, cat]);

  return (
    <div className="music-page-wrap space-y-5">
      <PageHeader title="歌单广场" subtitle="按分类浏览热门歌单" />
      {!source ? (
        <PlaceholderState
          icon={<IconList size={40} />}
          title="需要网易源"
          desc="在「音乐源」添加自部署 NeteaseCloudMusicApi 源即可浏览歌单广场（内置源受网易反爬限制）。"
        />
      ) : (
        <>
          <div className="music-artist-prefix-row">
            {[HIGHQUALITY_CAT, "全部", ...cats].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCat(c)}
                className="music-af-btn music-af-btn-sm"
                data-active={cat === c || undefined}
              >
                {c}
              </button>
            ))}
          </div>
          {loading ? (
            <div className="music-recommend-grid">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="aspect-square rounded-xl skeleton-shimmer" />
              ))}
            </div>
          ) : lists.length === 0 ? (
            <PlaceholderState
              icon={<IconList size={40} />}
              title="暂无歌单"
              desc="该分类下没有取到歌单，换个分类试试（内置源可能受反爬限制）。"
            />
          ) : (
            <div className="music-recommend-grid">
              {lists.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="music-recommend-card tap"
                  onClick={() => onOpenSonglist(item)}
                  title={item.name}
                >
                  <div className="music-ob-album-cover">
                    {item.pic ? (
                      <img
                        src={wrapImage(item.pic)}
                        alt=""
                        className="h-full w-full rounded-lg object-cover"
                      />
                    ) : (
                      <span className="grid h-full w-full place-items-center rounded-lg bg-ink-3 text-cream-faint">
                        <IconList size={28} />
                      </span>
                    )}
                  </div>
                  <span className="music-recommend-name">{item.name}</span>
                  {item.playCount != null && (
                    <span className="line-clamp-1 text-xs text-cream-faint">
                      {item.playCount} 播放
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * 新碟上架 —— 对齐 SPlayer:新碟(/album/new,area=ALL)/最新(/album/newest)/排行(/top/album)。
 * 点击把专辑 summary 传出。仅外部网易源可用。
 */
const NEW_ALBUM_TABS: Array<{ key: "new" | "newest" | "top"; label: string }> = [
  { key: "new", label: "新碟" },
  { key: "newest", label: "最新" },
  { key: "top", label: "排行" },
];

export function NewAlbumsView({
  source,
  onOpenAlbum,
}: {
  source: MusicSourceDescriptor | null;
  onOpenAlbum: (item: MusicSongListSummary) => void;
}) {
  const [tab, setTab] = useState<"new" | "newest" | "top">("new");
  const [albums, setAlbums] = useState<MusicSongListSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [restricted, setRestricted] = useState(false);

  useEffect(() => {
    if (!source) {
      setAlbums([]);
      setRestricted(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setRestricted(false);
    (async () => {
      try {
        const list =
          tab === "newest"
            ? await getNeteaseNewestAlbums(source)
            : tab === "top"
              ? await getNeteaseTopAlbums(source)
              : await getNeteaseNewAlbums(source, { area: "ALL", limit: 50 });
        if (!cancelled) setAlbums(list);
      } catch (error) {
        if (!cancelled) {
          setAlbums([]);
          if (isNeteaseAntiBotError(error)) setRestricted(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source?.id, tab]);

  return (
    <div className="music-page-wrap space-y-6">
      <PageHeader title="新碟上架" subtitle="最新发行的专辑" />
      {!source || restricted ? (
        <PlaceholderState
          icon={<IconAlbum size={40} />}
          title="新碟上架需自部署网易源"
          desc="内置网易源受官方反爬限制（-462），无法浏览新碟。在「音乐源」添加自部署 NeteaseCloudMusicApi 源后即可使用。"
        />
      ) : (
        <>
          <div className="music-artist-filter-row">
            {NEW_ALBUM_TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className="music-af-btn"
                data-active={tab === item.key || undefined}
              >
                {item.label}
              </button>
            ))}
          </div>
          {loading ? (
            <div className="music-recommend-grid">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="aspect-square rounded-xl skeleton-shimmer" />
              ))}
            </div>
          ) : albums.length === 0 ? (
            <PlaceholderState
              icon={<IconAlbum size={40} />}
              title="暂无专辑"
              desc="没有取到专辑数据。"
            />
          ) : (
            <div className="music-recommend-grid">
              {albums.map((album) => (
                <button
                  key={album.id}
                  type="button"
                  className="music-recommend-card tap"
                  onClick={() => onOpenAlbum(album)}
                  title={album.name}
                >
                  <div className="music-ob-album-cover">
                    {album.pic ? (
                      <img
                        src={wrapImage(album.pic)}
                        alt=""
                        className="h-full w-full rounded-lg object-cover"
                      />
                    ) : (
                      <span className="grid h-full w-full place-items-center rounded-lg bg-ink-3 text-cream-faint">
                        <IconAlbum size={28} />
                      </span>
                    )}
                  </div>
                  <span className="music-recommend-name">{album.name}</span>
                  {album.author && (
                    <span className="line-clamp-1 text-xs text-cream-faint">{album.author}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

