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
  const html = await fetchHtml("https://trovo.live/");
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

async function search(
  keyword: string,
  _page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
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

/* ─────────────── 房间详情 + resolve ─────────────── */

async function fetchLiveInfo(slug: string): Promise<TvLive | null> {
  try {
    const html = await fetchHtml(`https://trovo.live/s/${encodeURIComponent(slug)}`);
    const data = extractNextData(html);
    const arr: TvLive[] = [];
    findLives(data, arr);
    // 找到含 playInfos 的那个
    const live = arr.find(
      (l) =>
        (l.streamerName === slug ||
          l.userName === slug ||
          l.username === slug) &&
        l.playInfos &&
        l.playInfos.length > 0
    );
    if (live) return live;
    // 退而求其次：第一个 match slug 的
    const fallback = arr.find(
      (l) => l.streamerName === slug || l.userName === slug || l.username === slug
    );
    return fallback ?? null;
  } catch {
    return null;
  }
}

async function getRoomDetail(roomId: string): Promise<NetLiveRoom> {
  const info = await fetchLiveInfo(roomId);
  if (!info) throw new Error(`Trovo 房间 ${roomId} 未找到`);
  const mapped = mapLive(info);
  if (mapped) return mapped;
  return {
    platform: "trovo",
    roomId,
    title: roomId,
    uname: roomId,
    live: false,
    link: `https://trovo.live/s/${roomId}`,
  };
}

async function getLiveStatus(roomId: string): Promise<boolean> {
  const info = await fetchLiveInfo(roomId);
  return !!info?.isLive || info?.liveStatus === 1;
}

async function resolve(roomId: string): Promise<NetLiveStream> {
  const info = await fetchLiveInfo(roomId);
  if (!info) throw new Error(`Trovo 房间 ${roomId} 未找到`);
  const plays = info.playInfos ?? [];
  if (plays.length === 0) {
    throw new Error("Trovo 未返回 playInfos（房间未开播）");
  }
  // 选最高 bitrate
  const sorted = [...plays].sort(
    (a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0)
  );
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
