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

    let Some(target_url) = params.get("url").cloned() else {
        return Ok(err_resp(StatusCode::BAD_REQUEST, "missing url param"));
    };
    let ua = params.get("ua").cloned();
    let referer = params.get("referer").cloned();
    let proxy = params.get("proxy").cloned();
    let decrypt_mode = params.get("decrypt").cloned();

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
    let proxy_for_thread = proxy.clone();
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

    // chunked decrypt 协程:从 reqwest 的 bytes_stream 接 chunk,过 StreamDecryptor,推到 mpsc
    let (tx, rx) = mpsc::channel::<Result<Bytes, std::io::Error>>(CHANNEL_CAP);
    let key = resolved.key;
    let iv = resolved.iv;
    tauri::async_runtime::spawn(async move {
        let mut decryptor = sa::StreamDecryptor::new(key, iv);
        let mut total_in: u64 = 0;
        let mut total_out: u64 = 0;
        let mut byte_stream = upstream.bytes_stream();
        while let Some(item) = byte_stream.next().await {
            match item {
                Ok(chunk) => {
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
                    let _ = tx
                        .send(Err(std::io::Error::new(
                            std::io::ErrorKind::Other,
                            format!("upstream: {e}"),
                        )))
                        .await;
                    return;
                }
            }
        }
        eprintln!("[sample_aes] upstream EOF (in {total_in} / out {total_out})");
    });

    let stream = ReceiverStream::new(rx).map(|res| match res {
        Ok(b) => Ok(Frame::data(b)),
        Err(e) => Err(e),
    });
    let body = StreamBody::new(stream);
    Ok(builder.body(BodyExt::boxed(body)).unwrap())
}
