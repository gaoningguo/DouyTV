/**
 * 网络直播抽象 —— 跟 IPTV (m3u 频道) 平级的二级形态：来自直播平台（B站/斗鱼/虎牙 等）。
 *
 * 设计：
 *  - 内置 platform adapter（src/lib/netlive/platforms/*）实现协议细节
 *  - 用户也可以加 plugin 形态（JS 沙盒，预留接口，MVP 不实现）
 *  - 每个 adapter 返回的房间都是 NetLiveRoom，统一调用
 *
 * 与现有 LiveChannel (IPTV) 区别：
 *  - IPTV 来源是用户自己导入的 m3u 文件 / 订阅
 *  - NetLive 来源是平台 API 实时数据（推荐 / 分类 / 搜索）
 */

export type NetLivePlatformId = string;

export interface NetLivePlatformMeta {
  id: NetLivePlatformId;
  label: string;
  /** 该平台是否需要登录才能拉清晰度更高的流（DouyTV MVP 用匿名公共接口） */
  loginRequired?: boolean;
  /** 18+ 成人内容平台 —— 默认隐藏，需用户在设置中开启 adultEnabled 才显示 */
  adult?: boolean;
  /**
   * 推荐的默认代理策略 —— 国内 CN IP 可直连 / 海外平台几乎必须走代理:
   *   - "direct": 默认直连。国内大厂(B站/斗鱼/虎牙/抖音/快手/网易CC)。
   *   - "proxy":  默认走全局代理。海外 cleansite (Twitch/YouTube/Kick/Trovo) +
   *               海外 adult cam (Chaturbate/Stripchat/CamSoda/...) + 韩国 BJ (Pandalive/SOOP)。
   * 用户可在直播页 tab 右键 / 长按改 per-platform override。
   */
  defaultProxy?: "direct" | "proxy";
}

/**
 * 平台元数据 —— 由 useExternalPluginStore 在 hydrate 时从已注册插件填充。
 * 主仓库不再硬编码,见 stores/netliveExternalPlugins.ts#hydrate。
 */
export const NETLIVE_PLATFORMS: NetLivePlatformMeta[] = [];

export function setNetLivePlatforms(metas: NetLivePlatformMeta[]) {
  NETLIVE_PLATFORMS.length = 0;
  for (const m of metas) NETLIVE_PLATFORMS.push(m);
}

export interface NetLiveCategory {
  id: string;
  name: string;
  cover?: string;
  parent?: string;
}

export interface NetLiveRoom {
  platform: NetLivePlatformId;
  /** 平台房间唯一 ID */
  roomId: string;
  title: string;
  uname?: string;
  avatar?: string;
  cover?: string;
  /** 观看人数 / 弹幕量等热度，UI 排序用 */
  online?: number;
  category?: string;
  /** ON / OFF 直播状态 */
  live: boolean;
  /** 主播介绍 / 直播间公告 */
  introduction?: string;
  notice?: string;
  /** 平台直播间页面 URL（分享 / 浏览器打开用） */
  link?: string;
  /** 是否为录播 */
  isRecord?: boolean;
}

