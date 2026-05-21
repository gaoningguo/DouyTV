/**
 * Stripchat 直播 adapter —— 18+ 成人内容平台。
 *
 * Stripchat 没有公开 affiliate JSON 接口，但其 `/api/front/v2/models/` REST endpoint
 * 在浏览器端可匿名调用（响应 JSON）。结构对外稳定，适合直接抓。
 *
 * 实现范围：
 *   - getRecommend：`/api/front/v2/models?primaryTag=girls&limit=30&offset=N` —— 主页 grid
 *   - getCategories：预置 tag（girls/guys/couples/trans + 热门 fetish tag）
 *   - getCategoryRooms：同 endpoint，按 tag 过滤
 *   - search：`/api/front/v2/models?searchPhrase=...`
 *   - resolve：抓房间页 HTML，提取 `flashVarsString` 或 `model.cdnUrl/streamName`，
 *     组合 `https://b-{cdn}.doppiocdn.live/hls/{user}/master.m3u8`
 *   - getRoomDetail：单 model GET（公开接口）
 *
 * roomId = username。
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
const REFERER = "https://stripchat.com/";
const API_BASE = "https://stripchat.com/api/front/v2/models";

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  "Accept-Language": "en-US,en;q=0.9",
  Referer: REFERER,
};

interface ScModelRaw {
  id?: number;
  username?: string;
  primaryTag?: string;
  status?: string; // "public" | "private" | "off" ...
  viewersCount?: number;
  topic?: string;
  age?: number;
  country?: string;
  modelDetails?: { fullName?: string };
  snapshotUrl?: string;
  previewUrlThumbBig?: string;
  previewUrlThumbSmall?: string;
  tags?: Array<{ slug?: string; name?: string }>;
  streamName?: string;
  cdnUrl?: string;
}

interface ScListResp {
  models?: ScModelRaw[];
  count?: number;
}

function mapModel(m: ScModelRaw): NetLiveRoom | undefined {
  if (!m.username) return undefined;
  // 早期版本只放 status==="public"；新接口字段可能是 "live" / 大写 / 缺省，
  // 放宽：只要不是明确 "off"/"private" 就当作可显示直播。
  const st = (m.status ?? "").toLowerCase();
  if (st === "off" || st === "private" || st === "offline") return undefined;
  const tags = m.tags ?? [];
  return {
    platform: "stripchat",
    roomId: m.username,
    title: m.topic || m.modelDetails?.fullName || m.username,
    uname: m.modelDetails?.fullName || m.username,
    cover:
      m.previewUrlThumbBig || m.snapshotUrl || m.previewUrlThumbSmall,
    online: m.viewersCount ?? 0,
    category:
      tags.length > 0 ? tags[0].name ?? tags[0].slug : m.primaryTag,
    live: true,
    link: `https://stripchat.com/${m.username}`,
  };
}

async function fetchList(
  params: Record<string, string | number>
): Promise<ScListResp> {
  const url = new URL(API_BASE);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  const res = await scriptFetch(url.toString(), {
    method: "GET",
    headers: COMMON_HEADERS,
    timeout: 25_000,
    http2: true,
  });
  if (!res.ok) throw new Error(`Stripchat HTTP ${res.status}`);
  return res.json<ScListResp>();
}

/* ─────────────── 推荐 ─────────────── */

async function getRecommend(
  page: number,
  pageSize: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const limit = Math.max(pageSize, 30);
  // 不带 primaryTag —— 老枚举值（girls/guys）已废弃，新接口直接接受空过滤返"所有公开直播"
  const data = await fetchList({
    limit,
    offset: (page - 1) * limit,
  });
  const models = data.models ?? [];
  const list = models.map(mapModel).filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: models.length >= limit };
}

/* ─────────────── 分类 ─────────────── */

const PRESET_CATEGORIES: NetLiveCategory[] = [
  { id: "primaryTag=female", name: "Female" },
  { id: "primaryTag=male", name: "Male" },
  { id: "primaryTag=couple", name: "Couples" },
  { id: "primaryTag=trans", name: "Trans" },
  { id: "tagSlugs=asian", name: "Asian" },
  { id: "tagSlugs=latina", name: "Latina" },
  { id: "tagSlugs=ebony", name: "Ebony" },
  { id: "tagSlugs=teen-18", name: "Teen 18+" },
  { id: "tagSlugs=milf", name: "MILF" },
  { id: "tagSlugs=mature", name: "Mature" },
  { id: "tagSlugs=big-tits", name: "Big Tits" },
  { id: "tagSlugs=squirt", name: "Squirt" },
  { id: "tagSlugs=dance", name: "Dance" },
];

