/**
 * SOOP (前 AfreecaTV, 아프리카TV) 直播 adapter —— 韩国最大 BJ 直播平台。
 *
 * 实测公开 API（2026-05 抓 streamlink soop.py 验证 + curl 端到端走通，匿名免登）：
 *
 *   - 列表：GET https://live.afreecatv.com/api/main_broad_list_api.php
 *     ?selectType=action&pageNo=N&lang=ko_KR&pageType=home
 *     返回 { total_cnt, cnt, broad: [{ broad_no, user_id, user_nick, broad_title, broad_thumb,
 *           current_view_cnt, broad_grade, category_name, ... }] }
 *     broad_grade=19 表示 19+ 房间（成人向，仍在 SOOP 内容政策内 —— 衣着暴露 / ASMR 等）
 *
 *   - 拉流（4 步流水线，匿名免登）：
 *     1) POST https://live.sooplive.com/afreeca/player_live_api.php
 *        body: bid={user_id}&bno={broad_no}&type=live&pwd=&from_api=0&mode=landing
 *              &player_type=html5&stream_type=common
 *        → 返回 CHANNEL.{RESULT, RMD, CDN, BNO, BPWD, VIEWPRESET[{name,label,bps}]}
 *     2) POST 同 URL with type=aid&quality={name}
 *        → 返回 CHANNEL.AID（每 quality 一个 token）
 *     3) GET {RMD}/broad_stream_assign.html?return_type={cdn_mapped}&broad_key={bno}-common-{qn}-hls
 *        → 返回 { view_url, stream_status }，view_url 是真正的 HLS 主播放列表 URL
 *     4) 拉 view_url 时 query 上加 ?aid={aid}（缺它 CloudFront 返 MissingKey 403）
 *
 *   - CDN_TYPE_MAPPING：gs_cdn→gs_cdn_pc_web；lg_cdn→lg_cdn_pc_web；其它原样
 *
 * 注意：SOOP 是综合直播站（游戏 / 户外 / 杂谈居多），但 19+ tag 房间 + 댄스(dance) 분류 +
 * 일코(uniform)/cosplay 等子类有大量 BJ 性感内容，是韩国 BJ 文化的主战场。
 * 仅在 adultEnabled=true 时显示 —— 与平台政策一致。
 *
 * roomId 我用 `{user_id}:{broad_no}` 组合（拉流需要 bno）。
 * 因为 broad_no 每开新场会变，单存 user_id 无法 resolve；存组合 id 来一并固化当前场次。
 */
import { createPlatformFetch } from "@/lib/netlive/scriptFetch";
const scriptFetch = createPlatformFetch("soop");
import type {
  NetLiveAdapter,
  NetLiveCategory,
  NetLiveRoom,
  NetLiveStream,
} from "../types";
import { NetLiveListUnsupportedError } from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const REFERER = "https://play.sooplive.com/";
const LIST_API = "https://live.afreecatv.com/api/main_broad_list_api.php";
const PLAYER_API = "https://live.sooplive.com/afreeca/player_live_api.php";

const LIST_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Referer: "https://www.sooplive.co.kr/",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
};

const PLAYER_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Referer: REFERER,
  Origin: "https://play.sooplive.com",
  Accept: "application/json, text/javascript, */*; q=0.01",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
};

interface SoopBroadRaw {
  broad_no: number | string;
  user_id: string;
  user_nick: string;
  broad_title: string;
  broad_thumb?: string;
  broad_grade?: number | string; // 19 = adult
  broad_cate_no?: string;
  category_name?: string;
  category_tags?: string[];
  current_view_cnt?: number;
  total_view_cnt?: number;
  is_password?: string; // "Y" / "N"
  hash_tags?: string[];
}

interface SoopListResp {
  total_cnt?: number | string;
  cnt?: number | string;
  broad?: SoopBroadRaw[];
}

function makeRoomId(userId: string, bno: number | string): string {
  return `${userId}:${bno}`;
}

function parseRoomId(roomId: string): { userId: string; bno: string } {
  const idx = roomId.indexOf(":");
  if (idx < 0) return { userId: roomId, bno: "" };
  return { userId: roomId.slice(0, idx), bno: roomId.slice(idx + 1) };
}

