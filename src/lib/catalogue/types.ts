/**
 * Catalogue Source —— 三模块（books / manga / live）共享的源协议抽象。
 *
 * 设计目标：
 *   1. 把 legado JSON、mihon HttpSource、pure_live LiveSite 三派的能力统一到一个接口下，UI 层只看到 `CatalogueSourceModule`。
 *   2. 镜像 `src/source-script/types.ts` 的 ctx 设计，让用户 JS 源能复用同一套 fetch / cache / html / utils API。
 *   3. 渐进迁移：现有 `booksources/runtime.ts` 与 `mangasources/runtime.ts` 在 PR1 里继续直接调用，PR2/3 才切到这层；类型层先就位。
 *
 * 三种 descriptor 都注入 CatalogueSourceModule：
 *   - `type: 'legado-json'` —— 通过 legado-bridge 包装现有规则引擎
 *   - `type: 'script'`      —— 通过 script-runtime 编译用户 JS（new Function 沙盒）
 *   - `type: 'native'`      —— 内置 adapter（如 netlive/platforms/bilibili.ts）直接实现接口
 */
import type { ScriptCache, ScriptLog, ScriptUtils } from "@/source-script/types";

export type CatalogueCategory = "book" | "manga" | "live";

export interface CatalogueMeta {
  /** 源 ID（持久化用，每条 descriptor 唯一） */
  id: string;
  name: string;
  /** 站点主页 —— 也是相对 URL 的基址 */
  baseUrl: string;
  /** 该源属于哪个模块 */
  category: CatalogueCategory;
  /** 语言代码（'zh-CN' / 'en' 等）—— 仅展示用，搜索分组可参考 */
  lang?: string;
  /** 分组标签（"玄幻 / 都市 / 综合" 等，用于源管理页折叠） */
  group?: string;
  /** 是否需要登录 / 付费才能解锁高清晰度（live 用） */
  loginRequired?: boolean;
  /** 注释 / 简介 */
  comment?: string;
}

/* ───────────────── ctx —— 注入给所有 hook 的执行环境 ───────────────── */

export interface CatalogueFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  query?: Record<string, string | number | boolean | undefined | null>;
  json?: unknown;
  timeout?: number;
}

export interface CatalogueFetchResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  ok: boolean;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  bytes(): Promise<Uint8Array>;
}

export interface CatalogueRequestAPI {
  get(url: string, init?: CatalogueFetchInit): Promise<CatalogueFetchResponse>;
  getJson<T = unknown>(url: string, init?: CatalogueFetchInit): Promise<T>;
  getHtml(url: string, init?: CatalogueFetchInit): Promise<string>;
  post(url: string, init?: CatalogueFetchInit): Promise<CatalogueFetchResponse>;
}

export interface CatalogueHtmlAPI {
  /** 加载 HTML 进 cheerio；与 source-script/html.ts 同形态 */
  load(html: string): unknown;
}

export interface CatalogueCtx {
  /** 直接 fetch 入口 —— 内部走 scriptFetch（Tauri 下通过 Rust ureq 代理） */
  fetch(url: string, init?: CatalogueFetchInit): Promise<CatalogueFetchResponse>;
  /** 高层 request API —— 复用 source-script 的同名接口 */
  request: CatalogueRequestAPI;
  /** HTML 解析（cheerio） */
  html: CatalogueHtmlAPI;
  /** 持久化缓存（key 自动 scope 到 source id） */
  cache: ScriptCache;
  /** log 通道（前缀 source id，UI 可定向收集） */
  log: ScriptLog;
  /** 通用工具：URL 构造 / Base64 / sleep / now ... */
  utils: ScriptUtils;
  /** 源 meta */
  source: CatalogueMeta;
  /** 用户在 settings 里配置的 key/value（如 token, deviceId） */
  config: {
    get(key: string): unknown;
    require(key: string): unknown;
    all(): Record<string, unknown>;
  };
}

/* ───────────────── Filter system（mihon FilterList 风格） ───────────────── */

export type CatalogueFilter =
  | {
      kind: "header";
      name: string;
    }
  | {
      kind: "separator";
    }
  | {
      kind: "text";
      key: string;
      name: string;
      defaultValue?: string;
    }
  | {
      kind: "select";
      key: string;
      name: string;
      options: Array<{ label: string; value: string }>;
      defaultValue?: string;
    }
  | {
      kind: "checkbox";
      key: string;
      name: string;
      defaultValue?: boolean;
    }
  | {
      kind: "sort";
      key: string;
      name: string;
      options: Array<{ label: string; value: string }>;
      defaultValue?: string;
      defaultAscending?: boolean;
    };

export type FilterValues = Record<string, string | boolean | number>;

/* ───────────────── 通用列表项（"卡片"） ───────────────── */