export interface NetLiveStream {
  /** 实际播放 URL */
  url: string;
  /**
   * 流类型 (m3u8 / flv / dash / mp4 / chunked-mp4 / sample-aes-mp4 / agora-rtc) —— VideoPlayer 用这个走对应 customType。
   * `chunked-mp4` 用于 AmateurTV / Cam4 等用 `live.mp4?token=` 的 fragmented MP4 长连接,
   * 必须走 hyper stream proxy(chunked transfer),不能走 dyproxy URI scheme(会卡死)。
   * `sample-aes-mp4` 用于 a0s.net 系平台 fmp4-hls 端点:Rust 端拉 m3u8 + key,边收 chunked
   * fragment 边 fMP4 box parse + SAMPLE-AES 逐 sample 原地解密,推明文 fMP4 给 native <video>。
   * `agora-rtc` 用于 ManyVids 之类已迁移到 Agora WebRTC SFU 的平台:`url` 是 sentinel
   * `agora-rtc://{channelId}`,真正凭证由下面的 `agora` 字段携带,ArtPlayer 走专门的
   * customType.agorartc → 懒加载 agora-rtc-sdk-ng 加入频道、subscribe 远端 track。
   */
  streamType?: "hls" | "flv" | "dash" | "mp4" | "chunked-mp4" | "sample-aes-mp4" | "agora-rtc";
  qn?: string;
  qnLabel?: string;
  /** 防盗链 Referer，VideoPlayer 通过 dyproxy 透传 */
  referer?: string;
  /** 自定义 UA */
  ua?: string;
  /** 平台返回的可选清晰度（同一房间多个 qn） */
  alternatives?: Array<{ qn: string; label: string; url: string }>;
  /**
   * Agora WebRTC 凭证 —— `streamType==="agora-rtc"` 时必填。
   * SDK 走 `client.join(appId, channelId, token, uid)` 加入频道,然后订阅远端 track。
   * `refresh` 是关键 —— **每次 attachAgora 都调它拿一份全新的 (token, uid)**,
   * 否则 React StrictMode 双 mount 会用同 token 并发 join 撞 UID_CONFLICT,
   * 生产环境切回同一房间也会因为 server 端旧 connection 未释放冲突。
   * 没 refresh 时只 fallback 用初始凭证(适合一次性场景)。
   */
  agora?: {
    appId: string;
    channelId: string;
    token: string;
    uid: number;
    refresh?: () => Promise<{ channelId: string; token: string; uid: number }>;
  };
}

/** Adapter 接口 —— 每个平台实现一份 */
export interface NetLiveAdapter {
  platform: NetLivePlatformId;
  /** 推荐 / 热门 直播间 */
  getRecommend(page: number, pageSize: number): Promise<{
    list: NetLiveRoom[];
    hasMore: boolean;
  }>;
  /** 关键字搜索 —— 不支持时返回空 */
  search?(keyword: string, page: number): Promise<{
    list: NetLiveRoom[];
    hasMore: boolean;
  }>;
  /** 拉某一房间的可播放流（高优先级 endpoint） */
  resolve(roomId: string): Promise<NetLiveStream>;
  /** 分类导航 —— 不支持时返回空 */
  getCategories?(): Promise<NetLiveCategory[]>;
  /** 分类下房间列表 */
  getCategoryRooms?(categoryId: string, page: number): Promise<{
    list: NetLiveRoom[];
    hasMore: boolean;
  }>;
  /** 房间详情（介绍 / 公告 / 录播标记等富信息） */
  getRoomDetail?(roomId: string): Promise<NetLiveRoom>;
  /** 在线状态查询（书架 / 收藏列表批量检测用） */
  getLiveStatus?(roomId: string): Promise<boolean>;
}

/**
 * message 前缀 sentinel —— 平台没有公开"推荐 / 分类列表"端点时抛出。
 * UI 层（Network.tsx）检测到该前缀后渲染友好 EmptyState 而不是红色错误条。
 * 用 string prefix 而非 instanceof，是为了跨 bundle / serialize 后仍可识别。
 */
export const NETLIVE_LIST_UNSUPPORTED_PREFIX = "[LIST_UNSUPPORTED]";

export class NetLiveListUnsupportedError extends Error {
  readonly platformLabel: string;
  constructor(platformLabel: string, hint?: string) {
    const body = hint
      ? `${platformLabel} 暂不支持推荐列表 / 分类浏览（${hint}）`
      : `${platformLabel} 暂不支持推荐列表 / 分类浏览`;
    super(`${NETLIVE_LIST_UNSUPPORTED_PREFIX} ${body}`);
    this.name = "NetLiveListUnsupportedError";
    this.platformLabel = platformLabel;
  }
}

export function isListUnsupportedMessage(msg: string | null | undefined): boolean {
  return !!msg && msg.startsWith(NETLIVE_LIST_UNSUPPORTED_PREFIX);
}

export function stripListUnsupportedPrefix(msg: string): string {
  return msg.startsWith(NETLIVE_LIST_UNSUPPORTED_PREFIX)
    ? msg.slice(NETLIVE_LIST_UNSUPPORTED_PREFIX.length).trimStart()
    : msg;
}
