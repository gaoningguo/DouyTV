//! AmateurTV / a0s.net 系平台 CENC (Common Encryption) AES-CTR 解密代理。
//!
//! 背景:amateur.tv 用 iPad UA 拉 `videoTechnologies['fmp4-hls']` 拿到的 m3u8 标
//! `METHOD=SAMPLE-AES`,但 fMP4 内部实际是标准 CENC `cenc` (AES-CTR + subsample) 加密,
//! 不是 Apple HLS SAMPLE-AES。Apple HLS 这种"m3u8 说 SAMPLE-AES 但 fMP4 用 CENC"是常见
//! 兼容做法 —— 浏览器走 EME / Native 走 ffmpeg 都吃 CENC。
//!
//! 实测格式(2026-05-24 通过 stsd/encv/sinf/tenc/senc box 解出):
//!   - sample entry type = `encv`,包 sinf
//!     - frma = `avc1` (真实 codec H.264)
//!     - schm scheme = `cenc` version 65536(1.0)
//!     - schi.tenc: pattern_byte=0x00 (crypt:0/skip:0) = AES-CTR 全加密(不是 cbcs 1:9)
//!       per_sample_iv_size=16
//!   - traf.senc:每 sample 16 字节 IV + 每 subsample(2 字节 clear + 4 字节 encrypted)
//!   - audio track = `mp4a`(明文不加密)
//!
//! 算法:
//!   1. m3u8 拉 EXT-X-KEY URI 拉 key.bin → 16 字节 AES key(m3u8 IV 不用)
//!   2. 拉 fragment chunked
//!   3. 流式解 ftyp/moov/moof/mdat
//!   4. moof.traf.senc 给每 sample 的 IV + subsamples
//!   5. mdat 按 sample 切,video sample 内按 subsample:跳 clear,AES-CTR 解 encrypted
//!   6. audio sample 整段透传
//!   7. 推明文 fMP4 给 native <video>
//!
//! CENC AES-CTR 模式:counter = IV(16 字节),每个 16 字节 block 用 counter 走 AES-128
//! 加密产生 keystream,跟密文 XOR 得明文;每 block 后 counter 大端 +1。
//! (CENC spec ISO/IEC 23001-7,简化版,无 IV 拼接技巧)

use aes::Aes128;
use aes::cipher::{BlockEncrypt, KeyInit, generic_array::GenericArray};
use bytes::{Bytes, BytesMut};
use std::time::Duration;

const IPAD_UA: &str = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const REFERER: &str = "https://www.amateur.tv/";

/* ─────────────────────────────────────────────────────────── */
/* 公开入口 */
/* ─────────────────────────────────────────────────────────── */

/// SAMPLE-AES 代理参数。
pub struct SampleAesParams {
    /// fmp4-hls m3u8 URL(包含 token)
    pub m3u8_url: String,
    /// 可选 HTTP 代理(Clash 端口)
    pub proxy: Option<String>,
}

/// 拉解 m3u8 / key,拿到 fragment URL + AES key/IV。
pub struct ResolvedStream {
    pub fragment_url: String,
    pub key: [u8; 16],
    pub iv: [u8; 16],
}

/// 一次性把 m3u8 解出来,返回 fragment URL + key + IV。
pub async fn resolve_m3u8(p: &SampleAesParams) -> Result<ResolvedStream, String> {
    let m3u8_text = http_get_text(&p.m3u8_url, p.proxy.as_deref())
        .await
        .map_err(|e| format!("拉 m3u8 失败: {e}"))?;

    let (key_uri, iv) = parse_key_and_iv(&m3u8_text, &p.m3u8_url)
        .ok_or_else(|| "m3u8 缺 EXT-X-KEY URI/IV".to_string())?;

    let fragment_uri = parse_fragment_url(&m3u8_text, &p.m3u8_url)
        .ok_or_else(|| "m3u8 找不到 fragment URL".to_string())?;

    let key_bytes = http_get_bytes(&key_uri, p.proxy.as_deref())
        .await
        .map_err(|e| format!("拉 key.bin 失败: {e}"))?;
    if key_bytes.len() < 16 {
        return Err(format!("key.bin 长度 {} < 16", key_bytes.len()));
    }
    let mut key = [0u8; 16];
    key.copy_from_slice(&key_bytes[..16]);

    Ok(ResolvedStream {
        fragment_url: fragment_uri,
        key,
        iv,
    })
}

