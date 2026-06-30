use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};
use url::Url;

mod amateurtv_ws;
mod cf_cookies;
mod fc2_ws;
mod mfc_ws;
mod mouflon;
mod music_unblock;
mod netease;
mod sample_aes_proxy;
mod stream_proxy;
mod ts_mp4;

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
        let mut body = String::new();
        response
            .into_reader()
            .read_to_string(&mut body)
            .map_err(|e| format!("body read error: {e}"))?;
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
pub struct HttpBytesResponse {
    pub url: String,
    pub status: u16,
    pub headers: HashMap<String, String>,
    /// 响应体原始字节的 base64 编码。前端按 content-type 里的 charset 用
    /// TextDecoder 解码（GBK/GB18030 等),或当二进制(epub/图片)直接使用。
    pub body_base64: String,
}

/// 与 `script_http` 同源,但**不做** UTF-8 lossy 解码 —— 返回原始字节的 base64。
///
/// **为什么需要**:`script_http` 用 `read_to_string` 把 body 当 UTF-8 读,
/// 国内多数 Legado 小说源返回 GBK/GB18030,lossy 解码会把正文糊成乱码;
/// epub 这类二进制更是直接报废。本命令把字节原样带回前端,由前端按
/// content-type charset(TextDecoder 支持 gbk/gb18030)解码,或当二进制用。
#[tauri::command]
async fn script_http_bytes(req: HttpRequest) -> Result<HttpBytesResponse, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<HttpBytesResponse, String> {
        use base64::Engine;
        let timeout = std::time::Duration::from_millis(req.timeout_ms.unwrap_or(30_000));
        let agent = agent_for(req.proxy_url.as_deref())?;

        let mut request = agent.request(&req.method, &req.url).timeout(timeout);
        let merged_cookie = merge_cookie_header(&req.url, &req.headers);
        for (k, v) in &req.headers {
            if k.eq_ignore_ascii_case("cookie") && merged_cookie.is_some() {
                continue;
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
        let mut bytes: Vec<u8> = Vec::new();
        response
            .into_reader()
            .take(32 * 1024 * 1024)
            .read_to_end(&mut bytes)
            .map_err(|e| format!("body read error: {e}"))?;
        let body_base64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        Ok(HttpBytesResponse {
            url,
            status,
            headers,
            body_base64,
        })
    })
    .await
    .map_err(|e| format!("{e}"))?
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

// ── 本地音乐入库(对齐 CyreneMusic local_music.rs:lofty 读标签)──

const AUDIO_EXTENSIONS: &[&str] = &["mp3", "flac", "wav", "ogg", "m4a", "aac", "wma", "opus"];

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalTrackMeta {
    pub file_path: String,
    pub name: String,
    pub artists: String,
    pub album: String,
    pub duration: f64,
    pub cover_data_url: Option<String>,
    pub lyric: Option<String>,
    /// 文件最后修改时间(Unix 毫秒),用于增量扫描比对。
    pub mtime: i64,
}

/// 轻量文件条目:只含路径 + mtime,不解析标签(用于增量扫描的 diff 阶段)。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileEntry {
    pub file_path: String,
    pub mtime: i64,
}

/// 读取文件最后修改时间(Unix 毫秒),失败返回 0。
fn file_mtime_ms(path: &Path) -> i64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn extract_audio_metadata(path: &Path) -> Option<LocalTrackMeta> {
    use base64::Engine;
    use lofty::prelude::*;
    use lofty::probe::Probe;

    let tagged_file = Probe::open(path).ok()?.read().ok()?;
    let duration = tagged_file.properties().duration().as_secs_f64();
    let tag = tagged_file.primary_tag().or_else(|| tagged_file.first_tag());

    let (title, artists, album, lyric, cover_data_url) = if let Some(tag) = tag {
        let title = tag.title().map(|s| s.to_string()).unwrap_or_default();
        let artist = tag.artist().map(|s| s.to_string()).unwrap_or_default();
        let album = tag.album().map(|s| s.to_string()).unwrap_or_default();
        let lyric = tag.get_string(&ItemKey::Lyrics).map(|s| s.to_string());
        let cover = tag.pictures().first().map(|pic| {
            let mime = match pic.mime_type() {
                Some(lofty::picture::MimeType::Png) => "image/png",
                Some(lofty::picture::MimeType::Bmp) => "image/bmp",
                _ => "image/jpeg",
            };
            let b64 = base64::engine::general_purpose::STANDARD.encode(pic.data());
            format!("data:{};base64,{}", mime, b64)
        });
        (title, artist, album, lyric, cover)
    } else {
        (String::new(), String::new(), String::new(), None, None)
    };

    let name = if title.is_empty() {
        path.file_stem().and_then(|s| s.to_str()).unwrap_or("Unknown").to_string()
    } else {
        title
    };

    Some(LocalTrackMeta {
        file_path: path.to_string_lossy().to_string(),
        name,
        artists: if artists.is_empty() { "未知歌手".to_string() } else { artists },
        album: if album.is_empty() { "未知专辑".to_string() } else { album },
        duration,
        cover_data_url,
        lyric,
        mtime: file_mtime_ms(path),
    })
}

