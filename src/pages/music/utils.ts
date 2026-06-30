import { musicSongKey, type MusicSong, type MusicSongListSummary } from "@/lib/music";
import { type MusicView } from "./types";

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
  if (pathname.startsWith("/music/local")) return "local";
  if (pathname.startsWith("/music/sources")) return "sources";
  if (pathname.startsWith("/music/player")) return "player";
  if (pathname.startsWith("/music/recommend")) return "recommend";
  if (pathname.startsWith("/music/toplist")) return "toplist";
  if (pathname.startsWith("/music/songlists")) return "songlists";
  if (pathname.startsWith("/music/songlist")) return "songlist";
  if (pathname.startsWith("/music/artists")) return "artists";
  if (pathname.startsWith("/music/artist")) return "artist";
  if (pathname.startsWith("/music/mv")) return "mv";
  if (pathname.startsWith("/music/radio")) return "radio";
  if (pathname.startsWith("/music/playlist-square")) return "playlist-square";
  if (pathname.startsWith("/music/new-albums")) return "new-albums";
  if (pathname.startsWith("/music/album")) return "album";
  return "discover";
}
