/**
 * Web Audio 双 deck 混音图（支持真·重叠 crossfade）。
 *
 * 拓扑：
 *   deckA: <audio>A → srcA → gainA ┐
 *   deckB: <audio>B → srcB → gainB ┘→ 合流 → EQ(filters) → analyser → masterGain → destination
 *
 * 设计要点：
 *  - createMediaElementSource 对同一元素只能调一次、且调用后该元素输出**永久**走 Web Audio 图。
 *    所以两个 <audio> 元素在首次 ensureDeck 时各自建一次 source，之后复用。
 *  - 跨域无 CORS 头的音频会污染 source 导致静音 → 只在音频走本地代理(CORS-clean)且
 *    元素 crossOrigin="anonymous" 时建 source。
 *  - EQ / analyser(频谱) / ReplayGain / masterGain 都在**两 deck 合流之后**，只一套；
 *    crossfade 期间两首歌共享同一 EQ。crossfade 靠两条 deck 各自的 gainA/gainB 反向 ramp。
 *  - AudioContext 受自动播放策略限制，需在用户手势后 resume()。
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

/** 单条 deck：一个 <audio> 元素 + 它的 source + 该 deck 的淡入淡出增益。 */
interface Deck {
  el: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  /** 该 deck 的 crossfade 增益（0..1），合流前。 */
  gain: GainNode;
}

/** 混音图（合流后的共享链路）：EQ → analyser → masterGain → destination。 */
interface MixGraph {
  ctx: AudioContext;
  /** 合流节点：两条 deck 的 gain 都接到它。 */
  bus: GainNode;
  filters: BiquadFilterNode[];
  analyser: AnalyserNode;
  /** ReplayGain 补偿增益（合流后）。 */
  masterGain: GainNode;
}

let mix: MixGraph | null = null;
const decks = new Map<HTMLAudioElement, Deck>();

// ── ReplayGain（响度均衡）──
// analyser 在 masterGain 之前，读到的是合流后、未经响度补偿的信号，用来估算响度，
// 再反推 masterGain 的补偿系数。在线流无内嵌 ReplayGain 标签，故走运行时 AGC：
// 缓慢把平均响度拉向 TARGET_RMS，补偿系数夹在 [MIN,MAX] 防爆音/过度放大。
const RG_TARGET_RMS = 0.18; // ≈ -15 dBFS，常见流媒体响度目标
const RG_MIN_GAIN = 0.5;
const RG_MAX_GAIN = 2.2;
const RG_FLOOR_RMS = 0.02; // 低于此视为静音/间奏，不参与估算
let replayGainEnabled = false;
let rgTimer: number | null = null;
let rgTimeBuffer: Uint8Array<ArrayBuffer> | null = null;
let rgEmaRms = 0; // 指数滑动平均的响度估计

function rgTick(): void {
  if (!mix || !rgTimeBuffer) return;
  mix.analyser.getByteTimeDomainData(rgTimeBuffer);
  // 计算本帧 RMS（字节域以 128 为中心）。
  let sumSq = 0;
  for (let i = 0; i < rgTimeBuffer.length; i += 1) {
    const v = (rgTimeBuffer[i] - 128) / 128;
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / rgTimeBuffer.length);
  if (rms < RG_FLOOR_RMS) return; // 静音段不更新估计
  // 慢速 EMA，避免瞬态把增益拉飞。
  rgEmaRms = rgEmaRms === 0 ? rms : rgEmaRms * 0.9 + rms * 0.1;
  const target = Math.min(RG_MAX_GAIN, Math.max(RG_MIN_GAIN, RG_TARGET_RMS / rgEmaRms));
  // 平滑落到 masterGain（0.5s 时间常数），听感无突变。
  mix.masterGain.gain.setTargetAtTime(target, mix.ctx.currentTime, 0.5);
}

function startReplayGainLoop(): void {
  if (rgTimer !== null || !mix) return;
  if (!rgTimeBuffer) rgTimeBuffer = new Uint8Array(new ArrayBuffer(mix.analyser.fftSize));
  rgTimer = window.setInterval(rgTick, 200); // 5Hz 足够，AGC 本就缓慢
}

function stopReplayGainLoop(resetGain: boolean): void {
  if (rgTimer !== null) {
    window.clearInterval(rgTimer);
    rgTimer = null;
  }
  if (resetGain && mix) {
    mix.masterGain.gain.setTargetAtTime(1, mix.ctx.currentTime, 0.3);
  }
}

/** 开关响度均衡（ReplayGain）。关闭时把补偿增益平滑复位到 1。 */
export function setReplayGainEnabled(enabled: boolean): void {
  replayGainEnabled = enabled;
  if (!mix) return;
  if (enabled) startReplayGainLoop();
  else stopReplayGainLoop(true);
}

/** 切歌时调用：重置响度估计，让 AGC 对新曲重新收敛。 */
export function resetReplayGain(): void {
  rgEmaRms = 0;
  if (mix && !replayGainEnabled) {
    mix.masterGain.gain.setTargetAtTime(1, mix.ctx.currentTime, 0.2);
  }
}

/** 当前帧的频谱字节缓冲（复用，避免每帧分配）。 */
let freqBuffer: Uint8Array<ArrayBuffer> | null = null;

