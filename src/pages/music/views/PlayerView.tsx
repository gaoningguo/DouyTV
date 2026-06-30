import { useState } from "react";
import {
  IconBookmark,
  IconChevronDown,
  IconDownload,
  IconHeart,
  IconHeartFill,
  IconPause,
  IconPlay,
  IconSkipBackward,
  IconSkipForward,
  IconStats,
  IconSubtitle,
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
import { LyricStage } from "../components/LyricStage";
import { Spectrum } from "../components/Spectrum";
import { SongExtrasPanel } from "../components/SongExtrasPanel";
import type { MusicSongListSummary, MusicSourceDescriptor } from "@/lib/music";

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
  getAudioTime,
  lyricShowTrans,
  lyricShowRoma,
  lyricFontScale,
  showSpectrum,
  sleepTimerEndAt,
  sleepRemaining,
  sleepAfterCurrent,
  playbackRate,
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
  onSleepAfterCurrent,
  onPlaybackRate,
  desktopLyricOn,
  onDesktopLyric,
  desktopLyricAvailable,
  abLoop,
  onAbLoop,
  extrasSource,
  lxSource,
  onPlaySong,
  onOpenPlaylist,
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
  getAudioTime: () => number;
  lyricShowTrans: boolean;
  lyricShowRoma: boolean;
  lyricFontScale: number;
  showSpectrum: boolean;
  sleepTimerEndAt: number | null;
  sleepRemaining: number;
  sleepAfterCurrent: boolean;
  playbackRate: number;
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
  onSleepAfterCurrent: (enabled: boolean) => void;
  onPlaybackRate: (rate: number) => void;
  desktopLyricOn: boolean;
  onDesktopLyric: () => void;
  desktopLyricAvailable: boolean;
  abLoop: { a: number | null; b: number | null };
  onAbLoop: () => void;
  extrasSource: MusicSourceDescriptor | null;
  lxSource?: MusicSourceDescriptor | null;
  onPlaySong: (song: MusicSong) => void;
  onOpenPlaylist: (summary: MusicSongListSummary) => void;
}) {
  const [panel, setPanel] = useState<"lyrics" | "queue" | "extras">("lyrics");
  const safeDuration = duration > 0 && Number.isFinite(duration) ? duration : 0;
  const progressValue = Math.min(currentTime, safeDuration || 1);

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
            <div className="music-turntable" data-playing={isPlaying || undefined}>
              {/* 后方黑胶唱片盘 */}
              <div className="music-turntable-disc" aria-hidden>
                <span className="music-turntable-disc-ring" />
                <span className="music-turntable-disc-ring music-turntable-disc-ring2" />
                {/* 封面嵌在唱片中心 */}
                <span className="music-turntable-label">
                  <CoverArt
                    src={currentCover}
                    title={currentSong?.title}
                    size="detail"
                    spinning={false}
                  />
                </span>
              </div>
              {/* 唱针 */}
              <span className="music-turntable-needle" aria-hidden>
                <span className="music-turntable-needle-arm" />
                <span className="music-turntable-needle-head" />
              </span>
              {showSpectrum && isPlaying && (
                <div className="music-now-equalizer" aria-hidden>
                  <Spectrum bars={28} playing={isPlaying} className="music-spectrum-canvas" />
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
              <button
                type="button"
                onClick={() => setPanel("extras")}
                className={panel === "extras" ? "is-active" : undefined}
              >
                更多
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
              <LyricStage
                lines={lyricLines}
                getTime={getAudioTime}
                onSeek={onSeek}
                variant="panel"
                showTrans={lyricShowTrans}
                showRoma={lyricShowRoma}
                fontScale={lyricFontScale}
              />
            ) : panel === "queue" ? (
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
            ) : (
              <SongExtrasPanel
                song={currentSong}
                source={extrasSource}
                lxSource={lxSource}
                onPlaySong={onPlaySong}
                onOpenPlaylist={onOpenPlaylist}
              />
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
            {desktopLyricAvailable && (
              <IconButton
                label={desktopLyricOn ? "关闭桌面歌词" : "桌面歌词"}
                active={desktopLyricOn}
                onClick={onDesktopLyric}
              >
                <IconSubtitle size={17} />
              </IconButton>
            )}
            <IconButton
              label={showSpectrum ? "关闭频谱" : "开启频谱"}
              active={showSpectrum}
              onClick={() => onSpectrum(!showSpectrum)}
            >
              <IconStats size={17} />
            </IconButton>
            <button
              type="button"
              onClick={onAbLoop}
              className="music-ab-btn"
              data-state={abLoop.a !== null && abLoop.b !== null ? "full" : abLoop.a !== null ? "half" : undefined}
              title={
                abLoop.a !== null && abLoop.b !== null
                  ? `A-B 循环 ${formatDuration(abLoop.a)}–${formatDuration(abLoop.b)}（点击取消）`
                  : abLoop.a !== null
                    ? `已设 A=${formatDuration(abLoop.a)}，再点设 B`
                    : "A-B 循环：点击设起点 A"
              }
            >
              {abLoop.a !== null && abLoop.b !== null ? "A-B" : abLoop.a !== null ? "A-" : "A·B"}
            </button>
            <select
              value={playbackRate}
              onChange={(event) => onPlaybackRate(Number(event.target.value))}
              className="music-obsidian-quality"
              title="倍速"
            >
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                <option key={rate} value={rate}>
                  {rate}x
                </option>
              ))}
            </select>
            <select
              value=""
              onChange={(event) => {
                const value = event.target.value;
                if (value === "current") onSleepAfterCurrent(true);
                else onSleep(Number(value));
                event.currentTarget.value = "";
              }}
              className="music-obsidian-quality"
              title="睡眠定时"
            >
              <option value="" disabled>
                {sleepAfterCurrent
                  ? "播完当前曲"
                  : sleepTimerEndAt
                    ? `定时 ${formatDuration(sleepRemaining)}`
                    : "睡眠定时"}
              </option>
              <option value="0">关闭</option>
              <option value="15">15 分钟</option>
              <option value="30">30 分钟</option>
              <option value="60">60 分钟</option>
              <option value="90">90 分钟</option>
              <option value="current">播完当前曲</option>
            </select>
          </div>
        </div>
      </div>
    </section>
  );
}
