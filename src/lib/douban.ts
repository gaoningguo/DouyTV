/**
 * 豆瓣热门推荐 —— 用于点播页未输入关键词时的发现入口。
 *
 * 接口：豆瓣 j/search_subjects 公开端点。Tauri 下走 scriptFetch（Rust ureq）
 * 绕 CORS；浏览器 dev 直接 fetch（豆瓣本身不带 CORS header，可能挂）。
 */
import { scriptFetch } from "@/source-script/fetch";

export type DoubanKind = "movie" | "tv";

export interface DoubanItem {
  id: string;
  title: string;
  cover: string;
  rate: string; // 豆瓣评分字符串
  url: string;
  /** kind，方便后续逻辑识别（接口未返回，这里塞入） */
  kind: DoubanKind;
}

interface RawDoubanResponse {
  subjects: Array<{
    id: string;
    title: string;
    cover: string;
    rate: string;
    url: string;
  }>;
}

const DOUBAN_BASE = "https://movie.douban.com/j/search_subjects";

/**
 * 拉豆瓣热门 / 分类视频列表。
 *
 * @param kind   movie | tv
 * @param tag    豆瓣的"标签"（热门 / 最新 / 经典 / 美剧 / 日剧…）
 * @param limit  每页大小（默认 20）
 * @param start  起始偏移（分页用，0/20/40 …）
 */
export async function fetchDoubanList(
  kind: DoubanKind,
  tag: string = "热门",
  limit: number = 20,
  start: number = 0
): Promise<DoubanItem[]> {
  const url = `${DOUBAN_BASE}?type=${kind}&tag=${encodeURIComponent(
    tag
  )}&sort=recommend&page_limit=${limit}&page_start=${start}`;
  const res = await scriptFetch(url, {
    method: "GET",
    headers: {
      Referer: "https://movie.douban.com/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    },
    timeout: 10_000,
  });
  if (!res.ok) throw new Error(`豆瓣返回 HTTP ${res.status}`);
  const text = await res.text();
  let parsed: RawDoubanResponse;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("豆瓣返回非 JSON（可能被反爬）");
  }
  return (parsed.subjects ?? []).map((s) => ({
    id: s.id,
    title: s.title,
    cover: s.cover,
    rate: s.rate,
    url: s.url,
    kind,
  }));
}

/** 常用标签预设，供 UI tab 用 */
export const MOVIE_TAGS = ["热门", "最新", "经典", "豆瓣高分", "冷门佳片", "华语", "欧美", "韩国", "日本"];
export const TV_TAGS = ["热门", "美剧", "英剧", "韩剧", "日剧", "国产剧", "港剧", "日本动画", "综艺"];
