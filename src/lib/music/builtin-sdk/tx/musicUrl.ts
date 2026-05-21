// @ts-nocheck
/** TX (QQ 音乐) 歌曲播放 URL —— lx-music api-messoer 同款。 */
import { httpFetch } from "../request";
import { getBuiltinUrlServer } from "../config";

export interface ResolvedUrl {
  url: string;
  quality: string;
}

export async function getMusicUrl(
  songmid: string,
  quality: "128k" | "192k" | "320k" | "flac" = "128k"
): Promise<ResolvedUrl> {
  const server = getBuiltinUrlServer("tx");
  const url = `${server}/url/tx/${encodeURIComponent(songmid)}/${encodeURIComponent(quality)}`;
  const res = await httpFetch(url, { method: "GET" }).promise;
  if (res.statusCode === 429) throw new Error("请求过于频繁，稍后再试");
  const body = res.body as { code?: number; data?: string; msg?: string };
  if (body?.code === 0 && body.data) {
    return { url: body.data, quality };
  }
  throw new Error(
    body?.msg || `QQ 音乐未返回播放 URL（${quality}），或服务器 ${server} 不可达`
  );
}

export default { getMusicUrl };
