/**
 * 线路 / 源切换面板。
 *
 * 列出当前视频的所有 playbacks（线路），支持「测速并排序」+ 手动点击切换。
 * 加载失败时与播放慢时都可弹出。
 *
 * 测速做法：
 *   并发对每条线路调用 callResolvePlayUrl → wrapWithProxy →
 *   scriptFetch(method='GET', timeout=8000) 拉首字节，记录耗时 ms。
 *   失败 / 超时记为 ∞，沉到底部。
 *
 * 注意：测速请求会走 dyproxy 代理路径 —— 与真实播放路径一致，结果反映真实可用度，
 * 不只是网络 RTT。
 */
import { useCallback, useState } from "react";
import { callResolvePlayUrl } from "@/source-script/runtime";
import { scriptFetch } from "@/source-script/fetch";
import { wrapWithProxy } from "@/lib/proxy";
import { useProxyStore } from "@/stores/proxy";
import type { ScriptDescriptor, ScriptPlayback } from "@/source-script/types";
import type { MediaItem } from "@/types/media";
import { IconClose, IconRetry } from "@/components/Icon";

interface Props {
  open: boolean;
  playbacks: ScriptPlayback[];
  currentIndex: number;
  episodeIndex: number;
  script: ScriptDescriptor | undefined;
  videoTitle: string;
  onPick: (playbackIndex: number) => void;
  onClose: () => void;
}

interface SpeedResult {
  ms?: number;
  error?: string;
  testing: boolean;
}