function mapBroad(b: SoopBroadRaw): NetLiveRoom | undefined {
  if (!b.user_id || !b.broad_no) return undefined;
  const grade = String(b.broad_grade ?? "");
  return {
    platform: "soop",
    roomId: makeRoomId(b.user_id, b.broad_no),
    title: b.broad_title || b.user_nick || b.user_id,
    uname: b.user_nick || b.user_id,
    cover: b.broad_thumb
      ? b.broad_thumb.startsWith("//")
        ? `https:${b.broad_thumb}`
        : b.broad_thumb
      : undefined,
    online: b.current_view_cnt ?? b.total_view_cnt ?? 0,
    category: grade === "19" ? "19+" : b.category_name,
    live: true,
    link: `https://play.sooplive.co.kr/${b.user_id}/${b.broad_no}`,
  };
}

/* ─────────────── 推荐 ─────────────── */

async function fetchList(
  page: number,
  selectType: string = "action",
): Promise<SoopListResp> {
  const url = new URL(LIST_API);
  url.searchParams.set("selectType", selectType);
  url.searchParams.set("pageNo", String(page));
  url.searchParams.set("lang", "ko_KR");
  url.searchParams.set("pageType", "home");
  let res;
  try {
    res = await scriptFetch(url.toString(), {
      method: "GET",
      headers: LIST_HEADERS,
      timeout: 25_000,
      http2: true,
    });
  } catch (e) {
    throw new NetLiveListUnsupportedError(
      "SOOP",
      `网络层不可达（${(e as Error).message ?? String(e)}）—— 海外 IP 走 SOOP 主域可能被限速，请配韩国/日本节点代理`,
    );
  }
  if (!res.ok) {
    throw new Error(`SOOP HTTP ${res.status}`);
  }
  return res.json<SoopListResp>();
}

async function getRecommend(
  page: number,
  _pageSize: number,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const data = await fetchList(page, "action");
  const arr = data.broad ?? [];
  const list = arr.map(mapBroad).filter((r): r is NetLiveRoom => !!r);
  const total = Number(data.total_cnt ?? 0);
  // 60 间/页是 SOOP 默认；hasMore 用 total 推
  return { list, hasMore: page * 60 < total };
}

/* ─────────────── 分类 ─────────────── */
// selectType 对应 SOOP 顶部 tab：action (综合) / new (新人) / live (默认) / category (分类)
// 真正的 19+ 过滤靠在 list 拿到后客户端 filter broad_grade=19
const PRESET_CATEGORIES: NetLiveCategory[] = [
  { id: "action", name: "热门" },
  { id: "new", name: "新人" },
  { id: "adult19", name: "19+" }, // 拉 action 后筛 broad_grade=19
  { id: "dance", name: "댄스(舞蹈)" },
  { id: "uniform", name: "制服/Cosplay" },
];

async function getCategories(): Promise<NetLiveCategory[]> {
  return PRESET_CATEGORIES;
}

async function getCategoryRooms(
  categoryId: string,
  page: number,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  let selectType = "action";
  const tagFilter: { grade?: string; nameKeywords?: string[] } = {};
  if (categoryId === "new") selectType = "new";
  else if (categoryId === "adult19") tagFilter.grade = "19";
  else if (categoryId === "dance") tagFilter.nameKeywords = ["댄스", "댄스BJ", "dance", "춤"];
  else if (categoryId === "uniform") tagFilter.nameKeywords = ["코스프레", "유니폼", "cos"];

  const data = await fetchList(page, selectType);
  let arr = data.broad ?? [];
  if (tagFilter.grade) {
    arr = arr.filter((b) => String(b.broad_grade ?? "") === tagFilter.grade);
  }
  if (tagFilter.nameKeywords) {
    arr = arr.filter((b) => {
      const blob =
        `${b.broad_title ?? ""} ${b.category_name ?? ""} ${(b.hash_tags ?? []).join(" ")}`.toLowerCase();
      return tagFilter.nameKeywords!.some((k) => blob.includes(k.toLowerCase()));
    });
  }
  const list = arr.map(mapBroad).filter((r): r is NetLiveRoom => !!r);
  const total = Number(data.total_cnt ?? 0);
  return { list, hasMore: page * 60 < total };
}

