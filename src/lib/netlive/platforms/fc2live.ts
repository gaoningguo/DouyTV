/**
 * FC2 Live (Adult / livechat.fc2.com) adapter ——日本最大老牌成人直播 BJ 平台。
 *
 * 实测公开 API（2026-05-24 curl 端到端验证 + HoloArchivists/fc2-live-dl 协议对齐,
 * 匿名免登,要海外/日韩出口代理):
 *
 *   - 列表：POST https://live.fc2.com/adult/contents/allchannellist.php
 *     Content-Type: application/x-www-form-urlencoded（空 body 即可）
 *     返回 { link, is_adult: 1, time, channel: [{ id, fc2id, name, title, image, sex, pay, login,
 *           lang, total, count, official, comment_score, deny_country_flg, start_time, ... }] }
 *     ⚠ 这是 FC2 唯一的官方 listing API,返**全部** ~760 个活跃成人 BJ,**一次性**
 *     拉全 —— 不支持分页/排序/筛选,只能在客户端切片。
 *
 *   - 拉流（必须走 Rust 端 fc2_resolve_hls 命令,因为要 WebSocket 握手):
 *     1) HTTP POST /api/getControlServer.php → 拿 `wss://` + `control_token` (JWT)
 *     2) 走 `tokio-tungstenite` 连 wss,发 `{"name":"get_hls_information","arguments":{},"id":1}`
 *     3) 等响应 `{"name":"_response_","id":1,"arguments":{"playlists":[{url, mode, ...}]}}`
 *     4) 关 WS,把 url 给 hls.js（普通 HLS,无 WS 实时流)
 *     **这一步纯 JS / scriptFetch 完成不了**(WS 协议),所以 adapter 调 Tauri command。
 *
 * 🚨 匿名可播性（2026-05-24 实测,SG 代理 759 频道）：
 *   - 759 房间里只有 **70 个 (pay=0 且 login=0)** 匿名可播
 *   - 649 是付费房（pay=1,握手会 `code=4507 LoginRequired`）
 *   - 689 是会员房（login>0,同上 4507）
 *   - **adapter 默认只展示开放房**,避免用户点付费房遇到无效的"拉流失败"
 *   - 用户想看全部,选 "全部（含付费）" 分类,但 80%+ 房间播放会拒
 *
 * 字段坑：
 *   - 频道 id 是 `channel.id`（数字字符串,如 "10000643"）—— 不是 `fc2id`
 *   - 在线状态 = 当前 list 里出现即在线（list 只返活跃 BJ）
 *   - `pay`: 1=付费房;`login`: >0=会员限定;两者都=0 才能匿名播
 *   - `sex` 字段：'w'(female) / 'm'(male) / 'c'(couple) 等
 *
 * roomId = channel.id (数字字符串)。
 */
import { createPlatformFetch } from "@/lib/netlive/scriptFetch";
const scriptFetch = createPlatformFetch("fc2live");
import { resolveProxyForPlatform } from "@/stores/netliveProxy";
import type {
  NetLiveAdapter,
  NetLiveCategory,
  NetLiveRoom,
  NetLiveStream,
} from "../types";
import { NetLiveListUnsupportedError } from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const REFERER = "https://live.fc2.com/";
const LIST_URL = "https://live.fc2.com/adult/contents/allchannellist.php";

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Referer: REFERER,
  Origin: "https://live.fc2.com",
  "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8",
  Accept: "application/json, text/plain, */*",
};

interface FC2Channel {
  id?: string;
  bid?: string;
  fc2id?: number;
  name?: string;
  title?: string;
  image?: string;
  start_time?: number;
  sex?: string;
  pay?: number;
  amount?: number;
  interval?: number;
  lang?: string;
  total?: number;
  count?: number;
  login?: number;
  tid?: number;
  price?: number;
  official?: number;
  comment_score?: number;
  deny_country_flg?: string;
  panorama?: number;
  category?: number;
  type?: number;
}

interface FC2ListResp {
  link?: string;
  is_adult?: number;
  time?: number;
  channel?: FC2Channel[];
}

