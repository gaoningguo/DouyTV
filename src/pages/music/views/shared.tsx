import { useEffect, useMemo, useState, type ReactNode } from "react";
import { IconLocal, IconPlus, IconTrash } from "@/components/Icon";
import { type MusicSong } from "@/lib/music";
import { useMusicLocalStore } from "@/stores/musicLocal";
import { SongList } from "../components/SongList";
import { FilterChip } from "../components/ui";

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
  // 分组视图：平铺 / 按歌手 / 按专辑 / 按文件夹。曲库大时便于浏览。
  const [groupBy, setGroupBy] = useState<"none" | "artist" | "album" | "folder">("none");

  useEffect(() => {
    // 先 hydrate(从 SQLite 秒读缓存曲目),完成后再后台增量补扫。
    void hydrate().then(() => rescan());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 按当前维度把曲目分组（平铺时单组）。文件夹取 id（文件绝对路径）的父目录。
  const groups = useMemo(() => {
    if (groupBy === "none") return [{ key: "", songs: tracks }];
    const map = new Map<string, MusicSong[]>();
    for (const song of tracks) {
      let key: string;
      if (groupBy === "artist") key = song.artist || "未知歌手";
      else if (groupBy === "album") key = song.album || "未知专辑";
      else {
        const p = song.id.replace(/[/\\][^/\\]*$/, "");
        key = p.split(/[/\\]/).pop() || p || "根目录";
      }
      const arr = map.get(key);
      if (arr) arr.push(song);
      else map.set(key, [song]);
    }
    return Array.from(map.entries())
      .map(([key, songs]) => ({ key, songs }))
      .sort((a, b) => a.key.localeCompare(b.key, "zh"));
  }, [tracks, groupBy]);

  const GROUP_OPTIONS: Array<{ id: typeof groupBy; label: string }> = [
    { id: "none", label: "全部" },
    { id: "artist", label: "歌手" },
    { id: "album", label: "专辑" },
    { id: "folder", label: "文件夹" },
  ];

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
      {tracks.length > 0 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
          {GROUP_OPTIONS.map((item) => (
            <FilterChip key={item.id} active={groupBy === item.id} onClick={() => setGroupBy(item.id)}>
              {item.label}
            </FilterChip>
          ))}
        </div>
      )}
      {groupBy === "none" ? (
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
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.key}>
              <div className="mb-2 flex items-baseline gap-2">
                <h3 className="font-display text-sm font-bold text-cream">{group.key}</h3>
                <span className="text-xs text-cream-faint">{group.songs.length} 首</span>
              </div>
              <SongList
                songs={group.songs}
                activeSong={currentSong}
                activePlaying={isPlaying}
                emptyText=""
                isFavorite={isFavorite}
                onPlay={(song) => onPlay(song, group.songs)}
                onFavorite={onFavorite}
                onQueue={onQueue}
                onAddToPlaylist={onAddToPlaylist}
              />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
