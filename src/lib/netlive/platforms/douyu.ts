/**
 * 斗鱼直播 adapter —— 移植自 pure_live `lib/core/site/douyu_site.dart`。
 *
 * 实现范围：
 *   - getRecommend / getCategories / getCategoryRooms / search / getRoomDetail：no-sign，公开 JSON
 *   - resolve：跑 `swf_api/homeH5Enc` 返回的混淆 JS（含 `ub98484234(rid,did,time)`），CryptoJS 注入沙盒，
 *     拿到 `&did=...&tt=...&sign=...` 串，POST `/lapi/live/getH5Play/{roomId}`，返回流地址。
 *
 * 全部 HTTP 经 scriptFetch（Tauri 下走 Rust ureq 绕 CORS / 支持代理）。
 */
import CryptoJS from "crypto-js";
import { scriptFetch } from "@/source-script/fetch";
import type {
  NetLiveAdapter,
  NetLiveCategory,
  NetLiveRoom,
  NetLiveStream,
} from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 Edg/114.0.1823.43";

interface DouyuEnvelope<T> {
  error?: number;
  msg?: string;
  data?: T;
}

async function fetchJson<T>(
  url: string,
  init: { headers?: Record<string, string>; method?: string; body?: string } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Referer: "https://www.douyu.com/",
    ...init.headers,
  };
  const res = await scriptFetch(url, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
    timeout: 20_000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json<T>();
}

/* ─────────────── 推荐（无签名） ─────────────── */

interface DouyuListResp {
  data?: {
    rl?: Array<{
      type?: number;
      rid?: number | string;
      rn?: string;
      nn?: string;
      ol?: number | string;
      rs16?: string;
      av?: string;
      c2name?: string;
    }>;
    pgcnt?: number;
  };
}

function mapRoom(item: NonNullable<NonNullable<DouyuListResp["data"]>["rl"]>[number]): NetLiveRoom | undefined {
  if (item.type !== undefined && item.type !== 1) return undefined; // type=1 才是真人直播
  const rid = item.rid;
  if (rid === undefined || rid === null) return undefined;
  const av = item.av ?? "";
  return {
    platform: "douyu",
    roomId: String(rid),
    title: item.rn ?? "",
    uname: item.nn,
    cover: item.rs16,
    avatar: av
      ? `https://apic.douyucdn.cn/upload/${av}_middle.jpg`
      : undefined,
    online: typeof item.ol === "string" ? parseInt(item.ol, 10) || 0 : item.ol,
    category: item.c2name,
    live: true,
    link: `https://www.douyu.com/${rid}`,
  };
}

async function getRecommend(
  page: number,
  _pageSize: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const data = await fetchJson<DouyuListResp>(
    `https://www.douyu.com/japi/weblist/apinc/allpage/6/${page}`
  );
  const list = (data.data?.rl ?? [])
    .map(mapRoom)
    .filter((r): r is NetLiveRoom => !!r);
  const hasMore = page < (data.data?.pgcnt ?? 0);
  return { list, hasMore };
}

/* ─────────────── 分类 ─────────────── */

interface DouyuCateListResp {
  data?: {
    cate1Info?: Array<{ cate1Id: number; cate1Name: string }>;
    cate2Info?: Array<{
      cate1Id: number;
      cate2Id: number;
      cate2Name: string;
      icon?: string;
    }>;
  };
}

async function getCategories(): Promise<NetLiveCategory[]> {
  const data = await fetchJson<DouyuCateListResp>(
    "https://m.douyu.com/api/cate/list"
  );
  const parents = data.data?.cate1Info ?? [];
  const children = data.data?.cate2Info ?? [];
  // 排序按 cate1Id
  const sorted = [...parents].sort((a, b) => a.cate1Id - b.cate1Id);
  const out: NetLiveCategory[] = [];
  for (const p of sorted) {
    for (const c of children) {
      if (c.cate1Id !== p.cate1Id) continue;
      out.push({
        id: String(c.cate2Id),
        name: c.cate2Name,
        cover: c.icon,
        parent: p.cate1Name,
      });
    }
  }
  return out;
}

async function getCategoryRooms(
  categoryId: string,
  page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const data = await fetchJson<DouyuListResp>(
    `https://www.douyu.com/gapi/rkc/directory/mixList/2_${categoryId}/${page}`
  );
  const list = (data.data?.rl ?? [])
    .map(mapRoom)
    .filter((r): r is NetLiveRoom => !!r);
  const hasMore = page < (data.data?.pgcnt ?? 0);
  return { list, hasMore };
}