/* ─────────────────────────────────────────────────────────── */
/* m3u8 解析 */
/* ─────────────────────────────────────────────────────────── */

fn parse_key_and_iv(m3u8: &str, base_url: &str) -> Option<(String, [u8; 16])> {
    let line = m3u8.lines().find(|l| l.starts_with("#EXT-X-KEY:"))?;
    let uri = extract_attr(line, "URI")?;
    let iv_str = extract_attr(line, "IV")?;
    let iv = parse_hex_iv(&iv_str)?;
    let abs_uri = abs_url(base_url, &uri);
    Some((abs_uri, iv))
}

fn parse_fragment_url(m3u8: &str, base_url: &str) -> Option<String> {
    // 第一个非注释 / 非空 / 非 # 开头的行就是 fragment
    for line in m3u8.lines() {
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        return Some(abs_url(base_url, t));
    }
    None
}

fn extract_attr(line: &str, key: &str) -> Option<String> {
    let needle = format!("{key}=");
    let start = line.find(&needle)?;
    let rest = &line[start + needle.len()..];
    if let Some(stripped) = rest.strip_prefix('"') {
        let end = stripped.find('"')?;
        Some(stripped[..end].to_string())
    } else {
        let end = rest.find(',').unwrap_or(rest.len());
        Some(rest[..end].to_string())
    }
}

fn parse_hex_iv(s: &str) -> Option<[u8; 16]> {
    let hex = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")).unwrap_or(s);
    if hex.len() != 32 {
        return None;
    }
    let mut iv = [0u8; 16];
    for i in 0..16 {
        iv[i] = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(iv)
}

fn abs_url(base: &str, rel: &str) -> String {
    if rel.starts_with("http://") || rel.starts_with("https://") {
        return rel.to_string();
    }
    if let Ok(b) = url::Url::parse(base) {
        if let Ok(joined) = b.join(rel) {
            return joined.into();
        }
    }
    rel.to_string()
}

/* ─────────────────────────────────────────────────────────── */
/* HTTP helpers(reqwest 复用 lib.rs h2 client) */
/* ─────────────────────────────────────────────────────────── */

async fn build_reqwest_client(proxy: Option<&str>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .http2_adaptive_window(true)
        .pool_idle_timeout(Duration::from_secs(90))
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(600))
        .danger_accept_invalid_certs(false);
    if let Some(p) = proxy {
        if !p.is_empty() {
            let prx = reqwest::Proxy::all(p).map_err(|e| format!("proxy parse: {e}"))?;
            builder = builder.proxy(prx);
        }
    }
    builder.build().map_err(|e| format!("client build: {e}"))
}

async fn http_get_text(url: &str, proxy: Option<&str>) -> Result<String, String> {
    let client = build_reqwest_client(proxy).await?;
    let resp = client
        .get(url)
        .header("User-Agent", IPAD_UA)
        .header("Referer", REFERER)
        .header("Accept", "*/*")
        .send()
        .await
        .map_err(|e| format!("send: {e}"))?;
    let status = resp.status().as_u16();
    if status >= 400 {
        return Err(format!("HTTP {status}"));
    }
    resp.text().await.map_err(|e| format!("read body: {e}"))
}

async fn http_get_bytes(url: &str, proxy: Option<&str>) -> Result<Vec<u8>, String> {
    let client = build_reqwest_client(proxy).await?;
    let resp = client
        .get(url)
        .header("User-Agent", IPAD_UA)
        .header("Referer", REFERER)
        .header("Accept", "*/*")
        .send()
        .await
        .map_err(|e| format!("send: {e}"))?;
    let status = resp.status().as_u16();
    if status >= 400 {
        return Err(format!("HTTP {status}"));
    }
    let bytes = resp.bytes().await.map_err(|e| format!("read body: {e}"))?;
    Ok(bytes.to_vec())
}

