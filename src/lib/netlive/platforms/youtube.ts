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
import { createPlatformFetch } from "@/lib/netlive/scriptFetch";
const scriptFetch = createPlatformFetch("youtube");
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
  const html = await res.text();
  return html;
}

/** 检测 YouTube 反机器人风控页 —— html 含特定 sign-in/recaptcha 标记则真的没辙。 */
function looksLikeBotChallenge(html: string): boolean {
  return (
    /confirm.+not.+bot|请登录.+不是聊天机器人|sign in to confirm/i.test(html) ||
    /class="g-recaptcha"/.test(html)
  );
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
  // 关键策略（参考 yt-dlp _DEFAULT_CLIENTS=(android_vr, web_safari)）：
  //   **直接** 用 Innertube /player 端点，**不**先访问 watch 页。
  //   watch 页才有"请登录确认非机器人"风控；Innertube 端不会下发同样的挑战页。
  //   只有当所有 Innertube client 都拿不到 streamingData 时，才退到 watch 页兜底。
  let innertubeError: Error | null = null;
  try {
    const fromInnertube = await fetchPlayerResponseInnertube(videoId);
    if (fromInnertube) return fromInnertube;
  } catch (e) {
    innertubeError = e instanceof Error ? e : new Error(String(e));
  }

  // 兜底：抓 watch 页 HTML（搜索 / 列表都靠这条，这里复用）
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  try {
    const html = await fetchHtml(url);
    if (looksLikeBotChallenge(html)) {
      throw new Error(
        innertubeError
          ? `Innertube 全 client 失败 + watch 页被反机器人拦截。Innertube 最后报错：${innertubeError.message}`
          : "YouTube 触发反机器人风控（需登录 / poToken）—— 此为 YouTube 政策限制，匿名抓取暂无解。建议改看 Twitch / Bigo / 17Live。"
      );
    }
    const fromWatch = extractPlayerResponse(html) as YtPlayerResponse | null;
    if (fromWatch) return fromWatch;
  } catch (e) {
    throw e instanceof Error
      ? e
      : new Error("YouTube 拉流失败（Innertube + watch 页两路都未返 streamingData）");
  }
  if (innertubeError) throw innertubeError;
  return null;
}

interface InnertubeClient {
  clientName: string;
  clientVersion: string;
  /** X-YouTube-Client-Name 数字 ID */
  clientNumber: number;
  userAgent: string;
  androidSdkVersion?: number;
  osName?: string;
  osVersion?: string;
  deviceMake?: string;
  deviceModel?: string;
  /** 某些 embed 客户端需带 thirdParty.embedUrl */
  asEmbed?: boolean;
  /** Innertube host：mweb 用 m.youtube.com，其它用 www.youtube.com */
  host?: string;
}

/**
 * yt-dlp v2024+ 的默认匿名客户端顺序（参考 yt_dlp/extractor/youtube/_base.py）：
 *   1. android_vr —— Oculus Quest 3，无 PO Token 要求，最稳
 *   2. tv (TVHTML5) —— Smart TV，反爬极宽松
 *   3. mweb —— 移动 web，HLS 直播专长
 *   4. web_safari —— Safari UA 的 WEB，能拿 pre-merged HLS
 *   5. ios —— iOS 客户端
 *
 * 每个 client 都按真实 YouTube 客户端发包：clientNumber + userAgent + 完整 context。
 */
const INNERTUBE_CLIENTS: InnertubeClient[] = [
  // ─── android_vr：yt-dlp 首选，无 PoToken 要求，REQUIRE_JS_PLAYER=False ───
  {
    clientName: "ANDROID_VR",
    clientVersion: "1.65.10",
    clientNumber: 28,
    deviceMake: "Oculus",
    deviceModel: "Quest 3",
    androidSdkVersion: 32,
    osName: "Android",
    osVersion: "12L",
    userAgent:
      "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
  },
  // ─── tv (TVHTML5)：Smart TV Cobalt 客户端 ───
  {
    clientName: "TVHTML5",
    clientVersion: "7.20260114.12.00",
    clientNumber: 7,
    userAgent:
      "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/25.lts.30.1034943-gold (unlike Gecko), Unknown_TV_Unknown_0/Unknown (Unknown, Unknown)",
  },
  // ─── mweb：移动 web，HLS 直播最稳 ───
  {
    clientName: "MWEB",
    clientVersion: "2.20260115.01.00",
    clientNumber: 2,
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 16_7_10 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1,gzip(gfe)",
    host: "m.youtube.com",
  },
  // ─── web_safari：Safari UA + WEB，返 pre-merged HLS formats ───
  {
    clientName: "WEB",
    clientVersion: "2.20260114.08.00",
    clientNumber: 1,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Safari/605.1.15,gzip(gfe)",
  },
  // ─── ios：iOS YouTube app ───
  {
    clientName: "IOS",
    clientVersion: "21.02.3",
    clientNumber: 5,
    deviceMake: "Apple",
    deviceModel: "iPhone16,2",
    osName: "iPhone",
    osVersion: "18.3.2.22D82",
    userAgent:
      "com.google.ios.youtube/21.02.3 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
  },
  // ─── web_embedded：嵌入式播放器，最后兜底 ───
  {
    clientName: "WEB_EMBEDDED_PLAYER",
    clientVersion: "1.20260115.01.00",
    clientNumber: 56,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    asEmbed: true,
  },
];

