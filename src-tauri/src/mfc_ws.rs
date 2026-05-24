//! MyFreeCams (MFC) 匿名 listing —— WebSocket 连 wchat server,登录后服务器自动推送
//! 所有 online model 的 SESSIONSTATE,我们收集一个时间窗口内的快照返回。
//!
//! 参考公开实现:
//!   - Damianonymous/MFCAuto (TypeScript,3000+ LOC,长连接 + 状态机)
//!   - Damianonymous/streamlink-plugins myfreecams.py(简化版 frame parser,只做 per-user)
//!
//! MFC README 明文写:
//!   > MFC servers won't send information for all online models until you've
//!   > logged as at least a guest.
//!
//! 这告诉我们,只要 hello + login(guest)成功,服务端就会自动 push SESSIONSTATE。
//! 不需要发任何额外订阅命令。
//!
//! ─── Frame 格式 ─────────────────────────────────────────────────────────
//!   {6 位 length}{6 位 fctype} {nFrom} {nTo} {nArg1} {nArg2}\n{payload}
//!
//! 第一个 token(连续无空格)是 12 位数字:前 6 位 length(整个 frame 除去自身的字节数,
//! 即从 fctype 起到 payload 末尾),后 6 位 fctype。后 4 个空格分隔 token 是 nFrom/nTo/
//! nArg1/nArg2,然后 \n,然后 length-余下字节是 payload(URL-encoded JSON / 字符串)。
//!
//! 实现要点:
//!   - 维护一个滚动 buffer,逐帧消费,partial frame 留待下次。
//!   - SESSIONSTATE = FCTYPE 20。payload 是 URL-encoded JSON,decode 后 parse。
//!   - vs (video state) 在 sMessage.vs 或 sMessage.m.vs:
//!       0  = FREECHAT(公开可看)
//!       12 = AWAY
//!       13 = GROUP SHOW
//!       91 = PRIVATE
//!       90/127 = OFFLINE
//!   - camserv 在 sMessage.u.camserv,topic 在 sMessage.m.topic,nickname 在 sMessage.nm。
//!   - HLS URL 模板 (参 streamlink myfreecams.py:289-293):
//!       h5video → https://{server}.myfreecams.com/NxServer/ngrp:mfc_{uid+1e8}.f4v_mobile/playlist.m3u8
//!       wzobs   → https://{server}.myfreecams.com/NxServer/ngrp:mfc_a_{uid+1e8}.f4v_mobile/playlist.m3u8
//!
//! ─── 代理 ────────────────────────────────────────────────────────────────
//! 跟 fc2_ws.rs 同款:HTTP CONNECT 代理（Clash 默认 http 端口,SOCKS5 不支持)。

use futures_util::SinkExt;
use futures_util::StreamExt;
use serde::Deserialize;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Once;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const REFERER: &str = "https://www.myfreecams.com/";

const SERVERCONFIG_URL: &str = "https://www.myfreecams.com/_js/serverconfig.js";

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);
const LISTING_WINDOW: Duration = Duration::from_secs(20);
const PROXY_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// FCTYPE 常量(只列我们关心的)。参 MFCAuto src/main/Constants.ts。
const FCTYPE_LOGIN: u32 = 1;
const FCTYPE_SESSIONSTATE: u32 = 20;
const FCTYPE_MANAGELIST: u32 = 63;
const FCTYPE_METRICS: u32 = 81;

fn ensure_crypto_provider() {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    });
}

