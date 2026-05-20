/**
 * MoonTV CMS V10 协议客户端 — 将 CMS 站源包装为 ScriptModule 接口。
 *
 * 协议：
 *   搜索: `{api}?ac=videolist&wd={keyword}&pg={page}`
 *   详情: `{api}?ac=videolist&ids={vodId}`
 *
 * 返回结构（关键字段）：
 *   { list: [{ vod_id, vod_name, vod_pic, vod_remarks, vod_play_url, vod_year, vod_content, type_name, vod_douban_id }], pagecount }
 *
 * vod_play_url 解析：
 *   "线路1集名1$url1.m3u8#线路1集名2$url2.m3u8$$$线路2集名1$url1.m3u8"
 *    - `$$$` 分割不同线路
 *    - `#` 分割单线路内的集
 *    - `$` 分割集标题与 URL
 */
import { scriptFetch } from "@/source-script/fetch";
import type {
  ScriptDescriptor,
  ScriptDetailResult,
  ScriptModule,
  ScriptPlayback,
  ScriptResolveResult,
  ScriptSearchResult,
  ScriptVodItem,
} from "@/source-script/types";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

interface CmsRawItem {
  vod_id?: string | number;
  vod_name?: string;
  vod_pic?: string;
  vod_remarks?: string;
  vod_play_url?: string;
  vod_class?: string;
  vod_year?: string;
  vod_content?: string;
  vod_douban_id?: number;
  type_name?: string;
}

interface CmsClassItem {
  type_id: number;
  type_name: string;
  /** 父分类 id（一级 = 0）。MoonTV CMS API 字段名 */
  type_pid?: number;
}

interface CmsResponse {
  code?: number;
  list?: CmsRawItem[];
  pagecount?: number;
  total?: number;
  msg?: string;
  /** CMS V10 `?ac=list` 返回的 type 列表（电影/电视剧/综艺...） */
  class?: CmsClassItem[];
}

function cleanText(s: string | undefined | null): string {
  if (!s) return "";
  return s.replace(/<[^>]+>/g, "").trim();
}

function pickYear(raw: string | undefined): string {
  if (!raw) return "";
  return raw.match(/\d{4}/)?.[0] ?? "";
}

function buildHeaders(desc: ScriptDescriptor): Record<string, string> {
  const h: Record<string, string> = {
    "User-Agent": desc.ua || DEFAULT_UA,
    Accept: "application/json, text/plain, */*",
  };
  if (desc.referer) h["Referer"] = desc.referer;
  return h;
}

function toItem(raw: CmsRawItem): ScriptVodItem | undefined {
  const id = raw.vod_id?.toString();
  const title = raw.vod_name?.trim();
  if (!id || !title) return undefined;
  return {
    id,
    title: title.replace(/\s+/g, " "),
    poster: raw.vod_pic || undefined,
    year: pickYear(raw.vod_year),
    desc: cleanText(raw.vod_content),
    type_name: raw.type_name,
    douban_id: raw.vod_douban_id,
    vod_remarks: raw.vod_remarks,
  };
}

/**
 * 解析 vod_play_url 为 playbacks 数组。
 * 仅保留含有 m3u8 / mp4 / 任意 http URL 的有效集。
 */
function parsePlayUrl(vodPlayUrl: string | undefined): ScriptPlayback[] {
  if (!vodPlayUrl) return [];
  const lines = vodPlayUrl.split("$$$");
  const playbacks: ScriptPlayback[] = [];
  lines.forEach((line, lineIdx) => {
    const episodes: string[] = [];
    const titles: string[] = [];
    line.split("#").forEach((ep) => {
      const parts = ep.split("$");
      if (parts.length === 2) {
        const [title, url] = parts;
        if (url && /^https?:\/\//.test(url)) {
          titles.push(title.trim() || `第${episodes.length + 1}集`);
          episodes.push(url.trim());
        }
      } else if (parts.length === 1 && /^https?:\/\//.test(parts[0])) {
        titles.push(`第${episodes.length + 1}集`);
        episodes.push(parts[0].trim());
      }
    });
    if (episodes.length > 0) {
      playbacks.push({
        sourceId: `line-${lineIdx}`,
        sourceName: lineIdx === 0 ? "默认线路" : `线路 ${lineIdx + 1}`,
        episodes: episodes.map((u) => ({ playUrl: u, needResolve: false })),
        episodes_titles: titles,
      });
    }
  });
  return playbacks;
}

