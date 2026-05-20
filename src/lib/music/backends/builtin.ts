/**
 * 内置音乐源 backend — 调用 ./builtin-sdk/ 暴露的方法实现 search/lyric/toplists。
 *
 * 覆盖范围：
 * - WY (网易云): search ✅ / lyric ✅ / toplists ✅
 * - KW (酷我): search ✅ / hotSearch ✅
 * - TX/KG/MG: 占位（getPlatformSdk 返回 undefined → search 抛友好错误）
 *
 * builtin **不解析 URL** — api.ts dispatcher 会回落到 musicapi/lxmusic/plugin。
 */
import { getPlatformSdk } from "../builtin-sdk";
import type { MusicQuality, MusicSong, MusicSource, MusicToplist } from "../types";
import type {
  BackendSearchArgs,
  BackendSearchResult,
  BuiltinBackend,
  MusicBackendRuntime,
} from "./types";

interface SdkSong {
  name: string;
  singer: string;
  source: string;
  songmid: string;
  albumId: string;
  interval: string | number;
  albumName: string;
  img: string | null;
  lrc: string | null;
}

function sdkToMusicSong(s: SdkSong, source: MusicSource): MusicSong {
  // interval 可能是 "3:45" 字符串或秒数
  let durationSec: number | undefined;
  if (typeof s.interval === "number") {
    durationSec = s.interval;
  } else if (typeof s.interval === "string" && s.interval.includes(":")) {
    const [m, sec] = s.interval.split(":");
    durationSec = (parseInt(m, 10) || 0) * 60 + (parseInt(sec, 10) || 0);
  }
  return {
    songId: s.songmid,
    source,
    songmid: s.songmid,
    name: s.name,
    artist: s.singer || undefined,
    album: s.albumName || undefined,
    albumId: s.albumId || undefined,
    cover: s.img ?? undefined,
    durationSec,
  };
}

export function createBuiltinRuntime(
  _cfg: BuiltinBackend,
  defaultPlatform: MusicSource
): MusicBackendRuntime {
  return {
    kind: "builtin",
    capabilities: {
      search: true,
      parse: false,
      lyrics: true,
      toplists: true,
      playlists: false,
      albums: false,
      artists: false,
      recommendSheets: false,
      comments: false,
      hotSearch: true,
      multiTypeSearch: false,
    },
    search: async (args: BackendSearchArgs): Promise<BackendSearchResult> => {
      const sdk = getPlatformSdk(defaultPlatform);
      if (!sdk?.musicSearch) {
        throw new Error(
          `内置音乐源暂未实现「${defaultPlatform}」搜索 — 请切到 wy / kw 或配置其他 backend`
        );
      }
      const r = await sdk.musicSearch.search(args.keyword, args.page, args.pageSize);
      const list = r.list.map((raw: Record<string, unknown>) =>
        sdkToMusicSong(raw as unknown as SdkSong, defaultPlatform)
      );
      return {
        list,
        total: r.total,
        page: args.page,
        pageSize: args.pageSize,
      };
    },
    parse: async (_song: MusicSong, _quality: MusicQuality) => {
      throw new Error("内置音乐源不支持 URL 解析 — 请添加 MusicApi-V2/LX-Music Server/MusicFree 插件作 fallback");
    },
    fetchLyrics: async (song: MusicSong) => {
      const sdk = getPlatformSdk(song.source);
      if (!sdk?.getLyric) return "";
      try {
        const r = await sdk.getLyric({ songmid: song.songId });
        return r.lyric ?? "";
      } catch {
        return "";
      }
    },
    fetchTranslatedLyrics: async (song: MusicSong) => {
      const sdk = getPlatformSdk(song.source);
      if (!sdk?.getLyric) return "";
      try {
        const r = await sdk.getLyric({ songmid: song.songId });
        return r.tlyric ?? "";
      } catch {
        return "";
      }
    },
    getToplists: async (): Promise<MusicToplist[]> => {
      const sdk = getPlatformSdk(defaultPlatform);
      if (!sdk?.leaderboard?.getList) return [];
      const lists = await sdk.leaderboard.getList();
      return lists.map((b: { id: string; name: string; coverImgUrl?: string; description?: string }) => ({
        id: b.id,
        source: defaultPlatform,
        name: b.name,
        cover: b.coverImgUrl,
        description: b.description,
      }));
    },
    getToplistDetail: async (id: string) => {
      const sdk = getPlatformSdk(defaultPlatform);
      if (!sdk?.leaderboard?.getDetail) {
        throw new Error("内置音乐源该平台未提供榜单详情");
      }
      const detail = await sdk.leaderboard.getDetail(id);
      const songs = detail.list.map((raw: Record<string, unknown>) =>
        sdkToMusicSong(raw as unknown as SdkSong, defaultPlatform)
      );
      return {
        id,
        name: detail.name,
        cover: detail.cover,
        description: detail.description,
        songs,
        isEnd: true,
      };
    },
    getHotSearch: async () => {
      const sdk = getPlatformSdk(defaultPlatform);
      if (!sdk?.hotSearch?.getHotSearch) return [];
      return sdk.hotSearch.getHotSearch();
    },
  };
}
