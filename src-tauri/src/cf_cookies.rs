//! 通过 CF 验证窗口从 WebView 抽到的 host cookie 的进程内 jar。
//!
//! 早期版本只收 `cf_clearance` / `__cf_bm` 这类 CF 前缀的 cookie,但实测发现:
//! Chaturbate 的 CDN(MMCDN LIVE)会检查 JWT 是否由"已经过 18+ 同意"
//! 且持有合法 chaturbate.com session 的客户端发起。我们如果只回放 CF cookie,
//! chatvideocontext 拿回的 JWT 就是受限的(匿名 + 未同意),CDN 拒绝并报
//! `w3: session_duplicated`。
//!
//! 所以现在改成"WebView 抽出来的同 host cookie 全收"(csrftoken / agreeterms /
//! affkey / dwf_* / _ga 等),让后端的 chatvideocontext 请求看上去和真实浏览器
//! 完全一致。代价是如果用户在 WebView 里登录了某站,登录态也会被持久化到
//! Rust 端用 —— 这是单用户客户端的合理 tradeoff。
//!
//! 不做磁盘持久化,进程退出即丢。

use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

use url::Url;

fn jar() -> &'static RwLock<HashMap<String, HashMap<String, String>>> {
    static JAR: OnceLock<RwLock<HashMap<String, HashMap<String, String>>>> = OnceLock::new();
    JAR.get_or_init(|| RwLock::new(HashMap::new()))
}

fn host_of(url: &str) -> Option<String> {
    Url::parse(url).ok()?.host_str().map(|h| h.to_lowercase())
}

/// 取给定 URL 对应 host 的所有缓存 cookie,拼成 `k1=v1; k2=v2` 形式。
/// 若 host 没有缓存 cookie 则返 None,调用方据此判断要不要附加 Cookie 头。
pub fn get_cookie_header_for_url(url: &str) -> Option<String> {
    let host = host_of(url)?;
    let read = jar().read().ok()?;
    let kvs = read.get(&host)?;
    if kvs.is_empty() {
        return None;
    }
    let mut parts: Vec<String> = kvs.iter().map(|(k, v)| format!("{}={}", k, v)).collect();
    parts.sort();
    Some(parts.join("; "))
}

/// 把一批 cookie 写入指定 host 的 jar。
/// 返回是否包含 `cf_clearance`(调用方据此判断"用户是否真的通过了验证")。
pub fn store_cookies_for_host(host: &str, kvs: Vec<(String, String)>) -> bool {
    let host = host.to_lowercase();
    let Ok(mut write) = jar().write() else {
        return false;
    };
    let bucket = write.entry(host).or_default();
    let mut got_clearance = false;
    for (name, value) in kvs {
        if name == "cf_clearance" {
            got_clearance = true;
        }
        bucket.insert(name, value);
    }
    got_clearance
}

/// 清除指定 host 的 cf_clearance cookie（用于强制重新验证）。
pub fn clear_clearance_for_host(host: &str) {
    let host = host.to_lowercase();
    if let Ok(mut write) = jar().write() {
        if let Some(bucket) = write.get_mut(&host) {
            bucket.remove("cf_clearance");
        }
    }
}
