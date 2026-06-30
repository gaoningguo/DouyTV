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
    /// kugou 专用:320hash(HQ) / sqhash(无损),照 server 三档轮试。
    id_hq: Option<String>,
    id_sq: Option<String>,
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
    // 单请求超时收紧到 8s:多源串行尝试时,某个源卡住不会累积成整体长超时,
    // 让后面更稳的源(尤其 pyncmd)有机会跑到。
    let mut builder = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(8))
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
        out.push(Candidate {
            id: rid,
            duration_ms,
            album_id: None,
            id_hq: None,
            id_sq: None,
        });
    }
    Ok(out)
}

fn kuwo_track(agent: &ureq::Agent, id: &str, enable_flac: bool) -> Result<String, String> {
    // 主路径:mobi.kuwo.cn + kwDES 加密 query(照 server kuwo.js 的 crypto.kuwoapi 分支)。
    let fmt = if enable_flac { "flac|mp3" } else { "mp3" };
    let query = format!(
        "user=0&corp=kuwo&source=kwplayer_ar_5.1.0.0_B_jiakong_vh.apk&p2p=1&type=convert_url2&sig=0&format={fmt}&rid={id}"
    );
    let enc = kw_encrypt_query(&query);
    let url = format!("http://mobi.kuwo.cn/mobi.s?f=kuwo&q={enc}");
    if let Ok(body) = get_text(agent, &url, &[("User-Agent", "okhttp/3.10.0")]) {
        if let Some(u) = extract_http_url(&body) {
            return Ok(u);
        }
    }
    // 兜底:antiserver 免加密(多已失效,但留作 kwDES 路径失败时的退路)。
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
        // 三档 hash:sqhash(无损)/320hash(高品)/hash(标准),照 server 逐档轮试。
        let id_sq = item
            .get("sqhash")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        let id_hq = item
            .get("320hash")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());
        out.push(Candidate {
            id: hash.to_string(),
            duration_ms,
            album_id,
            id_hq,
            id_sq,
        });
    }
    Ok(out)
}