fn visit_audio(dir: &Path, out: &mut Vec<LocalTrackMeta>, max_depth: u32, depth: u32) -> std::io::Result<()> {
    if depth > max_depth {
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
            let _ = visit_audio(&path, out, max_depth, depth + 1);
        } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            if AUDIO_EXTENSIONS.contains(&ext.to_lowercase().as_str()) {
                if let Some(meta) = extract_audio_metadata(&path) {
                    out.push(meta);
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn scan_music_folder(dir: String, max_depth: Option<u32>) -> Result<Vec<LocalTrackMeta>, String> {
    let path = PathBuf::from(&dir);
    if !path.is_dir() {
        return Err(format!("path is not a directory: {dir}"));
    }
    let mut out = Vec::new();
    visit_audio(&path, &mut out, max_depth.unwrap_or(6), 0).map_err(|e| e.to_string())?;
    Ok(out)
}

/// 只遍历目录收集音频文件路径 + mtime(不读标签),用于增量扫描的快速 diff。
fn visit_audio_files(dir: &Path, out: &mut Vec<LocalFileEntry>, max_depth: u32, depth: u32) -> std::io::Result<()> {
    if depth > max_depth {
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
            let _ = visit_audio_files(&path, out, max_depth, depth + 1);
        } else if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            if AUDIO_EXTENSIONS.contains(&ext.to_lowercase().as_str()) {
                out.push(LocalFileEntry {
                    file_path: path.to_string_lossy().to_string(),
                    mtime: file_mtime_ms(&path),
                });
            }
        }
    }
    Ok(())
}

/// 列出目录下所有音频文件的路径 + mtime(不解析标签,很快)。前端拿来跟缓存 diff。
#[tauri::command]
fn list_music_files(dir: String, max_depth: Option<u32>) -> Result<Vec<LocalFileEntry>, String> {
    let path = PathBuf::from(&dir);
    if !path.is_dir() {
        return Err(format!("path is not a directory: {dir}"));
    }
    let mut out = Vec::new();
    visit_audio_files(&path, &mut out, max_depth.unwrap_or(6), 0).map_err(|e| e.to_string())?;
    Ok(out)
}

/// 解析指定的若干音频文件(增量扫描:只解析新增/变更的文件)。读不出标签的文件跳过。
#[tauri::command]
fn extract_music_metadata(paths: Vec<String>) -> Result<Vec<LocalTrackMeta>, String> {
    let mut out = Vec::with_capacity(paths.len());
    for p in &paths {
        let path = Path::new(p);
        if let Some(meta) = extract_audio_metadata(path) {
            out.push(meta);
        }
    }
    Ok(out)
}

/// 读取同名 .lrc 歌词(对齐 CyreneMusic read_lrc_file)。
#[tauri::command]
fn read_lrc_file(audio_path: String) -> Result<Option<String>, String> {
    let lrc = Path::new(&audio_path).with_extension("lrc");
    if lrc.exists() {
        std::fs::read_to_string(&lrc).map(Some).map_err(|e| e.to_string())
    } else {
        Ok(None)
    }
}

#[derive(Debug, Deserialize)]
pub struct VodDownloadRequest {
    pub task_id: String,
    pub url: String,
    pub stream_type: Option<String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    pub title: String,
    pub episode_title: String,
    pub download_dir: Option<String>,
    pub proxy_url: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct VodDownloadProgress {
    pub task_id: String,
    pub status: String,
    pub progress: f64,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub path: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct VodDownloadResult {
    pub path: String,
    pub bytes: u64,
    pub kind: String,
}

fn emit_vod_download_progress(
    app: &tauri::AppHandle,
    task_id: &str,
    status: &str,
    progress: f64,
    downloaded: u64,
    total: Option<u64>,
    path: Option<&Path>,
    message: Option<String>,
) {
    let payload = VodDownloadProgress {
        task_id: task_id.to_string(),
        status: status.to_string(),
        progress: progress.clamp(0.0, 100.0),
        downloaded,
        total,
        path: path.map(|p| p.to_string_lossy().to_string()),
        message,
    };
    let _ = app.emit("vod-download-progress", payload);
}

fn sanitize_file_component(value: &str, fallback: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
            out.push(' ');
        } else {
            out.push(ch);
        }
        if out.chars().count() >= 80 {
            break;
        }
    }
    let cleaned = out
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(|c| c == '.' || c == ' ')
        .to_string();
    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned
    }
}

fn unique_path(mut path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }
    let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("download")
        .to_string();
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string());
    for i in 2..10_000 {
        let name = match &ext {
            Some(ext) => format!("{stem} ({i}).{ext}"),
            None => format!("{stem} ({i})"),
        };
        path = parent.join(name);
        if !path.exists() {
            return path;
        }
    }
    path
}

fn vod_download_root(app: &tauri::AppHandle, custom_dir: Option<&str>) -> Result<PathBuf, String> {
    let root = if let Some(dir) = custom_dir.map(str::trim).filter(|s| !s.is_empty()) {
        PathBuf::from(dir)
    } else {
        let base = app
            .path()
            .download_dir()
            .or_else(|_| app.path().app_data_dir())
            .map_err(|e| format!("download dir: {e}"))?;
        base.join("DouyTV")
    };
    std::fs::create_dir_all(&root).map_err(|e| format!("create download dir: {e}"))?;
    Ok(root)
}

fn download_pause_set() -> &'static RwLock<HashSet<String>> {
    static PAUSED: OnceLock<RwLock<HashSet<String>>> = OnceLock::new();
    PAUSED.get_or_init(|| RwLock::new(HashSet::new()))
}

fn is_download_paused(task_id: &str) -> bool {
    download_pause_set()
        .read()
        .map(|set| set.contains(task_id))
        .unwrap_or(false)
}

#[tauri::command]
fn vod_set_download_paused(task_id: String, paused: bool) -> Result<(), String> {
    let mut set = download_pause_set()
        .write()
        .map_err(|_| "download pause set poisoned".to_string())?;
    if paused {
        set.insert(task_id);
    } else {
        set.remove(&task_id);
    }
    Ok(())
}

#[tauri::command]
fn open_vod_download_path(path: String, reveal: Option<bool>) -> Result<(), String> {
    let input = PathBuf::from(path);
    let target = if reveal.unwrap_or(false) {
        if input.is_dir() {
            input
        } else {
            input
                .parent()
                .map(Path::to_path_buf)
                .ok_or_else(|| "download path has no parent".to_string())?
        }
    } else {
        input
    };

    if !target.exists() {
        return Err(format!("download path does not exist: {}", target.display()));
    }

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut c = std::process::Command::new("explorer");
        c.arg(&target);
        c
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut c = std::process::Command::new("open");
        c.arg(&target);
        c
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut c = std::process::Command::new("xdg-open");
        c.arg(&target);
        c
    };

    command
        .spawn()
        .map_err(|e| format!("open download path: {e}"))?;
    Ok(())
}

fn header_value<'a>(headers: &'a HashMap<String, String>, key: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(key))
        .map(|(_, v)| v.as_str())
}

#[derive(Debug, Deserialize)]
pub struct MusicDownloadRequest {
    pub task_id: String,
    pub url: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    pub title: String,
    pub artist: String,
    pub download_dir: Option<String>,
    pub proxy_url: Option<String>,
}

/// 音乐下载根目录：自定义 > 系统音频目录/DouyTV > 下载目录/DouyTV。
fn music_download_root(app: &tauri::AppHandle, custom_dir: Option<&str>) -> Result<PathBuf, String> {
    let root = if let Some(dir) = custom_dir.map(str::trim).filter(|s| !s.is_empty()) {
        PathBuf::from(dir)
    } else {
        let base = app
            .path()
            .audio_dir()
            .or_else(|_| app.path().download_dir())
            .or_else(|_| app.path().app_data_dir())
            .map_err(|e| format!("resolve audio dir: {e}"))?;
        base.join("DouyTV")
    };
    std::fs::create_dir_all(&root).map_err(|e| format!("create music dir: {e}"))?;
    Ok(root)
}

