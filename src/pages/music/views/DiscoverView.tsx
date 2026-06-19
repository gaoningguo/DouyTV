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
import { type ChartCard } from "../types";
import { aggregateMusicLabel, aggregatePlaylistMeta } from "../utils";
import { useHorizontalRail } from "../useHorizontalRail";
import { EmptyBlock, FilterChip, IconButton } from "../components/ui";
import { DiscoverHero, ReflectCard, VideoCard, isHeroPlaying } from "../components/VinylHero";

interface DiscoverViewProps {
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
  chartCards: ChartCard[];
  favorites: MusicSong[];
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
}

// PLACEHOLDER_BODY
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
  chartCards,
  favorites,
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
}: DiscoverViewProps) {
  const discoveryRail = useHorizontalRail<HTMLDivElement>();
  const mvRail = useHorizontalRail<HTMLDivElement>();
  const newSongRail = useHorizontalRail<HTMLDivElement>();
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
  const heroPlaying = isHeroPlaying(currentSong, heroSong, isPlaying);
  const discoveryCards = songlists.slice(0, 10);
  const likedPicks = favorites.slice(0, 8);
  const bannerPlaylist = songlists[0];
  const mvCards = songlists.slice(10, 20);
  // 新歌速递：优先用名称含「新歌/飙升/热歌」的榜单，否则退回首个榜单的歌曲。
  const newSongChart =
    chartCards.find((c) => /新歌|飙升|新声|热歌|劲爆/.test(c.board.name)) ||
    chartCards[0];
  const newSongs = newSongChart ? newSongChart.songs : boardSongs.slice(0, 5);

  return (
    <div className="music-obsidian-home space-y-12 pb-4">
      {/* 顶部三栏 Hero：黑胶 + 推荐歌单 Banner + 我喜欢网格（借鉴 Tabos fm-home-hero） */}
      <DiscoverHero
        heroSong={heroSong}
        heroCover={heroCover}
        heroTitle={heroTitle}
        heroArtist={heroArtist}
        heroPlaying={heroPlaying}
        resolving={resolving}
        loading={loading}
        bannerPlaylist={bannerPlaylist}
        likedPicks={likedPicks}
        currentSong={currentSong}
        isPlaying={isPlaying}
        onPlay={() =>
          heroSong && onPlay(heroSong, boardSongs.length ? boardSongs : [heroSong])
        }
        onReload={onReload}
        onQueue={() => heroSong && onQueue(heroSong)}
        onOpenSonglist={onOpenSonglist}
        onPlayLiked={(song) => onPlay(song, favorites)}
      />

      {/* 热搜关键词 chips */}
      {hotSearch.length > 0 && (
        <div className="-mt-6 flex flex-wrap items-center gap-2">
          {hotSearch.slice(0, 8).map((item) => (
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
      )}

      {/* 新发现 —— 倒影卡片轨道 */}
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
              className="music-reflect-rail flex gap-6 overflow-x-auto scrollbar-hide"
            >
              {discoveryCards.map((item) => (
                <ReflectCard
                  key={`${item.source}:${item.id}`}
                  cover={item.pic}
                  title={aggregateMusicLabel(item.name, "推荐歌单")}
                  subtitle={aggregatePlaylistMeta(item)}
                  badge="精选歌单"
                  onClick={() => onOpenSonglist(item)}
                />
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

      {/* 排行榜卡片网格（借鉴 Tabos discover-chart-card：封面 + 榜名 + 前 5 名） */}
      {chartCards.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-display text-lg font-extrabold text-cream">排行榜</h2>
          <div className="music-chart-grid">
            {chartCards.map(({ board, songs }) => (
              <article key={`${board.source}:${board.id}`} className="music-chart-card">
                <button
                  type="button"
                  onClick={() => songs[0] && onPlay(songs[0], songs)}
                  className="music-chart-cover"
                  title="播放榜单"
                >
                  {board.cover || songs[0]?.cover ? (
                    <img
                      src={wrapImage(board.cover || songs[0].cover!)}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="grid h-full w-full place-items-center bg-ink-3 text-cream-faint">
                      <IconAlbum size={28} />
                    </span>
                  )}
                  <span className="music-chart-cover-play">
                    <IconPlay size={20} />
                  </span>
                </button>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => onBoard(board)}
                    className="music-chart-head"
                  >
                    <h3 className="line-clamp-1 font-display text-sm font-bold text-cream">
                      {aggregateMusicLabel(board.name, "Ranking")}
                    </h3>
                    <IconChevronRight size={15} className="shrink-0 text-cream-faint" />
                  </button>
                  <ol className="music-chart-tracks">
                    {songs.map((song, index) => {
                      const active =
                        !!currentSong &&
                        musicSongKey(currentSong) === musicSongKey(song);
                      return (
                        <li key={musicSongKey(song)}>
                          <button
                            type="button"
                            onClick={() => onPlay(song, songs)}
                            className="music-chart-track"
                          >
                            <span
                              className="music-chart-rank"
                              style={{
                                color:
                                  index < 3 ? "var(--ember)" : "var(--cream-faint)",
                              }}
                            >
                              {index + 1}
                            </span>
                            <span
                              className="line-clamp-1 text-left"
                              style={{
                                color: active ? "var(--ember)" : "var(--cream-dim)",
                              }}
                            >
                              {song.title}
                              <span className="text-cream-faint"> · {song.artist}</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* 新歌速递 —— 横滑歌曲卡（借鉴 Tabos discover-new-song） */}
      {newSongs.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="font-display text-lg font-extrabold text-cream">新歌速递</h2>
              {newSongChart && (
                <p className="mt-0.5 text-xs text-cream-faint">
                  {aggregateMusicLabel(newSongChart.board.name, "热门新歌")}
                </p>
              )}
            </div>
          </div>
          <div className="group/rail relative">
            <div
              ref={newSongRail.ref}
              className="flex gap-3 overflow-x-auto scrollbar-hide pb-1"
            >
              {newSongs.map((song) => {
                const active =
                  !!currentSong && musicSongKey(currentSong) === musicSongKey(song);
                return (
                  <button
                    key={musicSongKey(song)}
                    type="button"
                    onClick={() => onPlay(song, newSongs)}
                    className="music-newsong-card group"
                  >
                    <span className="music-newsong-cover">
                      {song.cover ? (
                        <img
                          src={wrapImage(song.cover)}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="grid h-full w-full place-items-center bg-ink-3 text-cream-faint">
                          <IconAlbum size={24} />
                        </span>
                      )}
                      <span className="music-newsong-play">
                        {active && isPlaying ? (
                          <IconPause size={18} />
                        ) : (
                          <IconPlay size={18} />
                        )}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1 text-left">
                      <span
                        className="line-clamp-1 block font-display text-sm font-bold"
                        style={{ color: active ? "var(--ember)" : "var(--cream)" }}
                      >
                        {song.title}
                      </span>
                      <span className="line-clamp-1 block text-xs text-cream-faint">
                        {song.artist}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
            {newSongRail.canLeft && (
              <button
                type="button"
                onClick={() => newSongRail.slide(-1)}
                className="music-ob-rail-arrow left-0 -translate-x-1/2"
                aria-label="向左滚动"
              >
                <IconChevronLeft size={20} />
              </button>
            )}
            {newSongRail.canRight && (
              <button
                type="button"
                onClick={() => newSongRail.slide(1)}
                className="music-ob-rail-arrow right-0 translate-x-1/2"
                aria-label="向右滚动"
              >
                <IconChevronRight size={20} />
              </button>
            )}
          </div>
        </section>
      )}

      {/* MV 推荐 —— 16:9 视频风格横滑（LX 无 MV 数据，用歌单封面，点击进歌单） */}
      {mvCards.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-display text-lg font-extrabold text-cream">MV 推荐</h2>
          <div className="group/rail relative">
            <div
              ref={mvRail.ref}
              className="flex gap-4 overflow-x-auto scrollbar-hide pb-1"
            >
              {mvCards.map((item) => (
                <VideoCard
                  key={`${item.source}:${item.id}`}
                  cover={item.pic}
                  title={aggregateMusicLabel(item.name, "推荐歌单")}
                  subtitle={aggregatePlaylistMeta(item)}
                  onClick={() => onOpenSonglist(item)}
                />
              ))}
            </div>
            {mvRail.canLeft && (
              <button
                type="button"
                onClick={() => mvRail.slide(-1)}
                className="music-ob-rail-arrow left-0 -translate-x-1/2"
                aria-label="向左滚动"
              >
                <IconChevronLeft size={20} />
              </button>
            )}
            {mvRail.canRight && (
              <button
                type="button"
                onClick={() => mvRail.slide(1)}
                className="music-ob-rail-arrow right-0 translate-x-1/2"
                aria-label="向右滚动"
              >
                <IconChevronRight size={20} />
              </button>
            )}
          </div>
        </section>
      )}

      {/* 完整榜单列表 —— 选中榜单的详细曲目 */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-extrabold text-cream">
            {selectedBoard
              ? aggregateMusicLabel(selectedBoard.name, "热门榜单")
              : "热门榜单"}
          </h2>
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
                active={
                  selectedBoard?.id === board.id &&
                  selectedBoard?.source === board.source
                }
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
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="h-[68px] rounded-lg skeleton-shimmer" />
            ))}
          </div>
        ) : boardSongs.length === 0 ? (
          <EmptyBlock text="暂无榜单歌曲" />
        ) : (
          <div className="space-y-1">
            {boardSongs.map((song, index) => {
              const active =
                !!currentSong && musicSongKey(currentSong) === musicSongKey(song);
              const playing = active && isPlaying;
              const favorite = isFavorite(song);
              return (
                <article
                  key={`${musicSongKey(song)}:${index}`}
                  className="music-ob-chart-row group"
                  style={active ? { background: "rgba(255,107,53,0.10)" } : undefined}
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
                      <img
                        src={wrapImage(song.cover)}
                        alt=""
                        className="h-full w-full object-cover"
                      />
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
                    <IconButton
                      label="收藏"
                      active={favorite}
                      onClick={() => onFavorite(song)}
                    >
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
      </section>
    </div>
  );
}

