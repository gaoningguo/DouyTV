import * as cheerio from "cheerio";
import type { ScriptCheerioAPI } from "./types";

/**
 * 加载 HTML 字符串为 cheerio API。
 * MoonTV 脚本中的 `ctx.html.load(html)('selector').text()` 风格在这里直接可用。
 */
export function loadHtml(html: string): ScriptCheerioAPI {
  return cheerio.load(html) as unknown as ScriptCheerioAPI;
}
