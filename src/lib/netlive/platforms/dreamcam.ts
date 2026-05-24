/**
 * DreamCam (dreamcam.com) —— Nanocosmos 系 VR/2D 成人 cam 平台。
 *
 * 真实 API(2026-05 curl 验证,匿名免登):
 *
 *   - 列表(主站真实端点):
 *     GET https://bss.dreamcamtrue.com/api/clients/v1/broadcasts
 *         ?partnerId=dreamcam_oauth2&limit=N&offset=M
 *         &show-offline=false&tag-categories=girls
 *         &stream-types=video2D,video3D
 *         &include-tags=false&include-tip-menu=false&include-favorites=false
 *     响应:{ totalCount, pageItems: [{ modelId, modelNickname, broadcastStatus,
 *                                     thumbnailsUrl{preview2D,preview3D},
 *                                     streams[{ streamType:"video2D"|"video3D",
 *                                              status, url }],
 *                                     broadcastMembersCount, ...}] }
 *     broadcastStatus: "public" / "private" / "away" / "offline"
 *     `partnerId` 是必传。limit 实测最大 ≥ 64。旧的 `?page=N&size=M` 还能用但
 *     默认排除 offline,totalCount 偏少。
 *
 *   - HLS:listing 已嵌 `streams[video2D].url`(标准 HLS m3u8)。
 *     模型也有 video3D(VR Nanocosmos fmp4s 协议),DouyTV player 不支持,跳过。
 *
 *   - roomId 用 modelNickname。
 */
import { createPlatformFetch } from "@/lib/netlive/scriptFetch";
const scriptFetch = createPlatformFetch("dreamcam");
import type {
  NetLiveAdapter,
  NetLiveRoom,
  NetLiveStream,
} from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const REFERER = "https://dreamcam.com/";
const API_BASE = "https://bss.dreamcamtrue.com";

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Referer: REFERER,
  Origin: "https://dreamcam.com",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

interface DcStream {
  streamType?: string; // "video2D" / "video3D"
  status?: string;
  url?: string | null;
}

interface DcBroadcast {
  id?: string;
  modelId?: string;
  modelNickname?: string;
  modelAge?: number;
  modelSex?: string;
  modelProfilePhotoUrl?: string;
  modelLivePhotoUrl?: string | null;
  thumbnailsUrl?: { preview2D?: string; preview3D?: string };
  broadcastTextStatus?: string;
  broadcastStatus?: string;
  broadcastMembersCount?: number;
  broadcastDurationSec?: number;
  streamUrl?: string;
  streams?: DcStream[];
}

interface DcListResp {
  totalCount?: number;
  pageItems?: DcBroadcast[];
}

async function fetchList(offset: number, limit: number): Promise<DcListResp> {
  // 2026-05 起 dreamcam.com 主站列表用的真实端点 —— offset/limit 分页 + 必传 partnerId
  // + 显式 stream-types。旧的 ?page=N&size=M 还能工作但 totalCount 偏少(默认排除 offline)。
  // 这里用主站同款 query,减负参数把 tags / tip-menu / favorites 关掉(我们用不到)。
  const qs = new URLSearchParams({
    partnerId: "dreamcam_oauth2",
    limit: String(limit),
    offset: String(offset),
    "show-offline": "false",
    "tag-categories": "girls",
    "stream-types": "video2D,video3D",
    "include-tags": "false",
    "include-tip-menu": "false",
    "include-favorites": "false",
  });
  const url = `${API_BASE}/api/clients/v1/broadcasts?${qs.toString()}`;
  const res = await scriptFetch(url, {
    method: "GET",
    headers: COMMON_HEADERS,
    timeout: 30_000,
    http2: true,
  });
  if (!res.ok) throw new Error(`DreamCam HTTP ${res.status}`);
  return res.json<DcListResp>();
}

function getThumb(b: DcBroadcast): string | undefined {
  return (
    b.thumbnailsUrl?.preview2D ||
    b.thumbnailsUrl?.preview3D ||
    b.modelProfilePhotoUrl
  );
}

function getHls(b: DcBroadcast): string | undefined {
  const s2d = b.streams?.find((s) => s.streamType === "video2D");
  if (s2d?.url && s2d.url.startsWith("http")) return s2d.url;
  return undefined;
}

function mapRoom(b: DcBroadcast): NetLiveRoom | undefined {
  const nick = b.modelNickname;
  if (!nick) return undefined;
  const status = (b.broadcastStatus ?? "").toLowerCase();
  return {
    platform: "dreamcam",
    roomId: nick,
    title: b.broadcastTextStatus || nick,
    uname: nick,
    avatar: b.modelProfilePhotoUrl,
    cover: getThumb(b),
    online: b.broadcastMembersCount ?? 0,
    category: b.modelSex,
    live: status === "public",
    link: `https://dreamcam.com/cams/${encodeURIComponent(nick)}`,
  };
}

/* ─────────────── 推荐 ─────────────── */

async function getRecommend(
  page: number,
  pageSize: number,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  // 新端点 limit/offset 分页,limit 不再被强制 10(实测 50 真返 50)。
  const limit = Math.min(Math.max(pageSize, 24), 64);
  const offset = Math.max(page - 1, 0) * limit;
  const data = await fetchList(offset, limit);
  const arr = data.pageItems ?? [];
  const list = arr.map(mapRoom).filter((r): r is NetLiveRoom => !!r);
  const total = data.totalCount ?? 0;
  return { list, hasMore: arr.length > 0 && offset + arr.length < total };
}

/* ─────────────── resolve ─────────────── */

async function findBroadcast(nickname: string): Promise<DcBroadcast | undefined> {
  // 没有 single-room API。遍历前几页找 nickname。一次拉 64 条,3 页足覆盖。
  const LIMIT = 64;
  for (let p = 0; p < 3; p++) {
    const data = await fetchList(p * LIMIT, LIMIT);
    const arr = data.pageItems ?? [];
    const found = arr.find(
      (b) => b.modelNickname?.toLowerCase() === nickname.toLowerCase(),
    );
    if (found) return found;
    if (arr.length < LIMIT) break;
  }
  return undefined;
}

async function resolve(roomId: string): Promise<NetLiveStream> {
  const b = await findBroadcast(roomId);
  if (!b) throw new Error(`DreamCam 未找到主播 ${roomId}`);
  const status = (b.broadcastStatus ?? "").toLowerCase();
  if (status !== "public") {
    throw new Error(`DreamCam 主播 ${roomId} 状态 ${status}(私密/离线)`);
  }
  const hls = getHls(b);
  if (!hls) {
    throw new Error(`DreamCam 主播 ${roomId} 只有 VR(video3D) 流,2D HLS 不可用`);
  }
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
    const b = await findBroadcast(roomId);
    return (b?.broadcastStatus ?? "").toLowerCase() === "public";
  } catch {
    return false;
  }
}

/* ─────────────── 导出 ─────────────── */

export const dreamcamAdapter: NetLiveAdapter = {
  platform: "dreamcam",
  getRecommend,
  resolve,
  getLiveStatus,
};
