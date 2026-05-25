use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri_plugin_sql::{Migration, MigrationKind};
use url::Url;

mod amateurtv_ws;
mod cf_cookies;
mod fc2_ws;
mod mfc_ws;
mod mouflon;
mod sample_aes_proxy;
mod stream_proxy;

/// 把 cookie jar 里命中的 cookie 合并进请求头。
/// 如果调用方已有 `Cookie` 头,jar 命中的 cookie 追加到末尾(`; ` 分隔),不覆盖。
/// 返回最终要发送的 Cookie 头值(None 表示不需要设置)。
fn merge_cookie_header(
    target_url: &str,
    headers: &HashMap<String, String>,
) -> Option<String> {
    let jar_part = cf_cookies::get_cookie_header_for_url(target_url);
    let existing = headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("cookie"))
        .map(|(_, v)| v.clone());
    match (existing, jar_part) {
        (Some(e), Some(j)) => Some(format!("{}; {}", e.trim_end_matches(';').trim(), j)),
        (Some(e), None) => Some(e),
        (None, Some(j)) => Some(j),
        (None, None) => None,
    }
}

/// 按 proxy_url（包括空串 = 直连）缓存复用 ureq Agent。
///
/// **为什么**：dyproxy 协议每条 HLS segment 都会重新调 proxy_fetch。
/// 原实现每次 `AgentBuilder::new().build()` 都创建独立 agent，没有连接池，
/// 每次都要走 DNS + TCP + TLS 握手 —— 一分钟视频 ~30 segments × 200-500ms 握手
/// 累计 6-15s 额外延迟，就是"看一会儿就卡"的主因。
///
/// 复用同一 Agent 后，ureq 内部维护 keep-alive 连接池（默认 100 idle / 1 per host），
/// 后续 segment 在同一 TCP 连接上拿，握手成本一次性。
fn agent_for(proxy: Option<&str>) -> Result<Arc<ureq::Agent>, String> {
    static POOL: OnceLock<RwLock<HashMap<String, Arc<ureq::Agent>>>> = OnceLock::new();
    let pool = POOL.get_or_init(|| RwLock::new(HashMap::new()));

    let key = proxy.unwrap_or("").trim().to_string();

    if let Ok(read) = pool.read() {
        if let Some(a) = read.get(&key) {
            return Ok(a.clone());
        }
    }

    let mut builder = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(30))
        .redirects(10);
    if !key.is_empty() {
        match ureq::Proxy::new(&key) {
            Ok(p) => builder = builder.proxy(p),
            Err(e) => return Err(format!("invalid proxy: {e}")),
        }
    }
    let agent = Arc::new(builder.build());
    if let Ok(mut write) = pool.write() {
        write.insert(key, agent.clone());
    }
    Ok(agent)
}

/// 按 proxy_url 缓存复用 reqwest Client(HTTP/2)。
///
/// **为什么**:Chaturbate / MMCDN LIVE 这类 CDN 用 ALPN 协议判断"同一 token 是否被
/// 两个客户端共用"。浏览器拿 token 后用 HTTP/2 拉 master m3u8,如果我们用 ureq h1
/// 去拉,CDN 看到"不同协议客户端" → 抛 `w3: session_duplicated` 403。
///
/// 所以 dyproxy 对 `mmcdn.com` 域的 m3u8 请求切到 reqwest h2(参 `proxy_fetch_h2`),
/// 其他主机(普通 vod 站、douyu/huya FLV 等)继续走 ureq 保留 keep-alive 性能。
pub(crate) fn h2_client_for(proxy: Option<&str>) -> Result<reqwest::Client, String> {
    static POOL: OnceLock<RwLock<HashMap<String, reqwest::Client>>> = OnceLock::new();
    let pool = POOL.get_or_init(|| RwLock::new(HashMap::new()));

    let key = proxy.unwrap_or("").trim().to_string();

    if let Ok(read) = pool.read() {
        if let Some(c) = read.get(&key) {
            return Ok(c.clone());
        }
    }

    let mut builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(10));
    if !key.is_empty() {
        builder = builder
            .proxy(reqwest::Proxy::all(&key).map_err(|e| format!("invalid proxy: {e}"))?);
    }
    let client = builder.build().map_err(|e| format!("h2 client: {e}"))?;
    if let Ok(mut write) = pool.write() {
        write.insert(key, client.clone());
    }
    Ok(client)
}

#[derive(Debug, Deserialize)]
pub struct HttpRequest {
    pub url: String,
    #[serde(default = "default_method")]
    pub method: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    pub timeout_ms: Option<u64>,
    /// 可选系统代理 URL，如 "http://127.0.0.1:7890" 或 "socks5://127.0.0.1:1080"。
    /// None 或空字符串走直连。
    pub proxy_url: Option<String>,
}

fn default_method() -> String {
    "GET".to_string()
}

#[derive(Debug, Serialize)]
pub struct HttpResponse {
    pub url: String,
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

/// 源脚本通过 invoke 调用的 HTTP — 绕 webview CORS。
#[tauri::command]
async fn script_http(req: HttpRequest) -> Result<HttpResponse, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<HttpResponse, String> {
        let timeout = std::time::Duration::from_millis(req.timeout_ms.unwrap_or(30_000));
        let agent = agent_for(req.proxy_url.as_deref())?;

        let mut request = agent.request(&req.method, &req.url).timeout(timeout);
        let merged_cookie = merge_cookie_header(&req.url, &req.headers);
        for (k, v) in &req.headers {
            if k.eq_ignore_ascii_case("cookie") && merged_cookie.is_some() {
                continue; // 用合并后的版本,跳过原始 Cookie 头避免重复
            }
            request = request.set(k, v);
        }
        if let Some(c) = merged_cookie.as_deref() {
            request = request.set("Cookie", c);
        }

        let response = match req.body {
            Some(body) if !body.is_empty() => request.send_string(&body),
            _ => request.call(),
        }
        .map_err(|e| format!("{e}"))?;

        let url = response.get_url().to_string();
        let status = response.status();
        let mut headers = HashMap::new();
        for name in response.headers_names() {
            if let Some(value) = response.header(&name) {
                headers.insert(name, value.to_string());
            }
        }
        let body = response.into_string().map_err(|e| format!("{e}"))?;
        Ok(HttpResponse {
            url,
            status,
            headers,
            body,
        })
    })
    .await
    .map_err(|e| format!("{e}"))?
}

/// HTTP/2-capable fetch —— 给 live.douyin.com 之类强制 HTTP/2 + ALPN h2 的端点用。
/// 实现用 reqwest（rustls-tls + http2，无 encoding_rs 依赖）。
#[tauri::command]
async fn script_http_h2(req: HttpRequest) -> Result<HttpResponse, String> {
    let timeout = std::time::Duration::from_millis(req.timeout_ms.unwrap_or(30_000));
    let mut builder = reqwest::Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::limited(10))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36");
    if let Some(p) = req.proxy_url.as_deref() {
        if !p.is_empty() {
            builder = builder
                .proxy(reqwest::Proxy::all(p).map_err(|e| format!("proxy: {e}"))?);
        }
    }
    let client = builder.build().map_err(|e| format!("client: {e}"))?;

    let method = reqwest::Method::from_bytes(req.method.as_bytes())
        .map_err(|e| format!("bad method: {e}"))?;
    let mut request = client.request(method, &req.url);
    let merged_cookie = merge_cookie_header(&req.url, &req.headers);
    for (k, v) in &req.headers {
        if k.eq_ignore_ascii_case("cookie") && merged_cookie.is_some() {
            continue;
        }
        request = request.header(k, v);
    }
    if let Some(c) = merged_cookie.as_deref() {
        request = request.header("Cookie", c);
    }
    if let Some(body) = req.body {
        if !body.is_empty() {
            request = request.body(body);
        }
    }
    let response = request.send().await.map_err(|e| format!("{e}"))?;
    let url = response.url().to_string();
    let status = response.status().as_u16();
    let mut headers = HashMap::new();
    for (k, v) in response.headers().iter() {
        if let Ok(vs) = v.to_str() {
            headers.insert(k.as_str().to_string(), vs.to_string());
        }
    }
    let body = response.text().await.map_err(|e| format!("body: {e}"))?;
    Ok(HttpResponse {
        url,
        status,
        headers,
        body,
    })
}

#[derive(Debug, Serialize)]
pub struct LocalVideo {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified: u64,
    pub extension: String,
}

const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "m4v", "webm", "mov", "mkv", "avi", "flv", "ts", "wmv", "3gp", "ogv",
];