async function getCategories(): Promise<NetLiveCategory[]> {
  return PRESET_CATEGORIES;
}

async function getCategoryRooms(
  categoryId: string,
  page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const [k, v] = categoryId.split("=");
  if (!k || !v) return { list: [], hasMore: false };
  const limit = 30;
  const data = await fetchList({
    [k]: v,
    limit,
    offset: (page - 1) * limit,
  });
  const models = data.models ?? [];
  const list = models.map(mapModel).filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: models.length >= limit };
}

/* ─────────────── 搜索 ─────────────── */

async function search(
  keyword: string,
  _page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const data = await fetchList({
    searchPhrase: keyword,
    limit: 30,
  });
  const models = data.models ?? [];
  const list = models.map(mapModel).filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: false };
}

/* ─────────────── 房间详情 + status ─────────────── */

async function getRoomDetail(roomId: string): Promise<NetLiveRoom> {
  const url = `https://stripchat.com/api/front/v2/models/username/${encodeURIComponent(roomId)}/cam`;
  const res = await scriptFetch(url, {
    method: "GET",
    headers: COMMON_HEADERS,
    timeout: 25_000,
    http2: true,
  });
  if (!res.ok) throw new Error(`Stripchat HTTP ${res.status}`);
  const body = (await res.json<{ model?: ScModelRaw }>()) ?? {};
  if (!body.model) throw new Error(`Stripchat 房间 ${roomId} 未找到`);
  const mapped = mapModel(body.model);
  if (mapped) return mapped;
  return {
    platform: "stripchat",
    roomId,
    title: roomId,
    uname: body.model.modelDetails?.fullName || roomId,
    live: false,
    link: `https://stripchat.com/${roomId}`,
  };
}

async function getLiveStatus(roomId: string): Promise<boolean> {
  try {
    const url = `https://stripchat.com/api/front/v2/models/username/${encodeURIComponent(roomId)}/cam`;
    const res = await scriptFetch(url, {
      method: "GET",
      headers: COMMON_HEADERS,
      timeout: 15_000,
      http2: true,
    });
    if (!res.ok) return false;
    const body = (await res.json<{ model?: ScModelRaw }>()) ?? {};
    const st = (body.model?.status ?? "").toLowerCase();
    return st !== "" && st !== "off" && st !== "private" && st !== "offline";
  } catch {
    return false;
  }
}

/* ─────────────── resolve ─────────────── */

async function resolve(roomId: string): Promise<NetLiveStream> {
  // model 详情接口里通常会带 streamName / cdnUrl，可直接组 HLS URL
  const url = `https://stripchat.com/api/front/v2/models/username/${encodeURIComponent(roomId)}/cam`;
  const res = await scriptFetch(url, {
    method: "GET",
    headers: COMMON_HEADERS,
    timeout: 25_000,
    http2: true,
  });
  if (res.ok) {
    const body = (await res.json<{ model?: ScModelRaw }>()) ?? {};
    const m = body.model;
    if (m?.streamName) {
      const cdn = (m.cdnUrl ?? "").replace(/\/$/, "");
      const hls = cdn
        ? `${cdn}/hls/${m.streamName}/${m.streamName}.m3u8`
        : `https://edge-hls.doppiocdn.com/hls/${m.streamName}/master/${m.streamName}_auto.m3u8`;
      return {
        url: hls,
        streamType: "hls",
        qn: "auto",
        qnLabel: "自适应",
        referer: REFERER,
        ua: UA,
      };
    }
  }
  // 回退到 HTML 解析
  const pageRes = await scriptFetch(`https://stripchat.com/${roomId}`, {
    method: "GET",
    headers: {
      ...COMMON_HEADERS,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    timeout: 25_000,
    http2: true,
  });
  if (!pageRes.ok) throw new Error(`Stripchat HTTP ${pageRes.status}`);
  const html = await pageRes.text();
  const m = html.match(/"streamName"\s*:\s*"([^"]+)"/);
  if (!m) {
    throw new Error("Stripchat 未提取到 streamName（房间未开播 / 私密）");
  }
  const streamName = m[1];
  const hls = `https://edge-hls.doppiocdn.com/hls/${streamName}/master/${streamName}_auto.m3u8`;
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

export const stripchatAdapter: NetLiveAdapter = {
  platform: "stripchat",
  getRecommend,
  search,
  resolve,
  getCategories,
  getCategoryRooms,
  getRoomDetail,
  getLiveStatus,
};