/// 拉 fragment 的 chunked stream,返回 reqwest 的 byte stream。
pub async fn open_fragment_stream(
    url: &str,
    proxy: Option<&str>,
) -> Result<reqwest::Response, String> {
    let client = build_reqwest_client(proxy).await?;
    let resp = client
        .get(url)
        .header("User-Agent", IPAD_UA)
        .header("Referer", REFERER)
        .header("Accept", "*/*")
        .send()
        .await
        .map_err(|e| format!("send: {e}"))?;
    let status = resp.status().as_u16();
    if status >= 400 {
        return Err(format!("HTTP {status}"));
    }
    Ok(resp)
}

/* ─────────────────────────────────────────────────────────── */
/* AES-128-CTR 解密原语 */
/* ─────────────────────────────────────────────────────────── */

/// 原地 AES-128-CTR 解密(对称,跟加密一样:counter encrypt 出 keystream,XOR 密文)。
/// counter 从 iv 开始,每 16 字节大端 +1。
fn aes_ctr_decrypt_in_place(data: &mut [u8], key: &[u8; 16], iv: &[u8; 16]) {
    let cipher = Aes128::new(GenericArray::from_slice(key));
    let mut counter = *iv;
    let mut pos = 0usize;
    while pos < data.len() {
        // 生成当前 block 的 keystream:encrypt(counter)
        let mut keystream = counter;
        let block = GenericArray::from_mut_slice(&mut keystream);
        cipher.encrypt_block(block);
        // XOR 到 data
        let block_len = (data.len() - pos).min(16);
        for i in 0..block_len {
            data[pos + i] ^= keystream[i];
        }
        pos += 16;
        // counter 大端 +1
        for j in (0..16).rev() {
            counter[j] = counter[j].wrapping_add(1);
            if counter[j] != 0 {
                break;
            }
        }
    }
}

/* ─────────────────────────────────────────────────────────── */
/* CENC subsample 解密 */
/* ─────────────────────────────────────────────────────────── */

/// 给定一个 video sample 的字节切片 + IV + subsample 表,原地按 CENC AES-CTR 解密。
/// subsample 表是 (clear_bytes, encrypted_bytes) 对,按顺序应用。
/// CENC-CTR:加密段使用同一个 counter 连续解密(不是每 subsample 重置 IV);
/// counter 从 sample IV 开始,每 16 字节 +1,跨 subsample 连续。
fn decrypt_cenc_sample(
    sample: &mut [u8],
    key: &[u8; 16],
    iv: &[u8; 16],
    subsamples: &[(u16, u32)],
) -> Result<(), String> {
    if subsamples.is_empty() {
        // 没 subsample 表 → 整 sample 加密(spec fallback)
        aes_ctr_decrypt_in_place(sample, key, iv);
        return Ok(());
    }

    let cipher = Aes128::new(GenericArray::from_slice(key));
    let mut counter = *iv;
    // CENC 的 counter 在 sample 内跨 subsample 连续递增,但 block 边界保持 16 字节对齐 ——
    // 即如果某 encrypted 段不是 16 的倍数,下一个 encrypted 段不是从 keystream offset 0 开始,
    // 而是延续前面 keystream 的剩余部分。spec ISO/IEC 23001-7 5.2:
    //   "the AES_CTR counter shall increment by one for each 16 bytes of encrypted data"
    // 实际上 mp4-rust / shaka-player 都把每个 subsample.encrypted 长度对齐到 16(平台保证),
    // 这里也按"每 encrypted 段独立 16 字节对齐"实现。
    let mut pos = 0usize;
    for (clear, enc) in subsamples {
        pos += *clear as usize;
        let enc_len = *enc as usize;
        if pos + enc_len > sample.len() {
            return Err(format!(
                "subsample 越界 pos={pos} enc={enc_len} sample_len={}",
                sample.len()
            ));
        }
        // 解 enc_len 字节,延续 counter
        let mut sub_pos = 0usize;
        while sub_pos < enc_len {
            let mut keystream = counter;
            let block = GenericArray::from_mut_slice(&mut keystream);
            cipher.encrypt_block(block);
            let block_len = (enc_len - sub_pos).min(16);
            for i in 0..block_len {
                sample[pos + sub_pos + i] ^= keystream[i];
            }
            sub_pos += 16;
            // counter 大端 +1(每个 16 字节 block 后)
            for j in (0..16).rev() {
                counter[j] = counter[j].wrapping_add(1);
                if counter[j] != 0 {
                    break;
                }
            }
        }
        pos += enc_len;
    }
    Ok(())
}

