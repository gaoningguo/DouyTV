/**
 * Cams.com —— Streamray / Penthouse 系。
 *
 * 真实 API(2026-05 + 用户实测抓包):
 *
 *   ─── Listing(列式压缩 JSON) ───
 *   GET https://beta-api.cams.com/won/compressed/
 *   响应 { mapping: [字段名...], models: [[按 mapping 顺序的值...], ...] }
 *
 *   一次性返回所有 active model 的扁平化数据(没有分页参数,服务端发完整列表)。
 *   `chat_type` 字段对应 StreaMonitor camscom.py 里的 online 状态:
 *     "0" Offline、"1" Public、"2" Nude show、"3" Private、"6" Ticket、"7" Voyeur、
 *     "10" Party、"11/12" Goal、"13" Group、"14" C2C。
 *
 *   每条 model 关键字段(0-indexed for mapping):
 *     screen_name (用户名 slug)
 *     stream_name (HLS 路径用,通常同 screen_name)
 *     gender ("F"/"M")
 *     chat_type → online 状态
 *     image_pg → 头像 numeric id(下面拼 thumbnail URL)
 *
 *   ─── 单房间 resolve ───
 *   GET https://beta-api.cams.com/models/stream/{username}/
 *   返:{ stream_name, online: "0"|"1"|... }
 *
 *   HLS URL: `https://camshls.cams.com/cdn-{lowercase_username}.m3u8`
 *           (2026-05 用户实测抓包确认;StreaMonitor camscom.py 老路径
 *           `camscdn.cams.com/camscdn/cdn-...` 已失效,cams.com 已迁到
 *           nanocosmos H5Live + camshls.cams.com 一级路径。)
 *   缩略图:  imgproxy 包装的 live snapshot GIF →
 *           https://dynimages.securedataimages.com/unsigned/rs:fill:360::0/g:no/plain/
 *           {url-encoded https://images4.streamray.com/images/streamray/streams/
 *                       {lowercase_username}_640.gif}@webp
 *           (raw .gif 是 live snapshot 动图;imgproxy 转 webp 压 5-20×)
 */
import { createPlatformFetch } from "@/lib/netlive/scriptFetch";
const scriptFetch = createPlatformFetch("camscom");
import {
  type NetLiveAdapter,
  type NetLiveCategory,
  type NetLiveRoom,
  type NetLiveStream,
} from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const REFERER = "https://cams.com/";

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Referer: REFERER,
  Origin: "https://cams.com",
  Accept: "application/json, text/plain, */*",
};

const COMPRESSED_URL = "https://beta-api.cams.com/won/compressed/";

interface CcCompressedResp {
  mapping?: string[];
  models?: Array<Array<string | number | boolean | null>>;
}

interface CcModel {
  screen_name: string;
  stream_name: string;
  gender: string;
  chat_type: string;
  image_pg?: string;
  public_age?: string;
  ethnicity?: string;
  languages_spoken?: string;
  is_voyeur_allowed?: boolean;
}

interface CcStreamResp {
  stream_name?: string;
  online?: string;
}

/* ─────────────── 列式 → 对象 mapper ─────────────── */

function rowToModel(
  row: Array<string | number | boolean | null>,
  mapping: string[],
): CcModel | undefined {
  // mapping 里必有 screen_name/stream_name/gender/chat_type;少其一就丢
  const idx: Record<string, number> = {};
  for (let i = 0; i < mapping.length; i++) idx[mapping[i]] = i;
  const get = (k: string): unknown => (idx[k] !== undefined ? row[idx[k]] : undefined);
  const screen = String(get("screen_name") ?? "").trim();
  const stream = String(get("stream_name") ?? screen).trim();
  const gender = String(get("gender") ?? "").trim();
  const chat = String(get("chat_type") ?? "").trim();
  if (!screen || !gender || !chat) return undefined;
  return {
    screen_name: screen,
    stream_name: stream,
    gender,
    chat_type: chat,
    image_pg: get("image_pg") ? String(get("image_pg")) : undefined,
    public_age: get("public_age") ? String(get("public_age")) : undefined,
    ethnicity: get("ethnicity") ? String(get("ethnicity")) : undefined,
    languages_spoken: get("languages_spoken")
      ? String(get("languages_spoken"))
      : undefined,
    is_voyeur_allowed: get("is_voyeur_allowed") === true,
  };
}

