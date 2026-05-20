/**
 * 斗鱼弹幕 WS —— 移植自 pure_live `lib/core/danmaku/douyu_danmaku.dart`。
 *
 * 协议：
 *  - URL: `wss://danmuproxy.douyu.com:8506`
 *  - 帧头（小端）：[fullLen u32][fullLen u32][packType u16=689][encrypted u8=0][reserved u8=0]
 *  - 帧体：UTF-8 STT 字符串 + 终止 `\0`
 *
 * STT 编解码：
 *  - `type@=loginreq/roomid@=xxx/` —— `/` 分字段，`@=` 分 key=value，`//` 分多记录
 *  - 转义：`@A` ← `@`，`@S` ← `/`
 *
 * 入房：先 `type@=loginreq/roomid@={rid}/` 再 `type@=joingroup/rid@={rid}/gid@=-9999/`
 * 心跳：每 45s 发一次 `type@=mrkl/`
 * 接收 `chatmsg`：`nn` 昵称，`txt` 正文，`col` 颜色码
 */
import type {
  DanmakuClient,
  DanmakuHandlers,
  DanmakuMessage,
} from "./types";

const WS_URL = "wss://danmuproxy.douyu.com:8506";
const HEARTBEAT_INTERVAL = 45_000;

/* ────────── 颜色映射 ────────── */
function douyuColor(col: number): string | undefined {
  switch (col) {
    case 1:
      return "#FF0000";
    case 2:
      return "#1E87F0";
    case 3:
      return "#7AC84B";
    case 4:
      return "#FF7F00";
    case 5:
      return "#9B39F4";
    case 6:
      return "#FF69B4";
    default:
      return undefined;
  }
}

/* ────────── 二进制 helpers ────────── */
function encodeFrame(body: string): ArrayBuffer {
  const bodyBytes = new TextEncoder().encode(body);
  // fullLen = 4 + 4 + body.length + 1（不含开头的 fullLen 自身 4 字节，与 dart 实现一致）
  const fullLen = 4 + 4 + bodyBytes.length + 1;
  // 总缓冲 = fullLen (4) + payload (fullLen)
  const buf = new ArrayBuffer(4 + fullLen);
  const view = new DataView(buf);
  view.setUint32(0, fullLen, true); // fullMsgLength
  view.setUint32(4, fullLen, true); // fullMsgLength2
  view.setUint16(8, 689, true); // packType
  view.setUint8(10, 0); // encrypted
  view.setUint8(11, 0); // reserved
  new Uint8Array(buf).set(bodyBytes, 12);
  // last byte = 0（已经是默认 0）
  return buf;
}

function decodeFrame(data: ArrayBuffer): string | null {
  if (data.byteLength < 12) return null;
  const view = new DataView(data);
  const fullLen = view.getUint32(0, true);
  // fullLen 含 4+4+body.length+1，body 在偏移 12 开始，长度 = fullLen - 9
  const bodyLen = fullLen - 9;
  if (bodyLen < 0 || 12 + bodyLen > data.byteLength) return null;
  const bytes = new Uint8Array(data, 12, bodyLen);
  return new TextDecoder("utf-8").decode(bytes);
}

/* ────────── STT 解析 ────────── */
function unescapeStt(s: string): string {
  return s.replace(/@S/g, "/").replace(/@A/g, "@");
}

type SttValue = string | SttObject | SttValue[];
interface SttObject {
  [key: string]: SttValue;
}

function sttParse(str: string): SttValue {
  if (str.includes("//")) {
    const parts: SttValue[] = [];
    for (const field of str.split("//")) {
      if (!field) continue;
      parts.push(sttParse(field));
    }
    return parts;
  }
  if (str.includes("@=")) {
    const obj: SttObject = {};
    for (const field of str.split("/")) {
      if (!field) continue;
      const idx = field.indexOf("@=");
      if (idx < 0) continue;
      const k = field.slice(0, idx);
      const v = unescapeStt(field.slice(idx + 2));
      obj[k] = sttParse(v);
    }
    return obj;
  }
  return unescapeStt(str);
}

/* ────────── 客户端实现 ────────── */
export function createDouyuDanmaku(
  roomId: string,
  handlers: DanmakuHandlers
): DanmakuClient {
  let ws: WebSocket | null = null;
  let alive = false;
  let stopped = false;
  let heartbeatTimer: number | null = null;
  let reconnectTimer: number | null = null;

  const sendStt = (body: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(encodeFrame(body));
  };

  const join = () => {
    sendStt(`type@=loginreq/roomid@=${roomId}/`);
    sendStt(`type@=joingroup/rid@=${roomId}/gid@=-9999/`);
  };

  const beat = () => {
    sendStt("type@=mrkl/");
  };

  const handlePayload = (text: string) => {
    try {
      const parsed = sttParse(text);
      // 一帧 WS 可能含多条 STT 记录（//），递归会得到 array
      const records: SttObject[] = [];
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === "object" && !Array.isArray(item)) {
            records.push(item);
          }
        }
      } else if (typeof parsed === "object") {
        records.push(parsed);
      }
      for (const rec of records) {
        const type = String(rec.type ?? "");
        if (type === "chatmsg") {
          // 屏蔽阴间弹幕（鱼丸打赏伪装等没有 dms 字段）
          if (rec.dms === undefined) continue;
          const colStr = typeof rec.col === "string" ? rec.col : "0";
          const col = parseInt(colStr, 10) || 0;
          const msg: DanmakuMessage = {
            platform: "douyu",
            uname: String(rec.nn ?? "斗鱼用户"),
            text: String(rec.txt ?? ""),
            color: douyuColor(col),
            ts: Date.now(),
            rawType: "chatmsg",
          };
          handlers.onMessage(msg);
        }
      }
    } catch (e) {
      console.warn("[douyu-danmaku] parse failed", e);
    }
  };

  const connect = () => {
    if (stopped) return;
    try {
      ws = new WebSocket(WS_URL);
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        alive = true;
        join();
        handlers.onReady?.();
        // 心跳
        heartbeatTimer = window.setInterval(beat, HEARTBEAT_INTERVAL);
      };
      ws.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) {
          const text = decodeFrame(e.data);
          if (text) handlePayload(text);
        }
      };
      ws.onerror = () => {
        // 通常会跟一个 close
      };
      ws.onclose = (e) => {
        alive = false;
        if (heartbeatTimer !== null) {
          window.clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (stopped) {
          handlers.onClose?.(`已关闭 (${e.code})`);
          return;
        }
        handlers.onClose?.(`与服务器断开，5s 后重连`);
        reconnectTimer = window.setTimeout(connect, 5000);
      };
    } catch (e) {
      handlers.onClose?.(`WebSocket 创建失败：${(e as Error).message}`);
    }
  };

  return {
    start: connect,
    stop: () => {
      stopped = true;
      if (heartbeatTimer !== null) {
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        ws = null;
      }
      alive = false;
    },
    isAlive: () => alive,
  };
}
