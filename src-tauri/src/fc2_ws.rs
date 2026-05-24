//! FC2 Live 拉流握手 —— WebSocket 信令通道,跟 yt-dlp / HoloArchivists/fc2-live-dl 的协议对齐。
//!
//! 流程：
//!   1. POST `/api/getControlServer.php`  body: `channel_id={id}&mode=play&orz=...&channel_version=...`
//!      → 返回 `{ url: wss://media-worker.../control/channels/{id}, control_token: <jwt>, orz, orz_raw }`
//!   2. WSS 连 `{url}?control_token={control_token}`
//!   3. 发 `{"name":"get_hls_information","arguments":{},"id":1}`
//!   4. 等响应 `{"name":"_response_","id":1,"arguments":{"playlists":[{url, mode, ...}, ...]}}`
//!   5. 关 WS,把 url 返给 JS（普通 HLS 之后 hls.js 走 dyproxy 就行)
//!
//! WS **不是** 媒体通道 —— 媒体走 HTTPS HLS。所以这里是一次性 round-trip。
//!
//! 代理：只支持 HTTP CONNECT 代理（http:// 前缀）。SOCKS5 暂不支持 —— 用户的 Clash
//! 通常同时暴露 http:port + socks:port,选 http 端口即可。直连模式（proxy=None / 空）
//! 直接 connect_async。

use futures_util::SinkExt;
use futures_util::StreamExt;
use serde::Deserialize;
use std::sync::Once;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const REFERER: &str = "https://live.fc2.com/";

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);
const HLS_INFO_TIMEOUT: Duration = Duration::from_secs(10);
const PROXY_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// rustls 0.23 要求进程级 CryptoProvider —— reqwest 用自己内部 config 不算 process default,
/// tokio-tungstenite 拿不到 default 时会 panic at `crypto/mod.rs:249`。
/// 第一次调用 resolve_hls 时装一次 aws-lc-rs(已经被 reqwest 拉进来,零额外 binary 成本)。
pub(crate) fn ensure_crypto_provider() {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        // 已安装时 install_default 返 Err,忽略即可
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    });
}

