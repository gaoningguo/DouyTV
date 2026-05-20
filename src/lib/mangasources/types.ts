/**
 * JSON 漫画源 schema —— DouyTV 自定义协议（无现成标准，参考 Tachiyomi/Mihon 拓展和 legado-漫画分支）。
 *
 * 与 Tachiyomi 不同：DouyTV 走客户端规则解析（不需要 JVM 扩展），跟 legado 书源同一个引擎。
 * 适合给中文漫画站做轻量适配。
 */

export interface MangaSourceV2 {
  id: string;
  addedAt: number;
  enabled: boolean;

  /** 显示名 */
  name: string;
  /** 站点主页（相对 URL 解析基址） */
  baseUrl: string;
  /** 分组 */
  group?: string;
  /** 注释 */
  comment?: string;
  /** HTTP header (JSON 字符串) */
  header?: string;

  /** 搜索 URL，{{key}} 关键字，{{page}} 页码 */
  searchUrl?: string;
  /** 探索 / 推荐 URL，{{page}} 页码 */
  exploreUrl?: string;

  /** 列表页规则（search/explore 共用） */
  ruleList?: MangaListRule;
  /** 详情页规则 */
  ruleDetail?: MangaDetailRule;
  /** 章节列表规则 */
  ruleChapters?: MangaChapterListRule;
  /** 单章节图片列表规则 */
  rulePages?: MangaPagesRule;
}

export interface MangaListRule {
  items?: string;
  name?: string;
  url?: string;
  cover?: string;
  author?: string;
  status?: string;
}

export interface MangaDetailRule {
  name?: string;
  author?: string;
  cover?: string;
  intro?: string;
  status?: string;
  kind?: string;
  /** 章节列表 URL —— 不设则与详情同 URL */
  chaptersUrl?: string;
}

export interface MangaChapterListRule {
  items?: string;
  title?: string;
  url?: string;
  date?: string;
  /** 多页 */
  nextUrl?: string;
}

export interface MangaPagesRule {
  /** 图片项列表选择器 */
  items?: string;
  /** 单张图片 URL 提取规则（相对 items 子节点） */
  imageUrl?: string;
  /** 多页：下一页选择器 */
  nextUrl?: string;
}

/* ───────────────── 运行时模型 ───────────────── */

export interface MangaItem {
  id: string;
  sourceId: string;
  url: string;
  name: string;
  author?: string;
  cover?: string;
  status?: string;
}

export interface MangaDetail extends MangaItem {
  intro?: string;
  kind?: string;
  chaptersUrl: string;
}

export interface MangaChapter {
  id: string;
  mangaId: string;
  index: number;
  title: string;
  url: string;
  date?: string;
}

export interface MangaShelfItemV2 extends MangaItem {
  savedAt: number;
  lastReadChapterIndex?: number;
  lastReadChapterTitle?: string;
  lastReadAt?: number;
}

export interface MangaReadProgressV2 {
  mangaId: string;
  chapterIndex: number;
  pageIndex: number;
  pageCount: number;
  updatedAt: number;
}
