// @ts-nocheck
/**
 * KW 搜索 — 直接移植自 lx-music musicSdk/kw/musicSearch.js。
 * 走 http://search.kuwo.cn/r.s 公开端点，无签名。
 */
import { httpFetch } from "../request";
import { formatPlayTime, decodeName } from "../common";
import { formatSinger } from "./util";

interface KwRawSong {
  MUSICRID: string;
  SONGNAME: string;
  ARTIST: string;
  ALBUM?: string;
  ALBUMID?: string;
  DURATION: string;
  N_MINFO: string;
}

interface KwSearchResponse {
  TOTAL: string;
  SHOW?: string;
  abslist?: KwRawSong[];
}

interface KwSearchResult {
  list: Array<{
    name: string;
    singer: string;
    source: "kw";
    songmid: string;
    albumId: string;
    interval: string;
    albumName: string;
    types: Array<{ type: string; size: string }>;
    _types: Record<string, { size: string }>;
    img: null;
    lrc: null;
    typeUrl: Record<string, never>;
    otherSource: null;
  }>;
  allPage: number;
  total: number;
  limit: number;
  source: "kw";
}

const REG_INFO = /level:(\w+),bitrate:(\d+),format:(\w+),size:([\w.]+)/;

function handleResult(rawData: KwRawSong[] | undefined) {
  if (!rawData) return [];
  const result: KwSearchResult["list"] = [];
  for (const info of rawData) {
    if (!info.N_MINFO) continue;
    const songId = info.MUSICRID.replace("MUSIC_", "");
    const types: Array<{ type: string; size: string }> = [];
    const _types: Record<string, { size: string }> = {};
    for (const seg of info.N_MINFO.split(";")) {
      const m = seg.match(REG_INFO);
      if (!m) continue;
      switch (m[2]) {
        case "4000":
          types.push({ type: "flac24bit", size: m[4] });
          _types.flac24bit = { size: m[4].toUpperCase() };
          break;
        case "2000":
          types.push({ type: "flac", size: m[4] });
          _types.flac = { size: m[4].toUpperCase() };
          break;
        case "320":
          types.push({ type: "320k", size: m[4] });
          _types["320k"] = { size: m[4].toUpperCase() };
          break;
        case "128":
          types.push({ type: "128k", size: m[4] });
          _types["128k"] = { size: m[4].toUpperCase() };
          break;
      }
    }
    types.reverse();
    const interval = parseInt(info.DURATION, 10);
    result.push({
      name: decodeName(info.SONGNAME),
      singer: formatSinger(decodeName(info.ARTIST)),
      source: "kw",
      songmid: songId,
      albumId: decodeName(info.ALBUMID || ""),
      interval: Number.isNaN(interval) ? "0:00" : formatPlayTime(interval),
      albumName: info.ALBUM ? decodeName(info.ALBUM) : "",
      lrc: null,
      img: null,
      otherSource: null,
      types,
      _types,
      typeUrl: {},
    });
  }
  return result;
}

export default {
  limit: 30,
  total: 0,
  allPage: 1,
  page: 0,
  async search(str: string, page = 1, limit?: number, retryNum = 0): Promise<KwSearchResult> {
    if (retryNum > 2) throw new Error("KW 搜索重试超限");
    const lim = limit ?? this.limit;
    const url = `http://search.kuwo.cn/r.s?client=kt&all=${encodeURIComponent(str)}&pn=${page - 1}&rn=${lim}&uid=794762570&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012&encoding=utf8&rformat=json&vermerge=1&mobi=1&issubtitle=1`;
    const { body } = await httpFetch(url).promise;
    const result = body as KwSearchResponse;
    if (!result || (result.TOTAL !== "0" && result.SHOW === "0")) {
      return this.search(str, page, lim, retryNum + 1);
    }
    const list = handleResult(result.abslist);
    this.total = parseInt(result.TOTAL, 10) || 0;
    this.allPage = Math.ceil(this.total / lim);
    return { list, allPage: this.allPage, total: this.total, limit: lim, source: "kw" };
  },
};
