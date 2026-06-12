//! 本地 hyper 流式 HTTP 代理 —— 给 FLV / MPEG-TS 直播用。
//!
//! 背景：Tauri `register_asynchronous_uri_scheme_protocol` 的 `responder.respond()`
//! 只能给完整 `Response<Vec<u8>>`，无法 chunked streaming。FLV 直播是无限流，
//! `read_to_end` 会一直读到上限 / 超时 → mpegts.js HttpStatusCodeInvalid。
//!
//! 方案：在 app 启动时 spawn 一个 hyper server 绑 127.0.0.1:0（系统给端口）。
//! 前端把 FLV URL 包成 `http://127.0.0.1:{port}/?url=ENC&ua=ENC&referer=ENC`。
//! 服务端用 ureq spawn_blocking 拉上游，通过 tokio mpsc channel 把 Bytes pipe 到
//! hyper response body（StreamBody），客户端就能渐进收到 chunks。
//!
//! mpegts.js / `<video>` 元素能直接吃 chunked HTTP 响应，FLV live 可以无限播。

use bytes::Bytes;
use futures_util::StreamExt;
use http_body_util::{combinators::BoxBody, BodyExt, Full, StreamBody};
use hyper::body::{Frame, Incoming};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use std::collections::HashMap;
use std::convert::Infallible;
use std::io::Read;
use std::sync::OnceLock;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

const READ_BUF: usize = 64 * 1024;
const CHANNEL_CAP: usize = 32;
const READ_TIMEOUT_SECS: u64 = 600; // 10 min per request；足够单次 FLV live

static PROXY_PORT: OnceLock<u16> = OnceLock::new();

/// App 启动时调一次；后续可通过 `port()` 拿端口。
pub fn start() {
    if PROXY_PORT.get().is_some() {
        return;
    }
    // 同步 bind 取端口（避免前端拿不到端口）
    let listener = match std::net::TcpListener::bind("127.0.0.1:0") {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[stream_proxy] bind failed: {e}");
            return;
        }
    };
    let port = match listener.local_addr() {
        Ok(a) => a.port(),
        Err(e) => {
            eprintln!("[stream_proxy] local_addr failed: {e}");
            return;
        }
    };
    if let Err(e) = listener.set_nonblocking(true) {
        eprintln!("[stream_proxy] set_nonblocking failed: {e}");
        return;
    }
    let _ = PROXY_PORT.set(port);

    tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::from_std(listener) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[stream_proxy] tokio convert failed: {e}");
                return;
            }
        };
        loop {
            let (stream, _) = match listener.accept().await {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[stream_proxy] accept err: {e}");
                    continue;
                }
            };
            let io = TokioIo::new(stream);
            tauri::async_runtime::spawn(async move {
                if let Err(e) = http1::Builder::new()
                    .keep_alive(true)
                    .serve_connection(io, service_fn(handle))
                    .await
                {
                    eprintln!("[stream_proxy] serve err: {e}");
                }
            });
        }
    });
}

pub fn port() -> Option<u16> {
    PROXY_PORT.get().copied()
}

fn cors_headers(builder: hyper::http::response::Builder) -> hyper::http::response::Builder {
    builder
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Methods", "GET, OPTIONS, HEAD")
        .header("Access-Control-Allow-Headers", "*")
        .header(
            "Access-Control-Expose-Headers",
            "Content-Length, Content-Range, Accept-Ranges",
        )
}

type BoxedBody = BoxBody<Bytes, std::io::Error>;

fn err_resp(status: StatusCode, msg: &str) -> Response<BoxedBody> {
    cors_headers(Response::builder().status(status))
        .header("Content-Type", "text/plain; charset=utf-8")
        .body(boxed_full(msg.to_string().into()))
        .unwrap()
}

fn boxed_full(b: Bytes) -> BoxedBody {
    let full: Full<Bytes> = Full::new(b);
    full.map_err(|never| match never {}).boxed()
}

fn normalize_music_quality(quality: Option<&str>) -> String {
    match quality.unwrap_or("320k") {
        "128k" => "128k".to_string(),
        "192k" => "192k".to_string(),
        "320k" => "320k".to_string(),
        "flac" | "flac24bit" => "flac".to_string(),
        _ => "320k".to_string(),
    }
}