/**
 * 把 CMS ApiSite 包装成 ScriptModule，复用现有 source-script runtime。
 */
export function makeCmsScriptModule(desc: ScriptDescriptor): ScriptModule {
  if (!desc.api) {
    throw new Error(`CMS source "${desc.key}" missing api URL`);
  }
  const apiBase = desc.api;
  const headers = buildHeaders(desc);

  const fetchList = async (
    params: Record<string, string | number>
  ): Promise<CmsResponse> => {
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => sp.set(k, String(v)));
    const url = `${apiBase}${apiBase.includes("?") ? "&" : "?"}${sp.toString()}`;
    const res = await scriptFetch(url, { method: "GET", headers, timeout: 15_000 });
    if (!res.ok) throw new Error(`CMS ${desc.key} HTTP ${res.status}`);
    const json = await res.json<CmsResponse>();
    return json;
  };

  return {
    meta: { name: desc.name, author: "cms-api" },

    /**
     * 调 ?ac=list 拉真实分类（class 字段）。每个 type 作为一个 ScriptSourceItem，
     * group="分类"。失败回退到默认 [default]。
     */
    async getSources() {
      try {
        const data = await fetchList({ ac: "list" });
        const cls = data.class ?? [];
        if (cls.length === 0) {
          return [{ id: "default", name: desc.name }];
        }
        // 排除 type_pid > 0 的子分类，避免树状结构（前端只用一级）
        // 保留 default + 所有一级 type 作选项
        return [
          { id: "default", name: "全部", group: "分类" },
          ...cls
            .filter((c) => !c.type_pid || c.type_pid === 0)
            .map((c) => ({
              id: String(c.type_id),
              name: c.type_name,
              group: "分类",
            })),
        ];
      } catch (e) {
        console.warn(`[cms:${desc.key}] getSources fallback`, e);
        return [{ id: "default", name: desc.name }];
      }
    },

    async search(_ctx, { keyword, page, sourceId }) {
      const params: Record<string, string | number> = {
        ac: "videolist",
        wd: keyword,
        pg: page || 1,
      };
      // sourceId 是 type_id（!== "default"）时按分类过滤
      if (sourceId && sourceId !== "default") {
        params.t = sourceId;
      }
      const data = await fetchList(params);
      const list: ScriptVodItem[] = (data.list || [])
        .map(toItem)
        .filter((x): x is ScriptVodItem => !!x);
      return {
        list,
        page: page || 1,
        pageCount: data.pagecount ?? 1,
        total: data.total ?? list.length,
      } satisfies ScriptSearchResult;
    },

    async recommend(_ctx, { page, sourceId }) {
      // 浏览模式：?ac=videolist（不带 wd）+ 可选 t=<type_id>
      const params: Record<string, string | number> = {
        ac: "videolist",
        pg: page || 1,
      };
      if (sourceId && sourceId !== "default") {
        params.t = sourceId;
      }
      const data = await fetchList(params);
      const list: ScriptVodItem[] = (data.list || [])
        .map(toItem)
        .filter((x): x is ScriptVodItem => !!x);
      return {
        list,
        page: page || 1,
        pageCount: data.pagecount ?? 1,
        total: data.total ?? list.length,
      } satisfies ScriptSearchResult;
    },

    async detail(_ctx, { id }) {
      const data = await fetchList({ ac: "videolist", ids: id });
      const first = data.list?.[0];
      if (!first) throw new Error(`CMS ${desc.key} detail empty for id=${id}`);
      const item = toItem(first);
      if (!item) throw new Error(`CMS ${desc.key} detail invalid item`);
      const playbacks = parsePlayUrl(first.vod_play_url);
      if (playbacks.length === 0) {
        throw new Error(`CMS ${desc.key} no playable episodes for id=${id}`);
      }
      return {
        ...item,
        playbacks,
      } satisfies ScriptDetailResult;
    },

    async resolvePlayUrl(_ctx, { playUrl }) {
      const lower = playUrl.toLowerCase();
      const type: ScriptResolveResult["type"] = lower.includes(".m3u8")
        ? "hls"
        : lower.includes(".mp4")
        ? "mp4"
        : "auto";
      const out: ScriptResolveResult = { url: playUrl, type, headers: {} };
      if (desc.ua) out.headers!["User-Agent"] = desc.ua;
      if (desc.referer) out.headers!["Referer"] = desc.referer;
      return out;
    },
  };
}
