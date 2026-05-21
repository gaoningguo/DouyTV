use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri_plugin_sql::{Migration, MigrationKind};
use url::Url;

mod stream_proxy;

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
        for (k, v) in &req.headers {
            request = request.set(k, v);
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
    for (k, v) in &req.headers {
        request = request.header(k, v);
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

fn proxy_fetch(
    target: &str,
    ua: Option<&str>,
    referer: Option<&str>,
    proxy: Option<&str>,
    timeout_secs: Option<u64>,
) -> Result<ureq::Response, String> {
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
    // 让上游分片走 HTTP keep-alive / 启用 gzip 协商（ureq 自动处理）
    req = req.set("Connection", "keep-alive");
    // ureq 默认把 4xx/5xx 当 Err(Error::Status(code, resp))。我们要转发上游响应给前端
    // (例如 403 防盗链 / 404 资源不存在原样上抛，hls.js 能识别真实状态而非误以为是代理 502)。
    match req.call() {
        Ok(resp) => Ok(resp),
        Err(ureq::Error::Status(_, resp)) => Ok(resp),
        Err(e) => Err(format!("{e}")),
    }
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

    let mut out: Vec<String> = Vec::new();
    let mut prev_stream_inf = false;

    for line in content.lines() {
        let trimmed = line.trim();

        // 跳过 discontinuity（轻量去广告）
        if filter_ads && trimmed.starts_with("#EXT-X-DISCONTINUITY") {
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

        let abs_url = abs(trimmed);
        let is_m3u8 = abs_url.contains(".m3u8") || prev_stream_inf;
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

#[tauri::command]
fn get_stream_proxy_port() -> Option<u16> {
    stream_proxy::port()
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

                let resp = match proxy_fetch(target_url, ua, referer, proxy, timeout_override) {
                    Ok(r) => r,
                    Err(e) => {
                        responder.respond(cors(502, format!("upstream error: {e}").into_bytes()));
                        return;
                    }
                };

                let status = resp.status();
                let content_type = resp
                    .header("Content-Type")
                    .unwrap_or("application/octet-stream")
                    .to_string();
                // 上游可能透传的 Range 相关响应头（用于 mp4 拖动）
                let content_range = resp.header("Content-Range").map(|s| s.to_string());
                let accept_ranges = resp
                    .header("Accept-Ranges")
                    .unwrap_or("bytes")
                    .to_string();

                // 一次性读完上游 body —— 后面要做 magic 探测或重写
                let mut bytes = Vec::new();
                let mut reader = resp.into_reader().take(PROXY_SEGMENT_MAX_BYTES);
                if let Err(e) = reader.read_to_end(&mut bytes) {
                    responder.respond(cors(500, format!("body read error: {e}").into_bytes()));
                    return;
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
            #[cfg(desktop)]
            open_lyric_window,
            #[cfg(desktop)]
            close_lyric_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
