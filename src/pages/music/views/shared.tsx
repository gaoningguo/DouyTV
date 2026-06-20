import { useEffect, useState, type ReactNode } from "react";
import { IconLocal, IconPlus, IconTrash } from "@/components/Icon";
import { type MusicSong } from "@/lib/music";
import { useMusicLocalStore } from "@/stores/musicLocal";
import { SongList } from "../components/SongList";

/** 各页面通用的页头：大标题 + 副标题 + 右侧操作槽。 */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="music-page-head">
      <div className="min-w-0">
        <h1 className="music-page-title text-glow">{title}</h1>
        {subtitle && <p className="music-page-sub">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** 受限/降级提示空状态（如需自部署网易源、当前分类无数据）。 */
export function PlaceholderState({
  icon,
  title,
  desc,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <section className="music-placeholder">
      <span className="music-placeholder-icon">{icon}</span>
      <h2 className="font-display text-lg font-bold text-cream">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-cream-dim">{desc}</p>
    </section>
  );
}

/** 本地音乐页:扫描本机音频目录(Rust scan_music_folder + lofty 标签),与在线曲库统一播放。 */
export function LocalView({
  currentSong,
  isPlaying,
  isFavorite,
  onPlay,
  onFavorite,
  onQueue,
  onAddToPlaylist,
}: {
  currentSong: MusicSong | null;
  isPlaying: boolean;
  isFavorite: (song: MusicSong) => boolean;
  onPlay: (song: MusicSong, songs: MusicSong[]) => void;
  onFavorite: (song: MusicSong) => void;
  onQueue: (song: MusicSong) => void;
  onAddToPlaylist: (song: MusicSong) => void;
}) {
  const { folders, tracks, scanning, error, hydrate, addFolder, removeFolder, rescan } =
    useMusicLocalStore();
  const [path, setPath] = useState("");

  useEffect(() => {
    hydrate();
    void rescan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="music-page-wrap space-y-5">
      <PageHeader
        title="本地音乐"
        subtitle={scanning ? "扫描中…" : `${tracks.length} 首 · ${folders.length} 个目录`}
      />
      <div className="grid md:grid-cols-[1fr_auto] gap-2">
        <input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          placeholder="输入本机音乐文件夹绝对路径（如 D:\\Music）"
          className="h-10 rounded-lg px-3 bg-ink text-sm outline-none text-cream"
          style={{ border: "1px solid var(--cream-line)" }}
        />
        <button
          type="button"
          disabled={!path.trim() || scanning}
          onClick={() => {
            void addFolder(path.trim());
            setPath("");
          }}
          className="h-10 px-4 rounded-lg text-xs font-display font-bold tap disabled:opacity-45 inline-flex items-center gap-1.5"
          style={{ background: "var(--ember)", color: "var(--ink)" }}
        >
          <IconPlus size={14} />
          添加目录
        </button>
      </div>
      {folders.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {folders.map((dir) => (
            <span
              key={dir}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-cream-dim"
              style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            >
              <IconLocal size={12} />
              <span className="max-w-[220px] truncate">{dir}</span>
              <button
                type="button"
                onClick={() => void removeFolder(dir)}
                className="text-cream-faint hover:text-ember tap"
                title="移除目录"
              >
                <IconTrash size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-ember">{error}</p>}
      <SongList
        songs={tracks}
        activeSong={currentSong}
        activePlaying={isPlaying}
        emptyText={folders.length === 0 ? "添加一个文件夹开始扫描本地音乐" : "该目录没有音频文件"}
        isFavorite={isFavorite}
        onPlay={(song) => onPlay(song, tracks)}
        onFavorite={onFavorite}
        onQueue={onQueue}
        onAddToPlaylist={onAddToPlaylist}
      />
    </div>
  );
}