/// 从 URL / content-type 推断音频扩展名，默认 mp3。
fn music_extension(url: &str, content_type: Option<&str>) -> String {
    if let Some(ct) = content_type {
        let ct = ct.to_lowercase();
        if ct.contains("flac") {
            return "flac".to_string();
        }
        if ct.contains("mp4") || ct.contains("m4a") || ct.contains("aac") {
            return "m4a".to_string();
        }
        if ct.contains("wav") {
            return "wav".to_string();
        }
        if ct.contains("ogg") {
            return "ogg".to_string();
        }
        if ct.contains("mpeg") || ct.contains("mp3") {
            return "mp3".to_string();
        }
    }
    match ext_from_url(url).as_deref() {
        Some(e @ ("flac" | "m4a" | "wav" | "ogg" | "aac" | "mp3")) => e.to_string(),
        _ => "mp3".to_string(),
    }
}

/// 下载单首音乐到本地（带 Referer/UA、进度事件、暂停支持）。
#[tauri::command]
async fn music_download(
    app: tauri::AppHandle,
    req: MusicDownloadRequest,
) -> Result<VodDownloadResult, String> {
    let client = match download_client(req.proxy_url.as_deref()) {
        Ok(c) => c,
        Err(e) => {
            emit_vod_download_progress(&app, &req.task_id, "error", 0.0, 0, None, None, Some(e.clone()));
            return Err(e);
        }
    };

    let run = async {
        let root = music_download_root(&app, req.download_dir.as_deref())?;
        let artist = sanitize_file_component(&req.artist, "未知歌手");
        let title = sanitize_file_component(&req.title, "未知歌曲");

        let head_resp = apply_download_headers(client.head(&req.url), &req.url, &req.headers)
            .send()
            .await
            .ok();
        let content_type = head_resp
            .as_ref()
            .and_then(|r| r.headers().get("content-type"))
            .and_then(|v| v.to_str().ok());
        let ext = music_extension(&req.url, content_type);
        let path = unique_path(root.join(format!("{artist} - {title}.{ext}")));

        emit_vod_download_progress(&app, &req.task_id, "downloading", 0.0, 0, None, Some(&path), None);
        let bytes = download_url_to_file(
            &app,
            &req.task_id,
            &client,
            &req.url,
            &req.headers,
            &path,
            0.0,
            100.0,
            0,
        )
        .await?;
        Ok::<VodDownloadResult, String>(VodDownloadResult {
            path: path.to_string_lossy().to_string(),
            bytes,
            kind: "file".to_string(),
        })
    };

    match run.await {
        Ok(result) => {
            emit_vod_download_progress(
                &app,
                &req.task_id,
                "done",
                100.0,
                result.bytes,
                Some(result.bytes),
                Some(Path::new(&result.path)),
                None,
            );
            Ok(result)
        }
        Err(e) => {
            let status = if e == "DOWNLOAD_PAUSED" { "paused" } else { "error" };
            emit_vod_download_progress(&app, &req.task_id, status, 0.0, 0, None, None, Some(e.clone()));
            Err(e)
        }
    }
}


fn download_client(proxy: Option<&str>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(10));
    if let Some(proxy) = proxy.filter(|s| !s.trim().is_empty()) {
        builder = builder.proxy(reqwest::Proxy::all(proxy).map_err(|e| format!("proxy: {e}"))?);
    }
    builder.build().map_err(|e| format!("download client: {e}"))
}

fn apply_download_headers(
    mut req: reqwest::RequestBuilder,
    url: &str,
    headers: &HashMap<String, String>,
) -> reqwest::RequestBuilder {
    let has_ua = header_value(headers, "User-Agent").is_some();
    let has_referer = header_value(headers, "Referer").is_some();
    let merged_cookie = merge_cookie_header(url, headers);
    for (k, v) in headers {
        if k.eq_ignore_ascii_case("cookie") && merged_cookie.is_some() {
            continue;
        }
        req = req.header(k.as_str(), v.as_str());
    }
    if !has_ua {
        req = req.header("User-Agent", DEFAULT_UA);
    }
    if !has_referer {
        req = req.header("Referer", "https://movie.douban.com/");
    }
    if let Some(cookie) = merged_cookie {
        req = req.header("Cookie", cookie);
    }
    req
}

fn ext_from_url(url: &str) -> Option<String> {
    Url::parse(url)
        .ok()
        .and_then(|u| {
            Path::new(u.path())
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase())
        })
        .filter(|e| e.len() <= 8 && e.chars().all(|c| c.is_ascii_alphanumeric()))
}

fn direct_extension(url: &str, stream_type: Option<&str>, content_type: Option<&str>) -> String {
    if let Some(kind) = stream_type {
        match kind {
            "mp4" => return "mp4".to_string(),
            "flv" => return "flv".to_string(),
            "dash" => return "mpd".to_string(),
            _ => {}
        }
    }
    if let Some(ext) = ext_from_url(url) {
        if ext != "m3u8" && ext != "m3u" {
            return ext;
        }
    }
    let ct = content_type.unwrap_or("").to_lowercase();
    if ct.contains("webm") {
        "webm".to_string()
    } else if ct.contains("matroska") {
        "mkv".to_string()
    } else if ct.contains("mpeg") || ct.contains("mp2t") {
        "ts".to_string()
    } else {
        "mp4".to_string()
    }
}

fn looks_like_hls(url: &str, stream_type: Option<&str>) -> bool {
    if stream_type == Some("hls") {
        return true;
    }
    let lower = url.to_lowercase();
    lower.contains(".m3u8") || lower.ends_with(".m3u") || lower.contains(".m3u?")
}

