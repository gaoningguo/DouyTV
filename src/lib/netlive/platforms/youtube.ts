/**
 * YouTube Live adapter —— 走匿名 web 页面抓取（无 official Data API key）。
 *
 * 实现范围：
 *   - getRecommend：搜索结果页 `?search_query=&sp=EgJAAQ%3D%3D`（sp 过滤：直播 + 中等相关性），
 *     翻页通过 continuation token（嵌在 `ytInitialData` 中），首页用关键字 "live" 兜底。
 *   - search：同接口，关键字 → 直播过滤的搜索结果
 *   - resolve：watch 页 HTML 抓 `ytInitialPlayerResponse.streamingData.hlsManifestUrl`
 *   - getRoomDetail：watch 页 metadata（title / channel / viewCount）
 *   - getLiveStatus：watch 页 `playabilityStatus.status === 'OK'` && `videoDetails.isLive`
 *
 * 注意：YouTube 频繁改 web 结构，抓取规则可能失效。最关键的两个常量
 * (`ytInitialPlayerResponse` 和 `ytInitialData`) 五年内 基本未动，所以稳定性能用。
 * roomId 我们用 videoId（11 字符的 YouTube 视频 ID），不是频道 ID —— 一个频道可能同时多场直播。
 */
import { scriptFetch } from "@/source-script/fetch";
import type {
  NetLiveAdapter,
  NetLiveCategory,
  NetLiveRoom,
  NetLiveStream,
} from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const REFERER = "https://www.youtube.com/";

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Referer: REFERER,
};

/** 翻页 cursor 缓存：keyword → [pageIdx]: continuationToken */
const cursorCache = new Map<string, Map<number, string>>();
function cursorMap(key: string): Map<number, string> {
  let m = cursorCache.get(key);
  if (!m) {
    m = new Map();
    cursorCache.set(key, m);
  }
  return m;
}

async function fetchHtml(url: string): Promise<string> {
  const res = await scriptFetch(url, {
    method: "GET",
    headers: COMMON_HEADERS,
    timeout: 25_000,
    http2: true,
  });
  if (!res.ok) throw new Error(`YouTube HTTP ${res.status}`);
  return res.text();
}

/* ─────────────── 通用：从 HTML 提取嵌入 JSON ─────────────── */

