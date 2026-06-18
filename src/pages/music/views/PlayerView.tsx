import { useEffect, useRef, useState } from "react";
import {
  IconBookmark,
  IconChevronDown,
  IconClock,
  IconDownload,
  IconHeart,
  IconHeartFill,
  IconPause,
  IconPlay,
  IconSkipBackward,
  IconSkipForward,
  IconStats,
  IconVolume,
  IconVolumeMute,
} from "@/components/Icon";
import {
  formatDuration,
  type MusicPlayMode,
  type MusicQuality,
  type MusicSong,
} from "@/lib/music";
import { PLAY_MODE_ICON, PLAY_MODE_LABEL, QUALITY_OPTIONS } from "../constants";
import { type LyricLine } from "../types";
import { CoverArt, IconButton } from "../components/ui";
import { SongList } from "../components/SongList";

export function PlayerView({
  currentSong,
  currentCover,
  isPlaying,
  isBuffering,
  resolving,
  currentTime,
  duration,
  volume,
  quality,
  playMode,
  queue,
  lyricLines,
  activeLyricIndex,
  showSpectrum,
  sleepTimerEndAt,
  sleepRemaining,
  favorite,
  onBack,
  onTogglePlay,
  onPrev,
  onNext,
  onSeek,
  onVolume,
  onQuality,
  onPlayMode,
  onFavorite,
  onDownload,
  onAddToPlaylist,
  onPlayFromQueue,
  onRemoveQueue,
  onClearQueue,
  onSpectrum,
  onSleep,
}: {
  currentSong: MusicSong | null;
  currentCover?: string;
  isPlaying: boolean;
  isBuffering: boolean;
  resolving: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  quality: MusicQuality;
  playMode: MusicPlayMode;
  queue: MusicSong[];
  lyricLines: LyricLine[];
  activeLyricIndex: number;
  showSpectrum: boolean;
  sleepTimerEndAt: number | null;
  sleepRemaining: number;
  favorite: boolean;
  onBack: () => void;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (time: number) => void;
  onVolume: (volume: number) => void;
  onQuality: (quality: MusicQuality) => void;
  onPlayMode: () => void;
  onFavorite: () => void;
  onDownload: () => void;
  onAddToPlaylist: (song: MusicSong) => void;
  onPlayFromQueue: (song: MusicSong) => void;
  onRemoveQueue: (song: MusicSong) => void;
  onClearQueue: () => void;
  onSpectrum: (enabled: boolean) => void;
  onSleep: (minutes: number) => void;
}) {
  const [panel, setPanel] = useState<"lyrics" | "queue">("lyrics");
  const lyricRef = useRef<HTMLDivElement>(null);
  const safeDuration = duration > 0 && Number.isFinite(duration) ? duration : 0;
  const progressValue = Math.min(currentTime, safeDuration || 1);

  useEffect(() => {
    if (panel !== "lyrics") return;
    const stage = lyricRef.current;
    if (!stage) return;
    const active = stage.querySelector<HTMLElement>("[data-active='true']");
    if (active) {
      active.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [activeLyricIndex, panel]);

  return (
    <section className="music-now-playing flex-1 min-h-0">
      <div
        aria-hidden
        className="music-now-bg"
        style={
          currentCover
            ? { backgroundImage: `url(${currentCover})` }
            : undefined
        }
      />
      <div aria-hidden className="music-now-veil" />

      <div className="music-now-inner">
        <header className="music-now-topbar">
          <button type="button" onClick={onBack} className="music-back-btn" title="返回">
            <IconChevronDown size={20} />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <p className="font-mono text-[10px] font-semibold tracking-[0.18em] text-cream-dim">
              {resolving ? "解析中" : isBuffering ? "缓冲中" : isPlaying ? "正在播放" : "已暂停"}
            </p>
            <p className="line-clamp-1 text-xs text-cream-faint">
              {currentSong?.sourceName || "DouyTV Music"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => currentSong && onAddToPlaylist(currentSong)}
            className="music-back-btn"
            title="加入歌单"
          >
            <IconBookmark size={18} />
          </button>
        </header>

        <div className="music-now-body">
          <div className="music-now-art-col">
            <div className="music-now-art">
              <CoverArt src={currentCover} title={currentSong?.title} size="detail" spinning={isPlaying} />
              {showSpectrum && isPlaying && (
                <div className="music-now-equalizer" aria-hidden>
                  {Array.from({ length: 14 }).map((_, index) => (
                    <span key={index} style={{ animationDelay: `${index * 70}ms` }} />
                  ))}
                </div>
              )}
            </div>
            <div className="mt-6 w-full max-w-md text-center">
              <h1 className="line-clamp-2 font-display text-xl font-extrabold sm:text-2xl">
                {currentSong?.title || "未播放"}
              </h1>
              <p className="mt-2 line-clamp-1 text-sm text-cream-dim">
                {currentSong?.artist || "选择一首歌开始播放"}
                {currentSong?.album ? ` · ${currentSong.album}` : ""}
              </p>
            </div>
          </div>

          <div className="music-now-panel">
            <div className="music-now-panel-tabs">
              <button
                type="button"
                onClick={() => setPanel("lyrics")}
                className={panel === "lyrics" ? "is-active" : undefined}
              >
                歌词
              </button>
              <button
                type="button"
                onClick={() => setPanel("queue")}
                className={panel === "queue" ? "is-active" : undefined}
              >
                队列 {queue.length > 0 ? queue.length : ""}
              </button>
              {panel === "queue" && queue.length > 0 && (
                <button
                  type="button"
                  onClick={onClearQueue}
                  className="ml-auto text-xs text-cream-faint hover:text-ember tap"
                >
                  清空
                </button>
              )}
            </div>
            {panel === "lyrics" ? (
              <div ref={lyricRef} className="music-now-lyrics">
                {lyricLines.length === 0 ? (
                  <div className="grid h-full place-items-center text-sm text-cream-faint">
                    暂无歌词
                  </div>
                ) : (
                  lyricLines.map((line, index) => (
                    <button
                      key={`${line.time}:${index}`}
                      type="button"
                      data-active={index === activeLyricIndex}
                      onClick={() => onSeek(line.time)}
                      className={
                        index === activeLyricIndex
                          ? "music-now-lyric music-now-lyric-active"
                          : "music-now-lyric"
                      }
                    >
                      <span>
                        {line.text || line.trans}
                      </span>
                      {line.trans && line.text && (
                        <span className="music-now-lyric-trans">{line.trans}</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            ) : (
              <div className="music-now-queue">
                <SongList
                  songs={queue}
                  activeSong={currentSong}
                  activePlaying={isPlaying}
                  compact
                  emptyText="队列为空"
                  isFavorite={() => favorite && false}
                  onPlay={onPlayFromQueue}
                  onFavorite={() => undefined}
                  onQueue={() => undefined}
                  onAddToPlaylist={onAddToPlaylist}
                  onRemove={onRemoveQueue}
                  hideFavorite
                  hideQueue
                />
              </div>
            )}
          </div>
        </div>

        <div className="music-now-controls">
          <div className="music-now-seek">
            <span className="font-mono text-[10px] text-cream-faint">{formatDuration(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={safeDuration || 1}
              value={progressValue}
              onChange={(event) => onSeek(Number(event.target.value))}
              className="music-progress flex-1"
              title="播放进度"
            />
            <span className="font-mono text-[10px] text-cream-faint">{formatDuration(safeDuration)}</span>
          </div>

          <div className="music-now-transport">
            <IconButton label={PLAY_MODE_LABEL[playMode]} onClick={onPlayMode}>
              {PLAY_MODE_ICON[playMode]}
            </IconButton>
            <IconButton label="上一首" onClick={onPrev}>
              <IconSkipBackward size={26} />
            </IconButton>
            <button
              type="button"
              onClick={onTogglePlay}
              disabled={resolving || !currentSong}
              className="music-now-play disabled:opacity-45"
              title={isPlaying ? "暂停" : "播放"}
            >
              {isPlaying ? <IconPause size={30} /> : <IconPlay size={30} />}
            </button>
            <IconButton label="下一首" onClick={onNext}>
              <IconSkipForward size={26} />
            </IconButton>
            <IconButton label="收藏" active={favorite} onClick={onFavorite}>
              {favorite ? <IconHeartFill size={20} /> : <IconHeart size={20} />}
            </IconButton>
          </div>

          <div className="music-now-tools">
            <div className="music-now-volume">
              {volume <= 0.01 ? <IconVolumeMute size={16} /> : <IconVolume size={16} />}
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(event) => onVolume(Number(event.target.value))}
                title="音量"
              />
            </div>
            <select
              value={quality}
              onChange={(event) => onQuality(event.target.value as MusicQuality)}
              className="music-obsidian-quality"
              title="音质"
            >
              {QUALITY_OPTIONS.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.label}
                </option>
              ))}
            </select>
            <IconButton label="下载" onClick={onDownload}>
              <IconDownload size={17} />
            </IconButton>
            <IconButton
              label={showSpectrum ? "关闭频谱" : "开启频谱"}
              active={showSpectrum}
              onClick={() => onSpectrum(!showSpectrum)}
            >
              <IconStats size={17} />
            </IconButton>
            <IconButton
              label={sleepTimerEndAt ? `定时 ${formatDuration(sleepRemaining)}` : "睡眠定时"}
              active={!!sleepTimerEndAt}
              onClick={() => onSleep(sleepTimerEndAt ? 0 : 30)}
            >
              <IconClock size={17} />
            </IconButton>
          </div>
        </div>
      </div>
    </section>
  );
}
