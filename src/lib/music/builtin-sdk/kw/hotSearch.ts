// @ts-nocheck
/**
 * KW 热搜词 — 公开端点 http://qukudata.kuwo.cn/q.k?op=query&cont=ninfo&xoid=null&ver=mbox&cluster=0&plat=h5&type=hotword&qn=80
 */
import { httpFetch } from "../request";

export default async function getHotSearch(): Promise<string[]> {
  const url = "http://qukudata.kuwo.cn/q.k?op=query&cont=ninfo&xoid=null&ver=mbox&cluster=0&plat=h5&type=hotword&qn=20";
  try {
    const { body } = await httpFetch(url).promise;
    if (!body || !Array.isArray(body.hotword)) return [];
    return body.hotword.map((h: { name?: string }) => h?.name).filter(Boolean);
  } catch {
    return [];
  }
}