function extractInitialData(html: string): unknown | null {
  // var ytInitialData = {...};  或  window["ytInitialData"] = {...};
  let m = html.match(/var ytInitialData\s*=\s*(\{.*?\});<\/script>/s);
  if (!m) m = html.match(/window\["ytInitialData"\]\s*=\s*(\{.*?\});/s);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function extractPlayerResponse(html: string): unknown | null {
  // var ytInitialPlayerResponse = {...};
  const m = html.match(
    /var ytInitialPlayerResponse\s*=\s*(\{.*?\});\s*(?:var |<\/script>)/s
  );
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/* ─────────────── 列表解析（search results / live filter） ─────────────── */

interface YtRenderer {
  videoRenderer?: {
    videoId?: string;
    title?: { runs?: Array<{ text: string }>; simpleText?: string };
    longBylineText?: { runs?: Array<{ text: string }> };
    ownerText?: { runs?: Array<{ text: string }> };
    thumbnail?: { thumbnails?: Array<{ url: string }> };
    channelThumbnailSupportedRenderers?: {
      channelThumbnailWithLinkRenderer?: {
        thumbnail?: { thumbnails?: Array<{ url: string }> };
      };
    };
    badges?: Array<{
      metadataBadgeRenderer?: { label?: string; style?: string };
    }>;
    viewCountText?: { runs?: Array<{ text: string }>; simpleText?: string };
    shortViewCountText?: {
      runs?: Array<{ text: string }>;
      simpleText?: string;
    };
  };
  continuationItemRenderer?: {
    continuationEndpoint?: {
      continuationCommand?: { token?: string };
    };
  };
}

function pickText(t: unknown): string | undefined {
  if (!t || typeof t !== "object") return undefined;
  const o = t as Record<string, unknown>;
  if (typeof o.simpleText === "string") return o.simpleText;
  if (Array.isArray(o.runs)) {
    return (o.runs as Array<{ text?: string }>)
      .map((r) => r?.text ?? "")
      .join("");
  }
  return undefined;
}

function parseViewCount(txt: string | undefined): number | undefined {
  if (!txt) return undefined;
  // 中文："1.2万人在看", "5,371 人观看", "watching"
  // 英文："1.2K watching", "5,371 watching now"
  const cleaned = txt.replace(/[,，]/g, "");
  const numMatch = cleaned.match(/([0-9]+(?:\.[0-9]+)?)\s*([KkMm万千])?/);
  if (!numMatch) return undefined;
  const n = parseFloat(numMatch[1]);
  const unit = numMatch[2];
  if (!unit) return Math.round(n);
  if (unit === "K" || unit === "k" || unit === "千") return Math.round(n * 1000);
  if (unit === "M" || unit === "m") return Math.round(n * 1_000_000);
  if (unit === "万") return Math.round(n * 10_000);
  return Math.round(n);
}

function mapVideoRenderer(
  r: NonNullable<YtRenderer["videoRenderer"]>
): NetLiveRoom | undefined {
  const vid = r.videoId;
  if (!vid) return undefined;
  const badges = r.badges ?? [];
  const isLive = badges.some(
    (b) =>
      b.metadataBadgeRenderer?.style?.toUpperCase().includes("LIVE") ||
      b.metadataBadgeRenderer?.label?.toUpperCase().includes("LIVE") ||
      b.metadataBadgeRenderer?.label?.includes("直播")
  );
  if (!isLive) return undefined; // search 返回的非直播视频跳过
  const title = pickText(r.title) ?? "";
  const uname =
    pickText(r.ownerText) ??
    pickText(r.longBylineText) ??
    undefined;
  const thumbs = r.thumbnail?.thumbnails ?? [];
  const cover = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : undefined;
  const avatarThumbs =
    r.channelThumbnailSupportedRenderers
      ?.channelThumbnailWithLinkRenderer?.thumbnail?.thumbnails ?? [];
  const avatar =
    avatarThumbs.length > 0
      ? avatarThumbs[avatarThumbs.length - 1].url
      : undefined;
  const viewText =
    pickText(r.viewCountText) ?? pickText(r.shortViewCountText) ?? undefined;
  return {
    platform: "youtube",
    roomId: vid,
    title,
    uname,
    cover,
    avatar,
    online: parseViewCount(viewText),
    live: true,
    link: `https://www.youtube.com/watch?v=${vid}`,
  };
}

/* ─────────────── 列表抓取 ─────────────── */

/**
 * sp 参数（即过滤）：
 *  - `EgJAAQ%3D%3D` = base64({"2":"@"})  → 类型=直播
 *  这是 YouTube 内部 protobuf，固定值，长期稳定。
 */
const SP_LIVE = "EgJAAQ%3D%3D";

interface SearchPagePayload {
  contents?: {
    twoColumnSearchResultsRenderer?: {
      primaryContents?: {
        sectionListRenderer?: {
          contents?: Array<{
            itemSectionRenderer?: { contents?: YtRenderer[] };
            continuationItemRenderer?: YtRenderer["continuationItemRenderer"];
          }>;
        };
      };
    };
  };
  onResponseReceivedCommands?: Array<{
    appendContinuationItemsAction?: {
      continuationItems?: Array<{
        itemSectionRenderer?: { contents?: YtRenderer[] };
        continuationItemRenderer?: YtRenderer["continuationItemRenderer"];
      }>;
    };
  }>;
}

function collectFromSections(
  sections: Array<{
    itemSectionRenderer?: { contents?: YtRenderer[] };
    continuationItemRenderer?: YtRenderer["continuationItemRenderer"];
  }>
): { items: YtRenderer[]; continuation: string | undefined } {
  const items: YtRenderer[] = [];
  let continuation: string | undefined;
  for (const sec of sections) {
    if (sec.itemSectionRenderer?.contents) {
      items.push(...sec.itemSectionRenderer.contents);
    }
    if (sec.continuationItemRenderer) {
      const tok =
        sec.continuationItemRenderer.continuationEndpoint?.continuationCommand
          ?.token;
      if (tok) continuation = tok;
    }
  }
  return { items, continuation };
}

async function searchLive(
  keyword: string,
  page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const cKey = `search:${keyword}`;
  const map = cursorMap(cKey);

  let payload: SearchPagePayload;
  if (page === 1) {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(keyword)}&sp=${SP_LIVE}`;
    const html = await fetchHtml(url);
    payload = (extractInitialData(html) as SearchPagePayload) ?? {};
  } else {
    const continuation = map.get(page - 1);
    if (!continuation) {
      // 没缓存到上一页 continuation，无法翻
      return { list: [], hasMore: false };
    }
    const apiKey = await getInnertubeApiKey();
    if (!apiKey) return { list: [], hasMore: false };
    const res = await scriptFetch(
      `https://www.youtube.com/youtubei/v1/search?key=${apiKey}&prettyPrint=false`,
      {
        method: "POST",
        headers: { ...COMMON_HEADERS, "Content-Type": "application/json" },
        json: {
          context: {
            client: {
              clientName: "WEB",
              clientVersion: "2.20251101.00.00",
              hl: "zh-CN",
              gl: "US",
            },
          },
          continuation,
        },
        timeout: 25_000,
      }
    );
    if (!res.ok) return { list: [], hasMore: false };
    payload = (await res.json()) as SearchPagePayload;
  }

  const sections =
    payload.contents?.twoColumnSearchResultsRenderer?.primaryContents
      ?.sectionListRenderer?.contents ??
    payload.onResponseReceivedCommands?.[0]?.appendContinuationItemsAction
      ?.continuationItems ??
    [];
  const { items, continuation } = collectFromSections(sections);
  if (continuation) map.set(page, continuation);

  const list: NetLiveRoom[] = [];
  for (const it of items) {
    if (!it.videoRenderer) continue;
    const r = mapVideoRenderer(it.videoRenderer);
    if (r) list.push(r);
  }
  return { list, hasMore: !!continuation && list.length > 0 };
}

