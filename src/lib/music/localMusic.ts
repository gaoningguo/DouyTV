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
  mtime: number;
}

/** 轻量文件条目(只含路径 + mtime,不解析标签),用于增量扫描的 diff。 */
export interface LocalFileEntry {
  filePath: string;
  mtime: number;
}

/** 把 Rust 返回的标签元数据映射成 MusicSong（保留 mtime/lyric 到 raw，供入库与增量比对）。 */
export function localMetaToSong(m: LocalTrackMeta): MusicSong {
  return {
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
    raw: { lyric: m.lyric, mtime: m.mtime },
  };
}

/** 扫描本地目录(Rust scan_music_folder + lofty 标签，全量)→ MusicSong[]。 */
export async function scanMusicFolder(dir: string, maxDepth = 6): Promise<MusicSong[]> {
  const metas = await invoke<LocalTrackMeta[]>("scan_music_folder", { dir, maxDepth });
  return metas.map(localMetaToSong);
}

/** 只列目录下音频文件的路径 + mtime(不解析标签，很快)。 */
export async function listMusicFiles(dir: string, maxDepth = 6): Promise<LocalFileEntry[]> {
  return invoke<LocalFileEntry[]>("list_music_files", { dir, maxDepth });
}

/** 解析指定的若干音频文件(增量扫描:只解析新增/变更文件)→ MusicSong[]。 */
export async function extractMusicMetadata(paths: string[]): Promise<MusicSong[]> {
  if (paths.length === 0) return [];
  const metas = await invoke<LocalTrackMeta[]>("extract_music_metadata", { paths });
  return metas.map(localMetaToSong);
}

/** 读取同名 .lrc(Rust read_lrc_file)。 */
export async function readLocalLrc(audioPath: string): Promise<string | null> {
  try {
    return await invoke<string | null>("read_lrc_file", { audioPath });
  } catch {
    return null;
  }
}
