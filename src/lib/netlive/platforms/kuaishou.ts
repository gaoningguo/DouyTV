/**
 * 快手直播 adapter —— 移植自 pure_live `lib/core/site/kuaishou_site.dart`。
 *
 * 实现范围：
 *   - getRecommend：`live_api/home/list`，结构 = data.list[].gameLiveInfo[].liveInfo[]
 *   - getCategories：8 个父类硬编码 + 分页拉 `live_api/category/data?type=N&page=&size=`
 *   - getCategoryRooms：`live_api/gameboard/list`（短 areaId）/ `live_api/non-gameboard/list`（长 areaId）
 *   - getRoomDetail / resolve：抓 `live.kuaishou.com/u/{roomId}` HTML，正则提 `__INITIAL_STATE__`，
 *     拿 playList[0].liveStream.playUrls → h264.adaptationSet.representation[].url
 *
 * 快手无重度签名，但需要 ttwid 类 cookie（首次访问页面 set-cookie 即可）。
 * 搜索接口走不通（pure_live 直接返回空），保持一致。
 */
import { createPlatformFetch } from "@/lib/netlive/scriptFetch";
const scriptFetch = createPlatformFetch("kuaishou");
import type {
  NetLiveAdapter,
  NetLiveCategory,
  NetLiveRoom,
  NetLiveStream,
} from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

/** 生成 36 位随机 did（pure_live 同款模式） */
function randomDid(): string {
  let s = "";
  for (let i = 0; i < 36; i++) {
    s += Math.floor(Math.random() * 16).toString(16);
  }
  return `web_${s}`;
}

// 持久化一个 did —— 同一 process 内复用，避免每次切房间换 did 被风控盯上
const SESSION_DID = randomDid();
const SESSION_CLIENTID = "3";

const HEADERS_BASE: Record<string, string> = {
  "User-Agent": UA,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Connection: "keep-alive",
  Referer: "https://live.kuaishou.com/",
  Origin: "https://live.kuaishou.com",
  Cookie: `did=${SESSION_DID};clientid=${SESSION_CLIENTID};kpf=PC_WEB;kpn=GAME_ZONE`,
  "Sec-Ch-Ua":
    '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
};

const IMAGE_EXTS = new Set([
  "svgz",
  "pjp",
  "png",
  "ico",
  "avif",
  "tiff",
  "tif",
  "jfif",
  "svg",
  "xbm",
  "pjpeg",
  "webp",
  "jpg",
  "jpeg",
  "bmp",
  "gif",
]);

function isImage(url: string): boolean {
  if (!url) return false;
  const ext = url.split(".").pop() ?? "";
  return IMAGE_EXTS.has(ext.toLowerCase());
}

function normalizeCover(poster: string | undefined): string | undefined {
  if (!poster) return undefined;
  return isImage(poster) ? poster : `${poster}.jpg`;
}

