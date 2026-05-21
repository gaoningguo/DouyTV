// @ts-nocheck
/**
 * WY 加密工具 —— 移植自 lx-music-desktop `src/renderer/utils/musicSdk/wy/utils/crypto.js`，
 * 使用 crypto-js + 原生 BigInt 替代 Node `crypto`，浏览器/Tauri 端运行。
 *
 * - linuxapi：AES-128-ECB / PKCS7 / `rFgB&h#%2?^eDg:Q`
 *     用途：`/api/linux/forward` 端点的签名
 * - weapi：双层 AES-128-CBC + RSA-1024 (NO_PADDING) 包 secretKey
 *     用途：`/weapi/*` 端点的签名（NetEase 正统加密，所有端点都支持）
 */
import CryptoJS from "crypto-js";

// ─── linuxapi ─────────────────────────────────────────
const LINUX_KEY = CryptoJS.enc.Utf8.parse("rFgB&h#%2?^eDg:Q");

export function linuxapi(payload: Record<string, unknown>): { eparams: string } {
  const text = JSON.stringify(payload);
  const data = CryptoJS.enc.Utf8.parse(text);
  const encrypted = CryptoJS.AES.encrypt(data, LINUX_KEY, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });
  return {
    eparams: encrypted.ciphertext.toString(CryptoJS.enc.Hex).toUpperCase(),
  };
}

// ─── weapi ────────────────────────────────────────────
const PRESET_KEY = CryptoJS.enc.Utf8.parse("0CoJUm6Qyw8W8jud");
const IV = CryptoJS.enc.Utf8.parse("0102030405060708");
const BASE62 =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const RSA_MODULUS =
  "e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7";
const RSA_EXPONENT = "010001";

function aesCbcEncryptBase64FromText(text: string, keyWA: CryptoJS.lib.WordArray): string {
  const data = CryptoJS.enc.Utf8.parse(text);
  const encrypted = CryptoJS.AES.encrypt(data, keyWA, {
    iv: IV,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  return CryptoJS.enc.Base64.stringify(encrypted.ciphertext);
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base = base % mod;
  let e = exp;
  let b = base;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

/** RSA NO_PADDING：把 16 字节 secretKey reverse 后左 pad 0 到 128 字节，再做 m^e mod n */
function rsaEncryptSecretKey(secretKey: string): string {
  // 1. reverse 字符串
  const reversed = secretKey.split("").reverse().join("");
  // 2. utf8 → hex
  let hex = "";
  for (let i = 0; i < reversed.length; i++) {
    hex += reversed.charCodeAt(i).toString(16).padStart(2, "0");
  }
  // 3. 左 pad 到 256 hex chars (128 bytes = 1024 bits)
  hex = hex.padStart(256, "0");
  // 4. m^e mod n
  const m = BigInt("0x" + hex);
  const e = BigInt("0x" + RSA_EXPONENT);
  const n = BigInt("0x" + RSA_MODULUS);
  const result = modPow(m, e, n);
  // 5. 输出 256-char lowercase hex
  return result.toString(16).padStart(256, "0");
}

export function weapi(object: Record<string, unknown>): { params: string; encSecKey: string } {
  const text = JSON.stringify(object);
  // 16 char base62 random secretKey
  let secretKey = "";
  for (let i = 0; i < 16; i++) {
    secretKey += BASE62.charAt(Math.floor(Math.random() * 62));
  }
  const secretKeyWA = CryptoJS.enc.Utf8.parse(secretKey);
  // 两轮 AES：第一轮用 PRESET_KEY 加密 text；第二轮用 secretKey 加密第一轮的 base64
  const firstPass = aesCbcEncryptBase64FromText(text, PRESET_KEY);
  const secondPass = aesCbcEncryptBase64FromText(firstPass, secretKeyWA);
  return {
    params: secondPass,
    encSecKey: rsaEncryptSecretKey(secretKey),
  };
}

