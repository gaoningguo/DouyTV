/**
 * AmateurTV (amateur.tv) —— 老牌成人 cam, 西班牙起家。
 *
 * 已验证公开匿名接口（2026-05-24 curl 验证）：
 *
 *   - 在线列表（匿名可用）
 *     GET https://www.amateur.tv/v3/readmodel/cache/onlinecamlist-cam-score
 *
 *   - 单房间详情
 *     GET https://www.amateur.tv/v3/readmodel/show/{username}/en
 *
 *   - 拉流字段(`videoTechnologies`):
 *     - `ws`        wss://live-fws-edge.a0s.net/f-stream-ws?token=…
 *     - `hls`       "https://dummy"  ← 占位符,不可用
 *     - `hlsV2`     "https://dummy"  ← 占位符,不可用
 *     - `fmp4`      https://live-fmp4-edge.a0s.net/play/live.mp4?token=…    ← chunked fMP4,首选
 *     - `fmp4-hls`  https://live-hls-edge.a0s.net/play/master.m3u8?token=…  ← 是 #EXT-X-PLAYLIST-TYPE:VOD
 *                   只含 1 秒分片 + #EXT-X-ENDLIST,hls.js 收到立即停止刷新,不能直接给 hls.js
 *
 * 🚨 2026-05-24 实测踩坑：
 *   - 历史 adapter 用 fmp4 + streamType:"hls" → hls.js 拿到 .mp4 死等 #EXTM3U → 房间卡 loading
 *   - 正解:fmp4 是 `Content-Type: video/mp4` + `Transfer-Encoding: chunked` 的 fragmented MP4
 *     长连接直播流(`X-Powered-By: FragStream by VisionTS.io`)
 *   - 必须走本地 hyper stream proxy(不是 dyproxy,后者无 chunked 支持),video 标签原生消费
 *   - 用专门的 `streamType: "chunked-mp4"`(在 proxy.ts wrapWithProxy 走 stream proxy,
 *     ArtPlayerHost detectArtType → undefined 让 ArtPlayer 用 native)
 *
 * 字段坑:
 *   - HEAD live-fmp4-edge.a0s.net 会 301 → f-stream-edge-va-N.a0s.net(redirectedTo claim
 *     被注入新 token),reqwest 默认 follow redirect 处理,我们不用管
 *   - `qualities` 是 ["1280x720", ...] 列表,可用 `?variant={height}` 选清晰度
 *   - `?variant=` 是 fmp4 URL 上的 query param,不是路径
 */

import { createPlatformFetch } from "@/lib/netlive/scriptFetch";
const scriptFetch = createPlatformFetch("amateurtv");

import type {
  NetLiveAdapter,
  NetLiveRoom,
  NetLiveStream,
} from "../types";

// 列表/详情接口用 desktop Chrome UA(返完整 cam meta)
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

// 🚨 拉流时必须用 iOS Safari UA —— Cumination(dobbelina/plugin.video.cumination/sites/amateurtv.py)
// 用 `User-Agent=iPad`(Kodi 简写,实际展开成完整 iOS UA)。实测匿名 desktop Chrome UA 服务端会返
// FastEVO 加密 decoy 流(花屏);iOS Safari UA 返标准 HLS 明文流。
// 之前 amateurtv-fmp4-chunked.md memory 里"fmp4-hls 是加密占位符"的结论错了,是被 desktop UA
// 触发的 decoy 误导。
const STREAM_UA =
  "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const REFERER = "https://www.amateur.tv/";

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Referer: REFERER,
  Origin: "https://www.amateur.tv",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

/* ─────────────────────────────── */
/* types */
/* ─────────────────────────────── */

interface AtvCam {
  id?: string;
  username?: string;
  gender?: string;
  topic?: string;
  viewers?: number;
  online?: boolean;

  avatar?: string;

  optimized?: {
    avatar?: string;
    capture?: string;
    fullCapture?: string;
    videoCapture?: string;
  };

  capture?: string;
  fullCapture?: string;

  language?: string;
  countryName?: string;
  tags?: string[];

  video?: string;
}

interface AtvListResp {
  cams?: AtvCam[];
}

interface AtvShow {
  status?: string;
  privateChatStatus?: string | null;

  qualities?: string[];

  videoTechnologies?: {
    fmp4?: string;
    [k: string]: unknown;
  };

  message?: string;
  result?: string;
}

/* ─────────────────────────────── */
/* api */
/* ─────────────────────────────── */

async function fetchOnlineList(): Promise<AtvListResp> {
  const res = await scriptFetch(
    "https://www.amateur.tv/v3/readmodel/cache/onlinecamlist-cam-score",
    {
      method: "GET",
      headers: COMMON_HEADERS,
      timeout: 25_000,
      http2: true,
    },
  );

  if (!res.ok) {
    throw new Error(`AmateurTV HTTP ${res.status}`);
  }

  return res.json<AtvListResp>();
}

async function fetchShow(username: string): Promise<AtvShow> {
  const res = await scriptFetch(
    `https://www.amateur.tv/v3/readmodel/show/${encodeURIComponent(username)}/en`,
    {
      method: "GET",
      headers: COMMON_HEADERS,
      timeout: 25_000,
      http2: true,
    },
  );

  if (!res.ok) {
    throw new Error(`AmateurTV HTTP ${res.status}`);
  }

  return res.json<AtvShow>();
}

/* ─────────────────────────────── */
/* room mapper */
/* ─────────────────────────────── */

function absUrl(url?: string): string | undefined {
  if (!url) return undefined;

  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }

  return `https://www.amateur.tv${url}`;
}

