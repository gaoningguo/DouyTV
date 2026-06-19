import { useMemo } from "react";
import { type MusicHistoryRecord, type MusicSong } from "@/lib/music";
import { SongList } from "../components/SongList";
import { PageHeader, PlaceholderState } from "./shared";
import { IconStats } from "@/components/Icon";

/**
 * 听歌足迹/统计 —— 纯前端从本地 history(带 playCount/lastPlayedAt/duration)计算。
 * 展示维度对齐 CyreneMusic 足迹/统计(其数据来自后端,我们用本地历史等价计算)。
 */
export function StatsView({
  history,
  currentSong,
  isPlaying,
  isFavorite,
  onPlay,
  onFavorite,
  onQueue,
  onAddToPlaylist,
}: {
  history: MusicHistoryRecord[];
  currentSong: MusicSong | null;
  isPlaying: boolean;
  isFavorite: (song: MusicSong) => boolean;
  onPlay: (song: MusicSong, songs: MusicSong[]) => void;
  onFavorite: (song: MusicSong) => void;
  onQueue: (song: MusicSong) => void;
  onAddToPlaylist: (song: MusicSong) => void;
}) {
  const stats = useMemo(() => {
    const totalPlays = history.reduce((sum, r) => sum + (r.playCount || 1), 0);
    const totalSeconds = history.reduce(
      (sum, r) => sum + (r.playCount || 1) * (r.duration || r.durationSec || 0),
      0
    );
    const topSongs = [...history]
      .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
      .slice(0, 10);
    const recent = [...history]
      .sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0))
      .slice(0, 12);
    // 最常听歌手
    const artistMap = new Map<string, number>();
    for (const r of history) {
      const name = (r.artist || "").split(/[/、,，&]/)[0].trim();
      if (!name) continue;
      artistMap.set(name, (artistMap.get(name) || 0) + (r.playCount || 1));
    }
    const topArtists = [...artistMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    // 听歌时段(按 lastPlayedAt 小时分布)
    const hours = new Array(24).fill(0);
    for (const r of history) {
      if (!r.lastPlayedAt) continue;
      hours[new Date(r.lastPlayedAt).getHours()] += r.playCount || 1;
    }
    const maxHour = Math.max(1, ...hours);
    return { totalPlays, totalSeconds, topSongs, recent, topArtists, hours, maxHour };
  }, [history]);

  if (history.length === 0) {
    return (
      <div className="music-page-wrap">
        <PageHeader title="听歌足迹" subtitle="你的听歌统计" />
        <PlaceholderState
          icon={<IconStats size={40} />}
          title="还没有听歌记录"
          desc="播放一些歌曲后，这里会展示你的播放排行、最常听的歌手与听歌时段。"
        />
      </div>
    );
  }

  const totalHours = Math.floor(stats.totalSeconds / 3600);
  const totalMins = Math.round((stats.totalSeconds % 3600) / 60);

  return (
    <div className="music-page-wrap space-y-6">
      <PageHeader title="听歌足迹" subtitle="基于本地播放记录统计" />

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "曲目", value: String(history.length) },
          { label: "播放次数", value: String(stats.totalPlays) },
          { label: "累计时长", value: totalHours > 0 ? `${totalHours}h${totalMins}m` : `${totalMins}m` },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-xl p-4 text-center"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          >
            <div className="font-mono text-2xl font-extrabold text-ember">{card.value}</div>
            <div className="mt-1 text-xs text-cream-faint">{card.label}</div>
          </div>
        ))}
      </div>

      {stats.topArtists.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-lg font-bold">最常听的歌手</h2>
          <div className="flex flex-wrap gap-2">
            {stats.topArtists.map(([name, count]) => (
              <span
                key={name}
                className="rounded-lg px-3 py-1.5 text-sm text-cream-dim"
                style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
              >
                {name} <span className="text-cream-faint font-mono text-xs">×{count}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 font-display text-lg font-bold">听歌时段</h2>
        <div className="flex items-end gap-1" style={{ height: 96 }}>
          {stats.hours.map((count, hour) => (
            <div key={hour} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${hour}时 · ${count}次`}>
              <div
                className="w-full rounded-t"
                style={{
                  height: `${Math.max(2, (count / stats.maxHour) * 80)}px`,
                  background: count > 0 ? "var(--ember)" : "var(--ink-3)",
                  opacity: count > 0 ? 0.85 : 0.4,
                }}
              />
              {hour % 6 === 0 && <span className="font-mono text-[9px] text-cream-faint">{hour}</span>}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-display text-lg font-bold">播放排行</h2>
        <SongList
          songs={stats.topSongs}
          activeSong={currentSong}
          activePlaying={isPlaying}
          emptyText="暂无数据"
          isFavorite={isFavorite}
          onPlay={(song) => onPlay(song, stats.topSongs)}
          onFavorite={onFavorite}
          onQueue={onQueue}
          onAddToPlaylist={onAddToPlaylist}
        />
      </section>

      <section>
        <h2 className="mb-3 font-display text-lg font-bold">最近足迹</h2>
        <SongList
          songs={stats.recent}
          activeSong={currentSong}
          activePlaying={isPlaying}
          emptyText="暂无数据"
          isFavorite={isFavorite}
          onPlay={(song) => onPlay(song, stats.recent)}
          onFavorite={onFavorite}
          onQueue={onQueue}
          onAddToPlaylist={onAddToPlaylist}
        />
      </section>
    </div>
  );
}