#[derive(Debug, Deserialize)]
struct CtrlServerResp {
    #[serde(default)]
    url: String,
    #[serde(default)]
    control_token: String,
    // 服务端偶尔在房间没开播 / 风控时返 status=11 / message=…,这里只关心 url+token。
    #[serde(default)]
    status: i64,
    #[serde(default)]
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WsResponse {
    name: String,
    #[serde(default)]
    id: u64,
    #[serde(default)]
    arguments: serde_json::Value,
}

/// 诊断入口 —— 走 WS 握手拿 master URL,然后用 dyproxy 同款 h2 client(`h2_client_for`)
/// 分别 GET master 和第一个 variant,把每步状态码 + c/d token 对比写成一段文本返回。
///
/// 用途:确定 variant 403 是 (a) 同一 h2 client / 同一连接池也复现 → 服务端绑定层面问题,
/// 还是 (b) 只在 dyproxy 多次走代理 + 缓存路径复现 → 客户端连接复用问题。
pub async fn diagnose(channel_id: String, proxy_url: Option<String>) -> Result<String, String> {
    ensure_crypto_provider();
    let proxy = proxy_url.filter(|s| !s.trim().is_empty());
    let mut log = String::new();
    use std::fmt::Write as _;

    let _ = writeln!(log, "[fc2 diag] channel_id={} proxy={:?}", channel_id, proxy);

    // 1. WS handshake
    let (ws_base, control_token) = fetch_control_server(&channel_id, proxy.as_deref()).await?;
    let _ = writeln!(log, "[fc2 diag] ws_base={} token_len={}", ws_base, control_token.len());
    let ws_url = format!("{ws_base}?control_token={control_token}");
    let playlists = timeout(
        HANDSHAKE_TIMEOUT + HLS_INFO_TIMEOUT,
        ws_handshake_get_hls(&ws_url, proxy.as_deref()),
    )
    .await
    .map_err(|_| "FC2 diag: WS 握手超时".to_string())??;

    // 2. 列举返回的 playlist entries
    let arr = playlists.as_array().ok_or_else(|| "diag: playlists 非数组".to_string())?;
    let _ = writeln!(log, "\n[fc2 diag] playlists 共 {} 项:", arr.len());
    for p in arr {
        let mode = p.get("mode").and_then(|v| v.as_i64()).unwrap_or(-1);
        let url = p.get("url").and_then(|v| v.as_str()).unwrap_or("(无)");
        let _ = writeln!(log, "  mode={} url={}", mode, url);
    }

    let master_url = arr
        .iter()
        .find(|p| p.get("mode").and_then(|v| v.as_i64()) == Some(0))
        .and_then(|p| p.get("url").and_then(|v| v.as_str()))
        .ok_or_else(|| "diag: 未找到 mode=0 master".to_string())?;

    // 3. 解 master URL 的 c/d
    let master_parsed = url::Url::parse(master_url).map_err(|e| format!("diag: master URL 非法: {e}"))?;
    let master_c = master_parsed
        .query_pairs()
        .find(|(k, _)| k == "c")
        .map(|(_, v)| v.into_owned())
        .unwrap_or_default();
    let master_d = master_parsed
        .query_pairs()
        .find(|(k, _)| k == "d")
        .map(|(_, v)| v.into_owned())
        .unwrap_or_default();
    let _ = writeln!(
        log,
        "\n[fc2 diag] master c={} d={} (len {} / {})",
        truncate(&master_c, 16),
        truncate(&master_d, 16),
        master_c.len(),
        master_d.len()
    );

    // 4. 用 dyproxy 同款 h2 client GET master
    let client = crate::h2_client_for(proxy.as_deref())?;
    let t0 = std::time::Instant::now();
    let resp = client
        .get(master_url)
        .header("User-Agent", USER_AGENT)
        .header("Referer", REFERER)
        .header("Origin", "https://live.fc2.com")
        .header("Accept", "*/*")
        .send()
        .await
        .map_err(|e| format!("diag: master GET error: {e}"))?;
    let m_status = resp.status();
    let m_version = format!("{:?}", resp.version());
    let m_remote = resp.remote_addr().map(|a| a.to_string()).unwrap_or_else(|| "(无 remote_addr)".into());
    let m_body = resp.text().await.unwrap_or_default();
    let _ = writeln!(
        log,
        "\n[fc2 diag] GET master: {} {} via {} ({}ms)\n  body {} 字节, 前 200 字:\n{}",
        m_status,
        m_version,
        m_remote,
        t0.elapsed().as_millis(),
        m_body.len(),
        m_body.chars().take(200).collect::<String>()
    );

    // 5. 从 master body 中提取所有 variant URL
    let variants_in_body: Vec<&str> = m_body
        .lines()
        .filter(|l| {
            let t = l.trim();
            t.starts_with("http") || t.starts_with("/")
        })
        .collect();
    let _ = writeln!(log, "\n[fc2 diag] master body 中含 {} 条 URL:", variants_in_body.len());
    for v in &variants_in_body {
        let _ = writeln!(log, "  {}", v);
    }

    // 6. 用 SAME h2 client GET 第一个 variant
    if let Some(first_var) = variants_in_body.first() {
        let var_url = if first_var.starts_with("http") {
            (*first_var).to_string()
        } else {
            // 相对路径 —— 拼到 master 上
            master_parsed
                .join(first_var)
                .map(|u| u.to_string())
                .unwrap_or_else(|_| (*first_var).to_string())
        };
        let var_parsed = url::Url::parse(&var_url).ok();
        let var_c = var_parsed
            .as_ref()
            .and_then(|u| u.query_pairs().find(|(k, _)| k == "c").map(|(_, v)| v.into_owned()))
            .unwrap_or_default();
        let var_d = var_parsed
            .as_ref()
            .and_then(|u| u.query_pairs().find(|(k, _)| k == "d").map(|(_, v)| v.into_owned()))
            .unwrap_or_default();
        let _ = writeln!(
            log,
            "\n[fc2 diag] variant c={} d={} (vs master c={} d={})\n  c 相等? {}  d 相等? {}",
            truncate(&var_c, 16),
            truncate(&var_d, 16),
            truncate(&master_c, 16),
            truncate(&master_d, 16),
            var_c == master_c,
            var_d == master_d,
        );

        let t1 = std::time::Instant::now();
        let resp = client
            .get(&var_url)
            .header("User-Agent", USER_AGENT)
            .header("Referer", REFERER)
            .header("Origin", "https://live.fc2.com")
            .header("Accept", "*/*")
            .send()
            .await
            .map_err(|e| format!("diag: variant GET error: {e}"))?;
        let v_status = resp.status();
        let v_version = format!("{:?}", resp.version());
        let v_remote = resp.remote_addr().map(|a| a.to_string()).unwrap_or_else(|| "(无 remote_addr)".into());
        let v_body_bytes = resp.bytes().await.map(|b| b.len()).unwrap_or(0);
        let _ = writeln!(
            log,
            "\n[fc2 diag] GET variant: {} {} via {} ({}ms, body {} 字节)",
            v_status, v_version, v_remote, t1.elapsed().as_millis(), v_body_bytes
        );
        let same_conn = m_remote == v_remote;
        let _ = writeln!(log, "\n[fc2 diag] master/variant remote_addr 相同? {}", same_conn);
    } else {
        let _ = writeln!(log, "\n[fc2 diag] master body 中没找到 variant URL —— body 可能不是合法 master playlist");
    }

    Ok(log)
}

fn truncate(s: &str, n: usize) -> String {
    if s.len() <= n {
        s.to_string()
    } else {
        format!("{}…", &s[..n])
    }
}

/// 调用入口。返回最终能给 hls.js 用的 HLS URL。
pub async fn resolve_hls(channel_id: String, proxy_url: Option<String>) -> Result<String, String> {
    ensure_crypto_provider();
    eprintln!(
        "[fc2] resolve_hls start channel_id={} proxy={:?}",
        channel_id, proxy_url
    );
    let proxy = proxy_url.filter(|s| !s.trim().is_empty());

    eprintln!("[fc2] step 1: fetch_control_server ...");
    let (ws_base, control_token) =
        fetch_control_server(&channel_id, proxy.as_deref()).await?;
    eprintln!(
        "[fc2] step 1 ok: ws_base={} token_len={}",
        ws_base,
        control_token.len()
    );

    if ws_base.is_empty() || control_token.is_empty() {
        return Err("FC2: getControlServer 未返回 wss URL / token（房间未开播或被风控)".into());
    }

    let ws_url = format!("{ws_base}?control_token={control_token}");
    eprintln!("[fc2] step 2: WS handshake to {} ...", ws_base);

    let playlists = timeout(
        HANDSHAKE_TIMEOUT + HLS_INFO_TIMEOUT,
        ws_handshake_get_hls(&ws_url, proxy.as_deref()),
    )
    .await
    .map_err(|_| "FC2: WS 握手超时（代理 / 网络问题)".to_string())??;

    eprintln!("[fc2] step 2 ok, picking best playlist ...");
    let result = pick_best_playlist(&playlists)
        .ok_or_else(|| "FC2: 服务端没返回任何 playlist（房间刚下播 / 私密 / 付费节目)".into());
    eprintln!("[fc2] resolve_hls done: {:?}", result.as_ref().map(|s| s.chars().take(80).collect::<String>()));
    result
}

async fn fetch_control_server(
    channel_id: &str,
    proxy: Option<&str>,
) -> Result<(String, String), String> {
    let client = crate::h2_client_for(proxy)?;

    // FC2 接受 form 编码,匿名 orz 留空。channel_version 不传也接受。
    // 用 `url::form_urlencoded` 手工编 body —— 项目里没启用 reqwest `.form()` 的 feature,
    // 而 `url` crate 是必装依赖,顺手用。
    let body = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("channel_id", channel_id)
        .append_pair("mode", "play")
        .append_pair("orz", "")
        .append_pair("client_version", "2.1.0\n+[1]")
        .append_pair("client_type", "pc")
        .append_pair("client_app", "browser_hls")
        .append_pair("ipv6", "")
        .finish();

    let resp = client
        .post("https://live.fc2.com/api/getControlServer.php")
        .header("User-Agent", USER_AGENT)
        .header("Referer", REFERER)
        .header("Origin", "https://live.fc2.com")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .await
        .map_err(|e| format!("FC2 getControlServer HTTP 失败：{e}"))?;

    if !resp.status().is_success() {
        return Err(format!("FC2 getControlServer HTTP {}", resp.status()));
    }

    let body = resp
        .json::<CtrlServerResp>()
        .await
        .map_err(|e| format!("FC2 getControlServer 响应解析失败：{e}"))?;

    if body.status != 0 && !body.url.is_empty() {
        // FC2 返非零 status 但带 url 的情况偶见 —— 仍然继续尝试,WS 阶段会拒
    }

    if body.url.is_empty() {
        let msg = body.message.unwrap_or_else(|| "无 wss URL".into());
        return Err(format!("FC2 getControlServer：{msg}"));
    }

    Ok((body.url, body.control_token))
}

async fn ws_handshake_get_hls(
    ws_url: &str,
    proxy: Option<&str>,
) -> Result<serde_json::Value, String> {
    let parsed = url::Url::parse(ws_url).map_err(|e| format!("FC2 wss URL 非法：{e}"))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "FC2 wss URL 缺 host".to_string())?
        .to_string();
    let port = parsed.port().unwrap_or(443);