/* ─────────────── 搜索 ─────────────── */

interface DouyuSearchResp extends DouyuEnvelope<{
  relateShow?: Array<{
    rid?: number | string;
    roomName?: string;
    roomSrc?: string;
    cateName?: string;
    avatar?: string;
    nickName?: string;
    hot?: number | string;
    isLive?: number | string;
    roomType?: number | string;
  }>;
}> {}

function randomDid(length = 32): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

async function search(
  keyword: string,
  page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const did = randomDid();
  const url = `https://www.douyu.com/japi/search/api/searchShow?kw=${encodeURIComponent(keyword)}&page=${page}&pageSize=20`;
  const data = await fetchJson<DouyuSearchResp>(url, {
    headers: {
      Referer: "https://www.douyu.com/search/",
      Cookie: `dy_did=${did};acf_did=${did}`,
    },
  });
  if (data.error !== 0 && data.error !== undefined) {
    throw new Error(data.msg || `斗鱼错误码 ${data.error}`);
  }
  const queryList = data.data?.relateShow ?? [];
  const list: NetLiveRoom[] = [];
  for (const item of queryList) {
    const isLive =
      (typeof item.isLive === "string" ? parseInt(item.isLive, 10) : item.isLive) === 1;
    const roomType =
      typeof item.roomType === "string" ? parseInt(item.roomType, 10) : item.roomType ?? 0;
    list.push({
      platform: "douyu",
      roomId: String(item.rid ?? ""),
      title: item.roomName ?? "",
      cover: item.roomSrc,
      uname: item.nickName,
      avatar: item.avatar,
      category: item.cateName,
      online:
        typeof item.hot === "string" ? parseInt(item.hot, 10) || 0 : item.hot,
      live: isLive && roomType === 0,
      link: item.rid ? `https://www.douyu.com/${item.rid}` : undefined,
    });
  }
  return { list, hasMore: queryList.length > 0 };
}

/* ─────────────── 房间详情（公开 JSON，无拉流） ─────────────── */

interface DouyuRoomDetailResp {
  room?: {
    room_id?: string | number;
    room_name?: string;
    room_pic?: string;
    owner_name?: string;
    owner_avatar?: string;
    show_details?: string;
    second_lvl_name?: string;
    show_status?: number;
    videoLoop?: number;
    room_biz_all?: { hot?: string };
  };
}

async function getRoomDetail(roomId: string): Promise<NetLiveRoom> {
  const data = await fetchJson<DouyuRoomDetailResp>(
    `https://www.douyu.com/betard/${roomId}`,
    {
      headers: { Referer: `https://www.douyu.com/${roomId}` },
    }
  );
  const r = data.room;
  if (!r) throw new Error("斗鱼未返回房间详情");
  return {
    platform: "douyu",
    roomId: String(r.room_id ?? roomId),
    title: r.room_name ?? "",
    cover: r.room_pic,
    uname: r.owner_name,
    avatar: r.owner_avatar,
    introduction: r.show_details,
    category: r.second_lvl_name,
    online: r.room_biz_all?.hot ? parseInt(r.room_biz_all.hot, 10) || 0 : undefined,
    live: r.show_status === 1,
    isRecord: r.videoLoop === 1,
    link: `https://www.douyu.com/${roomId}`,
  };
}

/* ─────────────── resolve —— 签名 + getH5Play ─────────────── */

/**
 * 拉 `swf_api/homeH5Enc?rids={roomId}` 拿到该房间的混淆 JS（声明 ub98484234），
 * 在 `new Function` 沙盒里执行，注入 CryptoJS / rid / did / time，返回签名串。
 *
 * **沙盒说明**：`new Function` 不能完全隔离 globalThis，但 douyu 的 ub98484234 是纯函数
 * 调用（只用 CryptoJS 的 MD5/encoding，不访问 fetch/eval/this），可信。
 */
