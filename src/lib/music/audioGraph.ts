/**
 * Web Audio 图：把 <audio> 元素接到 EQ（多频段 BiquadFilter）→ AnalyserNode → GainNode → destination。
 *
 * 关键约束：
 *  - createMediaElementSource 对同一个元素只能调用一次，且调用后该元素的输出**永久**
 *    改走 Web Audio 图。若音频是跨域且无 CORS 头，source 会被「污染」导致整条链静音。
 *    ⇒ 只在音频走本地代理（CORS-clean）时才建图，且必须先设 crossOrigin="anonymous"。
 *  - AudioContext 受自动播放策略限制，需在用户手势后 resume()。
 *
 * 单例：整个应用只有一个 <audio>，所以图也是单例。
 */

const EQ_BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 16000] as const;

export type EqBand = (typeof EQ_BANDS)[number];

export interface EqPreset {
  id: string;
  label: string;
  /** 每个频段增益 dB，顺序对应 EQ_BANDS */
  gains: number[];
}

export const EQ_FREQUENCIES: readonly number[] = EQ_BANDS;

// 预设增益（dB），长度与 EQ_BANDS 对齐。
export const EQ_PRESETS: EqPreset[] = [
  { id: "flat", label: "原声", gains: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: "pop", label: "流行", gains: [-1, 2, 4, 4, 1, -1, -1, 2, 3] },
  { id: "rock", label: "摇滚", gains: [4, 3, -1, -2, -1, 2, 4, 5, 5] },
  { id: "jazz", label: "爵士", gains: [3, 2, 1, 2, -1, -1, 0, 1, 3] },
  { id: "classical", label: "古典", gains: [4, 3, 2, 0, -1, -1, 0, 2, 3] },
  { id: "bass", label: "重低音", gains: [6, 5, 4, 2, 0, 0, 0, 0, 0] },
  { id: "vocal", label: "人声", gains: [-2, -1, 1, 3, 4, 4, 3, 1, 0] },
];

interface AudioGraph {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  filters: BiquadFilterNode[];
  analyser: AnalyserNode;
  gain: GainNode;
}

let graph: AudioGraph | null = null;
let attachedEl: HTMLAudioElement | null = null;

/** 当前帧的频谱字节缓冲（复用，避免每帧分配）。 */
let freqBuffer: Uint8Array<ArrayBuffer> | null = null;

function createGraph(el: HTMLAudioElement): AudioGraph | null {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  const source = ctx.createMediaElementSource(el);

  const filters = EQ_BANDS.map((freq, index) => {
    const filter = ctx.createBiquadFilter();
    // 两端用 lowshelf/highshelf，中间用 peaking，和常见 10 段 EQ 一致。
    if (index === 0) filter.type = "lowshelf";
    else if (index === EQ_BANDS.length - 1) filter.type = "highshelf";
    else filter.type = "peaking";
    filter.frequency.value = freq;
    filter.Q.value = 1.0;
    filter.gain.value = 0;
    return filter;
  });

  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.8;

  const gain = ctx.createGain();
  gain.gain.value = 1;

  // 串联：source → f0 → f1 → … → fn → analyser → gain → destination
  let node: AudioNode = source;
  for (const filter of filters) {
    node.connect(filter);
    node = filter;
  }
  node.connect(analyser);
  analyser.connect(gain);
  gain.connect(ctx.destination);

  freqBuffer = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
  return { ctx, source, filters, analyser, gain };
}

/**
 * 确保图已建立并绑定到该元素。返回 false 表示不可用（不支持 / 已绑定到别的元素）。
 * 必须在调用方已确保音频 CORS-clean 且 el.crossOrigin 已设的前提下调用。
 */
export function ensureAudioGraph(el: HTMLAudioElement): boolean {
  if (graph && attachedEl === el) return true;
  if (graph && attachedEl !== el) {
    // 一个元素只能建一次图；切换元素的场景本应用不存在。
    return false;
  }
  try {
    const created = createGraph(el);
    if (!created) return false;
    graph = created;
    attachedEl = el;
    return true;
  } catch (error) {
    console.warn("[audioGraph] 建图失败（可能音频被跨域污染）", error);
    return false;
  }
}

export function isAudioGraphReady(): boolean {
  return !!graph;
}

/** 用户手势后恢复被挂起的 AudioContext。 */
export function resumeAudioGraph(): void {
  if (graph && graph.ctx.state === "suspended") {
    void graph.ctx.resume().catch(() => undefined);
  }
}

/** 设置某频段增益（dB）。index 对应 EQ_FREQUENCIES。 */
export function setEqGain(index: number, gainDb: number): void {
  const filter = graph?.filters[index];
  if (filter) {
    filter.gain.setTargetAtTime(gainDb, graph!.ctx.currentTime, 0.02);
  }
}

/** 批量套用预设增益数组。 */
export function applyEqGains(gains: number[]): void {
  if (!graph) return;
  gains.forEach((g, index) => {
    const filter = graph!.filters[index];
    if (filter) filter.gain.setTargetAtTime(g, graph!.ctx.currentTime, 0.02);
  });
}

/**
 * 取当前频谱（0..1 归一化的若干柱）。bars 为想要的柱数。
 * 返回 null 表示图未就绪，调用方应回退到装饰动画。
 */
export function getSpectrum(bars: number): Float32Array | null {
  if (!graph || !freqBuffer) return null;
  graph.analyser.getByteFrequencyData(freqBuffer);
  const out = new Float32Array(bars);
  // 人耳对低频更敏感，用对数分桶让低频占更多柱。
  const binCount = freqBuffer.length;
  for (let i = 0; i < bars; i += 1) {
    const lo = Math.floor(Math.pow(i / bars, 1.6) * binCount);
    const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / bars, 1.6) * binCount));
    let sum = 0;
    for (let j = lo; j < hi && j < binCount; j += 1) sum += freqBuffer[j];
    out[i] = sum / (hi - lo) / 255;
  }
  return out;
}