/* ─────────────── listing fetch + 缓存 ─────────────── */

let cache: { at: number; models: CcModel[] } | null = null;
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 分钟

async function fetchAll(): Promise<CcModel[]> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.models;
  const res = await scriptFetch(COMPRESSED_URL, {
    method: "GET",
    headers: COMMON_HEADERS,
    timeout: 30_000,
    http2: true,
  });
  if (!res.ok) throw new Error(`Cams.com listing HTTP ${res.status}`);
  const data = await res.json<CcCompressedResp>();
  const mapping = data.mapping ?? [];
  const rows = data.models ?? [];
  if (mapping.length === 0) throw new Error("Cams.com listing 缺 mapping 字段");
  const out: CcModel[] = [];
  for (const r of rows) {
    const m = rowToModel(r, mapping);
    if (m) out.push(m);
  }
  cache = { at: now, models: out };
  return out;
}

/* ─────────────── mapper ─────────────── */

/** chat_type → 是否对匿名用户公开可看(=PUBLIC_SHOW)。 */
function isPublic(chatType: string): boolean {
  // "1"=Public,其他都是 private 或 specialty
  return chatType === "1";
}

function modelToRoom(m: CcModel): NetLiveRoom {
  const cover = buildCoverUrl(m.stream_name || m.screen_name);
  return {
    platform: "camscom",
    roomId: m.screen_name,
    title: m.screen_name,
    uname: m.screen_name,
    cover,
    online: 0,
    category: genderLabel(m.gender),
    live: isPublic(m.chat_type),
    link: `https://cams.com/${encodeURIComponent(m.screen_name)}`,
  };
}

/**
 * 拼 model live snapshot 缩略图(2026-05 实测可匿名直拉)。
 * raw 是 `images4.streamray.com/images/streamray/streams/{user}_640.gif` 动图,
 * 走 cams.com 自家的 imgproxy 实例(dynimages.securedataimages.com)转 webp
 * 缩到 360 宽 —— 列表卡片体积只剩几 KB,无需我们再做转码。
 */
function buildCoverUrl(username: string): string {
  const lower = username.toLowerCase();
  const raw = `https://images4.streamray.com/images/streamray/streams/${lower}_640.gif`;
  return `https://dynimages.securedataimages.com/unsigned/rs:fill:360::0/g:no/plain/${encodeURIComponent(raw)}@webp`;
}

function genderLabel(g: string): string {
  switch (g.toUpperCase()) {
    case "F":
      return "female";
    case "M":
      return "male";
    case "T":
      return "trans";
    case "C":
      return "couple";
    default:
      return g;
  }
}

/* ─────────────── 推荐 ─────────────── */

async function getRecommend(
  page: number,
  pageSize: number,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const all = await fetchAll();
  // 先按"公开优先 + voyeur 优先"排
  const sorted = [...all].sort((a, b) => {
    const pa = isPublic(a.chat_type) ? 0 : 1;
    const pb = isPublic(b.chat_type) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return a.screen_name.localeCompare(b.screen_name);
  });
  const p = Math.max(1, page);
  const ps = Math.max(1, pageSize);
  const start = (p - 1) * ps;
  const slice = sorted.slice(start, start + ps);
  return {
    list: slice.map(modelToRoom),
    hasMore: start + ps < sorted.length,
  };
}

/* ─────────────── 分类 ─────────────── */

const PRESET_CATEGORIES: NetLiveCategory[] = [
  { id: "F", name: "女性" },
  { id: "M", name: "男性" },
  { id: "C", name: "情侣" },
  { id: "T", name: "TS" },
];