    let request = ws_url
        .into_client_request()
        .map_err(|e| format!("FC2 wss 构造请求失败：{e}"))?;

    // 选连接策略：直连 / HTTP CONNECT 代理。
    let (mut ws_stream, _resp) = match proxy {
        None => tokio_tungstenite::connect_async(request)
            .await
            .map_err(|e| format!("FC2 wss 直连失败：{e}"))?,
        Some(p) => {
            let tcp = connect_via_http_proxy(p, &host, port).await?;
            tokio_tungstenite::client_async_tls(request, tcp)
                .await
                .map_err(|e| format!("FC2 wss 代理握手失败：{e}"))?
        }
    };

    // 发 get_hls_information,等 id=1 的 _response_
    let req = serde_json::json!({
        "name": "get_hls_information",
        "arguments": {},
        "id": 1u64,
    });
    ws_stream
        .send(Message::Text(req.to_string()))
        .await
        .map_err(|e| format!("FC2 wss 发送失败：{e}"))?;

    let deadline = std::time::Instant::now() + HLS_INFO_TIMEOUT;
    loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return Err("FC2 wss 等待 hls_information 超时".into());
        }

        let msg = match timeout(remaining, ws_stream.next()).await {
            Err(_) => return Err("FC2 wss 等待 hls_information 超时".into()),
            Ok(None) => return Err("FC2 wss 提前断开".into()),
            Ok(Some(Err(e))) => return Err(format!("FC2 wss 读取失败：{e}")),
            Ok(Some(Ok(m))) => m,
        };

        let text = match msg {
            Message::Text(t) => t,
            Message::Binary(b) => String::from_utf8_lossy(&b).into_owned(),
            Message::Close(c) => {
                return Err(format!(
                    "FC2 wss 被服务端关闭：{}",
                    c.map(|cf| cf.code.to_string()).unwrap_or_else(|| "no code".into())
                ));
            }
            Message::Ping(p) => {
                let _ = ws_stream.send(Message::Pong(p)).await;
                continue;
            }
            Message::Pong(_) | Message::Frame(_) => continue,
        };

        // FC2 在握手早期会发 connect_complete / comment 等噪音,只挑 _response_ + id=1
        let parsed: WsResponse = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(_) => continue,
        };

        if parsed.name == "control_disconnection" {
            let code = parsed
                .arguments
                .get("code")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            return Err(match code {
                4101 => "FC2 房间已切到付费节目（PaidProgramDisconnection)".into(),
                4507 => "FC2 该房间需登录".into(),
                4512 => "FC2 同一房间已存在另一连接（FC2 禁止多端同看)".into(),
                _ => format!("FC2 wss control_disconnection code={code}"),
            });
        }
        if parsed.name == "publish_stop" {
            return Err("FC2 主播已下播".into());
        }
        if parsed.name != "_response_" || parsed.id != 1 {
            continue;
        }

        let playlists = parsed
            .arguments
            .get("playlists")
            .cloned()
            .ok_or_else(|| "FC2 _response_ 缺 playlists 字段".to_string())?;

        // 🚨 关键:不能在这里关 WS。
        // 实测 2026-05-24:master 200 + 所有 variant 403,且 master 和 variant 的 c/d
        // 完全一致 —— 排除 token 签名差异。唯一区别是时间 + WS 状态:resolve_hls 返回时
        // WS 已关,dyproxy 抢在 grace 期内拿到 master,但 hls.js 拿到 master 解析出
        // variant 再去拉时 grace 已过,服务端拒。HoloArchivists/fc2-live-dl 全程保持 WS
        // 开启的设计正是因为这个。
        //
        // 把 ws_stream 移到后台 tokio 任务保活,5 分钟自动过期(留够 hls.js 整段播放窗口),
        // 同时响应服务端 Ping。任务结束时自然关 WS,资源不泄露。
        tokio::spawn(keep_alive_task(ws_stream));
        return Ok(playlists);
    }
}