async fn fetch_text_for_download(
    client: &reqwest::Client,
    url: &str,
    headers: &HashMap<String, String>,
) -> Result<String, String> {
    let resp = apply_download_headers(client.get(url), url, headers)
        .send()
        .await
        .map_err(|e| format!("fetch playlist: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("playlist HTTP {}", status.as_u16()));
    }
    resp.text()
        .await
        .map_err(|e| format!("read playlist: {e}"))
}

async fn download_url_to_file(
    app: &tauri::AppHandle,
    task_id: &str,
    client: &reqwest::Client,
    url: &str,
    headers: &HashMap<String, String>,
    path: &Path,
    base_progress: f64,
    progress_span: f64,
    downloaded_base: u64,
) -> Result<u64, String> {
    let resp = apply_download_headers(client.get(url), url, headers)
        .send()
        .await
        .map_err(|e| format!("download request: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("download HTTP {}: {url}", status.as_u16()));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create dir: {e}"))?;
    }
    let total = resp.content_length();
    let mut file = std::fs::File::create(path).map_err(|e| format!("create file: {e}"))?;
    let mut stream = resp.bytes_stream();
    let mut downloaded = 0u64;
    let mut last_emit = Instant::now();
    while let Some(chunk) = stream.next().await {
        if is_download_paused(task_id) {
            return Err("DOWNLOAD_PAUSED".to_string());
        }
        let chunk = chunk.map_err(|e| format!("read stream: {e}"))?;
        file.write_all(&chunk)
            .map_err(|e| format!("write file: {e}"))?;
        downloaded += chunk.len() as u64;
        if last_emit.elapsed() >= Duration::from_millis(250) {
            let inner = total
                .map(|t| if t > 0 { downloaded as f64 / t as f64 } else { 0.0 })
                .unwrap_or(0.0);
            emit_vod_download_progress(
                app,
                task_id,
                "downloading",
                base_progress + progress_span * inner,
                downloaded_base + downloaded,
                total.map(|t| downloaded_base + t),
                Some(path),
                None,
            );
            last_emit = Instant::now();
        }
    }
    file.flush().map_err(|e| format!("flush file: {e}"))?;
    Ok(downloaded)
}

async fn append_url_to_file(
    app: &tauri::AppHandle,
    task_id: &str,
    client: &reqwest::Client,
    url: &str,
    headers: &HashMap<String, String>,
    range: Option<(u64, u64)>,
    file: &mut std::fs::File,
    base_progress: f64,
    progress_span: f64,
    downloaded_base: u64,
    output_path: &Path,
) -> Result<u64, String> {
    let mut req = apply_download_headers(client.get(url), url, headers);
    if let Some((start, end)) = range {
        req = req.header("Range", format!("bytes={start}-{end}"));
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("download request: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("download HTTP {}: {url}", status.as_u16()));
    }
    if range.is_some() && status.as_u16() != 206 {
        return Err(format!(
            "download HTTP {} ignored HLS byte range: {url}",
            status.as_u16()
        ));
    }
    let total = resp.content_length();
    let mut stream = resp.bytes_stream();
    let mut downloaded = 0u64;
    let mut last_emit = Instant::now();
    while let Some(chunk) = stream.next().await {
        if is_download_paused(task_id) {
            return Err("DOWNLOAD_PAUSED".to_string());
        }
        let chunk = chunk.map_err(|e| format!("read stream: {e}"))?;
        file.write_all(&chunk)
            .map_err(|e| format!("append file: {e}"))?;
        downloaded += chunk.len() as u64;
        if last_emit.elapsed() >= Duration::from_millis(250) {
            let inner = total
                .map(|t| if t > 0 { downloaded as f64 / t as f64 } else { 0.0 })
                .unwrap_or(0.0);
            emit_vod_download_progress(
                app,
                task_id,
                "downloading",
                base_progress + progress_span * inner,
                downloaded_base + downloaded,
                None,
                Some(output_path),
                None,
            );
            last_emit = Instant::now();
        }
    }
    Ok(downloaded)
}

async fn download_url_to_mp4_muxer(
    app: &tauri::AppHandle,
    task_id: &str,
    client: &reqwest::Client,
    url: &str,
    headers: &HashMap<String, String>,
    range: Option<(u64, u64)>,
    muxer: &mut ts_mp4::TsMp4Muxer,
    base_progress: f64,
    progress_span: f64,
    downloaded_base: u64,
    output_path: &Path,
) -> Result<u64, String> {
    let mut req = apply_download_headers(client.get(url), url, headers);
    if let Some((start, end)) = range {
        req = req.header("Range", format!("bytes={start}-{end}"));
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("download request: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("download HTTP {}: {url}", status.as_u16()));
    }
    if range.is_some() && status.as_u16() != 206 {
        return Err(format!(
            "download HTTP {} ignored HLS byte range: {url}",
            status.as_u16()
        ));
    }
    let total = resp.content_length();
    let mut stream = resp.bytes_stream();
    let mut buf = Vec::new();
    let mut downloaded = 0u64;
    let mut last_emit = Instant::now();
    while let Some(chunk) = stream.next().await {
        if is_download_paused(task_id) {
            return Err("DOWNLOAD_PAUSED".to_string());
        }
        let chunk = chunk.map_err(|e| format!("read stream: {e}"))?;
        downloaded += chunk.len() as u64;
        buf.extend_from_slice(&chunk);
        if last_emit.elapsed() >= Duration::from_millis(250) {
            let inner = total
                .map(|t| if t > 0 { downloaded as f64 / t as f64 } else { 0.0 })
                .unwrap_or(0.0);
            emit_vod_download_progress(
                app,
                task_id,
                "downloading",
                base_progress + progress_span * inner,
                downloaded_base + downloaded,
                None,
                Some(output_path),
                None,
            );
            last_emit = Instant::now();
        }
    }
    muxer.push_ts(&buf)?;
    Ok(downloaded)
}

fn absolutize_hls_url(base_url: &str, maybe_relative: &str) -> String {
    if maybe_relative.starts_with("http://") || maybe_relative.starts_with("https://") {
        maybe_relative.to_string()
    } else if maybe_relative.starts_with("//") {
        Url::parse(base_url)
            .map(|base| format!("{}:{}", base.scheme(), maybe_relative))
            .unwrap_or_else(|_| maybe_relative.to_string())
    } else {
        Url::parse(base_url)
            .ok()
            .and_then(|base| base.join(maybe_relative).ok())
            .map(|u| u.to_string())
            .unwrap_or_else(|| maybe_relative.to_string())
    }
}

fn extract_attr_uri(line: &str) -> Option<String> {
    extract_hls_attr(line, "URI")
}

fn extract_hls_attr(line: &str, key: &str) -> Option<String> {
    let attrs = line.split_once(':')?.1;
    let bytes = attrs.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        while i < bytes.len() && (bytes[i] == b',' || bytes[i].is_ascii_whitespace()) {
            i += 1;
        }
        let key_start = i;
        while i < bytes.len() && bytes[i] != b'=' && bytes[i] != b',' {
            i += 1;
        }
        let attr_key = attrs[key_start..i].trim();
        if i >= bytes.len() || bytes[i] != b'=' {
            while i < bytes.len() && bytes[i] != b',' {
                i += 1;
            }
            continue;
        }
        i += 1;

        let value = if i < bytes.len() && bytes[i] == b'"' {
            i += 1;
            let value_start = i;
            while i < bytes.len() && bytes[i] != b'"' {
                i += 1;
            }
            let out = attrs[value_start..i].to_string();
            if i < bytes.len() {
                i += 1;
            }
            out
        } else {
            let value_start = i;
            while i < bytes.len() && bytes[i] != b',' {
                i += 1;
            }
            attrs[value_start..i].trim().to_string()
        };

        if attr_key.eq_ignore_ascii_case(key) {
            return Some(value);
        }
    }
    None
}

fn parse_hls_byterange_value(
    value: &str,
    next_offset: &mut Option<u64>,
) -> Result<(u64, u64), String> {
    let value = value.trim().trim_matches('"');
    let (len_text, offset_text) = value
        .split_once('@')
        .map(|(len, offset)| (len.trim(), Some(offset.trim())))
        .unwrap_or_else(|| (value.trim(), None));
    let len = len_text
        .parse::<u64>()
        .map_err(|_| format!("invalid HLS BYTERANGE length: {value}"))?;
    if len == 0 {
        return Err("invalid HLS BYTERANGE length: 0".to_string());
    }
    let start = match offset_text.filter(|s| !s.is_empty()) {
        Some(offset) => offset
            .parse::<u64>()
            .map_err(|_| format!("invalid HLS BYTERANGE offset: {value}"))?,
        None => next_offset.unwrap_or(0),
    };
    let end = start
        .checked_add(len)
        .and_then(|v| v.checked_sub(1))
        .ok_or_else(|| format!("invalid HLS BYTERANGE overflow: {value}"))?;
    let next = end
        .checked_add(1)
        .ok_or_else(|| format!("invalid HLS BYTERANGE overflow: {value}"))?;
    *next_offset = Some(next);
    Ok((start, end))
}

fn parse_bandwidth(line: &str) -> u64 {
    let Some(start) = line.find("BANDWIDTH=") else {
        return 0;
    };
    let rest = &line[start + "BANDWIDTH=".len()..];
    rest.chars()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>()
        .parse()
        .unwrap_or(0)
}

fn pick_hls_variant(master: &str, base_url: &str) -> Option<String> {
    let mut pending_bandwidth: Option<u64> = None;
    let mut best: Option<(u64, String)> = None;
    for line in master.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("#EXT-X-STREAM-INF") {
            pending_bandwidth = Some(parse_bandwidth(trimmed));
            continue;
        }
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some(bw) = pending_bandwidth.take() {
            let abs = absolutize_hls_url(base_url, trimmed);
            if best.as_ref().map(|(best_bw, _)| bw > *best_bw).unwrap_or(true) {
                best = Some((bw, abs));
            }
        }
    }
    best.map(|(_, url)| url)
}