/* ─────────────────────────────────────────────────────────── */
/* fMP4 streaming box parser */
/* ─────────────────────────────────────────────────────────── */

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrackKind {
    Video,  // avc1 / hev1 / hvc1
    Audio,  // mp4a
    Other,
}

/// 从 moov 解析每个 track_id 对应的 kind(根据 stsd 第一个 sample entry)。
#[derive(Default, Debug, Clone)]
pub struct TrackTable {
    /// track_id → TrackKind
    pub kinds: std::collections::HashMap<u32, TrackKind>,
}

impl TrackTable {
    pub fn kind_of(&self, track_id: u32) -> TrackKind {
        self.kinds.get(&track_id).copied().unwrap_or(TrackKind::Other)
    }
}

/// 解析 moov box(完整 buffer),提取 track_id → TrackKind。
pub fn parse_moov(moov: &[u8]) -> TrackTable {
    let mut table = TrackTable::default();
    walk_boxes(moov, |kind, body| {
        if kind == b"trak" {
            if let Some((track_id, sample_kind)) = parse_trak(body) {
                table.kinds.insert(track_id, sample_kind);
            }
        }
    });
    table
}

fn parse_trak(trak: &[u8]) -> Option<(u32, TrackKind)> {
    let mut track_id: Option<u32> = None;
    let mut kind: Option<TrackKind> = None;
    walk_boxes(trak, |k, body| {
        if k == b"tkhd" && body.len() >= 24 {
            // tkhd: version(1) + flags(3) + creation/modification (8 or 16) + track_id(4)
            let version = body[0];
            let off = if version == 1 { 4 + 16 } else { 4 + 8 };
            if body.len() >= off + 4 {
                track_id = Some(u32::from_be_bytes([
                    body[off],
                    body[off + 1],
                    body[off + 2],
                    body[off + 3],
                ]));
            }
        }
        if k == b"mdia" {
            kind = find_sample_kind(body);
        }
    });
    Some((track_id?, kind.unwrap_or(TrackKind::Other)))
}

fn find_sample_kind(mdia: &[u8]) -> Option<TrackKind> {
    let mut hdlr_kind: Option<TrackKind> = None;
    let mut stsd_kind: Option<TrackKind> = None;
    walk_boxes(mdia, |k, body| {
        // hdlr.handler_type 是最权威的 video / audio 标识(`vide` / `soun`)
        if k == b"hdlr" && body.len() >= 12 {
            let handler_type = &body[8..12];
            hdlr_kind = match handler_type {
                b"vide" => Some(TrackKind::Video),
                b"soun" => Some(TrackKind::Audio),
                _ => None,
            };
        }
        if k == b"minf" {
            walk_boxes(body, |k2, b2| {
                if k2 == b"stbl" {
                    walk_boxes(b2, |k3, b3| {
                        if k3 == b"stsd" && b3.len() > 8 {
                            let entries = &b3[8..];
                            if entries.len() >= 8 {
                                let entry_type = &entries[4..8];
                                stsd_kind = Some(match entry_type {
                                    b"avc1" | b"avc3" | b"hev1" | b"hvc1" | b"encv" => {
                                        TrackKind::Video
                                    }
                                    b"mp4a" | b"enca" => TrackKind::Audio,
                                    _ => TrackKind::Other,
                                });
                            }
                        }
                    });
                }
            });
        }
    });
    hdlr_kind.or(stsd_kind)
}