/// 具体化的 WS 流类型 —— `connect_async` / `client_async_tls` 都返这个。
type Ws = tokio_tungstenite::WebSocketStream<
    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
>;

const KEEP_ALIVE_MAX: Duration = Duration::from_secs(5 * 60);

/// 后台 WS 保活循环。
/// - 响应服务端 Ping(Pong 回写)
/// - 忽略 comment / heartbeat / 其它噪音消息
/// - Close / Err / 5 分钟硬上限 → 退出并自然关 WS
///
/// 不主动发 Ping —— FC2 服务端会定期 Ping 我们,我们响应即可。
async fn keep_alive_task(mut ws_stream: Ws) {
    let start = std::time::Instant::now();
    eprintln!("[fc2] keep_alive_task started");

    while start.elapsed() < KEEP_ALIVE_MAX {
        let wait = KEEP_ALIVE_MAX.saturating_sub(start.elapsed());
        match timeout(wait, ws_stream.next()).await {
            Ok(Some(Ok(Message::Ping(p)))) => {
                if ws_stream.send(Message::Pong(p)).await.is_err() {
                    break;
                }
            }
            Ok(Some(Ok(Message::Close(_)))) => break,
            Ok(Some(Ok(_))) => continue,
            Ok(Some(Err(e))) => {
                eprintln!("[fc2] keep_alive_task recv err: {e}");
                break;
            }
            Ok(None) => break,
            Err(_) => break, // 总超时
        }
    }

    let _ = ws_stream.close(None).await;
    eprintln!(
        "[fc2] keep_alive_task ended (elapsed={}s)",
        start.elapsed().as_secs()
    );
}

