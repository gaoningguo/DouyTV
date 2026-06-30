//! 网易云加密传输层 —— 把 NeteaseCloudMusicApi(enhanced) 的 weapi/eapi 加密 +
//! 匿名 cookie / UA / 随机中国 IP 注入移植到 Rust 后端,用 reqwest 出网。
//!
//! 为什么放 Rust:内置源前端直连 music.163.com 富接口(歌手/专辑/歌单广场等)常被
//! -462 反爬挡。根因不只是加密,更在于缺合法 cookie、桌面端 UA、随机中国 IP。
//! 在 Rust 里复刻 request.js 的 weapi/eapi 分支 + 完整 cookie/header/IP 注入,
//! 原生出网(无 WebView 指纹),命中率远高于前端 scriptFetch 直连。
//!
//! 契约(等价 request.js 的 createRequest):
//!   入参 NeteaseReq { uri, data(JSON), crypto(weapi/eapi/api), cookie, proxy_url }
//!   Rust 负责:选 URL + 加密 + 注入匿名 cookie/UA/IP → POST → 解密 → 回传原始 JSON 文本
//!   前端 neteaseApi.ts 的 URL 构造已有逻辑改为:传 api path 给本命令,拿原始 JSON 再解析。
//!
//! 已实现:weapi(覆盖绝大多数富接口)、eapi(移动端接口)、api(明文)。
//! 未实现:xeapi(x25519+AES-GCM,仅匿名注册/极少数接口需要,后续按需补)。

use std::collections::HashMap;
use std::time::Duration;

use aes::cipher::{generic_array::GenericArray, BlockDecrypt, BlockEncrypt, KeyInit};
use aes::Aes128;
use base64::Engine;
use md5::{Digest, Md5};
use num_bigint::BigUint;
use serde::{Deserialize, Serialize};

const IV: &[u8] = b"0102030405060708";
const PRESET_KEY: &[u8] = b"0CoJUm6Qyw8W8jud";
const EAPI_KEY: &[u8] = b"e82ckenh8dichen8";
const BASE62: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
// 网易 weapi RSA 公钥(模数 + 指数 0x10001),公开常量,非密钥。
const RSA_MODULUS_HEX: &str = "00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7";
const RSA_EXPONENT_HEX: &str = "010001";

const WEAPI_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
const EAPI_UA: &str = "NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)";

const WEAPI_DOMAIN: &str = "https://music.163.com";
const EAPI_DOMAIN: &str = "https://interface.music.163.com";