async function signRoom(rid: string): Promise<string> {
  const res = await fetchJson<{ data: Record<string, string> }>(
    `https://www.douyu.com/swf_api/homeH5Enc?rids=${rid}`,
    {
      headers: { Referer: `https://www.douyu.com/${rid}` },
    }
  );
  const html = res.data?.[`room${rid}`];
  if (!html) throw new Error("斗鱼签名脚本未返回");
  // legado / pure_live 同款：替换 eval(...) 干扰
  const stripped = html.replace(/eval.*?;}/, "strc;}");
  const did = "10000000000000000000000000001501";
  const time = String(Math.floor(Date.now() / 1000));
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function(
      "CryptoJS",
      "rid",
      "did",
      "time",
      `"use strict";\n${stripped}\nreturn ub98484234(rid, did, time);`
    );
    const result = fn(CryptoJS, rid, did, time);
    if (typeof result !== "string" || !result) {
      throw new Error("ub98484234 返回非法值");
    }
    return result;
  } catch (e) {
    throw new Error(`斗鱼签名脚本执行失败：${(e as Error).message}`);
  }
}

interface DouyuH5PlayResp {
  error?: number;
  msg?: string;
  data?: {
    rtmp_url?: string;
    rtmp_live?: string;
    rate?: number;
    multirates?: Array<{ name: string; rate: number; bit: number }>;
    cdnsWithName?: Array<{ cdn: string; name: string }>;
  };
}

async function postH5Play(
  roomId: string,
  args: string,
  rate = 0,
  cdn = ""
): Promise<DouyuH5PlayResp> {
  const body = `${args}&cdn=${cdn}&rate=${rate}&ver=Douyu_223061205&iar=1&ive=1&hevc=0&fa=0`;
  const res = await scriptFetch(
    `https://www.douyu.com/lapi/live/getH5Play/${roomId}`,
    {
      method: "POST",
      headers: {
        "User-Agent": UA,
        Referer: `https://www.douyu.com/${roomId}`,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body,
      timeout: 20_000,
    }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json<DouyuH5PlayResp>();
}

function unescapeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function resolve(roomId: string): Promise<NetLiveStream> {
  // 1. 拉签名
  const args = await signRoom(roomId);
  // 2. 默认 rate=0 拿默认清晰度，同时枚举 multirates 作为 alternatives
  const first = await postH5Play(roomId, args, 0, "");
  if (first.error !== 0 && first.error !== undefined) {
    throw new Error(first.msg || `斗鱼 error ${first.error}`);
  }
  const rtmpUrl = first.data?.rtmp_url;
  const rtmpLive = first.data?.rtmp_live;
  if (!rtmpUrl || !rtmpLive) {
    throw new Error("斗鱼未返回 rtmp_url / rtmp_live（房间可能已下播）");
  }
  const finalUrl = `${rtmpUrl}/${unescapeHtmlEntities(rtmpLive)}`;
  const streamType: NetLiveStream["streamType"] = finalUrl.includes(".m3u8")
    ? "hls"
    : "flv";

  // 收集 alternatives：rate × 默认 cdn —— 第一条用 default cdn 就够，避免每条都发请求
  const alternatives: NonNullable<NetLiveStream["alternatives"]> = [];
  const multirates = first.data?.multirates ?? [];
  const currentRate = first.data?.rate ?? 0;
  for (const r of multirates) {
    alternatives.push({
      qn: String(r.rate),
      label: r.name,
      // 默认填同一个 URL，UI 选了不同 qn 时按需重拉
      url: r.rate === currentRate ? finalUrl : "",
    });
  }

  return {
    url: finalUrl,
    streamType,
    qn: String(currentRate),
    qnLabel: multirates.find((r) => r.rate === currentRate)?.name,
    alternatives: alternatives.length > 0 ? alternatives : undefined,
    referer: `https://www.douyu.com/${roomId}`,
    ua: UA,
  };
}

/**
 * 切换清晰度 —— UI 在选 alternative 时调，按选中的 rate 重拉签名 + getH5Play。
 * 不属于 NetLiveAdapter 公共接口（不每平台都有），单独导出。
 */
export async function douyuSwitchRate(
  roomId: string,
  rate: number
): Promise<string> {
  const args = await signRoom(roomId);
  const r = await postH5Play(roomId, args, rate, "");
  if (r.error !== 0 && r.error !== undefined) {
    throw new Error(r.msg || `斗鱼 error ${r.error}`);
  }
  if (!r.data?.rtmp_url || !r.data?.rtmp_live) {
    throw new Error("斗鱼未返回拉流地址");
  }
  return `${r.data.rtmp_url}/${unescapeHtmlEntities(r.data.rtmp_live)}`;
}

/* ─────────────── 导出 ─────────────── */

export const douyuAdapter: NetLiveAdapter = {
  platform: "douyu",
  getRecommend,
  search,
  resolve,
  getCategories,
  getCategoryRooms,
  getRoomDetail,
};
