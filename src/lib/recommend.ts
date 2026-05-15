import type { MediaItem } from "@/types/media";
import type { HistoryRecord } from "@/stores/library";
import type { ScriptDescriptor } from "@/source-script/types";

/**
 * 推荐算法 — 多维度加权 + 种子化随机 + 同源去簇。
 *
 * 设计理念：
 * - 给每个候选 item 计算 score（含一个种子化随机 base）
 * - 用 score 排序，再做 reorder 让同源不连续超过 2 个
 * - reload 时换 seed → 整体顺序变化；loadMore 沿用 seed → 增量稳定
 *
 * 维度（互相可调权）：
 *   base_random      0~0.5  种子随机，保证刷新就变
 *   history_affinity 0~0.3  用户在该 source 近 30 天看的时长占比
 *   type_match       0~0.2  item.typeName 匹配 history 中常看类型
 *   novelty          +0.15  source 安装时间 < 7 天
 *   freshness        +0.10  item.year 在近 3 年
 */
const NOW_MS = () => Date.now();
const DAY_MS = 86_400_000;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

interface Features {
  /** sourceKey -> 近 30 天的总观看时长（秒） */
  watchBySource: Map<string, number>;
  /** 总观看时长（秒，归一化分母） */
  totalWatch: number;
  /** typeName -> 出现次数 */
  typeCounts: Map<string, number>;
  /** topType 总占比，用于归一化 */
  topTypeMax: number;
  /** scriptKey -> installedAt 毫秒 */
  installAt: Map<string, number>;
}

export function pickFeatures(
  history: HistoryRecord[],
  scripts: ScriptDescriptor[]
): Features {
  const cutoff = NOW_MS() - 30 * DAY_MS;
  const watchBySource = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  let totalWatch = 0;
  for (const h of history) {
    if (h.updatedAt < cutoff) continue;
    const w = Math.min(h.position, h.duration || h.position);
    if (w <= 0) continue;
    watchBySource.set(h.scriptKey, (watchBySource.get(h.scriptKey) || 0) + w);
    totalWatch += w;
    // 注：history 没存 typeName，先按 title 里的简单 token 计数（粗略）
    // 这里跳过 type，避免引入额外依赖；type_match 走 item 自带 typeName
  }
  const topTypeMax = Math.max(1, ...Array.from(typeCounts.values()));
  const installAt = new Map<string, number>();
  for (const s of scripts) {
    if (s.installedAt) installAt.set(s.key, s.installedAt);
  }
  return { watchBySource, totalWatch, typeCounts, topTypeMax, installAt };
}

interface ScoreBreakdown {
  total: number;
  base: number;
  history: number;
  type: number;
  novelty: number;
  freshness: number;
}

function scoreItem(
  item: MediaItem,
  rand: () => number,
  feats: Features
): ScoreBreakdown {
  const base = rand() * 0.5;

  let history = 0;
  if (feats.totalWatch > 0 && item.scriptKey) {
    const w = feats.watchBySource.get(item.scriptKey) || 0;
    history = Math.min(0.3, (w / feats.totalWatch) * 0.6);
  }

  let type = 0;
  if (item.typeName && feats.typeCounts.size > 0) {
    const c = feats.typeCounts.get(item.typeName) || 0;
    type = Math.min(0.2, (c / feats.topTypeMax) * 0.2);
  }

  let novelty = 0;
  if (item.scriptKey) {
    const at = feats.installAt.get(item.scriptKey);
    if (at && NOW_MS() - at < 7 * DAY_MS) novelty = 0.15;
  }

  let freshness = 0;
  if (item.year) {
    const y = parseInt(item.year, 10);
    if (Number.isFinite(y)) {
      const yearsAgo = new Date().getFullYear() - y;
      if (yearsAgo >= 0 && yearsAgo <= 3) freshness = 0.1;
    }
  }

  return {
    total: base + history + type + novelty + freshness,
    base,
    history,
    type,
    novelty,
    freshness,
  };
}

/**
 * 散开同 source 的连续 — 简单贪心：从队头开始，遇到上一个同 source 的就和后面第一个不同 source 的换位。
 * 限制：最多连续 2 个同 source。
 */
function diversify(items: MediaItem[]): MediaItem[] {
  const out = items.slice();
  for (let i = 2; i < out.length; i++) {
    if (
      out[i].sourceId === out[i - 1].sourceId &&
      out[i].sourceId === out[i - 2].sourceId
    ) {
      // 找下一个不同 source 的 item 与之换位
      for (let j = i + 1; j < out.length; j++) {
        if (out[j].sourceId !== out[i].sourceId) {
          [out[i], out[j]] = [out[j], out[i]];
          break;
        }
      }
    }
  }
  return out;
}

export interface RankOptions {
  history: HistoryRecord[];
  scripts: ScriptDescriptor[];
  seed: number;
  /** 调试模式 — console.debug 头 5 个 score 分解 */
  debug?: boolean;
}

export function rankAndShuffle(
  items: MediaItem[],
  opts: RankOptions
): MediaItem[] {
  if (items.length <= 1) return items;
  const feats = pickFeatures(opts.history, opts.scripts);

  const scored = items.map((item) => {
    // 每个 item 用 (seed XOR itemHash) 作为 mulberry seed，保证同 seed 同 item 同 score
    const rand = mulberry32(opts.seed ^ hashString(item.id));
    return { item, score: scoreItem(item, rand, feats) };
  });

  scored.sort((a, b) => b.score.total - a.score.total);

  if (opts.debug) {
    console.debug(
      "[recommend] top 5 scores",
      scored.slice(0, 5).map((x) => ({
        title: x.item.title,
        source: x.item.sourceName,
        ...x.score,
      }))
    );
  }

  return diversify(scored.map((x) => x.item));
}
