import {
  IconAlbum,
  IconBookmark,
  IconChevronLeft,
  IconChevronRight,
  IconHeart,
  IconHeartFill,
  IconPause,
  IconPlay,
  IconPlus,
  IconRefresh,
} from "@/components/Icon";
import {
  formatDuration,
  musicSongKey,
  type MusicDiscoveryBoard,
  type MusicHotSearchItem,
  type MusicSong,
  type MusicSongListSummary,
  type MusicSourceDescriptor,
} from "@/lib/music";
import { wrapImage } from "@/lib/proxy";
import { aggregateMusicLabel, aggregatePlaylistMeta } from "../utils";
import { useHorizontalRail } from "../useHorizontalRail";
import { EmptyBlock, FilterChip, IconButton } from "../components/ui";

export function DiscoverView({
  source,
  loading,
  currentSong,
  currentCover,
  isPlaying,
  resolving,
  hotSearch,
  boards,
  selectedBoard,
  boardSongs,
  boardLoading,
  songlists,
  onSearch,
  onReload,
  onBoard,
  onPlay,
  onQueue,
  onFavorite,
  isFavorite,
  onAddToPlaylist,
  onOpenSonglist,
  onMore,
}: {
  source?: MusicSourceDescriptor;
  loading: boolean;
  currentSong: MusicSong | null;
  currentCover?: string;
  isPlaying: boolean;
  resolving: boolean;
  hotSearch: MusicHotSearchItem[];
  boards: MusicDiscoveryBoard[];
  selectedBoard: MusicDiscoveryBoard | null;
  boardSongs: MusicSong[];
  boardLoading: boolean;
  songlists: MusicSongListSummary[];
  onSearch: (keyword: string) => void;
  onReload: () => void;
  onBoard: (board: MusicDiscoveryBoard) => void;
  onPlay: (song: MusicSong, songs: MusicSong[]) => void;
  onQueue: (song: MusicSong) => void;
  onFavorite: (song: MusicSong) => void;
  isFavorite: (song: MusicSong) => boolean;
  onAddToPlaylist: (song: MusicSong) => void;
  onOpenSonglist: (item: MusicSongListSummary) => void;
  onMore: () => void;
}) {
  const discoveryRail = useHorizontalRail<HTMLDivElement>();
  const boardRail = useHorizontalRail<HTMLDivElement>();
  if (!source) {
    return (
      <section className="music-empty-hero h-[64vh] grid place-items-center text-center text-cream-dim">
        <div>
          <IconAlbum size={48} className="mx-auto mb-3 text-cream-faint" />
          <p className="font-display font-semibold">发现页需要 LX Music API Server 源</p>
          <p className="mt-1 text-xs text-cream-faint">
            导入 MoonTV 同款 LX 服务后，榜单和热搜会自动显示。
          </p>
        </div>
      </section>
    );
  }

  const heroSong = currentSong || boardSongs[0];
  const heroCover =
    currentCover || (heroSong?.cover ? wrapImage(heroSong.cover) : undefined);
  const heroTitle = heroSong?.title || "为你推荐";
  const heroArtist = heroSong
    ? `${heroSong.artist || "未知歌手"}${heroSong.album ? ` • ${heroSong.album}` : heroSong.sourceName ? ` • ${heroSong.sourceName}` : ""}`
    : "全源聚合音乐发现流";
  const heroPlaying =
    isPlaying && !!currentSong && !!heroSong && musicSongKey(currentSong) === musicSongKey(heroSong);
  const discoveryCards = songlists.slice(0, 8);
  const quickPicks = songlists.slice(8, 14);

  return (
    <div className="music-obsidian-home space-y-12 pb-4">
      {/* 沉浸式正在播放 */}
      <section className="music-ob-hero">
        <div
          aria-hidden
          className="music-ob-hero-bg"
          style={
            heroCover
              ? { backgroundImage: `url(${heroCover})` }
              : { background: "linear-gradient(135deg, rgba(255,107,53,0.22), rgba(79,195,247,0.12))" }
          }
        />
        <div aria-hidden className="music-ob-hero-veil" />
        <div className="music-ob-hero-body">
          <div className="flex items-center gap-3">
            <span className="music-ob-tag">{resolving ? "解析中" : heroPlaying ? "正在播放" : "今日推荐"}</span>
            <span className="text-xs text-cream-dim">{heroArtist}</span>
          </div>
          <h1 className="music-ob-hero-title text-glow">{heroTitle}</h1>
          <div className="flex flex-wrap items-center gap-3">
            {heroSong && (
              <button
                type="button"
                onClick={() => onPlay(heroSong, boardSongs.length ? boardSongs : [heroSong])}
                className="music-ob-play-btn"
              >
                {heroPlaying ? <IconPause size={18} /> : <IconPlay size={18} />}
                {heroPlaying ? "暂停" : "立即播放"}
              </button>
            )}
            <button type="button" onClick={onReload} className="music-ob-ghost-btn">
              <IconRefresh size={16} className={loading ? "animate-spin" : ""} />
              换一批
            </button>
            {heroSong && (
              <button
                type="button"
                onClick={() => onQueue(heroSong)}
                className="music-ob-icon-btn"
                title="加入队列"
              >
                <IconPlus size={18} />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {hotSearch.slice(0, 6).map((item) => (
              <button
                key={`${item.source}:${item.keyword}`}
                type="button"
                onClick={() => onSearch(item.keyword)}
                className="music-soft-chip"
              >
                {item.keyword}
              </button>
            ))}
          </div>
        </div>
        <div className="music-ob-hero-eq" aria-hidden>
          {[60, 100, 80, 40, 90].map((height, index) => (
            <span
              key={index}
              className={heroPlaying ? "is-active" : undefined}
              style={{ height: `${height}%`, animationDelay: `${index * 120}ms` }}
            />
          ))}
        </div>
      </section>

      {/* 新发现 */}
      {discoveryCards.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-end justify-between">
            <h2 className="font-display text-lg font-extrabold text-cream">新发现</h2>
            <button
              type="button"
              onClick={onMore}
              className="text-xs text-ember hover:underline underline-offset-4"
            >
              查看全部
            </button>
          </div>
          <div className="group/rail relative">
            <div
              ref={discoveryRail.ref}
              className="flex gap-5 overflow-x-auto scrollbar-hide pb-2"
            >
              {discoveryCards.map((item) => (
                <button
                  key={`${item.source}:${item.id}`}
                  type="button"
                  onClick={() => onOpenSonglist(item)}
                  className="music-ob-discovery-card group"
                >
                  {item.pic ? (
                    <img
                      src={wrapImage(item.pic)}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                    />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center bg-ink-3 text-cream-faint">
                      <IconAlbum size={40} />
                    </div>
                  )}
                  <span aria-hidden className="music-ob-discovery-veil" />
                  <span className="music-ob-discovery-body">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-ember">
                      精选歌单
                    </span>
                    <span className="line-clamp-1 font-display text-sm font-bold text-cream">
                      {aggregateMusicLabel(item.name, "推荐歌单")}
                    </span>
                    <span className="line-clamp-1 text-xs text-cream-dim">
                      {aggregatePlaylistMeta(item)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            {discoveryRail.canLeft && (
              <button
                type="button"
                onClick={() => discoveryRail.slide(-1)}
                className="music-ob-rail-arrow left-0 -translate-x-1/2"
                aria-label="向左滚动"
              >
                <IconChevronLeft size={20} />
              </button>
            )}
            {discoveryRail.canRight && (
              <button
                type="button"
                onClick={() => discoveryRail.slide(1)}
                className="music-ob-rail-arrow right-0 translate-x-1/2"
                aria-label="向右滚动"
              >
                <IconChevronRight size={20} />
              </button>
            )}
          </div>
        </section>
      )}

      {/* 热门榜单 + 快捷推荐 */}
      <section className="grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-extrabold text-cream">热门榜单</h2>
            <IconButton label="刷新" onClick={onReload}>
              <IconRefresh size={15} className={loading ? "animate-spin" : ""} />
            </IconButton>
          </div>
          <div className="group/rail relative">
            <div
              ref={boardRail.ref}
              className="flex gap-2 overflow-x-auto scrollbar-hide pb-1"
            >
              {boards.map((board) => (
                <FilterChip
                  key={`${board.source}:${board.id}`}
                  active={selectedBoard?.id === board.id && selectedBoard?.source === board.source}
                  onClick={() => onBoard(board)}
                >
                  {aggregateMusicLabel(board.name, "Ranking")}
                </FilterChip>
              ))}
            </div>
            {boardRail.canLeft && (
              <button
                type="button"
                onClick={() => boardRail.slide(-1)}
                className="music-ob-rail-arrow music-ob-rail-arrow-sm left-0 -translate-x-1/2"
                aria-label="向左滚动"
              >
                <IconChevronLeft size={16} />
              </button>
            )}
            {boardRail.canRight && (
              <button
                type="button"
                onClick={() => boardRail.slide(1)}
                className="music-ob-rail-arrow music-ob-rail-arrow-sm right-0 translate-x-1/2"
                aria-label="向右滚动"
              >
                <IconChevronRight size={16} />
              </button>
            )}
          </div>
          {boardLoading ? (
            <div className="music-ob-chart-scroll space-y-2">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="h-[68px] rounded-lg skeleton-shimmer" />
              ))}
            </div>
          ) : boardSongs.length === 0 ? (
            <EmptyBlock text="暂无榜单歌曲" />
          ) : (
            <div className="music-ob-chart-scroll space-y-1">
              {boardSongs.map((song, index) => {
                const active = !!currentSong && musicSongKey(currentSong) === musicSongKey(song);
                const playing = active && isPlaying;
                const favorite = isFavorite(song);
                return (
                  <article
                    key={`${musicSongKey(song)}:${index}`}
                    className="music-ob-chart-row group"
                    style={
                      active
                        ? { background: "rgba(255,107,53,0.10)" }
                        : undefined
                    }
                  >
                    <span
                      className="w-8 text-center font-display text-lg font-bold"
                      style={{ color: active ? "var(--ember)" : "var(--cream-faint)" }}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <button
                      type="button"
                      onClick={() => onPlay(song, boardSongs)}
                      className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg tap"
                      title="播放"
                    >
                      {song.cover ? (
                        <img src={wrapImage(song.cover)} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="grid h-full w-full place-items-center bg-ink-3 text-cream-faint">
                          <IconAlbum size={22} />
                        </span>
                      )}
                      <span className="absolute inset-0 grid place-items-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                        {playing ? <IconPause size={20} /> : <IconPlay size={20} />}
                      </span>
                    </button>
                    <div className="min-w-0 flex-1">
                      <h3
                        className="line-clamp-1 font-display text-sm font-bold"
                        style={{ color: active ? "var(--ember)" : "var(--cream)" }}
                      >
                        {song.title}
                      </h3>
                      <p className="line-clamp-1 text-xs text-cream-dim">{song.artist}</p>
                    </div>
                    <span className="hidden truncate px-4 text-xs text-cream-faint md:block md:max-w-[160px]">
                      {song.album || song.sourceName}
                    </span>
                    <span className="font-mono text-xs text-cream-faint">
                      {song.durationText || formatDuration(song.durationSec)}
                    </span>
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <IconButton label="收藏" active={favorite} onClick={() => onFavorite(song)}>
                        {favorite ? <IconHeartFill size={15} /> : <IconHeart size={15} />}
                      </IconButton>
                      <IconButton label="加入队列" onClick={() => onQueue(song)}>
                        <IconPlus size={15} />
                      </IconButton>
                      <IconButton label="加入歌单" onClick={() => onAddToPlaylist(song)}>
                        <IconBookmark size={15} />
                      </IconButton>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <div className="col-span-12 lg:col-span-4 space-y-4">
          <h2 className="font-display text-lg font-extrabold text-cream">快捷推荐</h2>
          <div className="music-ob-quick-panel space-y-2">
            {quickPicks.length === 0 ? (
              <EmptyBlock text="暂无推荐歌单" />
            ) : (
              <>
                {quickPicks.map((item) => (
                  <button
                    key={`${item.source}:${item.id}`}
                    type="button"
                    onClick={() => onOpenSonglist(item)}
                    className="music-ob-quick-row group"
                  >
                    {item.pic ? (
                      <img src={wrapImage(item.pic)} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-ink-3 text-cream-faint">
                        <IconAlbum size={20} />
                      </span>
                    )}
                    <span className="min-w-0 flex-1 text-left">
                      <span className="line-clamp-1 block font-display text-sm font-bold text-cream">
                        {aggregateMusicLabel(item.name, "推荐歌单")}
                      </span>
                      <span className="line-clamp-1 block text-xs text-cream-faint">
                        {aggregatePlaylistMeta(item)}
                      </span>
                    </span>
                    <span className="text-ember opacity-0 transition-opacity group-hover:opacity-100">
                      <IconPlay size={20} />
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={onMore}
                  className="mt-2 w-full rounded-full border border-cream-line py-3 text-sm font-bold text-cream-dim transition-colors hover:bg-cream-pale"
                >
                  查看全部推荐
                </button>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
