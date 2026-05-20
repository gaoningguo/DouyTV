/**
 * NetLive 弹幕通用类型。
 *
 * 每个平台都实现一份 `createXxxDanmaku(roomId, handlers)` 工厂；返回 `DanmakuClient`。
 * UI 层调 `.start()` / `.stop()`，监听 `onMessage` 即可，无需关心 WS 协议细节。
 */

/** 弹幕消息（统一回传） */
export interface DanmakuMessage {
  /** 平台 */
  platform: string;
  /** 发送者昵称 */
  uname: string;
  /** 文本内容 */
  text: string;
  /** ARGB 颜色（'#RRGGBB' 或 'white' 等 CSS 颜色） */
  color?: string;
  /** 接收时间戳 */
  ts: number;
  /** 平台原始消息类型（chatmsg / SuperChat / 醒目留言 等） */
  rawType?: string;
}

export interface DanmakuHandlers {
  /** 收到一条弹幕 */
  onMessage: (msg: DanmakuMessage) => void;
  /** 连接就绪 */
  onReady?: () => void;
  /** 关闭 / 出错 */
  onClose?: (reason: string) => void;
}

/** 客户端句柄 —— UI 持有，关房间时调 stop() */
export interface DanmakuClient {
  start(): void;
  stop(): void;
  /** 当前是否连接中 */
  isAlive(): boolean;
}
