//! AmateurTV / a0s.net 系 cam 平台 WebSocket → fMP4 字节流桥。
//!
//! 背景:`videoTechnologies.fmp4` HTTP 端点对匿名客户端返"干扰流"
//! (FastEVO Protected fMP4 — body 看上去像 mp4 但 mdat 是加密扰动数据,
//! 浏览器拿到能解析 ftyp/moov 但播出来花屏 / 黑屏)。
//! 真实可播流走 `videoTechnologies.ws` (wss://live-fws-edge.a0s.net/f-stream-ws?token=…)。
//!
//! 🚨 实际协议(2026-05-24 抓包验证):
//!
//!   1. 客户端连 wss,**必须**带 Origin: https://www.amateur.tv
//!   2. 客户端**不需要**发任何 hello 消息 —— 服务端不等握手
//!   3. 服务端首消息可能是以下三种 Text 之一:
//!      a) `IAM:f-stream-edge-XXX.a0s.net` — 连对了 edge,接下来就是 Binary 流
//!      b) `REDIRECT:wss://f-stream-edge-XXX.a0s.net/...?token=...` — 边缘节点调度,
//!          要用新 URL 重新连接(新 token 包含 `redirectedTo` claim)
//!      c) `{"message":"ping"}` — 服务端未就绪 / 切主播,放弃
//!   4. 收到 IAM 之后,服务端立即推 Binary message 序列(每个 = 一段 fMP4 chunk)
//!
//! StreaMonitor 的 hello/qual/play 握手在新版服务端被忽略 —— 那份代码因为也收 Binary
//! 所以碰巧能拿到流,但它没处理 REDIRECT,所以对部分主播会失败。

use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::sync::oneshot;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);
/// 连上后等首个数据(IAM 文本 / REDIRECT / 第一个 Binary)的上限。a0s.net 通常 < 1s。
const FIRST_DATA_TIMEOUT: Duration = Duration::from_secs(10);
/// 进入流模式后,30s 无任何消息视为对端僵死。
const RECV_IDLE_TIMEOUT: Duration = Duration::from_secs(30);
/// REDIRECT 链最多跟 5 跳,防服务端打死循环。
const MAX_REDIRECTS: usize = 5;
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const ORIGIN: &str = "https://www.amateur.tv";

type Ws = tokio_tungstenite::WebSocketStream<
    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
>;

/// 单次连接尝试的结果。
enum AttemptResult {
    /// 收到了 REDIRECT,请用新 URL 再试一次
    Redirect(String),
    /// 成功结束(转发了 N 字节后服务端关闭 / 客户端断开 / idle timeout)
    Done,
    /// 不可恢复的错误(已经通过 head_tx 报告 / 已经在转发中失败)
    Failed,
}

/// 桥接入口。
///
/// - `ws_url`: amateurtv adapter 拿到的 `videoTechnologies.ws` URL
/// - `proxy`: 可选 http:// 代理(Clash HTTP 端口),None 走直连
/// - `head_tx`: 首个 Binary 到达后通过该 channel 发 (status, content_type) 给 HTTP 端
/// - `body_tx`: 后续 fMP4 binary chunks 推到这个 channel,HTTP 端 ReceiverStream 消费
pub async fn bridge(
    ws_url: String,
    proxy: Option<String>,
    head_tx: oneshot::Sender<Result<(u16, String), String>>,
    body_tx: mpsc::Sender<Result<Bytes, std::io::Error>>,
) {
    crate::fc2_ws::ensure_crypto_provider();

    let proxy = proxy.filter(|s| !s.trim().is_empty());
    let mut head_tx = Some(head_tx);
    let mut current_url = ws_url;
    let mut redirects: usize = 0;

    loop {
        eprintln!(
            "[amateurtv_ws] {} ws_url_head={} proxy={:?}",
            if redirects == 0 {
                "bridge start".to_string()
            } else {
                format!("redirect #{}", redirects)
            },
            current_url.chars().take(80).collect::<String>(),
            proxy
        );

        let result = single_attempt(
            &current_url,
            proxy.as_deref(),
            &mut head_tx,
            &body_tx,
        )
        .await;

        match result {
            AttemptResult::Redirect(new_url) => {
                redirects += 1;
                if redirects > MAX_REDIRECTS {
                    eprintln!(
                        "[amateurtv_ws] REDIRECT 链超过 {} 跳,放弃",
                        MAX_REDIRECTS
                    );
                    if let Some(tx) = head_tx.take() {
                        let _ = tx.send(Err(format!(
                            "AmateurTV REDIRECT 链过长 (>{}), 服务端调度异常",
                            MAX_REDIRECTS
                        )));
                    }
                    return;
                }
                current_url = new_url;
                // continue outer loop with new URL
            }
            AttemptResult::Done | AttemptResult::Failed => return,
        }
    }
}

