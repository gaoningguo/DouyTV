/**
 * .cyrene 配置文件解密 —— 照搬 CyreneMusic cyreneConfigService。
 * 文件结构：魔数"CYRN"(4) + 版本(1) + IV(12) + 密文 + AuthTag(16)，AES-256-GCM。
 * 解出 OmniParse 音源的 { name, url, apiKey }。
 */
export interface CyreneConfig {
  name: string;
  url: string;
  apiKey: string;
}

const ENCRYPTION_KEY = "CyreneMusic2024SecretKey12345678";
const MAGIC = new Uint8Array([0x43, 0x59, 0x52, 0x4e]); // "CYRN"
const SUPPORTED_VERSION = 1;

function validateFormat(data: Uint8Array): boolean {
  // 最小：魔数(4)+版本(1)+IV(12)+密文(≥1)+Tag(16)=34
  if (data.length < 34) return false;
  for (let i = 0; i < 4; i += 1) if (data[i] !== MAGIC[i]) return false;
  return data[4] === SUPPORTED_VERSION;
}

/** 解密 .cyrene 字节流；失败返回 null。 */
export async function decryptCyreneConfig(data: Uint8Array): Promise<CyreneConfig | null> {
  try {
    if (!validateFormat(data)) return null;
    const iv = data.slice(5, 17);
    const authTag = data.slice(data.length - 16);
    const encrypted = data.slice(17, data.length - 16);
    // Web Crypto AES-GCM 需密文 + tag 拼接。
    const ciphertextWithTag = new Uint8Array(encrypted.length + authTag.length);
    ciphertextWithTag.set(encrypted);
    ciphertextWithTag.set(authTag, encrypted.length);

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(ENCRYPTION_KEY),
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );
    const buffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      key,
      ciphertextWithTag
    );
    const bytes = new Uint8Array(buffer);
    // 去尾部零填充。
    let len = bytes.length;
    while (len > 0 && bytes[len - 1] === 0) len -= 1;
    const json = JSON.parse(new TextDecoder().decode(bytes.slice(0, len)));
    return {
      name: typeof json.name === "string" ? json.name : "OmniParse",
      url: typeof json.url === "string" ? json.url : "",
      apiKey: typeof json.apiKey === "string" ? json.apiKey : "",
    };
  } catch {
    return null;
  }
}