fn insert_music_field(
    obj: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
    value: Option<&String>,
) {
    if let Some(v) = value {
        if !v.is_empty() {
            obj.insert(key.to_string(), serde_json::Value::String(v.clone()));
        }
    }
}

fn resolve_music_stream_url(
    params: &HashMap<String, String>,
    proxy: Option<&str>,
) -> Result<String, String> {
    let base = params
        .get("music_base")
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "missing music_base".to_string())?;
    let endpoint = format!("{base}/api/music/url");
    let song_id = params
        .get("song_id")
        .or_else(|| params.get("id"))
        .cloned()
        .unwrap_or_default();
    let source = params
        .get("source")
        .cloned()
        .unwrap_or_else(|| "kw".to_string());
    let songmid = params
        .get("songmid")
        .cloned()
        .or_else(|| song_id.split_once('_').map(|(_, tail)| tail.to_string()))
        .unwrap_or_else(|| song_id.clone());
    let name = params.get("name").cloned().unwrap_or_default();
    let artist = params.get("artist").cloned().unwrap_or_default();

    if song_id.is_empty() || name.is_empty() || artist.is_empty() {
        return Err("music song info incomplete".to_string());
    }

    let mut song_info = serde_json::Map::new();
    song_info.insert("id".to_string(), serde_json::Value::String(song_id));
    song_info.insert("name".to_string(), serde_json::Value::String(name));
    song_info.insert("singer".to_string(), serde_json::Value::String(artist.clone()));
    song_info.insert("artist".to_string(), serde_json::Value::String(artist));
    song_info.insert("source".to_string(), serde_json::Value::String(source));
    song_info.insert("songmid".to_string(), serde_json::Value::String(songmid.clone()));
    song_info.insert("songId".to_string(), serde_json::Value::String(songmid));
    insert_music_field(&mut song_info, "hash", params.get("hash"));
    insert_music_field(&mut song_info, "interval", params.get("durationText"));
    insert_music_field(&mut song_info, "copyrightId", params.get("copyrightId"));
    insert_music_field(&mut song_info, "albumId", params.get("albumId"));
    insert_music_field(&mut song_info, "lrcUrl", params.get("lrcUrl"));
    insert_music_field(&mut song_info, "mrcUrl", params.get("mrcUrl"));
    insert_music_field(&mut song_info, "trcUrl", params.get("trcUrl"));

    let body = serde_json::json!({
        "songInfo": serde_json::Value::Object(song_info),
        "quality": normalize_music_quality(params.get("quality").map(String::as_str)),
    });

    let mut agent_builder = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(45))
        .redirects(10);
    if let Some(p) = proxy {
        if !p.is_empty() {
            if let Ok(prx) = ureq::Proxy::new(p) {
                agent_builder = agent_builder.proxy(prx);
            }
        }
    }
    let agent = agent_builder.build();
    let mut req = agent
        .post(&endpoint)
        .set("Accept", "application/json")
        .set("Content-Type", "application/json");
    if let Some(token) = params.get("music_token") {
        if !token.is_empty() {
            req = req.set("x-user-token", token);
        }
    }

    let resp = req
        .send_string(&body.to_string())
        .map_err(|e| format!("music url: {e}"))?;
    let status = resp.status();
    let mut text = String::new();
    resp.into_reader()
        .read_to_string(&mut text)
        .map_err(|e| format!("music url body: {e}"))?;
    if status >= 400 {
        return Err(format!("music url HTTP {status}: {text}"));
    }
    let payload: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("music url json: {e}: {text}"))?;
    let url = payload
        .get("url")
        .and_then(|v| v.as_str())
        .or_else(|| payload.get("data").and_then(|d| d.get("url")).and_then(|v| v.as_str()))
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            payload
                .get("error")
                .and_then(|v| v.as_str())
                .unwrap_or("music url missing")
                .to_string()
        })?;
    Ok(url.to_string())
}