function mapRoom(cam: AtvCam): NetLiveRoom | undefined {
  const username = cam.username;

  if (!username) return undefined;

  return {
    platform: "amateurtv",

    roomId: username,

    title: cam.topic || username,

    uname: username,

    avatar:
      absUrl(cam.optimized?.avatar) ||
      absUrl(cam.avatar),

    cover:
      absUrl(cam.optimized?.fullCapture) ||
      absUrl(cam.optimized?.capture) ||
      absUrl(cam.fullCapture) ||
      absUrl(cam.capture),

    online: cam.viewers ?? 0,

    category:
      cam.tags?.slice(0, 5).join(", ") ||
      cam.countryName ||
      undefined,

    live: cam.online ?? true,

    link: `https://www.amateur.tv/${username}`,
  };
}

/* ─────────────────────────────── */
/* recommend */
/* ─────────────────────────────── */

async function getRecommend(
  page: number,
  pageSize: number,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {

  const data = await fetchOnlineList();

  const all = (data.cams ?? [])
    .map(mapRoom)
    .filter((r): r is NetLiveRoom => !!r);

  // 本地假分页
  const start = (page - 1) * pageSize;
  const end = start + pageSize;

  return {
    list: all.slice(start, end),
    hasMore: end < all.length,
  };
}

/* ─────────────────────────────── */
/* search */
/* ─────────────────────────────── */

async function search(
  keyword: string,
  page: number,
  pageSize: number = 20,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {

  const data = await fetchOnlineList();

  const lower = keyword.toLowerCase();

  const matched = (data.cams ?? [])
    .filter((cam) => {
      return (
        cam.username?.toLowerCase().includes(lower) ||
        cam.topic?.toLowerCase().includes(lower) ||
        cam.tags?.some((t) => t.toLowerCase().includes(lower))
      );
    })
    .map(mapRoom)
    .filter((r): r is NetLiveRoom => !!r);

  const start = (page - 1) * pageSize;
  const end = start + pageSize;

  return {
    list: matched.slice(start, end),
    hasMore: end < matched.length,
  };
}

/* ─────────────────────────────── */
/* room detail */
/* ─────────────────────────────── */

async function getRoomDetail(roomId: string): Promise<NetLiveRoom> {

  const list = await fetchOnlineList();

  const found = list.cams?.find(
    (x) => x.username?.toLowerCase() === roomId.toLowerCase(),
  );

  if (found) {
    const room = mapRoom(found);

    if (room) return room;
  }

  const show = await fetchShow(roomId);

  return {
    platform: "amateurtv",

    roomId,

    title: roomId,

    uname: roomId,

    live: show.status === "online",

    category: show.privateChatStatus
      ? "private"
      : "public",

    link: `https://www.amateur.tv/${roomId}`,
  };
}

/* ─────────────────────────────── */
/* live status */
/* ─────────────────────────────── */

async function getLiveStatus(roomId: string): Promise<boolean> {
  try {
    const data = await fetchShow(roomId);

    return (
      data.status === "online" &&
      !data.privateChatStatus
    );
  } catch {
    return false;
  }
}

/* ─────────────────────────────── */
/* resolve */
/* ─────────────────────────────── */

async function resolve(roomId: string): Promise<NetLiveStream> {

  const data = await fetchShow(roomId);

  if (data.message === "NOT_FOUND") {
    throw new Error(`AmateurTV 主播 ${roomId} 不存在`);
  }

  if (data.status !== "online") {
    throw new Error(`AmateurTV 主播 ${roomId} 不在线`);
  }

  if (data.privateChatStatus) {
    throw new Error(`AmateurTV 主播 ${roomId} 私密模式`);
  }

  // 🚨 2026-05-24 第三轮(确诊):a0s.net 系平台 fragment 是 chunked 长连接 + SAMPLE-AES
  // sample 级加密 fMP4。Web 浏览器 hls.js 处理不了 chunked fragment(等 fetch.arrayBuffer
  // 完整下载),native video 拿到加密样本也是花屏(SAMPLE-AES 是 HLS 协议层特性,native 不解)。
  // 参考 Cumination(Kodi inputstream 底层 ffmpeg)能边拉边 demux + 解 SAMPLE-AES 所以能播。
  // 我们的方案:Rust 端 SAMPLE-AES 解密代理(sample_aes_proxy.rs)
  //   - 拉 fmp4-hls m3u8 + key.bin + IV
  //   - 拉 fragment chunked
  //   - 边拉边 fMP4 box parse,逐 sample 原地 AES-CBC 解密(H.264 1:9 pattern / AAC 跳 16 leader)
  //   - 把明文 fMP4 通过 mpsc 推到 hyper response,native <video> 直接消费
  // streamType `sample-aes-mp4` 让 proxy.ts 走 stream proxy + `decrypt=sample-aes` 端点。
  const vt = data.videoTechnologies as
    | { ws?: string; fmp4?: string; "fmp4-hls"?: string }
    | undefined;
  const m3u8Url = vt?.["fmp4-hls"];
  if (!m3u8Url) {
    throw new Error("AmateurTV 未返回 videoTechnologies['fmp4-hls'] —— 接口形态可能变了");
  }

  return {
    url: m3u8Url,
    streamType: "sample-aes-mp4",
    qn: "auto",
    qnLabel: data.qualities?.[0] ?? "auto",
    referer: REFERER,
    ua: STREAM_UA,
  };
}

/* ─────────────────────────────── */
/* export */
/* ─────────────────────────────── */

export const amateurtvAdapter: NetLiveAdapter = {
  platform: "amateurtv",

  getRecommend,

  search,

  resolve,

  getRoomDetail,

  getLiveStatus,
};