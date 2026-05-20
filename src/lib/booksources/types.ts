/**
 * Legado-compatible 书源 schema（子集）+ DouyTV 运行时 / 阅读模型。
 *
 * 与上游 legado-app (gedoor/legado) 兼容字段：bookSourceName / bookSourceUrl / searchUrl /
 * ruleSearch / ruleBookInfo / ruleToc / ruleContent / header。
 *
 * 复用的目的是：用户能直接粘贴 GitHub 上现成的 legado 书源 JSON（社区里有十几万个），
 * 不需要二次改造。
 *
 * 不支持的字段（出于安全 / 复杂度）：
 *  - `js:` 内嵌 JS 规则（少数源用，写起来类似 mod 包，不进 sandbox）
 *  - 翻页器 / 分页参数链（MVP 只支持 {{page}} 变量替换，不解析嵌套登录 / cookie 链）
 *  - 替换规则的 `replaceRegex` 跨章节复用 (按章节临时跑)
 */

/** 单源（与 legado JSON 完全同名） */
export interface BookSourceV2 {
  /** 是否启用 */
  enabled: boolean;
  /** 显示名 */
  bookSourceName: string;
  /** 源主页 URL —— 也是相对路径的解析基址 */
  bookSourceUrl: string;
  /** 0=文本（网络小说）/ 1=有声书。MVP 只处理 0 */
  bookSourceType?: number;
  /** 分组（玄幻 / 都市 / 综合 等） */
  bookSourceGroup?: string;
  /** 注释 */
  bookSourceComment?: string;
  /** HTTP header (JSON 字符串)。常见键 User-Agent, Cookie */
  header?: string;
  /** 搜索 URL 模板。变量：{{key}} 关键字 / {{page}} 页码 */
  searchUrl?: string;
  /** 探索发现 URL 模板（榜单 / 分类） —— 部分源有 */
  exploreUrl?: string;
  /** 上次更新时间戳（导入 / 同步用，DouyTV 写入） */
  lastUpdateTime?: number;
  /** 搜索结果规则 */
  ruleSearch?: SearchRule;
  /** 书籍详情规则 */
  ruleBookInfo?: BookInfoRule;
  /** 目录页规则 */
  ruleToc?: TocRule;
  /** 正文规则 */
  ruleContent?: ContentRule;
  /** 探索规则 */
  ruleExplore?: ExploreRule;

  /** DouyTV 内部 ID（持久化用，legado JSON 里没有；导入时生成） */
  id: string;
  /** DouyTV 添加时间 */
  addedAt: number;
}

export interface SearchRule {
  bookList?: string;
  name?: string;
  author?: string;
  bookUrl?: string;
  coverUrl?: string;
  intro?: string;
  kind?: string;
  lastChapter?: string;
  wordCount?: string;
}

export interface BookInfoRule {
  init?: string;
  name?: string;
  author?: string;
  intro?: string;
  coverUrl?: string;
  kind?: string;
  lastChapter?: string;
  wordCount?: string;
  /** 目录页 URL —— 不设则与详情页同 URL */
  tocUrl?: string;
}

export interface TocRule {
  chapterList?: string;
  chapterName?: string;
  chapterUrl?: string;
  /** 多页章节列表用 */
  nextTocUrl?: string;
  isVolume?: string;
  isVip?: string;
  isPay?: string;
  updateTime?: string;
}

export interface ContentRule {
  content?: string;
  /** 多页正文用 */
  nextContentUrl?: string;
  /** 替换规则 —— 形如 "##广告.+##" 或 "##正则##替换" */
  replaceRegex?: string;
  imageStyle?: string;
}

export interface ExploreRule extends SearchRule {
  /** 见 SearchRule，结构相同 */
}

/* ───────────────── DouyTV 运行时模型 —— 与 legado 解耦的内部表示 ───────────────── */

export interface NovelBook {
  /** 由 sourceId + bookUrl 拼成的 stable id */
  id: string;
  sourceId: string;
  /** 书在原站的 URL（详情页） */
  url: string;
  name: string;
  author?: string;
  cover?: string;
  intro?: string;
  kind?: string;
  lastChapter?: string;
  wordCount?: string;
}

export interface NovelChapter {
  /** 由 sourceId + chapterUrl 拼成 */
  id: string;
  bookId: string;
  index: number;
  title: string;
  url: string;
  isVolume?: boolean;
  isVip?: boolean;
}

/** 书架记录 —— 持久化用户收藏 */
export interface NovelShelfItem extends NovelBook {
  savedAt: number;
  lastReadChapterIndex?: number;
  lastReadChapterTitle?: string;
  lastReadAt?: number;
}

/** 阅读进度 */
export interface NovelReadProgress {
  bookId: string;
  chapterIndex: number;
  /** 章节内字符滚动位置 (0-1) */
  scrollRatio: number;
  updatedAt: number;
}
