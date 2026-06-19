import { type ReactNode } from "react";
import { IconAlbum, IconArtist, IconFilm, IconLocal } from "@/components/Icon";

/** 各页面通用的页头：大标题 + 副标题 + 右侧操作槽。 */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="music-page-head">
      <div className="min-w-0">
        <h1 className="music-page-title text-glow">{title}</h1>
        {subtitle && <p className="music-page-sub">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/** 无数据页面的占位空状态（等后端扩展后接入真实数据）。 */
export function PlaceholderState({
  icon,
  title,
  desc,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <section className="music-placeholder">
      <span className="music-placeholder-icon">{icon}</span>
      <h2 className="font-display text-lg font-bold text-cream">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-cream-dim">{desc}</p>
      <span className="music-placeholder-badge">敬请期待</span>
    </section>
  );
}

/** 本地音乐页（LX 无对应数据，占位）。 */
export function LocalView() {
  return (
    <div className="music-page-wrap">
      <PageHeader title="本地音乐" subtitle="扫描设备上的音频文件" />
      <PlaceholderState
        icon={<IconLocal size={40} />}
        title="本地音乐即将到来"
        desc="后续将接入设备文件扫描，把本地歌曲与在线曲库统一管理、统一播放。"
      />
    </div>
  );
}

/** MV 广场（LX 无 MV 数据，用歌单封面占位为 16:9 视频卡）。 */
export function MvPlaceholder() {
  return (
    <PlaceholderState
      icon={<IconFilm size={40} />}
      title="MV 广场即将到来"
      desc="后端接入 MV 数据源后，这里将展示官方 MV、现场、翻唱与舞蹈视频。"
    />
  );
}

/** 歌手页空态。 */
export function ArtistsEmpty() {
  return (
    <PlaceholderState
      icon={<IconArtist size={40} />}
      title="按分类浏览歌手"
      desc="选择上方分类与首字母筛选歌手。后端接入歌手榜数据后，这里会展示歌手头像墙。"
    />
  );
}

export { IconAlbum };