#[derive(Debug, Serialize, Clone)]
pub struct MfcModel {
    /// model 用户名(全小写,用作 username slug)
    pub nm: String,
    /// 数字 user id
    pub uid: u64,
    /// video state: 0=FREECHAT (public)
    pub vs: i64,
    /// 房间话题
    #[serde(skip_serializing_if = "Option::is_none")]
    pub topic: Option<String>,
    /// camserv id(用来拼 HLS URL,从 serverconfig 的 server map 里找服务器名)
    pub camserv: u64,
    /// HLS URL（resolve 完成,直接给 hls.js)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hls_url: Option<String>,
    /// 头像缩略图(MFC 主页同款,基于 uid 在 mfcimg.com 拼出)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumb_url: Option<String>,
    /// camscore(MFC 模型质量评分,越高排越前;可用于排序)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub camscore: Option<f64>,
    /// 观众数
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rc: Option<u64>,
    /// 国家
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ServerConfig {
    #[serde(default)]
    chat_servers: Vec<String>,
    #[serde(default)]
    h5video_servers: HashMap<String, String>,
    #[serde(default)]
    wzobs_servers: HashMap<String, String>,
    #[serde(default)]
    ngvideo_servers: HashMap<String, String>,
}

/// 拉 serverconfig.js（其实是纯 JSON,只是扩展名带 .js)。
async fn fetch_serverconfig(proxy: Option<&str>) -> Result<ServerConfig, String> {
    let client = crate::h2_client_for(proxy)?;
    let resp = client
        .get(SERVERCONFIG_URL)
        .header("User-Agent", USER_AGENT)
        .header("Referer", REFERER)
        .header("Accept", "application/json, text/plain, */*")
        .send()
        .await
        .map_err(|e| format!("MFC serverconfig HTTP 失败:{e}"))?;
    if !resp.status().is_success() {
        return Err(format!("MFC serverconfig HTTP {}", resp.status()));
    }
    let text = resp
        .text()
        .await
        .map_err(|e| format!("MFC serverconfig body:{e}"))?;
    serde_json::from_str::<ServerConfig>(&text)
        .map_err(|e| format!("MFC serverconfig 解析失败:{e}"))
}

/// 在 serverconfig 的 3 个 server map 里找 camserv → (server_name, server_type)。
fn lookup_camserver<'a>(
    cfg: &'a ServerConfig,
    camserv: u64,
) -> Option<(&'a str, &'static str)> {
    let key = camserv.to_string();
    if let Some(s) = cfg.h5video_servers.get(&key) {
        return Some((s.as_str(), "h5video"));
    }
    if let Some(s) = cfg.wzobs_servers.get(&key) {
        return Some((s.as_str(), "wzobs"));
    }
    if let Some(s) = cfg.ngvideo_servers.get(&key) {
        // ngvideo 走 RTMP,HLS 不支持。前端会跳过。
        return Some((s.as_str(), "ngvideo"));
    }
    None
}

/// 用 mapped server name + uid + server_type 拼 HLS URL。
///
/// 用 streamlink myfreecams.py 实际使用的格式(2018-07 至 2026 一直用这个):
///   h5video: `https://{server}.myfreecams.com/NxServer/ngrp:mfc_{mid}.f4v_mobile/playlist.m3u8`
///   wzobs:   `https://{server}.myfreecams.com/NxServer/ngrp:mfc_a_{mid}.f4v_mobile/playlist.m3u8`
/// 其中:
///   - mid = 100_000_000 + uid
///   - server 是 mapped server name(`video999` 之类),从 h5video_servers/wzobs_servers
///     字典 *value* 查出来,**不是** camserv 数字本身
///
/// 注意:**不要**用 `previews.myfreecams.com/hls/NxServer/{camserv}/.../previewurl/...`
/// 那个格式,实测返 404(edgestream Akamai)。previews 那个是别人项目的过时路径。
fn build_hls_url(server: &str, server_type: &str, uid: u64) -> Option<String> {
    let mid = 100_000_000u64 + uid;
    match server_type {
        "h5video" => Some(format!(
            "https://{server}.myfreecams.com/NxServer/ngrp:mfc_{mid}.f4v_mobile/playlist.m3u8"
        )),
        "wzobs" => Some(format!(
            "https://{server}.myfreecams.com/NxServer/ngrp:mfc_a_{mid}.f4v_mobile/playlist.m3u8"
        )),
        _ => None, // ngvideo 不支持
    }
}

/// 用 uid 拼头像缩略图 URL —— MFC 主页 model 卡片同款。
/// 格式:https://img.mfcimg.com/photos2/{a}/{uid}/avatar.300x300.jpg
/// 其中 `a = uid / 100_000`(整数除法,十万级目录分桶)。
/// 2026-05 share page 抓包确认:uid=38333141 → photos2/383/38333141/...。
fn build_thumb_url(uid: u64) -> String {
    let bucket = uid / 100_000;
    format!(
        "https://img.mfcimg.com/photos2/{bucket}/{uid}/avatar.300x300.jpg"
    )
}

