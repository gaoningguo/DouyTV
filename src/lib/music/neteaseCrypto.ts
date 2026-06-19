/**
 * 网易云 weapi 加密。用于「内置直连」模式下直接请求 music.163.com，
 * 免去用户自部署 NeteaseCloudMusicApi。
 *
 * 算法（全部为网易公开常量，非密钥）：
 *   params  = base64( AES-CBC( base64( AES-CBC(JSON, PRESET_KEY, IV) ), secretKey, IV ) )
 *   encSecKey = RSA无填充( reverse(secretKey) )  → 256 位 hex
 * AES 走 Web Crypto（PKCS7 自动填充），RSA 无填充走 BigInt 模幂。
 * 全程纯前端，跨平台（含安卓/iOS WebView）。
 */

const PRESET_KEY = "0CoJUm6Qyw8W8jud";
const AES_IV = "0102030405060708";
const RSA_EXPONENT = 0x10001n;
const RSA_MODULUS = BigInt(
  "0x00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725" +
    "152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ec" +
    "bda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813" +
    "cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7"
);

const encoder = new TextEncoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function aesCbcBase64(plainText: string, key: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "AES-CBC" },
    false,
    ["encrypt"]
  );
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-CBC", iv: encoder.encode(AES_IV) },
    cryptoKey,
    encoder.encode(plainText)
  );
  return bytesToBase64(new Uint8Array(cipher));
}

const SECRET_ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomSecretKey(length = 16): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += SECRET_ALPHABET[bytes[i] % SECRET_ALPHABET.length];
  }
  return out;
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    e >>= 1n;
    b = (b * b) % modulus;
  }
  return result;
}

function rsaNoPadding(text: string): string {
  const reversed = text.split("").reverse().join("");
  let hex = "";
  for (let i = 0; i < reversed.length; i += 1) {
    hex += reversed.charCodeAt(i).toString(16).padStart(2, "0");
  }
  const value = BigInt("0x" + (hex || "0"));
  return modPow(value, RSA_EXPONENT, RSA_MODULUS).toString(16).padStart(256, "0");
}

export interface WeapiPayload {
  params: string;
  encSecKey: string;
}

/** 对请求体做 weapi 加密，返回可作 application/x-www-form-urlencoded 提交的 params/encSecKey。 */
export async function weapiEncrypt(payload: unknown): Promise<WeapiPayload> {
  const text = JSON.stringify(payload ?? {});
  const secretKey = randomSecretKey();
  const first = await aesCbcBase64(text, PRESET_KEY);
  const params = await aesCbcBase64(first, secretKey);
  const encSecKey = rsaNoPadding(secretKey);
  return { params, encSecKey };
}
