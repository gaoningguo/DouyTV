// @ts-nocheck
/** KW 歌曲播放 URL —— lx-music api-temp 同款，服务器可在设置自定义。 */
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
  const server = getBuiltinUrlServer("kw");
  const url = `${server}/url/kw/${encodeURIComponent(songmid)}/${encodeURIComponent(quality)}`;
  const res = await httpFetch(url, { method: "GET" }).promise;
  if (res.statusCode === 429) throw new Error("请求过于频繁，稍后再试");
  const body = res.body as { code?: number; data?: string; msg?: string };
  if (body?.code === 0 && body.data) {
    return { url: body.data, quality };
  }
  throw new Error(
    body?.msg || `酷我未返回播放 URL（${quality}），或服务器 ${server} 不可达`
  );
}

export default { getMusicUrl };