function getCtx(): AudioContext | null {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  return new Ctx();
}

/** 建合流后的共享链路（首次需要时）。 */
function ensureMix(ctx: AudioContext): MixGraph {
  if (mix) return mix;
  const bus = ctx.createGain();
  bus.gain.value = 1;

  const filters = EQ_BANDS.map((freq, index) => {
    const filter = ctx.createBiquadFilter();
    // 两端用 lowshelf/highshelf，中间用 peaking，和常见 9 段 EQ 一致。
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

  const masterGain = ctx.createGain();
  masterGain.gain.value = 1;

  // bus → f0 → … → fn → analyser → masterGain → destination
  let node: AudioNode = bus;
  for (const filter of filters) {
    node.connect(filter);
    node = filter;
  }
  node.connect(analyser);
  analyser.connect(masterGain);
  masterGain.connect(ctx.destination);

  freqBuffer = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
  mix = { ctx, bus, filters, analyser, masterGain };
  return mix;
}

/**
 * 确保该元素已建 deck 并接入混音图。返回 false 表示不可用（不支持 / 建 source 失败）。
 * 必须在调用方已确保音频 CORS-clean 且 el.crossOrigin 已设的前提下调用。
 *
 * 兼容旧调用名 ensureAudioGraph：单 deck 用法照常工作。
 */
export function ensureDeck(el: HTMLAudioElement): boolean {
  if (decks.has(el)) return true;
  try {
    const ctx = mix?.ctx ?? getCtx();
    if (!ctx) return false;
    const m = ensureMix(ctx);
    const source = m.ctx.createMediaElementSource(el);
    const gain = m.ctx.createGain();
    gain.gain.value = 1;
    source.connect(gain);
    gain.connect(m.bus);
    decks.set(el, { el, source, gain });
    // 建图前若已打开响度均衡，补启 AGC 循环。
    if (replayGainEnabled) startReplayGainLoop();
    return true;
  } catch (error) {
    console.warn("[audioGraph] 建 deck 失败（可能音频被跨域污染）", error);
    return false;
  }
}

/** 旧名兼容：等价于 ensureDeck。 */
export const ensureAudioGraph = ensureDeck;

export function isAudioGraphReady(): boolean {
  return !!mix;
}

/** 用户手势后恢复被挂起的 AudioContext。 */
export function resumeAudioGraph(): void {
  if (mix && mix.ctx.state === "suspended") {
    void mix.ctx.resume().catch(() => undefined);
  }
}

/**
 * crossfade：把某条 deck 的增益在 durationSec 内 ramp 到 target(0..1)。
 * 用 setTargetAtTime 的指数趋近（time constant ≈ duration/3）做等功率近似的平滑过渡。
 * deck 未建图（如非 CORS-clean 音频）时返回 false，调用方应回退到元素 volume 淡变。
 */
export function fadeDeckGain(el: HTMLAudioElement, target: number, durationSec: number): boolean {
  const deck = decks.get(el);
  if (!deck || !mix) return false;
  const t = Math.min(1, Math.max(0, target));
  const now = mix.ctx.currentTime;
  deck.gain.gain.cancelScheduledValues(now);
  // 锚定当前值，避免从默认值跳变。
  deck.gain.gain.setValueAtTime(deck.gain.gain.value, now);
  if (durationSec <= 0) {
    deck.gain.gain.setValueAtTime(t, now);
  } else {
    // 线性 ramp：两 deck 反向线性叠加在听感上接近等响度，且实现简单可预测。
    deck.gain.gain.linearRampToValueAtTime(t, now + durationSec);
  }
  return true;
}

/** 立即把某条 deck 增益设为定值（不 ramp）。deck 未建图返回 false。 */
export function setDeckGain(el: HTMLAudioElement, value: number): boolean {
  const deck = decks.get(el);
  if (!deck || !mix) return false;
  const v = Math.min(1, Math.max(0, value));
  deck.gain.gain.cancelScheduledValues(mix.ctx.currentTime);
  deck.gain.gain.setValueAtTime(v, mix.ctx.currentTime);
  return true;
}

/** 该元素是否已建 deck（接入了混音图）。 */
export function hasDeck(el: HTMLAudioElement): boolean {
  return decks.has(el);
}

/** 设置某频段增益（dB）。index 对应 EQ_FREQUENCIES。 */
export function setEqGain(index: number, gainDb: number): void {
  const filter = mix?.filters[index];
  if (filter && mix) {
    filter.gain.setTargetAtTime(gainDb, mix.ctx.currentTime, 0.02);
  }
}

/** 批量套用预设增益数组。 */
export function applyEqGains(gains: number[]): void {
  if (!mix) return;
  gains.forEach((g, index) => {
    const filter = mix!.filters[index];
    if (filter) filter.gain.setTargetAtTime(g, mix!.ctx.currentTime, 0.02);
  });
}

/**
 * 取当前频谱（0..1 归一化的若干柱）。bars 为想要的柱数。
 * 返回 null 表示图未就绪，调用方应回退到装饰动画。
 */
export function getSpectrum(bars: number): Float32Array | null {
  if (!mix || !freqBuffer) return null;
  mix.analyser.getByteFrequencyData(freqBuffer);
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
