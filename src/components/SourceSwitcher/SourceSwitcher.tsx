/**
 * 线路 / 源切换面板。
 *
 * 两阶段候选：
 *   1) 同脚本：detail.playbacks 里的所有线路（一定可点）
 *   2) 跨脚本：拿当前 videoTitle 调用所有 *其它* enabled 脚本的 search，
 *      取每个第一条命中 + callDetail → 第一条 playback。并发限流 4。
 *
 * 测速：对每条候选 callResolvePlayUrl → wrapWithProxy → scriptFetch(GET, 8s)，
 *       记录首字节耗时。失败 / 超时 = ∞ 沉底。
 *
 * 切换：
 *   - 同脚本：调 onPickSamePlayback(playbackIndex)
 *   - 跨脚本：调 onPickCrossScript(scriptKey, vodId, playbackIdx=0)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { callDetail, callResolvePlayUrl, callSearch } from "@/source-script/runtime";
import { scriptFetch } from "@/source-script/fetch";
import { wrapWithProxy } from "@/lib/proxy";
import { useProxyStore } from "@/stores/proxy";
import { useScriptStore } from "@/stores/scripts";
import type {
  ScriptDescriptor,
  ScriptPlayback,
} from "@/source-script/types";
import type { MediaItem } from "@/types/media";
import { IconClose, IconRetry } from "@/components/Icon";

interface Props {
  open: boolean;
  /** 当前视频的同脚本线路（detail.playbacks）。点击切换调 onPickSamePlayback */
  playbacks: ScriptPlayback[];
  currentIndex: number;
  episodeIndex: number;
  script: ScriptDescriptor | undefined;
  videoTitle: string;
  onPick: (playbackIndex: number) => void;
  /**
   * 跨脚本候选被选中：调用方应 navigate 到 /play/<scriptKey>/<vodId>/<playbackIdx>/<epIdx>。
   * 不传时跨脚本候选只展示不可点。
   */
  onPickCrossScript?: (
    scriptKey: string,
    vodId: string,
    playbackIdx: number
  ) => void;
  onClose: () => void;
}

interface Candidate {
  /** 唯一 key，用于 React */
  key: string;
  scriptKey: string;
  scriptName: string;
  /** 当前正在播放的视频对应这个 candidate 的索引（仅同脚本一条命中） */
  isCurrent: boolean;
  /** true=同脚本的 playback；false=跨脚本搜索来的 */
  isSameScript: boolean;
  /** 跨脚本时是被搜索命中的视频 id；同脚本时是当前 itemId 的 vod 部分 */
  vodId: string;
  /** 跨脚本搜索命中的标题（用于展示）；同脚本为空 */
  hitTitle?: string;
  /** 跨脚本搜索命中的备注 / 海报（次要展示） */
  hitRemarks?: string;
  /** 同脚本时是 detail.playbacks 的索引；跨脚本时为 0 */
  playbackIdx: number;
  /**
   * 同脚本候选：detail.playbacks[playbackIdx]，可直接拿来测速；
   * 跨脚本候选：search 阶段不调 callDetail（太慢），用 undefined 占位，
   *             实际测速 / 切换时 lazy-load。
   */
  playback?: ScriptPlayback;
  /** 测速结果 */
  ms?: number;
  error?: string;
  testing?: boolean;
}

interface SpeedTestArgs {
  script: ScriptDescriptor;
  playback: ScriptPlayback;
  episodeIndex: number;
  proxyUrl: string | undefined;
  proxyEnabled: boolean;
}