/// box walker:回调 (4-byte type, body)。处理 32-bit / 64-bit size。
fn walk_boxes<F: FnMut(&[u8; 4], &[u8])>(buf: &[u8], mut cb: F) {
    let mut pos = 0usize;
    while pos + 8 <= buf.len() {
        let size = u32::from_be_bytes([buf[pos], buf[pos + 1], buf[pos + 2], buf[pos + 3]]);
        let kind = [
            buf[pos + 4],
            buf[pos + 5],
            buf[pos + 6],
            buf[pos + 7],
        ];
        let (header_len, total_len) = if size == 1 {
            // 64-bit largesize
            if pos + 16 > buf.len() {
                return;
            }
            let large = u64::from_be_bytes([
                buf[pos + 8],
                buf[pos + 9],
                buf[pos + 10],
                buf[pos + 11],
                buf[pos + 12],
                buf[pos + 13],
                buf[pos + 14],
                buf[pos + 15],
            ]);
            (16usize, large as usize)
        } else if size == 0 {
            // size 0 = to end of file
            (8usize, buf.len() - pos)
        } else {
            (8usize, size as usize)
        };
        if total_len < header_len || pos + total_len > buf.len() {
            return;
        }
        let body = &buf[pos + header_len..pos + total_len];
        cb(&kind, body);
        pos += total_len;
    }
}

/// 解析一个 moof box,返回每 sample 的 (track_id, size, iv, subsamples)。
/// 用于配合 mdat 切分 + CENC AES-CTR 解密。
#[derive(Debug, Default, Clone)]
pub struct MoofSamples {
    pub samples: Vec<SampleInfo>,
}

#[derive(Debug, Default, Clone)]
pub struct SampleInfo {
    pub track_id: u32,
    pub size: u32,
    /// per-sample IV(16 字节),来自 traf.senc;明文 track 此处空
    pub iv: Vec<u8>,
    /// (clear_bytes, encrypted_bytes) 对列表,来自 senc 的 subsample 表
    pub subsamples: Vec<(u16, u32)>,
}

pub fn parse_moof(moof: &[u8]) -> MoofSamples {
    let mut out = MoofSamples::default();
    walk_boxes(moof, |k, body| {
        if k == b"traf" {
            parse_traf(body, &mut out);
        }
    });
    out
}

fn parse_traf(traf: &[u8], out: &mut MoofSamples) {
    let mut track_id: u32 = 0;
    let mut default_sample_size: u32 = 0;
    let mut traf_sizes: Vec<u32> = Vec::new();
    let mut traf_crypto: Vec<(Vec<u8>, Vec<(u16, u32)>)> = Vec::new();

    walk_boxes(traf, |k, body| {
        if k == b"tfhd" && body.len() >= 8 {
            let flags = u32::from_be_bytes([0, body[1], body[2], body[3]]);
            track_id = u32::from_be_bytes([body[4], body[5], body[6], body[7]]);
            let mut off = 8usize;
            if flags & 0x000001 != 0 {
                off += 8;
            }
            if flags & 0x000002 != 0 {
                off += 4;
            }
            if flags & 0x000008 != 0 {
                off += 4;
            }
            if flags & 0x000010 != 0 && body.len() >= off + 4 {
                default_sample_size = u32::from_be_bytes([
                    body[off],
                    body[off + 1],
                    body[off + 2],
                    body[off + 3],
                ]);
            }
        }
        if k == b"trun" {
            let sizes = parse_trun_sizes(body, default_sample_size);
            traf_sizes.extend(sizes);
        }
        if k == b"senc" {
            traf_crypto = parse_senc(body, 16);
        }
    });

    // 用 zip 把 sizes 跟 crypto 匹配;crypto 不够长时该 sample 视为明文
    for (i, size) in traf_sizes.into_iter().enumerate() {
        let (iv, subsamples) = traf_crypto
            .get(i)
            .cloned()
            .unwrap_or_else(|| (Vec::new(), Vec::new()));
        out.samples.push(SampleInfo {
            track_id,
            size,
            iv,
            subsamples,
        });
    }
}