/// 单次 WS 连接尝试。
/// 返回:Redirect(新URL) / Done(自然结束) / Failed(error 已通过 head_tx 报)
async fn single_attempt(
    ws_url: &str,
    proxy: Option<&str>,
    head_tx: &mut Option<oneshot::Sender<Result<(u16, String), String>>>,
    body_tx: &mpsc::Sender<Result<Bytes, std::io::Error>>,
) -> AttemptResult {
    // 1. 解析 URL
    let parsed = match url::Url::parse(ws_url) {
        Ok(p) => p,
        Err(e) => {
            if let Some(tx) = head_tx.take() {
                let _ = tx.send(Err(format!("WS URL 非法: {e}")));
            }
            return AttemptResult::Failed;
        }
    };
    let host = match parsed.host_str() {
        Some(h) => h.to_string(),
        None => {
            if let Some(tx) = head_tx.take() {
                let _ = tx.send(Err("WS URL 缺 host".into()));
            }
            return AttemptResult::Failed;
        }
    };
    let port = parsed.port().unwrap_or(443);

    // 2. 构造 request + 设 a0s.net 要求的 Origin/UA/Referer
    let mut request = match ws_url.into_client_request() {
        Ok(r) => r,
        Err(e) => {
            if let Some(tx) = head_tx.take() {
                let _ = tx.send(Err(format!("WS 请求构造失败: {e}")));
            }
            return AttemptResult::Failed;
        }
    };
    let headers = request.headers_mut();
    if let Ok(v) = ORIGIN.parse() {
        headers.insert("Origin", v);
    }
    if let Ok(v) = USER_AGENT.parse() {
        headers.insert("User-Agent", v);
    }
    if let Ok(v) = "https://www.amateur.tv/".parse() {
        headers.insert("Referer", v);
    }

    // 3. 建 WSS 连接
    let connect_result = match timeout(HANDSHAKE_TIMEOUT, async {
        match proxy {
            None => tokio_tungstenite::connect_async(request)
                .await
                .map_err(|e| format!("WSS 直连失败: {e}")),
            Some(p) => {
                let tcp = crate::fc2_ws::connect_via_http_proxy(p, &host, port).await?;
                tokio_tungstenite::client_async_tls(request, tcp)
                    .await
                    .map_err(|e| format!("WSS 代理握手失败: {e}"))
            }
        }
    })
    .await
    {
        Err(_) => {
            if let Some(tx) = head_tx.take() {
                let _ = tx.send(Err("WSS 握手超时".into()));
            }
            return AttemptResult::Failed;
        }
        Ok(Err(e)) => {
            if let Some(tx) = head_tx.take() {
                let _ = tx.send(Err(e));
            }
            return AttemptResult::Failed;
        }
        Ok(Ok(v)) => v,
    };
    let (ws_stream, _resp) = connect_result;
    eprintln!("[amateurtv_ws] WSS 已连接,等待首个数据");

    // 4. 收消息循环
    run_stream_loop(ws_stream, head_tx, body_tx).await
}