async function fetchJson<T>(
  url: string,
  init: { headers?: Record<string, string> } = {}
): Promise<T> {
  const res = await scriptFetch(url, {
    method: "GET",
    headers: { ...HEADERS_BASE, ...init.headers },
    timeout: 20_000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json<T>();
}

async function fetchText(
  url: string,
  init: { headers?: Record<string, string> } = {}
): Promise<string> {
  const res = await scriptFetch(url, {
    method: "GET",
    headers: { ...HEADERS_BASE, ...init.headers },
    timeout: 20_000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

/* ─────────────── 推荐 ─────────────── */

interface KsHomeAuthor {
  id?: string;
  name?: string;
  avatar?: string;
  description?: string;
}
interface KsHomeGameInfo {
  name?: string;
  poster?: string;
}
interface KsHomeLiveInfo {
  author?: KsHomeAuthor;
  gameInfo?: KsHomeGameInfo;
  watchingCount?: number | string;
  playUrls?: KsPlayUrls;
}
interface KsHomeResp {
  data?: {
    list?: Array<{
      gameLiveInfo?: Array<{
        liveInfo?: KsHomeLiveInfo[];
      }>;
    }>;
  };
}

function authorDescription(d: string | undefined): string {
  return d ? d.replace(/\n/g, " ") : "";
}

function parseWatching(v: number | string | undefined): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number") return v;
  const n = parseInt(v, 10);
  return isNaN(n) ? undefined : n;
}

async function getRecommend(
  _page: number,
  _pageSize: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const data = await fetchJson<KsHomeResp>(
    "https://live.kuaishou.com/live_api/home/list"
  );
  const list: NetLiveRoom[] = [];
  for (const item of data.data?.list ?? []) {
    for (const sub of item.gameLiveInfo ?? []) {
      for (const t of sub.liveInfo ?? []) {
        const author = t.author;
        if (!author?.id) continue;
        list.push({
          platform: "kuaishou",
          roomId: author.id,
          title: authorDescription(author.description),
          cover: normalizeCover(t.gameInfo?.poster),
          uname: author.name,
          avatar: author.avatar,
          online: parseWatching(t.watchingCount),
          category: t.gameInfo?.name,
          introduction: authorDescription(author.description),
          live: true,
          link: `https://live.kuaishou.com/u/${author.id}`,
        });
      }
    }
  }
  return { list, hasMore: false };
}

/* ─────────────── 分类 ─────────────── */

const PARENT_CATS: Array<{ id: string; name: string }> = [
  { id: "1", name: "热门" },
  { id: "2", name: "网游" },
  { id: "3", name: "单机" },
  { id: "4", name: "手游" },
  { id: "5", name: "棋牌" },
  { id: "6", name: "娱乐" },
  { id: "7", name: "综合" },
  { id: "8", name: "文化" },
];

interface KsCateListResp {
  data?: {
    list?: Array<{ id?: string; name?: string; poster?: string }>;
  };
}

async function getCategories(): Promise<NetLiveCategory[]> {
  const out: NetLiveCategory[] = [];
  for (const parent of PARENT_CATS) {
    let page = 1;
    const pageSize = 30;
    while (page < 10) {
      let resp: KsCateListResp;
      try {
        resp = await fetchJson<KsCateListResp>(
          `https://live.kuaishou.com/live_api/category/data?type=${parent.id}&page=${page}&size=${pageSize}`
        );
      } catch (e) {
        console.warn(`[kuaishou] cate ${parent.name} page ${page} failed`, e);
        break;
      }
      const sub = resp.data?.list ?? [];
      for (const c of sub) {
        if (!c.id) continue;
        out.push({
          id: c.id,
          name: c.name ?? "",
          cover: c.poster,
          parent: parent.name,
        });
      }
      if (sub.length < pageSize) break;
      page++;
    }
  }
  return out;
}

interface KsCategoryRoomsResp {
  data?: {
    list?: Array<{
      caption?: string;
      poster?: string;
      watchingCount?: number | string;
      author?: { id?: string; name?: string; avatar?: string };
      gameInfo?: { name?: string };
    }>;
  };
}

async function getCategoryRooms(
  categoryId: string,
  page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const api =
    categoryId.length < 7
      ? "https://live.kuaishou.com/live_api/gameboard/list"
      : "https://live.kuaishou.com/live_api/non-gameboard/list";
  const url = `${api}?filterType=0&pageSize=20&gameId=${encodeURIComponent(categoryId)}&page=${page}`;
  const data = await fetchJson<KsCategoryRoomsResp>(url);
  const items = data.data?.list ?? [];
  const list: NetLiveRoom[] = [];
  for (const item of items) {
    const aid = item.author?.id;
    if (!aid) continue;
    list.push({
      platform: "kuaishou",
      roomId: aid,
      title: item.caption ?? "",
      cover: normalizeCover(item.poster),
      uname: item.author?.name,
      avatar: item.author?.avatar,
      online: parseWatching(item.watchingCount),
      category: item.gameInfo?.name,
      live: true,
      link: `https://live.kuaishou.com/u/${aid}`,
    });
  }
  return { list, hasMore: items.length >= 20 };
}

/* ─────────────── 房间详情 + resolve ─────────────── */

interface KsPlayUrlRep {
  url?: string;
  name?: string;
  level?: number;
}

interface KsPlayUrlAdaptation {
  representation?: KsPlayUrlRep[];
}

interface KsPlayUrlCodec {
  h264?: { adaptationSet?: KsPlayUrlAdaptation };
  h265?: { adaptationSet?: KsPlayUrlAdaptation };
}

/**
 * 快手 playUrls 实际有两种形态：
 *  - Object map: `{ h264: {...} }` —— pure_live `detail.data["h264"]` 走这个
 *  - Array of map: `[{ h264: {...} }]` —— 部分新版接口
 * pickKsStream 同时容错。
 */
type KsPlayUrls = KsPlayUrlCodec | KsPlayUrlCodec[];

interface KsInitialState {
  liveroom?: {
    playList?: Array<{
      isLiving?: boolean;
      liveStream?: {
        id?: string;
        poster?: string;
        playUrls?: KsPlayUrls;
      };
      author?: KsHomeAuthor;
      gameInfo?: { name?: string; watchingCount?: number | string };
    }>;
  };
}

async function fetchInitialState(roomId: string): Promise<KsInitialState> {
  const url = `https://live.kuaishou.com/u/${encodeURIComponent(roomId)}`;
  const html = await fetchText(url, {
    headers: {
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Fetch-User": "?1",
    },
  });
  // 与 pure_live 同款正则：window.__INITIAL_STATE__=...;  (非贪婪到第一个 `;`)
  const m = html.match(/window\.__INITIAL_STATE__=([\s\S]*?);/);
  const raw = m ? m[1] : null;
  if (!raw) throw new Error("快手未找到 __INITIAL_STATE__（可能页面结构变更或被风控）");
  const cleaned = raw.replace(/undefined/g, "null");
  try {
    return JSON.parse(cleaned) as KsInitialState;
  } catch (e) {
    throw new Error(`快手 __INITIAL_STATE__ 解析失败：${(e as Error).message}`);
  }
}

async function getRoomDetail(roomId: string): Promise<NetLiveRoom> {
  const state = await fetchInitialState(roomId);
  const play = state.liveroom?.playList?.[0];
  if (!play) throw new Error("快手未返回 playList");
  const author = play.author ?? {};
  const game = play.gameInfo ?? {};
  const live = !!play.isLiving;
  return {
    platform: "kuaishou",
    roomId,
    title: authorDescription(author.description),
    cover: normalizeCover(play.liveStream?.poster),
    uname: author.name,
    avatar: author.avatar,
    online: live ? parseWatching(game.watchingCount) : 0,
    category: game.name,
    introduction: authorDescription(author.description),
    notice: author.description,
    live,
    link: `https://live.kuaishou.com/u/${roomId}`,
  };
}

function pickKsStream(
  playUrls: KsPlayUrls | undefined
): { primary: string; alts: Array<{ qn: string; label: string; url: string }> } {
  if (!playUrls) return { primary: "", alts: [] };
  // 容错两种形态：array → 取首元素；object → 直接用
  const codec: KsPlayUrlCodec | undefined = Array.isArray(playUrls)
    ? playUrls[0]
    : playUrls;
  if (!codec) return { primary: "", alts: [] };
  // 优先 h264（pure_live 同款）；h265 作为 fallback
  const reps =
    codec.h264?.adaptationSet?.representation ??
    codec.h265?.adaptationSet?.representation ??
    [];
  if (reps.length === 0) return { primary: "", alts: [] };
  const sorted = [...reps].sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
  const alts = sorted
    .filter((r) => r.url)
    .map((r) => ({
      qn: String(r.level ?? 0),
      label: r.name ?? "",
      url: r.url ?? "",
    }));
  return { primary: alts[0]?.url ?? "", alts };
}

async function resolve(roomId: string): Promise<NetLiveStream> {
  const state = await fetchInitialState(roomId);
  const play = state.liveroom?.playList?.[0];
  if (!play?.isLiving) throw new Error("快手直播间未开播");
  const picked = pickKsStream(play.liveStream?.playUrls);
  if (!picked.primary) throw new Error("快手未匹配到可播流");
  const streamType: NetLiveStream["streamType"] = picked.primary.includes(
    ".m3u8"
  )
    ? "hls"
    : "flv";
  return {
    url: picked.primary,
    streamType,
    qn: picked.alts[0]?.qn,
    qnLabel: picked.alts[0]?.label,
    alternatives: picked.alts.length > 0 ? picked.alts : undefined,
    referer: "https://live.kuaishou.com/",
    ua: UA,
  };
}

async function getLiveStatus(roomId: string): Promise<boolean> {
  try {
    const detail = await getRoomDetail(roomId);
    return detail.live;
  } catch {
    return false;
  }
}

/* ─────────────── 导出 ─────────────── */

export const kuaishouAdapter: NetLiveAdapter = {
  platform: "kuaishou",
  getRecommend,
  resolve,
  getCategories,
  getCategoryRooms,
  getRoomDetail,
  getLiveStatus,
};
