/**
 * NCM (NeteaseCloudMusicApi 自托管) backend。
 *
 * 对应上游：https://github.com/Binaryify/NeteaseCloudMusicApi
 * 路由都是 GET / POST 都行，DouyTV 一律走 GET（自托管 server 都允许）。
 *
 *   GET /search?keywords=...&limit=30&offset=0&type=1
 *   GET /song/detail?ids=123,456
 *   GET /song/url/v1?id=123&level=exhigh
 *   GET /playlist/detail?id=123
 *   GET /playlist/track/all?id=123&limit=100&offset=0
 *   GET /album?id=123
 *   GET /artist/songs?id=123&limit=50&offset=0
 *   GET /artists?id=123
 *   GET /lyric?id=123
 *
 * 鉴权：自托管 server 通过 `?cookie=MUSIC_U=xxx;__csrf=yyy` 透传登录态。空 cookie 走匿名，
 * 多数公开接口仍可用。
 *
 * **平台固定 wy**：NCM 就是网易云。dispatcher 不会路由其它 platform 到这里。
 */
import { scriptFetch } from "@/source-script/fetch";
import type { MusicQuality, MusicSong } from "../types";
import type {
  BackendSearchArgs,
  BackendSearchResult,
  NcmBackend,
  MusicBackendRuntime,
} from "./types";

// NCM /song/url/v1 的 level 取值
const NCM_LEVEL_MAP: Record<MusicQuality, string> = {
  "128k": "standard",
  "192k": "higher",
  "320k": "exhigh",
  flac: "lossless",
};

interface NcmArtist {
  id?: number;
  name?: string;
}

interface NcmAlbum {
  id?: number;
  name?: string;
  picUrl?: string;
}

interface NcmSongDetail {
  id: number;
  name: string;
  ar?: NcmArtist[];
  artists?: NcmArtist[];
  al?: NcmAlbum;
  album?: NcmAlbum & { picUrl?: string };
  dt?: number;
  duration?: number;
}

interface NcmUrlData {
  id: number;
  url: string | null;
  br?: number;
  size?: number;
  type?: string;
}

function pickArtists(s: NcmSongDetail): string | undefined {
  const list = s.ar ?? s.artists ?? [];
  const names = list.map((a) => a?.name).filter(Boolean);
  return names.length ? names.join(" / ") : undefined;
}

function pickAlbum(s: NcmSongDetail): { name?: string; cover?: string; albumId?: string } {
  const al = s.al ?? s.album;
  return {
    name: al?.name,
    cover: al?.picUrl,
    albumId: al?.id !== undefined ? String(al.id) : undefined,
  };
}

function songFromDetail(s: NcmSongDetail): MusicSong {
  const album = pickAlbum(s);
  return {
    songId: String(s.id),
    source: "wy",
    name: s.name,
    artist: pickArtists(s),
    album: album.name,
    cover: album.cover,
    albumId: album.albumId,
    durationSec:
      typeof s.dt === "number"
        ? Math.floor(s.dt / 1000)
        : typeof s.duration === "number"
          ? Math.floor(s.duration / 1000)
          : undefined,
  };
}