const SEX_LABEL: Record<string, string> = {
  w: "♀ Female",
  m: "♂ Male",
  c: "Couple",
  t: "Trans",
};

function mapRoom(c: FC2Channel): NetLiveRoom | undefined {
  const id = c.id;
  if (!id) return undefined;
  const isOpen = !c.pay && !c.login;
  const category = [
    c.sex ? SEX_LABEL[c.sex] || c.sex : undefined,
    c.pay ? "💰 付费房" : undefined,
    !c.pay && c.login ? "🔒 会员房" : undefined,
    isOpen ? undefined : "⚠ 匿名无法播放",
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    platform: "fc2live",
    roomId: id,
    title: c.title || c.name || id,
    uname: c.name || id,
    cover: c.image,
    online: c.count ?? 0,
    category: category || undefined,
    live: true,
    link: `https://live.fc2.com/${id}/`,
  };
}

/** 匿名可播 = pay=0 且 login=0。其他都会被 WS 端拒为 code=4507。 */
function isAnonymouslyPlayable(c: FC2Channel): boolean {
  return !c.pay && !c.login;
}

let cachedList: { data: FC2Channel[]; expiry: number } | null = null;
const LIST_CACHE_TTL_MS = 60_000; // FC2 list 是一次性 700+ 频道全量,1 分钟内复用

async function fetchAllChannels(): Promise<FC2Channel[]> {
  if (cachedList && cachedList.expiry > Date.now()) return cachedList.data;
  let res;
  try {
    res = await scriptFetch(LIST_URL, {
      method: "POST",
      headers: {
        ...COMMON_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "",
      timeout: 25_000,
      http2: true,
    });
  } catch (e) {
    throw new NetLiveListUnsupportedError(
      "FC2 Live",
      `网络层不可达（${(e as Error).message ?? String(e)}）—— FC2 对 CN IP 不友好,请配置日本/韩国/海外代理`,
    );
  }
  if (!res.ok) {
    if (res.status === 403 || res.status === 503) {
      throw new NetLiveListUnsupportedError(
        "FC2 Live",
        `HTTP ${res.status} 拦截,需配置海外代理`,
      );
    }
    throw new Error(`FC2 Live HTTP ${res.status}`);
  }
  const data = await res.json<FC2ListResp>();
  const channels = data.channel ?? [];
  cachedList = { data: channels, expiry: Date.now() + LIST_CACHE_TTL_MS };
  return channels;
}

/* ─────────────── 推荐 ─────────────── */

async function getRecommend(
  page: number,
  pageSize: number,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const all = await fetchAllChannels();
  // 默认只推荐匿名可播的开放房（pay=0 + login=0），免得用户大量点付费房遇到 4507
  const openOnly = all.filter(isAnonymouslyPlayable);
  // 按当前观看人数降序 —— 类似"热门"语义
  const sorted = openOnly.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  const start = Math.max(0, (page - 1) * pageSize);
  const end = start + pageSize;
  const slice = sorted.slice(start, end);
  const list = slice.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: end < sorted.length };
}

/* ─────────────── 分类 ─────────────── */

const PRESET_CATEGORIES: NetLiveCategory[] = [
  { id: "popular", name: "人气（开放房）" },
  { id: "new", name: "新人（开放房）" },
  { id: "female", name: "♀ Female（开放房）" },
  { id: "male", name: "♂ Male（开放房）" },
  { id: "couple", name: "Couple（开放房）" },
  { id: "all", name: "全部（含付费/会员,匿名无法播）" },
];

async function getCategories(): Promise<NetLiveCategory[]> {
  return PRESET_CATEGORIES;
}

async function getCategoryRooms(
  categoryId: string,
  page: number,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const all = await fetchAllChannels();
  // "all" 显示全部（含付费）;其他都过滤到只剩匿名可播房
  const pool = categoryId === "all" ? all : all.filter(isAnonymouslyPlayable);
  let filtered: FC2Channel[];
  switch (categoryId) {
    case "new":
      filtered = [...pool].sort(
        (a, b) => (b.start_time ?? 0) - (a.start_time ?? 0),
      );
      break;
    case "female":
      filtered = pool.filter((c) => c.sex === "w");
      break;
    case "male":
      filtered = pool.filter((c) => c.sex === "m");
      break;
    case "couple":
      filtered = pool.filter((c) => c.sex === "c");
      break;
    case "all":
    case "popular":
    default:
      filtered = [...pool].sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
      break;
  }
  const pageSize = 24;
  const start = Math.max(0, (page - 1) * pageSize);
  const end = start + pageSize;
  const slice = filtered.slice(start, end);
  const list = slice.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: end < filtered.length };
}