async fn handle(req: Request<Incoming>) -> Result<Response<BoxedBody>, Infallible> {
    // OPTIONS preflight
    if req.method() == Method::OPTIONS {
        let resp = cors_headers(Response::builder().status(StatusCode::NO_CONTENT))
            .body(boxed_full(Bytes::new()))
            .unwrap();
        return Ok(resp);
    }
    if req.method() != Method::GET && req.method() != Method::HEAD {
        return Ok(err_resp(StatusCode::METHOD_NOT_ALLOWED, "GET/HEAD only"));
    }

    let query = req.uri().query().unwrap_or("");
    let params: HashMap<String, String> = url::form_urlencoded::parse(query.as_bytes())
        .into_owned()
        .collect();

    let ua = params.get("ua").cloned();
    let referer = params.get("referer").cloned();
    let origin = params.get("origin").cloned();
    let proxy = params.get("proxy").cloned();
    let decrypt_mode = params.get("decrypt").cloned();
    let range = req
        .headers()
        .get("range")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.to_string());

    let target_url = if params.contains_key("music_base") {
        let params_for_resolve = params.clone();
        let proxy_for_resolve = proxy.clone();
        match tauri::async_runtime::spawn_blocking(move || {
            resolve_music_stream_url(&params_for_resolve, proxy_for_resolve.as_deref())
        })
        .await
        {
            Ok(Ok(url)) => url,
            Ok(Err(e)) => return Ok(err_resp(StatusCode::BAD_GATEWAY, &e)),
            Err(e) => {
                return Ok(err_resp(
                    StatusCode::BAD_GATEWAY,
                    &format!("music resolver task: {e}"),
                ))
            }
        }
    } else {
        let Some(url) = params.get("url").cloned() else {
            return Ok(err_resp(StatusCode::BAD_REQUEST, "missing url param"));
        };
        url
    };

    // sample-aes 解密代理 —— amateur.tv / a0s.net 系平台。
    // 前端传 url=<fmp4-hls m3u8 URL>&decrypt=sample-aes&proxy=...
    // 这里拉 m3u8 + key + fragment chunked,SAMPLE-AES 逐 sample 原地解密,推明文 fMP4。
    if decrypt_mode.as_deref() == Some("sample-aes") {
        return handle_sample_aes_decrypt(req.method().clone(), target_url, proxy).await;
    }

    // wss:// 目标 → 走 AmateurTV / a0s.net 系平台的 WS→fMP4 字节流桥
    // (HTTP fmp4 端点对匿名拿到的是 FastEVO 加密的干扰流,真流走 WebSocket Binary)
    if target_url.starts_with("wss://") || target_url.starts_with("ws://") {
        return handle_ws_bridge(req.method().clone(), target_url, proxy).await;
    }

    // 同步 ureq 在阻塞线程里跑；通过 channel 推 chunks
    let (tx, rx) = mpsc::channel::<Result<Bytes, std::io::Error>>(CHANNEL_CAP);

    // 先开一个 oneshot 拿响应状态码 / content-type
    let (head_tx, head_rx) =
        tokio::sync::oneshot::channel::<Result<(u16, Option<String>, Option<String>, Option<String>), String>>();

    let target_url_for_thread = target_url.clone();
    let ua_for_thread = ua.clone();
    let referer_for_thread = referer.clone();
    let origin_for_thread = origin.clone();
    let proxy_for_thread = proxy.clone();
    let range_for_thread = range.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut agent_builder = ureq::AgentBuilder::new()
            .timeout(Duration::from_secs(READ_TIMEOUT_SECS))
            .redirects(10);
        // HTTP/SOCKS 代理透传 —— 海外 a0s.net / Twitch CDN 等需走 Clash
        if let Some(p) = proxy_for_thread.as_deref() {
            if !p.is_empty() {
                match ureq::Proxy::new(p) {
                    Ok(prx) => {
                        agent_builder = agent_builder.proxy(prx);
                    }
                    Err(e) => {
                        eprintln!("[stream_proxy] proxy parse failed '{p}': {e}");
                    }
                }
            }
        }
        let agent = agent_builder.build();
        let mut req = agent.get(&target_url_for_thread);
        if let Some(u) = ua_for_thread.as_deref() {
            if !u.is_empty() {
                req = req.set("User-Agent", u);
            }
        }
        if let Some(r) = referer_for_thread.as_deref() {
            if !r.is_empty() {
                req = req.set("Referer", r);
            }
        }
        if let Some(o) = origin_for_thread.as_deref() {
            if !o.is_empty() {
                req = req.set("Origin", o);
            }
        }
        if let Some(r) = range_for_thread.as_deref() {
            if !r.is_empty() {
                req = req.set("Range", r);
            }
        }
        req = req.set("Accept", "*/*");
        req = req.set("Connection", "keep-alive");

        let resp = match req.call() {
            Ok(r) => {
                eprintln!(
                    "[stream_proxy] upstream {} for {} (proxy={:?}, ua={:?})",
                    r.status(),
                    target_url_for_thread.split('?').next().unwrap_or(&target_url_for_thread),
                    proxy_for_thread,
                    ua_for_thread.as_deref().map(|s| s.chars().take(40).collect::<String>())
                );
                r
            }
            Err(ureq::Error::Status(code, r)) => {
                eprintln!(
                    "[stream_proxy] upstream STATUS-ERR {} for {} (proxy={:?})",
                    code,
                    target_url_for_thread.split('?').next().unwrap_or(&target_url_for_thread),
                    proxy_for_thread
                );
                r
            }
            Err(e) => {
                eprintln!(
                    "[stream_proxy] upstream FAIL for {} (proxy={:?}): {e}",
                    target_url_for_thread.split('?').next().unwrap_or(&target_url_for_thread),
                    proxy_for_thread
                );
                let _ = head_tx.send(Err(format!("upstream: {e}")));
                return;
            }
        };
        let status = resp.status();
        let content_type = resp.header("Content-Type").map(|s| s.to_string());
        let content_length = resp.header("Content-Length").map(|s| s.to_string());
        let content_range = resp.header("Content-Range").map(|s| s.to_string());

        // 推送 head 信息
        if head_tx
            .send(Ok((status, content_type.clone(), content_length, content_range)))
            .is_err()
        {
            return; // 客户端已断开
        }

        eprintln!(
            "[stream_proxy] head sent (status={status}, ct={:?}), begin streaming body",
            content_type
        );

        // 读 body 并 pipe
        let mut reader = resp.into_reader();
        let mut buf = vec![0u8; READ_BUF];
        let mut total: u64 = 0;
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    eprintln!(
                        "[stream_proxy] upstream EOF (total {} bytes) for {}",
                        total,
                        target_url_for_thread.split('?').next().unwrap_or(&target_url_for_thread)
                    );
                    break;
                }
                Ok(n) => {
                    total += n as u64;
                    let chunk = Bytes::copy_from_slice(&buf[..n]);
                    if tx.blocking_send(Ok(chunk)).is_err() {
                        eprintln!(
                            "[stream_proxy] client closed after {} bytes for {}",
                            total,
                            target_url_for_thread.split('?').next().unwrap_or(&target_url_for_thread)
                        );
                        break; // 客户端断了
                    }
                }
                Err(e) => {
                    eprintln!(
                        "[stream_proxy] read err after {} bytes: {e}",
                        total
                    );
                    let _ = tx.blocking_send(Err(std::io::Error::new(
                        std::io::ErrorKind::Other,
                        format!("read err: {e}"),
                    )));
                    break;
                }
            }
        }
    });

    let head = match head_rx.await {
        Ok(Ok(h)) => h,
        Ok(Err(msg)) => return Ok(err_resp(StatusCode::BAD_GATEWAY, &msg)),
        Err(_) => return Ok(err_resp(StatusCode::BAD_GATEWAY, "head channel closed")),
    };
    let (status, content_type, content_length, content_range) = head;

    let mut builder = cors_headers(
        Response::builder().status(StatusCode::from_u16(status).unwrap_or(StatusCode::OK)),
    )
    .header("Cache-Control", "no-cache")
    .header(
        "Content-Type",
        content_type.as_deref().unwrap_or("application/octet-stream"),
    )
    .header("Accept-Ranges", "bytes");
    if let Some(cl) = content_length {
        builder = builder.header("Content-Length", cl);
    }
    if let Some(cr) = content_range {
        builder = builder.header("Content-Range", cr);
    }

    // HEAD：不返回 body
    if req.method() == Method::HEAD {
        // 通知 worker 客户端不要 body —— drop rx 让 worker 早退
        drop(rx);
        return Ok(builder.body(boxed_full(Bytes::new())).unwrap());
    }

    // 用 ReceiverStream + StreamBody 把 channel 包成 hyper body
    let stream = ReceiverStream::new(rx).map(|res| match res {
        Ok(b) => Ok(Frame::data(b)),
        Err(e) => Err(e),
    });
    let body = StreamBody::new(stream);
    Ok(builder.body(BodyExt::boxed(body)).unwrap())
}

