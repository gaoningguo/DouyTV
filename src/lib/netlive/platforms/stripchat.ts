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
  // 实测真实字段（2026-05 验证）
  broadcastGender?: string;
  genderGroup?: string;
  avatarUrl?: string; // 相对路径，需拼 https://img.strpst.com{avatarUrl}-thumb-big.webp
  snapshotUrl?: string;
  previewUrlThumbBig?: string;
  previewUrlThumbSmall?: string;
  tags?: Array<{ slug?: string; name?: string }>;
  streamName?: string;
  snapshotTimestamp?: string | number;
  cdnUrl?: string;
  isLive?: boolean;
  isHd?: boolean;
  presets?: string[];
}

/** 顶层响应：blocks[].models[] 嵌套（不是直接 models[]） */
interface ScListResp {
  blocks?: Array<{
    id?: string;
    url?: string;
    sortBy?: string;
    models?: ScModelRaw[];
  }>;
  totalCount?: number;
  // 老接口兼容：早期是直接 models[]
  models?: ScModelRaw[];
  count?: number;
}

/** Stripchat 真实封面 CDN —— 用 streamName + snapshotTimestamp 拼，实测 200 WebP */
const THUMB_BASE = "https://img.doppiocdn.org/thumbs";

function buildCoverUrl(streamName?: string, snapshotTimestamp?: string | number): string | undefined {
  if (!streamName) return undefined;
  const ts = snapshotTimestamp ?? Math.floor(Date.now() / 1000);
  return `${THUMB_BASE}/${ts}/${streamName}`;
}

function mapModel(m: ScModelRaw): NetLiveRoom | undefined {
  if (!m.username) return undefined;
  // 实测：status "public" / "p2p" / "groupShow" 都算可看；"off" / "offline" / "private" 排除
  const st = (m.status ?? "").toLowerCase();
  if (st === "off" || st === "offline" || st === "private") return undefined;
  // 早期版本字段（modelDetails / tags）—— 新接口可能缺，做 safe 访问
  const tags = m.tags ?? [];
  // 实测 2026-05：cover 用 img.doppiocdn.org/thumbs/{ts}/{streamName}；
  // avatarUrl/previewUrlThumbSmall 是相对路径但其 CDN host 已废，不可用
  return {
    platform: "stripchat",
    roomId: m.username,
    title: m.topic || m.modelDetails?.fullName || m.username,
    uname: m.modelDetails?.fullName || m.username,
    cover: buildCoverUrl(m.streamName, m.snapshotTimestamp),
    online: m.viewersCount ?? 0,
    category:
      tags.length > 0
        ? tags[0].name ?? tags[0].slug
        : m.broadcastGender ?? m.primaryTag,
    live: m.isLive ?? true,
    link: `https://stripchat.com/${m.username}`,
  };
}

/** 把 blocks[].models[] 嵌套打平 + 兼容旧的直接 models[] */
function flattenModels(data: ScListResp): ScModelRaw[] {
  if (Array.isArray(data.models) && data.models.length > 0) return data.models;
  const out: ScModelRaw[] = [];
  const seen = new Set<string>();
  for (const block of data.blocks ?? []) {
    for (const m of block.models ?? []) {
      if (!m.username || seen.has(m.username)) continue;
      seen.add(m.username);
      out.push(m);
    }
  }
  return out;
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
  // 实测：API 强制需要 primaryTag —— 必传 girls/men/couples/trans 其一
  const data = await fetchList({
    primaryTag: "girls",
    limit,
    offset: (page - 1) * limit,
  });
  const models = flattenModels(data);
  const list = models.map(mapModel).filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: models.length >= limit };
}

/* ─────────────── 分类 ─────────────── */

