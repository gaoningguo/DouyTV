import { IconAlbum, IconFire, IconPlay } from "@/components/Icon";
import { musicSongKey, type MusicDiscoveryBoard, type MusicSong } from "@/lib/music";
import { wrapImage } from "@/lib/proxy";
import { type ChartCard } from "../types";
import { aggregateMusicLabel } from "../utils";
import { SongList } from "../components/SongList";
import { EmptyBlock } from "../components/ui";
import { PageHeader } from "./shared";

/**
 * 排行榜页 —— 借鉴 Tabos FreeMusicToplist：
 * 官方榜卡片网格（封面 + 前几名）+ 全部榜单封面网格 + 选中榜单详情列表。
 */
export function ToplistView({
  boards,
  chartCards,
  selectedBoard,
  boardSongs,
  boardLoading,
  currentSong,
  isPlaying,
  isFavorite,
  onBoard,
  onPlay,
  onFavorite,
  onQueue,
  onAddToPlaylist,
}: {
  boards: MusicDiscoveryBoard[];
  chartCards: ChartCard[];
  selectedBoard: MusicDiscoveryBoard | null;
  boardSongs: MusicSong[];
  boardLoading: boolean;
  currentSong: MusicSong | null;
  isPlaying: boolean;
  isFavorite: (song: MusicSong) => boolean;
  onBoard: (board: MusicDiscoveryBoard) => void;
  onPlay: (song: MusicSong, songs: MusicSong[]) => void;
  onFavorite: (song: MusicSong) => void;
  onQueue: (song: MusicSong) => void;
  onAddToPlaylist: (song: MusicSong) => void;
}) {
  const activeSong = currentSong;
  return (
    <div className="music-page-wrap space-y-8">
      <PageHeader title="排行榜" subtitle="各平台官方榜单与热门榜" />

      {/* 官方榜卡片网格（封面 + 前 5 名） */}
      {chartCards.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-display text-base font-extrabold text-cream">官方榜</h2>
          <div className="music-toplist-official-grid">
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
                  </button>
                  <ol className="music-chart-tracks">
                    {songs.map((song, index) => {
                      const active =
                        !!activeSong &&
                        musicSongKey(activeSong) === musicSongKey(song);
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
                                color: index < 3 ? "var(--ember)" : "var(--cream-faint)",
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

      {/* 全部榜单封面网格 */}
      {boards.length > 0 && (
        <section className="space-y-4">
          <h2 className="font-display text-base font-extrabold text-cream">全部榜单</h2>
          <div className="music-toplist-cover-grid">
            {boards.map((board) => {
              const active =
                selectedBoard?.id === board.id && selectedBoard?.source === board.source;
              return (
                <button
                  key={`${board.source}:${board.id}`}
                  type="button"
                  onClick={() => onBoard(board)}
                  className="music-toplist-cover-card"
                  data-active={active || undefined}
                >
                  <span className="music-toplist-cover-img">
                    {board.cover ? (
                      <img src={wrapImage(board.cover)} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="grid h-full w-full place-items-center bg-ink-3 text-cream-faint">
                        <IconFire size={26} />
                      </span>
                    )}
                  </span>
                  <span className="music-toplist-cover-name line-clamp-2">
                    {aggregateMusicLabel(board.name, "榜单")}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* 选中榜单详情 */}
      <section className="space-y-4">
        <h2 className="font-display text-base font-extrabold text-cream">
          {selectedBoard ? aggregateMusicLabel(selectedBoard.name, "榜单详情") : "榜单详情"}
        </h2>
        {boardSongs.length === 0 && !boardLoading ? (
          <EmptyBlock text="选择一个榜单查看完整曲目" />
        ) : (
          <SongList
            songs={boardSongs}
            activeSong={activeSong}
            activePlaying={isPlaying}
            loading={boardLoading}
            emptyText="暂无榜单歌曲"
            isFavorite={isFavorite}
            onPlay={(song) => onPlay(song, boardSongs)}
            onFavorite={onFavorite}
            onQueue={onQueue}
            onAddToPlaylist={onAddToPlaylist}
          />
        )}
      </section>
    </div>
  );
}