async function fetchPlayerResponseInnertube(
  videoId: string
): Promise<YtPlayerResponse | null> {
  const apiKey = await getInnertubeApiKey();
  // YouTube web 公开常量 API key（多年未变；其它 client 用同一 key 也能通）
  const key = apiKey ?? "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
  // 收集每个 client 的状态，全失败时拿来报错（比 "拉流失败" 更具体）
  const statusReasons: string[] = [];
  for (const client of INNERTUBE_CLIENTS) {
    try {
      const host = client.host ?? "www.youtube.com";
      const origin = `https://${host}`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": client.userAgent,
        "X-YouTube-Client-Name": String(client.clientNumber),
        "X-YouTube-Client-Version": client.clientVersion,
        Origin: origin,
        Referer: `${origin}/`,
        "Accept-Language": "en-US,en;q=0.9",
      };

      const clientCtx: Record<string, unknown> = {
        clientName: client.clientName,
        clientVersion: client.clientVersion,
        userAgent: client.userAgent,
        hl: "en",
        gl: "US",
        // yt-dlp `_extract_context()` 强制塞这俩 —— Google 后端用来判定是否真实客户端
        timeZone: "UTC",
        utcOffsetMinutes: 0,
      };
      if (client.androidSdkVersion !== undefined)
        clientCtx.androidSdkVersion = client.androidSdkVersion;
      if (client.osName) clientCtx.osName = client.osName;
      if (client.osVersion) clientCtx.osVersion = client.osVersion;
      if (client.deviceMake) clientCtx.deviceMake = client.deviceMake;
      if (client.deviceModel) clientCtx.deviceModel = client.deviceModel;

      const ctx: Record<string, unknown> = { client: clientCtx };
      if (client.asEmbed) {
        ctx.thirdParty = { embedUrl: "https://www.youtube.com" };
      }

      // 完整请求体 = yt-dlp `_generate_player_context()` + checkok 参数
      const reqBody: Record<string, unknown> = {
        context: ctx,
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
        playbackContext: {
          contentPlaybackContext: {
            html5Preference: "HTML5_PREF_WANTS",
          },
        },
      };

      const res = await scriptFetch(
        `${origin}/youtubei/v1/player?key=${key}&prettyPrint=false`,
        {
          method: "POST",
          headers,
          json: reqBody,
          timeout: 25_000,
          http2: true,
        }
      );
      if (!res.ok) {
        statusReasons.push(`${client.clientName}: HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json<YtPlayerResponse>()) ?? null;
      if (!data) {
        statusReasons.push(`${client.clientName}: 空响应`);
        continue;
      }
      // 拿到 streamingData → 成功
      if (
        data.streamingData?.hlsManifestUrl ||
        data.streamingData?.dashManifestUrl
      ) {
        return data;
      }
      // 没 streamingData → 记下 playabilityStatus 以备最终报错
      const status = data.playabilityStatus?.status ?? "NO_STREAMING_DATA";
      const reason = data.playabilityStatus?.reason ?? "无明确原因";
      statusReasons.push(`${client.clientName}: ${status} — ${reason}`);
    } catch (e) {
      statusReasons.push(
        `${client.clientName}: ${(e as Error).message ?? String(e)}`
      );
    }
  }
  // 全失败 —— 抛带具体原因的错（取最后一个 client 的 reason，通常最具描述性）
  if (statusReasons.length > 0) {
    const lastReason = statusReasons[statusReasons.length - 1];
    throw new Error(
      `YouTube Innertube 全 ${INNERTUBE_CLIENTS.length} 个 client 均失败，最后：${lastReason}`
    );
  }
  return null;
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
  const status = p.playabilityStatus?.status;
  if (status && status !== "OK" && status !== "LIVE_STREAM_OFFLINE") {
    // UNPLAYABLE / ERROR / LOGIN_REQUIRED 等 —— 抛具体 reason 让 UI 显示
    throw new Error(
      `${p.playabilityStatus?.reason || `YouTube 状态 ${status}`}（可能是直播已结束 / 区域限制 / 嵌入禁用）`
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
