export type MusicView =
  | "discover"
  | "songlists"
  | "search"
  | "library"
  | "sources"
  | "player"
  | "songlist"
  | "album"
  | "artist";

export type LibraryTab = "favorites" | "history" | "playlists";

export type DrawerView = "queue" | "lyrics" | "settings" | null;

export interface LyricLine {
  time: number;
  text: string;
  trans?: string;
}
