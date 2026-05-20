// @ts-nocheck
/**
 * KW (酷我) 平台聚合 — 暴露 musicSearch / hotSearch 等模块。
 * 当前覆盖：musicSearch ✅、hotSearch ✅、其他 ⏳。
 */
import musicSearch from "./musicSearch";
import getHotSearch from "./hotSearch";

export default {
  musicSearch,
  hotSearch: { getHotSearch },
};
