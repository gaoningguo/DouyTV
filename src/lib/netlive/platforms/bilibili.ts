/**
 * 哔哩哔哩直播 adapter —— 走公开 web API（匿名可访问），全部经 scriptFetch（Tauri ureq 绕 CORS）。
 *
 * 关键 API：
 *  - 推荐：https://api.live.bilibili.com/xlive/web-interface/v1/second/getList?platform=web&parent_area_id=0&area_id=0&sort_type=&page=1
 *  - 一级分区：https://api.live.bilibili.com/room/v1/Area/getList
 *  - 二级分区房间：https://api.live.bilibili.com/xlive/web-interface/v1/second/getList?platform=web&parent_area_id=X&area_id=Y&sort_type=sort_type_152&page=N
 *  - 搜索：https://api.bilibili.com/x/web-interface/wbi/search/type?search_type=live&keyword=...（注意：需要 wbi 签名，匿名访问 404 几率高，我们 fallback 空结果）
 *  - 拉流 URL：https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id={id}&protocol=0,1&format=0,1,2&codec=0,1&qn=10000
 *
 * 没有签名 / cookies 的情况下：
 *  - 推荐 / 分区列表：OK
 *  - 搜索：可能被风控，先做最小调用，失败抛错让 UI 显示
 *  - 拉流：可拿到最高 qn=10000（原画）的 HLS URL；登录态会拿到 4K，匿名仅到原画 HD
 */
import { scriptFetch } from "@/source-script/fetch";
import type {
  NetLiveAdapter,
  NetLiveCategory,
  NetLiveRoom,
  NetLiveStream,
} from "../types";

const BASE = "https://api.live.bilibili.com";
const COMMON_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36",
  Referer: "https://live.bilibili.com/",
};

interface BiliEnvelope<T> {
  code: number;
  message?: string;
  data?: T;
}

async function api<T>(url: string): Promise<T> {
  const res = await scriptFetch(url, {
    method: "GET",
    headers: COMMON_HEADERS,
    timeout: 20_000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json<BiliEnvelope<T>>();
  if (body.code !== 0) {
    throw new Error(body.message || `B站 code ${body.code}`);
  }
  return body.data as T;
}

interface BiliListItem {
  roomid?: number;
  title?: string;
  uname?: string;
  face?: string;
  cover?: string;
  cover_from_user?: string;
  user_cover?: string;
  online?: number;
  area_name?: string;
  area_v2_name?: string;
  live_status?: number;
}

interface BiliListResp {
  list?: BiliListItem[];
  has_more?: number;
  count?: number;
}

function mapRoom(raw: BiliListItem): NetLiveRoom | undefined {
  const id = raw.roomid;
  const title = raw.title;
  if (!id || !title) return undefined;
  return {
    platform: "bilibili",
    roomId: String(id),
    title,
    uname: raw.uname,
    avatar: raw.face,
    cover: raw.cover ?? raw.user_cover ?? raw.cover_from_user,
    online: raw.online,
    category: raw.area_v2_name ?? raw.area_name,
    live: raw.live_status === 1 || raw.live_status === undefined,
  };
}

export const bilibiliAdapter: NetLiveAdapter = {
  platform: "bilibili",

  async getRecommend(page, _pageSize) {
    const url = `${BASE}/xlive/web-interface/v1/second/getList?platform=web&parent_area_id=0&area_id=0&page=${page}`;
    const data = await api<BiliListResp>(url);
    const list = (data.list ?? [])
      .map(mapRoom)
      .filter((r): r is NetLiveRoom => !!r);
    return { list, hasMore: data.has_more === 1 };
  },

  async getCategories() {
    const url = `${BASE}/room/v1/Area/getList`;
    const data = await api<
      Array<{
        id: number;
        name: string;
        list?: Array<{ id: number; name: string; pic?: string }>;
      }>
    >(url);
    const out: NetLiveCategory[] = [];
    for (const parent of data ?? []) {
      for (const child of parent.list ?? []) {
        out.push({
          id: `${parent.id}:${child.id}`,
          name: child.name,
          cover: child.pic,
          parent: parent.name,
        });
      }
    }
    return out;
  },

  async getCategoryRooms(categoryId, page) {
    const [parentId, areaId] = categoryId.split(":");
    if (!parentId || !areaId) {
      throw new Error("分类 ID 格式不对（应为 parent:child）");
    }
    const url = `${BASE}/xlive/web-interface/v1/second/getList?platform=web&parent_area_id=${parentId}&area_id=${areaId}&page=${page}`;
    const data = await api<BiliListResp>(url);
    const list = (data.list ?? [])
      .map(mapRoom)
      .filter((r): r is NetLiveRoom => !!r);
    return { list, hasMore: data.has_more === 1 };
  },

  async resolve(roomId): Promise<NetLiveStream> {
    // qn=10000 = 原画；protocol=0,1 同时拿 HLS + FLV；format=0,1,2 让上游决定最佳格式
    const url = `${BASE}/xlive/web-room/v2/index/getRoomPlayInfo?room_id=${roomId}&protocol=0,1&format=0,1,2&codec=0,1&qn=10000`;
    interface PlayInfoResp {
      playurl_info?: {
        playurl?: {
          stream?: Array<{
            protocol_name?: string;
            format?: Array<{
              format_name?: string;
              codec?: Array<{
                codec_name?: string;
                base_url?: string;
                url_info?: Array<{ host?: string; extra?: string }>;
                accept_qn?: number[];
                current_qn?: number;
              }>;
            }>;
          }>;
        };
      };
    }
    const data = await api<PlayInfoResp>(url);
    const streams = data.playurl_info?.playurl?.stream ?? [];
    // 选 HLS (http_hls 或 http_ts) 优先；否则降级到 flv
    let chosen: { url: string; type: "hls" | "flv"; qn: number } | null = null;
    for (const stream of streams) {
      const proto = (stream.protocol_name ?? "").toLowerCase();
      for (const fmt of stream.format ?? []) {
        for (const codec of fmt.codec ?? []) {
          const baseUrl = codec.base_url;
          const info = codec.url_info?.[0];
          if (!baseUrl || !info?.host) continue;
          const full = `${info.host}${baseUrl}${info.extra ?? ""}`;
          if (proto.includes("hls") || (fmt.format_name ?? "").includes("ts") || (fmt.format_name ?? "").includes("m3u8")) {
            chosen = { url: full, type: "hls", qn: codec.current_qn ?? 0 };
            break;
          }
          if (!chosen) {
            chosen = { url: full, type: "flv", qn: codec.current_qn ?? 0 };
          }
        }
        if (chosen?.type === "hls") break;
      }
      if (chosen?.type === "hls") break;
    }
    if (!chosen) throw new Error("B站未返回可用拉流地址（房间未开播 / 已下播）");
    return {
      url: chosen.url,
      streamType: chosen.type,
      qn: String(chosen.qn),
      referer: "https://live.bilibili.com/",
      ua: COMMON_HEADERS["User-Agent"],
    };
  },
};