const PRESET_CATEGORIES: NetLiveCategory[] = [
  // 实测确认的 primaryTag 值：girls / men / couples / trans（不是 female/male/couple）
  { id: "primaryTag=girls", name: "Girls" },
  { id: "primaryTag=men", name: "Men" },
  { id: "primaryTag=couples", name: "Couples" },
  { id: "primaryTag=trans", name: "Trans" },
  // 配合 primaryTag=girls 的子标签（tagSlugs 需要 primaryTag 配合）
  { id: "primaryTag=girls&tagSlugs=asian", name: "Asian" },
  { id: "primaryTag=girls&tagSlugs=latina", name: "Latina" },
  { id: "primaryTag=girls&tagSlugs=ebony", name: "Ebony" },
  { id: "primaryTag=girls&tagSlugs=teen-18", name: "Teen 18+" },
  { id: "primaryTag=girls&tagSlugs=milf", name: "MILF" },
  { id: "primaryTag=girls&tagSlugs=mature", name: "Mature" },
  { id: "primaryTag=girls&tagSlugs=big-tits", name: "Big Tits" },
  { id: "primaryTag=girls&tagSlugs=squirt", name: "Squirt" },
  { id: "primaryTag=girls&tagSlugs=dance", name: "Dance" },
];

async function getCategories(): Promise<NetLiveCategory[]> {
  return PRESET_CATEGORIES;
}

async function getCategoryRooms(
  categoryId: string,
  page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  // categoryId 可能是 "k=v" 或 "k1=v1&k2=v2"
  const params: Record<string, string | number> = { limit: 30, offset: (page - 1) * 30 };
  for (const part of categoryId.split("&")) {
    const eq = part.indexOf("=");
    if (eq > 0) params[part.slice(0, eq)] = part.slice(eq + 1);
  }
  // 兜底：若没显式 primaryTag，注入默认 girls（API 强制要求）
  if (!params.primaryTag) params.primaryTag = "girls";
  const data = await fetchList(params);
  const models = flattenModels(data);
  const list = models.map(mapModel).filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: models.length >= 30 };
}

/* ─────────────── 搜索 ─────────────── */

async function search(
  keyword: string,
  _page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  // search 接口也需要 primaryTag
  const data = await fetchList({
    primaryTag: "girls",
    searchPhrase: keyword,
    limit: 30,
  });
  const models = flattenModels(data);
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

/**
 * 实测 2026-05：匿名访问 stripchat 任何主播 master playlist 都 200，但 variant
 * playlist 强制返回带 `#EXT-X-MOUFLON-ADVERT` 标记的广告 VOD（chunk path 是
 * `cpa/v2/chunk_NNN.m4s`，cpa = cost per action）—— 这是 stripchat 反 scrape 策略，
 * 真直播必须带登录 session cookie 才返。
 *
 * 我们当前能做的：
 *   1. 抓 master 后探测 variant，若都是广告 → 抛清晰错误告知用户
 *   2. 极少数主播 variant 不返广告时直接使用
 */
async function resolve(roomId: string): Promise<NetLiveStream> {
  // /cam 接口响应结构是 { cam: { streamName, userStreamName, ... } }，
  // 不是 { model: ... } —— 之前的实现字段路径错。
  const camUrl = `https://stripchat.com/api/front/v2/models/username/${encodeURIComponent(roomId)}/cam`;
  let streamName: string | undefined;
  try {
    const res = await scriptFetch(camUrl, {
      method: "GET",
      headers: COMMON_HEADERS,
      timeout: 20_000,
      http2: true,
    });
    if (res.ok) {
      const body = await res.json<{ cam?: { streamName?: string; userStreamName?: string } }>();
      streamName = body.cam?.userStreamName || body.cam?.streamName;
    }
  } catch {
    /* fall through to HTML */
  }

  // 兜底：HTML 找 streamName
  if (!streamName) {
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
    if (!m) throw new Error("Stripchat 未提取到 streamName（房间未开播 / 私密）");
    streamName = m[1];
  }

  // Stripchat 反爬：匿名拉 master 后 variant 几乎都是广告。还是返回 master URL ——
  // 让用户播放看到广告时知道是平台限制，并在 UI 提示需要浏览器登录。
  // 一旦官方修改策略允许匿名直播，这条 URL 自然能恢复。
  const hls = `https://edge-hls.doppiocdn.com/hls/${streamName}/master/${streamName}_auto.m3u8`;
  return {
    url: hls,
    streamType: "hls",
    qn: "auto",
    qnLabel: "自适应 ⚠ 匿名访问可能只能看广告片段",
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
