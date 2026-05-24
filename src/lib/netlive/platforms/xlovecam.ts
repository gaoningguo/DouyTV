/**
 * XLoveCam (xlovecam.com) —— 匈牙利 AdultPerformerNetwork 旗下成人 cam。
 *
 * 真实可用 API(2026-05 curl 验证,匿名免登):
 *
 *   - 列表:POST https://www.xlovecam.com/hu/performerAction/onlineList
 *     Content-Type: application/x-www-form-urlencoded
 *     body 字段(StreaMonitor 源码出处):
 *       config[nickname]= (空) / config[favorite]=0 / config[recent]=0 / config[vip]=0
 *       config[sort][id]=35 / offset[from]=N / offset[length]=20
 *       origin=filter-chg / stat=0
 *     翻页用 `offset[from] = (page-1) * length`。
 *     响应:{ content: { performerList: [{id, nickname, snapshot, ...}], ... } }
 *
 *   - 单房间:POST /performerAction/getPerformerRoom body: performerId={id}
 *     响应:{ content: { performer: { online: 0|1, hlsPlaylistFree: "https://..."m3u8" } } }
 *     hlsPlaylistFree 是 master m3u8,wlresources.com CDN。
 *
 *   - roomId 用 nickname(字符串)。性能起见单房间 resolve 时缓存 id ↔ nickname,
 *     无 cache 时回退 listing 探。
 *
 * 注意:hu (匈牙利语) 路径前缀是默认。其他语言路径如 /en /de 也行,值一样。
 */
import { createPlatformFetch } from "@/lib/netlive/scriptFetch";
const scriptFetch = createPlatformFetch("xlovecam");
import type {
  NetLiveAdapter,
  NetLiveRoom,
  NetLiveStream,
} from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const REFERER = "https://www.xlovecam.com/";
const API_BASE = "https://www.xlovecam.com/hu";

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Referer: REFERER,
  Origin: "https://www.xlovecam.com",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

interface XlcPerformer {
  id?: number;
  nickname?: string;
  snapshot?: string;
  imgSoloToken?: string;
  enabled?: boolean;
  online?: number;
  hlsPlaylistFree?: string;
  liveStreamInfo?: Record<string, unknown>;
  virtualRealityAvailable?: boolean;
  profileImg?: string;
}

interface XlcListResp {
  content?: {
    performerList?: XlcPerformer[];
    total?: number;
  };
}

interface XlcRoomResp {
  content?: { performer?: XlcPerformer };
}

async function postForm<T>(
  path: string,
  body: Record<string, string>,
): Promise<T> {
  const form = Object.entries(body)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const res = await scriptFetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      ...COMMON_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
    timeout: 25_000,
    http2: true,
  });
  if (!res.ok) throw new Error(`XLoveCam HTTP ${res.status}`);
  return res.json<T>();
}

// 简单的 nickname → id 缓存,resolve 时优先用,失败回退 listing 探
const nicknameToId = new Map<string, number>();

function mapRoom(p: XlcPerformer): NetLiveRoom | undefined {
  const nick = p.nickname;
  if (!nick) return undefined;
  if (typeof p.id === "number") nicknameToId.set(nick, p.id);
  return {
    platform: "xlovecam",
    roomId: nick,
    title: nick,
    uname: nick,
    avatar: p.profileImg,
    cover: p.snapshot || p.profileImg,
    online: 0,
    live: true,
    link: `https://www.xlovecam.com/hu/profile/${encodeURIComponent(nick)}`,
  };
}

/* ─────────────── 推荐 ─────────────── */

async function getRecommend(
  page: number,
  pageSize: number,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const length = Math.max(pageSize, 20);
  const from = Math.max(0, (page - 1) * length);
  const data = await postForm<XlcListResp>("/performerAction/onlineList", {
    "config[nickname]": "",
    "config[favorite]": "0",
    "config[recent]": "0",
    "config[vip]": "0",
    "config[sort][id]": "35",
    "offset[from]": String(from),
    "offset[length]": String(length),
    origin: "filter-chg",
    stat: "0",
  });
  const arr = data.content?.performerList ?? [];
  const list = arr.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
  // total 字段未必在所有响应里出现 —— arr.length === length 则推测还有下一页
  return { list, hasMore: arr.length >= length };
}

/* ─────────────── 搜索 ─────────────── */

async function search(
  keyword: string,
  _page: number,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const data = await postForm<XlcListResp>("/performerAction/onlineList", {
    "config[nickname]": keyword,
    "config[favorite]": "0",
    "config[recent]": "0",
    "config[vip]": "0",
    "config[sort][id]": "35",
    "offset[from]": "0",
    "offset[length]": "50",
    origin: "filter-chg",
    stat: "0",
  });
  const arr = data.content?.performerList ?? [];
  const list = arr.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
  return { list, hasMore: false };
}

/* ─────────────── resolve ─────────────── */

async function resolveIdFromNickname(nickname: string): Promise<number | null> {
  // listing 拿不到目标 nickname → 用 nickname filter 精确查
  const data = await postForm<XlcListResp>("/performerAction/onlineList", {
    "config[nickname]": nickname,
    "config[favorite]": "0",
    "config[recent]": "0",
    "config[vip]": "0",
    "config[sort][id]": "35",
    "offset[from]": "0",
    "offset[length]": "10",
    origin: "filter-chg",
    stat: "0",
  });
  for (const p of data.content?.performerList ?? []) {
    if (p.nickname?.toLowerCase() === nickname.toLowerCase() && typeof p.id === "number") {
      nicknameToId.set(nickname, p.id);
      return p.id;
    }
  }
  return null;
}

async function resolve(roomId: string): Promise<NetLiveStream> {
  let id = nicknameToId.get(roomId);
  if (!id) {
    id = (await resolveIdFromNickname(roomId)) ?? undefined;
  }
  if (!id) throw new Error(`XLoveCam 未找到主播 ${roomId}`);
  const data = await postForm<XlcRoomResp>("/performerAction/getPerformerRoom", {
    performerId: String(id),
  });
  const perf = data.content?.performer;
  if (!perf) throw new Error(`XLoveCam 拿不到房间数据`);
  if (perf.online !== 1) {
    throw new Error(`XLoveCam 主播 ${roomId} 不在线`);
  }
  const hls = perf.hlsPlaylistFree;
  if (!hls) throw new Error(`XLoveCam 主播 ${roomId} 私密模式,无公开 HLS`);
  return {
    url: hls,
    streamType: "hls",
    qn: "auto",
    qnLabel: "自适应",
    referer: REFERER,
    ua: UA,
  };
}

async function getLiveStatus(roomId: string): Promise<boolean> {
  try {
    let id = nicknameToId.get(roomId);
    if (!id) id = (await resolveIdFromNickname(roomId)) ?? undefined;
    if (!id) return false;
    const data = await postForm<XlcRoomResp>("/performerAction/getPerformerRoom", {
      performerId: String(id),
    });
    return data.content?.performer?.online === 1;
  } catch {
    return false;
  }
}

/* ─────────────── 导出 ─────────────── */

export const xlovecamAdapter: NetLiveAdapter = {
  platform: "xlovecam",
  getRecommend,
  search,
  resolve,
  getLiveStatus,
};