/* ─────────────── 搜索 ─────────────── */
// SOOP 真搜索接口 (sch.sooplive.co.kr/api.php) 走 JSONP，纯 fetch 拿不到。
// 退化为客户端 filter 当前页 broad。
async function search(
  keyword: string,
  page: number,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const data = await fetchList(page, "action");
  const kw = keyword.toLowerCase();
  const arr = (data.broad ?? []).filter((b) => {
    const blob =
      `${b.broad_title ?? ""} ${b.user_nick ?? ""} ${b.user_id ?? ""} ${(b.hash_tags ?? []).join(" ")}`.toLowerCase();
    return blob.includes(kw);
  });
  const list = arr.map(mapBroad).filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: false };
}

/* ─────────────── 房间详情 ─────────────── */

interface SoopChannelResp {
  CHANNEL?: {
    RESULT?: number | string;
    BNO?: string;
    BJID?: string;
    BJNICK?: string;
    TITLE?: string;
    RMD?: string;
    CDN?: string;
    BPWD?: string; // Y = 加密
    AID?: string;
    VIEWPRESET?: Array<{ name: string; label: string; bps?: number; label_resolution?: string }>;
    CATE?: string;
    BJGRADE?: number;
    geo_cc?: string;
    TS?: string; // 部分 player API 直接给 TS m3u8 URL
  };
}

async function postPlayer(
  body: Record<string, string>,
  userId: string,
): Promise<SoopChannelResp> {
  const form = Object.entries(body)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const res = await scriptFetch(PLAYER_API, {
    method: "POST",
    headers: {
      ...PLAYER_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `https://play.sooplive.com/${userId}`,
    },
    body: form,
    timeout: 25_000,
    http2: true,
  });
  if (!res.ok) throw new Error(`SOOP player API HTTP ${res.status}`);
  return res.json<SoopChannelResp>();
}

async function getRoomDetail(roomId: string): Promise<NetLiveRoom> {
  const { userId, bno } = parseRoomId(roomId);
  const data = await postPlayer(
    {
      from_api: "0",
      mode: "landing",
      player_type: "html5",
      stream_type: "common",
      type: "live",
      bid: userId,
      bno,
      pwd: "",
    },
    userId,
  );
  const c = data.CHANNEL;
  if (!c || Number(c.RESULT) !== 1) {
    throw new Error(`SOOP 房间 ${roomId} 未找到 / 已下播`);
  }
  return {
    platform: "soop",
    roomId,
    title: c.TITLE || c.BJNICK || userId,
    uname: c.BJNICK || userId,
    online: 0,
    category: c.BJGRADE === 19 ? "19+" : c.CATE,
    live: true,
    link: `https://play.sooplive.co.kr/${userId}/${bno}`,
  };
}

async function getLiveStatus(roomId: string): Promise<boolean> {
  try {
    const { userId, bno } = parseRoomId(roomId);
    if (!bno) return false; // 没拿到当前 bno 等于已下播
    const data = await postPlayer(
      {
        from_api: "0",
        mode: "landing",
        player_type: "html5",
        stream_type: "common",
        type: "live",
        bid: userId,
        bno,
        pwd: "",
      },
      userId,
    );
    return Number(data.CHANNEL?.RESULT) === 1;
  } catch {
    return false;
  }
}

/* ─────────────── resolve ─────────────── */

const CDN_TYPE_MAPPING: Record<string, string> = {
  gs_cdn: "gs_cdn_pc_web",
  lg_cdn: "lg_cdn_pc_web",
};

function mapCdn(cdn: string): string {
  for (const key of Object.keys(CDN_TYPE_MAPPING)) {
    if (cdn.includes(key)) return CDN_TYPE_MAPPING[key];
  }
  return cdn;
}

async function fetchViewUrl(
  rmd: string,
  cdn: string,
  bno: string,
  quality: string,
  userId: string,
): Promise<string | undefined> {
  const url = new URL(`${rmd}/broad_stream_assign.html`);
  url.searchParams.set("return_type", mapCdn(cdn));
  url.searchParams.set("broad_key", `${bno}-common-${quality}-hls`);
  const res = await scriptFetch(url.toString(), {
    method: "GET",
    headers: {
      ...PLAYER_HEADERS,
      Referer: `https://play.sooplive.com/${userId}`,
    },
    timeout: 20_000,
    http2: true,
  });
  if (!res.ok) return undefined;
  const body = await res.json<{ view_url?: string; stream_status?: string }>();
  return body.view_url;
}