/// 取酷狗某一档 hash 的直链(照 server single():key=md5(hash+kgcloudv2),解析 url[0])。
fn kugou_single(agent: &ureq::Agent, hash: &str, album_id: &str) -> Result<String, String> {
    let key = md5_hex(&format!("{hash}kgcloudv2"));
    let url = format!(
        "http://trackercdn.kugou.com/i/v2/?key={key}&hash={hash}&appid=1005&pid=2&cmd=25&behavior=play&album_id={album_id}"
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

fn kugou_track(agent: &ureq::Agent, song: &Candidate, enable_flac: bool) -> Result<String, String> {
    let album_id = song.album_id.clone().unwrap_or_default();
    // 照 server track():['sqhash','hqhash','hash'].slice(ENABLE_FLAC?0:1) 逐档试,首个成功即用。
    let mut tiers: Vec<&str> = Vec::new();
    if enable_flac {
        if let Some(sq) = song.id_sq.as_deref() {
            tiers.push(sq);
        }
    }
    if let Some(hq) = song.id_hq.as_deref() {
        tiers.push(hq);
    }
    tiers.push(song.id.as_str());
    let mut last = "kugou: no url".to_string();
    for hash in tiers {
        match kugou_single(agent, hash, &album_id) {
            Ok(url) => return Ok(url),
            Err(e) => last = e,
        }
    }
    Err(last)
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
        // server 的 migu format 不含 duration，select 总取第一条，故 duration_ms 留 None。
        out.push(Candidate { id, duration_ms: None, album_id: None, id_hq: None, id_sq: None });
    }
    Ok(out)
}

fn migu_track(agent: &ureq::Agent, id: &str, enable_flac: bool) -> Result<String, String> {
    // 音质从高到低试。enable_flac 时含无损 SQ,否则从 HQ 起。
    // 照 server migu.track:['ZQ24','SQ','HQ','PQ'].slice(ENABLE_FLAC?0:2)。
    let tones: &[&str] = if enable_flac {
        &["ZQ24", "SQ", "HQ", "PQ"]
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

/// 波点设备 id（照 server getRandomDeviceId：0~1e11 的随机整数，进程内固定一个）。
fn bodian_device_id() -> &'static str {
    use std::sync::OnceLock;
    static DEVID: OnceLock<String> = OnceLock::new();
    DEVID.get_or_init(|| {
        let n = (now_ms() % 100_000_000_000) as u64;
        n.to_string()
    })
}

/// 照 server sendAdFreeRequest()：取直链前先发一个去广告请求（失败不致命）。
fn bodian_ad_free(agent: &ureq::Agent) {
    let url = "http://bd-api.kuwo.cn/api/service/advert/watch?uid=-1&token=&timestamp=1724306124436&sign=15a676d66285117ad714e8c8371691da";
    let body = serde_json::json!({ "type": 5, "subType": 5, "musicId": 0, "adToken": "" }).to_string();
    let _ = agent
        .post(url)
        .set("user-agent", "Dart/2.19 (dart:io)")
        .set("plat", "ar")
        .set("channel", "aliopen")
        .set("devid", bodian_device_id())
        .set("ver", "3.9.0")
        .set("host", "bd-api.kuwo.cn")
        .set("qimei36", "1e9970cbcdc20a031dee9f37100017e1840e")
        .set("content-type", "application/json; charset=utf-8")
        .send_string(&body);
}

fn bodian_track(agent: &ureq::Agent, id: &str, enable_flac: bool) -> Result<String, String> {
    // 照 server：br 按 ENABLE_FLAC 选 2000kflac / 320kmp3。
    let br = if enable_flac { "2000kflac" } else { "320kmp3" };
    let audio_url = bodian_sign(&format!(
        "http://bd-api.kuwo.cn/api/play/music/v2/audioUrl?&br={br}&musicId={id}"
    ));
    let devid = bodian_device_id();
    let headers: &[(&str, &str)] = &[
        ("user-agent", "Dart/2.19 (dart:io)"),
        ("plat", "ar"),
        ("channel", "aliopen"),
        ("devid", devid),
        ("ver", "3.9.0"),
        ("host", "bd-api.kuwo.cn"),
        ("X-Forwarded-For", "1.0.1.114"),
    ];
    // 先发去广告请求（照 server，失败忽略）。
    bodian_ad_free(agent);
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
            kuwo_track(agent, &picked.id, enable_flac)
        }
        "kugou" => {
            let list = kugou_search(agent, keyword)?;
            let picked = select(&list, req.duration_ms).ok_or_else(|| "no match".to_string())?;
            kugou_track(agent, picked, enable_flac)
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
            bodian_track(agent, &picked.id, enable_flac)
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
        // pyncmd(GD studio)是公开聚合器:拿网易 id 直接换链,无加密、无需搜索匹配,
        // 命中率与稳定性远高于 kuwo/kugou/migu/bodian 那几个需加密/端点易漂移的源。
        // 故无论前端传来的顺序如何,只要启用了 pyncmd 就最先试它——避免前面几个源
        // 逐个搜索+超时累积导致整体超时、根本轮不到 pyncmd。
        let mut ordered: Vec<&String> = req.sources.iter().collect();
        ordered.sort_by_key(|s| if s.as_str() == "pyncmd" { 0 } else { 1 });
        for source in ordered {
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

// ───────────────────────── 酷我 kwDES 加密 ─────────────────────────
// 照 server src/kwDES.js 逐行移植（kuwo 私有 DES 变体：非标准 —— 小端字节序、
// E 扩展表末组为 …31,30）。JS 用 BigInt + 自封 Long；这里用 i128 精确复现其语义：
//  - arrayMask[63] = -(2^63)（负数，符号位向高位无限延伸）；i128 补码在 bit0..127
//    窗口内与 BigInt 无限补码对 AND/OR/XOR/NOT 同结果，且所有中间移位都 < 128 位不溢出。
//  - 取字节用算术右移 + &255，负数高位填充不影响所取的 8 位（与 BigInt 一致）。
// ⚠️ 未经真机验证：表项/位序若有一处抄错即静默产出错误 URL，需真机比对 server 输出。
mod kwdes {
    // EXPANSION（注意末组 31,30，非标准 DES 的 31,0）
    const ARRAY_E: [i64; 64] = [
        31, 0, 1, 2, 3, 4, -1, -1, 3, 4, 5, 6, 7, 8, -1, -1, 7, 8, 9, 10, 11, 12, -1, -1, 11, 12,
        13, 14, 15, 16, -1, -1, 15, 16, 17, 18, 19, 20, -1, -1, 19, 20, 21, 22, 23, 24, -1, -1, 23,
        24, 25, 26, 27, 28, -1, -1, 27, 28, 29, 30, 31, 30, -1, -1,
    ];
    // INITIAL_PERMUTATION
    const ARRAY_IP: [i64; 64] = [
        57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3, 61, 53, 45, 37, 29, 21, 13, 5,
        63, 55, 47, 39, 31, 23, 15, 7, 56, 48, 40, 32, 24, 16, 8, 0, 58, 50, 42, 34, 26, 18, 10, 2,
        60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6,
    ];
    // INVERSE_PERMUTATION
    const ARRAY_IP_1: [i64; 64] = [
        39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
        36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27, 34, 2, 42, 10, 50, 18, 58, 26,
        33, 1, 41, 9, 49, 17, 57, 25, 32, 0, 40, 8, 48, 16, 56, 24,
    ];
    // PERMUTATION
    const ARRAY_P: [i64; 32] = [
        15, 6, 19, 20, 28, 11, 27, 16, 0, 14, 22, 25, 4, 17, 30, 9, 1, 7, 23, 13, 31, 26, 2, 8, 18,
        12, 29, 5, 21, 10, 3, 24,
    ];
    // PERMUTED_CHOICE1
    const ARRAY_PC_1: [i64; 56] = [
        56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2,
        59, 51, 43, 35, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44,
        36, 28, 20, 12, 4, 27, 19, 11, 3,
    ];
    // PERMUTED_CHOICE2
    const ARRAY_PC_2: [i64; 64] = [
        13, 16, 10, 23, 0, 4, -1, -1, 2, 27, 14, 5, 20, 9, -1, -1, 22, 18, 11, 3, 25, 7, -1, -1, 15,
        6, 26, 19, 12, 1, -1, -1, 40, 51, 30, 36, 46, 54, -1, -1, 29, 39, 50, 44, 32, 47, -1, -1,
        43, 48, 38, 55, 33, 52, -1, -1, 45, 41, 49, 35, 28, 31, -1, -1,
    ];
    const ARRAY_LS: [usize; 16] = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
    const ARRAY_LS_MASK: [i128; 3] = [0, 0x100001, 0x300003];

    const NS_BOX: [[i128; 64]; 8] = [
        [
            14, 4, 3, 15, 2, 13, 5, 3, 13, 14, 6, 9, 11, 2, 0, 5, 4, 1, 10, 12, 15, 6, 9, 10, 1, 8,
            12, 7, 8, 11, 7, 0, 0, 15, 10, 5, 14, 4, 9, 10, 7, 8, 12, 3, 13, 1, 3, 6, 15, 12, 6, 11,
            2, 9, 5, 0, 4, 2, 11, 14, 1, 7, 8, 13,
        ],
        [
            15, 0, 9, 5, 6, 10, 12, 9, 8, 7, 2, 12, 3, 13, 5, 2, 1, 14, 7, 8, 11, 4, 0, 3, 14, 11,
            13, 6, 4, 1, 10, 15, 3, 13, 12, 11, 15, 3, 6, 0, 4, 10, 1, 7, 8, 4, 11, 14, 13, 8, 0, 6,
            2, 15, 9, 5, 7, 1, 10, 12, 14, 2, 5, 9,
        ],
        [
            10, 13, 1, 11, 6, 8, 11, 5, 9, 4, 12, 2, 15, 3, 2, 14, 0, 6, 13, 1, 3, 15, 4, 10, 14, 9,
            7, 12, 5, 0, 8, 7, 13, 1, 2, 4, 3, 6, 12, 11, 0, 13, 5, 14, 6, 8, 15, 2, 7, 10, 8, 15, 4,
            9, 11, 5, 9, 0, 14, 3, 10, 7, 1, 12,
        ],
        [
            7, 10, 1, 15, 0, 12, 11, 5, 14, 9, 8, 3, 9, 7, 4, 8, 13, 6, 2, 1, 6, 11, 12, 2, 3, 0, 5,
            14, 10, 13, 15, 4, 13, 3, 4, 9, 6, 10, 1, 12, 11, 0, 2, 5, 0, 13, 14, 2, 8, 15, 7, 4, 15,
            1, 10, 7, 5, 6, 12, 11, 3, 8, 9, 14,
        ],
        [
            2, 4, 8, 15, 7, 10, 13, 6, 4, 1, 3, 12, 11, 7, 14, 0, 12, 2, 5, 9, 10, 13, 0, 3, 1, 11,
            15, 5, 6, 8, 9, 14, 14, 11, 5, 6, 4, 1, 3, 10, 2, 12, 15, 0, 13, 2, 8, 5, 11, 8, 0, 15,
            7, 14, 9, 4, 12, 7, 10, 9, 1, 13, 6, 3,
        ],
        [
            12, 9, 0, 7, 9, 2, 14, 1, 10, 15, 3, 4, 6, 12, 5, 11, 1, 14, 13, 0, 2, 8, 7, 13, 15, 5,
            4, 10, 8, 3, 11, 6, 10, 4, 6, 11, 7, 9, 0, 6, 4, 2, 13, 1, 9, 15, 3, 8, 15, 3, 1, 14, 12,
            5, 11, 0, 2, 12, 14, 7, 5, 10, 8, 13,
        ],
        [
            4, 1, 3, 10, 15, 12, 5, 0, 2, 11, 9, 6, 8, 7, 6, 9, 11, 4, 12, 15, 0, 3, 10, 5, 14, 13,
            7, 8, 13, 14, 1, 2, 13, 6, 14, 9, 4, 1, 2, 14, 11, 13, 5, 0, 1, 10, 8, 3, 0, 11, 3, 5, 9,
            4, 15, 2, 7, 8, 12, 15, 10, 7, 6, 12,
        ],
        [
            13, 7, 10, 0, 6, 9, 5, 15, 8, 4, 3, 10, 11, 14, 12, 5, 2, 11, 9, 6, 15, 12, 0, 3, 4, 1,
            14, 13, 1, 2, 7, 8, 1, 2, 12, 15, 10, 4, 0, 3, 13, 14, 6, 9, 7, 8, 9, 6, 15, 1, 5, 12, 3,
            10, 14, 5, 8, 7, 11, 0, 4, 13, 2, 11,
        ],
    ];

    use num_bigint::BigInt;
    use std::sync::OnceLock;

    /// arrayMask[n] = 2^n；arrayMask[63] = -(2^63)（照 JS：power(2,63)*-1）。预构造一次。
    /// 用 num-bigint 的 BigInt 1:1 对应 JS 的 Long(BigInt) —— 零语义偏差，直译 server 源码。
    fn masks() -> &'static [BigInt] {
        static M: OnceLock<Vec<BigInt>> = OnceLock::new();
        M.get_or_init(|| {
            let mut v: Vec<BigInt> = (0..64).map(|n| BigInt::from(1) << n).collect();
            let last = v.len() - 1;
            v[last] = -v[last].clone();
            v
        })
    }

    fn zero() -> BigInt {
        BigInt::from(0)
    }

    /// 取 BigInt 低位作小整数（用于 0-255 字节值 / S-box 索引；入参经 &255 后非负）。
    fn to_small(b: &BigInt) -> u64 {
        let (_, digits) = b.to_u64_digits();
        digits.first().copied().unwrap_or(0)
    }

    /// bitTransform：按 arr 取 l 的指定位，命中则置 l2 的第 i 位。-1 项跳过。
    fn bit_transform(arr: &[i64], n: usize, l: &BigInt) -> BigInt {
        let m = masks();
        let mut l2 = zero();
        for i in 0..n {
            let v = arr[i];
            if v < 0 {
                continue;
            }
            if (l & &m[v as usize]) == zero() {
                continue;
            }
            l2 = l2 | &m[i];
        }
        l2
    }

    fn des64(longs: &[BigInt; 16], l: &BigInt) -> BigInt {
        let mask32 = BigInt::from(0xffff_ffffu64);
        let mask_high = BigInt::from(-4_294_967_296i64);
        let byte_mask = BigInt::from(255);
        let mut p_r: Vec<BigInt> = (0..8).map(|_| zero()).collect();
        let out = bit_transform(&ARRAY_IP, 64, l);
        let mut p0 = &out & &mask32;
        let mut p1 = (&out & &mask_high) >> 32;
        for i in 0..16 {
            let mut s_out = zero();
            let mut r = bit_transform(&ARRAY_E, 64, &p1);
            r = r ^ &longs[i];
            for j in 0..8 {
                p_r[j] = (&r >> (j * 8)) & &byte_mask;
            }
            for sbi in (0..8).rev() {
                let idx = to_small(&p_r[sbi]) as usize;
                s_out = (s_out << 4) | BigInt::from(NS_BOX[sbi][idx]);
            }
            r = bit_transform(&ARRAY_P, 32, &s_out);
            let l_prev = p0.clone();
            p0 = p1.clone();
            p1 = l_prev ^ r;
        }
        // pSource.reverse()
        std::mem::swap(&mut p0, &mut p1);
        let out2 = ((p1 << 32) & &mask_high) | (&p0 & &mask32);
        bit_transform(&ARRAY_IP_1, 64, &out2)
    }

    fn sub_keys(l: &BigInt, longs: &mut [BigInt; 16], mode: i32) {
        let mut l2 = bit_transform(&ARRAY_PC_1, 56, l);
        for i in 0..16 {
            let ls = ARRAY_LS[i];
            let m = BigInt::from(ARRAY_LS_MASK[ls]);
            // l2 = ((l2 & m) << (28 - ls)) | ((l2 & ~m) >> ls)
            let left = (&l2 & &m) << (28 - ls);
            let right = (&l2 & !(&m)) >> ls;
            l2 = left | right;
            longs[i] = bit_transform(&ARRAY_PC_2, 64, &l2);
        }
        if mode == 1 {
            for j in 0..8 {
                longs.swap(j, 15 - j);
            }
        }
    }

    /// crypt：mode 0=加密,1=解密（照 server，加密时末块补一个 DES64）。
    fn crypt(msg: &[u8], key: &[u8; 8], mode: i32) -> Vec<u8> {
        let byte_mask = BigInt::from(255);
        let mut l = zero();
        for i in 0..8 {
            l = (BigInt::from(key[i]) << (i * 8)) | l;
        }
        let j = msg.len() / 8;
        let mut arr_long1: [BigInt; 16] = std::array::from_fn(|_| zero());
        sub_keys(&l, &mut arr_long1, mode);

        let mut arr_long2: Vec<BigInt> = vec![zero(); j];
        for m in 0..j {
            for n in 0..8 {
                arr_long2[m] = (BigInt::from(msg[n + m * 8]) << (n * 8)) | &arr_long2[m];
            }
        }

        let len3 = (1 + 8 * (j + 1)) / 8;
        let mut arr_long3: Vec<BigInt> = vec![zero(); len3];
        for i1 in 0..j {
            arr_long3[i1] = des64(&arr_long1, &arr_long2[i1]);
        }

        let arr_byte1 = &msg[j * 8..];
        let mut l2 = zero();
        for i1 in 0..(msg.len() % 8) {
            l2 = (BigInt::from(arr_byte1[i1]) << (i1 * 8)) | l2;
        }
        if !arr_byte1.is_empty() || mode == 0 {
            arr_long3[j] = des64(&arr_long1, &l2);
        }

        let mut out = Vec::with_capacity(8 * arr_long3.len());
        for l3 in &arr_long3 {
            for i6 in 0..8 {
                out.push(to_small(&((l3 >> (i6 * 8)) & &byte_mask)) as u8);
            }
        }
        out
    }

    const SECRET_KEY: &[u8; 8] = b"ylzsxkwm";

    /// 照 server encryptQuery：DES 加密后 base64。
    pub fn encrypt_query(query: &str) -> String {
        use base64::Engine;
        let enc = crypt(query.as_bytes(), SECRET_KEY, 0);
        base64::engine::general_purpose::STANDARD.encode(enc)
    }
}

/// kwDES 加密 query（kuwo mobi.s 接口用）。
fn kw_encrypt_query(query: &str) -> String {
    kwdes::encrypt_query(query)
}