/// 解析 traf.senc box,返回 (iv, subsamples) 序列。
/// senc:version(1)+flags(3)+sample_count(4)+ for each sample { iv[per_sample_iv_size]
///        + if subsample { subsample_count(2) + for each { clear(2)+encrypted(4) } } }
fn parse_senc(body: &[u8], per_sample_iv_size: u8) -> Vec<(Vec<u8>, Vec<(u16, u32)>)> {
    if body.len() < 8 {
        return Vec::new();
    }
    let flags = u32::from_be_bytes([0, body[1], body[2], body[3]]);
    let sample_count = u32::from_be_bytes([body[4], body[5], body[6], body[7]]) as usize;
    let has_subsamples = flags & 0x000002 != 0;
    let iv_size = per_sample_iv_size as usize;

    let mut pos = 8usize;
    let mut samples = Vec::with_capacity(sample_count);
    for _ in 0..sample_count {
        if pos + iv_size > body.len() {
            break;
        }
        let iv = body[pos..pos + iv_size].to_vec();
        pos += iv_size;
        let mut subsamples = Vec::new();
        if has_subsamples {
            if pos + 2 > body.len() {
                samples.push((iv, subsamples));
                break;
            }
            let sub_count = u16::from_be_bytes([body[pos], body[pos + 1]]) as usize;
            pos += 2;
            for _ in 0..sub_count {
                if pos + 6 > body.len() {
                    break;
                }
                let clear = u16::from_be_bytes([body[pos], body[pos + 1]]);
                let enc = u32::from_be_bytes([
                    body[pos + 2],
                    body[pos + 3],
                    body[pos + 4],
                    body[pos + 5],
                ]);
                pos += 6;
                subsamples.push((clear, enc));
            }
        }
        samples.push((iv, subsamples));
    }
    samples
}

fn parse_trun_sizes(trun: &[u8], default_sample_size: u32) -> Vec<u32> {
    if trun.len() < 8 {
        return Vec::new();
    }
    // version(1)+flags(3)+sample_count(4)
    let flags = u32::from_be_bytes([0, trun[1], trun[2], trun[3]]);
    let sample_count = u32::from_be_bytes([trun[4], trun[5], trun[6], trun[7]]) as usize;
    let mut off = 8usize;
    if flags & 0x000001 != 0 {
        off += 4; // data_offset
    }
    if flags & 0x000004 != 0 {
        off += 4; // first_sample_flags
    }
    let has_duration = flags & 0x000100 != 0;
    let has_size = flags & 0x000200 != 0;
    let has_flags = flags & 0x000400 != 0;
    let has_cts = flags & 0x000800 != 0;

    let entry_size = (has_duration as usize
        + has_size as usize
        + has_flags as usize
        + has_cts as usize)
        * 4;

    let mut sizes = Vec::with_capacity(sample_count);
    for _ in 0..sample_count {
        if off + entry_size > trun.len() {
            break;
        }
        let mut e_off = off;
        if has_duration {
            e_off += 4;
        }
        let size = if has_size {
            let s = u32::from_be_bytes([
                trun[e_off],
                trun[e_off + 1],
                trun[e_off + 2],
                trun[e_off + 3],
            ]);
            s
        } else {
            default_sample_size
        };
        sizes.push(size);
        off += entry_size;
    }
    sizes
}

/* ─────────────────────────────────────────────────────────── */
/* 流式解 fMP4 + 解密(主循环) */
/* ─────────────────────────────────────────────────────────── */

/// 流处理状态机。喂任意大小的 chunk 进来,产出已解密的字节(可能 0,可能多个 box 一起)。
pub struct StreamDecryptor {
    key: [u8; 16],
    buf: BytesMut,
    tracks: TrackTable,
    /// 上一个 moof 给的 sample 序列(IV + subsamples),mdat 来时按顺序消费
    pending_samples: Vec<SampleInfo>,
    /// 首个 ftyp+moov 已推送后置 true；重连时跳过后续 fragment 的重复初始化段
    initialized: bool,
}

impl StreamDecryptor {
    pub fn new(key: [u8; 16], _m3u8_iv_unused: [u8; 16]) -> Self {
        Self {
            key,
            buf: BytesMut::with_capacity(1024 * 1024),
            tracks: TrackTable::default(),
            pending_samples: Vec::new(),
            initialized: false,
        }
    }

    /// 重连时更新 key（如果服务端轮转了 token/key）。不重置 initialized 状态。
    pub fn update_key(&mut self, key: [u8; 16]) {
        self.key = key;
    }

