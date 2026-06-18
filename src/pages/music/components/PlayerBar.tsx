import { type CSSProperties } from "react";
import {
  IconAlbum,
  IconChevronRight,
  IconDownload,
  IconHeart,
  IconHeartFill,
  IconPause,
  IconPlay,
  IconQueue,
  IconSettings,
  IconSkipBackward,
  IconSkipForward,
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
import { CoverArt, IconButton, MiniSpectrum } from "./ui";

export function PlayerBar({
  currentSong,
  audioUrl,
  currentCover,
  isPlaying,
  isBuffering,
  resolving,
  currentTime,
  duration,
  volume,
  quality,
  playMode,
  queueCount,
  activeLyric,
  showSpectrum,
  sleepRemaining,
  favorite,
  onTogglePlay,
  onPrev,
  onNext,
  onSeek,
  onVolume,
  onQuality,
  onPlayMode,
  onFavorite,
  onDownload,
  onOpenPlayer,
  onOpenQueue,
  onOpenLyrics,
  onOpenSettings,
}: {
  currentSong: MusicSong | null;
  audioUrl: string;
  currentCover?: string;
  isPlaying: boolean;
  isBuffering: boolean;
  resolving: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  quality: MusicQuality;
  playMode: MusicPlayMode;
  queueCount: number;
  activeLyric?: LyricLine;
  showSpectrum: boolean;
  sleepRemaining: number;
  favorite: boolean;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (time: number) => void;
  onVolume: (volume: number) => void;
  onQuality: (quality: MusicQuality) => void;
  onPlayMode: () => void;
  onFavorite: () => void;
  onDownload: () => void;
  onOpenPlayer: () => void;
  onOpenQueue: () => void;
  onOpenLyrics: () => void;
  onOpenSettings: () => void;
}) {
  const safeDuration = duration > 0 && Number.isFinite(duration) ? duration : 0;
  const progressValue = Math.min(currentTime, safeDuration || 1);
  const progressPercent =
    safeDuration > 0 ? Math.min(100, Math.max(0, (progressValue / safeDuration) * 100)) : 0;
  return (
    <footer className="music-player-shell shrink-0">
      <div
        className="music-player music-player-obsidian"
        style={{ "--music-progress": `${progressPercent}%` } as CSSProperties}
      >
        <div className="music-obsidian-progress">
          <span className="music-obsidian-progress-fill" />
          <input
            type="range"
            min={0}
            max={safeDuration || 1}
            value={progressValue}
            onChange={(event) => onSeek(Number(event.target.value))}
            className="music-progress-hitbox"
            title="播放进度"
          />
        </div>

        <div className="music-obsidian-main">
          <div className="music-obsidian-track">
            <button
              type="button"
              onClick={onOpenPlayer}
              className="music-obsidian-cover tap"
              title="播放详情"
            >
              <CoverArt src={currentCover} title={currentSong?.title} size="small" spinning={isPlaying} />
              {showSpectrum && <span className="music-cover-ring" />}
              <span className="music-obsidian-cover-overlay">
                <IconChevronRight size={18} />
              </span>
            </button>
            <button
              type="button"
              onClick={onOpenPlayer}
              className="min-w-0 flex-1 text-left tap"
              title="播放详情"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="line-clamp-1 font-display text-sm font-bold text-cream">
                  {currentSong?.title || "未播放"}
                </span>
                {(resolving || isBuffering) && (
                  <span className="music-status-pill">{resolving ? "解析" : "缓冲"}</span>
                )}
                {sleepRemaining > 0 && (
                  <span className="music-status-pill">睡眠 {formatDuration(sleepRemaining)}</span>
                )}
              </span>
              <span className="mt-1 block line-clamp-1 text-xs text-cream-faint">
                {activeLyric?.text || currentSong?.artist || "导入音乐源后开始播放"}
              </span>
            </button>
            <IconButton label="收藏" active={favorite} onClick={onFavorite}>
              {favorite ? <IconHeartFill size={16} /> : <IconHeart size={16} />}
            </IconButton>
          </div>

          <div className="music-obsidian-controls">
            <IconButton label={PLAY_MODE_LABEL[playMode]} onClick={onPlayMode}>
              {PLAY_MODE_ICON[playMode]}
            </IconButton>
            <IconButton label="上一首" onClick={onPrev}>
              <IconSkipBackward size={24} />
            </IconButton>
            <button
              type="button"
              onClick={onTogglePlay}
              disabled={resolving || (!currentSong && !audioUrl)}
              className="music-obsidian-play disabled:opacity-45"
              title={isPlaying ? "暂停" : "播放"}
            >
              {isPlaying ? <IconPause size={26} /> : <IconPlay size={26} />}
            </button>
            <IconButton label="下一首" onClick={onNext}>
              <IconSkipForward size={24} />
            </IconButton>
          </div>

          <div className="music-obsidian-tools">
            {showSpectrum && <MiniSpectrum active={isPlaying && !isBuffering} />}
            <IconButton label="歌词" onClick={onOpenLyrics}>
              <IconAlbum size={16} />
            </IconButton>
            <IconButton label={`队列 ${queueCount}`} onClick={onOpenQueue}>
              <IconQueue size={16} />
            </IconButton>
            <IconButton label="下载" onClick={onDownload}>
              <IconDownload size={16} />
            </IconButton>
            <div className="music-obsidian-volume">
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
              {QUALITY_OPTIONS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <IconButton label="设置" onClick={onOpenSettings}>
              <IconSettings size={16} />
            </IconButton>
          </div>
        </div>
      </div>
    </footer>
  );
}
