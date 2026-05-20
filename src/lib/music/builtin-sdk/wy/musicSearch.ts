// @ts-nocheck
/**
 * WY (网易云音乐) — 用公开未签名端点 `music.163.com/api/*`，无需 crypto-js。
 *
 * 这些端点对未登录访问开放，但有 IP 限流；用户自部署的 NeteaseCloudMusicApi 仍是更稳定的选择
 * （挂到 MusicApi-V2 backend）。本 builtin 仅作 "开箱即用" 的快速浏览能力。
 */
import { httpFetch } from "../request";
import { formatPlayTime, decodeName } from "../common";

interface WyRawSong {
  id: number;
  name: string;
  artists?: Array<{ id?: number; name?: string }>;
  album?: { id?: number; name?: string; picUrl?: string };
  duration?: number;
}

interface WySearchEnvelope {
  code?: number;
  result?: {
    songCount?: number;
    songs?: WyRawSong[];
  };
}

const COMMON_HEADERS = {
  Referer: "https://music.163.com",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
};

export default {
  async search(str: string, page = 1, limit = 30) {
    const offset = (page - 1) * limit;
    const url = `https://music.163.com/api/search/get/web?csrf_token=&hlpretag=&hlposttag=&s=${encodeURIComponent(str)}&type=1&offset=${offset}&total=true&limit=${limit}`;
    const { body } = await httpFetch(url, {
      method: "GET",
      headers: COMMON_HEADERS,
    }).promise;
    const env = body as WySearchEnvelope;
    if (!env?.result?.songs) {
      return { list: [], total: 0, allPage: 1, limit, source: "wy" as const };
    }
    const list = env.result.songs.map((s) => ({
      name: decodeName(s.name),
      singer: (s.artists ?? []).map((a) => a.name).filter(Boolean).join("、"),
      source: "wy" as const,
      songmid: String(s.id),
      albumId: s.album?.id ? String(s.album.id) : "",
      interval: s.duration ? formatPlayTime(Math.floor((s.duration as number) / 1000)) : "0:00",
      albumName: s.album?.name ? decodeName(s.album.name) : "",
      img: s.album?.picUrl ?? null,
      lrc: null,
      types: [],
      _types: {},
      otherSource: null,
      typeUrl: {},
    }));
    const total = env.result.songCount ?? list.length;
    return { list, total, allPage: Math.ceil(total / limit), limit, source: "wy" as const };
  },
};