async function testOne(
  script: ScriptDescriptor,
  playback: ScriptPlayback,
  episodeIndex: number,
  proxyUrl: string | undefined,
  proxyEnabled: boolean
): Promise<number> {
  const ep = playback.episodes[episodeIndex] ?? playback.episodes[0];
  if (!ep) throw new Error("无可用集");
  const playUrl = typeof ep === "string" ? ep : ep.playUrl;
  const needResolve = typeof ep === "string" ? true : ep.needResolve !== false;

  let realUrl = playUrl;
  let streamType: "auto" | "mp4" | "hls" | "dash" | "flv" = "auto";
  let headers: Record<string, string> = {};
  if (needResolve) {
    const r = await callResolvePlayUrl(script, {
      playUrl,
      sourceId: playback.sourceId,
      episodeIndex,
    });
    realUrl = r.url;
    streamType = (r.type ?? "auto") as typeof streamType;
    headers = r.headers ?? {};
  }

  const tempItem: MediaItem = {
    id: "speedtest",
    kind: "video",
    title: "",
    url: realUrl,
    streamType,
    headers,
  };
  const proxiedUrl = wrapWithProxy(tempItem, {
    proxyUrl: proxyEnabled ? proxyUrl : undefined,
  });

  const start = performance.now();
  const res = await scriptFetch(proxiedUrl, {
    method: "GET",
    timeout: 8_000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // 读一小段 body 确保握手 + TLS + 上游响应完整算入耗时
  await res.text();
  return Math.round(performance.now() - start);
}

export default function SourceSwitcher({
  open,
  playbacks,
  currentIndex,
  episodeIndex,
  script,
  videoTitle,
  onPick,
  onClose,
}: Props) {
  const [results, setResults] = useState<Record<number, SpeedResult>>({});
  const [testing, setTesting] = useState(false);
  const proxyEnabled = useProxyStore((s) => s.enabled);
  const proxyUrl = useProxyStore((s) => s.url);

  const runSpeedTest = useCallback(async () => {
    if (!script) return;
    setTesting(true);
    setResults((r) => {
      const next: Record<number, SpeedResult> = { ...r };
      playbacks.forEach((_, i) => {
        next[i] = { testing: true };
      });
      return next;
    });

    await Promise.all(
      playbacks.map(async (pb, i) => {
        try {
          const ms = await testOne(script, pb, episodeIndex, proxyUrl, proxyEnabled);
          setResults((r) => ({ ...r, [i]: { ms, testing: false } }));
        } catch (e) {
          setResults((r) => ({
            ...r,
            [i]: { error: (e as Error).message ?? String(e), testing: false },
          }));
        }
      })
    );
    setTesting(false);
  }, [script, playbacks, episodeIndex, proxyUrl, proxyEnabled]);

  if (!open) return null;

  // 排序：测出来的 ms 升序；未测过的保留原顺序；error 沉底
  const order = playbacks
    .map((_, i) => i)
    .sort((a, b) => {
      const ra = results[a];
      const rb = results[b];
      const va = ra?.ms ?? (ra?.error ? Number.POSITIVE_INFINITY : Number.MAX_SAFE_INTEGER - a);
      const vb = rb?.ms ?? (rb?.error ? Number.POSITIVE_INFINITY : Number.MAX_SAFE_INTEGER - b);
      return va - vb;
    });

  const fastestIdx = order.find((i) => typeof results[i]?.ms === "number");

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end animate-fade-in"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md h-full overflow-y-auto animate-slide-right"
        style={{
          background: "var(--ink)",
          borderLeft: "1px solid var(--cream-line)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶栏 */}
        <div
          className="sticky top-0 z-10 p-4 flex items-center gap-3"
          style={{
            background: "var(--ink)",
            borderBottom: "1px solid var(--cream-line)",
          }}
        >
          <div className="flex-1 min-w-0">
            <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
              SOURCE · {playbacks.length} 条线路
            </p>
            <h1 className="font-display text-base font-extrabold tracking-tight line-clamp-1">
              切换线路
            </h1>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream"
            style={{
              background: "var(--ink-2)",
              border: "1px solid var(--cream-line)",
            }}
            aria-label="关闭"
          >
            <IconClose size={16} />
          </button>
        </div>

        <div className="p-4 pb-20">
          <p className="text-[11px] text-cream-faint mb-4 leading-relaxed line-clamp-2">
            《{videoTitle}》· 第 {episodeIndex + 1} 集
          </p>

          {/* 测速按钮 */}
          <button
            type="button"
            onClick={() => void runSpeedTest()}
            disabled={testing || !script}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-display font-semibold tap mb-4 disabled:opacity-50"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            <IconRetry size={14} />
            {testing ? "测速中…" : "全部测速并按速度排序"}
          </button>

          {/* 线路列表 */}
          <ul className="space-y-1.5">
            {order.map((i) => {
              const pb = playbacks[i];
              const isCurrent = i === currentIndex;
              const isFastest = fastestIdx !== undefined && i === fastestIdx;
              const r = results[i];
              return (
                <li key={`${pb.sourceId}-${i}`}>
                  <button
                    type="button"
                    onClick={() => onPick(i)}
                    className="w-full text-left p-3 rounded-lg tap"
                    style={{
                      background: isCurrent
                        ? "var(--ember-soft)"
                        : "var(--ink-2)",
                      border: `1px solid ${
                        isCurrent
                          ? "var(--ember)"
                          : isFastest
                          ? "var(--phosphor)"
                          : "var(--cream-line)"
                      }`,
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {isCurrent && (
                            <span
                              className="font-mono text-[9px] tracking-[0.15em] px-1.5 py-0.5 rounded"
                              style={{
                                background: "var(--ember)",
                                color: "var(--ink)",
                              }}
                            >
                              CURRENT
                            </span>
                          )}
                          {isFastest && !isCurrent && (
                            <span
                              className="font-mono text-[9px] tracking-[0.15em] px-1.5 py-0.5 rounded"
                              style={{
                                background: "var(--phosphor-soft)",
                                color: "var(--phosphor)",
                                border: "1px solid rgba(124,255,178,0.3)",
                              }}
                            >
                              FASTEST
                            </span>
                          )}
                        </div>
                        <p
                          className="text-sm font-display font-semibold line-clamp-1"
                          style={{
                            color: isCurrent ? "var(--ember)" : "var(--cream)",
                          }}
                        >
                          {pb.sourceName || `线路 ${i + 1}`}
                        </p>
                        <p className="text-[10px] font-mono text-cream-faint mt-0.5 line-clamp-1">
                          {pb.episodes.length} 集 · {pb.sourceId}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        {r?.testing && (
                          <div className="signal-bars" style={{ height: 12 }}>
                            <span></span>
                            <span></span>
                            <span></span>
                          </div>
                        )}
                        {typeof r?.ms === "number" && (
                          <p
                            className="font-mono text-xs"
                            style={{
                              color:
                                r.ms < 500
                                  ? "var(--phosphor)"
                                  : r.ms < 1500
                                  ? "var(--cream)"
                                  : "var(--ember)",
                            }}
                          >
                            {r.ms} ms
                          </p>
                        )}
                        {r?.error && (
                          <p
                            className="font-mono text-[10px]"
                            style={{ color: "#FF6B6B" }}
                          >
                            失败
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