fn visit(
    dir: &Path,
    out: &mut Vec<LocalVideo>,
    max_depth: u32,
    current_depth: u32,
) -> std::io::Result<()> {
    if current_depth > max_depth {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir)? {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        if path.is_dir() {
            if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                if name.starts_with('.') {
                    continue;
                }
            }
            let _ = visit(&path, out, max_depth, current_depth + 1);
        } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            let ext_lower = ext.to_lowercase();
            if VIDEO_EXTENSIONS.contains(&ext_lower.as_str()) {
                if let Ok(meta) = entry.metadata() {
                    let name = path
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_string();
                    let modified = meta
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    out.push(LocalVideo {
                        path: path.to_string_lossy().to_string(),
                        name,
                        size: meta.len(),
                        modified,
                        extension: ext_lower,
                    });
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn scan_local_videos(dir: String, max_depth: Option<u32>) -> Result<Vec<LocalVideo>, String> {
    let path = PathBuf::from(&dir);
    if !path.exists() {
        return Err(format!("path does not exist: {dir}"));
    }
    if !path.is_dir() {
        return Err(format!("path is not a directory: {dir}"));
    }
    let mut out = Vec::new();
    visit(&path, &mut out, max_depth.unwrap_or(4), 0).map_err(|e| e.to_string())?;
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(out)
}

/// 读取操作系统级代理设置（Windows/macOS/Linux 桌面），返回标准化的 URL。
/// 移动端 (Android/iOS) 不暴露此命令 —— OS 上的代理 / VPN 已经在网络栈层透明生效，
/// 不需要应用再次显式配置。
///
/// 返回 URL 前会做一次 TCP 探活（800ms 超时）—— 用户设了系统代理但代理本身没启动
/// (典型场景：Clash / V2Ray 关掉后 Windows 注册表里 ProxyEnable=1 仍残留) 时，
/// 上层 mode="auto" 拾取这个死代理会让所有请求 10061。探活失败就报 None，
/// 让上层退化为直连。
#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tauri::command]
fn read_system_proxy() -> Result<Option<String>, String> {
    use std::net::{TcpStream, ToSocketAddrs};
    use std::time::Duration;
    use sysproxy::Sysproxy;
    let sp = Sysproxy::get_system_proxy().map_err(|e| e.to_string())?;
    if !sp.enable {
        return Ok(None);
    }
    let host = sp.host.trim();
    if host.is_empty() || sp.port == 0 {
        return Ok(None);
    }
    // 探活：本地代理常驻 127.0.0.1，connect 失败立即 RST；800ms 给非本地一点余量
    let addr_str = format!("{}:{}", host, sp.port);
    let mut reachable = false;
    if let Ok(addrs) = addr_str.to_socket_addrs() {
        for addr in addrs {
            if TcpStream::connect_timeout(&addr, Duration::from_millis(800)).is_ok() {
                reachable = true;
                break;
            }
        }
    }
    if !reachable {
        return Ok(None);
    }
    // sysproxy 在 Windows/macOS 都没区分 scheme，统一假定 http://（绝大多数本地代理 — Clash / V2Ray / Shadowsocks Mixed Port — 都是 http）
    Ok(Some(format!("http://{}:{}", host, sp.port)))
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[tauri::command]
fn read_system_proxy() -> Result<Option<String>, String> {
    Ok(None)
}

// ===========================================================================
// dyproxy:// — 内嵌代理协议（解决跨域 / 防盗链 / 自定义 UA）
// 移植自 MoonTV 的 /api/proxy/m3u8 + /api/proxy/segment + /api/proxy/key
// 前端把 hls 流的 URL 包装成 dyproxy://proxy/m3u8?url=...&ua=...&referer=...
// 协议 handler:
//   - 用 ureq 拉原始 URL，带上自定义 UA/Referer
//   - 加 CORS 头返回
//   - m3u8 内容自动改写：子 URI / 密钥 URI 替换为 dyproxy:// 链接
// ===========================================================================

const DEFAULT_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const ADS_KEYWORDS: &[&str] = &[
    "sponsor",
    "/ad/",
    "/ads/",
    "advert",
    "advertisement",
    "/adjump",
    "redtraffic",
];
const PROXY_SEGMENT_MAX_BYTES: u64 = 256 * 1024 * 1024; // 256MB —— 给 FLV live 30~60s 缓冲一次
const PROXY_STREAM_TIMEOUT_SECS: u64 = 600; // 10 分钟 —— 单次 FLV/MPEG-TS live 拉取超时

fn percent_encode_uri_component(s: &str) -> String {
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

/// dyproxy 上游拉取的统一返回。headers 的 key 全部小写化,方便 case-insensitive 取。
#[derive(Clone)]
pub struct FetchResult {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub bytes: Vec<u8>,
}

/// 短 TTL m3u8 缓存 —— 给 mmcdn.com 这类对"同 token 多客户端"敏感的 CDN 用。
/// hls.js 启动阶段(manifest probe + initial load)、React StrictMode 双调用、VideoFeed
/// 预挂载相邻 player 都会让同一 URL 在毫秒级被请求多次,CDN 第一次 200 后绑定 session
/// 到我们的 (token + client identity),后续相同请求会被当成 "另一个客户端 claim 同 token"
/// 返回 `w3: session_duplicated` 403。
///
/// 1.5 秒窗口足够吸收并发重复;LL-HLS blocking refresh 用不同的 `_HLS_msn` / `_HLS_part`
/// query param,key 不同,不会命中缓存。
///
/// **并发 stampede**:多个 hls.js 请求 race 进来时全部 cache miss,各自打源,只有第一个
/// 200 其余 403。所以再加一层 per-URL in-flight lock(`M3U8_LOCKS`),同 URL 串行化:
/// 后到的请求等第一个跑完,直接复用缓存。
const M3U8_CACHE_TTL: Duration = Duration::from_millis(1500);
static M3U8_CACHE: OnceLock<std::sync::Mutex<HashMap<String, (std::time::Instant, FetchResult)>>> =
    OnceLock::new();
static M3U8_LOCKS: OnceLock<std::sync::Mutex<HashMap<String, Arc<std::sync::Mutex<()>>>>> =
    OnceLock::new();

fn m3u8_cache() -> &'static std::sync::Mutex<HashMap<String, (std::time::Instant, FetchResult)>> {
    M3U8_CACHE.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

fn m3u8_cache_get(key: &str) -> Option<FetchResult> {
    let mut guard = m3u8_cache().lock().ok()?;
    let entry = guard.get(key)?;
    if entry.0.elapsed() < M3U8_CACHE_TTL {
        Some(entry.1.clone())
    } else {
        guard.remove(key);
        None
    }
}

fn m3u8_cache_put(key: String, value: FetchResult) {
    if let Ok(mut guard) = m3u8_cache().lock() {
        guard.retain(|_, (t, _)| t.elapsed() < M3U8_CACHE_TTL);
        guard.insert(key, (std::time::Instant::now(), value));
    }
}

/// 获取 per-URL 的串行化锁。同 URL 的并发请求拿同一个 Arc<Mutex>,排队进入,
/// 第一个跑完入缓存,其他在缓存有效期内直接命中。
fn m3u8_lock_for(key: &str) -> Arc<std::sync::Mutex<()>> {
    let outer = M3U8_LOCKS.get_or_init(|| std::sync::Mutex::new(HashMap::new()));
    let mut guard = outer.lock().expect("m3u8 lock map poisoned");
    // 顺手 GC:Arc 只剩自己一份且没被持有的可以扔了
    guard.retain(|_, lock| Arc::strong_count(lock) > 1);
    guard
        .entry(key.to_string())
        .or_insert_with(|| Arc::new(std::sync::Mutex::new(())))
        .clone()
}


fn proxy_fetch(
    target: &str,
    ua: Option<&str>,
    referer: Option<&str>,
    proxy: Option<&str>,
    timeout_secs: Option<u64>,
) -> Result<FetchResult, String> {
    let agent = agent_for(proxy)?;
    let mut req = agent.get(target);
    if let Some(secs) = timeout_secs {
        req = req.timeout(Duration::from_secs(secs));
    }
    req = req.set("User-Agent", ua.unwrap_or(DEFAULT_UA));
    // 防盗链：调用方未指定 Referer 时回落到 https://movie.douban.com/。
    // 对齐 MoonTV 的 video-proxy / image-proxy 默认行为 —— Douban 关联的 VOD
    // 站普遍只校验 Referer host 是 douban，给一个合法 Douban Referer 即可放行。
    if let Some(r) = referer {
        if !r.is_empty() {
            req = req.set("Referer", r);
        } else {
            req = req.set("Referer", "https://movie.douban.com/");
        }
    } else {
        req = req.set("Referer", "https://movie.douban.com/");
    }
    req = req.set("Accept", "*/*");
    req = req.set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8");
    // 让上游分片走 HTTP keep-alive / 启用 gzip 协商(ureq 自动处理)
    req = req.set("Connection", "keep-alive");
    // 若 jar 命中了 CF cookie(直播流也可能在 CF 后),透传一下
    if let Some(cookie) = cf_cookies::get_cookie_header_for_url(target) {
        req = req.set("Cookie", &cookie);
    }
    // Origin 头:浏览器对跨域 HLS 请求会自动发,部分 CDN(如 chaturbate 的 mmcdn.com)
    // 严格校验它,缺失就 403。从 Referer 推断 Origin —— Referer 是 URL,
    // Origin 是 `scheme://host[:port]`,直接截断 path 即可。
    if let Some(r) = referer {
        if !r.is_empty() {
            if let Ok(u) = Url::parse(r) {
                let origin = format!(
                    "{}://{}{}",
                    u.scheme(),
                    u.host_str().unwrap_or(""),
                    u.port().map(|p| format!(":{p}")).unwrap_or_default()
                );
                req = req.set("Origin", &origin);
            }
        }
    }
    // ureq 默认把 4xx/5xx 当 Err(Error::Status(code, resp))。我们要转发上游响应给前端
    // (例如 403 防盗链 / 404 资源不存在原样上抛，hls.js 能识别真实状态而非误以为是代理 502)。
    let resp = match req.call() {
        Ok(resp) => resp,
        Err(ureq::Error::Status(code, resp)) => {
            if code >= 400 {
                eprintln!(
                    "[proxy_fetch] upstream {code} for {} (ct={:?}, server={:?})",
                    target,
                    resp.header("content-type"),
                    resp.header("server")
                );
            }
            resp
        }
        Err(e) => return Err(format!("{e}")),
    };

    let status = resp.status();
    let mut headers = HashMap::new();
    for name in resp.headers_names() {
        if let Some(value) = resp.header(&name) {
            headers.insert(name.to_lowercase(), value.to_string());
        }
    }
    let mut bytes = Vec::new();
    let mut reader = resp.into_reader().take(PROXY_SEGMENT_MAX_BYTES);
    reader
        .read_to_end(&mut bytes)
        .map_err(|e| format!("body read error: {e}"))?;
    Ok(FetchResult { status, headers, bytes })
}

/// dyproxy 的 HTTP/2 拉取(reqwest)—— 只给 mmcdn.com 系列 CDN 用,避开
/// `w3: session_duplicated`(同 token 不同 ALPN 客户端会被拒)。
///
/// 参数 / 行为对齐 `proxy_fetch`,差异:
/// - 用 reqwest 而非 ureq → ALPN 协商出 h2(若上游支持)
/// - 4xx/5xx 不当 Err,直接返回原响应让前端拿到真实状态
/// - 携带 Chrome client hints(`sec-ch-ua-*` / `sec-fetch-*`)对齐浏览器请求形状
async fn proxy_fetch_h2(
    target: &str,
    ua: Option<&str>,
    referer: Option<&str>,
    proxy: Option<&str>,
    timeout_secs: Option<u64>,
) -> Result<FetchResult, String> {
    let client = h2_client_for(proxy)?;
    let mut req = client.get(target);
    if let Some(secs) = timeout_secs {
        req = req.timeout(Duration::from_secs(secs));
    }
    req = req.header("User-Agent", ua.unwrap_or(DEFAULT_UA));
    let referer_val = referer.filter(|s| !s.is_empty()).unwrap_or("https://movie.douban.com/");
    req = req.header("Referer", referer_val);
    if let Ok(u) = Url::parse(referer_val) {
        let origin = format!(
            "{}://{}{}",
            u.scheme(),
            u.host_str().unwrap_or(""),
            u.port().map(|p| format!(":{p}")).unwrap_or_default()
        );
        req = req.header("Origin", &origin);
    }
    req = req.header("Accept", "*/*");
    req = req.header("Accept-Language", "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7");
    req = req.header("Accept-Encoding", "gzip, deflate, br, zstd");
    // Chrome client hints —— mmcdn 的 bot detection 会拿这些做指纹判断,缺了就拒
    req = req.header(
        "sec-ch-ua",
        "\"Chromium\";v=\"148\", \"Google Chrome\";v=\"148\", \"Not/A)Brand\";v=\"99\"",
    );
    req = req.header("sec-ch-ua-mobile", "?0");
    req = req.header("sec-ch-ua-platform", "\"Windows\"");
    req = req.header("sec-fetch-dest", "empty");
    req = req.header("sec-fetch-mode", "cors");
    req = req.header("sec-fetch-site", "cross-site");
    req = req.header("priority", "u=1, i");
    if let Some(cookie) = cf_cookies::get_cookie_header_for_url(target) {
        req = req.header("Cookie", &cookie);
    }
    let resp = req.send().await.map_err(|e| format!("{e}"))?;
    let status = resp.status().as_u16();
    let version = resp.version();
    if status >= 400 {
        eprintln!(
            "[proxy_fetch_h2] upstream {status} ({version:?}) for {} (ct={:?}, server={:?})",
            target,
            resp.headers().get("content-type").and_then(|v| v.to_str().ok()),
            resp.headers().get("server").and_then(|v| v.to_str().ok())
        );
    } else {
        eprintln!("[proxy_fetch_h2] upstream {status} ({version:?}) for {target}");
    }
    let mut headers = HashMap::new();
    for (k, v) in resp.headers().iter() {
        if let Ok(vs) = v.to_str() {
            headers.insert(k.as_str().to_lowercase(), vs.to_string());
        }
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("body read error: {e}"))?
        .to_vec();
    Ok(FetchResult { status, headers, bytes })
}

/// 同 src/lib/proxy.ts 的 PROXY_ORIGIN：Windows/Android 走 http://<scheme>.localhost。
fn proxy_origin() -> &'static str {
    if cfg!(any(target_os = "windows", target_os = "android")) {
        "http://dyproxy.localhost"
    } else {
        "dyproxy://localhost"
    }
}

fn build_proxy_url(
    sub_path: &str,
    abs_url: &str,
    ua: Option<&str>,
    referer: Option<&str>,
    filter_ads: bool,
    proxy: Option<&str>,
    bypass_proxy: bool,
) -> String {
    let mut s = format!(
        "{}/proxy/{}?url={}",
        proxy_origin(),
        sub_path,
        percent_encode_uri_component(abs_url)
    );
    if let Some(u) = ua {
        if !u.is_empty() {
            s.push_str(&format!("&ua={}", percent_encode_uri_component(u)));
        }
    }
    if let Some(r) = referer {
        if !r.is_empty() {
            s.push_str(&format!("&referer={}", percent_encode_uri_component(r)));
        }
    }
    if !filter_ads {
        s.push_str("&filter_ads=0");
    }
    if bypass_proxy {
        s.push_str("&bypass_proxy=1");
    } else if let Some(p) = proxy {
        if !p.is_empty() {
            s.push_str(&format!("&proxy={}", percent_encode_uri_component(p)));
        }
    }
    s
}

/// 将 m3u8 中所有 URI（KEY / 子 m3u8 / 分片）改写为代理 URL。
///
/// Stripchat 特化:base_url host 落在 doppiocdn.{com,net,org} 时,根据 playlist 内容判断:
///   - master(含 `#EXT-X-MOUFLON:PSCH:v2:` 行)→ 给所有 variant URL 追加
///     `?psch=v2&pkey=…`,否则 CDN 会 302 跳广告 VOD (`cpa/v2/stream.m3u8`)
///   - variant(含 `#EXT-X-MOUFLON:URI:` 行)→ 解扰下一行 `media.mp4` 占位符
///     为真分片 URL,需要 jar 里有匹配 pdkey
fn rewrite_m3u8(
    content: &str,
    base_url: &str,
    ua: Option<&str>,
    referer: Option<&str>,
    filter_ads: bool,
    proxy: Option<&str>,
    bypass_proxy: bool,
) -> String {
    let base = match Url::parse(base_url) {
        Ok(u) => u,
        Err(_) => return content.to_string(),
    };

    let abs = |maybe_relative: &str| -> String {
        if maybe_relative.starts_with("http://") || maybe_relative.starts_with("https://") {
            maybe_relative.to_string()
        } else if maybe_relative.starts_with("//") {
            format!("{}:{}", base.scheme(), maybe_relative)
        } else {
            base.join(maybe_relative)
                .map(|u| u.to_string())
                .unwrap_or_else(|_| maybe_relative.to_string())
        }
    };

    // —— Stripchat / Mouflon 上下文检测 ——
    let base_host = base.host_str().unwrap_or("").to_lowercase();
    let is_doppio_host = mouflon::is_doppiocdn_host(&base_host);
    let is_doppio_master =
        is_doppio_host && content.contains("#EXT-X-MOUFLON:PSCH:v2:");
    let is_doppio_variant =
        is_doppio_host && content.contains("#EXT-X-MOUFLON:URI:");

    // —— AmateurTV / a0s.net 上下文备注(已无需特殊处理) ——
    // 历史:服务端返的 master.m3u8 标 `#EXT-X-PLAYLIST-TYPE:VOD` + `#EXT-X-ENDLIST`,
    // 曾经强制改 MEDIA-SEQUENCE 为 unix 秒 + fragment URL 加 `&_t=` 试图无限刷同一 URL。
    // 实际根因不在 m3u8 形态,而在拉流 UA:desktop Chrome UA → 服务端返加密 decoy(花屏 + 伪 VOD);
    // `User-Agent: iPad` → 返标准明文 HLS(参考 dobbelina/plugin.video.cumination/sites/amateurtv.py)。
    // adapter 改 UA 后 m3u8 是正常 LIVE 形态,不需任何 hack。

    // master 模式:从 6 个候选 pkey 里挑一个有 pdkey 的;没有就用第一个让 variant 至少 200 OK
    let variant_pkey_to_inject: Option<String> = if is_doppio_master {
        let pkeys = mouflon::extract_master_pkeys(content);
        let pkey_refs: Vec<&str> = pkeys.iter().map(|s| s.as_str()).collect();
        let picked = mouflon::pick_known_pkey(&pkey_refs);
        if picked.is_none() && !pkeys.is_empty() {
            eprintln!(
                "[mouflon] master {} has {} candidate pkeys, none match jar — \
                 variant will load but segments will return blank (pdkey needed). \
                 Pkeys offered: {:?}",
                base_url, pkeys.len(), pkeys
            );
        }
        picked.or_else(|| pkeys.into_iter().next())
    } else {
        None
    };

    // variant 模式:从当前 URL 查询里拿 pkey → jar 里查 pdkey
    let variant_pdkey: Option<String> = if is_doppio_variant {
        let pkey_q = base
            .query_pairs()
            .find(|(k, _)| k == "pkey")
            .map(|(_, v)| v.into_owned());
        let pdk = pkey_q.as_deref().and_then(mouflon::get_pdkey);
        if pdk.is_none() {
            eprintln!(
                "[mouflon] variant {} has Mouflon-scrambled segments but pdkey for \
                 pkey={:?} is not in jar — segments will play as `media.mp4` blanks",
                base_url, pkey_q
            );
        }
        pdk
    } else {
        None
    };

    let mut out: Vec<String> = Vec::new();
    let mut prev_stream_inf = false;
    // variant 模式下,记录上一行 #EXT-X-MOUFLON:URI 解扰后的 URL,
    // 下一个非 `#` 行(player 占位符 `…/media.mp4`)整行替换为此 URL
    let mut next_decoded_url: Option<String> = None;

    for line in content.lines() {
        let trimmed = line.trim();

        // 跳过 discontinuity（轻量去广告）
        if filter_ads && trimmed.starts_with("#EXT-X-DISCONTINUITY") {
            continue;
        }

        // Stripchat: 当前行是 #EXT-X-MOUFLON:URI:<full_url> —— 解扰段名,
        // 保留原行(hls.js 忽略未知 tag),把解扰后的 URL stash 给下一行用
        if is_doppio_variant && trimmed.starts_with("#EXT-X-MOUFLON:URI:") {
            if let Some(pdkey) = variant_pdkey.as_deref() {
                if let Some(decoded) = decrypt_mouflon_uri_line(trimmed, pdkey) {
                    next_decoded_url = Some(decoded);
                }
            }
            out.push(line.to_string());
            continue;
        }

        // 任何 # 行内含 URI="..." 都需要重写（KEY/MAP/MEDIA/I-FRAME-STREAM-INF/SESSION-DATA…）
        // 否则 hls.js 拿到相对 URI 会相对 dyproxy 自身解析 → /proxy/<relative> 找不到 url param 报 400
        if trimmed.starts_with('#') {
            prev_stream_inf = trimmed.starts_with("#EXT-X-STREAM-INF:");
            if let Some(start) = trimmed.find("URI=\"") {
                let after = &trimmed[start + 5..];
                if let Some(end) = after.find('"') {
                    let inner_uri = &after[..end];
                    let abs_uri = abs(inner_uri);
                    let lower = abs_uri.to_lowercase();
                    // 选择 sub_path:
                    //   KEY → /proxy/key (密钥二进制)
                    //   子 m3u8 (含 .m3u8) → /proxy/m3u8 (走文本重写)
                    //   其它 (MAP init segment / 其它二进制) → /proxy/segment
                    let sub_path = if trimmed.starts_with("#EXT-X-KEY:") {
                        "key"
                    } else if lower.contains(".m3u8") {
                        "m3u8"
                    } else {
                        "segment"
                    };
                    let proxy_url = build_proxy_url(
                        sub_path,
                        &abs_uri,
                        ua,
                        referer,
                        filter_ads,
                        proxy,
                        bypass_proxy,
                    );
                    let before = &trimmed[..start + 5];
                    let tail = &after[end..];
                    out.push(format!("{}{}{}", before, proxy_url, tail));
                    continue;
                }
            }
            out.push(line.to_string());
            continue;
        }

        if trimmed.is_empty() {
            out.push(String::new());
            continue;
        }

        // 广告分片过滤：上一行 EXTINF + 当前 URL 含广告关键字
        if filter_ads {
            if let Some(last) = out.last() {
                if last.starts_with("#EXTINF:") {
                    let lower = trimmed.to_lowercase();
                    if ADS_KEYWORDS.iter().any(|k| lower.contains(k)) {
                        out.pop();
                        continue;
                    }
                }
            }
        }

        // Stripchat variant: 用解扰后的 URL 替换 media.mp4 占位符整行(忽略 trimmed 本身)
        let resolved = if let Some(decoded) = next_decoded_url.take() {
            decoded
        } else {
            abs(trimmed)
        };

        let mut abs_url = resolved;
        let is_m3u8 = abs_url.contains(".m3u8") || prev_stream_inf;

        // Stripchat master: 给 variant 子 m3u8 URL 追加 ?psch=v2&pkey=…
        if is_m3u8 {
            if let Some(pk) = variant_pkey_to_inject.as_deref() {
                abs_url = inject_psch_pkey(&abs_url, pk);
            }
        }

        let proxy_path = if is_m3u8 { "m3u8" } else { "segment" };
        out.push(build_proxy_url(
            proxy_path,
            &abs_url,
            ua,
            referer,
            filter_ads,
            proxy,
            bypass_proxy,
        ));
        prev_stream_inf = false;
    }

    out.join("\n")
}

/// 解扰 Mouflon variant 的 `#EXT-X-MOUFLON:URI:<full_url>` 行 → 返回还原后的完整 URL。
///
/// URI 形如(实测 2026-05):
///   `https://media-hls.doppiocdn.com/b-hls-28/172963574/172963574_160p_h264_577_QF99d5pagEk48z/V3FeOgZ_1779551861.mp4`
///                                                                        ^^^^^^^^^^^^^^^^^^^^^^^ 加扰段(可能含 `/`)
///
/// 加密段是 URI 倒数第 2 个 `_` 与倒数第 1 个 `_` 之间的内容(注意:标准 base64 字母表
/// 含 `/`,加密段经常带 `/`,所以**不能**用 `rfind('/')` 切 filename —— 那会把加密段切坏,
/// 一半 segment 静默解扰失败、hls.js 表现为间歇性 buffering)。
///
/// 算法对齐 StreaMonitor `m3u_decoder` 的 v2 分支:
///   `uri.split('_')[-2]` → reversed → b64 → XOR sha256(pdkey) → 替换回原位
fn decrypt_mouflon_uri_line(line: &str, pdkey: &str) -> Option<String> {
    let uri = line.strip_prefix("#EXT-X-MOUFLON:URI:")?.trim();
    let last_underscore = uri.rfind('_')?;
    let before_last = &uri[..last_underscore];
    let second_last_underscore = before_last.rfind('_')?;
    let encrypted = &uri[second_last_underscore + 1..last_underscore];
    if encrypted.is_empty() {
        return None;
    }
    let decrypted = mouflon::decrypt_segment(encrypted, pdkey)?;

    let mut out = String::with_capacity(uri.len() + decrypted.len());
    out.push_str(&uri[..=second_last_underscore]);
    out.push_str(&decrypted);
    out.push_str(&uri[last_underscore..]);
    Some(out)
}

/// 给 stripchat variant 子 m3u8 URL 追加 `?psch=v2&pkey=…` 查询。已经带 query 的情况
/// 用 `&` 连,已经带相同 pkey 的不重复(后端会用最后一个,但避免污染日志)。
fn inject_psch_pkey(url: &str, pkey: &str) -> String {
    // 简单字符串拼接 —— variant URL 在 master 里几乎都是无 query 的裸 URL
    if url.contains("psch=") || url.contains("pkey=") {
        return url.to_string();
    }
    let sep = if url.contains('?') { '&' } else { '?' };
    format!("{}{}psch=v2&pkey={}", url, sep, pkey)
}

/// 打开桌面歌词独立窗口 — 桌面端专用，无边框 + always-on-top + 透明。
///
/// 通过 hash route 加载 `#/music/desktop-lyric`，让 React 路由匹配到 DesktopLyric 页面。
/// 主窗口通过 Tauri event 把 `music-state` 广播给该窗口。
#[cfg(desktop)]
#[tauri::command]
async fn open_lyric_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::{LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

    if let Some(win) = app.get_webview_window("lyric") {
        let _ = win.set_focus();
        return Ok(());
    }

    let win = WebviewWindowBuilder::new(
        &app,
        "lyric",
        WebviewUrl::App("index.html#/music/desktop-lyric".into()),
    )
    .title("歌词")
    .inner_size(560.0, 120.0)
    .min_inner_size(320.0, 80.0)
    .decorations(false)
    .always_on_top(true)
    .resizable(true)
    .skip_taskbar(false)
    .build()
    .map_err(|e| e.to_string())?;

    // 默认放在屏幕底部居中区域
    if let Ok(Some(monitor)) = win.current_monitor() {
        let size = monitor.size();
        let scale = monitor.scale_factor();
        let logical_w = size.width as f64 / scale;
        let logical_h = size.height as f64 / scale;
        let x = (logical_w - 560.0) / 2.0;
        let y = logical_h - 200.0;
        let _ = win.set_position(LogicalPosition::new(x.max(0.0), y.max(0.0)));
        let _ = win.set_size(LogicalSize::new(560.0, 120.0));
    }

    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
fn close_lyric_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(win) = app.get_webview_window("lyric") {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 打开 Cloudflare 人机验证独立窗口。
///
/// 流程:
///   1. 用与后续 ureq/reqwest 完全一致的 UA + 代理新建窗口,导航到 `url`
///   2. 用户在窗口里手动通过 CF challenge(点击复选框 / 等 JS 完成)
///   3. 用户关闭窗口,我们在 `CloseRequested` 事件抽 cookies,过滤出 CF 系列写入 jar
///   4. 返回是否拿到 `cf_clearance`(true = 验证通过,false = 用户取消 / 没通过)
///
/// 仅桌面端。移动端 `cookies()` API 在 Android 返空 Vec(Tauri #11330),
/// iOS 多窗口体验也不好,统一走前端友好降级。
#[cfg(desktop)]
#[tauri::command]
async fn open_cf_challenge(
    app: tauri::AppHandle,
    url: String,
    ua: Option<String>,
    proxy_url: Option<String>,
) -> Result<bool, String> {
    use std::sync::{Arc, Mutex};
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
    use tokio::sync::oneshot;

    eprintln!(
        "[cf-challenge] command invoked, url={url}, ua={:?}, proxy={:?}",
        ua.as_deref().map(|s| &s[..s.len().min(40)]),
        proxy_url
    );

    let parsed_url = Url::parse(&url).map_err(|e| format!("bad url: {e}"))?;
    let host = parsed_url.host_str().unwrap_or("").to_lowercase();
    if host.is_empty() {
        return Err("url has no host".into());
    }

    // 如果 jar 里已经有 cf_clearance,说明上一次验证刚刚成功 —— 直接返 true,
    // 避免被同一波并发请求二次触发弹窗
    if cf_cookies::get_cookie_header_for_url(&url)
        .map(|s| s.contains("cf_clearance="))
        .unwrap_or(false)
    {
        eprintln!("[cf-challenge] jar already has cf_clearance for {host}, skipping window");
        return Ok(true);
    }

    // 已有窗口:不要关掉(否则第二个 invoke 把第一个的窗口关了,用户看到"闪一下")
    // 直接 focus,然后等当前用户操作 —— 但 Rust 端没有共享 oneshot,简单返回 false 让前端走兜底
    if let Some(existing) = app.get_webview_window("cf-challenge") {
        eprintln!("[cf-challenge] window already exists, focusing it and returning false (caller will retry next round)");
        let _ = existing.set_focus();
        return Ok(false);
    }

    let mut builder = WebviewWindowBuilder::new(
        &app,
        "cf-challenge",
        WebviewUrl::External(parsed_url.clone()),
    )
    .title("人机验证 — 通过后请关闭此窗口")
    .inner_size(720.0, 800.0)
    .min_inner_size(480.0, 600.0)
    .resizable(true);

    if let Some(u) = ua.as_deref().filter(|s| !s.is_empty()) {
        builder = builder.user_agent(u);
    }
    // 不调 builder.proxy_url() —— Windows WebView2 每窗口代理设置和已初始化的主窗口
    // 环境冲突,新窗口起不来(symptom: build() Ok 但 webview 进程立即崩,
    // is_visible() 报 "failed to receive message from webview")。
    // WebView2 默认走 Windows 系统代理,用户的代理设置在 sysproxy 里已生效,
    // 所以即便不显式传 proxy_url,实际效果也一样。
    // 仅当用户"manual"模式且填的代理 ≠ 系统代理时会有差异 —— 那是已知限制。
    if let Some(p) = proxy_url.as_deref().filter(|s| !s.is_empty()) {
        eprintln!(
            "[cf-challenge] note: ureq proxy={p} (webview 不显式设代理,依赖 Windows 系统代理)"
        );
    }

    eprintln!("[cf-challenge] building window...");
    let win = match builder.build() {
        Ok(w) => {
            eprintln!("[cf-challenge] window built OK");
            w
        }
        Err(e) => {
            eprintln!("[cf-challenge] build failed: {e}");
            return Err(format!("build window failed: {e}"));
        }
    };

    // Build 完后显式 show + 居中 + 抢焦点 —— builder 级 .center()/.focused() 在
    // Windows 上有时不可靠(窗口还没拿到最终尺寸时算位置,可能放屏幕外)
    use tauri::{LogicalPosition, LogicalSize};
    if let Ok(Some(monitor)) = win.current_monitor() {
        let size = monitor.size();
        let scale = monitor.scale_factor();
        let logical_w = size.width as f64 / scale;
        let logical_h = size.height as f64 / scale;
        let win_w = 720.0_f64.min(logical_w - 40.0);
        let win_h = 800.0_f64.min(logical_h - 80.0);
        let x = ((logical_w - win_w) / 2.0).max(0.0);
        let y = ((logical_h - win_h) / 2.0).max(0.0);
        let _ = win.set_size(LogicalSize::new(win_w, win_h));
        let _ = win.set_position(LogicalPosition::new(x, y));
    }
    let _ = win.show();
    let _ = win.unminimize();
    let _ = win.set_focus();
    match win.is_visible() {
        Ok(v) => eprintln!("[cf-challenge] post-show is_visible={v}"),
        Err(e) => eprintln!("[cf-challenge] is_visible() error: {e}"),
    }

    // oneshot: 窗口关闭事件 → 唤醒等待
    let (tx, rx) = oneshot::channel::<()>();
    let tx_holder: Arc<Mutex<Option<oneshot::Sender<()>>>> = Arc::new(Mutex::new(Some(tx)));
    let tx_clone = tx_holder.clone();
    win.on_window_event(move |event| {
        match event {
            WindowEvent::CloseRequested { api, .. } => {
                // 关键:阻止默认关闭,否则 WebView2 立即销毁,后面 cookies() 拿不到东西
                // (报错: "failed to receive message from webview")。
                // 我们在 rx.await 后抽完 cookie 再显式 win.destroy()。
                eprintln!(
                    "[cf-challenge] event: CloseRequested (prevent_close, will extract cookies first)"
                );
                api.prevent_close();
                if let Ok(mut guard) = tx_clone.lock() {
                    if let Some(s) = guard.take() {
                        let _ = s.send(());
                    }
                }
            }
            WindowEvent::Destroyed => {
                // 兜底:进程级强制销毁(主窗口关、应用退出等)。
                // 这条路径下 cookies() 必然失败,只能放弃。
                eprintln!("[cf-challenge] event: Destroyed");
                if let Ok(mut guard) = tx_clone.lock() {
                    if let Some(s) = guard.take() {
                        let _ = s.send(());
                    }
                }
            }
            WindowEvent::Focused(f) => {
                eprintln!("[cf-challenge] event: Focused({f})");
            }
            WindowEvent::Resized(_) => {}
            WindowEvent::Moved(_) => {}
            other => {
                eprintln!("[cf-challenge] event: {other:?}");
            }
        }
    });

    eprintln!("[cf-challenge] waiting for user to close window...");

    // 阻塞等用户操作 —— 没有超时,用户就是要花时间手动验证
    let _ = rx.await;

    eprintln!("[cf-challenge] proceeding to cookie extraction (window still alive)");

    // 抽 cookie —— 此时 WebView2 还在(prevent_close 阻止了销毁)
    let win_clone = win.clone();
    let cookies_result = tauri::async_runtime::spawn_blocking(move || win_clone.cookies())
        .await
        .map_err(|e| e.to_string())?;

    // 不管成功失败,把窗口真正销毁
    let _ = win.destroy();

    let cookies = match cookies_result {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[cf-challenge] cookies() error: {e}");
            return Ok(false);
        }
    };

    eprintln!("[cf-challenge] got {} cookies total", cookies.len());

    // 过滤出归属于目标 host 的 cookie(覆盖父域,如 .chaturbate.com 也算 chaturbate.com 的)
    let mut harvested: Vec<(String, String)> = Vec::new();
    for c in cookies {
        let domain = c
            .domain()
            .unwrap_or("")
            .trim_start_matches('.')
            .to_lowercase();
        if domain.is_empty() {
            continue;
        }
        if host == domain || host.ends_with(&format!(".{}", domain)) {
            harvested.push((c.name().to_string(), c.value().to_string()));
        }
    }

    eprintln!(
        "[cf-challenge] {} cookies matched host {}",
        harvested.len(),
        host
    );
    for (n, _) in &harvested {
        eprintln!("[cf-challenge]   - {n}");
    }

    let got_clearance = cf_cookies::store_cookies_for_host(&host, harvested);
    eprintln!("[cf-challenge] got_clearance={got_clearance}");
    Ok(got_clearance)
}

#[cfg(not(desktop))]
#[tauri::command]
async fn open_cf_challenge(
    app: tauri::AppHandle,
    url: String,
    ua: Option<String>,
    _proxy_url: Option<String>,
) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        let _ = (app, url, ua);
        return Ok(false);
    }

    #[cfg(target_os = "ios")]
    {
        use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

        let parsed_url = Url::parse(&url).map_err(|e| format!("bad url: {e}"))?;
        let host = parsed_url.host_str().unwrap_or("").to_lowercase();
        if host.is_empty() {
            return Err("url has no host".into());
        }

        if cf_cookies::get_cookie_header_for_url(&url)
            .map(|s| s.contains("cf_clearance="))
            .unwrap_or(false)
        {
            return Ok(true);
        }

        if app.get_webview_window("cf-challenge").is_some() {
            return Ok(false);
        }

        let mut builder = WebviewWindowBuilder::new(
            &app,
            "cf-challenge",
            WebviewUrl::External(parsed_url.clone()),
        )
        .title("人机验证");

        if let Some(u) = ua.as_deref().filter(|s| !s.is_empty()) {
            builder = builder.user_agent(u);
        }

        let win = builder
            .build()
            .map_err(|e| format!("build window failed: {e}"))?;

        let mut got_clearance = false;
        for _ in 0..150 {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;

            if app.get_webview_window("cf-challenge").is_none() {
                break;
            }

            let win_ref = win.clone();
            let cookies_result =
                tauri::async_runtime::spawn_blocking(move || win_ref.cookies())
                    .await
                    .map_err(|e| e.to_string())?;

            if let Ok(cookies) = cookies_result {
                let mut harvested: Vec<(String, String)> = Vec::new();
                let mut found_clearance = false;
                for c in cookies {
                    let domain = c
                        .domain()
                        .unwrap_or("")
                        .trim_start_matches('.')
                        .to_lowercase();
                    if domain.is_empty() {
                        continue;
                    }
                    if host == domain || host.ends_with(&format!(".{}", domain)) {
                        if c.name() == "cf_clearance" {
                            found_clearance = true;
                        }
                        harvested.push((c.name().to_string(), c.value().to_string()));
                    }
                }
                if found_clearance {
                    cf_cookies::store_cookies_for_host(&host, harvested);
                    got_clearance = true;
                    break;
                }
            }
        }

        if let Some(w) = app.get_webview_window("cf-challenge") {
            let _ = w.destroy();
        }

        return Ok(got_clearance);
    }

    #[allow(unreachable_code)]
    {
        let _ = (app, url, ua);
        Ok(false)
    }
}

#[tauri::command]
fn get_stream_proxy_port() -> Option<u16> {
    stream_proxy::port()
}

/// Stripchat Mouflon 解扰用 `pkey:pdkey` 对。前端持久化在 localStorage,
/// 启动时调一次 `set_mouflon_keys` 把全部条目灌进进程内 jar(进程退出即丢)。
#[derive(Debug, Clone, Serialize, Deserialize)]
struct MouflonKeyPair {
    pkey: String,
    pdkey: String,
}

#[tauri::command]
fn set_mouflon_keys(pairs: Vec<MouflonKeyPair>) -> Result<usize, String> {
    let n = pairs.len();
    let raw_preview: Vec<&str> = pairs.iter().take(3).map(|p| p.pkey.as_str()).collect();
    eprintln!(
        "[mouflon] set_mouflon_keys called: {} pairs, raw first pkeys = {:?}",
        n, raw_preview
    );
    let pairs: Vec<(String, String)> =
        pairs.into_iter().map(|p| (p.pkey, p.pdkey)).collect();
    mouflon::set_keys(pairs);
    let after = mouflon::get_keys();
    let clean_preview: Vec<&str> = after.iter().take(3).map(|(k, _)| k.as_str()).collect();
    eprintln!(
        "[mouflon] jar after set: {} entries, first stored pkeys = {:?}",
        after.len(),
        clean_preview
    );
    Ok(n)
}

#[tauri::command]
fn get_mouflon_keys() -> Vec<MouflonKeyPair> {
    mouflon::get_keys()
        .into_iter()
        .map(|(pkey, pdkey)| MouflonKeyPair { pkey, pdkey })
        .collect()
}

/// FC2 Live 拉流 —— 给 channel_id 拿一条 HLS playlist URL。
///
/// 见 `fc2_ws.rs`：FC2 拉流必须先用 WebSocket 握手（HTTP getControlServer →
/// wss + control_token → 发 get_hls_information → 拿 HLS URL），不能纯 HTTP 完成。
#[tauri::command]
async fn fc2_resolve_hls(
    channel_id: String,
    proxy_url: Option<String>,
) -> Result<String, String> {
    fc2_ws::resolve_hls(channel_id, proxy_url).await
}

/// 一次性 FC2 诊断入口 —— 只在排查 variant 403 时手动从 devtools 调:
///   `await (await import('@tauri-apps/api/core')).invoke('fc2_diagnose',{channelId:'xxxxx',proxyUrl:'http://127.0.0.1:7890'})`
/// 返回多行字符串,包含 WS 拿到的 playlist 列表 / master 状态码 / variant 状态码 /
/// 两次请求是否落在同一 remote_addr。
#[tauri::command]
async fn fc2_diagnose(
    channel_id: String,
    proxy_url: Option<String>,
) -> Result<String, String> {
    fc2_ws::diagnose(channel_id, proxy_url).await
}

/// MyFreeCams 匿名 listing —— 走 WebSocket 连 wchat server,登录后收 20 秒
/// SESSIONSTATE 快照返回。见 `mfc_ws.rs`。
#[tauri::command]
async fn mfc_list_online(
    proxy_url: Option<String>,
) -> Result<Vec<mfc_ws::MfcModel>, String> {
    mfc_ws::list_online(proxy_url).await
}

/// MyFreeCams listing 诊断 —— 跑同样的握手 + 收包流程,返回多行文字报告。
/// 用户在 DevTools 调:
///   `await (await import('@tauri-apps/api/core')).invoke('mfc_diagnose',{proxyUrl:'http://127.0.0.1:7890'})`
#[tauri::command]
async fn mfc_diagnose(proxy_url: Option<String>) -> Result<String, String> {
    mfc_ws::diagnose(proxy_url).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create favorites and history tables",
            sql: "
                CREATE TABLE IF NOT EXISTS favorites (
                    item_id TEXT PRIMARY KEY,
                    script_key TEXT NOT NULL,
                    vod_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    poster TEXT,
                    source_name TEXT,
                    added_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_favorites_added ON favorites(added_at DESC);

                CREATE TABLE IF NOT EXISTS history (
                    item_id TEXT PRIMARY KEY,
                    script_key TEXT NOT NULL,
                    vod_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    poster TEXT,
                    source_name TEXT,
                    episode_index INTEGER NOT NULL DEFAULT 0,
                    position REAL NOT NULL DEFAULT 0,
                    duration REAL NOT NULL DEFAULT 0,
                    completed INTEGER NOT NULL DEFAULT 0,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_history_updated ON history(updated_at DESC);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add episodes_watched JSON column to history",
            sql: "ALTER TABLE history ADD COLUMN episodes_watched TEXT NOT NULL DEFAULT '[]';",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "music: history + playlists + playlist items",
            sql: "
                CREATE TABLE IF NOT EXISTS music_history (
                    song_id TEXT NOT NULL,
                    source TEXT NOT NULL,
                    name TEXT NOT NULL,
                    artist TEXT,
                    album TEXT,
                    cover TEXT,
                    duration_sec REAL NOT NULL DEFAULT 0,
                    position_sec REAL NOT NULL DEFAULT 0,
                    last_played_at INTEGER NOT NULL,
                    play_count INTEGER NOT NULL DEFAULT 1,
                    PRIMARY KEY (song_id, source)
                );
                CREATE INDEX IF NOT EXISTS idx_music_history_recent
                    ON music_history(last_played_at DESC);

                CREATE TABLE IF NOT EXISTS music_playlists (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    cover TEXT,
                    song_count INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS music_playlist_items (
                    playlist_id TEXT NOT NULL,
                    song_id TEXT NOT NULL,
                    source TEXT NOT NULL,
                    position INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    artist TEXT,
                    album TEXT,
                    cover TEXT,
                    duration_sec REAL NOT NULL DEFAULT 0,
                    added_at INTEGER NOT NULL,
                    PRIMARY KEY (playlist_id, song_id, source)
                );
                CREATE INDEX IF NOT EXISTS idx_music_playlist_items_pos
                    ON music_playlist_items(playlist_id, position ASC);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "books: shelf + reading progress",
            sql: "
                CREATE TABLE IF NOT EXISTS book_shelf (
                    source_id TEXT NOT NULL,
                    book_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    author TEXT,
                    cover TEXT,
                    summary TEXT,
                    acquisition_links TEXT NOT NULL DEFAULT '[]',
                    saved_at INTEGER NOT NULL,
                    PRIMARY KEY (source_id, book_id)
                );
                CREATE INDEX IF NOT EXISTS idx_book_shelf_saved
                    ON book_shelf(saved_at DESC);

                CREATE TABLE IF NOT EXISTS book_progress (
                    source_id TEXT NOT NULL,
                    book_id TEXT NOT NULL,
                    locator_type TEXT NOT NULL,
                    locator_value TEXT NOT NULL,
                    chapter_title TEXT,
                    percent REAL NOT NULL DEFAULT 0,
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY (source_id, book_id)
                );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "manga: shelf + reading history",
            sql: "
                CREATE TABLE IF NOT EXISTS manga_shelf (
                    source_id TEXT NOT NULL,
                    manga_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    cover TEXT,
                    author TEXT,
                    status TEXT,
                    last_chapter_id TEXT,
                    last_chapter_name TEXT,
                    saved_at INTEGER NOT NULL,
                    PRIMARY KEY (source_id, manga_id)
                );
                CREATE INDEX IF NOT EXISTS idx_manga_shelf_saved
                    ON manga_shelf(saved_at DESC);

                CREATE TABLE IF NOT EXISTS manga_history (
                    source_id TEXT NOT NULL,
                    manga_id TEXT NOT NULL,
                    chapter_id TEXT NOT NULL,
                    chapter_name TEXT,
                    page_index INTEGER NOT NULL DEFAULT 0,
                    page_count INTEGER NOT NULL DEFAULT 0,
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY (source_id, manga_id, chapter_id)
                );
                CREATE INDEX IF NOT EXISTS idx_manga_history_recent
                    ON manga_history(updated_at DESC);
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "music: favorites table",
            sql: "
                CREATE TABLE IF NOT EXISTS music_favorites (
                    song_id TEXT NOT NULL,
                    source TEXT NOT NULL,
                    name TEXT NOT NULL,
                    artist TEXT,
                    album TEXT,
                    cover TEXT,
                    duration_sec REAL NOT NULL DEFAULT 0,
                    favorited_at INTEGER NOT NULL,
                    PRIMARY KEY (song_id, source)
                );
                CREATE INDEX IF NOT EXISTS idx_music_favorites_recent
                    ON music_favorites(favorited_at DESC);
            ",
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:douytv.db", migrations)
                .build(),
        )
        .setup(|app| {
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                let _ = app.handle().plugin(tauri_plugin_updater::Builder::new().build());
                let _ = app.handle().plugin(tauri_plugin_process::init());
            }
            #[cfg(any(target_os = "android", target_os = "ios"))]
            let _ = app;
            // 启动本地流式 HTTP 代理（FLV / MPEG-TS 直播用）
            stream_proxy::start();
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("dyproxy", |_ctx, request, responder| {
            // IPC 闭包立即返回；ureq 同步等待全部丢到 spawn_blocking。
            // 否则 HLS 高频拉 segment/key 会堵 IPC 主线程 → PostMessage failed / 0x80070578。
            tauri::async_runtime::spawn_blocking(move || {
                let uri = request.uri();
                let path = uri.path().to_string();
                let query = uri.query().unwrap_or("").to_string();
                let params: HashMap<String, String> =
                    url::form_urlencoded::parse(query.as_bytes())
                        .into_owned()
                        .collect();

                let cors = |status: u16, body: Vec<u8>| {
                    tauri::http::Response::builder()
                        .status(status)
                        .header("Access-Control-Allow-Origin", "*")
                        .header("Access-Control-Allow-Methods", "GET, OPTIONS")
                        .header("Access-Control-Allow-Headers", "*")
                        .header("Access-Control-Expose-Headers", "Content-Length, Content-Range")
                        .body(body)
                        .unwrap()
                };

                let Some(target_url) = params.get("url") else {
                    responder.respond(cors(400, b"missing url param".to_vec()));
                    return;
                };
                let ua = params.get("ua").map(String::as_str);
                let referer = params.get("referer").map(String::as_str);
                let filter_ads = params
                    .get("filter_ads")
                    .map(|v| !(v == "0" || v == "false"))
                    .unwrap_or(true);
                let bypass_proxy = params
                    .get("bypass_proxy")
                    .map(|v| v == "1" || v == "true")
                    .unwrap_or(false);
                let proxy = if bypass_proxy {
                    None
                } else {
                    params.get("proxy").map(String::as_str)
                };
                let is_m3u8_path = path.ends_with("/m3u8");
                let is_stream_path = path.ends_with("/stream");

                // 直播 FLV / MPEG-TS 通常无 EOF，read_to_end 会一直读到上限。
                // 给 /proxy/stream 路径放宽 timeout —— 否则 30s 内 ureq 超时会把流断成 502。
                let timeout_override = if is_stream_path {
                    Some(PROXY_STREAM_TIMEOUT_SECS)
                } else {
                    None
                };

                // 某些成人 cam 站的 CDN 用 CloudFlare TLS/header 指纹做 bot 检测,
                // ureq(rustls + 没 Chrome client hints)会被 403。已知:
                //   - mmcdn.com         (Chaturbate)       —— master m3u8 还有 session_duplicated 风险
                //   - *.livemediahost.com (CamSoda)        —— master/variant/segment 全 403
                //   - *.doppiocdn.{com,net,org} (Stripchat)—— variant/segment 403
                // 对这些主机强制走 reqwest h2 + 全套 Chrome client hints,m3u8 走带 cache 的
                // 串行路径(避开 session_duplicated),segment 走纯 h2 fetch,不缓存。
                //
                // FC2 不需要 Chrome 指纹,但需要 **TCP 连接复用** —— FC2 把 HLS token 绑出口 IP,
                // ureq 每次新 TCP,经过 Clash 多节点代理时上游 IP 会变,master 200 但 variant 全 403。
                // 切到 reqwest h2_client 复用连接池,所有 m3u8/segment 走同一上游节点。
                let target_host = Url::parse(target_url)
                    .ok()
                    .and_then(|u| u.host_str().map(|h| h.to_lowercase()))
                    .unwrap_or_default();
                let host_needs_chrome_fingerprint = target_host.contains("mmcdn.com")
                    || target_host.ends_with(".livemediahost.com")
                    || target_host == "livemediahost.com"
                    || target_host.ends_with(".doppiocdn.com")
                    || target_host == "doppiocdn.com"
                    || target_host.ends_with(".doppiocdn.net")
                    || target_host == "doppiocdn.net"
                    || target_host.ends_with(".doppiocdn.org")
                    || target_host == "doppiocdn.org";
                let host_needs_h2_pool = target_host.ends_with(".live.fc2.com")
                    || target_host == "live.fc2.com"
                    || target_host.ends_with(".a0s.net")
                    || target_host == "a0s.net";
                // a0s.net master.m3u8 每秒拉一次,内容固定但语义是"每次看到都是新一秒",
                // m3u8 cache 1.5s TTL 会让 hls.js 看到旧版本无法刷新 sequence。
                let host_skips_m3u8_cache = target_host.ends_with(".a0s.net")
                    || target_host == "a0s.net";
                let want_h2 = host_needs_chrome_fingerprint || host_needs_h2_pool;

                let fetch_result = if want_h2 {
                    if is_m3u8_path {
                        // per-URL 串行化 —— 防 stampede。第一个请求 fetch + 写 cache;
                        // 排队的后到请求拿锁后直接命中 cache,不打 CDN(避开 session_duplicated)。
                        let url_lock = m3u8_lock_for(target_url);
                        let _serial_guard = url_lock.lock().expect("per-url lock poisoned");
                        let from_cache = if host_skips_m3u8_cache {
                            None
                        } else {
                            m3u8_cache_get(target_url)
                        };
                        if let Some(cached) = from_cache {
                            eprintln!(
                                "[dyproxy] cache hit (m3u8, status={}): {target_url}",
                                cached.status
                            );
                            Ok(cached)
                        } else {
                            let result = tauri::async_runtime::block_on(proxy_fetch_h2(
                                target_url,
                                ua,
                                referer,
                                proxy,
                                timeout_override,
                            ));
                            if !host_skips_m3u8_cache {
                                if let Ok(ref r) = result {
                                    if r.status == 200 {
                                        if let Ok(s) = std::str::from_utf8(&r.bytes) {
                                            let head: String =
                                                s.lines().take(10).collect::<Vec<_>>().join("\n");
                                            eprintln!(
                                                "[dyproxy] h2 m3u8 200 body head ({} bytes total):\n{head}",
                                                r.bytes.len()
                                            );
                                        }
                                        m3u8_cache_put(target_url.to_string(), r.clone());
                                    }
                                }
                            } else if let Ok(ref r) = result {
                                eprintln!(
                                    "[dyproxy] h2 m3u8 {} (no-cache, a0s.net): {target_url}",
                                    r.status
                                );
                                if r.status == 200 {
                                    if let Ok(s) = std::str::from_utf8(&r.bytes) {
                                        let preview: String = s
                                            .lines()
                                            .take(12)
                                            .collect::<Vec<_>>()
                                            .join("\n  | ");
                                        eprintln!(
                                            "[dyproxy] a0s.net m3u8 ({} bytes) preview:\n  | {}",
                                            r.bytes.len(),
                                            preview
                                        );
                                    }
                                }
                            }
                            result
                        }
                    } else {
                        // segment / key / 其他子资源 —— 直接走 h2,不缓存。
                        tauri::async_runtime::block_on(proxy_fetch_h2(
                            target_url,
                            ua,
                            referer,
                            proxy,
                            timeout_override,
                        ))
                    }
                } else {
                    proxy_fetch(target_url, ua, referer, proxy, timeout_override)
                };

                let resp = match fetch_result {
                    Ok(r) => r,
                    Err(e) => {
                        responder.respond(cors(502, format!("upstream error: {e}").into_bytes()));
                        return;
                    }
                };

                let status = resp.status;
                let content_type = resp
                    .headers
                    .get("content-type")
                    .cloned()
                    .unwrap_or_else(|| "application/octet-stream".to_string());
                // 上游可能透传的 Range 相关响应头（用于 mp4 拖动）
                let content_range = resp.headers.get("content-range").cloned();
                let accept_ranges = resp
                    .headers
                    .get("accept-ranges")
                    .cloned()
                    .unwrap_or_else(|| "bytes".to_string());
                let bytes = resp.bytes;

                // 4xx/5xx 时把上游 body 也打出来 —— CDN 通常会给个简短文本说明拒绝原因
                if status >= 400 {
                    let preview = std::str::from_utf8(&bytes)
                        .map(|s| s.chars().take(500).collect::<String>())
                        .unwrap_or_else(|_| format!("<{} bytes binary>", bytes.len()));
                    eprintln!("[dyproxy] upstream {status} body: {preview}");
                }

                // m3u8 判定 3 路（任一成立即走文本重写）：
                //   1) 前端约定路径 /proxy/m3u8
                //   2) 上游 Content-Type 含 mpegurl
                //   3) Body 前几个字节是 "#EXTM3U" magic（兼容上游错配 octet-stream/text-plain 的情况）
                let starts_with_m3u8_magic = bytes.starts_with(b"#EXTM3U");
                let is_m3u8 = is_m3u8_path
                    || content_type.to_lowercase().contains("mpegurl")
                    || starts_with_m3u8_magic;

                if is_m3u8 {
                    let text = match String::from_utf8(bytes) {
                        Ok(t) => t,
                        Err(e) => {
                            responder.respond(cors(500, format!("utf8 error: {e}").into_bytes()));
                            return;
                        }
                    };
                    let rewritten = rewrite_m3u8(
                        &text,
                        target_url,
                        ua,
                        referer,
                        filter_ads,
                        proxy,
                        bypass_proxy,
                    );
                    // a0s.net debug: 打印重写后给 hls.js 的内容
                    if target_url.contains(".a0s.net") {
                        eprintln!(
                            "[dyproxy] a0s.net m3u8 rewritten ({} bytes) for {}:\n{}",
                            rewritten.len(),
                            target_url.split('?').next().unwrap_or(target_url),
                            rewritten
                                .lines()
                                .take(20)
                                .map(|l| format!("  > {l}"))
                                .collect::<Vec<_>>()
                                .join("\n")
                        );
                    }
                    let response = tauri::http::Response::builder()
                        .status(status)
                        .header("Content-Type", "application/vnd.apple.mpegurl")
                        .header("Access-Control-Allow-Origin", "*")
                        .header("Access-Control-Allow-Methods", "GET, OPTIONS")
                        .header("Access-Control-Allow-Headers", "*")
                        .header("Cache-Control", "no-cache")
                        .body(rewritten.into_bytes())
                        .unwrap();
                    responder.respond(response);
                    return;
                }

                // segment / key / mp4 / 图片 / 其他 — 二进制透传
                let mut builder = tauri::http::Response::builder()
                    .status(status)
                    .header("Content-Type", content_type)
                    .header("Access-Control-Allow-Origin", "*")
                    .header("Access-Control-Allow-Methods", "GET, OPTIONS, HEAD")
                    .header("Access-Control-Allow-Headers", "*")
                    .header(
                        "Access-Control-Expose-Headers",
                        "Content-Length, Content-Range, Accept-Ranges",
                    )
                    .header("Accept-Ranges", accept_ranges);
                if let Some(cr) = content_range {
                    builder = builder.header("Content-Range", cr);
                }
                let response = builder.body(bytes).unwrap();
                responder.respond(response);
            });
        })
        .invoke_handler(tauri::generate_handler![
            script_http,
            script_http_h2,
            scan_local_videos,
            read_system_proxy,
            get_stream_proxy_port,
            open_cf_challenge,
            set_mouflon_keys,
            get_mouflon_keys,
            fc2_resolve_hls,
            fc2_diagnose,
            mfc_list_online,
            mfc_diagnose,
            #[cfg(desktop)]
            open_lyric_window,
            #[cfg(desktop)]
            close_lyric_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 实测样本(2026-05):用户 pdkey `Y64UVwX5RrIWnOLp` 配 pkey `1Dzcc6OjP73LKbtI`,
    /// 从 stripchat live model 172963574 的 160p variant 抓到的两个 segment。
    /// 第二个加密段含 `/`(base64 标准字母表会出现 `/`),旧代码用 `rfind('/')`
    /// 切 filename 会把 `/` 当路径分隔符,导致 parts.len()<4,return None,
    /// segment URL 一直是 `media.mp4` 占位符。
    #[test]
    fn decrypt_uri_line_handles_slash_in_encrypted() {
        let pdkey = "Y64UVwX5RrIWnOLp";

        // 无 `/` 的样本(早期测试用例)
        let line1 = "#EXT-X-MOUFLON:URI:https://media-hls.doppiocdn.com/b-hls-28/172963574/172963574_160p_h264_577_FAKEnoslash_1779551861.mp4";
        // 解扰本身可能 fail(这是 fake 加密),但函数应能识别字段位置不 panic
        let _ = decrypt_mouflon_uri_line(line1, pdkey);

        // 含 `/` 的实测样本 —— curl-verified 解扰后能拉到 HTTP 200
        let line2 = "#EXT-X-MOUFLON:URI:https://media-hls.doppiocdn.com/b-hls-28/172963574/172963574_160p_h264_630_QEs0qvaqXBahszIBSOrSSa_1779551967.mp4";
        let decoded = decrypt_mouflon_uri_line(line2, pdkey).expect("must decrypt");
        // 解扰后的真实 hash 是 "ZjTLff8nJu1YmJhN"(curl 验证可拉到 segment)
        assert_eq!(
            decoded,
            "https://media-hls.doppiocdn.com/b-hls-28/172963574/172963574_160p_h264_630_ZjTLff8nJu1YmJhN_1779551967.mp4"
        );
    }
}
