//! Stripchat Mouflon 流加扰解码 —— 进程内的 pkey→pdkey jar + segment URI 解扰算法。
//!
//! ## 背景
//!
//! Stripchat 自 2025-08 起在 HLS 流上做了内容防爬:variant playlist 里的每个分片名
//! 都被 XOR 加扰,只有持有 pdkey 的客户端能还原。playlist 形如:
//!
//! ```text
//! #EXT-X-MOUFLON:URI:https://media-hls.doppiocdn.com/.../166940384_480p_h264_15039_wDCQ7iHKRFHFMvkRTQM7hR_1779541176.mp4
//! https://media-hls.doppiocdn.com/.../media.mp4   ← 占位符,player 拉到的是空文件
//! ```
//!
//! 真正可播的 URL 在 `#EXT-X-MOUFLON:URI:` 那行,但第 5 个 `_` 分隔字段
//! (`wDCQ7iHKRFHFMvkRTQM7hR`)是加扰过的。还原算法 = 反转字符串 → b64 解码 →
//! 每字节 XOR `SHA256(pdkey)` 循环字节。还原后把它替换回 URI、再用替换后的 URI
//! 顶替下一行的 `media.mp4` 占位符,player 就能拿到真分片。
//!
//! master playlist 顶部有 6 行 `#EXT-X-MOUFLON:PSCH:v2:{pkey}` —— 这 6 个 pkey 中
//! 任何一个加到 variant URL 的 `?psch=v2&pkey=…` 都能让 CDN 返真 playlist
//! (否则 302 跳广告 VOD `cpa/v2/stream.m3u8`)。但**解扰用的 pdkey 必须和你选的
//! pkey 配对**,所以选 pkey 时要从 jar 里挑一个我们已经持有 pdkey 的。
//!
//! pdkey 不在 stripchat 主站任何静态 JS bundle 里,本机无法自动获取 —— 用户必须
//! 手动从 OSS 社区(streamlink scp-plugin / Kodi sc19 / Telegram 群)拿到
//! `pkey:pdkey` 对,通过设置页录入。jar 不做磁盘持久化,前端在 localStorage 里存,
//! 启动时调 `set_mouflon_keys` 把内容同步给后端。

use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

use base64::Engine;
use sha2::{Digest, Sha256};

fn jar() -> &'static RwLock<HashMap<String, String>> {
    static JAR: OnceLock<RwLock<HashMap<String, String>>> = OnceLock::new();
    JAR.get_or_init(|| RwLock::new(HashMap::new()))
}

/// 剥外层成对引号(单/双)+ 前后空白。前端 `parseKeysText` 已剥一次,这里再剥一次
/// 兜底 —— 用户实测会从 JSON 字典 / 论坛代码块复制带引号的字符串,任一层漏 strip
/// jar 里就会存 `"pkey"` 而 master 给的是 `pkey`,匹配不上、表现为"已配 key 但还黑屏"。
fn strip_wrappers(s: &str) -> &str {
    let t = s.trim();
    if t.len() >= 2 {
        let bytes = t.as_bytes();
        let first = bytes[0];
        let last = bytes[t.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return t[1..t.len() - 1].trim();
        }
    }
    t
}

/// 把一批 `pkey:pdkey` 对覆盖写入 jar。空 jar 表示用户清空。
pub fn set_keys(pairs: Vec<(String, String)>) {
    let Ok(mut w) = jar().write() else {
        return;
    };
    w.clear();
    for (pkey, pdkey) in pairs {
        let pkey = strip_wrappers(&pkey).to_string();
        let pdkey = strip_wrappers(&pdkey).to_string();
        if pkey.is_empty() || pdkey.is_empty() {
            continue;
        }
        w.insert(pkey, pdkey);
    }
}