async fn download_direct_media(
    app: &tauri::AppHandle,
    req: &VodDownloadRequest,
    client: &reqwest::Client,
) -> Result<VodDownloadResult, String> {
    let root = vod_download_root(app, req.download_dir.as_deref())?;
    let title = sanitize_file_component(&req.title, "视频");
    let episode = sanitize_file_component(&req.episode_title, "正片");
    let folder = root.join(&title);
    std::fs::create_dir_all(&folder).map_err(|e| format!("create title dir: {e}"))?;

    let head_resp = apply_download_headers(client.head(&req.url), &req.url, &req.headers)
        .send()
        .await
        .ok();
    let content_type = head_resp
        .as_ref()
        .and_then(|r| r.headers().get("content-type"))
        .and_then(|v| v.to_str().ok());
    let ext = direct_extension(
        &req.url,
        req.stream_type.as_deref(),
        content_type,
    );
    if ext == "ts" {
        let path = unique_path(folder.join(format!("{episode}.mp4")));
        emit_vod_download_progress(
            app,
            &req.task_id,
            "downloading",
            1.0,
            0,
            None,
            Some(&path),
            Some("下载并封装 MPEG-TS".to_string()),
        );
        let mut muxer = ts_mp4::TsMp4Muxer::create(&path)?;
        let downloaded = download_url_to_mp4_muxer(
            app,
            &req.task_id,
            client,
            &req.url,
            &req.headers,
            None,
            &mut muxer,
            1.0,
            97.0,
            0,
            &path,
        )
        .await?;
        emit_vod_download_progress(
            app,
            &req.task_id,
            "downloading",
            99.0,
            downloaded,
            None,
            Some(&path),
            Some("封装 MP4".to_string()),
        );
        let bytes = muxer.finish().map_err(|e| {
            let _ = std::fs::remove_file(&path);
            e
        })?;
        return Ok(VodDownloadResult {
            path: path.to_string_lossy().to_string(),
            bytes,
            kind: "file".to_string(),
        });
    }
    let path = unique_path(folder.join(format!("{episode}.{ext}")));
    emit_vod_download_progress(
        app,
        &req.task_id,
        "downloading",
        1.0,
        0,
        None,
        Some(&path),
        Some("开始下载".to_string()),
    );
    let bytes = download_url_to_file(
        app,
        &req.task_id,
        client,
        &req.url,
        &req.headers,
        &path,
        1.0,
        98.0,
        0,
    )
    .await?;
    Ok(VodDownloadResult {
        path: path.to_string_lossy().to_string(),
        bytes,
        kind: "file".to_string(),
    })
}