export function createNcmRuntime(cfg: NcmBackend): MusicBackendRuntime {
  const baseUrl = cfg.baseUrl.replace(/\/+$/, "");
  if (!baseUrl) throw new Error("NCM server 地址未配置");

  function buildUrl(path: string, params: Record<string, string | number | undefined> = {}): string {
    const qp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      qp.append(k, String(v));
    }
    if (cfg.cookie) qp.append("cookie", cfg.cookie);
    // NCM 经常需要 timestamp 防缓存
    qp.append("timestamp", String(Date.now()));
    const qs = qp.toString();
    return `${baseUrl}${path}${qs ? `?${qs}` : ""}`;
  }

  async function getJson<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = buildUrl(path, params);
    const res = await scriptFetch(url, { method: "GET", timeout: 30_000 });
    if (!res.ok) throw new Error(`NCM HTTP ${res.status}`);
    const parsed = (await res.json()) as { code?: number; msg?: string; message?: string } & T;
    if (parsed.code !== undefined && parsed.code !== 200) {
      throw new Error(parsed.msg || parsed.message || `NCM code ${parsed.code}`);
    }
    return parsed as T;
  }

  async function search(args: BackendSearchArgs): Promise<BackendSearchResult> {
    // NCM /search type: 1=单曲 10=专辑 100=歌手 1000=歌单 1002=用户 1004=mv 1006=歌词 1009=主播电台 1014=视频
    const typeMap: Record<string, number> = {
      music: 1,
      album: 10,
      artist: 100,
      sheet: 1000,
    };
    const type = typeMap[args.type ?? "music"] ?? 1;
    const data = await getJson<{
      result?: { songs?: NcmSongDetail[]; songCount?: number };
    }>("/search", {
      keywords: args.keyword,
      type,
      limit: args.pageSize,
      offset: (args.page - 1) * args.pageSize,
    });
    const list = (data.result?.songs ?? []).map(songFromDetail);
    return {
      list,
      total: data.result?.songCount ?? list.length,
      page: args.page,
      pageSize: args.pageSize,
    };
  }

  async function parse(song: MusicSong, quality: MusicQuality) {
    if (song.source !== "wy") {
      throw new Error("NCM 后端只支持网易云（wy）平台歌曲解析");
    }
    const level = NCM_LEVEL_MAP[quality] ?? "exhigh";
    const data = await getJson<{ data?: NcmUrlData[] }>("/song/url/v1", {
      id: song.songId,
      level,
    });
    const item = data.data?.[0];
    if (!item?.url) throw new Error("NCM 未返回播放 URL（可能需登录 cookie / VIP 歌曲）");
    return { url: item.url };
  }

  async function fetchLyrics(song: MusicSong): Promise<string> {
    try {
      const data = await getJson<{ lrc?: { lyric?: string } }>("/lyric", {
        id: song.songId,
      });
      return data.lrc?.lyric ?? "";
    } catch {
      return "";
    }
  }

  async function fetchTranslatedLyrics(song: MusicSong): Promise<string> {
    try {
      const data = await getJson<{ tlyric?: { lyric?: string } }>("/lyric", {
        id: song.songId,
      });
      return data.tlyric?.lyric ?? "";
    } catch {
      return "";
    }
  }

  async function getMusicInfo(song: MusicSong): Promise<Partial<MusicSong>> {
    try {
      const data = await getJson<{ songs?: NcmSongDetail[] }>("/song/detail", {
        ids: song.songId,
      });
      const s = data.songs?.[0];
      if (!s) return {};
      const album = pickAlbum(s);
      const patch: Partial<MusicSong> = {};
      const artist = pickArtists(s);
      if (artist) patch.artist = artist;
      if (album.name) patch.album = album.name;
      if (album.cover) patch.cover = album.cover;
      if (album.albumId) patch.albumId = album.albumId;
      return patch;
    } catch {
      return {};
    }
  }

  async function getPlaylistDetail(id: string, page: number = 1) {
    const data = await getJson<{
      playlist?: {
        id: number;
        name: string;
        coverImgUrl?: string;
        description?: string;
        creator?: { nickname?: string };
        playCount?: number;
        trackCount?: number;
        tracks?: NcmSongDetail[];
      };
    }>("/playlist/detail", { id });
    const pl = data.playlist;
    if (!pl) throw new Error("NCM 歌单不存在或无访问权限");
    // tracks 字段只返回前 ~10 首，完整列表需 /playlist/track/all
    const pageSize = 100;
    const full = await getJson<{ songs?: NcmSongDetail[] }>("/playlist/track/all", {
      id,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const songs = (full.songs ?? pl.tracks ?? []).map(songFromDetail);
    return {
      id: String(pl.id),
      name: pl.name,
      cover: pl.coverImgUrl,
      description: pl.description,
      creator: pl.creator?.nickname,
      playCount: pl.playCount,
      songs,
      isEnd: songs.length < pageSize,
    };
  }

  async function getAlbumDetail(albumId: string) {
    const data = await getJson<{
      album?: { id: number; name: string; picUrl?: string; description?: string; artist?: NcmArtist };
      songs?: NcmSongDetail[];
    }>("/album", { id: albumId });
    const al = data.album;
    if (!al) throw new Error("NCM 专辑不存在");
    return {
      id: String(al.id),
      source: "wy" as const,
      name: al.name,
      cover: al.picUrl,
      description: al.description,
      artist: al.artist?.name,
      songs: (data.songs ?? []).map(songFromDetail),
    };
  }

  async function getHotSearch(): Promise<string[]> {
    try {
      const data = await getJson<{
        result?: { hots?: Array<{ first?: string }> };
        data?: Array<{ searchWord?: string }>;
      }>("/search/hot", {});
      const list =
        (data.result?.hots ?? []).map((h) => h.first ?? "").filter(Boolean) ||
        (data.data ?? []).map((h) => h.searchWord ?? "").filter(Boolean);
      return list;
    } catch {
      return [];
    }
  }

  return {
    kind: "ncm",
    capabilities: {
      search: true,
      parse: true,
      lyrics: true,
      toplists: false,
      playlists: true,
      albums: true,
      artists: false,
      recommendSheets: false,
      comments: false,
      hotSearch: true,
      multiTypeSearch: false,
    },
    search,
    parse,
    fetchLyrics,
    fetchTranslatedLyrics,
    getMusicInfo,
    getPlaylistDetail,
    getAlbumDetail,
    getHotSearch,
  };
}