export interface CatalogueItem {
  /** 在该源内的稳定 ID（用于 detail/units 查找） */
  id: string;
  title: string;
  cover?: string;
  /** 副标题 / 作者 / 主播 */
  subtitle?: string;
  /** 状态徽章（"完结" / "LIVE" / "更新中"） */
  badge?: string;
  /** 类目 / tag */
  tags?: string[];
  /** 热度（在线人数 / 字数 / 点赞），UI 排序参考 */
  popularity?: number;
  /** 自由 meta —— detail()/units() 可以从这里读上下文 */
  meta?: Record<string, unknown>;
}

/* ───────────────── 详情 / 章节 / 内容 ───────────────── */

export interface CatalogueDetail extends CatalogueItem {
  description?: string;
  author?: string;
  status?: string;
  genre?: string[];
  /** 更新时间（ISO 字符串 / 文本两可） */
  updatedAt?: string;
}

/**
 * "Unit" 是模块内可独立播放 / 阅读的最小单位：
 *   - book → chapter
 *   - manga → chapter
 *   - live → 单条流（清晰度 / 镜像）
 */
export interface CatalogueUnit {
  id: string;
  title: string;
  /** 在母对象内的序号（0-based） */
  index: number;
  /** 该单元自身的 URL（用于 unitContent 拉内容；可不填，从 meta 拿） */
  url?: string;
  date?: string;
  /** 自由 meta —— 同 CatalogueItem */
  meta?: Record<string, unknown>;
  /** UI 标签（"VIP" / "1080P"） */
  badge?: string;
}

export type CatalogueUnitContent =
  | { kind: "text"; text: string; html?: string }
  | { kind: "images"; urls: string[] }
  | {
      kind: "stream";
      url: string;
      streamType?: "hls" | "flv" | "dash" | "mp4";
      referer?: string;
      ua?: string;
      alternatives?: Array<{ qn: string; label: string; url: string }>;
    };

/* ───────────────── Module 接口本体 ───────────────── */

export interface CatalogueSourceModule {
  meta: CatalogueMeta;

  /** 推荐 / 热门（首页默认 tab） */
  popular?(
    ctx: CatalogueCtx,
    page: number
  ): Promise<{ list: CatalogueItem[]; hasMore: boolean }>;

  /** 最新更新 */
  latest?(
    ctx: CatalogueCtx,
    page: number
  ): Promise<{ list: CatalogueItem[]; hasMore: boolean }>;

  /** 关键字搜索 */
  search?(
    ctx: CatalogueCtx,
    query: string,
    page: number,
    filters?: FilterValues
  ): Promise<{ list: CatalogueItem[]; hasMore: boolean }>;

  /** 过滤器定义（mihon FilterList 风格）—— 静态返回，UI 用来渲染下拉 / chip */
  filters?(ctx: CatalogueCtx): Promise<CatalogueFilter[]>;

  /** 分类 / 探索（legado exploreUrl + pure_live areas）—— 树状或线性都行 */
  categories?(
    ctx: CatalogueCtx
  ): Promise<Array<{ id: string; name: string; cover?: string; parent?: string }>>;

  /** 某分类下房间 / 书目 */
  categoryItems?(
    ctx: CatalogueCtx,
    categoryId: string,
    page: number
  ): Promise<{ list: CatalogueItem[]; hasMore: boolean }>;

  /** 详情 */
  detail(ctx: CatalogueCtx, itemId: string): Promise<CatalogueDetail>;

  /** 子单元列表（章节 / 集 / 清晰度） */
  units(ctx: CatalogueCtx, detail: CatalogueDetail): Promise<CatalogueUnit[]>;

  /** 单元具体内容（文本 / 图片列表 / 流 URL） */
  unitContent(
    ctx: CatalogueCtx,
    unit: CatalogueUnit,
    detail: CatalogueDetail
  ): Promise<CatalogueUnitContent>;
}

/* ───────────────── descriptor —— 持久化形态 ───────────────── */

export type CatalogueDescriptor =
  | {
      type: "legado-json";
      meta: CatalogueMeta;
      /** legado JSON 原文（已解析为 object）—— 由 legado-bridge 解析 */
      legado: unknown;
    }
  | {
      type: "script";
      meta: CatalogueMeta;
      /** 用户 JS 代码 —— 顶层 return 一个 CatalogueSourceModule（不带 meta） */
      code: string;
      /** 用户配置（注入 ctx.config） */
      config?: Record<string, unknown>;
    }
  | {
      type: "native";
      meta: CatalogueMeta;
      /** native adapter 在代码里直接注册到 registry，descriptor 仅用于持久化"已启用"状态 */
    };

export function isCatalogueCategory(s: unknown): s is CatalogueCategory {
  return s === "book" || s === "manga" || s === "live";
}