/* ─────────────── 搜索 ─────────────── */

async function search(
  keyword: string,
  _page: number,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  if (!keyword.trim()) return { list: [], hasMore: false };
  const all = await fetchAllChannels();
  const kw = keyword.toLowerCase();
  const hits = all.filter((c) => {
    const t = (c.title ?? "").toLowerCase();
    const n = (c.name ?? "").toLowerCase();
    const id = (c.id ?? "").toLowerCase();
    return t.includes(kw) || n.includes(kw) || id.includes(kw);
  });
  const list = hits.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: false };
}

/* ─────────────── 房间详情 ─────────────── */

async function getRoomDetail(roomId: string): Promise<NetLiveRoom> {
  const all = await fetchAllChannels();
  const found = all.find((c) => c.id === roomId);
  if (!found) {
    throw new Error(`FC2 Live 房间 ${roomId} 未在当前在线列表中（已下播或不存在）`);
  }
  return mapRoom(found)!;
}

async function getLiveStatus(roomId: string): Promise<boolean> {
  try {
    const all = await fetchAllChannels();
    return all.some((c) => c.id === roomId);
  } catch {
    return false;
  }
}

/* ─────────────── 拉流（走 Rust WS 握手）─────────────── */

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function resolve(roomId: string): Promise<NetLiveStream> {
  console.log("[fc2live] resolve() called roomId=", roomId);
  if (!isTauri) {
    throw new Error(
      "FC2 Live 拉流需要 Tauri 桌面环境（WebSocket 握手在 Rust 端完成）—— web 预览模式不支持",
    );
  }
  // 用 list 缓存做快速预检 —— 付费/会员房直接拒,不要白白绕一圈 WS 再被 4507。
  // 缓存没命中（roomId 来自旧书签 / 收藏）就让 WS 端处理。
  if (cachedList && cachedList.expiry > Date.now()) {
    const ch = cachedList.data.find((c) => c.id === roomId);
    console.log("[fc2live] cached channel:", ch);
    if (ch) {
      if (ch.pay) {
        throw new Error(
          `FC2 Live: 该房间是付费房（按分钟计费），匿名无法播放。需要 FC2 账户 + 充值点数,DouyTV 不支持。`,
        );
      }
      if (ch.login) {
        throw new Error(
          `FC2 Live: 该房间限会员观看（login=${ch.login}）,匿名无法播放。`,
        );
      }
    }
  } else {
    console.log("[fc2live] no cachedList (expired or empty), going straight to WS");
  }
  const { proxyUrl, bypass } = resolveProxyForPlatform("fc2live");
  const effectiveProxy = bypass ? null : (proxyUrl ?? null);
  console.log("[fc2live] proxy:", { proxyUrl, bypass, effectiveProxy });
  const { invoke } = await import("@tauri-apps/api/core");
  console.log("[fc2live] invoking fc2_resolve_hls ...");
  try {
    const hlsUrl = await invoke<string>("fc2_resolve_hls", {
      channelId: roomId,
      proxyUrl: effectiveProxy,
    });
    console.log("[fc2live] invoke returned hls url=", hlsUrl);
    return {
      url: hlsUrl,
      streamType: "hls",
      qn: "auto",
      qnLabel: "原画",
      referer: REFERER,
      ua: UA,
    };
  } catch (e) {
    console.error("[fc2live] invoke threw:", e);
    throw e;
  }
}

/* ─────────────── 导出 ─────────────── */

export const fc2liveAdapter: NetLiveAdapter = {
  platform: "fc2live",
  getRecommend,
  search,
  resolve,
  getCategories,
  getCategoryRooms,
  getRoomDetail,
  getLiveStatus,
};
