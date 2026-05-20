// @ts-nocheck
/**
 * WY 榜单 — 公开端点 `music.163.com/api/toplist`。
 * 详情：`music.163.com/api/playlist/detail?id={id}`（部分歌单需 cookie，简化版仅前 100 首可见）。
 */
import { httpFetch } from "../request";
import { decodeName, formatPlayTime } from "../common";

const HEADERS = {
  Referer: "https://music.163.com",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
};

export default {
  list: [] as Array<{ id: string; name: string; bangid: string }>,

  async getList(): Promise<Array<{ id: string; name: string; coverImgUrl?: string; description?: string }>> {
    const { body } = await httpFetch("https://music.163.com/api/toplist", {
      method: "GET",
      headers: HEADERS,
    }).promise;
    const lists = (body as { list?: Array<{ id: number; name: string; coverImgUrl?: string; description?: string }> })?.list ?? [];
    return lists.map((l) => ({
      id: `wy__${l.id}`,
      name: decodeName(l.name),
      coverImgUrl: l.coverImgUrl,
      description: l.description ?? "",
    }));
  },

  async getDetail(boardId: string): Promise<{
    name: string;
    cover?: string;
    description?: string;
    list: Array<{
      name: string;
      singer: string;
      source: "wy";
      songmid: string;
      albumId: string;
      interval: string;
      albumName: string;
      img: string | null;
      types: never[];
      _types: Record<string, never>;
      typeUrl: Record<string, never>;
      lrc: null;
      otherSource: null;
    }>;
  }> {
    const id = boardId.replace(/^wy__/, "");
    const { body } = await httpFetch(
      `https://music.163.com/api/playlist/detail?id=${encodeURIComponent(id)}`,
      { method: "GET", headers: HEADERS }
    ).promise;
    const playlist = (body as { result?: { name?: string; coverImgUrl?: string; description?: string; tracks?: Array<{ id: number; name: string; artists?: Array<{ name?: string }>; album?: { id?: number; name?: string; picUrl?: string }; duration?: number }> } })?.result;
    if (!playlist) return { name: "榜单", list: [] };
    const list = (playlist.tracks ?? []).map((t) => ({
      name: decodeName(t.name),
      singer: (t.artists ?? []).map((a) => a.name).filter(Boolean).join("、"),
      source: "wy" as const,
      songmid: String(t.id),
      albumId: t.album?.id ? String(t.album.id) : "",
      interval: t.duration ? formatPlayTime(Math.floor(t.duration / 1000)) : "0:00",
      albumName: t.album?.name ? decodeName(t.album.name) : "",
      img: t.album?.picUrl ?? null,
      types: [] as never[],
      _types: {},
      typeUrl: {},
      lrc: null,
      otherSource: null,
    }));
    return {
      name: decodeName(playlist.name ?? "榜单"),
      cover: playlist.coverImgUrl,
      description: playlist.description ?? "",
      list,
    };
  },
};
