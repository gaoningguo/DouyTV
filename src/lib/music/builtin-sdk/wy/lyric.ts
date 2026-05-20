// @ts-nocheck
/**
 * WY 歌词 — 公开端点 `music.163.com/api/song/lyric?id={id}&lv=1&kv=1&tv=-1`，无需签名。
 * 返回 `{ lrc: { lyric }, tlyric: { lyric } }`。
 */
import { httpFetch } from "../request";

export default async function getLyric(songmid: string): Promise<{
  lyric: string;
  tlyric: string;
}> {
  const url = `https://music.163.com/api/song/lyric?id=${encodeURIComponent(songmid)}&lv=1&kv=1&tv=-1`;
  try {
    const { body } = await httpFetch(url, {
      method: "GET",
      headers: {
        Referer: "https://music.163.com",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    }).promise;
    return {
      lyric: body?.lrc?.lyric ?? "",
      tlyric: body?.tlyric?.lyric ?? "",
    };
  } catch {
    return { lyric: "", tlyric: "" };
  }
}