/// 入口:返回当前所有 vs==0 的 public model 列表。
///
/// 流程:fetch serverconfig → 随机选一个 chat_server → wss 连 → hello + login →
///       收 SESSIONSTATE 20 秒 → 关 WS → 过滤 vs==0 → 拼 HLS URL → 返列表。
///
/// 失败重试:如果第一个 chat_server 连不上,自动换一个,最多 3 次。
pub async fn list_online(proxy_url: Option<String>) -> Result<Vec<MfcModel>, String> {
    ensure_crypto_provider();
    let proxy = proxy_url.filter(|s| !s.trim().is_empty());

    eprintln!("[mfc] list_online start proxy={:?}", proxy);

    let cfg = fetch_serverconfig(proxy.as_deref()).await?;
    if cfg.chat_servers.is_empty() {
        return Err("MFC: serverconfig 里 chat_servers 为空".into());
    }
    eprintln!(
        "[mfc] serverconfig ok: {} chat servers, {} h5video, {} wzobs",
        cfg.chat_servers.len(),
        cfg.h5video_servers.len(),
        cfg.wzobs_servers.len(),
    );

    // 用进程级 round-robin 索引避免每次都打第一个 server
    use std::sync::atomic::{AtomicUsize, Ordering};
    static CURSOR: AtomicUsize = AtomicUsize::new(0);

    let mut packets: Vec<RawPacket> = Vec::new();
    let mut last_err = String::new();
    for attempt in 0..3u32 {
        let idx = CURSOR.fetch_add(1, Ordering::Relaxed) % cfg.chat_servers.len();
        let server = &cfg.chat_servers[idx];
        // dynworker / zbuild-edgetool 等特殊 server 跳过 —— 它们不是真的 wchatN。
        if !server.starts_with("wchat") {
            continue;
        }
        let ws_url = format!("wss://{server}.myfreecams.com/fcsl");
        eprintln!("[mfc] attempt {} → {}", attempt + 1, ws_url);

        match timeout(
            HANDSHAKE_TIMEOUT + LISTING_WINDOW,
            ws_listing_collect(&ws_url, proxy.as_deref()),
        )
        .await
        {
            Err(_) => last_err = "MFC: listing 收包超时".into(),
            Ok(Err(e)) => last_err = e,
            Ok(Ok(p)) => {
                packets = p;
                break;
            }
        }
    }

    if packets.is_empty() && !last_err.is_empty() {
        return Err(last_err);
    }
    eprintln!(
        "[mfc] collected {} SESSIONSTATE packets, parsing ...",
        packets.len()
    );

    let mut by_uid: HashMap<u64, MfcModel> = HashMap::new();
    for p in packets {
        if p.fctype != FCTYPE_SESSIONSTATE {
            continue;
        }
        let json_text = percent_decode(&p.payload);
        let Ok(val) = serde_json::from_str::<serde_json::Value>(&json_text) else {
            continue;
        };
        if let Some(m) = parse_session_state(&val) {
            // 同一 uid 可能收到多条 update,保留最新(后到者覆盖)
            by_uid.insert(m.uid, m);
        }
    }

    // 过滤 vs==0(FREECHAT 公开) + 已知 camserv,拼 HLS URL + 头像
    let mut out: Vec<MfcModel> = Vec::new();
    for (_, mut m) in by_uid {
        if m.vs != 0 {
            continue;
        }
        if m.nm.is_empty() {
            continue;
        }
        if let Some((mapped, stype)) = lookup_camserver(&cfg, m.camserv) {
            m.hls_url = build_hls_url(mapped, stype, m.uid);
        }
        m.thumb_url = Some(build_thumb_url(m.uid));
        out.push(m);
    }
    // camscore 高的排前
    out.sort_by(|a, b| {
        b.camscore
            .unwrap_or(0.0)
            .partial_cmp(&a.camscore.unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    eprintln!("[mfc] final list: {} public models", out.len());
    Ok(out)
}

/// 诊断入口 —— 同样跑一次 listing 流程,但返回多行文字报告而不是 model 列表。
/// 报告内容:serverconfig 状态、选了哪个 wchat、握手是否 ok、收了多少 frame、SESSIONSTATE
/// 数量、不同 vs 状态分布、最终 public model 数量、整个流程耗时。
///
/// 用户在 DevTools 调:
///   `await (await import('@tauri-apps/api/core')).invoke('mfc_diagnose',{proxyUrl:'http://127.0.0.1:7890'})`
pub async fn diagnose(proxy_url: Option<String>) -> Result<String, String> {
    use std::collections::BTreeMap;
    use std::fmt::Write as _;

    ensure_crypto_provider();
    let proxy = proxy_url.filter(|s| !s.trim().is_empty());
    let started = std::time::Instant::now();
    let mut log = String::new();
    let _ = writeln!(log, "[mfc diag] proxy={:?}", proxy);

    let cfg = match fetch_serverconfig(proxy.as_deref()).await {
        Ok(c) => c,
        Err(e) => return Ok(format!("{log}\n[mfc diag] serverconfig 失败:{e}")),
    };
    let _ = writeln!(
        log,
        "[mfc diag] serverconfig ok: chat={} h5video={} wzobs={} ngvideo={}",
        cfg.chat_servers.len(),
        cfg.h5video_servers.len(),
        cfg.wzobs_servers.len(),
        cfg.ngvideo_servers.len()
    );

    let server = cfg
        .chat_servers
        .iter()
        .find(|s| s.starts_with("wchat"))
        .cloned()
        .ok_or_else(|| "MFC: chat_servers 里没找到 wchatN".to_string())?;
    let ws_url = format!("wss://{server}.myfreecams.com/fcsl");
    let _ = writeln!(log, "[mfc diag] ws_url={ws_url}");

    let t_ws = std::time::Instant::now();
    let packets = match timeout(
        HANDSHAKE_TIMEOUT + LISTING_WINDOW,
        ws_listing_collect(&ws_url, proxy.as_deref()),
    )
    .await
    {
        Err(_) => return Ok(format!("{log}\n[mfc diag] listing 超时")),
        Ok(Err(e)) => return Ok(format!("{log}\n[mfc diag] listing 失败:{e}")),
        Ok(Ok(p)) => p,
    };
    let _ = writeln!(
        log,
        "[mfc diag] WS 收包 {} 个,耗时 {} 秒",
        packets.len(),
        t_ws.elapsed().as_secs(),
    );

    // 类型分布 + SESSIONSTATE 中 vs 分布
    let mut by_type: BTreeMap<u32, u64> = BTreeMap::new();
    let mut by_vs: BTreeMap<i64, u64> = BTreeMap::new();
    let mut sessstate_count = 0u64;
    for p in &packets {
        *by_type.entry(p.fctype).or_insert(0) += 1;
        if p.fctype == FCTYPE_SESSIONSTATE {
            sessstate_count += 1;
            let decoded = percent_decode(&p.payload);
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&decoded) {
                let vs = v
                    .get("vs")
                    .and_then(|x| x.as_i64())
                    .or_else(|| v.pointer("/m/vs").and_then(|x| x.as_i64()))
                    .unwrap_or(-1);
                *by_vs.entry(vs).or_insert(0) += 1;
            }
        }
    }
    let _ = writeln!(log, "[mfc diag] frame fctype 分布:");
    for (t, c) in &by_type {
        let _ = writeln!(log, "  fctype={t} count={c}");
    }
    let _ = writeln!(
        log,
        "[mfc diag] SESSIONSTATE={} (其中能解出 vs 字段的 vs 分布如下)",
        sessstate_count
    );
    for (vs, c) in &by_vs {
        let label = match vs {
            0 => " (FREECHAT/public)",
            2 => " (AWAY)",
            12 => " (PRIVATE)",
            13 => " (GROUP)",
            90 => " (OFFLINE)",
            91 => " (PRIVATE)",
            127 => " (OFFLINE)",
            _ => "",
        };
        let _ = writeln!(log, "  vs={vs}{label} count={c}");
    }

    let _ = writeln!(log, "[mfc diag] 总耗时 {} 秒", started.elapsed().as_secs());
    Ok(log)
}

/// SESSIONSTATE JSON → MfcModel。
/// 字段路径参 MFCAuto Constants.ts + 实际 MFC 推送样本:
///   { nm, uid, vs, m:{topic, camscore, country, rc, sid, ...}, u:{camserv, ...} }
fn parse_session_state(v: &serde_json::Value) -> Option<MfcModel> {
    // 顶层 uid 必有
    let uid = v.get("uid").and_then(|x| x.as_u64())?;
    // nm 在顶层或 m 里(后期 update 可能只发增量)
    let nm = v
        .get("nm")
        .and_then(|x| x.as_str())
        .or_else(|| v.pointer("/m/nm").and_then(|x| x.as_str()))
        .unwrap_or("")
        .to_string();
    let vs = v
        .get("vs")
        .and_then(|x| x.as_i64())
        .or_else(|| v.pointer("/m/vs").and_then(|x| x.as_i64()))
        .unwrap_or(-1);
    let camserv = v
        .pointer("/u/camserv")
        .and_then(|x| x.as_u64())
        .or_else(|| v.pointer("/m/camserv").and_then(|x| x.as_u64()))
        .unwrap_or(0);
    let topic = v
        .pointer("/m/topic")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    let camscore = v
        .pointer("/m/camscore")
        .and_then(|x| x.as_f64());
    let rc = v.pointer("/m/rc").and_then(|x| x.as_u64());
    let country = v
        .pointer("/u/country")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());

    // 极度初始的 update 可能只携 uid+vs,没 nm/camserv → 跳过
    if nm.is_empty() && camserv == 0 {
        return None;
    }

    Some(MfcModel {
        nm,
        uid,
        vs,
        topic,
        camserv,
        hls_url: None,
        thumb_url: None,
        camscore,
        rc,
        country,
    })
}

#[derive(Debug)]
struct RawPacket {
    fctype: u32,
    #[allow(dead_code)]
    n_from: u32,
    #[allow(dead_code)]
    n_to: u32,
    #[allow(dead_code)]
    n_arg1: u32,
    #[allow(dead_code)]
    n_arg2: u32,
    payload: String,
}

/// 连 WS、握手登录、收 LISTING_WINDOW 期内所有 frame、关 WS,返回 raw packet 列表。
async fn ws_listing_collect(
    ws_url: &str,
    proxy: Option<&str>,
) -> Result<Vec<RawPacket>, String> {
    let parsed = url::Url::parse(ws_url).map_err(|e| format!("MFC wss URL 非法:{e}"))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "MFC wss URL 缺 host".to_string())?
        .to_string();
    let port = parsed.port().unwrap_or(443);

    let request = ws_url
        .into_client_request()
        .map_err(|e| format!("MFC wss 构造请求失败:{e}"))?;

    let (mut ws_stream, _resp) = match proxy {
        None => tokio_tungstenite::connect_async(request)
            .await
            .map_err(|e| format!("MFC wss 直连失败:{e}"))?,
        Some(p) => {
            let tcp = connect_via_http_proxy(p, &host, port).await?;
            tokio_tungstenite::client_async_tls(request, tcp)
                .await
                .map_err(|e| format!("MFC wss 代理握手失败:{e}"))?
        }
    };

    // MFC 握手两步(streamlink mfc.py:149-151):
    //   1) "hello fcserver\n\0"   ← 协议探针,服务端必须先看到才能往下走
    //   2) "1 0 0 20071025 0 {nonce}@guest:guest\n"  ← FCTYPE=1 LOGIN as guest
    ws_stream
        .send(Message::Text("hello fcserver\n\u{0}".into()))
        .await
        .map_err(|e| format!("MFC wss send hello 失败:{e}"))?;

    // 32 字符 hex nonce 模拟 uuid4()
    let nonce = simple_hex_nonce();
    let login = format!("1 0 0 20071025 0 {nonce}@guest:guest\n");
    ws_stream
        .send(Message::Text(login))
        .await
        .map_err(|e| format!("MFC wss send login 失败:{e}"))?;

    let deadline = std::time::Instant::now() + LISTING_WINDOW;
    let mut buffer = String::new();
    let mut packets: Vec<RawPacket> = Vec::new();
    let mut logged_in = false;

    loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            break;
        }
        let msg = match timeout(remaining, ws_stream.next()).await {
            Err(_) => break, // window 到
            Ok(None) => return Err("MFC wss 提前断开".into()),
            Ok(Some(Err(e))) => return Err(format!("MFC wss 读取失败:{e}")),
            Ok(Some(Ok(m))) => m,
        };
        match msg {
            Message::Text(t) => buffer.push_str(&t),
            Message::Binary(b) => buffer.push_str(&String::from_utf8_lossy(&b)),
            Message::Close(_) => break,
            Message::Ping(p) => {
                let _ = ws_stream.send(Message::Pong(p)).await;
                continue;
            }
            Message::Pong(_) | Message::Frame(_) => continue,
        }

        // 滚动消费 buffer
        loop {
            match try_parse_frame(&buffer) {
                None => break,
                Some((frame, consumed)) => {
                    if frame.fctype == FCTYPE_LOGIN && !logged_in {
                        logged_in = true;
                        eprintln!(
                            "[mfc] login ack received, beginning {}-s listing window",
                            LISTING_WINDOW.as_secs()
                        );
                    }
                    if frame.fctype == FCTYPE_SESSIONSTATE
                        || frame.fctype == FCTYPE_MANAGELIST
                    {
                        // SESSIONSTATE 直接收;MANAGELIST 是好友列表 / 在线列表批量推送(里面也含 model)
                        packets.push(frame);
                    } else if frame.fctype == FCTYPE_METRICS {
                        // 81 metrics — 忽略
                    }
                    // 其他类型(CMESG/PMESG/TOKENINC/...)忽略
                    buffer.drain(..consumed);
                }
            }
        }
    }

    // 礼貌关闭(streamlink mfc.py:199 也发 99)
    let _ = ws_stream.send(Message::Text("99 0 0 0 0".into())).await;
    let _ = ws_stream.close(None).await;

    Ok(packets)
}

