import { IconAlbum, IconPause, IconPlay, IconPlus, IconRefresh } from "@/components/Icon";
import { musicSongKey, type MusicSong, type MusicSongListSummary } from "@/lib/music";
import { wrapImage } from "@/lib/proxy";
import { aggregateMusicLabel, aggregatePlaylistMeta } from "../utils";

/** 黑胶场景：方形封面右侧切出圆形缺口，露出后方旋转的唱片。 */
function VinylScene({
  heroCover,
  heroTitle,
  heroSong,
  heroPlaying,
  onPlay,
}: {
  heroCover?: string;
  heroTitle: string;
  heroSong?: MusicSong;
  heroPlaying: boolean;
  onPlay: () => void;
}) {
  return (
    <div
      className={`music-vinyl-scene${heroPlaying ? " is-spinning" : ""}`}
      aria-hidden={!heroSong}
    >
      <div className="music-vinyl-disc">
        <span className="music-vinyl-disc-ring" />
        <span className="music-vinyl-disc-label" />
      </div>
      <div className="music-vinyl-cover">
        {heroCover ? (
          <img src={heroCover} alt={heroTitle} />
        ) : (
          <span className="music-vinyl-cover-ph" />
        )}
      </div>
      {heroSong && (
        <button
          type="button"
          onClick={onPlay}
          className="music-vinyl-play"
          title={heroPlaying ? "暂停" : "播放"}
        >
          {heroPlaying ? <IconPause size={18} /> : <IconPlay size={18} />}
        </button>
      )}
    </div>
  );
}

// PLACEHOLDER_HERO
/**
 * 发现页顶部三栏 Hero —— 借鉴 Tabos fm-home-hero：
 * 左：黑胶 + 正在播放/今日推荐信息；中：推荐歌单 Banner 卡；右：我喜欢 2×2 网格。
 */
