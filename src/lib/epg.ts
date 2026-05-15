import * as cheerio from "cheerio";

export interface EpgProgramme {
  start: number; // unix seconds
  stop: number;
  title: string;
  desc?: string;
}

/**
 * 解析 XMLTV 文档为 channelId → 节目列表的 Map。
 * 兼容常见的 `start="20240501123000 +0800"` 和 `start="20240501123000Z"` 格式。
 */
export function parseXmlTv(xml: string): Record<string, EpgProgramme[]> {
  const $ = cheerio.load(xml, { xml: true });
  const out: Record<string, EpgProgramme[]> = {};
  $("programme").each((_i, el) => {
    const $el = $(el);
    const channel = $el.attr("channel");
    const start = parseXmlTvTime($el.attr("start"));
    const stop = parseXmlTvTime($el.attr("stop"));
    const title = $el.find("title").first().text().trim();
    const desc = $el.find("desc").first().text().trim() || undefined;
    if (!channel || start === undefined || stop === undefined || !title) return;
    (out[channel] ??= []).push({ start, stop, title, desc });
  });
  for (const k in out) out[k].sort((a, b) => a.start - b.start);
  return out;
}

function parseXmlTvTime(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = s
    .trim()
    .match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{4}|Z))?$/);
  if (!m) return undefined;
  const [, Y, M, D, h, mi, sec, tz] = m;
  const isoTz =
    !tz || tz === "Z" ? "Z" : `${tz.slice(0, 3)}:${tz.slice(3)}`;
  const d = new Date(`${Y}-${M}-${D}T${h}:${mi}:${sec}${isoTz}`);
  return isNaN(d.getTime()) ? undefined : Math.floor(d.getTime() / 1000);
}

export function findCurrent(
  progs: EpgProgramme[] | undefined,
  nowSec: number = Math.floor(Date.now() / 1000)
): EpgProgramme | undefined {
  if (!progs?.length) return undefined;
  for (const p of progs) {
    if (p.start <= nowSec && p.stop > nowSec) return p;
  }
  return undefined;
}

export function findUpcoming(
  progs: EpgProgramme[] | undefined,
  count: number,
  nowSec: number = Math.floor(Date.now() / 1000)
): EpgProgramme[] {
  if (!progs?.length) return [];
  return progs.filter((p) => p.start > nowSec).slice(0, count);
}

export function formatProgrammeTime(sec: number): string {
  const d = new Date(sec * 1000);
  return `${d.getHours().toString().padStart(2, "0")}:${d
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
}