async function getCategories(): Promise<NetLiveCategory[]> {
  return PRESET_CATEGORIES;
}

async function getCategoryRooms(
  categoryId: string,
  page: number,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const all = await fetchAll();
  const filtered = all.filter((m) => m.gender.toUpperCase() === categoryId.toUpperCase());
  const sorted = filtered.sort((a, b) => {
    const pa = isPublic(a.chat_type) ? 0 : 1;
    const pb = isPublic(b.chat_type) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return a.screen_name.localeCompare(b.screen_name);
  });
  const pageSize = 30;
  const p = Math.max(1, page);
  const start = (p - 1) * pageSize;
  const slice = sorted.slice(start, start + pageSize);
  return {
    list: slice.map(modelToRoom),
    hasMore: start + pageSize < sorted.length,
  };
}

/* ─────────────── 搜索 ─────────────── */

async function search(
  keyword: string,
  page: number,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return { list: [], hasMore: false };
  const all = await fetchAll();
  const matched = all.filter((m) => m.screen_name.toLowerCase().includes(kw));
  const pageSize = 30;
  const p = Math.max(1, page);
  const start = (p - 1) * pageSize;
  const slice = matched.slice(start, start + pageSize);
  return {
    list: slice.map(modelToRoom),
    hasMore: start + pageSize < matched.length,
  };
}

/* ─────────────── resolve ─────────────── */

async function fetchStatus(username: string): Promise<CcStreamResp | null> {
  try {
    const res = await scriptFetch(
      `https://beta-api.cams.com/models/stream/${encodeURIComponent(username)}/`,
      { method: "GET", headers: COMMON_HEADERS, timeout: 20_000, http2: true },
    );
    if (!res.ok) return null;
    return res.json<CcStreamResp>();
  } catch {
    return null;
  }
}

async function resolve(roomId: string): Promise<NetLiveStream> {
  // 优先 cache 命中:listing 里 chat_type=1 即可直接拼 HLS
  if (cache) {
    const hit = cache.models.find(
      (m) => m.screen_name.toLowerCase() === roomId.toLowerCase(),
    );
    if (hit) {
      if (!isPublic(hit.chat_type)) {
        throw new Error(
          `Cams.com 主播 ${roomId} chat_type=${hit.chat_type}(私密/秀场,匿名无画面)`,
        );
      }
      return {
        url: `https://camshls.cams.com/cdn-${(hit.stream_name || hit.screen_name).toLowerCase()}.m3u8`,
        streamType: "hls",
        qn: "auto",
        qnLabel: "自适应",
        referer: REFERER,
        ua: UA,
      };
    }
  }
  // cache miss → 单房间状态查询
  const data = await fetchStatus(roomId);
  if (!data || !data.stream_name) throw new Error(`Cams.com 主播 ${roomId} 不存在`);
  if (data.online === "0") throw new Error(`Cams.com 主播 ${roomId} 离线`);
  if (data.online !== "1") {
    throw new Error(`Cams.com 主播 ${roomId} 状态 ${data.online}(私密/秀场,匿名无画面)`);
  }
  return {
    url: `https://camshls.cams.com/cdn-${(data.stream_name || roomId).toLowerCase()}.m3u8`,
    streamType: "hls",
    qn: "auto",
    qnLabel: "自适应",
    referer: REFERER,
    ua: UA,
  };
}

async function getLiveStatus(roomId: string): Promise<boolean> {
  if (cache) {
    const hit = cache.models.find(
      (m) => m.screen_name.toLowerCase() === roomId.toLowerCase(),
    );
    if (hit) return isPublic(hit.chat_type);
  }
  const data = await fetchStatus(roomId);
  return data?.online === "1";
}

export const camscomAdapter: NetLiveAdapter = {
  platform: "camscom",
  getRecommend,
  search,
  resolve,
  getCategories,
  getCategoryRooms,
  getLiveStatus,
};
