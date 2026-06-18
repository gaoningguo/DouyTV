import { musicSongKey, type MusicSong, type MusicSongListSummary } from "@/lib/music";
import { type LyricLine, type MusicView } from "./types";

export function aggregateMusicLabel(value?: string, fallback = "聚合推荐") {
  const cleaned = (value || "")
    .replace(/网易云音乐|网易云|网易|QQ音乐|QQ|酷我音乐|酷我|酷狗音乐|酷狗|咪咕音乐|咪咕/gi, "")
    .replace(/^[\s·\-_/｜|]+|[\s·\-_/｜|]+$/g, "")
    .trim();
  return cleaned || fallback;
}

export function aggregatePlaylistMeta(item: MusicSongListSummary) {
  return formatCount(item.playCount) || item.author || "聚合歌单";
}

export function dedupeSongs(songs: MusicSong[]) {
  const seen = new Set<string>();
  return songs.filter((song) => {
    const key = musicSongKey(song);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function mostCommonArtist(songs: MusicSong[]) {
  const counts = new Map<string, number>();
  songs.forEach((song) => {
    const name = (song.artist || "").trim();
    if (!name) return;
    // 多歌手时只取第一位，避免「A/B」「A、B」当成独立歌手。
    const primary = name.split(/[/、,，&]| feat\.? | ft\.? /i)[0].trim();
    if (!primary) return;
    counts.set(primary, (counts.get(primary) ?? 0) + 1);
  });
  let best = "";
  let bestCount = 0;
  counts.forEach((count, name) => {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  });
  return best;
}

export function normalizeSongText(value?: string) {
  return (value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[（(].*?[）)]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function musicSearchKey(song: MusicSong) {
  const title = normalizeSongText(song.title);
  const artist = normalizeSongText(song.artist);
  if (!title && !artist) return musicSongKey(song);
  return `${title}:${artist}`;
}

export function dedupeSearchSongs(songs: MusicSong[]) {
  const seen = new Set<string>();
  return songs.filter((song) => {
    const key = musicSearchKey(song);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function mergeSongCandidates(
  map: Map<string, MusicSong[]>,
  songs: MusicSong[]
) {
  const next = new Map(map);
  songs.forEach((song) => {
    const key = musicSearchKey(song);
    const group = next.get(key) ?? [];
    if (!group.some((item) => musicSongKey(item) === musicSongKey(song))) {
      next.set(key, [...group, song]);
    }
  });
  return next;
}

function tagToSeconds(min: string, sec: string, frac?: string): number {
  const m = Number(min);
  const s = Number(sec);
  const ms = frac ? Number(frac.padEnd(3, "0")) : 0;
  if (!Number.isFinite(m) || !Number.isFinite(s)) return 0;
  return m * 60 + s + ms / 1000;
}

export function parseLyric(lyricText: string, tlyricText?: string): LyricLine[] {
  const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;
  const wordTagRegex = /<(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?>/g;

  // 解析翻译（只取行级时间 → 文本）
  const parseTrans = (text: string) => {
    const map = new Map<number, string>();
    text.split("\n").forEach((line) => {
      const matches = Array.from(line.matchAll(timeRegex));
      if (matches.length === 0) return;
      const content = line.replace(timeRegex, "").replace(wordTagRegex, "").trim();
      matches.forEach((match) => {
        const t = tagToSeconds(match[1], match[2], match[3]);
        if (content) map.set(t, content);
      });
    });
    return map;
  };

  // 解析主歌词为带时间的「行」
  type RawLine = { time: number; raw: string };
  const rawLines: RawLine[] = [];
  (lyricText || "").split("\n").forEach((line) => {
    const stamps = Array.from(line.matchAll(timeRegex));
    if (stamps.length === 0) return;
    const body = line.replace(timeRegex, "").replace(wordTagRegex, "").trim();
    stamps.forEach((match) => {
      const t = tagToSeconds(match[1], match[2], match[3]);
      rawLines.push({ time: t, raw: body });
    });
  });
  rawLines.sort((a, b) => a.time - b.time);

  const trans = parseTrans(tlyricText || "");
  const transTimes = Array.from(trans.keys()).sort((a, b) => a - b);
  const transNear = (t: number): string | undefined => {
    // 翻译时间未必与主歌词完全相等，取最接近且 ≤0.4s 的那一条
    let best: string | undefined;
    let bestDiff = 0.4;
    for (const tt of transTimes) {
      const diff = Math.abs(tt - t);
      if (diff <= bestDiff) {
        bestDiff = diff;
        best = trans.get(tt);
      }
    }
    return best;
  };

  const lines: LyricLine[] = rawLines.map((line) => ({
    time: line.time,
    text: line.raw,
    trans: transNear(line.time),
  }));

  // 主歌词为空但有翻译时，退化成纯翻译行
  if (lines.length === 0 && transTimes.length > 0) {
    return transTimes.map((t) => ({ time: t, text: trans.get(t) || "" }));
  }

  return lines.filter((line) => line.text || line.trans);
}

export function formatCount(value?: string | number) {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+(\.\d+)?$/.test(value)
        ? Number(value)
        : undefined;
  if (!numeric) return value ? String(value) : "";
  if (numeric >= 100_000_000) return `${(numeric / 100_000_000).toFixed(1)}亿`;
  if (numeric >= 10_000) return `${(numeric / 10_000).toFixed(1)}万`;
  return String(Math.round(numeric));
}

export function safeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "music";
}

export function deriveView(pathname: string): MusicView {
  if (pathname.startsWith("/music/search")) return "search";
  if (pathname.startsWith("/music/library")) return "library";
  if (pathname.startsWith("/music/sources")) return "sources";
  if (pathname.startsWith("/music/player")) return "player";
  if (pathname.startsWith("/music/songlists")) return "songlists";
  if (pathname.startsWith("/music/songlist")) return "songlist";
  if (pathname.startsWith("/music/album")) return "album";
  if (pathname.startsWith("/music/artist")) return "artist";
  return "discover";
}
