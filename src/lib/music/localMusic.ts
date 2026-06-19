import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import type { MusicSong } from "./types";

export const LOCAL_SOURCE_ID = "music-local";

interface LocalTrackMeta {
  filePath: string;
  name: string;
  artists: string;
  album: string;
  duration: number;
  coverDataUrl?: string;
  lyric?: string;
}

/** 扫描本地目录(Rust scan_music_folder + lofty 标签)→ MusicSong[]。 */
export async function scanMusicFolder(dir: string, maxDepth = 6): Promise<MusicSong[]> {
  const metas = await invoke<LocalTrackMeta[]>("scan_music_folder", { dir, maxDepth });
  return metas.map((m) => ({
    id: m.filePath,
    sourceId: LOCAL_SOURCE_ID,
    sourceName: "本地音乐",
    title: m.name,
    artist: m.artists || "未知歌手",
    album: m.album || undefined,
    cover: m.coverDataUrl,
    durationSec: m.duration ? Math.round(m.duration) : undefined,
    platform: "local",
    directUrl: convertFileSrc(m.filePath),
    raw: { lyric: m.lyric },
  }));
}

/** 读取同名 .lrc(Rust read_lrc_file)。 */
export async function readLocalLrc(audioPath: string): Promise<string | null> {
  try {
    return await invoke<string | null>("read_lrc_file", { audioPath });
  } catch {
    return null;
  }
}