async function testOne(args: SpeedTestArgs): Promise<number> {
  const { script, playback, episodeIndex, proxyUrl, proxyEnabled } = args;
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
  const res = await scriptFetch(proxiedUrl, { method: "GET", timeout: 8_000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
  onPickCrossScript,
  onClose,
}: Props) {
  const proxyEnabled = useProxyStore((s) => s.mode !== "off");
  const proxyUrl = useProxyStore((s) =>
    s.mode === "manual"
      ? s.manualUrl
      : s.mode === "auto"
        ? s.systemProxyUrl
        : ""
  );
  const allScripts = useScriptStore((s) => s.scripts);

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const candidatesRef = useRef<Candidate[]>([]);
  useEffect(() => {
    candidatesRef.current = candidates;
  }, [candidates]);
  const [searching, setSearching] = useState(false);
  const [testing, setTesting] = useState(false);
  const [crossSearched, setCrossSearched] = useState(false);
  // 记住上一次 init 的 "videoTitle|scriptKey|playbacks_sig"，仅在它真正变了才重建候选 —
  // 用户关闭/重开面板时搜索结果保留，无需重搜
  const lastInitSigRef = useRef<string>("");

  useEffect(() => {
    if (!open) return;
    const playbackSig = playbacks.map((p) => `${p.sourceId}#${p.episodes.length}`).join("|");
    const sig = `${videoTitle}::${script?.key ?? ""}::${playbackSig}::${currentIndex}`;
    if (sig === lastInitSigRef.current) return; // 同一视频 + 同一线路 → 沿用已有候选
    lastInitSigRef.current = sig;
    const base: Candidate[] = playbacks.map((pb, i) => ({
      key: `same-${i}-${pb.sourceId}`,
      scriptKey: script?.key ?? "",
      scriptName: script?.name ?? script?.key ?? "",
      isCurrent: i === currentIndex,
      isSameScript: true,
      vodId: "",
      playbackIdx: i,
      playback: pb,
    }));
    setCandidates(base);
    setCrossSearched(false);
  }, [open, playbacks, currentIndex, script?.key, script?.name, videoTitle]);

  // 跨脚本搜索 —— 流式：每个 script 完成立即 push 候选，不等齐。
  // 之前 mapLimit 8 等齐，慢源会拖整体；现在 1 个返回就立刻出现，体感秒级。
  const runCrossSearch = useCallback(async () => {
    if (!videoTitle) return;
    setSearching(true);
    try {
      const others = allScripts.filter(
        (s) => s.enabled !== false && s.key !== script?.key
      );
      await Promise.all(
        others.map(async (desc) => {
          try {
            const sr = await callSearch(desc, { keyword: videoTitle, page: 1 });
            const hit = sr.list?.[0];
            if (!hit) return;
            const cand: Candidate = {
              key: `cross-${desc.key}-${hit.id}`,
              scriptKey: desc.key,
              scriptName: desc.name,
              isCurrent: false,
              isSameScript: false,
              vodId: hit.id,
              hitTitle: hit.title,
              hitRemarks: hit.vod_remarks,
              playbackIdx: 0,
            };
            // 立刻追加，让用户看到这条结果，其它源继续在跑
            setCandidates((prev) =>
              prev.some((c) => c.key === cand.key) ? prev : [...prev, cand]
            );
          } catch {
            /* 单个脚本失败不影响其它 */
          }
        })
      );
    } finally {
      setSearching(false);
      setCrossSearched(true);
    }
  }, [allScripts, script?.key, videoTitle]);

  const runSpeedTest = useCallback(async () => {
    setTesting(true);
    setCandidates((prev) => prev.map((c) => ({ ...c, testing: true, ms: undefined, error: undefined })));
    const scriptByKey = new Map(allScripts.map((s) => [s.key, s]));
    if (script) scriptByKey.set(script.key, script);
    // 跨脚本候选缺 playback —— 测速前 lazy callDetail。同脚本候选已经有 playback，跳过
    await Promise.all(
      candidates.map((c, idx) =>
        (async () => {
          const desc = scriptByKey.get(c.scriptKey);
          if (!desc) {
            setCandidates((prev) =>
              prev.map((x, i) => (i === idx ? { ...x, testing: false, error: "脚本缺失" } : x))
            );
            return;
          }
          try {
            let playback = c.playback;
            if (!playback) {
              // lazy detail
              const detail = await callDetail(desc, { id: c.vodId });
              playback = detail.playbacks?.[0];
              if (!playback || playback.episodes.length === 0) {
                throw new Error("无可用线路");
              }
              // 写回，供 onPickCrossScript 也可用
              setCandidates((prev) =>
                prev.map((x, i) => (i === idx ? { ...x, playback } : x))
              );
            }
            const ms = await testOne({
              script: desc,
              playback,
              episodeIndex,
              proxyUrl,
              proxyEnabled,
            });
            setCandidates((prev) =>
              prev.map((x, i) => (i === idx ? { ...x, ms, testing: false } : x))
            );
          } catch (e) {
            setCandidates((prev) =>
              prev.map((x, i) =>
                i === idx
                  ? { ...x, error: (e as Error).message ?? String(e), testing: false }
                  : x
              )
            );
          }
        })()
      )
    );
    setTesting(false);
  }, [candidates, allScripts, script, episodeIndex, proxyUrl, proxyEnabled]);

  // "搜索并测速" 一键流程
  const runAll = useCallback(async () => {
    if (!crossSearched && videoTitle) {
      await runCrossSearch();
    }
    await runSpeedTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crossSearched, videoTitle, runCrossSearch, runSpeedTest]);

  // 自动选最快源：搜索 + 测速 + 自动 pick 最快的（排除当前线路本身）
  const runAutoFastest = useCallback(async () => {
    await runAll();
    // candidatesRef 在 setCandidates 触发的下一帧才同步，等一个 microtask
    await new Promise((r) => setTimeout(r, 0));
    const list = candidatesRef.current;
    const fastest = [...list]
      .filter((c) => typeof c.ms === "number" && !c.isCurrent)
      .sort((a, b) => (a.ms as number) - (b.ms as number))[0];
    if (!fastest) return;
    if (fastest.isSameScript) {
      onPick(fastest.playbackIdx);
    } else if (onPickCrossScript) {
      onPickCrossScript(fastest.scriptKey, fastest.vodId, fastest.playbackIdx);
    }
  }, [runAll, onPick, onPickCrossScript]);

  const sorted = useMemo(() => {
    return [...candidates].sort((a, b) => {
      const va = a.ms ?? (a.error ? Number.POSITIVE_INFINITY : Number.MAX_SAFE_INTEGER - candidates.indexOf(a));
      const vb = b.ms ?? (b.error ? Number.POSITIVE_INFINITY : Number.MAX_SAFE_INTEGER - candidates.indexOf(b));
      return va - vb;
    });
  }, [candidates]);

  const fastestKey = useMemo(() => {
    return sorted.find((c) => typeof c.ms === "number")?.key;
  }, [sorted]);

  if (!open) return null;

  const handlePick = (c: Candidate) => {
    if (c.isSameScript) {
      onPick(c.playbackIdx);
    } else if (onPickCrossScript) {
      onPickCrossScript(c.scriptKey, c.vodId, c.playbackIdx);
    }
  };

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
              SOURCE · {candidates.length} 候选
            </p>
            <h1 className="font-display text-base font-extrabold tracking-tight line-clamp-1">
              换源 / 测速
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

          {/* 自动选最快 */}
          <button
            type="button"
            onClick={() => void runAutoFastest()}
            disabled={testing || searching}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-display font-semibold tap mb-2 disabled:opacity-50"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            <IconRetry size={14} />
            {searching
              ? "搜索其它源中…"
              : testing
              ? "测速中…"
              : "自动测速并切到最快"}
          </button>
          {/* 仅测速、不自动切 */}
          <button
            type="button"
            onClick={() => void runAll()}
            disabled={testing || searching}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-display font-semibold tap mb-2 disabled:opacity-50"
            style={{
              background: "var(--ink-2)",
              border: "1px solid var(--cream-line)",
              color: "var(--cream)",
            }}
          >
            {crossSearched ? "手动重新测速" : "仅搜索 + 测速"}
          </button>
          <p className="text-[10px] font-mono tracking-wider text-cream-faint mb-4">
            {crossSearched
              ? `已搜索 ${candidates.filter((c) => !c.isSameScript).length} 个跨源候选`
              : `将向所有启用脚本（${
                  allScripts.filter((s) => s.enabled !== false && s.key !== script?.key).length
                } 个）搜索 "${videoTitle}"`}
          </p>

          {/* 候选列表 */}
          <ul className="space-y-1.5">
            {sorted.map((c) => {
              const isFastest = fastestKey === c.key;
              const clickable = c.isSameScript || !!onPickCrossScript;
              return (
                <li key={c.key}>
                  <button
                    type="button"
                    disabled={!clickable}
                    onClick={() => handlePick(c)}
                    className="w-full text-left p-3 rounded-lg tap disabled:cursor-default disabled:opacity-70"
                    style={{
                      background: c.isCurrent ? "var(--ember-soft)" : "var(--ink-2)",
                      border: `1px solid ${
                        c.isCurrent
                          ? "var(--ember)"
                          : isFastest
                          ? "var(--phosphor)"
                          : "var(--cream-line)"
                      }`,
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          {c.isCurrent && (
                            <span
                              className="font-mono text-[9px] tracking-[0.15em] px-1.5 py-0.5 rounded"
                              style={{ background: "var(--ember)", color: "var(--ink)" }}
                            >
                              CURRENT
                            </span>
                          )}
                          {isFastest && !c.isCurrent && (
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
                          {!c.isSameScript && (
                            <span
                              className="font-mono text-[9px] tracking-[0.15em] px-1.5 py-0.5 rounded"
                              style={{
                                background: "var(--vhs-soft)",
                                color: "var(--vhs)",
                                border: "1px solid rgba(79,195,247,0.3)",
                              }}
                            >
                              CROSS · {c.scriptName}
                            </span>
                          )}
                        </div>
                        <p
                          className="text-sm font-display font-semibold line-clamp-1"
                          style={{
                            color: c.isCurrent ? "var(--ember)" : "var(--cream)",
                          }}
                        >
                          {c.playback?.sourceName ||
                            c.hitTitle ||
                            `${c.scriptName} · 线路 ${c.playbackIdx + 1}`}
                        </p>
                        <p className="text-[10px] font-mono text-cream-faint mt-0.5 line-clamp-1">
                          {c.playback
                            ? `${c.playback.episodes.length} 集 · ${c.playback.sourceId}`
                            : c.hitRemarks
                              ? `${c.scriptName} · ${c.hitRemarks}`
                              : `${c.scriptName} · 待测速`}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        {c.testing && (
                          <div className="signal-bars" style={{ height: 12 }}>
                            <span></span>
                            <span></span>
                            <span></span>
                          </div>
                        )}
                        {typeof c.ms === "number" && (
                          <p
                            className="font-mono text-xs"
                            style={{
                              color:
                                c.ms < 500
                                  ? "var(--phosphor)"
                                  : c.ms < 1500
                                  ? "var(--cream)"
                                  : "var(--ember)",
                            }}
                          >
                            {c.ms} ms
                          </p>
                        )}
                        {c.error && (
                          <p
                            className="font-mono text-[10px]"
                            style={{ color: "#FF6B6B" }}
                            title={c.error}
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
