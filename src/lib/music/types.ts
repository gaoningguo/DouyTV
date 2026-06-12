export type MusicSourceKind = "lx-server" | "plugin-js" | "aggregate-http";

export type MusicPlatform = "wy" | "tx" | "kw" | "kg" | "mg";

export type MusicQuality = "128k" | "192k" | "320k" | "flac" | "flac24bit";

export type MusicPlayMode = "loop" | "single" | "random";

export interface MusicSourceDescriptor {
  id: string;
  name: string;
  kind: MusicSourceKind;
  enabled: boolean;
  description?: string;
  baseUrl?: string;
  token?: string;
  code?: string;
  defaultPlatform?: MusicPlatform | "all";
  platforms?: MusicPlatform[];
  headers?: Record<string, string>;
  searchUrl?: string;
  playUrl?: string;
  lyricUrl?: string;
  searchMethod?: "GET" | "POST";
  playMethod?: "GET" | "POST";
  lyricMethod?: "GET" | "POST";
  searchBodyTemplate?: string;
  playBodyTemplate?: string;
  lyricBodyTemplate?: string;
  itemPath?: string;
  fieldMap?: MusicFieldMap;
  installedAt?: number;
  updatedAt?: number;
}

export interface MusicFieldMap {
  id?: string;
  title?: string;
  artist?: string;
  album?: string;
  cover?: string;
  durationText?: string;
  durationSec?: string;
  url?: string;
  platform?: string;
  songmid?: string;
  lrc?: string;
  tlyric?: string;
}

export interface MusicSong {
  id: string;
  sourceId: string;
  sourceName: string;
  title: string;
  artist: string;
  album?: string;
  cover?: string;
  durationText?: string;
  durationSec?: number;
  platform?: MusicPlatform | string;
  songmid?: string;
  hash?: string;
  copyrightId?: string;
  albumId?: string;
  lrcUrl?: string;
  mrcUrl?: string;
  trcUrl?: string;
  directUrl?: string;
  raw?: unknown;
}

export interface MusicSearchResult {
  list: MusicSong[];
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface MusicPlayResult {
  url: string;
  directUrl?: string;
  quality: MusicQuality | string;
  headers?: Record<string, string>;
  lyric?: string;
  tlyric?: string;
}

export interface MusicLyricResult {
  lyric: string;
  tlyric?: string;
}

export interface MusicHistoryRecord extends MusicSong {
  position: number;
  duration: number;
  playCount: number;
  lastPlayedAt: number;
  createdAt?: number;
  updatedAt?: number;
  lastQuality?: string;
}

export interface MusicDiscoveryBoard {
  id: string;
  name: string;
  source: MusicPlatform;
  cover?: string;
}

export interface MusicHotSearchItem {
  keyword: string;
  name: string;
  artist?: string;
  source: MusicPlatform | string;
}

export interface MusicSongListSummary {
  id: string;
  name: string;
  source: MusicPlatform | string;
  pic?: string;
  author?: string;
  desc?: string;
  playCount?: string | number;
  total?: string | number;
  updateFrequency?: string;
}

export interface MusicSongListTag {
  id: string;
  name: string;
}

export interface MusicSongListTags {
  groups: unknown[];
  hotTags: MusicSongListTag[];
  sortList: MusicSongListTag[];
}

export interface MusicSongListDetail {
  info: Record<string, unknown>;
  list: MusicSong[];
  page: number;
  total: number;
  limit: number;
}

export const MUSIC_PLATFORMS: Array<{ id: MusicPlatform; label: string }> = [
  { id: "wy", label: "网易云" },
  { id: "tx", label: "QQ音乐" },
  { id: "kw", label: "酷我" },
  { id: "kg", label: "酷狗" },
  { id: "mg", label: "咪咕" },
];

export function normalizeMusicPlatform(source?: string): MusicPlatform | "" {
  switch ((source || "").trim().toLowerCase()) {
    case "wy":
    case "netease":
    case "neteasecloud":
      return "wy";
    case "tx":
    case "qq":
      return "tx";
    case "kw":
    case "kuwo":
      return "kw";
    case "kg":
    case "kugou":
      return "kg";
    case "mg":
    case "migu":
      return "mg";
    default:
      return "";
  }
}

export function isLikelyShortPreviewDuration(
  actualDuration?: number,
  expectedDuration?: number
): boolean {
  if (
    !actualDuration ||
    !expectedDuration ||
    !Number.isFinite(actualDuration) ||
    !Number.isFinite(expectedDuration)
  ) {
    return false;
  }
  return (
    expectedDuration >= 90 &&
    actualDuration > 0 &&
    actualDuration <= 45 &&
    actualDuration < expectedDuration * 0.55
  );
}

export function normalizeMusicQuality(
  quality?: string
): Exclude<MusicQuality, "flac24bit"> {
  switch (quality) {
    case "128k":
    case "192k":
    case "320k":
    case "flac":
      return quality;
    case "flac24bit":
      return "flac";
    default:
      return "320k";
  }
}

export function parseDurationToSec(value?: string | number): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value) return undefined;
  const text = String(value).trim();
  if (/^\d+$/.test(text)) return Number(text);
  const parts = text.split(":").map((part) => Number(part));
  if (parts.length < 2 || parts.some((part) => Number.isNaN(part))) return undefined;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return "--:--";
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  return `${minutes}:${String(remain).padStart(2, "0")}`;
}

export function musicSongKey(song: Pick<MusicSong, "sourceId" | "id">): string {
  return `${song.sourceId}:${song.id}`;
}
