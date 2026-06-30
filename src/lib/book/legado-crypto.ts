// Legado 引擎用的加解密 / 编码工具 —— 浏览器(Tauri WebView)环境替代 Node `crypto` + `Buffer`。
//
// MoonTVPlus 的 legado.client.ts 跑在 Node 上,用 `crypto.createHash`/`createCipheriv`
// 和 `Buffer`。本项目跑在 WebView 里,这两个都没有,改用 crypto-js(纯 JS,同步)+ 一个
// 极简 Buffer shim。书源里的 <js> 规则可能也会引用 `Buffer`/`java.*`,所以 shim 要尽量
// 贴近 Node Buffer 的常用子集。

import CryptoJS from "crypto-js";

type Enc = "utf8" | "utf-8" | "base64" | "hex" | "latin1" | "binary" | "ascii";

/** crypto-js WordArray ←→ Uint8Array 互转。 */
function wordArrayToBytes(wordArray: CryptoJS.lib.WordArray): Uint8Array {
  const { words, sigBytes } = wordArray;
  const out = new Uint8Array(sigBytes);
  for (let i = 0; i < sigBytes; i++) {
    out[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  }
  return out;
}

function bytesToWordArray(bytes: Uint8Array): CryptoJS.lib.WordArray {
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    words[i >>> 2] |= bytes[i] << (24 - (i % 4) * 8);
  }
  return CryptoJS.lib.WordArray.create(words, bytes.length);
}

function strToBytes(str: string, enc: Enc): Uint8Array {
  switch (enc) {
    case "base64": {
      const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    case "hex": {
      const clean = str.replace(/[^0-9a-fA-F]/g, "");
      const out = new Uint8Array(clean.length >> 1);
      for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(clean.substr(i * 2, 2), 16);
      }
      return out;
    }
    case "latin1":
    case "binary":
    case "ascii": {
      const out = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
      return out;
    }
    default: {
      // utf8
      return new TextEncoder().encode(str);
    }
  }
}

function bytesToStr(bytes: Uint8Array, enc: Enc): string {
  switch (enc) {
    case "base64": {
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return btoa(bin);
    }
    case "hex": {
      let hex = "";
      for (let i = 0; i < bytes.length; i++) {
        hex += bytes[i].toString(16).padStart(2, "0");
      }
      return hex;
    }
    case "latin1":
    case "binary":
    case "ascii": {
      let s = "";
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return s;
    }
    default:
      return new TextDecoder("utf-8").decode(bytes);
  }
}

/**
 * 极简 Buffer shim —— 覆盖 Legado 引擎与书源 <js> 规则用到的 Buffer 子集:
 *   Buffer.from(str, enc) / Buffer.from(bytes) / Buffer.alloc(n)
 *   Buffer.concat([...]) / buf.toString(enc) / buf.subarray(a,b) / buf.copy(target)
 * 它本身是 Uint8Array 子类,所以 `instanceof Uint8Array`、索引访问、length 都成立。
 */
export class BufferShim extends Uint8Array {
  static from(
    value: string | ArrayLike<number> | ArrayBuffer | Uint8Array,
    encoding: Enc = "utf8"
  ): BufferShim {
    if (typeof value === "string") {
      return new BufferShim(strToBytes(value, encoding));
    }
    if (value instanceof Uint8Array) {
      return new BufferShim(value);
    }
    if (value instanceof ArrayBuffer) {
      return new BufferShim(new Uint8Array(value));
    }
    return new BufferShim(Uint8Array.from(value as ArrayLike<number>));
  }

  static alloc(size: number, fill = 0): BufferShim {
    const buf = new BufferShim(size);
    if (fill) buf.fill(fill);
    return buf;
  }

  static concat(list: Uint8Array[], totalLength?: number): BufferShim {
    const total =
      totalLength ?? list.reduce((sum, item) => sum + item.length, 0);
    const out = new BufferShim(total);
    let offset = 0;
    for (const item of list) {
      if (offset >= total) break;
      out.set(item.subarray(0, total - offset), offset);
      offset += item.length;
    }
    return out;
  }

  static isBuffer(value: unknown): boolean {
    return value instanceof Uint8Array;
  }

  toString(encoding: Enc = "utf8"): string {
    return bytesToStr(this, encoding);
  }

  // Node Buffer.copy(target, targetStart) 子集 —— tongren keyword 加密里用到。
  copy(target: Uint8Array, targetStart = 0): number {
    const n = Math.min(this.length, target.length - targetStart);
    target.set(this.subarray(0, n), targetStart);
    return n;
  }

  override subarray(begin?: number, end?: number): BufferShim {
    return new BufferShim(super.subarray(begin, end));
  }
}

export const b64encode = (str: string): string =>
  bytesToStr(strToBytes(str, "utf8"), "base64");
export const b64decode = (str: string): string =>
  bytesToStr(strToBytes(str, "base64"), "utf8");

export const md5Hex = (str: string): string =>
  CryptoJS.MD5(str).toString(CryptoJS.enc.Hex);
export const sha1Hex = (str: string): string =>
  CryptoJS.SHA1(str).toString(CryptoJS.enc.Hex);
export const sha256Hex = (str: string): string =>
  CryptoJS.SHA256(str).toString(CryptoJS.enc.Hex);

/**
 * AES-CBC 解密(原始字节进 / 出),NoPadding 与 PKCS7 都支持。
 * 对应原项目 `crypto.createDecipheriv('aes-256-cbc'|'aes-128-cbc', key, iv)`。
 */
export function aesCbcDecrypt(
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  padding: "pkcs7" | "none" = "pkcs7"
): Uint8Array {
  const decrypted = CryptoJS.AES.decrypt(
    CryptoJS.lib.CipherParams.create({ ciphertext: bytesToWordArray(data) }),
    bytesToWordArray(key),
    {
      iv: bytesToWordArray(iv),
      mode: CryptoJS.mode.CBC,
      padding:
        padding === "none" ? CryptoJS.pad.NoPadding : CryptoJS.pad.Pkcs7,
    }
  );
  return wordArrayToBytes(decrypted);
}

/** AES-CBC 加密(原始字节进 / 出)。对应 `crypto.createCipheriv`。 */
export function aesCbcEncrypt(
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  padding: "pkcs7" | "none" = "pkcs7"
): Uint8Array {
  const encrypted = CryptoJS.AES.encrypt(bytesToWordArray(data), bytesToWordArray(key), {
    iv: bytesToWordArray(iv),
    mode: CryptoJS.mode.CBC,
    padding:
      padding === "none" ? CryptoJS.pad.NoPadding : CryptoJS.pad.Pkcs7,
  });
  return wordArrayToBytes(encrypted.ciphertext);
}

export { strToBytes, bytesToStr };
