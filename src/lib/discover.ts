/**
 * 官方发现源共享类型 —— 小说 / 漫画首页的"壳子"数据(推荐 / 榜单 / 完结)。
 *
 * 与影视的豆瓣壳子同构:官方接口只提供 展示用元数据(标题 / 封面 / 作者 / 分类),
 * 点击后拿标题去用户配置的源(书源 / Suwayomi)里搜索解析,真正阅读走用户源。
 */

/** 归一化后的发现条目(小说 / 漫画通用)。 */
export interface DiscoverItem {
  /** 源内唯一 id(起点 bid / B站 comic_id / 包子 comic_id),仅用于 React key 去重。 */
  id: string;
  title: string;
  /** 已可直接 <img src> 的封面 URL(未过本地代理,调用方按需 wrapImage)。 */
  cover: string;
  author?: string;
  /** 分类 / 题材短标签。 */
  cat?: string;
  /** 简介(可能缺失)。 */
  desc?: string;
  /** 榜单排名 / 热度等附加信息(如 "597.89万")。 */
  meta?: string;
  /** 横版大图(轮播用,缺失时回退 cover)。 */
  wide?: string;
  /** 是否完结。 */
  finished?: boolean;
  /** 总话数(展示 "共 N 话")。 */
  episodes?: number;
  /** 状态行分段(各分区文案不同:畅销指数/人热议中/完结共N话),gold 段用强调色。 */
  metaSegs?: Array<{ text: string; gold?: boolean }>;
}

/** 一个发现分区(如 "月票榜" / "完结精选")。 */
export interface DiscoverSection {
  key: string;
  label: string;
  items: DiscoverItem[];
}
