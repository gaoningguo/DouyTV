// @ts-nocheck
/**
 * WY 歌曲播放 URL —— 完全复用 lx-music api-test 实现（`GET {server}/url/wy/{id}/{type}`）。
 *
 * 服务器地址从 `BuiltinBackend.urlServers.wy` 读取（默认 `https://ts.tempmusics.tk`），
 * 用户可在 设置 · 音乐 · 内置 URL 服务器 自定义或切换镜像。
 */
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
  const server = getBuiltinUrlServer("wy");
  const url = `${server}/url/wy/${encodeURIComponent(songmid)}/${encodeURIComponent(quality)}`;
  const res = await httpFetch(url, { method: "GET" }).promise;
  if (res.statusCode === 429) throw new Error("请求过于频繁，稍后再试");
  const body = res.body as { code?: number; data?: string; msg?: string };
  if (body?.code === 0 && body.data) {
    return { url: body.data, quality };
  }
  throw new Error(
    body?.msg || `网易云未返回播放 URL（${quality}），可能是 VIP/灰色曲，或服务器 ${server} 不可达`
  );
}

export default { getMusicUrl };