async fn download_hls_media(
    app: &tauri::AppHandle,
    req: &VodDownloadRequest,
    client: &reqwest::Client,
) -> Result<VodDownloadResult, String> {
    let root = vod_download_root(app, req.download_dir.as_deref())?;
    let title = sanitize_file_component(&req.title, "视频");
    let episode = sanitize_file_component(&req.episode_title, "正片");
    let folder = root.join(&title);
    std::fs::create_dir_all(&folder).map_err(|e| format!("create title dir: {e}"))?;

    emit_vod_download_progress(
        app,
        &req.task_id,
        "downloading",
        1.0,
        0,
        None,
        Some(&folder),
        Some("读取 HLS 播放列表".to_string()),
    );

    let master = fetch_text_for_download(client, &req.url, &req.headers).await?;
    let (playlist_url, playlist_text) = if master.contains("#EXT-X-STREAM-INF") {
        let variant = pick_hls_variant(&master, &req.url)
            .ok_or_else(|| "HLS master playlist has no playable variant".to_string())?;
        let text = fetch_text_for_download(client, &variant, &req.headers).await?;
        (variant, text)
    } else {
        (req.url.clone(), master)
    };

    if playlist_text
        .lines()
        .any(|line| line.trim().starts_with("#EXT-X-KEY"))
    {
        return Err("该 HLS 使用加密分片，当前下载器不能合并为完整视频文件。".to_string());
    }

    let resource_count = playlist_text
        .lines()
        .filter(|line| {
            let trimmed = line.trim();
            !trimmed.is_empty() && (!trimmed.starts_with('#') || trimmed.starts_with("#EXT-X-MAP"))
        })
        .count()
        .max(1);

    let has_init_map = playlist_text
        .lines()
        .any(|line| line.trim().starts_with("#EXT-X-MAP"));
    if !has_init_map {
        let final_path = unique_path(folder.join(format!("{episode}.mp4")));
        let mut muxer = ts_mp4::TsMp4Muxer::create(&final_path)?;
        let mut downloaded_total = 0u64;
        let mut done_count = 0usize;
        let mut pending_range: Option<(u64, u64)> = None;
        let mut next_byterange_offset: Option<u64> = None;
        for line in playlist_text.lines() {
            let trimmed = line.trim();
            if let Some(value) = trimmed.strip_prefix("#EXT-X-BYTERANGE:") {
                pending_range =
                    Some(parse_hls_byterange_value(value, &mut next_byterange_offset)?);
                continue;
            }
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            let abs = absolutize_hls_url(&playlist_url, trimmed);
            let span = 97.0 / resource_count as f64;
            let range = pending_range.take();
            if range.is_none() {
                next_byterange_offset = None;
            }
            downloaded_total += download_url_to_mp4_muxer(
                app,
                &req.task_id,
                client,
                &abs,
                &req.headers,
                range,
                &mut muxer,
                1.0 + done_count as f64 * span,
                span,
                downloaded_total,
                &final_path,
            )
            .await?;
            done_count += 1;
        }
        emit_vod_download_progress(
            app,
            &req.task_id,
            "downloading",
            99.0,
            downloaded_total,
            None,
            Some(&final_path),
            Some("封装 MP4".to_string()),
        );
        let media_bytes = muxer.finish().map_err(|e| {
            let _ = std::fs::remove_file(&final_path);
            e
        })?;
        return Ok(VodDownloadResult {
            path: final_path.to_string_lossy().to_string(),
            bytes: media_bytes,
            kind: "file".to_string(),
        });
    }

    let final_path = unique_path(folder.join(format!("{episode}.mp4")));
    let output_path = final_path.clone();
    let mut output =
        std::fs::File::create(&output_path).map_err(|e| format!("create output file: {e}"))?;

    let mut downloaded_total = 0u64;
    let mut done_count = 0usize;
    let mut downloaded_maps: HashMap<String, bool> = HashMap::new();
    let mut pending_range: Option<(u64, u64)> = None;
    let mut next_byterange_offset: Option<u64> = None;

    for line in playlist_text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("#EXT-X-MAP") {
            if let Some(uri) = extract_attr_uri(line) {
                let abs = absolutize_hls_url(&playlist_url, &uri);
                let mut map_next_offset = None;
                let map_range = extract_hls_attr(line, "BYTERANGE")
                    .map(|value| parse_hls_byterange_value(&value, &mut map_next_offset))
                    .transpose()?;
                let map_key = match map_range {
                    Some((start, end)) => format!("{abs}#{start}-{end}"),
                    None => abs.clone(),
                };
                if !downloaded_maps.contains_key(&map_key) {
                    let span = 98.0 / resource_count as f64;
                    downloaded_total += append_url_to_file(
                        app,
                        &req.task_id,
                        client,
                        &abs,
                        &req.headers,
                        map_range,
                        &mut output,
                        1.0 + done_count as f64 * span,
                        span,
                        downloaded_total,
                        &output_path,
                    )
                    .await?;
                    done_count += 1;
                    downloaded_maps.insert(map_key, true);
                }
            }
            continue;
        }

        if let Some(value) = trimmed.strip_prefix("#EXT-X-BYTERANGE:") {
            pending_range = Some(parse_hls_byterange_value(value, &mut next_byterange_offset)?);
            continue;
        }

        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let abs = absolutize_hls_url(&playlist_url, trimmed);
        let span = 98.0 / resource_count as f64;
        let range = pending_range.take();
        if range.is_none() {
            next_byterange_offset = None;
        }
        downloaded_total += append_url_to_file(
            app,
            &req.task_id,
            client,
            &abs,
            &req.headers,
            range,
            &mut output,
            1.0 + done_count as f64 * span,
            span,
            downloaded_total,
            &output_path,
        )
        .await?;
        done_count += 1;
    }

    output.flush().map_err(|e| format!("flush output: {e}"))?;
    drop(output);

    Ok(VodDownloadResult {
        path: final_path.to_string_lossy().to_string(),
        bytes: downloaded_total,
        kind: "file".to_string(),
    })
}

#[tauri::command]
async fn vod_download_media(
    app: tauri::AppHandle,
    req: VodDownloadRequest,
) -> Result<VodDownloadResult, String> {
    let client = match download_client(req.proxy_url.as_deref()) {
        Ok(c) => c,
        Err(e) => {
            emit_vod_download_progress(&app, &req.task_id, "error", 0.0, 0, None, None, Some(e.clone()));
            return Err(e);
        }
    };

    let result = if looks_like_hls(&req.url, req.stream_type.as_deref()) {
        download_hls_media(&app, &req, &client).await
    } else {
        download_direct_media(&app, &req, &client).await
    };

    match result {
        Ok(result) => {
            emit_vod_download_progress(
                &app,
                &req.task_id,
                "done",
                100.0,
                result.bytes,
                Some(result.bytes),
                Some(Path::new(&result.path)),
                Some("下载完成".to_string()),
            );
            Ok(result)
        }
        Err(e) => {
            if e == "DOWNLOAD_PAUSED" {
                emit_vod_download_progress(
                    &app,
                    &req.task_id,
                    "paused",
                    0.0,
                    0,
                    None,
                    None,
                    Some("已暂停".to_string()),
                );
                return Err(e);
            }
            emit_vod_download_progress(
                &app,
                &req.task_id,
                "error",
                0.0,
                0,
                None,
                None,
                Some(e.clone()),
            );
            Err(e)
        }
    }
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
    cenc_key_hex: Option<&str>,
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
    if let Some(k) = cenc_key_hex {
        s.push_str(&format!("&cenc_key={}", k));
    }
    s
}