    /// 喂一段 chunked 数据。返回(0 或多个)已处理的输出 Bytes。
    pub fn feed(&mut self, chunk: Bytes) -> Result<Vec<Bytes>, String> {
        self.buf.extend_from_slice(&chunk);
        let mut out: Vec<Bytes> = Vec::new();

        loop {
            // 至少要 8 字节读 box header
            if self.buf.len() < 8 {
                break;
            }
            let size = u32::from_be_bytes([self.buf[0], self.buf[1], self.buf[2], self.buf[3]]);
            let kind = [self.buf[4], self.buf[5], self.buf[6], self.buf[7]];

            let (header_len, total_len_opt) = if size == 1 {
                if self.buf.len() < 16 {
                    break;
                }
                let large = u64::from_be_bytes([
                    self.buf[8],
                    self.buf[9],
                    self.buf[10],
                    self.buf[11],
                    self.buf[12],
                    self.buf[13],
                    self.buf[14],
                    self.buf[15],
                ]);
                (16usize, Some(large as usize))
            } else if size == 0 {
                // 到流尾 — 直播流不应该出现,break
                break;
            } else {
                (8usize, Some(size as usize))
            };
            let total_len = total_len_opt.unwrap();

            if self.buf.len() < total_len {
                break; // 等下个 chunk
            }

            let box_bytes = self.buf.split_to(total_len);

            match &kind {
                b"ftyp" | b"styp" | b"sidx" | b"free" | b"skip" | b"prft" => {
                    if !self.initialized {
                        out.push(box_bytes.freeze());
                    }
                    // 重连后的重复 ftyp/styp 静默丢弃
                }
                b"moov" => {
                    let body = &box_bytes[header_len..];
                    self.tracks = parse_moov(body);
                    eprintln!(
                        "[sample_aes] moov parsed: {} tracks ({:?})",
                        self.tracks.kinds.len(),
                        self.tracks.kinds
                    );
                    if !self.initialized {
                        out.push(box_bytes.freeze());
                        self.initialized = true;
                    }
                    // 重连后的重复 moov 只更新 track table，不推给播放器
                }
                b"moof" => {
                    let body = &box_bytes[header_len..];
                    let m = parse_moof(body);
                    self.pending_samples = m.samples;
                    out.push(box_bytes.freeze());
                }
                b"mdat" => {
                    // 对 mdat 内的 sample 按 pending_samples 切分,逐 sample CENC-CTR 解密
                    let mut mdat_mut: Vec<u8> = box_bytes[header_len..].to_vec();
                    let mut pos = 0usize;
                    let samples = std::mem::take(&mut self.pending_samples);
                    for sample in samples {
                        let size_us = sample.size as usize;
                        if pos + size_us > mdat_mut.len() {
                            eprintln!(
                                "[sample_aes] mdat sample 越界:pos={pos}, size={size_us}, mdat={}",
                                mdat_mut.len()
                            );
                            break;
                        }
                        let kind = self.tracks.kind_of(sample.track_id);
                        // CENC:只 video track 加密(audio 是明文 mp4a)。即便 audio 也加密,
                        // 同样的 IV + subsamples 处理路径同样适用,关键是 sample.iv/subsamples 非空。
                        if kind == TrackKind::Video && sample.iv.len() == 16 {
                            let mut iv = [0u8; 16];
                            iv.copy_from_slice(&sample.iv);
                            let sample_slice = &mut mdat_mut[pos..pos + size_us];
                            if let Err(e) =
                                decrypt_cenc_sample(sample_slice, &self.key, &iv, &sample.subsamples)
                            {
                                eprintln!("[sample_aes] CENC decrypt err: {e}");
                            }
                        }
                        pos += size_us;
                    }
                    // 重组 mdat:header + 解密后的 body
                    let mut new_mdat: Vec<u8> = Vec::with_capacity(total_len);
                    new_mdat.extend_from_slice(&box_bytes[..header_len]);
                    new_mdat.extend_from_slice(&mdat_mut);
                    out.push(Bytes::from(new_mdat));
                }
                _ => {
                    // 未知 box 透传
                    out.push(box_bytes.freeze());
                }
            }
        }
        Ok(out)
    }
}