export function DiscoverHero({
  heroSong,
  heroCover,
  heroTitle,
  heroArtist,
  heroPlaying,
  resolving,
  loading,
  bannerPlaylist,
  likedPicks,
  currentSong,
  isPlaying,
  onPlay,
  onReload,
  onQueue,
  onOpenSonglist,
  onPlayLiked,
}: {
  heroSong?: MusicSong;
  heroCover?: string;
  heroTitle: string;
  heroArtist: string;
  heroPlaying: boolean;
  resolving: boolean;
  loading: boolean;
  bannerPlaylist?: MusicSongListSummary;
  likedPicks: MusicSong[];
  currentSong: MusicSong | null;
  isPlaying: boolean;
  onPlay: () => void;
  onReload: () => void;
  onQueue: () => void;
  onOpenSonglist: (item: MusicSongListSummary) => void;
  onPlayLiked: (song: MusicSong) => void;
}) {
  return (
    <section className="music-hero3">
      {/* 左：黑胶 + 信息 */}
      <div className="music-hero3-main">
        <div
          aria-hidden
          className="music-vinyl-hero-bg"
          style={
            heroCover
              ? { backgroundImage: `url(${heroCover})` }
              : {
                  background:
                    "linear-gradient(135deg, rgba(255,107,53,0.22), rgba(79,195,247,0.12))",
                }
          }
        />
        <div aria-hidden className="music-vinyl-hero-veil" />
        <div className="music-hero3-main-body">
          <div className="music-hero3-info">
            <div className="flex items-center gap-3">
              <span className="music-ob-tag">
                {resolving ? "解析中" : heroPlaying ? "正在播放" : "今日推荐"}
              </span>
              <span className="line-clamp-1 text-xs text-cream-dim">{heroArtist}</span>
            </div>
            <h1 className="music-hero3-title text-glow line-clamp-2">{heroTitle}</h1>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              {heroSong && (
                <button type="button" onClick={onPlay} className="music-ob-play-btn">
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
                  onClick={onQueue}
                  className="music-ob-icon-btn"
                  title="加入队列"
                >
                  <IconPlus size={18} />
                </button>
              )}
            </div>
          </div>
          <VinylScene
            heroCover={heroCover}
            heroTitle={heroTitle}
            heroSong={heroSong}
            heroPlaying={heroPlaying}
            onPlay={onPlay}
          />
        </div>
      </div>

      {/* 中：推荐歌单 Banner 卡 */}
      <button
        type="button"
        className="music-hero3-banner"
        onClick={() => bannerPlaylist && onOpenSonglist(bannerPlaylist)}
        disabled={!bannerPlaylist}
      >
        {bannerPlaylist?.pic ? (
          <img
            src={wrapImage(bannerPlaylist.pic)}
            alt=""
            className="music-hero3-banner-img"
          />
        ) : (
          <span className="music-hero3-banner-ph">
            <IconAlbum size={40} />
          </span>
        )}
        <span aria-hidden className="music-hero3-banner-veil" />
        <span className="music-hero3-banner-body">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-ember">
            每日歌单
          </span>
          <span className="line-clamp-2 font-display text-base font-extrabold text-cream">
            {bannerPlaylist
              ? aggregateMusicLabel(bannerPlaylist.name, "精选歌单")
              : "暂无推荐"}
          </span>
          {bannerPlaylist && (
            <span className="line-clamp-1 text-xs text-cream-dim">
              {aggregatePlaylistMeta(bannerPlaylist)}
            </span>
          )}
        </span>
      </button>

      {/* 右：我喜欢 2×2 网格 */}
      <div className="music-hero3-liked">
        {likedPicks.length === 0 ? (
          <div className="grid h-full place-items-center text-center text-xs text-cream-faint">
            收藏的歌会出现在这里
          </div>
        ) : (
          likedPicks.slice(0, 4).map((song) => {
            const active =
              !!currentSong && musicSongKey(currentSong) === musicSongKey(song);
            return (
              <button
                key={musicSongKey(song)}
                type="button"
                onClick={() => onPlayLiked(song)}
                className="music-hero3-liked-item group"
              >
                {song.cover ? (
                  <img src={wrapImage(song.cover)} alt="" className="music-liked-img" />
                ) : (
                  <span className="music-liked-ph">
                    <IconAlbum size={20} />
                  </span>
                )}
                <span className="music-liked-veil" aria-hidden />
                <span className="music-liked-name line-clamp-1">{song.title}</span>
                <span className="music-liked-play">
                  {active && isPlaying ? <IconPause size={14} /> : <IconPlay size={14} />}
                </span>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}


/** 倒影卡片 —— 借鉴 Tabos carousel：封面下方带镜面倒影，横向 snap 滚动。 */
export function ReflectCard({
  cover,
  title,
  subtitle,
  badge,
  onClick,
}: {
  cover?: string;
  title: string;
  subtitle?: string;
  badge?: string;
  onClick: () => void;
}) {
  const src = cover ? wrapImage(cover) : undefined;
  return (
    <button type="button" onClick={onClick} className="music-reflect-card group">
      <div className="music-reflect-cover">
        {src ? (
          <img src={src} alt={title} className="music-reflect-img" />
        ) : (
          <span className="music-reflect-ph" />
        )}
        {badge && <span className="music-reflect-badge">{badge}</span>}
        <span className="music-reflect-shine" aria-hidden />
      </div>
      <div className="music-reflect-mirror" aria-hidden>
        {src && <img src={src} alt="" className="music-reflect-img" />}
      </div>
      <div className="music-reflect-meta">
        <span className="music-reflect-title line-clamp-1">{title}</span>
        {subtitle && <span className="music-reflect-sub line-clamp-1">{subtitle}</span>}
      </div>
    </button>
  );
}

/** 16:9 视频风格卡片 —— 用于「MV 推荐」横滑（借鉴 Tabos discover-mv-card）。 */
export function VideoCard({
  cover,
  title,
  subtitle,
  onClick,
}: {
  cover?: string;
  title: string;
  subtitle?: string;
  onClick: () => void;
}) {
  const src = cover ? wrapImage(cover) : undefined;
  return (
    <button type="button" onClick={onClick} className="music-mv-card group">
      <div className="music-mv-cover">
        {src ? (
          <img src={src} alt={title} className="music-mv-img" />
        ) : (
          <span className="music-mv-ph">
            <IconAlbum size={30} />
          </span>
        )}
        <span className="music-mv-veil" aria-hidden />
        <span className="music-mv-play">
          <IconPlay size={20} />
        </span>
      </div>
      <span className="music-mv-name line-clamp-1">{title}</span>
      {subtitle && <span className="music-mv-sub line-clamp-1">{subtitle}</span>}
    </button>
  );
}

export function isHeroPlaying(
  currentSong: MusicSong | null,
  heroSong: MusicSong | undefined,
  isPlaying: boolean
) {
  return (
    isPlaying &&
    !!currentSong &&
    !!heroSong &&
    musicSongKey(currentSong) === musicSongKey(heroSong)
  );
}
