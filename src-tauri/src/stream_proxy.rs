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

    // 同步 ureq 在阻塞线程里跑；通过 channel 推 chunks
    let (tx, rx) = mpsc::channel::<Result<Bytes, std::io::Error>>(CHANNEL_CAP);

    // 先开一个 oneshot 拿响应状态码 / content-type
    let (head_tx, head_rx) =
        tokio::sync::oneshot::channel::<Result<(u16, Option<String>, Option<String>, Option<String>), String>>();

    let target_url_for_thread = target_url.clone();
    let ua_for_thread = ua.clone();
    let referer_for_thread = referer.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let agent = match ureq::AgentBuilder::new()
            .timeout(Duration::from_secs(READ_TIMEOUT_SECS))
            .redirects(10)
            .build()
        {
            a => a,
        };
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
            Ok(r) => r,
            Err(ureq::Error::Status(_, r)) => r, // 4xx/5xx 也透传
            Err(e) => {
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
            .send(Ok((status, content_type, content_length, content_range)))
            .is_err()
        {
            return; // 客户端已断开
        }

        // 读 body 并 pipe
        let mut reader = resp.into_reader();
        let mut buf = vec![0u8; READ_BUF];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = Bytes::copy_from_slice(&buf[..n]);
                    if tx.blocking_send(Ok(chunk)).is_err() {
                        break; // 客户端断了
                    }
                }
                Err(e) => {
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