/// iOS CENC 解密:从 m3u8 文本提取 #EXT-X-KEY URI,拉取 key bytes,返回 hex 编码。
/// 失败时返回 None(segment 将不解密,可能花屏但不会崩)。
fn extract_and_fetch_cenc_key(
    m3u8_text: &str,
    base_url: &str,
    ua: Option<&str>,
    referer: Option<&str>,
    proxy: Option<&str>,
) -> Option<String> {
    // 找 #EXT-X-KEY:...URI="..."
    let key_line = m3u8_text.lines().find(|l| l.trim().starts_with("#EXT-X-KEY:"))?;
    let uri_start = key_line.find("URI=\"")?;
    let after = &key_line[uri_start + 5..];
    let uri_end = after.find('"')?;
    let key_uri_raw = &after[..uri_end];

    // 解析为绝对 URL
    let key_url = if key_uri_raw.starts_with("http://") || key_uri_raw.starts_with("https://") {
        key_uri_raw.to_string()
    } else if let Ok(base) = url::Url::parse(base_url) {
        base.join(key_uri_raw).map(|u| u.to_string()).unwrap_or_else(|_| key_uri_raw.to_string())
    } else {
        key_uri_raw.to_string()
    };

    eprintln!("[cenc_decrypt] fetching key from: {}", key_url.split('?').next().unwrap_or(&key_url));

    // 拉 key bytes(同步,在 spawn_blocking 内)
    let key_bytes = match proxy_fetch(&key_url, ua, referer, proxy, None) {
        Ok(r) if r.status == 200 && r.bytes.len() >= 16 => r.bytes,
        Ok(r) => {
            eprintln!("[cenc_decrypt] key fetch failed: status={} len={}", r.status, r.bytes.len());
            return None;
        }
        Err(e) => {
            eprintln!("[cenc_decrypt] key fetch error: {e}");
            return None;
        }
    };

    let hex: String = key_bytes[..16].iter().map(|b| format!("{:02x}", b)).collect();
    eprintln!("[cenc_decrypt] got key: {hex}");
    Some(hex)
}

/// iOS CENC segment 解密:解析 fMP4 box 结构,用 sample_aes_proxy 的 CENC AES-CTR 逻辑解密。
/// 失败时返回原始 bytes(花屏好过崩溃)。
fn decrypt_cenc_segment(raw: &[u8], key_hex: &str) -> Vec<u8> {
    use crate::sample_aes_proxy::StreamDecryptor;

    if key_hex.len() != 32 {
        eprintln!("[cenc_decrypt] invalid key_hex len={}", key_hex.len());
        return raw.to_vec();
    }
    let mut key = [0u8; 16];
    for i in 0..16 {
        key[i] = match u8::from_str_radix(&key_hex[i * 2..i * 2 + 2], 16) {
            Ok(b) => b,
            Err(_) => {
                eprintln!("[cenc_decrypt] invalid key_hex");
                return raw.to_vec();
            }
        };
    }

    // 用 StreamDecryptor 处理整个 segment(它内部会解析 ftyp/moov/moof/mdat)
    let mut decryptor = StreamDecryptor::new(key, [0u8; 16]);
    match decryptor.feed(bytes::Bytes::from(raw.to_vec())) {
        Ok(chunks) => {
            let total: usize = chunks.iter().map(|c| c.len()).sum();
            let mut out = Vec::with_capacity(total);
            for c in chunks {
                out.extend_from_slice(&c);
            }
            eprintln!("[cenc_decrypt] segment decrypted: {} → {} bytes", raw.len(), out.len());
            out
        }
        Err(e) => {
            eprintln!("[cenc_decrypt] segment decrypt failed: {e}");
            raw.to_vec()
        }
    }
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
    cenc_key_hex: Option<&str>,
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
            // iOS CENC 解密模式:跳过 #EXT-X-KEY 行(segment 由 proxy 端解密后返回明文)
            if cenc_key_hex.is_some() && trimmed.starts_with("#EXT-X-KEY:") {
                continue;
            }
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
                        if sub_path == "segment" { cenc_key_hex } else { None },
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
            if !is_m3u8 { cenc_key_hex } else { None },
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
    force: Option<bool>,
) -> Result<bool, String> {
    use std::sync::{Arc, Mutex};
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
    use tokio::sync::oneshot;

    eprintln!(
        "[cf-challenge] command invoked, url={url}, ua={:?}, proxy={:?}, force={:?}",
        ua.as_deref().map(|s| &s[..s.len().min(40)]),
        proxy_url,
        force
    );

    let parsed_url = Url::parse(&url).map_err(|e| format!("bad url: {e}"))?;
    let host = parsed_url.host_str().unwrap_or("").to_lowercase();
    if host.is_empty() {
        return Err("url has no host".into());
    }

    // force=true 时清除旧的 cf_clearance（调用方已确认现有 cookie 无效）
    if force.unwrap_or(false) {
        cf_cookies::clear_clearance_for_host(&host);
        eprintln!("[cf-challenge] force=true, cleared stale cf_clearance for {host}");
    } else {
        // 非 force 模式：如果 jar 里已经有 cf_clearance,说明上一次验证刚刚成功 —— 直接返 true,
        // 避免被同一波并发请求二次触发弹窗
        if cf_cookies::get_cookie_header_for_url(&url)
            .map(|s| s.contains("cf_clearance="))
            .unwrap_or(false)
        {
            eprintln!("[cf-challenge] jar already has cf_clearance for {host}, skipping window");
            return Ok(true);
        }
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
    force: Option<bool>,
) -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        let _ = (app, url, ua, force);
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

        if force.unwrap_or(false) {
            cf_cookies::clear_clearance_for_host(&host);
        } else if cf_cookies::get_cookie_header_for_url(&url)
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

/// 打开/关闭桌面歌词独立窗口：无边框、置顶、透明背景，加载内部路由 /music/desktop-lyric。
/// 主窗口通过 `emit("desktop-lyric", payload)` 把当前歌词/进度推给它。
#[tauri::command]
async fn open_desktop_lyric(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let _ = app;
        return Ok(false);
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        use tauri::webview::Color;
        use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

        if let Some(win) = app.get_webview_window("desktop-lyric") {
            let _ = win.show();
            let _ = win.set_focus();
            return Ok(true);
        }

        let lyric_w = 820.0_f64;
        let lyric_h = 150.0_f64;
        let mut builder = WebviewWindowBuilder::new(
            &app,
            "desktop-lyric",
            WebviewUrl::App("index.html#/music/desktop-lyric".into()),
        )
        .title("桌面歌词")
        .inner_size(lyric_w, lyric_h)
        .min_inner_size(360.0, 80.0)
        .focused(false)
        .decorations(false)
        .transparent(true)
        .background_color(Color(0, 0, 0, 0))
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        .shadow(false);

        // 初始位置：屏幕中间偏下（底部留约 1/8 屏高的边距）。
        if let Some(main_win) = app.get_webview_window("main") {
            if let Ok(Some(monitor)) = main_win.current_monitor() {
                let scale = monitor.scale_factor();
                let size = monitor.size().to_logical::<f64>(scale);
                let pos = monitor.position().to_logical::<f64>(scale);
                let x = pos.x + (size.width - lyric_w) / 2.0;
                let y = pos.y + size.height - lyric_h - size.height / 8.0;
                builder = builder.position(x.max(pos.x), y.max(pos.y));
            }
        }

        let win = builder
            .build()
            .map_err(|e| format!("build desktop-lyric window failed: {e}"))?;
        let _ = win.show();
        Ok(true)
    }
}

