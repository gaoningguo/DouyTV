export type MusicView =
  | "discover"
  | "recommend"
  | "toplist"
  | "songlists"
  | "artists"
  | "mv"
  | "radio"
  | "search"
  | "library"
  | "recent"
  | "stats"
  | "local"
  | "sources"
  | "player"
  | "songlist"
  | "album"
  | "artist";

export type LibraryTab = "favorites" | "history" | "playlists" | "downloads";

/** 发现页排行榜卡片：一个榜单 + 它的前几首歌（借鉴 Tabos discover-chart-card）。 */
export interface ChartCard {
  board: import("@/lib/music").MusicDiscoveryBoard;
  songs: import("@/lib/music").MusicSong[];
}

export type DrawerView = "queue" | "lyrics" | "settings" | null;

/** 词级时间片：用于逐字扫光动画。start/end 单位为秒。 */
export interface LyricWord {
  text: string;
  start: number;
  end: number;
}

export interface LyricLine {
  /** 行起始时间（秒） */
  time: number;
  /** 行结束时间（秒），仅逐字歌词有；用于间奏判断与收尾。 */
  end?: number;
  text: string;
  trans?: string;
  /** 罗马音 / 音译行 */
  roma?: string;
  /** 词级时间，存在时启用逐字扫光；否则退化为整行高亮。 */
  words?: LyricWord[];
}
