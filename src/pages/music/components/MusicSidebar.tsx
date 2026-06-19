import { type ReactNode } from "react";
import {
  IconAlbum,
  IconArtist,
  IconBookmark,
  IconCalendar,
  IconFilm,
  IconFire,
  IconHeartFill,
  IconHistoryClock,
  IconList,
  IconLocal,
  IconPlus,
  IconSettings,
  IconStats,
  IconWave,
} from "@/components/Icon";
import { type MusicUserPlaylist } from "@/stores/music";
import { type LibraryTab, type MusicView } from "../types";

interface SidebarItemProps {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  accent?: string;
  trailing?: ReactNode;
}

function SidebarItem({ icon, label, active, onClick, accent, trailing }: SidebarItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="music-sidebar-item"
      data-active={active || undefined}
    >
      <span
        className="music-sidebar-icon"
        style={accent ? { color: accent } : undefined}
      >
        {icon}
      </span>
      <span className="music-sidebar-text">{label}</span>
      {trailing}
    </button>
  );
}

/**
 * 音乐模块内的左侧导航 —— 借鉴 Tabos 玻璃侧栏布局，皮肤沿用本项目 CRT 主题。
 * 区分于 App 级 SideNav：这里是音乐内部的「发现 / 歌单 / 我的 / 收藏 / 自建歌单」。
 */
export function MusicSidebar({
  view,
  libraryTab,
  activePlaylistId,
  playlists,
  onView,
  onLibrary,
  onOpenPlaylist,
  onCreatePlaylist,
  onOpenSources,
}: {
  view: MusicView;
  libraryTab: LibraryTab;
  activePlaylistId?: string;
  playlists: MusicUserPlaylist[];
  onView: (view: MusicView) => void;
  onLibrary: (tab: LibraryTab) => void;
  onOpenPlaylist: (playlist: MusicUserPlaylist) => void;
  onCreatePlaylist: () => void;
  onOpenSources: () => void;
}) {
  const inLibrary = view === "library";
  return (
    <aside className="music-sidebar">
      <div className="music-sidebar-brand">
        <span className="rec-dot" />
        <span className="font-display font-extrabold text-sm tracking-tight">
          DOUY<span style={{ color: "var(--ember)" }}>TV</span>
        </span>
        <span className="ml-auto font-mono text-[9px] tracking-[0.2em] text-cream-faint">
          MUSIC
        </span>
      </div>

      <nav className="music-sidebar-scroll">
        <div className="music-sidebar-label">在线音乐</div>
        <div className="music-sidebar-section">
          <SidebarItem
            icon={<IconWave size={16} />}
            label="发现"
            active={view === "discover"}
            onClick={() => onView("discover")}
          />
          <SidebarItem
            icon={<IconCalendar size={16} />}
            label="每日推荐"
            active={view === "recommend"}
            onClick={() => onView("recommend")}
          />
          <SidebarItem
            icon={<IconFire size={16} />}
            label="排行榜"
            active={view === "toplist"}
            onClick={() => onView("toplist")}
          />
          <SidebarItem
            icon={<IconAlbum size={16} />}
            label="歌单广场"
            active={view === "songlists" || view === "songlist"}
            onClick={() => onView("songlists")}
          />
          <SidebarItem
            icon={<IconArtist size={16} />}
            label="歌手"
            active={view === "artists" || view === "artist"}
            onClick={() => onView("artists")}
          />
          <SidebarItem
            icon={<IconFilm size={16} />}
            label="MV 广场"
            active={view === "mv"}
            onClick={() => onView("mv")}
          />
          <SidebarItem
            icon={<IconWave size={16} />}
            label="电台播客"
            active={view === "radio"}
            onClick={() => onView("radio")}
          />
        </div>

        <div className="music-sidebar-label">我的</div>
        <div className="music-sidebar-section">
          <SidebarItem
            icon={<IconHeartFill size={16} />}
            label="我喜欢"
            accent="#ff4757"
            active={inLibrary && libraryTab === "favorites"}
            onClick={() => onLibrary("favorites")}
          />
          <SidebarItem
            icon={<IconHistoryClock size={16} />}
            label="最近播放"
            active={view === "recent"}
            onClick={() => onView("recent")}
          />
          <SidebarItem
            icon={<IconStats size={16} />}
            label="听歌足迹"
            active={view === "stats"}
            onClick={() => onView("stats")}
          />
          <SidebarItem
            icon={<IconList size={16} />}
            label="我的歌单"
            active={inLibrary && libraryTab === "playlists"}
            onClick={() => onLibrary("playlists")}
          />
          <SidebarItem
            icon={<IconLocal size={16} />}
            label="本地音乐"
            active={view === "local"}
            onClick={() => onView("local")}
          />
        </div>

        <div className="music-sidebar-label">
          <span>自建歌单</span>
          <button
            type="button"
            onClick={onCreatePlaylist}
            className="music-sidebar-add"
            title="新建歌单"
          >
            <IconPlus size={13} />
          </button>
        </div>
        <div className="music-sidebar-section music-sidebar-playlists">
          {playlists.length === 0 ? (
            <p className="music-sidebar-empty">还没有自建歌单</p>
          ) : (
            playlists.map((playlist) => (
              <SidebarItem
                key={playlist.id}
                icon={<IconBookmark size={16} />}
                label={playlist.name}
                active={activePlaylistId === playlist.id}
                onClick={() => onOpenPlaylist(playlist)}
                trailing={
                  <span className="music-sidebar-count">{playlist.songs.length}</span>
                }
              />
            ))
          )}
        </div>
      </nav>

      <button type="button" onClick={onOpenSources} className="music-sidebar-foot">
        <IconSettings size={16} />
        <span>音乐源</span>
      </button>
    </aside>
  );
}