/// 解 1 帧。返 (frame, total_bytes_consumed) 或 None(buffer 不够)。
///
/// MFC frame 实际格式(2026-05 抓包确认,跟 streamlink 老代码注释不同):
///   `LLLLLL{body}`
///   - LLLLLL 是 6 位 zero-padded ASCII 数字,表示 body 字节数(不含自己)
///   - body 是 `fctype " " sender " " recipient " " arg1 " " arg2 " " payload`
///     5 个 token 用单空格分隔,**没有 newline**
///   - payload 可能为空(末尾 token 后紧接 next frame 的 6 位 length)
///   - 多 frame 紧接拼在一起,没有任何 separator
///
/// payload 形态:
///   - SESSIONSTATE(20) / MANAGELIST(63): URL-encoded JSON
///   - LOGIN ack(1): 明文 Guest 名 / numeric uid
///   - METRICS(81): URL-encoded JSON
fn try_parse_frame(buf: &str) -> Option<(RawPacket, usize)> {
    // 至少 6 字节 length 头
    if buf.len() < 6 {
        return None;
    }
    let header = &buf[..6];
    if !header.bytes().all(|b| b.is_ascii_digit()) {
        // buffer 错位 —— 跳到下一个看起来像 6 位数字头的位置
        let bytes = buf.as_bytes();
        for pos in 1..bytes.len().saturating_sub(6) {
            if bytes[pos..pos + 6].iter().all(|b| b.is_ascii_digit()) {
                return Some((
                    RawPacket {
                        fctype: 0,
                        n_from: 0,
                        n_to: 0,
                        n_arg1: 0,
                        n_arg2: 0,
                        payload: String::new(),
                    },
                    pos,
                ));
            }
        }
        return None;
    }
    let length: usize = header.parse().ok()?;
    let body_start = 6;
    if buf.len() < body_start + length {
        return None; // 等更多数据
    }
    let body = &buf[body_start..body_start + length];
    // 用 splitn(6) 切前 5 个空格,第 6 段是 payload(payload 内部可能含 URL-encoded
    // 空格 %20,但裸空格不会出现 —— payload 是 JSON / 字符串值,服务端会 escape)
    let mut it = body.splitn(6, ' ');
    let fctype: u32 = it.next()?.parse().ok()?;
    let n_from: u32 = it.next()?.parse().ok()?;
    let n_to: u32 = it.next()?.parse().ok()?;
    let n_arg1: u32 = it.next()?.parse().ok()?;
    let n_arg2: u32 = it.next()?.parse().ok()?;
    let payload = it.next().unwrap_or("").to_string();

    Some((
        RawPacket {
            fctype,
            n_from,
            n_to,
            n_arg1,
            n_arg2,
            payload,
        },
        body_start + length,
    ))
}