/// 切换桌面歌词窗口的鼠标穿透（点击穿透到桌面）。锁定时穿透，解锁时可拖动。
#[tauri::command]
fn set_desktop_lyric_passthrough(app: tauri::AppHandle, ignore: bool) -> Result<(), String> {
    use tauri::Manager;
    if let Some(win) = app.get_webview_window("desktop-lyric") {
        win.set_ignore_cursor_events(ignore)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn close_desktop_lyric(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(win) = app.get_webview_window("desktop-lyric") {
        let _ = win.destroy();
    }
    Ok(())
}

#[tauri::command]
fn is_desktop_lyric_open(app: tauri::AppHandle) -> bool {
    use tauri::Manager;
    app.get_webview_window("desktop-lyric").is_some()
}

#[tauri::command]
fn push_desktop_lyric(app: tauri::AppHandle, payload: serde_json::Value) -> Result<(), String> {
    use tauri::Manager;
    if let Some(win) = app.get_webview_window("desktop-lyric") {
        win.emit("desktop-lyric", payload).map_err(|e| e.to_string())?;
    }
    Ok(())
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

/// 系统托盘（仅桌面端）。菜单项点击 → emit "tray-command"，前端音乐页监听后驱动播放；
/// 左键单击托盘图标切换主窗口显示/隐藏。命令字符串与桌面歌词 "desktop-lyric-command" 一致
/// （toggle/prev/next），前端可复用同一套处理。
#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn setup_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder};
    use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
    use tauri::Manager;

    let show = MenuItemBuilder::with_id("tray-show", "显示 / 隐藏窗口").build(app)?;
    let prev = MenuItemBuilder::with_id("tray-prev", "上一首").build(app)?;
    let toggle = MenuItemBuilder::with_id("tray-toggle", "播放 / 暂停").build(app)?;
    let next = MenuItemBuilder::with_id("tray-next", "下一首").build(app)?;
    let quit = MenuItemBuilder::with_id("tray-quit", "退出").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&show)
        .separator()
        .item(&prev)
        .item(&toggle)
        .item(&next)
        .separator()
        .item(&quit)
        .build()?;

    let toggle_main = |app: &tauri::AppHandle| {
        if let Some(win) = app.get_webview_window("main") {
            if win.is_visible().unwrap_or(true) {
                let _ = win.hide();
            } else {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }
    };

    let mut builder = TrayIconBuilder::with_id("douytv-tray")
        .tooltip("DouyTV")
        .menu(&menu)
        .show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "tray-show" => {
                if let Some(win) = app.get_webview_window("main") {
                    if win.is_visible().unwrap_or(true) {
                        let _ = win.hide();
                    } else {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
            }
            "tray-prev" => {
                let _ = app.emit("tray-command", "prev");
            }
            "tray-toggle" => {
                let _ = app.emit("tray-command", "toggle");
            }
            "tray-next" => {
                let _ = app.emit("tray-command", "next");
            }
            "tray-quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(move |tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
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
            description: "create local_tracks table for music library cache",
            sql: "
                CREATE TABLE IF NOT EXISTS local_tracks (
                    file_path TEXT PRIMARY KEY,
                    folder TEXT NOT NULL,
                    name TEXT NOT NULL,
                    artists TEXT NOT NULL,
                    album TEXT NOT NULL,
                    duration REAL NOT NULL DEFAULT 0,
                    cover_data_url TEXT,
                    lyric TEXT,
                    mtime INTEGER NOT NULL DEFAULT 0,
                    scanned_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_local_tracks_folder ON local_tracks(folder);
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
                // 系统托盘：菜单控制播放（命令经 "tray-command" 事件转给前端音乐页处理）。
                if let Err(e) = setup_tray(app.handle()) {
                    eprintln!("[tray] setup failed: {e}");
                }
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
                    // iOS CENC 解密模式:从 m3u8 提取 KEY URI → 拉 key bytes → hex 编码
                    // 传给 rewrite_m3u8,后者会 strip #EXT-X-KEY 并在 segment URL 注入 cenc_key
                    let cenc_decrypt = params
                        .get("cenc_decrypt")
                        .map(|v| v == "1" || v == "true")
                        .unwrap_or(false);
                    let cenc_key_hex: Option<String> = if cenc_decrypt {
                        extract_and_fetch_cenc_key(&text, target_url, ua, referer, proxy)
                    } else {
                        None
                    };
                    let rewritten = rewrite_m3u8(
                        &text,
                        target_url,
                        ua,
                        referer,
                        filter_ads,
                        proxy,
                        bypass_proxy,
                        cenc_key_hex.as_deref(),
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
                // iOS CENC 解密:segment URL 带 cenc_key 时,对 fMP4 segment 做 CENC AES-CTR 解密
                let bytes = if let Some(key_hex) = params.get("cenc_key") {
                    decrypt_cenc_segment(&bytes, key_hex)
                } else {
                    bytes
                };
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
            script_http_bytes,
            scan_local_videos,
            scan_music_folder,
            list_music_files,
            extract_music_metadata,
            read_lrc_file,
            vod_download_media,
            music_download,
            vod_set_download_paused,
            open_vod_download_path,
            read_system_proxy,
            get_stream_proxy_port,
            open_desktop_lyric,
            close_desktop_lyric,
            is_desktop_lyric_open,
            set_desktop_lyric_passthrough,
            push_desktop_lyric,
            open_cf_challenge,
            set_mouflon_keys,
            get_mouflon_keys,
            fc2_resolve_hls,
            fc2_diagnose,
            mfc_list_online,
            mfc_diagnose,
            music_unblock::music_unblock,
            netease::netease_request
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
