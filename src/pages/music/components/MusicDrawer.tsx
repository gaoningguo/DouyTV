import { IconClose } from "@/components/Icon";
import { formatDuration, type MusicQuality, type MusicSong } from "@/lib/music";
import { QUALITY_OPTIONS } from "../constants";
import { type DrawerView, type LyricLine } from "../types";
import { SettingRow, Switch } from "./ui";
import { SongList } from "./SongList";
import { LyricStage } from "./LyricStage";
import { EqualizerPanel } from "./EqualizerPanel";

export function MusicDrawer({
  drawer,
  queue,
  currentSong,
  lyricLines,
  getAudioTime,
  lyricShowTrans,
  lyricShowRoma,
  lyricFontScale,
  lyricOffset,
  onLyricShowTrans,
  onLyricShowRoma,
  onLyricFontScale,
  onLyricOffset,
  quality,
  proxyEnabled,
  showSpectrum,
  eqEnabled,
  eqPreset,
  eqGains,
  onEqToggle,
  onEqPreset,
  onEqGain,
  desktopLyricOn,
  onDesktopLyric,
  sleepTimerEndAt,
  sleepRemaining,
  onClose,
  onPlay,
  onRemoveQueue,
  onClearQueue,
  isFavorite,
  onFavorite,
  onAddToPlaylist,
  onSeek,
  onQuality,
  onProxy,
  onSpectrum,
  onSleep,
}: {
  drawer: Exclude<DrawerView, null>;
  queue: MusicSong[];
  currentSong: MusicSong | null;
  lyricLines: LyricLine[];
  getAudioTime: () => number;
  lyricShowTrans: boolean;
  lyricShowRoma: boolean;
  lyricFontScale: number;
  lyricOffset: number;
  onLyricShowTrans: (show: boolean) => void;
  onLyricShowRoma: (show: boolean) => void;
  onLyricFontScale: (scale: number) => void;
  onLyricOffset: (delta: number) => void;
  quality: MusicQuality;
  proxyEnabled: boolean;
  showSpectrum: boolean;
  eqEnabled: boolean;
  eqPreset: string;
  eqGains: number[];
  onEqToggle: (enabled: boolean) => void;
  onEqPreset: (id: string, gains: number[]) => void;
  onEqGain: (index: number, gain: number) => void;
  desktopLyricOn: boolean;
  onDesktopLyric: () => void;
  sleepTimerEndAt: number | null;
  sleepRemaining: number;
  onClose: () => void;
  onPlay: (song: MusicSong) => void;
  onRemoveQueue: (song: MusicSong) => void;
  onClearQueue: () => void;
  isFavorite: (song: MusicSong) => boolean;
  onFavorite: (song: MusicSong) => void;
  onAddToPlaylist: (song: MusicSong) => void;
  onSeek: (time: number) => void;
  onQuality: (quality: MusicQuality) => void;
  onProxy: (enabled: boolean) => void;
  onSpectrum: (enabled: boolean) => void;
  onSleep: (minutes: number) => void;
}) {
  const title =
    drawer === "queue"
      ? "播放队列"
      : drawer === "lyrics"
        ? "沉浸歌词"
        : "音效与设置";
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="关闭" className="absolute inset-0 cursor-default" style={{ background: "rgba(0,0,0,0.58)" }} onClick={onClose} />
      <aside className={drawer === "lyrics" ? "music-drawer music-drawer-wide animate-slide-right" : "music-drawer animate-slide-right"}>
        <header className="h-14 px-4 flex items-center gap-3 shrink-0" style={{ borderBottom: "1px solid var(--cream-line)" }}>
          <h2 className="font-display font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="ml-auto w-9 h-9 rounded-lg grid place-items-center tap text-cream-dim">
            <IconClose size={17} />
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {drawer === "queue" ? (
            <>
              <div className="mb-3 flex items-center gap-2">
                <span className="text-xs text-cream-faint">{queue.length} 首</span>
                {queue.length > 0 && (
                  <button type="button" onClick={onClearQueue} className="ml-auto text-xs text-cream-faint hover:text-ember tap">清空</button>
                )}
              </div>
              <SongList
                songs={queue}
                activeSong={currentSong}
                emptyText="队列为空"
                isFavorite={isFavorite}
                onPlay={onPlay}
                onFavorite={onFavorite}
                onQueue={() => undefined}
                onAddToPlaylist={onAddToPlaylist}
                onRemove={onRemoveQueue}
              />
            </>
          ) : drawer === "lyrics" ? (
            <div className="music-lyrics-stage">
              <LyricStage
                lines={lyricLines}
                getTime={getAudioTime}
                onSeek={onSeek}
                variant="fullscreen"
                showTrans={lyricShowTrans}
                showRoma={lyricShowRoma}
                fontScale={lyricFontScale}
              />
            </div>
          ) : (
            <div className="space-y-4">
              <SettingRow title="稳定流代理" desc="LX 源默认走本地稳定流，避免只播放试听片段。">
                <Switch checked={proxyEnabled} onChange={onProxy} />
              </SettingRow>
              <SettingRow title="频谱动画" desc="播放时显示轻量音频状态动画。">
                <Switch checked={showSpectrum} onChange={onSpectrum} />
              </SettingRow>
              <SettingRow title="桌面歌词" desc="独立置顶窗口显示逐字歌词，可拖动。">
                <Switch checked={desktopLyricOn} onChange={onDesktopLyric} />
              </SettingRow>
              <section className="space-y-3">
                <h3 className="font-display text-sm font-semibold">歌词</h3>
                <SettingRow title="显示翻译" desc="有翻译时在原文下方显示。">
                  <Switch checked={lyricShowTrans} onChange={onLyricShowTrans} />
                </SettingRow>
                <SettingRow title="显示罗马音" desc="有音译时显示拼音/罗马音。">
                  <Switch checked={lyricShowRoma} onChange={onLyricShowRoma} />
                </SettingRow>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm">字号</span>
                    <span className="font-mono text-xs text-cream-faint">
                      {Math.round(lyricFontScale * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.7}
                    max={1.6}
                    step={0.05}
                    value={lyricFontScale}
                    onChange={(event) => onLyricFontScale(Number(event.target.value))}
                    className="w-full"
                    style={{ accentColor: "var(--ember)" }}
                    title="歌词字号"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm">歌词偏移</span>
                    <span className="font-mono text-xs text-cream-faint">
                      {lyricOffset > 0 ? "+" : ""}
                      {lyricOffset.toFixed(1)}s
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onLyricOffset(-0.5)}
                      className="flex-1 h-9 rounded-lg text-sm tap"
                      style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
                      title="歌词延后 0.5 秒"
                    >
                      − 0.5s
                    </button>
                    <button
                      type="button"
                      onClick={() => onLyricOffset(0.5)}
                      className="flex-1 h-9 rounded-lg text-sm tap"
                      style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
                      title="歌词提前 0.5 秒"
                    >
                      + 0.5s
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-cream-faint">
                    歌词与歌声不同步时微调，按当前歌曲记忆。
                  </p>
                </div>
              </section>
              <EqualizerPanel
                enabled={eqEnabled}
                preset={eqPreset}
                gains={eqGains}
                available={proxyEnabled}
                onToggle={onEqToggle}
                onPreset={onEqPreset}
                onGain={onEqGain}
              />
              <section>
                <h3 className="font-display text-sm font-semibold mb-2">音质</h3>
                <div className="grid grid-cols-2 gap-2">
                  {QUALITY_OPTIONS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onQuality(item.id)}
                      className="h-10 rounded-lg text-xs tap"
                      style={{
                        background: quality === item.id ? "var(--ember-soft)" : "var(--ink-2)",
                        color: quality === item.id ? "var(--ember)" : "var(--cream-dim)",
                        border: `1px solid ${quality === item.id ? "var(--ember)" : "var(--cream-line)"}`,
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <h3 className="font-display text-sm font-semibold mb-2">睡眠定时</h3>
                <div className="grid grid-cols-4 gap-2">
                  {[0, 15, 30, 60].map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      onClick={() => onSleep(minutes)}
                      className="h-10 rounded-lg text-xs tap"
                      style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
                    >
                      {minutes === 0 ? "关闭" : `${minutes}分`}
                    </button>
                  ))}
                </div>
                {sleepTimerEndAt && (
                  <p className="mt-2 text-xs text-cream-faint">剩余 {formatDuration(sleepRemaining)} 后暂停</p>
                )}
              </section>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
