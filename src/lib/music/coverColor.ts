/**
 * 封面取色：从图片缩采样提取一个适合做主题强调色的主色。
 *
 * 策略：把封面画到一个小 canvas（缩到 ~32px）逐像素统计，过滤过暗/过亮/低饱和，
 * 按细色相桶（15°）累计「population × 饱和度」权重，取分最高的桶并融合左右相邻桶
 * （降低繁杂封面上小撮高饱和噪点带偏的概率，思路借鉴 Material Score 但不引依赖），
 * 再做一次亮度/饱和度归一，得到鲜明但不刺眼的强调色。
 *
 * 注意：跨域封面必须先走代理（wrapImage 已代理到 127.0.0.1），且 img.crossOrigin
 * 设 "anonymous"，否则 canvas 会被污染、getImageData 抛 SecurityError。
 */

export interface CoverColor {
  /** 强调色 rgb 字符串，如 "255, 120, 60" */
  accent: string;
  /** 较暗的同色，用于背景渐变底 */
  deep: string;
}

const cache = new Map<string, CoverColor>();

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

const HUE_BUCKETS = 24; // 每 15° 一桶，比 30° 更细，减少撞色

function extractFromImage(img: HTMLImageElement): CoverColor | null {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, size, size);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, size, size).data;
  } catch {
    // canvas 被跨域污染
    return null;
  }

  // 按色相分桶（每 15 度一桶）。每桶分别累计：
  //  - pop：像素计数（衡量该色覆盖面积，抗高饱和小噪点）
  //  - weight/r/g/b：饱和度×适中亮度的加权和与加权颜色
  type Bucket = { pop: number; weight: number; r: number; g: number; b: number };
  const buckets = new Map<number, Bucket>();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 128) continue;
    const [h, s, l] = rgbToHsl(r, g, b);
    if (l < 0.12 || l > 0.92) continue; // 过暗/过亮跳过
    if (s < 0.18) continue; // 太灰跳过
    const key = Math.round(h / (360 / HUE_BUCKETS)) % HUE_BUCKETS;
    const weight = s * (1 - Math.abs(l - 0.5));
    const bucket = buckets.get(key) ?? { pop: 0, weight: 0, r: 0, g: 0, b: 0 };
    bucket.pop += 1;
    bucket.weight += weight;
    bucket.r += r * weight;
    bucket.g += g * weight;
    bucket.b += b * weight;
    buckets.set(key, bucket);
  }

  if (buckets.size === 0) return null;

  // 融合相邻桶（左右各 1 桶，环形）后再打分，避免主色被切在两桶边界上而落选。
  // 分数 = 融合 population × 融合饱和权重（借鉴 Material Score：兼顾面积与鲜艳度）。
  let bestKey = -1;
  let bestScore = -1;
  for (const key of buckets.keys()) {
    let pop = 0;
    let weight = 0;
    for (let d = -1; d <= 1; d += 1) {
      const adj = buckets.get((key + d + HUE_BUCKETS) % HUE_BUCKETS);
      if (adj) {
        pop += adj.pop;
        weight += adj.weight;
      }
    }
    const score = pop * weight;
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }
  if (bestKey < 0) return null;

  // 用中心桶的加权颜色作为代表色（相邻桶仅用于打分，不混入颜色，避免被邻桶拉灰）。
  const best = buckets.get(bestKey)!;
  if (best.weight === 0) return null;
  const r = best.r / best.weight;
  const g = best.g / best.weight;
  const b = best.b / best.weight;
  let [h, s, l] = rgbToHsl(r, g, b);
  // 归一到鲜明但不刺眼：饱和度抬到 0.55~0.85，亮度收到 0.5~0.62。
  s = Math.min(0.85, Math.max(0.55, s));
  const accentRgb = hslToRgb(h, s, Math.min(0.62, Math.max(0.5, l)));
  const deepRgb = hslToRgb(h, Math.min(0.7, s), 0.16);
  return {
    accent: `${accentRgb[0]}, ${accentRgb[1]}, ${accentRgb[2]}`,
    deep: `${deepRgb[0]}, ${deepRgb[1]}, ${deepRgb[2]}`,
  };
}

/**
 * 异步取封面主色（带缓存）。url 应为已可加载的（代理后）地址。
 * 失败返回 null（调用方回退到默认 ember 主题）。
 */
export function getCoverColor(url: string): Promise<CoverColor | null> {
  if (!url) return Promise.resolve(null);
  const cached = cache.get(url);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const color = extractFromImage(img);
      if (color) cache.set(url, color);
      resolve(color);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