/// 标准 percent-encoding 解码(`%XX` → byte)。失败的转义保留原样,不报错。
/// 仅处理 MFC payload(纯 ascii / UTF-8,数量极小,不值得拉 percent-encoding 直接依赖)。
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(h), Some(l)) = (hi, lo) {
                out.push(((h << 4) | l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// 32 字符 ascii hex,基于系统时间 + 进程地址做轻量 mix(用作 LOGIN nonce —— 服务端
/// 只是要求是 32 字符占位,不验证签名)。
fn simple_hex_nonce() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let ptr = simple_hex_nonce as *const () as usize as u128;
    let mix = nanos ^ ptr.wrapping_mul(0x9E3779B97F4A7C15);
    format!("{:032x}", mix)
}

/// 完全复用 fc2_ws.rs 的 HTTP CONNECT 代理实现(把它内联在这里避免跨 module 公开 API)。
async fn connect_via_http_proxy(
    proxy_url: &str,
    target_host: &str,
    target_port: u16,
) -> Result<TcpStream, String> {
    let proxy = url::Url::parse(proxy_url)
        .map_err(|e| format!("MFC 代理 URL 非法 ({proxy_url}):{e}"))?;
    let scheme = proxy.scheme();
    if scheme != "http" {
        return Err(format!(
            "MFC 暂只支持 http:// 代理(当前 scheme={scheme})。Clash / V2Ray 选 HTTP 端口"
        ));
    }
    let phost = proxy
        .host_str()
        .ok_or_else(|| "MFC 代理 URL 缺 host".to_string())?;
    let pport = proxy.port().unwrap_or(80);

    let mut stream = timeout(PROXY_CONNECT_TIMEOUT, TcpStream::connect((phost, pport)))
        .await
        .map_err(|_| format!("MFC 连代理超时({phost}:{pport})"))?
        .map_err(|e| format!("MFC 连代理失败({phost}:{pport}):{e}"))?;

    let connect = format!(
        "CONNECT {target_host}:{target_port} HTTP/1.1\r\nHost: {target_host}:{target_port}\r\nProxy-Connection: keep-alive\r\nUser-Agent: {USER_AGENT}\r\n\r\n"
    );
    stream
        .write_all(connect.as_bytes())
        .await
        .map_err(|e| format!("MFC 代理 CONNECT 写入失败:{e}"))?;

    let mut buf = Vec::with_capacity(1024);
    let mut tmp = [0u8; 512];
    let deadline = std::time::Instant::now() + PROXY_CONNECT_TIMEOUT;
    loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return Err("MFC 代理 CONNECT 响应超时".into());
        }
        let n = match timeout(remaining, stream.read(&mut tmp)).await {
            Err(_) => return Err("MFC 代理 CONNECT 响应超时".into()),
            Ok(Ok(0)) => return Err("MFC 代理 CONNECT 提前关闭".into()),
            Ok(Ok(n)) => n,
            Ok(Err(e)) => return Err(format!("MFC 代理 CONNECT 读取失败:{e}")),
        };
        buf.extend_from_slice(&tmp[..n]);
        if buf.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
        if buf.len() > 16 * 1024 {
            return Err("MFC 代理 CONNECT 响应头过大".into());
        }
    }
    let head = std::str::from_utf8(&buf)
        .map_err(|_| "MFC 代理 CONNECT 响应非 UTF-8".to_string())?;
    let first_line = head.lines().next().unwrap_or("");
    if !(first_line.starts_with("HTTP/1.1 200") || first_line.starts_with("HTTP/1.0 200")) {
        return Err(format!("MFC 代理 CONNECT 失败:{}", first_line.trim()));
    }
    Ok(stream)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_frame() {
        // MFC frame 实际格式(2026-05 抓包):
        //   LLLLLL{body}
        //   - LLLLLL 6 位 zero-padded length(body 字节数)
        //   - body = "fctype N1 N2 A1 A2 payload"(5 个空格,无 newline)
        //
        // 这里构造:fctype=1 LOGIN, N1=0, N2=0, A1=0, A2=0, payload="Guest30902"
        //   body = "1 0 0 0 0 Guest30902" = 20 字符
        //   header = "000020"
        //   frame = "0000201 0 0 0 0 Guest30902" 共 26 字符
        let body = "1 0 0 0 0 Guest30902";
        assert_eq!(body.len(), 20);
        let frame = format!("000020{body}");
        assert_eq!(frame.len(), 26);
        let (p, c) = try_parse_frame(&frame).expect("frame");
        assert_eq!(p.fctype, 1);
        assert_eq!(p.n_from, 0);
        assert_eq!(p.payload, "Guest30902");
        assert_eq!(c, 26);
    }

    #[test]
    fn parses_login_ack_then_next_frame_back_to_back() {
        // 用户实测抓的 msg #1:登录回包 + 两个 fctype=33 帧紧接,无分隔
        let raw = "0000281 0 261247767 0 0 Guest3090200001933 0 261247767 1 0 00001933 0 261247767 1 0 ";
        let (p1, c1) = try_parse_frame(raw).expect("frame 1");
        assert_eq!(p1.fctype, 1, "frame 1 应该是 LOGIN ack");
        assert_eq!(p1.payload, "Guest30902");
        assert_eq!(c1, 34);
        let (p2, c2) = try_parse_frame(&raw[c1..]).expect("frame 2");
        assert_eq!(p2.fctype, 33);
        assert_eq!(p2.n_to, 261247767);
        assert_eq!(c2, 25);
        let (p3, _) = try_parse_frame(&raw[c1 + c2..]).expect("frame 3");
        assert_eq!(p3.fctype, 33);
    }

    #[test]
    fn parses_url_encoded_json_payload() {
        // 用户实测抓的 msg #2:fctype=30,payload 是 URL-encoded JSON
        let raw = "00024830 1 261247767 0 0 %7B%22_err%22%3A0%2C%22ctx%22%3A%5B261247767%2C0%2C1%2C0%2C0%2C0%2C0%2C5932019%5D%2C%22ctxenc%22%3A%2274e705a11b%252FWzI2MTI0Nzc2NywwLDEsMCwwLDAsMCw1OTMyMDE5XQ%253D%253D%22%2C%22cxid%22%3A4681494%2C%22tkx%22%3A%2274e705a11b%22%7D";
        let (p, c) = try_parse_frame(raw).expect("frame");
        assert_eq!(p.fctype, 30);
        assert_eq!(c, 254);
        let decoded = percent_decode(&p.payload);
        assert!(decoded.contains("\"_err\":0"));
        assert!(decoded.contains("\"cxid\":4681494"));
    }

    #[test]
    fn returns_none_on_short_buffer() {
        assert!(try_parse_frame("0000200").is_none());
    }

    #[test]
    fn parses_session_state_with_topic_and_camserv() {
        let v: serde_json::Value = serde_json::json!({
            "nm": "alice",
            "uid": 42,
            "vs": 0,
            "m": { "topic": "Hello", "camscore": 88.5, "rc": 7 },
            "u": { "camserv": 1099, "country": "US" },
        });
        let m = parse_session_state(&v).expect("model");
        assert_eq!(m.nm, "alice");
        assert_eq!(m.uid, 42);
        assert_eq!(m.vs, 0);
        assert_eq!(m.camserv, 1099);
        assert_eq!(m.topic.as_deref(), Some("Hello"));
        assert_eq!(m.camscore, Some(88.5));
        assert_eq!(m.rc, Some(7));
        assert_eq!(m.country.as_deref(), Some("US"));
    }

    #[test]
    fn handles_camserver_lookup() {
        let mut cfg = ServerConfig {
            chat_servers: vec![],
            h5video_servers: HashMap::new(),
            wzobs_servers: HashMap::new(),
            ngvideo_servers: HashMap::new(),
        };
        cfg.h5video_servers
            .insert("1099".into(), "myvideo99".into());
        cfg.wzobs_servers
            .insert("1199".into(), "video699".into());

        assert_eq!(lookup_camserver(&cfg, 1099), Some(("myvideo99", "h5video")));
        assert_eq!(lookup_camserver(&cfg, 1199), Some(("video699", "wzobs")));
        assert_eq!(lookup_camserver(&cfg, 9999), None);
    }

    #[test]
    fn builds_h5video_hls_url() {
        // streamlink myfreecams.py 用的 live URL 格式(mapped server,不是 camserv 数字)
        let u = build_hls_url("video999", "h5video", 12345).unwrap();
        assert_eq!(
            u,
            "https://video999.myfreecams.com/NxServer/ngrp:mfc_100012345.f4v_mobile/playlist.m3u8"
        );
    }

    #[test]
    fn builds_wzobs_hls_url() {
        let u = build_hls_url("video699", "wzobs", 12345).unwrap();
        assert_eq!(
            u,
            "https://video699.myfreecams.com/NxServer/ngrp:mfc_a_100012345.f4v_mobile/playlist.m3u8"
        );
    }

    #[test]
    fn thumb_url_buckets_by_hundred_thousand() {
        // 实测 uid=38333141 → photos2/383/...,bucket 是 uid / 100_000
        assert_eq!(
            build_thumb_url(38_333_141),
            "https://img.mfcimg.com/photos2/383/38333141/avatar.300x300.jpg"
        );
        assert_eq!(
            build_thumb_url(1_234_567),
            "https://img.mfcimg.com/photos2/12/1234567/avatar.300x300.jpg"
        );
        assert_eq!(
            build_thumb_url(7),
            "https://img.mfcimg.com/photos2/0/7/avatar.300x300.jpg"
        );
    }

    #[test]
    fn percent_decode_basic() {
        assert_eq!(percent_decode("hello%20world"), "hello world");
        assert_eq!(percent_decode("%7B%22a%22%3A1%7D"), "{\"a\":1}");
        // 非法转义保留
        assert_eq!(percent_decode("%ZZ"), "%ZZ");
        // 截断
        assert_eq!(percent_decode("%2"), "%2");
    }
}
