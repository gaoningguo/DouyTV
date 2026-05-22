/**
 * CamSoda 直播 adapter —— 18+ 成人 cam 平台。
 *
 * 走 camsoda 公开 web API：
 *   - `https://www.camsoda.com/api/v1/browse/online?page=N&showType=&gender=f` —— 房间列表
 *   - 房间详情：`/api/v1/user/{username}` 含 stream_name + edge servers
 *
 * 实现范围：
 *   - getRecommend：browse/online，默认女性 dance/lifestyle 主播
 *   - getCategories：预置 gender + tag
 *   - getCategoryRooms：browse/online filter
 *   - search：browse/online with `find=...`
 *   - resolve：user detail → 组合 `https://edge-{cdn}.csbi.tv/cdn/{stream_name}/playlist.m3u8`
 *
 * roomId = username。
 *
 * 注意：camsoda 强制 ALPN h2 + 现代 TLS，必须走 `http2: true`（script_http_h2 命令，
 * reqwest+rustls），否则 ureq HTTP/1.1 端 TLS 握手会 "unexpected end of file"。
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
const REFERER = "https://www.camsoda.com/";

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Referer: REFERER,
  "Accept-Language": "en-US,en;q=0.9",
  Accept: "application/json, text/plain, */*",
};

interface CsRoom {
  username?: string;
  display_name?: string;
  status?: string;
  description?: string;
  topic?: string;
  viewers?: number;
  thumb?: string;
  thumb_large?: string;
  profile_picture?: string;
  tags?: string[];
  gender?: string;
}

interface CsBrowseResp {
  results?: CsRoom[];
  total?: number;
}

function mapRoom(r: CsRoom): NetLiveRoom | undefined {
  if (!r.username) return undefined;
  if (r.status && r.status !== "online") return undefined;
  return {
    platform: "camsoda",
    roomId: r.username,
    title: r.topic || r.description || r.display_name || r.username,
    uname: r.display_name || r.username,
    avatar: r.profile_picture,
    cover: r.thumb_large || r.thumb,
    online: r.viewers ?? 0,
    category:
      r.tags && r.tags.length > 0 ? r.tags[0] : r.gender,
    live: true,
    link: `https://www.camsoda.com/${r.username}`,
  };
}

async function fetchList(
  params: Record<string, string | number>
): Promise<CsBrowseResp> {
  const url = new URL("https://www.camsoda.com/api/v1/browse/online");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  let res;
  try {
    res = await scriptFetch(url.toString(), {
      method: "GET",
      headers: COMMON_HEADERS,
      timeout: 25_000,
      http2: true,
    });
  } catch (e) {
    // CamSoda 强制 TLS 1.3 + 特定 cipher suite，rustls 默认协商失败。
    // 转 sentinel 让 UI 友好提示，避免显示 "error sending request" raw 错误。
    throw new NetLiveListUnsupportedError(
      "CamSoda",
      `网络层不可达（${(e as Error).message ?? String(e)}）—— 站点 TLS 配置与原生 HTTP 客户端不兼容，请配置代理后重试`
    );
  }
  if (!res.ok) throw new Error(`CamSoda HTTP ${res.status}`);
  return res.json<CsBrowseResp>();
}

/* ─────────────── 推荐 ─────────────── */

async function getRecommend(
  page: number,
  pageSize: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const limit = Math.max(pageSize, 24);
  const data = await fetchList({
    page,
    showType: "all",
    gender: "f",
  });
  const arr = data.results ?? [];
  const list = arr.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: arr.length >= limit };
}

/* ─────────────── 分类 ─────────────── */

const PRESET_CATEGORIES: NetLiveCategory[] = [
  { id: "gender=f", name: "Female" },
  { id: "gender=m", name: "Male" },
  { id: "gender=c", name: "Couples" },
  { id: "gender=t", name: "Trans" },
  { id: "tag=asian", name: "Asian" },
  { id: "tag=latina", name: "Latina" },
  { id: "tag=ebony", name: "Ebony" },
  { id: "tag=teen", name: "Teen 18+" },
  { id: "tag=milf", name: "MILF" },
  { id: "tag=mature", name: "Mature" },
  { id: "tag=bigboobs", name: "Big Boobs" },
  { id: "tag=dance", name: "Dance" },
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
  const data = await fetchList({ [k]: v, page });
  const arr = data.results ?? [];
  const list = arr.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: arr.length >= 24 };
}

/* ─────────────── 搜索 ─────────────── */

async function search(
  keyword: string,
  _page: number
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const data = await fetchList({ find: keyword, page: 1 });
  const arr = data.results ?? [];
  const list = arr.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: false };
}

/* ─────────────── 房间详情 + resolve ─────────────── */

interface CsUserResp {
  user?: {
    username?: string;
    display_name?: string;
    description?: string;
    profile_picture?: string;
    online?: boolean;
    viewers?: number;
    topic?: string;
  };
  edge_servers?: string[];
  stream_name?: string;
}

async function fetchUser(roomId: string): Promise<CsUserResp> {
  const res = await scriptFetch(
    `https://www.camsoda.com/api/v1/user/${encodeURIComponent(roomId)}`,
    {
      method: "GET",
      headers: COMMON_HEADERS,
      timeout: 25_000,
      http2: true,
    }
  );
  if (!res.ok) throw new Error(`CamSoda HTTP ${res.status}`);
  return res.json<CsUserResp>();
}

async function getRoomDetail(roomId: string): Promise<NetLiveRoom> {
  const u = await fetchUser(roomId);
  const user = u.user;
  if (!user) throw new Error(`CamSoda 房间 ${roomId} 未找到`);
  return {
    platform: "camsoda",
    roomId,
    title: user.topic ?? user.description ?? user.display_name ?? roomId,
    uname: user.display_name ?? roomId,
    avatar: user.profile_picture,
    online: user.viewers ?? 0,
    introduction: user.description,
    live: !!user.online,
    link: `https://www.camsoda.com/${roomId}`,
  };
}

async function getLiveStatus(roomId: string): Promise<boolean> {
  try {
    const u = await fetchUser(roomId);
    return !!u.user?.online;
  } catch {
    return false;
  }
}

async function resolve(roomId: string): Promise<NetLiveStream> {
  const u = await fetchUser(roomId);
  if (!u.user?.online) throw new Error("CamSoda 未开播");
  const edge = (u.edge_servers ?? [])[0];
  const streamName = u.stream_name ?? roomId;
  if (!edge || !streamName) {
    throw new Error("CamSoda 未返回 edge_servers / stream_name");
  }
  const url = `https://${edge}/cdn/${streamName}/index.m3u8`;
  return {
    url,
    streamType: "hls",
    qn: "auto",
    qnLabel: "自适应",
    referer: REFERER,
    ua: UA,
  };
}

/* ─────────────── 导出 ─────────────── */

export const camsodaAdapter: NetLiveAdapter = {
  platform: "camsoda",
  getRecommend,
  search,
  resolve,
  getCategories,
  getCategoryRooms,
  getRoomDetail,
  getLiveStatus,
};
