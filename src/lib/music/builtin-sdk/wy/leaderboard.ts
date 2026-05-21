// @ts-nocheck
/**
 * WY 榜单 —— 列表用公开 `/api/toplist`（这条 path 还活着，没被风控），
 * 详情走 `./songList.getSongListDetail`（`/api/linux/forward` + linuxapi）。
 *
 * 历史背景：以前详情直接 GET `/api/playlist/detail?id=` 也能用，2022 年起被网易做了
 * 网关层静默丢包（TCP `os error 10060`），必须改 linuxapi 协议。
 */
import { httpFetch } from "../request";
import { decodeName } from "../common";
import { getSongListDetail } from "./songList";

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

  /** 榜单详情 —— 走 linuxapi 协议（同 songList）。 */
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
    const d = await getSongListDetail(boardId);
    return {
      name: d.name,
      cover: d.cover,
      description: d.description,
      list: d.list,
    };
  },
};