#[derive(Debug, Deserialize)]
pub struct NeteaseReq {
    /// API 路径,如 `/api/v1/artist/12345`(weapi 会取 uri[5..] 拼到 /weapi/)。
    pub uri: String,
    /// 请求体(JSON 对象)。weapi 会加 csrf_token,eapi 会加 header。
    #[serde(default)]
    pub data: serde_json::Value,
    /// 加密方式:weapi(默认) / eapi / api(明文)。
    #[serde(default)]
    pub crypto: Option<String>,
    /// 可选 cookie 字符串(登录态;匿名留空,Rust 注入匿名 cookie)。
    #[serde(default)]
    pub cookie: Option<String>,
    pub proxy_url: Option<String>,
    /// 可选真实 IP(覆盖随机中国 IP)。
    #[serde(default)]
    pub real_ip: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct NeteaseResp {
    pub status: u16,
    /// 解密后的原始 JSON 文本(前端自行 JSON.parse + 解析,复用既有逻辑)。
    pub body: String,
}

// ───────────────────────── AES ─────────────────────────

fn pkcs7_pad(data: &[u8], block: usize) -> Vec<u8> {
    let pad = block - (data.len() % block);
    let mut out = data.to_vec();
    out.extend(std::iter::repeat(pad as u8).take(pad));
    out
}

fn pkcs7_unpad(data: &[u8]) -> &[u8] {
    if data.is_empty() {
        return data;
    }
    let pad = *data.last().unwrap() as usize;
    if pad == 0 || pad > 16 || pad > data.len() {
        return data;
    }
    &data[..data.len() - pad]
}

/// AES-128-CBC 加密(PKCS7),返回密文字节。
fn aes_cbc_encrypt(data: &[u8], key: &[u8], iv: &[u8]) -> Vec<u8> {
    let cipher = Aes128::new(GenericArray::from_slice(key));
    let padded = pkcs7_pad(data, 16);
    let mut prev = iv.to_vec();
    let mut out = Vec::with_capacity(padded.len());
    for chunk in padded.chunks(16) {
        let mut block = [0u8; 16];
        for i in 0..16 {
            block[i] = chunk[i] ^ prev[i];
        }
        let mut ga = GenericArray::clone_from_slice(&block);
        cipher.encrypt_block(&mut ga);
        out.extend_from_slice(&ga);
        prev = ga.to_vec();
    }
    out
}

/// AES-128-ECB 加密(PKCS7)。
fn aes_ecb_encrypt(data: &[u8], key: &[u8]) -> Vec<u8> {
    let cipher = Aes128::new(GenericArray::from_slice(key));
    let padded = pkcs7_pad(data, 16);
    let mut out = Vec::with_capacity(padded.len());
    for chunk in padded.chunks(16) {
        let mut ga = GenericArray::clone_from_slice(chunk);
        cipher.encrypt_block(&mut ga);
        out.extend_from_slice(&ga);
    }
    out
}

/// AES-128-ECB 解密(PKCS7)。
fn aes_ecb_decrypt(data: &[u8], key: &[u8]) -> Vec<u8> {
    if data.len() % 16 != 0 || data.is_empty() {
        return Vec::new();
    }
    let cipher = Aes128::new(GenericArray::from_slice(key));
    let mut out = Vec::with_capacity(data.len());
    for chunk in data.chunks(16) {
        let mut ga = GenericArray::clone_from_slice(chunk);
        cipher.decrypt_block(&mut ga);
        out.extend_from_slice(&ga);
    }
    pkcs7_unpad(&out).to_vec()
}

fn hex_encode_upper(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02X}", b));
    }
    s
}

// ───────────────────────── weapi ─────────────────────────

fn random_secret_key() -> Vec<u8> {
    use std::time::{SystemTime, UNIX_EPOCH};
    // 简单 PRNG(种子=纳秒),16 位 base62。加密强度由 RSA+AES 保证,这里只需不可预测性低要求。
    let mut seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x9e3779b97f4a7c15);
    let mut out = Vec::with_capacity(16);
    for _ in 0..16 {
        // xorshift64
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        out.push(BASE62[(seed % 62) as usize]);
    }
    out
}

/// RSA 无填充加密:reverse(secretKey) 当大端整数 → modpow(e, n) → 256 hex。
fn rsa_no_padding(secret_key: &[u8]) -> String {
    let reversed: Vec<u8> = secret_key.iter().rev().cloned().collect();
    let m = BigUint::from_bytes_be(&reversed);
    let e = BigUint::parse_bytes(RSA_EXPONENT_HEX.as_bytes(), 16).unwrap();
    let n = BigUint::parse_bytes(RSA_MODULUS_HEX.as_bytes(), 16).unwrap();
    let c = m.modpow(&e, &n);
    let hex = c
        .to_bytes_be()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect::<String>();
    // 左补零到 256 hex 位(128 字节)。
    format!("{:0>256}", hex)
}

/// weapi 加密 → (params, encSecKey)。
fn weapi(text: &str) -> (String, String) {
    let b64 = base64::engine::general_purpose::STANDARD;
    let first = b64.encode(aes_cbc_encrypt(text.as_bytes(), PRESET_KEY, IV));
    let secret = random_secret_key();
    let params = b64.encode(aes_cbc_encrypt(first.as_bytes(), &secret, IV));
    let enc_sec_key = rsa_no_padding(&secret);
    (params, enc_sec_key)
}

