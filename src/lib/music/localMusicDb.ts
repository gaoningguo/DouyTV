import { getDb, isSqlAvailable } from "@/lib/db";
import { LOCAL_SOURCE_ID } from "./localMusic";
import type { MusicSong } from "./types";
import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * 本地曲库 SQLite 持久化层。
 *
 * 为什么:本地音乐过去只把文件夹路径存进 localStorage,每次进页都要 Rust 全量重扫
 * (lofty 解析每个文件 + base64 封面),大库很慢。这里把解析结果落 SQLite(local_tracks
 * 表,迁移 v3),进页先读库秒出,后台再按 mtime 增量补扫。
 *
 * 封面 base64 直接入库:SQLite 是文件型库,没有 localStorage 的 ~5MB 配额问题。
 * 非 Tauri 环境(无 SQL)所有函数 no-op / 返回空,调用方需自行回退到全量扫描。
 */

interface LocalTrackRow {
  file_path: string;
  folder: string;
  name: string;
  artists: string;
  album: string | null;
  duration: number;
  cover_data_url: string | null;
  lyric: string | null;
  mtime: number;
  scanned_at: number;
}

function rowToSong(r: LocalTrackRow): MusicSong {
  return {
    id: r.file_path,
    sourceId: LOCAL_SOURCE_ID,
    sourceName: "本地音乐",
    title: r.name,
    artist: r.artists || "未知歌手",
    album: r.album ?? undefined,
    cover: r.cover_data_url ?? undefined,
    durationSec: r.duration ? Math.round(r.duration) : undefined,
    platform: "local",
    directUrl: convertFileSrc(r.file_path),
    raw: { lyric: r.lyric ?? undefined, mtime: r.mtime },
  };
}

function songMtime(song: MusicSong): number {
  const raw = song.raw;
  if (raw && typeof raw === "object" && "mtime" in raw) {
    const m = (raw as { mtime?: unknown }).mtime;
    if (typeof m === "number" && Number.isFinite(m)) return m;
  }
  return 0;
}

function songLyric(song: MusicSong): string | null {
  const raw = song.raw;
  if (raw && typeof raw === "object" && "lyric" in raw) {
    const l = (raw as { lyric?: unknown }).lyric;
    if (typeof l === "string") return l;
  }
  return null;
}

/** 读取某文件夹已缓存的曲目(进页秒出)。非 Tauri 返回空。 */
export async function loadCachedTracks(folder: string): Promise<MusicSong[]> {
  if (!isSqlAvailable()) return [];
  try {
    const db = await getDb();
    const rows = await db.select<LocalTrackRow[]>(
      "SELECT * FROM local_tracks WHERE folder = $1 ORDER BY name COLLATE NOCASE",
      [folder]
    );
    return rows.map(rowToSong);
  } catch (e) {
    console.warn("[localMusicDb] loadCachedTracks failed", e);
    return [];
  }
}

/** 取某文件夹已缓存条目的 (file_path → mtime) 映射,用于增量 diff。 */
export async function loadCachedMtimes(folder: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!isSqlAvailable()) return map;
  try {
    const db = await getDb();
    const rows = await db.select<Array<{ file_path: string; mtime: number }>>(
      "SELECT file_path, mtime FROM local_tracks WHERE folder = $1",
      [folder]
    );
    for (const r of rows) map.set(r.file_path, r.mtime);
  } catch (e) {
    console.warn("[localMusicDb] loadCachedMtimes failed", e);
  }
  return map;
}

/** upsert 一批曲目到某文件夹。 */
export async function upsertTracks(folder: string, songs: MusicSong[]): Promise<void> {
  if (!isSqlAvailable() || songs.length === 0) return;
  try {
    const db = await getDb();
    const now = Date.now();
    for (const s of songs) {
      await db.execute(
        "INSERT OR REPLACE INTO local_tracks (file_path, folder, name, artists, album, duration, cover_data_url, lyric, mtime, scanned_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          s.id,
          folder,
          s.title,
          s.artist,
          s.album ?? null,
          s.durationSec ?? 0,
          s.cover ?? null,
          songLyric(s),
          songMtime(s),
          now,
        ]
      );
    }
  } catch (e) {
    console.warn("[localMusicDb] upsertTracks failed", e);
  }
}

/** 删除指定路径的缓存行(文件已消失时)。 */
export async function deleteTracksByPath(paths: string[]): Promise<void> {
  if (!isSqlAvailable() || paths.length === 0) return;
  try {
    const db = await getDb();
    for (const p of paths) {
      await db.execute("DELETE FROM local_tracks WHERE file_path = $1", [p]);
    }
  } catch (e) {
    console.warn("[localMusicDb] deleteTracksByPath failed", e);
  }
}

/** 移除整个文件夹的缓存(用户删除目录时)。 */
export async function deleteFolder(folder: string): Promise<void> {
  if (!isSqlAvailable()) return;
  try {
    const db = await getDb();
    await db.execute("DELETE FROM local_tracks WHERE folder = $1", [folder]);
  } catch (e) {
    console.warn("[localMusicDb] deleteFolder failed", e);
  }
}