/// 处理 wss:// 目标 URL —— 走 amateurtv_ws::bridge 把 WS Binary 转 HTTP chunked。
async fn handle_ws_bridge(
    method: Method,
    target_url: String,
    proxy: Option<String>,
) -> Result<Response<BoxedBody>, Infallible> {
    let (body_tx, body_rx) = mpsc::channel::<Result<Bytes, std::io::Error>>(CHANNEL_CAP);
    let (head_tx, head_rx) = tokio::sync::oneshot::channel::<Result<(u16, String), String>>();

    // bridge 跑在 tokio task,不阻塞 hyper 主循环
    tauri::async_runtime::spawn(crate::amateurtv_ws::bridge(
        target_url,
        proxy,
        head_tx,
        body_tx,
    ));

    let (status, content_type) = match head_rx.await {
        Ok(Ok(h)) => h,
        Ok(Err(msg)) => return Ok(err_resp(StatusCode::BAD_GATEWAY, &msg)),
        Err(_) => return Ok(err_resp(StatusCode::BAD_GATEWAY, "ws bridge head closed")),
    };

    let builder = cors_headers(
        Response::builder().status(StatusCode::from_u16(status).unwrap_or(StatusCode::OK)),
    )
    .header("Cache-Control", "no-cache")
    .header("Content-Type", content_type);

    if method == Method::HEAD {
        drop(body_rx);
        return Ok(builder.body(boxed_full(Bytes::new())).unwrap());
    }

    let stream = ReceiverStream::new(body_rx).map(|res| match res {
        Ok(b) => Ok(Frame::data(b)),
        Err(e) => Err(e),
    });
    let body = StreamBody::new(stream);
    Ok(builder.body(BodyExt::boxed(body)).unwrap())
}