let cachedApiKey: string | null = null;
async function getInnertubeApiKey(): Promise<string | null> {
  if (cachedApiKey) return cachedApiKey;
  try {
    const html = await fetchHtml("https://www.youtube.com/");
    const m = html.match(/"INNERTUBE_API_KEY":\s*"([^"]+)"/);
    if (m) {
      cachedApiKey = m[1];
      return cachedApiKey;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function getRecommend(
  page: number,
  _pageSize: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  // 没有真正的"YouTube live 主页推荐"接口，用空关键字+直播过滤兜底
  return searchLive("", page);
}

async function search(
  keyword: string,
  page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  return searchLive(keyword, page);
}

/* ─────────────── 分类：用预置热门关键字 ─────────────── */

const PRESET_CATEGORIES: NetLiveCategory[] = [
  { id: "Gaming", name: "游戏" },
  { id: "Music", name: "音乐" },
  { id: "News", name: "新闻" },
  { id: "Sports", name: "体育" },
  { id: "Education", name: "教育" },
  { id: "Tech", name: "科技" },
  { id: "Vlog", name: "Vlog" },
  { id: "Talk", name: "脱口秀" },
];

async function getCategories(): Promise<NetLiveCategory[]> {
  return PRESET_CATEGORIES;
}

async function getCategoryRooms(
  categoryId: string,
  page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  return searchLive(categoryId, page);
}

/* ─────────────── 房间详情 ─────────────── */

interface YtPlayerResponse {
  playabilityStatus?: {
    status?: string;
    reason?: string;
  };
  videoDetails?: {
    videoId?: string;
    title?: string;
    author?: string;
    channelId?: string;
    isLive?: boolean;
    isLiveContent?: boolean;
    shortDescription?: string;
    thumbnail?: { thumbnails?: Array<{ url: string }> };
    viewCount?: string;
  };
  streamingData?: {
    hlsManifestUrl?: string;
    dashManifestUrl?: string;
    adaptiveFormats?: Array<{ url?: string; mimeType?: string }>;
  };
  microformat?: {
    playerMicroformatRenderer?: {
      liveBroadcastDetails?: {
        isLiveNow?: boolean;
        startTimestamp?: string;
      };
    };
  };
}

async function fetchPlayerResponse(
  videoId: string
): Promise<YtPlayerResponse | null> {
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const html = await fetchHtml(url);
  return (extractPlayerResponse(html) as YtPlayerResponse) ?? null;
}

async function getRoomDetail(roomId: string): Promise<NetLiveRoom> {
  const p = await fetchPlayerResponse(roomId);
  if (!p?.videoDetails) throw new Error(`YouTube 视频 ${roomId} 未找到`);
  const v = p.videoDetails;
  const thumbs = v.thumbnail?.thumbnails ?? [];
  const cover = thumbs.length > 0 ? thumbs[thumbs.length - 1].url : undefined;
  return {
    platform: "youtube",
    roomId: v.videoId ?? roomId,
    title: v.title ?? "",
    uname: v.author,
    avatar: undefined,
    cover,
    online: v.viewCount ? parseInt(v.viewCount, 10) || 0 : 0,
    introduction: v.shortDescription,
    live: !!v.isLive,
    link: `https://www.youtube.com/watch?v=${v.videoId ?? roomId}`,
  };
}

async function getLiveStatus(roomId: string): Promise<boolean> {
  try {
    const p = await fetchPlayerResponse(roomId);
    return p?.playabilityStatus?.status === "OK" && !!p?.videoDetails?.isLive;
  } catch {
    return false;
  }
}

/* ─────────────── resolve ─────────────── */

async function resolve(roomId: string): Promise<NetLiveStream> {
  const p = await fetchPlayerResponse(roomId);
  if (!p) throw new Error(`YouTube 视频 ${roomId} 未找到`);
  if (p.playabilityStatus?.status && p.playabilityStatus.status !== "OK") {
    throw new Error(
      p.playabilityStatus.reason || `YouTube 状态 ${p.playabilityStatus.status}`
    );
  }
  const hls = p.streamingData?.hlsManifestUrl;
  if (!hls) {
    throw new Error("YouTube 未返回 HLS 流（非直播 / 已结束）");
  }
  return {
    url: hls,
    streamType: "hls",
    qn: "auto",
    qnLabel: "自适应",
    referer: REFERER,
    ua: UA,
  };
}

/* ─────────────── 导出 ─────────────── */

export const youtubeAdapter: NetLiveAdapter = {
  platform: "youtube",
  getRecommend,
  search,
  resolve,
  getCategories,
  getCategoryRooms,
  getRoomDetail,
  getLiveStatus,
};