/// 在 playlists 数组里挑最佳 URL。
/// FC2 返 5 个条目:
///   - `mode=0`  → master playlist（ABR 自适应，hls.js 会从中自动选清晰度）—— **首选**
///   - `mode=10/20/30/90` → 各档单独 playlist（10≈低清, 90≈原画）
/// 优先用 mode=0(master),hls.js 自动 ABR;退而求其次选最高 mode。
fn pick_best_playlist(playlists: &serde_json::Value) -> Option<String> {
    let arr = playlists.as_array()?;
    if let Some(master) = arr.iter().find(|item| {
        item.get("mode").and_then(|v| v.as_i64()) == Some(0)
            && item.get("url").and_then(|v| v.as_str()).is_some_and(|s| !s.is_empty())
    }) {
        return master
            .get("url")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
    }
    let mut best: Option<(i64, &str)> = None;
    for item in arr {
        let url = item.get("url").and_then(|v| v.as_str()).unwrap_or("");
        if url.is_empty() {
            continue;
        }
        let mode = item.get("mode").and_then(|v| v.as_i64()).unwrap_or(0);
        if best.map(|(m, _)| mode > m).unwrap_or(true) {
            best = Some((mode, url));
        }
    }
    best.map(|(_, u)| u.to_string())
}

/// 通过 HTTP CONNECT 代理建一条到目标 host:port 的 TCP 隧道。失败返友好错误。
/// 协议非常简单 —— 给代理发 `CONNECT host:port HTTP/1.1`,等 `HTTP/1.x 200`,
/// 之后字节流就是到目标主机的透明隧道,可以直接喂给 tokio_tungstenite::client_async_tls。
pub(crate) async fn connect_via_http_proxy(
    proxy_url: &str,
    target_host: &str,
    target_port: u16,
) -> Result<TcpStream, String> {
    let proxy = url::Url::parse(proxy_url)
        .map_err(|e| format!("FC2 代理 URL 非法 ({proxy_url})：{e}"))?;
    let scheme = proxy.scheme();
    if scheme != "http" {
        return Err(format!(
            "FC2 暂只支持 http:// 代理（当前 scheme={scheme})。Clash / V2Ray 通常同时暴露 HTTP 和 SOCKS 端口,选 HTTP 端口"
        ));
    }
    let phost = proxy
        .host_str()
        .ok_or_else(|| "FC2 代理 URL 缺 host".to_string())?;
    let pport = proxy.port().unwrap_or(80);

    let mut stream = timeout(
        PROXY_CONNECT_TIMEOUT,
        TcpStream::connect((phost, pport)),
    )
    .await
    .map_err(|_| format!("FC2 连代理超时（{phost}:{pport})"))?
    .map_err(|e| format!("FC2 连代理失败（{phost}:{pport})：{e}"))?;

    let connect = format!(
        "CONNECT {target_host}:{target_port} HTTP/1.1\r\nHost: {target_host}:{target_port}\r\nProxy-Connection: keep-alive\r\nUser-Agent: {USER_AGENT}\r\n\r\n"
    );
    stream
        .write_all(connect.as_bytes())
        .await
        .map_err(|e| format!("FC2 代理 CONNECT 写入失败：{e}"))?;

    // 读响应头直到 \r\n\r\n
    let mut buf = Vec::with_capacity(1024);
    let mut tmp = [0u8; 512];
    let deadline = std::time::Instant::now() + PROXY_CONNECT_TIMEOUT;
    loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return Err("FC2 代理 CONNECT 响应超时".into());
        }
        let n = match timeout(remaining, stream.read(&mut tmp)).await {
            Err(_) => return Err("FC2 代理 CONNECT 响应超时".into()),
            Ok(Ok(0)) => return Err("FC2 代理 CONNECT 提前关闭".into()),
            Ok(Ok(n)) => n,
            Ok(Err(e)) => return Err(format!("FC2 代理 CONNECT 读取失败：{e}")),
        };
        buf.extend_from_slice(&tmp[..n]);
        if buf.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
        if buf.len() > 16 * 1024 {
            return Err("FC2 代理 CONNECT 响应头过大".into());
        }
    }

    let head = std::str::from_utf8(&buf)
        .map_err(|_| "FC2 代理 CONNECT 响应非 UTF-8".to_string())?;
    let first_line = head.lines().next().unwrap_or("");
    // 接受 200 OK 即可,1.0 / 1.1 都行
    if !(first_line.starts_with("HTTP/1.1 200") || first_line.starts_with("HTTP/1.0 200")) {
        return Err(format!(
            "FC2 代理 CONNECT 失败：{}",
            first_line.trim()
        ));
    }

    Ok(stream)
}
