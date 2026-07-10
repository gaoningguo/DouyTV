/**
 * 官方发现卡片 → 用户源解析的共用匹配逻辑(小说 / 漫画通用)。
 *
 * 官方标题(如 B站繁体、带副标题/季数)与用户源里的标题常对不上,单一精确匹配容易落空。
 * 这里提供:
 *   - titleVariants:生成多级查询变体(原标题 → 清洗后短名),供逐轮聚合搜索
 *   - scoreMatch:标题相似度(字符 bigram 的 Dice 系数),容忍繁简部分差异 + 副标题噪音
 *   - decideResolution:按相似度分档 —— 唯一高置信 → 直接跳;多个/不确定 → 交给选择器
 *
 * 不引繁简转换重依赖:Dice 相似度对"碧藍之海 / 碧蓝之海"这类少量异体字仍给中高分,
 * 足够把正确候选排到前面;真正难分的多候选场景交给用户在选择器里挑。
 */

/** 归一化:去空白 / 标点 / 括注,只留字母数字与汉字,用于相似度与精确判定。 */
export function normalizeTitle(t: string): string {
  return (t || "")
    .trim()
    .replace(/[\s　]/g, "")
    .replace(/[()（）[\]【】{}「」『』<>《》·\-_,.!?，。；：:'""]/g, "")
    .replace(/[^\w一-龥]/g, "")
    .toLowerCase();
}

/**
 * 清洗标题:剥掉常见副标题 / 季数 / 括注,得到更易命中的核心短名。
 * 例:「STEEL BALL RUN 星尘斗士的奇妙冒险 第7部」→「STEEL BALL RUN 星尘斗士的奇妙冒险」
 *     「某某(全彩版)」→「某某」
 */
export function cleanTitle(t: string): string {
  return (t || "")
    .replace(/[（(【\[][^）)】\]]*[）)】\]]/g, " ") // 去括注(全彩版/连载中…)
    .replace(/第[0-9一二三四五六七八九十]+[部季卷]/g, " ") // 去"第N部/季/卷"
    .replace(/[:：\-—·].*$/, "") // 去冒号/破折号后的副标题
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 生成查询变体(去重、保序):原标题优先,清洗后短名兜底。
 * 逐个拿去聚合搜索,合并候选。
 */
export function titleVariants(title: string): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const v = s.trim();
    if (v && !out.includes(v)) out.push(v);
  };
  push(title);
  push(cleanTitle(title));
  return out;
}

/** 取字符 bigram 集合(单字标题退化为单字集合)。 */
function bigrams(s: string): Set<string> {
  const set = new Set<string>();
  if (s.length <= 1) {
    if (s) set.add(s);
    return set;
  }
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

/**
 * 标题相似度 [0,1] —— Dice 系数(2·交集 / 两集合大小和)。
 * 归一化后完全相同 → 1;完全无关 → 0。
 */
export function scoreMatch(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ba = bigrams(na);
  const bb = bigrams(nb);
  if (ba.size === 0 || bb.size === 0) return 0;
  let inter = 0;
  for (const g of ba) if (bb.has(g)) inter++;
  return (2 * inter) / (ba.size + bb.size);
}

/** 已评分的候选(与来源无关的通用形状)。 */
export interface ScoredCandidate<T> {
  item: T;
  score: number;
}

/** 解析判定结果。 */
export type Resolution<T> =
  | { kind: "auto"; item: T } // 唯一高置信 → 直接跳
  | { kind: "choose"; candidates: ScoredCandidate<T>[] } // 多个/不确定 → 选择器
  | { kind: "none" }; // 全落空 → 跳搜索页

// 相似度阈值:≥HIGH 视为高置信;≥KEEP 才进候选池。
const HIGH = 0.82;
const KEEP = 0.34;

/**
 * 按官方标题给候选打分并决策。
 *   - 仅一个候选达到 HIGH,且没有其他候选也达到 HIGH → auto(直接跳)
 *   - 有多个达标 / 只有中等分候选 → choose(弹选择器,已按分降序)
 *   - 没有任何候选达到 KEEP → none(跳搜索页)
 * getTitle:从候选取标题用于比对。多源默认顺序由调用方传入的 candidates 顺序决定
 * (同分时先到先排前,即按源顺序)。
 */
export function decideResolution<T>(
  officialTitle: string,
  candidates: T[],
  getTitle: (c: T) => string
): Resolution<T> {
  const scored: ScoredCandidate<T>[] = candidates
    .map((item) => ({ item, score: scoreMatch(officialTitle, getTitle(item)) }))
    .filter((c) => c.score >= KEEP)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { kind: "none" };
  const highs = scored.filter((c) => c.score >= HIGH);
  if (highs.length === 1) return { kind: "auto", item: highs[0].item };
  return { kind: "choose", candidates: scored };
}