// ───────────────────────── eapi ─────────────────────────

/// eapi 加密 → params(hex)。message = `nobody{url}use{text}md5forencrypt`。
fn eapi(url: &str, text: &str) -> String {
    let message = format!("nobody{}use{}md5forencrypt", url, text);
    let mut hasher = Md5::new();
    hasher.update(message.as_bytes());
    let digest = hasher.finalize();
    let digest_hex = digest.iter().map(|b| format!("{:02x}", b)).collect::<String>();
    let data = format!("{}-36cd479b6b5-{}-36cd479b6b5-{}", url, text, digest_hex);
    hex_encode_upper(&aes_ecb_encrypt(data.as_bytes(), EAPI_KEY))
}

/// eapi 响应解密:hex 密文 → AES-ECB 解密 → UTF8 JSON。
fn eapi_res_decrypt(body: &[u8]) -> Option<String> {
    let decrypted = aes_ecb_decrypt(body, EAPI_KEY);
    String::from_utf8(decrypted).ok()
}

// ───────────────────────── 匿名 cookie / IP ─────────────────────────

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn rand_hex(len: usize) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let mut seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x2545f4914f6cdd1d);
    let chars = b"0123456789abcdef";
    let mut s = String::with_capacity(len);
    for _ in 0..len {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        s.push(chars[(seed % 16) as usize] as char);
    }
    s
}

/// 随机中国 IP(简化版:116.x 段,对齐 request.js 兜底逻辑)。
fn random_chinese_ip() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let mut seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x1234567);
    let mut next = |lo: u64, hi: u64| -> u64 {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        lo + (seed % (hi - lo + 1))
    };
    format!("116.{}.{}.{}", next(25, 94), next(1, 254), next(1, 254))
}

/// 构造匿名 cookie 头(weapi/api 用)。对齐 request.js processCookieObject 的匿名分支。
fn build_anonymous_cookie(extra: &str) -> String {
    let nuid = rand_hex(32);
    let ts = now_ms();
    let wnmcid = format!("{}.{}.01.0", rand_hex(6), ts);
    let nmtid = rand_hex(16);
    let mut parts = vec![
        format!("__remember_me=true"),
        format!("ntes_kaola_ad=1"),
        format!("_ntes_nuid={}", nuid),
        format!("_ntes_nnid={},{}", nuid, ts),
        format!("WNMCID={}", wnmcid),
        format!("WEVNSM=1.0.0"),
        format!("NMTID={}", nmtid),
        format!("os=pc"),
        format!("channel=netease"),
        format!("appver=3.1.17.204416"),
        format!("osver=Microsoft-Windows-10-Professional-build-19045-64bit"),
    ];
    if !extra.trim().is_empty() {
        parts.push(extra.trim().trim_end_matches(';').to_string());
    }
    parts.join("; ")
}

// ───────────────────────── 出网 ─────────────────────────

fn build_form(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| format!("{}={}", urlencode(k), urlencode(v)))
        .collect::<Vec<_>>()
        .join("&")
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for &b in s.as_bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

