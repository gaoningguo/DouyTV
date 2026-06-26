//! 网易云灰曲解灰 —— 把 UnblockNeteaseMusic 的可前端化 provider 移植成 Rust,
//! 用 ureq 出网(绕 WebView CORS / UA 限制,走用户代理)。
//!
//! 移植范围(照 UNM src/provider/*):kuwo / kugou / migu / bodian / pyncmd。
//! youtube/yt-dlp 依赖本地二进制、bilibili 需登录 cookie + 回源代理,前端无法移植,略。
//!
//! 编排照 UNM match.js:对每个候选源「搜索关键词 → 按时长 ±5s 匹配 → 取直链」,
//! 按 sources 给定顺序尝试,返回首个拿到直链的结果。
//!
//! 调用方:前端 neteaseApi 在网易匿名直链为 null(灰曲)时通过 `music_unblock` 命令兜底。

use std::time::Duration;

use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};

const DEFAULT_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

#[derive(Debug, Deserialize)]
pub struct UnblockRequest {
    /// 网易云歌曲 id(pyncmd 直接用它打 GD 音乐台)。
    pub netease_id: String,
    pub name: String,
    pub artist: String,
    /// 期望时长(毫秒),用于在搜索结果里挑最接近的版本。
    pub duration_ms: Option<u64>,
    /// 启用的解灰源,按优先级排序(kuwo/kugou/migu/bodian/pyncmd)。
    pub sources: Vec<String>,
    pub proxy_url: Option<String>,
    /// 是否优先无损(对齐 UNM ENABLE_FLAC)。默认 false。
    pub enable_flac: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct UnblockResult {
    pub url: String,
    pub source: String,
}

/// 候选歌曲(各 provider 搜索结果归一)。
struct Candidate {
    id: String,
    duration_ms: Option<u64>,
    /// kugou 专用:album_id(取直链要带)。
    album_id: Option<String>,
}

fn md5_hex(input: &str) -> String {
    let mut hasher = Md5::new();
    hasher.update(input.as_bytes());
    let digest = hasher.finalize();
    let mut out = String::with_capacity(32);
    for b in digest.iter() {
        out.push_str(&format!("{:02x}", b));
    }
    out
}

fn build_agent(proxy: Option<&str>) -> ureq::Agent {
    let mut builder = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(15))
        .redirects(5);
    if let Some(p) = proxy.filter(|s| !s.trim().is_empty()) {
        if let Ok(prx) = ureq::Proxy::new(p) {
            builder = builder.proxy(prx);
        }
    }
    builder.build()
}

fn get_json(
    agent: &ureq::Agent,
    url: &str,
    headers: &[(&str, &str)],
) -> Result<serde_json::Value, String> {
    let mut req = agent.get(url).set("User-Agent", DEFAULT_UA);
    for (k, v) in headers {
        req = req.set(k, v);
    }
    let resp = req.call().map_err(|e| format!("{e}"))?;
    let text = resp.into_string().map_err(|e| format!("body: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("json: {e}"))
}

fn get_text(
    agent: &ureq::Agent,
    url: &str,
    headers: &[(&str, &str)],
) -> Result<String, String> {
    let mut req = agent.get(url).set("User-Agent", DEFAULT_UA);
    for (k, v) in headers {
        req = req.set(k, v);
    }
    let resp = req.call().map_err(|e| format!("{e}"))?;
    resp.into_string().map_err(|e| format!("body: {e}"))
}

/// 照 UNM select.js:前 5 条里找时长相差 5s 内的第一条;没有就取第一条。
fn select<'a>(list: &'a [Candidate], duration_ms: Option<u64>) -> Option<&'a Candidate> {
    if list.is_empty() {
        return None;
    }
    if let Some(want) = duration_ms {
        if want > 0 {
            if let Some(hit) = list.iter().take(5).find(|c| {
                c.duration_ms
                    .map(|d| (d as i64 - want as i64).abs() < 5000)
                    .unwrap_or(false)
            }) {
                return Some(hit);
            }
        }
    }
    list.first()
}