pub fn get_keys() -> Vec<(String, String)> {
    let Ok(r) = jar().read() else {
        return Vec::new();
    };
    let mut out: Vec<(String, String)> = r.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

pub fn get_pdkey(pkey: &str) -> Option<String> {
    let r = jar().read().ok()?;
    r.get(pkey).cloned()
}

/// 给一组候选 pkey,挑第一个 jar 里有 pdkey 的。用于 master playlist 上多行
/// `#EXT-X-MOUFLON:PSCH:v2:{pkey}` 的选 key 步骤。
pub fn pick_known_pkey(candidates: &[&str]) -> Option<String> {
    let r = jar().read().ok()?;
    candidates
        .iter()
        .find(|pk| r.contains_key(**pk))
        .map(|s| s.to_string())
}

/// Mouflon v2 段名解扰。
///
/// `encoded_segment` 是 URI 里第 5 个 `_` 分隔字段(原文反转后即用作 b64 输入)。
/// `pdkey` 是与外层 pkey 配对的 16 字符密钥。
///
/// 实现照搬 StreaMonitor / scp-streamlink-plugin 的等价 Python:
///   1. 反转字符串(原始 b64 是反着写的)
///   2. 加 `==` 补齐 b64 padding,b64 解码
///   3. SHA256(pdkey) 得 32 字节 hash,把密文字节按 mod 32 循环 XOR
///   4. UTF-8 解码
pub fn decrypt_segment(encoded_segment: &str, pdkey: &str) -> Option<String> {
    let reversed: String = encoded_segment.chars().rev().collect();
    // base64 标准 alphabet,加任意够用的 padding(Python `+ "=="` 也是宽松 padding)
    let padded = match reversed.len() % 4 {
        0 => reversed,
        n => {
            let mut s = reversed;
            for _ in 0..(4 - n) {
                s.push('=');
            }
            s
        }
    };
    let data = base64::engine::general_purpose::STANDARD
        .decode(padded.as_bytes())
        .ok()?;
    let hash = Sha256::digest(pdkey.as_bytes());
    let mut out = Vec::with_capacity(data.len());
    for (i, b) in data.iter().enumerate() {
        out.push(b ^ hash[i % hash.len()]);
    }
    String::from_utf8(out).ok()
}

/// 从 master playlist 文本里抓出所有 `#EXT-X-MOUFLON:PSCH:v2:{pkey}` 的 pkey。
pub fn extract_master_pkeys(master_text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in master_text.lines() {
        let l = line.trim();
        // `#EXT-X-MOUFLON:PSCH:v2:` 后面剩下的就是 pkey
        if let Some(rest) = l.strip_prefix("#EXT-X-MOUFLON:PSCH:v2:") {
            let pkey = rest.trim();
            if !pkey.is_empty() {
                out.push(pkey.to_string());
            }
        }
    }
    out
}

/// 判断给定 URL host 是不是 doppiocdn 系(stripchat 用 .org/.com/.net 三个 TLD 轮换)。
pub fn is_doppiocdn_host(host: &str) -> bool {
    let h = host.to_lowercase();
    h.ends_with(".doppiocdn.com")
        || h.ends_with(".doppiocdn.net")
        || h.ends_with(".doppiocdn.org")
        || h == "doppiocdn.com"
        || h == "doppiocdn.net"
        || h == "doppiocdn.org"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_pkeys_from_sample_master() {
        // 实测 2026-05 master 响应样本
        let m = "#EXTM3U\n#EXT-X-VERSION:6\n\
            #EXT-X-MOUFLON:PSCH:v2:1Dzcc6OjP73LKbtI\n\
            #EXT-X-MOUFLON:PSCH:v2:Fq6m2TO2ZeBkRPm9\n\
            #EXT-X-STREAM-INF:BANDWIDTH=1\nfoo.m3u8\n";
        let keys = extract_master_pkeys(m);
        assert_eq!(keys, vec!["1Dzcc6OjP73LKbtI", "Fq6m2TO2ZeBkRPm9"]);
    }

    #[test]
    fn pick_known_chooses_first_present() {
        set_keys(vec![("Fq6m2TO2ZeBkRPm9".into(), "any-pdkey".into())]);
        let pick = pick_known_pkey(&[
            "1Dzcc6OjP73LKbtI",
            "Fq6m2TO2ZeBkRPm9",
            "GrRncsoByZmsiT6L",
        ]);
        assert_eq!(pick.as_deref(), Some("Fq6m2TO2ZeBkRPm9"));
        set_keys(vec![]); // cleanup
    }

    #[test]
    fn host_matcher() {
        assert!(is_doppiocdn_host("media-hls.doppiocdn.com"));
        assert!(is_doppiocdn_host("edge-hls.doppiocdn.org"));
        assert!(is_doppiocdn_host("b-hls-07.doppiocdn.net"));
        assert!(!is_doppiocdn_host("doppiocdn.com.evil.com"));
        assert!(!is_doppiocdn_host("stripchat.com"));
    }

    #[test]
    fn decrypt_roundtrip() {
        // 反向验证算法正确性:用同一 pdkey 做对称 XOR-encode 应能 round-trip
        let pdkey = "0123456789abcdef";
        let plain = "RealHashName";

        // 模拟服务端加密:plain bytes → XOR sha256(pdkey) → base64 → reverse
        let hash = Sha256::digest(pdkey.as_bytes());
        let mut xored = Vec::with_capacity(plain.len());
        for (i, b) in plain.as_bytes().iter().enumerate() {
            xored.push(b ^ hash[i % hash.len()]);
        }
        let b64 = base64::engine::general_purpose::STANDARD.encode(&xored);
        let reversed: String = b64.chars().rev().collect();

        // 通过解扰函数应能还原 plain
        let decoded = decrypt_segment(&reversed, pdkey).expect("decrypt ok");
        assert_eq!(decoded, plain);
    }

    /// 实测 2026-05 用户上报:有效 pdkey 但 segment 仍是 media.mp4 占位符。
    /// 根因:源画质 variant 文件名只 4 段,被 `parts.len() < 6` 拒绝。
    /// 这里固化 4 段 / 6 段两种实测格式都能跑通解扰算法。
    #[test]
    fn decrypts_known_pkey_pdkey_pair() {
        // 用户提供的真实工作对(实测从浏览器抓到的)
        let pdkey = "Y64UVwX5RrIWnOLp";
        // 实测从 _160p variant 抓到的加扰段(4 段格式: streamId_seqnum_ENCRYPTED_ts.mp4)
        let encrypted = "gOK8Lp2LjKhduzqBxJUmgZ";
        let out = decrypt_segment(encrypted, pdkey).expect("decode ok");
        // 解出后应是 16 字符 base64-safe 的真分片 hash(不是垃圾 utf-8)
        assert_eq!(out.len(), 16, "decoded len: {} -> {:?}", out.len(), out);
        assert!(out.chars().all(|c| c.is_ascii_alphanumeric()),
            "expected base64-safe alnum, got {:?}", out);
    }

    /// 实测用户上报:前端 parseKeysText 漏剥引号 → jar 里存 `"pkey"`(含字面量引号)→
    /// master 给的是裸 pkey,strcmp 不上,表现为"已配 6 对 key 但还是黑屏"。
    /// set_keys 必须把外层引号(JSON 字典格式拷贝来的)再剥一次兜底。
    #[test]
    fn set_keys_strips_outer_quotes() {
        // 模拟前端传来的脏数据
        set_keys(vec![
            ("\"Zokee2OhPh9kugh4\"".into(), "\"Quean4cai9boJa5a\"".into()),
            ("'Fq6m2TO2ZeBkRPm9'".into(), "'xb6di1NF9EFXHUwb'".into()),
            ("  CleanPkey123456  ".into(), "  CleanPdkey1234  ".into()),
        ]);
        // 应能用裸字符串查到 pdkey
        assert_eq!(
            get_pdkey("Zokee2OhPh9kugh4").as_deref(),
            Some("Quean4cai9boJa5a")
        );
        assert_eq!(
            get_pdkey("Fq6m2TO2ZeBkRPm9").as_deref(),
            Some("xb6di1NF9EFXHUwb")
        );
        assert_eq!(
            get_pdkey("CleanPkey123456").as_deref(),
            Some("CleanPdkey1234")
        );
        // 带引号的查询应该匹配不上(我们存的是剥过的裸值)
        assert!(get_pdkey("\"Zokee2OhPh9kugh4\"").is_none());
        set_keys(vec![]);
    }
}