/// 网易加密请求 —— 等价 NeteaseCloudMusicApi request.js 的 weapi/eapi/api 分支。
#[tauri::command]
pub async fn netease_request(req: NeteaseReq) -> Result<NeteaseResp, String> {
    let crypto = req.crypto.clone().unwrap_or_else(|| "weapi".to_string());
    let real_ip = req.real_ip.clone().unwrap_or_else(random_chinese_ip);
    let cookie_extra = req.cookie.clone().unwrap_or_default();

    // data 必须是 JSON 对象;非对象包成空对象。
    let mut data_obj = match req.data.clone() {
        serde_json::Value::Object(m) => m,
        _ => serde_json::Map::new(),
    };

    let uri = req.uri.clone();
    let proxy = req.proxy_url.clone();

    // ── 加密 + URL 构造 ──
    let (url, form_body, ua, use_eapi) = match crypto.as_str() {
        "eapi" => {
            // eapi:data 加 header(匿名设备信息),加密整体。
            let ts = now_ms().to_string();
            let header = serde_json::json!({
                "osver": "16.2",
                "deviceId": rand_hex(52),
                "os": "iPhone OS",
                "appver": "9.0.90",
                "versioncode": "140",
                "buildver": &ts[..ts.len().min(10)],
                "resolution": "1920x1080",
                "channel": "distribution",
                "requestId": format!("{}_{:04}", ts, (now_ms() % 1000)),
            });
            data_obj.insert("header".to_string(), header);
            let text = serde_json::Value::Object(data_obj.clone()).to_string();
            let params = eapi(&uri, &text);
            let url = format!("{}/eapi/{}", EAPI_DOMAIN, &uri[5.min(uri.len())..]);
            let body = build_form(&[("params", &params)]);
            (url, body, EAPI_UA, true)
        }
        "api" => {
            // 明文:直接发 data。
            let text = serde_json::Value::Object(data_obj.clone()).to_string();
            let url = format!("{}{}", EAPI_DOMAIN, uri);
            (url, text, EAPI_UA, false)
        }
        _ => {
            // weapi(默认):加 csrf_token,双层 AES + RSA。
            data_obj.insert("csrf_token".to_string(), serde_json::Value::String(String::new()));
            let text = serde_json::Value::Object(data_obj.clone()).to_string();
            let (params, enc_sec_key) = weapi(&text);
            let path = if uri.len() > 5 { &uri[5..] } else { &uri[..] };
            let url = format!("{}/weapi/{}", WEAPI_DOMAIN, path);
            let body = build_form(&[("params", &params), ("encSecKey", &enc_sec_key)]);
            (url, body, WEAPI_UA, false)
        }
    };

    let cookie_header = build_anonymous_cookie(&cookie_extra);

    // ── reqwest 出网 ──
    let mut builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(5));
    if let Some(p) = proxy.as_deref().filter(|s| !s.trim().is_empty()) {
        builder = builder.proxy(reqwest::Proxy::all(p).map_err(|e| format!("proxy: {e}"))?);
    }
    let client = builder.build().map_err(|e| format!("client: {e}"))?;

    let mut headers: HashMap<&str, String> = HashMap::new();
    headers.insert("User-Agent", ua.to_string());
    headers.insert("Referer", WEAPI_DOMAIN.to_string());
    headers.insert("Cookie", cookie_header);
    headers.insert("X-Real-IP", real_ip.clone());
    headers.insert("X-Forwarded-For", real_ip);
    headers.insert(
        "Content-Type",
        "application/x-www-form-urlencoded".to_string(),
    );

    let mut request = client.post(&url).body(form_body);
    for (k, v) in &headers {
        request = request.header(*k, v);
    }

    let resp = request.send().await.map_err(|e| format!("netease request: {e}"))?;
    let status = resp.status().as_u16();
    let bytes = resp.bytes().await.map_err(|e| format!("body: {e}"))?;

    let body = if use_eapi {
        // eapi 响应可能是密文(hex 不适用,reqwest 拿到原始字节)。先试解密,失败则当明文。
        eapi_res_decrypt(&bytes).unwrap_or_else(|| String::from_utf8_lossy(&bytes).to_string())
    } else {
        String::from_utf8_lossy(&bytes).to_string()
    };

    // 若解出来不是 JSON(eapi 偶发明文),原样返回让前端判断。
    Ok(NeteaseResp { status, body })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weapi_params_are_base64() {
        let (params, enc) = weapi("{\"test\":1}");
        assert!(!params.is_empty());
        assert_eq!(enc.len(), 256); // RSA 输出固定 256 hex。
    }

    #[test]
    fn eapi_roundtrip_ecb() {
        let plain = b"hello netease eapi roundtrip test!";
        let enc = aes_ecb_encrypt(plain, EAPI_KEY);
        let dec = aes_ecb_decrypt(&enc, EAPI_KEY);
        assert_eq!(&dec, plain);
    }
}
