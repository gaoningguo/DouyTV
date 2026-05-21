// @ts-nocheck
/**
 * WY 歌单/榜单详情 —— 通过 `/api/linux/forward` + `linuxapi()` 加密访问内部
 * `/api/v3/playlist/detail` 端点。
 *
 * 为什么不直接 GET `/api/playlist/detail?id=…`：那个公开旧端点已被网易在网关层做静默丢包
 * （TCP `os error 10060`），从 2022 年起社区客户端都改走 weapi/eapi/linuxapi。
 *
 * 不需要登录，但 `MUSIC_U=` cookie 不能省（即便空值）。UA 必须伪装成 Linux Chrome 60，否则风控。
 */
import { httpFetch } from "../request";
import { linuxapi } from "./utils/crypto";
import { decodeName, formatPlayTime } from "../common";

const LINUX_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36";

interface WyTrack {
  id: number;
  name: string;
  ar?: Array<{ id?: number; name?: string }>;
  al?: { id?: number; name?: string; picUrl?: string };
  dt?: number;
}

interface WyPlaylistEnvelope {
  code?: number;
  playlist?: {
    id?: number;
    name?: string;
    coverImgUrl?: string;
    description?: string;
    creator?: { nickname?: string };
    playCount?: number;
    tracks?: WyTrack[];
    trackIds?: Array<{ id: number }>;
  };
}

export interface WyListSong {
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
}

export interface WyListDetail {
  name: string;
  cover?: string;
  description?: string;
  author?: string;
  playCount?: number;
  list: WyListSong[];
}

/**
 * 获取歌单/榜单详情。`rawId` 可以是裸 id (`19723756`)，也可以带 `wy__` 前缀的榜单格式。
 * 内部统一剥前缀。
 */
export async function getSongListDetail(
  rawId: string,
  tryNum = 0
): Promise<WyListDetail> {
  if (tryNum > 2) throw new Error("WY 歌单详情请求多次失败");

  const id = rawId.replace(/^wy__/, "");

  const form = linuxapi({
    method: "POST",
    url: "https://music.163.com/api/v3/playlist/detail",
    params: { id, n: 100000, s: 8 },
  });

  let body: WyPlaylistEnvelope;
  try {
    const res = await httpFetch("https://music.163.com/api/linux/forward", {
      method: "POST",
      headers: {
        "User-Agent": LINUX_UA,
        Cookie: "MUSIC_U=",
        Referer: "https://music.163.com",
      },
      form: form as Record<string, string>,
    }).promise;
    body = res.body as WyPlaylistEnvelope;
  } catch (e) {
    // 网络失败重试 (linuxapi 偶尔会被网关丢一次)
    if (tryNum < 2) return getSongListDetail(rawId, tryNum + 1);
    throw e;
  }

  if (!body?.playlist) {
    if (tryNum < 2) return getSongListDetail(rawId, tryNum + 1);
    throw new Error("WY 歌单详情返回空");
  }

  const playlist = body.playlist;
  const tracks = playlist.tracks ?? [];
  const list: WyListSong[] = tracks.map((t) => ({
    name: decodeName(t.name ?? ""),
    singer: (t.ar ?? []).map((a) => a.name).filter(Boolean).join("、"),
    source: "wy" as const,
    songmid: String(t.id),
    albumId: t.al?.id ? String(t.al.id) : "",
    interval: t.dt ? formatPlayTime(Math.floor(t.dt / 1000)) : "0:00",
    albumName: t.al?.name ? decodeName(t.al.name) : "",
    img: t.al?.picUrl ?? null,
    types: [] as never[],
    _types: {},
    typeUrl: {},
    lrc: null,
    otherSource: null,
  }));

  return {
    name: decodeName(playlist.name ?? "歌单"),
    cover: playlist.coverImgUrl,
    description: playlist.description ?? "",
    author: playlist.creator?.nickname,
    playCount: playlist.playCount,
    list,
  };
}

export default { getSongListDetail };