async function resolve(roomId: string): Promise<NetLiveStream> {
  const { userId, bno: parsedBno } = parseRoomId(roomId);
  // step 1: 拿 RMD/CDN/BNO + VIEWPRESET
  const step1 = await postPlayer(
    {
      from_api: "0",
      mode: "landing",
      player_type: "html5",
      stream_type: "common",
      type: "live",
      bid: userId,
      bno: parsedBno,
      pwd: "",
    },
    userId,
  );
  const c = step1.CHANNEL;
  if (!c) throw new Error("SOOP 未返回 CHANNEL");
  const result = Number(c.RESULT);
  if (result === -6) {
    throw new Error("SOOP 该房间需登录（订阅 / 19+ 验证）");
  }
  if (result !== 1) {
    throw new Error(`SOOP 房间状态异常 (RESULT=${result})`);
  }
  if (c.BPWD === "Y") {
    throw new Error("SOOP 该房间已加密（密码房）");
  }

  const bno = c.BNO || parsedBno;
  const rmd = c.RMD;
  const cdn = c.CDN ?? "";
  if (!rmd || !bno) {
    // 部分轻量房直接返 TS m3u8 URL（无需 RMD 二次解析）
    if (c.TS) {
      return {
        url: c.TS,
        streamType: "hls",
        qn: "auto",
        qnLabel: "原画",
        referer: REFERER,
        ua: UA,
      };
    }
    throw new Error("SOOP 未返回 RMD/BNO，无法解析");
  }

  // step 2 + 3：挨个 quality 拿 view_url + aid，做 alternatives 列表
  // 优先 hd（与 streamlink 默认匹配）
  const presets = (c.VIEWPRESET ?? []).filter((p) => p.name !== "auto");
  const qualityOrder = ["hd", "hd4k", "original", "sd"];
  presets.sort((a, b) => {
    const ai = qualityOrder.indexOf(a.name);
    const bi = qualityOrder.indexOf(b.name);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });

  let primary: { url: string; label: string; qn: string } | null = null;
  const alternatives: Array<{ qn: string; label: string; url: string }> = [];

  for (const p of presets) {
    // step 2: aid token
    const aidResp = await postPlayer(
      {
        from_api: "0",
        mode: "landing",
        player_type: "html5",
        stream_type: "common",
        type: "aid",
        bid: userId,
        bno,
        pwd: "",
        quality: p.name,
      },
      userId,
    );
    const aidResult = Number(aidResp.CHANNEL?.RESULT);
    if (aidResult !== 1) continue;
    const aid = aidResp.CHANNEL?.AID;
    if (!aid) continue;
    // step 3: view_url
    const viewUrl = await fetchViewUrl(rmd, cdn, bno, p.name, userId);
    if (!viewUrl) continue;
    // step 4：拼 aid 进 query
    const sep = viewUrl.includes("?") ? "&" : "?";
    const finalUrl = `${viewUrl}${sep}aid=${encodeURIComponent(aid)}`;
    const entry = { qn: p.name, label: p.label || p.name, url: finalUrl };
    if (!primary) primary = entry;
    alternatives.push(entry);
  }

  if (!primary) {
    throw new Error("SOOP 所有 quality 都解析失败（可能瞬时下播 / 区域屏蔽）");
  }

  return {
    url: primary.url,
    streamType: "hls",
    qn: primary.qn,
    qnLabel: primary.label,
    referer: `https://play.sooplive.com/${userId}`,
    ua: UA,
    alternatives: alternatives.length > 1 ? alternatives : undefined,
  };
}

/* ─────────────── 导出 ─────────────── */

export const soopAdapter: NetLiveAdapter = {
  platform: "soop",
  getRecommend,
  search,
  resolve,
  getCategories,
  getCategoryRooms,
  getRoomDetail,
  getLiveStatus,
};
