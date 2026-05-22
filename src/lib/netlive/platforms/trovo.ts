/**
 * Trovo 直播 adapter —— Tencent 旗下国际版游戏直播平台。
 *
 * Trovo 的 GraphQL endpoint（api-web.trovo.live/graphql）对 op 名/参数极敏感，
 * 改名后 500。改走更稳的路径：
 *   - 列表：抓 `https://trovo.live` 主页 / 分类页 HTML，提 `__NEXT_DATA__`
 *   - 详情：抓 `https://trovo.live/s/{slug}` HTML 解析 `playInfos`
 *
 * roomId = streamerName / userName（slug）。
 */
import { scriptFetch } from "@/source-script/fetch";
import type {
  NetLiveAdapter,
  NetLiveCategory,
  NetLiveRoom,
  NetLiveStream,
} from "../types";
import { NetLiveListUnsupportedError } from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const REFERER = "https://trovo.live/";

const HTML_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Referer: REFERER,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

async function fetchHtml(url: string): Promise<string> {
  const res = await scriptFetch(url, {
    method: "GET",
    headers: HTML_HEADERS,
    timeout: 25_000,
    http2: true,
  });
  if (!res.ok) throw new Error(`Trovo HTTP ${res.status}`);
  return res.text();
}

/** 从 HTML 提取 `<script id="__NEXT_DATA__" type="application/json">{...}</script>` */
function extractNextData(html: string): unknown | null {
  const m = html.match(
    /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

interface TvLive {
  liveID?: string;
  streamerName?: string;
  userName?: string;
  username?: string;
  title?: string;
  channelName?: string;
  watchedNum?: number;
  thumbnail?: string;
  profilePic?: string;
  faceUrl?: string;
  faceUrlV2?: string;
  categoryName?: string;
  liveStatus?: number;
  isLive?: boolean;
  playInfos?: Array<{
    playUrl?: string;
    desc?: string;
    bitrate?: number;
    qualityId?: string;
  }>;
}

function mapLive(l: TvLive): NetLiveRoom | undefined {
  const slug = l.streamerName ?? l.userName ?? l.username;
  if (!slug) return undefined;
  return {
    platform: "trovo",
    roomId: slug,
    title: l.title ?? slug,
    uname: l.channelName ?? slug,
    avatar: l.faceUrl ?? l.faceUrlV2 ?? l.profilePic,
    cover: l.thumbnail,
    online: l.watchedNum ?? 0,
    category: l.categoryName,
    live: l.isLive ?? l.liveStatus === 1,
    link: `https://trovo.live/s/${slug}`,
  };
}

/** 递归走 props 找出 liveInfos 数组 */
function findLives(node: unknown, out: TvLive[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const it of node) findLives(it, out);
    return;
  }
  const o = node as Record<string, unknown>;
  // 命中：含 streamerName/userName + thumbnail/title 的对象
  if (
    (typeof o.streamerName === "string" ||
      typeof o.userName === "string") &&
    typeof o.thumbnail === "string"
  ) {
    out.push(o as TvLive);
    return;
  }
  for (const k of Object.keys(o)) {
    findLives(o[k], out);
  }
}

/* ─────────────── 推荐 ─────────────── */

async function getRecommend(
  page: number,
  _pageSize: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  if (page > 1) return { list: [], hasMore: false }; // HTML scrape 不分页
  const reasons: string[] = [];

  // 主页 HTML 抓 __NEXT_DATA__
  try {
    const html = await fetchHtml("https://trovo.live/");
    const data = extractNextData(html);
    if (!data) {
      reasons.push("trovo.live 主页未找到 __NEXT_DATA__ 嵌入（可能页面结构改了）");
    } else {
      const arr: TvLive[] = [];
      findLives(data, arr);
      const seen = new Set<string>();
      const list: NetLiveRoom[] = [];
      for (const l of arr) {
        const slug = l.streamerName ?? l.userName ?? l.username;
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        const r = mapLive(l);
        if (r) list.push(r);
      }
      if (list.length > 0) return { list, hasMore: false };
      reasons.push(`trovo.live 主页 __NEXT_DATA__ 解析 0 条直播间`);
    }
  } catch (e) {
    reasons.push(`trovo.live 主页：${(e as Error).message ?? String(e)}`);
  }

  // 备用：browse / explore 路径
  for (const path of ["/browse", "/explore"]) {
    try {
      const html = await fetchHtml(`https://trovo.live${path}`);
      const data = extractNextData(html);
      if (data) {
        const arr: TvLive[] = [];
        findLives(data, arr);
        const seen = new Set<string>();
        const list: NetLiveRoom[] = [];
        for (const l of arr) {
          const slug = l.streamerName ?? l.userName ?? l.username;
          if (!slug || seen.has(slug)) continue;
          seen.add(slug);
          const r = mapLive(l);
          if (r) list.push(r);
        }
        if (list.length > 0) return { list, hasMore: false };
        reasons.push(`trovo.live${path}: 0 条`);
      } else {
        reasons.push(`trovo.live${path}: 无 __NEXT_DATA__`);
      }
    } catch (e) {
      reasons.push(`trovo.live${path}: ${(e as Error).message ?? String(e)}`);
    }
  }

  // 已验证：Trovo 内部 GraphQL 不存在公开的"推荐 / 首页 list" op（all 19504）。
  // search 可用，UI 引导用搜索；这里抛 sentinel error 让 UI 显示友好提示。
  throw new NetLiveListUnsupportedError(
    "Trovo",
    "Trovo 内部 GraphQL 无公开的推荐列表 op，请用搜索或输入主播 username"
  );
}

/* ─────────────── 分类 ─────────────── */

const PRESET_CATEGORIES: NetLiveCategory[] = [
  { id: "Just_Chatting", name: "聊天" },
  { id: "Music", name: "音乐" },
  { id: "League_of_Legends", name: "LoL" },
  { id: "Counter-Strike_2", name: "CS2" },
  { id: "VALORANT", name: "Valorant" },
  { id: "Minecraft", name: "Minecraft" },
  { id: "GTA_V", name: "GTA V" },
  { id: "Fortnite", name: "Fortnite" },
];

async function getCategories(): Promise<NetLiveCategory[]> {
  return PRESET_CATEGORIES;
}

async function getCategoryRooms(
  categoryId: string,
  page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  // 1) 优先用 search GraphQL，把 categoryId 当作搜索关键字（如 "Minecraft"、"VALORANT"），
  //    比 HTML scrape 稳得多；Trovo 内部"列表"GraphQL op 全部 19504（探测确认不存在）。
  try {
    return await search(categoryId.replace(/_/g, " "), page);
  } catch {
    /* fall through */
  }
  // 2) HTML fallback（多半空，但保留兼容）
  if (page > 1) return { list: [], hasMore: false };
  try {
    const html = await fetchHtml(
      `https://trovo.live/category/${encodeURIComponent(categoryId)}`
    );
    const data = extractNextData(html);
    const arr: TvLive[] = [];
    findLives(data, arr);
    const seen = new Set<string>();
    const list: NetLiveRoom[] = [];
    for (const l of arr) {
      const slug = l.streamerName ?? l.userName ?? l.username;
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      const r = mapLive(l);
      if (r) list.push(r);
    }
    return { list, hasMore: false };
  } catch {
    return { list: [], hasMore: false };
  }
}

/* ─────────────── 搜索 ─────────────── */

/** search_SearchService_Search 响应 —— 真实嗅探确认的字段（params: {query, limit, offset}） */
interface TvSearchStreamer {
  userInfo?: {
    uid?: number;
    userName?: string;
    nickName?: string;
    faceUrl?: string;
    spaceInfo?: { terminalSpaceID?: { roomID?: number; spaceName?: string } };
  };
  programInfo?: {
    id?: string;
    title?: string;
    coverUrl?: string;
  } | null;
  categoryInfo?: { shortName?: string; name?: string } | null;
  channelInfo?: { viewers?: number } | null;
  isLive?: number;
  followers?: number;
}

interface TvSearchResp {
  data?: {
    search_SearchService_Search?: {
      streamerData?: { streamerInfos?: TvSearchStreamer[] };
    };
  };
  errors?: Array<{ message: string }>;
}

async function search(
  keyword: string,
  page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const pageSize = 20;
  const offset = Math.max(0, (page - 1) * pageSize);
  // 真实可用：search_SearchService_Search({query, limit, offset})
  try {
    const qid = generateQid();
    const res = await scriptFetch(
      `https://api-web.trovo.live/graphql?qid=${qid}`,
      {
        method: "POST",
        headers: {
          "User-Agent": UA,
          Origin: "https://trovo.live",
          Referer: REFERER,
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "en-US,en;q=0.9",
        },
        json: [
          {
            operationName: "search_SearchService_Search",
            variables: {
              params: { query: keyword, limit: pageSize, offset },
            },
          },
        ],
        timeout: 20_000,
        http2: true,
      }
    );
    if (!res.ok) throw new Error(`Trovo search HTTP ${res.status}`);
    const arr = await res.json<TvSearchResp[]>();
    const streamers = arr?.[0]?.data?.search_SearchService_Search?.streamerData?.streamerInfos ?? [];
    const list: NetLiveRoom[] = [];
    const seen = new Set<string>();
    for (const s of streamers) {
      const slug = s.userInfo?.userName;
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      list.push({
        platform: "trovo",
        roomId: slug,
        title: s.programInfo?.title ?? s.userInfo?.nickName ?? slug,
        uname: s.userInfo?.nickName ?? slug,
        avatar: s.userInfo?.faceUrl,
        cover: s.programInfo?.coverUrl,
        online: s.channelInfo?.viewers ?? 0,
        category: s.categoryInfo?.shortName ?? s.categoryInfo?.name,
        live: s.isLive === 1,
        link: `https://trovo.live/s/${slug}`,
      });
    }
    return { list, hasMore: streamers.length >= pageSize };
  } catch {
    // GraphQL 失败时退到 HTML scrape（多半也空，但保留兼容）
    try {
      const html = await fetchHtml(
        `https://trovo.live/search?keyword=${encodeURIComponent(keyword)}`
      );
      const data = extractNextData(html);
      const arr: TvLive[] = [];
      findLives(data, arr);
      const seen = new Set<string>();
      const list: NetLiveRoom[] = [];
      for (const l of arr) {
        const slug = l.streamerName ?? l.userName ?? l.username;
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        const r = mapLive(l);
        if (r) list.push(r);
      }
      return { list, hasMore: false };
    } catch {
      return { list: [], hasMore: false };
    }
  }
}

/* ─────────────── 房间详情 + resolve ─────────────── */

/** streamlink trovo.py 验证的真实 endpoint：api-web.trovo.live/graphql + batch 数组 body + qid 随机 query */
interface TvGqlLiveInfo {
  streamerInfo: {
    userName: string;
    nickName?: string;
    faceUrl?: string;
  };
  programInfo: {
    id: string;
    title: string;
    coverUrl?: string;
    streamInfo: Array<{
      desc: string;
      playUrl: string;
      bitrate?: number;
    }>;
  };
  categoryInfo: {
    shortName: string;
  };
  isLive: number;
  watchedNum?: number;
}

interface TvGqlEnvelope {
  data?: {
    live_LiveReaderService_GetLiveInfo?: TvGqlLiveInfo;
  };
  errors?: Array<{ message: string }>;
}

/** 16 字符大写 hex —— 等价 streamlink `secrets.token_hex(8).upper()` */
function generateQid(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s.toUpperCase();
}

async function fetchGraphQLLive(userName: string): Promise<TvGqlLiveInfo | null> {
  const qid = generateQid();
  const body = [
    {
      operationName: "live_LiveReaderService_GetLiveInfo",
      variables: { params: { userName } },
    },
  ];
  const res = await scriptFetch(
    `https://api-web.trovo.live/graphql?qid=${qid}`,
    {
      method: "POST",
      headers: {
        "User-Agent": UA,
        Origin: "https://trovo.live",
        Referer: REFERER,
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
      },
      json: body,
      timeout: 20_000,
      http2: true,
    }
  );
  if (!res.ok) throw new Error(`Trovo GraphQL HTTP ${res.status}`);
  const arr = await res.json<TvGqlEnvelope[]>();
  const env = Array.isArray(arr) ? arr[0] : null;
  if (!env) return null;
  if (env.errors && env.errors.length > 0) {
    throw new Error(`Trovo GraphQL: ${env.errors.map((e) => e.message).join("; ")}`);
  }
  return env.data?.live_LiveReaderService_GetLiveInfo ?? null;
}

/** 兜底：从 https://trovo.live/s/{slug} 主页扫 __NEXT_DATA__（旧/废弃路径，仅 SSR 命中时有用） */
async function fetchLiveInfo(slug: string): Promise<TvLive | null> {
  try {
    const html = await fetchHtml(`https://trovo.live/s/${encodeURIComponent(slug)}`);
    const data = extractNextData(html);
    const arr: TvLive[] = [];
    findLives(data, arr);
    const live = arr.find(
      (l) =>
        (l.streamerName === slug ||
          l.userName === slug ||
          l.username === slug) &&
        l.playInfos &&
        l.playInfos.length > 0
    );
    if (live) return live;
    const fallback = arr.find(
      (l) => l.streamerName === slug || l.userName === slug || l.username === slug
    );
    return fallback ?? null;
  } catch {
    return null;
  }
}

function mapGqlLive(g: TvGqlLiveInfo, slug: string): NetLiveRoom {
  return {
    platform: "trovo",
    roomId: slug,
    title: g.programInfo.title || slug,
    uname: g.streamerInfo.nickName ?? g.streamerInfo.userName,
    avatar: g.streamerInfo.faceUrl,
    cover: g.programInfo.coverUrl,
    online: g.watchedNum ?? 0,
    category: g.categoryInfo.shortName,
    live: g.isLive === 1,
    link: `https://trovo.live/s/${slug}`,
  };
}

async function getRoomDetail(roomId: string): Promise<NetLiveRoom> {
  try {
    const g = await fetchGraphQLLive(roomId);
    if (g) return mapGqlLive(g, roomId);
  } catch {
    /* fall through to HTML */
  }
  const info = await fetchLiveInfo(roomId);
  if (info) {
    const mapped = mapLive(info);
    if (mapped) return mapped;
  }
  throw new Error(`Trovo 房间 ${roomId} 未找到`);
}

async function getLiveStatus(roomId: string): Promise<boolean> {
  try {
    const g = await fetchGraphQLLive(roomId);
    if (g) return g.isLive === 1;
  } catch {
    /* fall through */
  }
  const info = await fetchLiveInfo(roomId);
  return !!info?.isLive || info?.liveStatus === 1;
}

async function resolve(roomId: string): Promise<NetLiveStream> {
  // streamlink 验证路径：GraphQL → programInfo.streamInfo[].playUrl，FLV `.flv?` 替换为 `.m3u8?` 得 HLS
  let gqlErr: Error | null = null;
  try {
    const g = await fetchGraphQLLive(roomId);
    if (g) {
      if (g.isLive !== 1) throw new Error("Trovo 未开播");
      const variants = (g.programInfo.streamInfo ?? [])
        .map((s) => {
          if (!s.playUrl) return null;
          // protocol-relative `//xxx` 补 https；FLV → HLS
          const httpsUrl = s.playUrl.startsWith("//") ? `https:${s.playUrl}` : s.playUrl;
          const hlsUrl = httpsUrl.replace(".flv?", ".m3u8?");
          return {
            qn: s.desc,
            label: s.desc === "source" ? "原画" : s.desc,
            url: hlsUrl,
            bitrate: s.bitrate ?? 0,
          };
        })
        .filter((v): v is NonNullable<typeof v> => !!v);
      if (variants.length === 0) {
        throw new Error("Trovo streamInfo 为空（房间未开播）");
      }
      // source 永远优先，其余按 bitrate 倒序
      variants.sort((a, b) => {
        if (a.qn === "source" && b.qn !== "source") return -1;
        if (b.qn === "source" && a.qn !== "source") return 1;
        return (b.bitrate ?? 0) - (a.bitrate ?? 0);
      });
      const best = variants[0];
      return {
        url: best.url,
        streamType: best.url.includes(".m3u8") ? "hls" : "flv",
        qn: best.qn,
        qnLabel: best.label,
        alternatives:
          variants.length > 1
            ? variants.map((v) => ({ qn: v.qn, label: v.label, url: v.url }))
            : undefined,
        referer: REFERER,
        ua: UA,
      };
    }
  } catch (e) {
    gqlErr = e as Error;
  }

  // HTML fallback（很可能也拿不到，但保留兼容）
  const info = await fetchLiveInfo(roomId);
  if (!info) {
    throw new Error(
      `Trovo 房间 ${roomId} 未找到${gqlErr ? `（GraphQL: ${gqlErr.message}）` : ""}`
    );
  }
  const plays = info.playInfos ?? [];
  if (plays.length === 0) {
    throw new Error("Trovo 未返回 playInfos（房间未开播）");
  }
  const sorted = [...plays].sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
  const best = sorted[0];
  if (!best.playUrl) throw new Error("Trovo playUrl 为空");
  const alternatives = sorted
    .filter((p) => !!p.playUrl)
    .map((p) => ({
      qn: p.qualityId ?? p.desc ?? String(p.bitrate ?? 0),
      label: p.desc ?? `${p.bitrate ?? 0}kbps`,
      url: p.playUrl!,
    }));
  return {
    url: best.playUrl,
    streamType: best.playUrl.includes(".m3u8") ? "hls" : "flv",
    qn: best.qualityId ?? best.desc ?? "auto",
    qnLabel: best.desc ?? "原画",
    alternatives: alternatives.length > 1 ? alternatives : undefined,
    referer: REFERER,
    ua: UA,
  };
}

/* ─────────────── 导出 ─────────────── */

export const trovoAdapter: NetLiveAdapter = {
  platform: "trovo",
  getRecommend,
  search,
  resolve,
  getCategories,
  getCategoryRooms,
  getRoomDetail,
  getLiveStatus,
};