/// 匹配关键词:`歌名 歌手`(去掉 UNM 的 " - " 连接符与多歌手分隔,空格分隔)。
fn keyword_of(req: &UnblockRequest) -> String {
    let artist = req
        .artist
        .replace(['/', '&'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    format!("{} {}", req.name.trim(), artist).trim().to_string()
}

// ───────────────────────── 酷我 kuwo ─────────────────────────

fn kuwo_search(agent: &ureq::Agent, keyword: &str) -> Result<Vec<Candidate>, String> {
    let url = format!(
        "http://search.kuwo.cn/r.s?&correct=1&vipver=1&stype=comprehensive&encoding=utf8\
         &rformat=json&mobi=1&show_copyright_off=1&searchapi=6&all={}",
        urlencoding(keyword)
    );
    let json = get_json(agent, &url, &[])?;
    let abslist = json
        .get("content")
        .and_then(|c| c.get(1))
        .and_then(|m| m.get("musicpage"))
        .and_then(|m| m.get("abslist"))
        .and_then(|a| a.as_array())
        .ok_or_else(|| "kuwo: no result".to_string())?;
    let mut out = Vec::new();
    for item in abslist {
        let rid = item
            .get("MUSICRID")
            .and_then(|v| v.as_str())
            .and_then(|s| s.rsplit('_').next())
            .unwrap_or("")
            .to_string();
        if rid.is_empty() {
            continue;
        }
        let duration_ms = item
            .get("DURATION")
            .and_then(json_as_u64)
            .map(|s| s * 1000);
        out.push(Candidate { id: rid, duration_ms, album_id: None });
    }
    Ok(out)
}

fn kuwo_track(agent: &ureq::Agent, id: &str) -> Result<String, String> {
    // antiserver 免加密直链(mp3),UA 必须是 okhttp。
    let url = format!(
        "http://antiserver.kuwo.cn/anti.s?type=convert_url&format=mp3&response=url&rid=MUSIC_{id}"
    );
    let body = get_text(agent, &url, &[("User-Agent", "okhttp/3.10.0")])?;
    extract_http_url(&body).ok_or_else(|| "kuwo: no url".to_string())
}

// ───────────────────────── 酷狗 kugou ─────────────────────────

fn kugou_search(agent: &ureq::Agent, keyword: &str) -> Result<Vec<Candidate>, String> {
    let url = format!(
        "http://mobilecdn.kugou.com/api/v3/search/song?keyword={}&page=1&pagesize=10",
        urlencoding(keyword)
    );
    let json = get_json(agent, &url, &[])?;
    let info = json
        .get("data")
        .and_then(|d| d.get("info"))
        .and_then(|a| a.as_array())
        .ok_or_else(|| "kugou: no result".to_string())?;
    let mut out = Vec::new();
    for item in info {
        let hash = item.get("hash").and_then(|v| v.as_str()).unwrap_or("");
        if hash.is_empty() {
            continue;
        }
        let duration_ms = item.get("duration").and_then(json_as_u64).map(|s| s * 1000);
        let album_id = item
            .get("album_id")
            .map(json_to_string)
            .filter(|s| !s.is_empty());
        out.push(Candidate {
            id: hash.to_string(),
            duration_ms,
            album_id,
        });
    }
    Ok(out)
}

fn kugou_track(agent: &ureq::Agent, song: &Candidate) -> Result<String, String> {
    let key = md5_hex(&format!("{}kgcloudv2", song.id));
    let album_id = song.album_id.clone().unwrap_or_default();
    let url = format!(
        "http://trackercdn.kugou.com/i/v2/?key={key}&hash={}&appid=1005&pid=2&cmd=25&behavior=play&album_id={album_id}",
        song.id
    );
    let json = get_json(agent, &url, &[])?;
    json.get("url")
        .and_then(|u| u.as_array())
        .and_then(|a| a.first())
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| "kugou: no url".to_string())
}

// ───────────────────────── 咪咕 migu ─────────────────────────

const MIGU_HEADERS: &[(&str, &str)] = &[
    ("origin", "http://music.migu.cn/"),
    ("referer", "http://m.music.migu.cn/v3/"),
    ("channel", "0146921"),
];

fn migu_search(agent: &ureq::Agent, keyword: &str) -> Result<Vec<Candidate>, String> {
    let url = format!(
        "https://m.music.migu.cn/migu/remoting/scr_search_tag?keyword={}&type=2&rows=20&pgc=1",
        urlencoding(keyword)
    );
    let json = get_json(agent, &url, MIGU_HEADERS)?;
    let musics = json
        .get("musics")
        .and_then(|a| a.as_array())
        .ok_or_else(|| "migu: no result".to_string())?;
    let mut out = Vec::new();
    for item in musics {
        let id = item.get("id").map(json_to_string).unwrap_or_default();
        if id.is_empty() {
            continue;
        }
        out.push(Candidate { id, duration_ms: None, album_id: None });
    }
    Ok(out)
}

fn migu_track(agent: &ureq::Agent, id: &str, enable_flac: bool) -> Result<String, String> {
    // 音质从高到低试。enable_flac 时含无损 SQ,否则从 HQ 起。
    let tones: &[&str] = if enable_flac {
        &["SQ", "HQ", "PQ"]
    } else {
        &["HQ", "PQ"]
    };
    for tone in tones {
        let url = format!(
            "https://app.c.nf.migu.cn/MIGUM2.0/strategy/listen-url/v2.4?netType=01&resourceType=2&songId={id}&toneFlag={tone}"
        );
        if let Ok(json) = get_json(agent, &url, MIGU_HEADERS) {
            let data = json.get("data");
            let fmt = data
                .and_then(|d| d.get("audioFormatType"))
                .map(json_to_string)
                .unwrap_or_default();
            if fmt != *tone {
                continue;
            }
            if let Some(u) = data
                .and_then(|d| d.get("url"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
            {
                return Ok(u.to_string());
            }
        }
    }
    Err("migu: no url".to_string())
}

// ───────────────────────── 波点 bodian ─────────────────────────
// 搜索复用酷我 search.kuwo.cn,直链走 bd-api.kuwo.cn(带 sign 签名)。

fn bodian_sign(raw_url: &str) -> String {
    let with_time = format!("{raw_url}&timestamp={}", now_ms());
    let path = url::Url::parse(&with_time)
        .ok()
        .map(|u| u.path().to_string())
        .unwrap_or_default();
    let query = with_time.split_once('?').map(|(_, q)| q).unwrap_or("");
    let mut chars: Vec<char> = query
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    chars.sort_unstable();
    let filtered: String = chars.into_iter().collect();
    let sign = md5_hex(&format!("kuwotest{filtered}{path}"));
    format!("{with_time}&sign={sign}")
}

fn bodian_track(agent: &ureq::Agent, id: &str) -> Result<String, String> {
    let audio_url = bodian_sign(&format!(
        "http://bd-api.kuwo.cn/api/play/music/v2/audioUrl?&br=320kmp3&musicId={id}"
    ));
    let headers: &[(&str, &str)] = &[
        ("user-agent", "Dart/2.19 (dart:io)"),
        ("plat", "ar"),
        ("channel", "aliopen"),
        ("ver", "3.9.0"),
        ("host", "bd-api.kuwo.cn"),
        ("X-Forwarded-For", "1.0.1.114"),
    ];
    let json = get_json(agent, &audio_url, headers)?;
    if json.get("code").and_then(json_as_u64) != Some(200) {
        return Err("bodian: bad code".to_string());
    }
    json.get("data")
        .and_then(|d| d.get("audioUrl"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| "bodian: no url".to_string())
}

// ───────────────────────── GD 音乐台 pyncmd ─────────────────────────

fn pyncmd_track(agent: &ureq::Agent, netease_id: &str) -> Result<String, String> {
    if netease_id.is_empty() {
        return Err("pyncmd: no netease id".to_string());
    }
    let url = format!(
        "https://music-api.gdstudio.xyz/api.php?types=url&source=netease&id={}&br=320",
        urlencoding(netease_id)
    );
    let json = get_json(agent, &url, &[])?;
    let br = json.get("br").and_then(json_as_u64).unwrap_or(0);
    if br == 0 {
        return Err("pyncmd: br=0".to_string());
    }
    json.get("url")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .ok_or_else(|| "pyncmd: no url".to_string())
}

// ───────────────────────── 编排 ─────────────────────────

fn match_one_source(
    agent: &ureq::Agent,
    source: &str,
    req: &UnblockRequest,
    keyword: &str,
    enable_flac: bool,
) -> Result<String, String> {
    match source {
        "kuwo" => {
            let list = kuwo_search(agent, keyword)?;
            let picked = select(&list, req.duration_ms).ok_or_else(|| "no match".to_string())?;
            kuwo_track(agent, &picked.id)
        }
        "kugou" => {
            let list = kugou_search(agent, keyword)?;
            let picked = select(&list, req.duration_ms).ok_or_else(|| "no match".to_string())?;
            kugou_track(agent, picked)
        }
        "migu" => {
            let list = migu_search(agent, keyword)?;
            let picked = select(&list, req.duration_ms).ok_or_else(|| "no match".to_string())?;
            migu_track(agent, &picked.id, enable_flac)
        }
        "bodian" => {
            // 波点搜索复用酷我接口。
            let list = kuwo_search(agent, keyword)?;
            let picked = select(&list, req.duration_ms).ok_or_else(|| "no match".to_string())?;
            bodian_track(agent, &picked.id)
        }
        "pyncmd" => pyncmd_track(agent, &req.netease_id),
        other => Err(format!("unknown source: {other}")),
    }
}

/// 灰曲解灰:按 sources 顺序尝试,返回首个拿到直链的结果。全部失败返回 Ok(None)。
#[tauri::command]
pub async fn music_unblock(req: UnblockRequest) -> Result<Option<UnblockResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if req.name.trim().is_empty() || req.sources.is_empty() {
            return Ok(None);
        }
        let agent = build_agent(req.proxy_url.as_deref());
        let keyword = keyword_of(&req);
        let enable_flac = req.enable_flac.unwrap_or(false);
        for source in &req.sources {
            match match_one_source(&agent, source, &req, &keyword, enable_flac) {
                Ok(url) if !url.is_empty() => {
                    // 上游可能给 http:// 直链;统一升级到 https 由前端代理决定,这里原样返回。
                    return Ok(Some(UnblockResult {
                        url,
                        source: source.clone(),
                    }));
                }
                Ok(_) => continue,
                Err(e) => {
                    eprintln!("[unblock] {source} failed: {e}");
                    continue;
                }
            }
        }
        Ok(None)
    })
    .await
    .map_err(|e| format!("unblock task: {e}"))?
}

// ───────────────────────── 工具 ─────────────────────────

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// 把 JSON 值当 u64 读(兼容数字与数字字符串)。
fn json_as_u64(v: &serde_json::Value) -> Option<u64> {
    if let Some(n) = v.as_u64() {
        return Some(n);
    }
    if let Some(f) = v.as_f64() {
        if f >= 0.0 {
            return Some(f as u64);
        }
    }
    v.as_str().and_then(|s| s.trim().parse::<u64>().ok())
}

/// 把 JSON 值转成字符串(数字/字符串都可)。
fn json_to_string(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

/// 从文本里抽第一个 http(s) URL(酷我 antiserver 返回纯文本 URL)。
fn extract_http_url(body: &str) -> Option<String> {
    let start = body.find("http")?;
    let rest = &body[start..];
    let end = rest
        .find(|c: char| c.is_whitespace() || c == '"' || c == '$')
        .unwrap_or(rest.len());
    let url = rest[..end].trim().to_string();
    if url.starts_with("http") {
        Some(url)
    } else {
        None
    }
}

/// 极简 URL 编码(只对非 unreserved 字符百分号编码)。
fn urlencoding(s: &str) -> String {
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