async fn run_stream_loop(
    mut ws_stream: Ws,
    head_tx: &mut Option<oneshot::Sender<Result<(u16, String), String>>>,
    body_tx: &mpsc::Sender<Result<Bytes, std::io::Error>>,
) -> AttemptResult {
    let mut head_sent = head_tx.is_none(); // 如果上轮 redirect 前已 send,这里就 true
    let mut total_bytes: usize = 0;
    let mut iam_edge: Option<String> = None;
    let first_deadline = std::time::Instant::now() + FIRST_DATA_TIMEOUT;

    loop {
        let wait = if head_sent {
            RECV_IDLE_TIMEOUT
        } else {
            let remaining = first_deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() {
                if let Some(tx) = head_tx.take() {
                    let _ = tx.send(Err(format!(
                        "等待首个数据超时(IAM edge={:?})",
                        iam_edge
                    )));
                }
                return AttemptResult::Failed;
            }
            remaining.min(RECV_IDLE_TIMEOUT)
        };

        let msg = match timeout(wait, ws_stream.next()).await {
            Err(_) => {
                if head_sent {
                    eprintln!(
                        "[amateurtv_ws] recv idle {}s,退出 (total {} bytes, edge={:?})",
                        RECV_IDLE_TIMEOUT.as_secs(),
                        total_bytes,
                        iam_edge
                    );
                    let _ = ws_stream.close(None).await;
                    return AttemptResult::Done;
                }
                if let Some(tx) = head_tx.take() {
                    let _ = tx.send(Err(format!(
                        "等待首个数据超时(IAM edge={:?})",
                        iam_edge
                    )));
                }
                return AttemptResult::Failed;
            }
            Ok(None) => {
                if head_sent {
                    eprintln!(
                        "[amateurtv_ws] 服务端关闭连接 (total {} bytes)",
                        total_bytes
                    );
                    return AttemptResult::Done;
                }
                if let Some(tx) = head_tx.take() {
                    let _ = tx.send(Err("WSS 提前断开(握手阶段)".into()));
                }
                return AttemptResult::Failed;
            }
            Ok(Some(Err(e))) => {
                if head_sent {
                    eprintln!("[amateurtv_ws] recv err: {e}");
                    let _ = ws_stream.close(None).await;
                    return AttemptResult::Done;
                }
                if let Some(tx) = head_tx.take() {
                    let _ = tx.send(Err(format!("WSS recv err: {e}")));
                }
                return AttemptResult::Failed;
            }
            Ok(Some(Ok(m))) => m,
        };

        match msg {
            Message::Binary(b) => {
                if !head_sent {
                    if let Some(tx) = head_tx.take() {
                        if tx.send(Ok((200, "video/mp4".to_string()))).is_err() {
                            eprintln!("[amateurtv_ws] head channel 关了,放弃");
                            return AttemptResult::Failed;
                        }
                    }
                    head_sent = true;
                    eprintln!(
                        "[amateurtv_ws] 首个 Binary {} 字节,head 已发,开始转发 (edge={:?})",
                        b.len(),
                        iam_edge
                    );
                }
                total_bytes += b.len();
                if body_tx.send(Ok(Bytes::from(b))).await.is_err() {
                    eprintln!(
                        "[amateurtv_ws] HTTP 端断开 (total {} bytes)",
                        total_bytes
                    );
                    let _ = ws_stream.close(None).await;
                    return AttemptResult::Done;
                }
            }
            Message::Text(t) => {
                // REDIRECT: 服务端要求换 edge 重连
                if let Some(new_url) = t.strip_prefix("REDIRECT:") {
                    let new_url = new_url.trim().to_string();
                    eprintln!(
                        "[amateurtv_ws] 收到 REDIRECT → {}",
                        new_url.chars().take(80).collect::<String>()
                    );
                    let _ = ws_stream.close(None).await;
                    return AttemptResult::Redirect(new_url);
                }
                // IAM: 自报家门
                if let Some(edge) = t.strip_prefix("IAM:") {
                    iam_edge = Some(edge.trim().to_string());
                    eprintln!("[amateurtv_ws] 收到 IAM: {:?}", iam_edge);
                    continue;
                }
                // {"message":"ping"} = 服务端未就绪
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
                    if v.get("message").and_then(|x| x.as_str()) == Some("ping") {
                        if let Some(tx) = head_tx.take() {
                            let _ = tx
                                .send(Err("AmateurTV 服务端未就绪 (message:ping)".into()));
                        }
                        return AttemptResult::Failed;
                    }
                }
                let head_chars: String = t.chars().take(160).collect();
                eprintln!("[amateurtv_ws] 忽略 Text 消息: {}", head_chars);
            }
            Message::Ping(p) => {
                let _ = ws_stream.send(Message::Pong(p)).await;
            }
            Message::Close(c) => {
                let code = c
                    .map(|cf| cf.code.to_string())
                    .unwrap_or_else(|| "no code".into());
                if head_sent {
                    eprintln!("[amateurtv_ws] 服务端 Close: {}", code);
                    return AttemptResult::Done;
                }
                if let Some(tx) = head_tx.take() {
                    let _ = tx.send(Err(format!("WSS 被服务端关闭: {code}")));
                }
                return AttemptResult::Failed;
            }
            Message::Pong(_) | Message::Frame(_) => continue,
        }
    }
}