/// 处理 SAMPLE-AES 解密代理 —— amateur.tv / a0s.net 系。
///
/// 输入 URL 是 m3u8(fmp4-hls 端点),proxy 是可选 Clash 代理。
/// 流程:
///   1. resolve_m3u8(url, proxy):拉 m3u8 → 解 EXT-X-KEY URI + IV → 拉 key.bin → 拿 fragment URL
///   2. open_fragment_stream(fragment_url):拉 chunked fMP4
///   3. StreamDecryptor::feed(chunk):流式解 box,sample-aes 原地解密,推明文 fMP4 给 client
async fn handle_sample_aes_decrypt(
    method: Method,
    m3u8_url: String,
    proxy: Option<String>,
) -> Result<Response<BoxedBody>, Infallible> {
    use crate::sample_aes_proxy as sa;

    eprintln!(
        "[sample_aes] resolve m3u8: {}",
        m3u8_url.split('?').next().unwrap_or(&m3u8_url)
    );

    let params = sa::SampleAesParams {
        m3u8_url: m3u8_url.clone(),
        proxy: proxy.clone(),
    };

    let resolved = match sa::resolve_m3u8(&params).await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[sample_aes] resolve failed: {e}");
            return Ok(err_resp(StatusCode::BAD_GATEWAY, &e));
        }
    };
    eprintln!(
        "[sample_aes] resolved fragment={} iv=0x{}",
        resolved.fragment_url.split('?').next().unwrap_or(&resolved.fragment_url),
        resolved.iv.iter().map(|b| format!("{:02x}", b)).collect::<String>()
    );

    let upstream = match sa::open_fragment_stream(&resolved.fragment_url, proxy.as_deref()).await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("[sample_aes] open fragment failed: {e}");
            return Ok(err_resp(StatusCode::BAD_GATEWAY, &e));
        }
    };

    let status = upstream.status().as_u16();
    eprintln!("[sample_aes] fragment HTTP {status}, begin streaming decrypt");

    let builder = cors_headers(
        Response::builder().status(StatusCode::from_u16(status).unwrap_or(StatusCode::OK)),
    )
    .header("Cache-Control", "no-cache")
    .header("Content-Type", "video/mp4");

    if method == Method::HEAD {
        return Ok(builder.body(boxed_full(Bytes::new())).unwrap());
    }

    // chunked decrypt 协程:从 reqwest 的 bytes_stream 接 chunk,过 StreamDecryptor,推到 mpsc。
    // fragment EOF 时自动重新拉 m3u8 获取新 token + 新 fragment URL,继续推流,
    // 避免播放器检测到流结束后反复重连(iOS 上尤其明显)。
    let (tx, rx) = mpsc::channel::<Result<Bytes, std::io::Error>>(CHANNEL_CAP);
    let key = resolved.key;
    let iv = resolved.iv;
    let m3u8_url_for_task = m3u8_url.clone();
    let proxy_for_task = proxy.clone();
    tauri::async_runtime::spawn(async move {
        let mut decryptor = sa::StreamDecryptor::new(key, iv);
        let mut total_in: u64 = 0;
        let mut total_out: u64 = 0;
        let mut current_upstream = upstream;
        let mut reconnects: u32 = 0;
        const MAX_RECONNECTS: u32 = 120; // 每次 fragment 约 30-60s,120 次 ≈ 1-2 小时

        loop {
            let mut byte_stream = current_upstream.bytes_stream();
            let mut got_data = false;
            while let Some(item) = byte_stream.next().await {
                match item {
                    Ok(chunk) => {
                        got_data = true;
                        total_in += chunk.len() as u64;
                        match decryptor.feed(chunk) {
                            Ok(out_chunks) => {
                                for c in out_chunks {
                                    total_out += c.len() as u64;
                                    if tx.send(Ok(c)).await.is_err() {
                                        eprintln!(
                                            "[sample_aes] client closed (in {total_in} / out {total_out} bytes)"
                                        );
                                        return;
                                    }
                                }
                            }
                            Err(e) => {
                                eprintln!("[sample_aes] decrypt err: {e}");
                                let _ = tx
                                    .send(Err(std::io::Error::new(
                                        std::io::ErrorKind::Other,
                                        e,
                                    )))
                                    .await;
                                return;
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!(
                            "[sample_aes] upstream read err (in {total_in} / out {total_out}): {e}"
                        );
                        break;
                    }
                }
            }

            // Fragment stream ended — try to reconnect with fresh m3u8 token
            reconnects += 1;
            if reconnects > MAX_RECONNECTS {
                eprintln!("[sample_aes] max reconnects reached, stopping");
                return;
            }
            if !got_data {
                eprintln!("[sample_aes] fragment returned no data, stopping");
                return;
            }
            eprintln!(
                "[sample_aes] fragment EOF (in {total_in} / out {total_out}), reconnect #{reconnects}..."
            );

            // Brief pause to avoid hammering the server
            tokio::time::sleep(Duration::from_millis(500)).await;

            // Re-resolve m3u8 for fresh token
            let params = sa::SampleAesParams {
                m3u8_url: m3u8_url_for_task.clone(),
                proxy: proxy_for_task.clone(),
            };
            let new_resolved = match sa::resolve_m3u8(&params).await {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("[sample_aes] re-resolve m3u8 failed: {e}");
                    return;
                }
            };

            // Update key if changed — 不重建 decryptor，保留 initialized 状态避免重复推 ftyp/moov
            decryptor.update_key(new_resolved.key);

            // Open new fragment stream
            match sa::open_fragment_stream(&new_resolved.fragment_url, proxy_for_task.as_deref()).await {
                Ok(resp) => {
                    if !resp.status().is_success() {
                        eprintln!("[sample_aes] reconnect fragment HTTP {}", resp.status());
                        return;
                    }
                    current_upstream = resp;
                }
                Err(e) => {
                    eprintln!("[sample_aes] reconnect fragment failed: {e}");
                    return;
                }
            }
        }
    });

    let stream = ReceiverStream::new(rx).map(|res| match res {
        Ok(b) => Ok(Frame::data(b)),
        Err(e) => Err(e),
    });
    let body = StreamBody::new(stream);
    Ok(builder.body(BodyExt::boxed(body)).unwrap())
}
