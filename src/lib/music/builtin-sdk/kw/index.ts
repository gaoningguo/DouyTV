// @ts-nocheck
/**
 * KW (酷我) 平台聚合 — 暴露 musicSearch / hotSearch / musicUrl 等模块。
 */
import musicSearch from "./musicSearch";
import getHotSearch from "./hotSearch";
import musicUrl from "./musicUrl";

export default {
  musicSearch,
  hotSearch: { getHotSearch },
  musicUrl,
};
