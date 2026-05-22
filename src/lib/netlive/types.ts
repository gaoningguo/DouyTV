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

export type NetLivePlatformId =
  | "bilibili"
  | "douyu"
  | "huya"
  | "douyin"
  | "kuaishou"
  | "cc"
  | "twitch"
  | "youtube"
  | "kick"
  | "trovo"
  | "bigo"
  | "live17"
  | "chaturbate"
  | "stripchat"
  | "bongacams"
  | "camsoda";

export interface NetLivePlatformMeta {
  id: NetLivePlatformId;
  label: string;
  /** 该平台是否需要登录才能拉清晰度更高的流（DouyTV MVP 用匿名公共接口） */
  loginRequired?: boolean;
  /** 18+ 成人内容平台 —— 默认隐藏，需用户在设置中开启 adultEnabled 才显示 */
  adult?: boolean;
}

export const NETLIVE_PLATFORMS: NetLivePlatformMeta[] = [
  { id: "bilibili", label: "哔哩哔哩" },
  { id: "douyu", label: "斗鱼" },
  { id: "huya", label: "虎牙" },
  { id: "douyin", label: "抖音" },
  { id: "kuaishou", label: "快手" },
  { id: "cc", label: "网易 CC" },
  { id: "twitch", label: "Twitch" },
  { id: "youtube", label: "YouTube" },
  { id: "kick", label: "Kick" },
  { id: "trovo", label: "Trovo" },
  { id: "bigo", label: "Bigo Live" },
  { id: "live17", label: "17 Live" },
  { id: "chaturbate", label: "Chaturbate", adult: true },
  { id: "stripchat", label: "Stripchat", adult: true },
  { id: "bongacams", label: "BongaCams", adult: true },
  { id: "camsoda", label: "CamSoda", adult: true },
];

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
  /** 流类型 (m3u8 / flv / dash) —— VideoPlayer 用这个走对应 customType */
  streamType?: "hls" | "flv" | "dash" | "mp4";
  qn?: string;
  qnLabel?: string;
  /** 防盗链 Referer，VideoPlayer 通过 dyproxy 透传 */
  referer?: string;
  /** 自定义 UA */
  ua?: string;
  /** 平台返回的可选清晰度（同一房间多个 qn） */
  alternatives?: Array<{ qn: string; label: string; url: string }>;
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
