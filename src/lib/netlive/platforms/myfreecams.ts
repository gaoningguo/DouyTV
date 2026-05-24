/**
 * MyFreeCams (myfreecams.com,简称 MFC) —— 老牌成人 cam,WebSocket 流推送架构。
 *
 * 真实 API(2026-05 验证):
 *
 *   ─── 列表(listing,主入口) ───
 *   MFC 没有 REST 列表 API,在线 model 状态走 wss://wchatN.myfreecams.com/fcsl
 *   长连接推送。我们在 Rust 后端(`mfc_ws.rs`)用 tokio-tungstenite 实现一次性快照:
 *     1) GET serverconfig 拿 chat_servers / h5video_servers / wzobs_servers
 *     2) 随机 wchatN 连 wss
 *     3) `hello fcserver\n\0` + `1 0 0 20071025 0 {nonce}@guest:guest\n` 登录
 *     4) 收 20 秒所有 SESSIONSTATE(FCTYPE=20)
 *     5) 关 WS,过滤 vs==0(FREECHAT 公开)、拼 HLS URL 返回
 *   通过 Tauri command `mfc_list_online` 暴露给前端。
 *
 *   ─── resolve ───
 *   早期版本走 https://share.myfreecams.com/{user} 拿 `data-cam-preview-*` attrs,
 *   2026-05 实测 MFC 已经去掉这些 attrs,share 页 scraper 失效。
 *   改用 listing cache:每个 model 在 Rust 端就已经根据 camserv 查 h5video/wzobs 表
 *   预拼出 hls_url,resolve 直接复用即可。cache miss 时拉一次新 listing。
 *
 *   参考:Damianonymous/MFCAuto + Damianonymous/streamlink-plugins myfreecams.py。
 */
import { invoke } from "@tauri-apps/api/core";
import { resolveProxyForPlatform } from "@/stores/netliveProxy";
import {
  type NetLiveAdapter,
  type NetLiveRoom,
  type NetLiveStream,
} from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const REFERER = "https://www.myfreecams.com/";

/** Rust 端 mfc_list_online 返回的单条 model。字段对齐 `MfcModel` struct。 */
interface MfcListItem {
  nm: string;
  uid: number;
  vs: number;
  topic?: string;
  camserv: number;
  hls_url?: string;
  thumb_url?: string;
  camscore?: number;
  rc?: number;
  country?: string;
}

/* ─────────────── 推荐 ─────────────── */

/**
 * MFC listing 缓存。MFC 的 WS listing 一次握手 20 秒,不可能每翻页都重跑 ——
 * 缓存整个 snapshot 5 分钟,前端 page/pageSize 在缓存基础上切片。
 */
let listingCache: { items: MfcListItem[]; at: number } | null = null;
const LISTING_TTL_MS = 5 * 60 * 1000;

async function fetchListing(): Promise<MfcListItem[]> {
  const now = Date.now();
  if (listingCache && now - listingCache.at < LISTING_TTL_MS) {
    return listingCache.items;
  }
  // 走平台代理 override:走代理时 mfc_list_online 也走同一代理;直连时不传。
  const { proxyUrl, bypass } = resolveProxyForPlatform("myfreecams");
  const effectiveProxy = bypass ? null : proxyUrl ?? null;
  console.info(
    `[mfc] invoking mfc_list_online proxy=${effectiveProxy ?? "<none>"}`,
  );
  try {
    const items = await invoke<MfcListItem[]>("mfc_list_online", {
      proxyUrl: effectiveProxy,
    });
    console.info(`[mfc] mfc_list_online returned ${items.length} models`);
    if (items.length === 0) {
      // 空结果 → 自动跑 diagnose,把详细报告 console.warn 出来
      console.warn(
        "[mfc] empty list — running diagnose for details (takes ~25 sec)...",
      );
      try {
        const report = await invoke<string>("mfc_diagnose", {
          proxyUrl: effectiveProxy,
        });
        console.warn("[mfc diagnose report]\n" + report);
      } catch (de) {
        console.error("[mfc] diagnose itself failed:", de);
      }
    } else {
      // 空结果不缓存 —— 让用户切回 tab 时重试一次
      listingCache = { items, at: now };
    }
    return items;
  } catch (e) {
    console.error(`[mfc] mfc_list_online invoke failed:`, e);
    throw e;
  }
}

function listItemToRoom(m: MfcListItem): NetLiveRoom {
  return {
    platform: "myfreecams",
    roomId: m.nm,
    title: m.topic || m.nm,
    uname: m.nm,
    online: m.rc ?? 0,
    category: m.country,
    cover: m.thumb_url,
    live: m.vs === 0,
    link: `https://www.myfreecams.com/#${encodeURIComponent(m.nm)}`,
  };
}

async function getRecommend(
  page: number,
  pageSize: number,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const all = await fetchListing();
  const p = Math.max(1, page);
  const ps = Math.max(1, pageSize);
  const start = (p - 1) * ps;
  const slice = all.slice(start, start + ps);
  return {
    list: slice.map(listItemToRoom),
    hasMore: start + ps < all.length,
  };
}

async function search(
  keyword: string,
  _page: number,
): Promise<{ list: NetLiveRoom[]; hasMore: boolean }> {
  const all = await fetchListing();
  const kw = keyword.trim().toLowerCase();
  if (!kw) return { list: [], hasMore: false };
  const filtered = all.filter(
    (m) =>
      m.nm.toLowerCase().includes(kw) ||
      (m.topic ?? "").toLowerCase().includes(kw),
  );
  return { list: filtered.map(listItemToRoom), hasMore: false };
}

/* ─────────────── resolve ─────────────── */

async function resolve(roomId: string): Promise<NetLiveStream> {
  // listing cache 命中 → 直接用 Rust 端预拼的 hls_url(已根据 camserv 查表得出
  // h5video / wzobs server,生成完整 playlist.m3u8 URL)。MFC 老的 share page
  // `data-cam-preview-*` attrs 已被去掉,share 抓取已不可用,直接用 listing 数据。
  const cache = listingCache?.items.find(
    (m) => m.nm.toLowerCase() === roomId.toLowerCase(),
  );
  if (cache?.hls_url) {
    return {
      url: cache.hls_url,
      streamType: "hls",
      qn: "auto",
      qnLabel: "自适应",
      referer: REFERER,
      ua: UA,
    };
  }
  // cache miss(直接深链 / 收藏夹播放)→ 拉新 listing 再找一次
  if (!cache) {
    const items = await fetchListing();
    const hit = items.find(
      (m) => m.nm.toLowerCase() === roomId.toLowerCase(),
    );
    if (hit?.hls_url) {
      return {
        url: hit.hls_url,
        streamType: "hls",
        qn: "auto",
        qnLabel: "自适应",
        referer: REFERER,
        ua: UA,
      };
    }
    if (hit) throw new Error(`MyFreeCams 主播 ${roomId} 未在公开列表(可能私聊/离线)`);
    throw new Error(`MyFreeCams 主播 ${roomId} 当前 listing 中不存在`);
  }
  throw new Error(`MyFreeCams 主播 ${roomId} 当前不在线或非公开聊天`);
}

async function getLiveStatus(roomId: string): Promise<boolean> {
  try {
    const items = await fetchListing();
    const hit = items.find(
      (m) => m.nm.toLowerCase() === roomId.toLowerCase(),
    );
    return !!hit && hit.vs === 0;
  } catch {
    return false;
  }
}

export const myfreecamsAdapter: NetLiveAdapter = {
  platform: "myfreecams",
  getRecommend,
  search,
  resolve,
  getLiveStatus,
};
