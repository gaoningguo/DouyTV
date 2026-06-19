import {
  IconAlbum,
  IconBookmark,
  IconHeart,
  IconHeartFill,
  IconPlay,
  IconPlus,
} from "@/components/Icon";
import { formatDuration, musicSongKey, type MusicSong } from "@/lib/music";
import { wrapImage } from "@/lib/proxy";
import { type MusicUserPlaylist } from "@/stores/music";
import { type LibraryTab } from "../types";
import { type MusicDownloadItem } from "@/stores/musicDownload";
import { EmptyBlock, IconButton } from "../components/ui";
import { PlaylistPanel } from "../components/PlaylistPanel";

export function LibraryView({
  tab,
  onTab,
  favorites,
  history,
  playlists,
  currentSong,
  isFavorite,
  onPlay,
  onFavorite,
  onQueue,
  onAddToPlaylist,
  onClearHistory,
  onCreatePlaylist,
  onDeletePlaylist,
  onClearPlaylist,
  onRemoveFromPlaylist,
  librarySongs,
  downloads,
  onRemoveDownload,
  onClearDownloads,
}: {
  tab: LibraryTab;
  onTab: (tab: LibraryTab) => void;
  favorites: MusicSong[];
  history: MusicSong[];
  playlists: MusicUserPlaylist[];
  currentSong: MusicSong | null;
  isFavorite: (song: MusicSong) => boolean;
  onPlay: (song: MusicSong, songs: MusicSong[]) => void;
  onFavorite: (song: MusicSong) => void;
  onQueue: (song: MusicSong) => void;
  onAddToPlaylist: (song: MusicSong) => void;
  onClearHistory: () => void;
  onCreatePlaylist: () => void;
  onDeletePlaylist: (id: string) => void;
  onClearPlaylist: (id: string) => void;
  onRemoveFromPlaylist: (id: string, songKey: string) => void;
  librarySongs: MusicSong[];
  downloads: MusicDownloadItem[];
  onRemoveDownload: (taskId: string) => void;
  onClearDownloads: () => void;
}) {
  const favoriteCover = favorites.find((song) => song.cover)?.cover;
  const recentCover = history.find((song) => song.cover)?.cover;

  return (
    <div className="music-library space-y-8 pb-4">
      {/* Hero Section: 我的最爱 */}
      <section className="relative overflow-hidden rounded-3xl aspect-[21/9] md:aspect-[3/1] glass-card p-8 md:p-12 flex flex-col justify-end">
        <div className="absolute inset-0 z-0">
          {favoriteCover || recentCover ? (
            <img
              src={wrapImage(favoriteCover || recentCover)}
              alt=""
              className="w-full h-full object-cover opacity-40 scale-110 blur-sm"
            />
          ) : (
            <div className="w-full h-full" style={{ background: "linear-gradient(135deg, rgba(255,107,53,0.22), rgba(79,195,247,0.12))" }} />
          )}
        </div>
        <div className="relative z-10 space-y-4 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border text-label-sm" style={{ background: "rgba(255,107,53,0.2)", borderColor: "rgba(255,107,53,0.3)", color: "var(--ember)" }}>
            <IconHeartFill size={14} />
            <span>专属推荐</span>
          </div>
          <h2 className="font-headline-lg text-headline-lg md:text-display-lg font-extrabold tracking-tight">我的最爱</h2>
          <p className="text-on-surface-variant font-body-md max-w-lg">
            你最常听的 {favorites.length} 首曲目，由 DouyTV 实时更新。
          </p>
          <div className="flex items-center gap-4 pt-4">
            <button
              type="button"
              disabled={favorites.length === 0}
              onClick={() => favorites[0] && onPlay(favorites[0], favorites)}
              className="px-8 py-3 bg-primary text-on-primary-container font-bold rounded-full flex items-center gap-2 hover:scale-105 active:scale-95 transition-transform disabled:opacity-40"
            >
              <IconPlay size={18} />
              <span>立即播放</span>
            </button>
            <button
              type="button"
              disabled={favorites.length === 0}
              onClick={() => {
                if (favorites.length > 0) {
                  const shuffled = [...favorites].sort(() => Math.random() - 0.5);
                  onPlay(shuffled[0], shuffled);
                }
              }}
              className="px-8 py-3 text-white font-bold rounded-full border transition-all disabled:opacity-40"
              style={{ background: "rgba(255,255,255,0.1)", backdropFilter: "blur(8px)", borderColor: "rgba(255,255,255,0.1)" }}
            >
              <span>随机播放</span>
            </button>
          </div>
        </div>
      </section>

      {/* Library Filter Tabs */}
      <div className="flex items-center gap-8 border-b overflow-x-auto scrollbar-hide pb-0" style={{ borderColor: "var(--cream-line)" }}>
        <button
          type="button"
          onClick={() => onTab("favorites")}
          className="pb-4 font-medium whitespace-nowrap transition-colors"
          style={{
            color: tab === "favorites" ? "var(--ember)" : "var(--cream-dim)",
            borderBottom: tab === "favorites" ? "2px solid var(--ember)" : "2px solid transparent",
            fontWeight: tab === "favorites" ? "bold" : "medium",
          }}
        >
          全部
        </button>
        <button
          type="button"
          onClick={() => onTab("playlists")}
          className="pb-4 font-medium whitespace-nowrap transition-colors"
          style={{
            color: tab === "playlists" ? "var(--ember)" : "var(--cream-dim)",
            borderBottom: tab === "playlists" ? "2px solid var(--ember)" : "2px solid transparent",
            fontWeight: tab === "playlists" ? "bold" : "medium",
          }}
        >
          已创建的歌单
        </button>
        <button
          type="button"
          onClick={() => onTab("history")}
          className="pb-4 font-medium whitespace-nowrap transition-colors"
          style={{
            color: tab === "history" ? "var(--ember)" : "var(--cream-dim)",
            borderBottom: tab === "history" ? "2px solid var(--ember)" : "2px solid transparent",
            fontWeight: tab === "history" ? "bold" : "medium",
          }}
        >
          最近播放
        </button>
        <button
          type="button"
          onClick={() => onTab("downloads")}
          className="pb-4 font-medium whitespace-nowrap transition-colors"
          style={{
            color: tab === "downloads" ? "var(--ember)" : "var(--cream-dim)",
            borderBottom: tab === "downloads" ? "2px solid var(--ember)" : "2px solid transparent",
            fontWeight: tab === "downloads" ? "bold" : "medium",
          }}
        >
          下载内容 {downloads.length > 0 ? downloads.length : ""}
        </button>
        {tab === "history" && history.length > 0 && (
          <button
            type="button"
            onClick={onClearHistory}
            className="ml-auto pb-4 text-xs text-cream-faint hover:text-ember tap"
          >
            清空历史
          </button>
        )}
        {tab === "playlists" && (
          <button
            type="button"
            onClick={onCreatePlaylist}
            className="ml-auto pb-4 px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 text-xs font-semibold tap"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            <IconPlus size={14} />
            新建歌单
          </button>
        )}
        {tab === "downloads" && downloads.length > 0 && (
          <button
            type="button"
            onClick={onClearDownloads}
            className="ml-auto pb-4 text-xs text-cream-faint hover:text-ember tap"
          >
            清空记录
          </button>
        )}
      </div>

      {/* Content based on selected tab */}
      {tab === "downloads" && (
        <section className="space-y-2">
          {downloads.length === 0 ? (
            <EmptyBlock text="还没有下载。在播放器点下载按钮即可缓存到本地" />
          ) : (
            downloads.map((item) => (
              <div
                key={item.taskId}
                className="flex items-center gap-4 p-3 rounded-xl hover:bg-white/5 transition-colors"
              >
                <div className="w-11 h-11 rounded-lg overflow-hidden shrink-0 bg-white/5">
                  {item.cover ? (
                    <img src={wrapImage(item.cover)} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full grid place-items-center">
                      <IconAlbum size={20} className="text-cream-faint" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 font-medium">{item.title}</p>
                  <p className="line-clamp-1 text-xs text-cream-faint">{item.artist}</p>
                  {item.status === "downloading" && (
                    <div className="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${item.progress}%`, background: "var(--ember)" }}
                      />
                    </div>
                  )}
                </div>
                <span
                  className="text-xs font-mono shrink-0"
                  style={{ color: item.status === "error" ? "#ff6b6b" : "var(--cream-faint)" }}
                >
                  {item.status === "done"
                    ? "已完成"
                    : item.status === "downloading"
                      ? `${Math.round(item.progress)}%`
                      : item.status === "error"
                        ? "失败"
                        : item.status === "paused"
                          ? "已暂停"
                          : "等待中"}
                </span>
                <button
                  type="button"
                  onClick={() => onRemoveDownload(item.taskId)}
                  className="shrink-0 text-cream-faint hover:text-ember tap text-xs"
                >
                  移除
                </button>
              </div>
            ))
          )}
        </section>
      )}

      {tab === "playlists" && (
        <>
          {playlists.length === 0 ? (
            <EmptyBlock text="还没有歌单，点击「新建歌单」创建" />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {playlists.map((playlist) => (
                <PlaylistPanel
                  key={playlist.id}
                  playlist={playlist}
                  currentSong={currentSong}
                  isFavorite={isFavorite}
                  onPlay={(song) => onPlay(song, playlist.songs)}
                  onFavorite={onFavorite}
                  onQueue={onQueue}
                  onAddToPlaylist={onAddToPlaylist}
                  onDelete={() => onDeletePlaylist(playlist.id)}
                  onClear={() => onClearPlaylist(playlist.id)}
                  onRemove={(song) => onRemoveFromPlaylist(playlist.id, musicSongKey(song))}
                />
              ))}
            </div>
          )}
        </>
      )}

      {(tab === "favorites" || tab === "history") && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-bold">
              {tab === "favorites" ? "收藏的曲目" : "最近播放的曲目"}
            </h3>
            {librarySongs.length > 10 && (
              <span className="text-xs text-cream-faint">
                显示 {Math.min(20, librarySongs.length)} / {librarySongs.length}
              </span>
            )}
          </div>
          <div className="space-y-1">
            {librarySongs.length === 0 ? (
              <EmptyBlock text={tab === "favorites" ? "还没有收藏歌曲" : "还没有播放历史"} />
            ) : (
              librarySongs.slice(0, 20).map((song, index) => {
                const active = !!currentSong && musicSongKey(currentSong) === musicSongKey(song);
                const favorite = isFavorite(song);
                return (
                  <div
                    key={`${musicSongKey(song)}:${index}`}
                    className="group flex items-center gap-4 p-3 rounded-xl transition-all hover:bg-white/5"
                    style={{ background: active ? "rgba(255,107,53,0.1)" : "transparent" }}
                  >
                    <div className="w-12 h-12 rounded overflow-hidden relative shrink-0" style={{ background: "var(--ink-3)" }}>
                      {song.cover ? (
                        <img
                          src={wrapImage(song.cover)}
                          alt=""
                          className="w-full h-full object-cover"
                          style={{ opacity: 0.5 }}
                        />
                      ) : (
                        <span className="grid h-full w-full place-items-center text-cream-faint">
                          <IconAlbum size={20} />
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => onPlay(song, librarySongs)}
                        className="absolute inset-0 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ background: "rgba(0,0,0,0.6)" }}
                      >
                        <IconPlay size={20} />
                      </button>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-semibold truncate"
                        style={{ color: active ? "var(--ember)" : "var(--cream)" }}
                      >
                        {song.title}
                      </p>
                      <p className="text-xs text-cream-dim truncate">
                        {song.artist} {song.album ? `• ${song.album}` : ""}
                      </p>
                    </div>
                    <div className="hidden md:block text-xs text-cream-faint w-16 text-right">
                      {song.durationText || formatDuration(song.durationSec)}
                    </div>
                    <div className="flex items-center gap-1">
                      <IconButton
                        label="收藏"
                        active={favorite}
                        onClick={() => onFavorite(song)}
                      >
                        {favorite ? <IconHeartFill size={16} /> : <IconHeart size={16} />}
                      </IconButton>
                      <IconButton label="更多" onClick={() => onAddToPlaylist(song)}>
                        <IconBookmark size={16} />
                      </IconButton>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      )}
    </div>
  );
}
