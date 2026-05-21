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

/* ───────────────── Tachiyomi / Mihon 扩展索引（只读目录） ─────────────────
 * 这类条目无法在 DouyTV 客户端直接抓取（逻辑封装在 .apk 内），
 * 但用户拿到的「漫画源仓库 URL」很多是这种格式，我们把它当成
 * 「需 Suwayomi 才能消费」的只读目录展示，避免一键导入直接报错。
 */
export interface TachiyomiCatalogSource {
  id: string;
  name: string;
  lang?: string;
  baseUrl?: string;
}

export interface TachiyomiExtension {
  /** 拓展显示名（如 "Tachiyomi: CopyManga"） */
  name: string;
  /** 包名（如 eu.kanade.tachiyomi.extension.zh.copymanga） */
  pkg: string;
  /** apk 文件名（仅用于展示，DouyTV 不实际下载） */
  apk?: string;
  lang?: string;
  version?: string;
  nsfw?: boolean;
  /** 扩展内包含的站点（同一 apk 可能有多个站） */
  sources: TachiyomiCatalogSource[];
  /** 索引仓库 URL（导入来源） */
  fromRepo?: string;
  importedAt: number;
}
