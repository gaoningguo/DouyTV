import { useEffect, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import Home from "@/pages/Home";
import Library from "@/pages/Library";
import Search from "@/pages/Search";
import Detail from "@/pages/Detail";
import Play from "@/pages/Play";
import Live from "@/pages/Live";
import NetworkRoom from "@/pages/live/NetworkRoom";
import Local from "@/pages/Local";
import Settings from "@/pages/Settings";
import SettingsLocalScan from "@/pages/settings/LocalScan";
import SettingsProxy from "@/pages/settings/Proxy";
import SettingsDanmaku from "@/pages/settings/Danmaku";
import SettingsMusic from "@/pages/settings/Music";
import SettingsBooks from "@/pages/settings/Books";
import SettingsManga from "@/pages/settings/Manga";
import SettingsSync from "@/pages/settings/Sync";
import SettingsUpdates from "@/pages/settings/Updates";
import SettingsNovel from "@/pages/settings/Novel";
import SettingsMangaSrc from "@/pages/settings/MangaSrc";
import SettingsVideoHub from "@/pages/settings/VideoSourcesHub";
import SettingsLiveHub from "@/pages/settings/LiveSourcesHub";
import SettingsStripchatKeys, {
  loadKeysFromStorage as loadStripchatKeys,
  syncKeysToRust as syncStripchatKeys,
} from "@/pages/settings/StripchatKeys";
import MusicHome from "@/pages/music/Home";
import MusicSearch from "@/pages/music/Search";
import MusicPlaylist from "@/pages/music/Playlist";
import MusicPlayer from "@/pages/music/Player";
import MusicLibrary from "@/pages/music/Library";
import MusicFavorites from "@/pages/music/Favorites";
import MusicUserPlaylist from "@/pages/music/UserPlaylist";
import MusicHistory from "@/pages/music/History";
import MusicRecommend from "@/pages/music/Recommend";
import MusicRecommendTag from "@/pages/music/RecommendTag";
import MusicAlbum from "@/pages/music/Album";
import MusicArtist from "@/pages/music/Artist";
import MusicDownloads from "@/pages/music/Downloads";
import MusicDesktopLyric from "@/pages/music/DesktopLyric";
import BooksHome from "@/pages/books/Home";
import BooksCatalog from "@/pages/books/Catalog";
import BooksSearch from "@/pages/books/Search";
import BooksDetail from "@/pages/books/Detail";
import BooksRead from "@/pages/books/Read";
import BooksShelf from "@/pages/books/Shelf";
import NovelHome from "@/pages/books/NovelHome";
import NovelDetail from "@/pages/books/NovelDetail";
import NovelRead from "@/pages/books/NovelRead";
import MangaHome from "@/pages/manga/Home";
import MangaSearch from "@/pages/manga/Search";
import MangaDetailPage from "@/pages/manga/Detail";
import MangaRead from "@/pages/manga/Read";
import MangaShelf from "@/pages/manga/Shelf";
import MangaSrcHome from "@/pages/manga/MangaSrcHome";
import MangaSrcDetail from "@/pages/manga/MangaSrcDetail";
import MangaSrcRead from "@/pages/manga/MangaSrcRead";
import BottomTabBar from "@/components/BottomTabBar";
import SideNav from "@/components/SideNav";
import MusicMiniPlayer from "@/components/MusicMiniPlayer";
import MusicContextMenuRoot from "@/components/MusicContextMenu";
import MusicQueuePanel from "@/components/MusicQueuePanel";
import MusicCommentsPanel from "@/components/MusicCommentsPanel";
import MusicErrorToast from "@/components/MusicErrorToast";
import WelcomeModal from "@/components/WelcomeModal";
import { useMusicStateBroadcast } from "@/hooks/useMusicStateBroadcast";
import { useConfigSubStore } from "@/stores/configSubscription";
import { useLiveSubStore } from "@/stores/liveSubscription";
import { useLibraryStore } from "@/stores/library";
import { useLiveStore } from "@/stores/live";
import { useProxyStore } from "@/stores/proxy";
import { useNetliveProxyStore } from "@/stores/netliveProxy";
import { useExternalPluginStore } from "@/stores/netliveExternalPlugins";
import { usePluginSubscriptionStore } from "@/stores/netlivePluginSubscription";
import { useMusicStore } from "@/stores/music";
import { useBooksStore } from "@/stores/books";
import { useMangaStore } from "@/stores/manga";
import { startAutoSyncTimer, useSyncStore } from "@/stores/sync";
import { useViewport } from "@/hooks/useViewport";

const HIDE_NAV_PREFIXES = [
  "/play",
  "/detail",
  "/music/player",
  "/music/desktop-lyric",
  "/books/read",
  "/books/novel/read",
  "/manga/read",
  "/manga/src/read",
  "/live/room",
];
const ONBOARDED_KEY = "douytv:onboarded";

export default function App() {
  const location = useLocation();
  const hideNav = HIDE_NAV_PREFIXES.some((p) =>
    location.pathname.startsWith(p)
  );
  const { isDesktop } = useViewport();
  useMusicStateBroadcast();
  // 侧栏宽度 — SideNav 中也读同一个 key，但布局 padding 必须同步知道
  const [sideExpanded, setSideExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem("douytv:sidenav-expanded") !== "0";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    const sync = () => {
      try {
        setSideExpanded(localStorage.getItem("douytv:sidenav-expanded") !== "0");
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("storage", sync);
    // SideNav 内部点击折叠时同一窗口不触发 storage 事件 — 用 setInterval 轮询折中
    const t = window.setInterval(sync, 300);
    return () => {
      window.removeEventListener("storage", sync);
      window.clearInterval(t);
    };
  }, []);

  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(ONBOARDED_KEY)) {
        setShowWelcome(true);
      }
    } catch {
      /* private mode etc */
    }
    void useLibraryStore.getState().hydrate();
    useConfigSubStore.getState().hydrate();
    useLiveStore.getState().hydrate();
    useLiveSubStore.getState().hydrate();
    useLiveSubStore.getState().bootRefresh();
    useExternalPluginStore.getState().hydrate();
    usePluginSubscriptionStore.getState().hydrate();
    usePluginSubscriptionStore.getState().bootRefresh();
    useProxyStore.getState().hydrate();
    useNetliveProxyStore.getState().hydrate();
    void useMusicStore.getState().hydrate();
    void useBooksStore.getState().hydrate();
    void useMangaStore.getState().hydrate();
    useSyncStore.getState().hydrate();
    // Stripchat Mouflon 解扰 key 跨进程不持久化(Rust 端是进程内 jar),
    // 启动时把 localStorage 的 key 一次性同步过去
    void syncStripchatKeys(loadStripchatKeys());
    const stopAutoSync = startAutoSyncTimer();
    return () => {
      stopAutoSync();
    };
  }, []);

  const dismissWelcome = () => {
    try {
      localStorage.setItem(ONBOARDED_KEY, "true");
    } catch {}
    setShowWelcome(false);
  };

  const showSideNav = isDesktop && !hideNav;
  const showBottomBar = !isDesktop && !hideNav;
  const sideNavWidth = showSideNav ? (sideExpanded ? 192 : 56) : 0;
  // Home 自己是 h-screen 全屏 Feed，让 BottomTabBar 浮在上面（视频信息层已自己避让）；
  // 其它列表/设置类页面在移动端要避开底栏 + iOS Home Indicator。
  const isFeedPage = location.pathname === "/";
  // iOS safe-area：
  //   - top：除 Home/Play 等自带绝对定位 + 自管 safe-area 的沉浸页面外，所有页面都
  //     避开状态栏/刘海。hideNav 路由（/play /detail /music/player /books/read 等）
  //     全屏沉浸自己处理，不在这里加 padding。
  //   - left/right：横屏刘海避让。左侧叠加 SideNav 宽度，桌面端不会和 safe-area-inset-left
  //     冲突（桌面 env() 都是 0）。
  const skipTopSafeArea = isFeedPage || hideNav;
  const mainPadTop = skipTopSafeArea ? 0 : "env(safe-area-inset-top)";
  const mainPadLeft = showSideNav
    ? `calc(${sideNavWidth}px + env(safe-area-inset-left))`
    : "env(safe-area-inset-left)";
  const mainPadRight = "env(safe-area-inset-right)";
  // 底部留位：移动端的 BottomTabBar + 全局 MiniPlayer 都需要避让；
  // 桌面端 BottomTabBar 不显，但 MiniPlayer 仍会浮在底部，所以也要保留它的高度。
  // 这两个高度都由各自组件以 CSS 变量暴露：--bottom-tab-h / --miniplayer-h。
  // Home (isFeedPage) 自身是 100vh 沉浸 feed，让底部组件浮在视频上，不在 wrapper 里加 padding。
  const mainPadBottom = isFeedPage
    ? 0
    : showBottomBar
    ? "calc(var(--bottom-tab-h, calc(56px + env(safe-area-inset-bottom))) + var(--miniplayer-h, 0px))"
    : "var(--miniplayer-h, 0px)";

  return (
    <>
      <div
        style={{
          paddingTop: mainPadTop,
          paddingLeft: mainPadLeft,
          paddingRight: mainPadRight,
          paddingBottom: mainPadBottom,
          transition: "padding-left 200ms ease",
          height: "100dvh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/library" element={<Library />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/video-hub" element={<SettingsVideoHub />} />
          <Route path="/settings/live-hub" element={<SettingsLiveHub />} />
          <Route
            path="/settings/stripchat-keys"
            element={<SettingsStripchatKeys />}
          />
          <Route path="/settings/local-scan" element={<SettingsLocalScan />} />
          <Route path="/settings/proxy" element={<SettingsProxy />} />
          <Route path="/settings/danmaku" element={<SettingsDanmaku />} />
          <Route path="/settings/music" element={<SettingsMusic />} />
          <Route path="/settings/books" element={<SettingsBooks />} />
          <Route path="/settings/manga" element={<SettingsManga />} />
          <Route path="/settings/sync" element={<SettingsSync />} />
          <Route path="/settings/updates" element={<SettingsUpdates />} />
          <Route path="/settings/novel" element={<SettingsNovel />} />
          <Route path="/settings/manga-src" element={<SettingsMangaSrc />} />
          <Route path="/scripts" element={<SettingsVideoHub />} />
          <Route path="/search" element={<Search />} />
          <Route path="/live" element={<Live />} />
          <Route
            path="/live/room/:platform/:roomId"
            element={<NetworkRoom />}
          />
          <Route path="/local" element={<Local />} />
          <Route path="/music" element={<MusicHome />} />
          <Route path="/music/search" element={<MusicSearch />} />
          <Route path="/music/library" element={<MusicLibrary />} />
          <Route path="/music/favorites" element={<MusicFavorites />} />
          <Route path="/music/my-playlist/:id" element={<MusicUserPlaylist />} />
          <Route path="/music/history" element={<MusicHistory />} />
          <Route path="/music/recommend" element={<MusicRecommend />} />
          <Route
            path="/music/recommend/:tagId"
            element={<MusicRecommendTag />}
          />
          <Route
            path="/music/playlist/:platform/:id"
            element={<MusicPlaylist />}
          />
          <Route
            path="/music/album/:platform/:id"
            element={<MusicAlbum />}
          />
          <Route
            path="/music/artist/:platform/:id"
            element={<MusicArtist />}
          />
          <Route path="/music/player" element={<MusicPlayer />} />
          <Route path="/music/downloads" element={<MusicDownloads />} />
          <Route path="/music/desktop-lyric" element={<MusicDesktopLyric />} />
          <Route path="/books" element={<BooksHome />} />
          <Route path="/books/shelf" element={<BooksShelf />} />
          <Route path="/books/novel" element={<NovelHome />} />
          <Route
            path="/books/novel/detail/:sourceId/:bookUrl"
            element={<NovelDetail />}
          />
          <Route
            path="/books/novel/read/:bookId/:chapterIndex"
            element={<NovelRead />}
          />
          <Route
            path="/books/catalog/:sourceId"
            element={<BooksCatalog />}
          />
          <Route path="/books/search/:sourceId" element={<BooksSearch />} />
          <Route
            path="/books/detail/:sourceId/:bookId"
            element={<BooksDetail />}
          />
          <Route
            path="/books/read/:sourceId/:bookId"
            element={<BooksRead />}
          />
          <Route path="/manga" element={<MangaHome />} />
          <Route path="/manga/shelf" element={<MangaShelf />} />
          <Route path="/manga/search" element={<MangaSearch />} />
          <Route path="/manga/src" element={<MangaSrcHome />} />
          <Route
            path="/manga/src/detail/:sourceId/:mangaUrl"
            element={<MangaSrcDetail />}
          />
          <Route
            path="/manga/src/read/:mangaId/:chapterIndex"
            element={<MangaSrcRead />}
          />
          <Route
            path="/manga/detail/:sourceId/:mangaId"
            element={<MangaDetailPage />}
          />
          <Route
            path="/manga/read/:sourceId/:mangaId/:chapterId"
            element={<MangaRead />}
          />
          <Route path="/detail/:scriptKey/:vodId" element={<Detail />} />
          <Route
            path="/play/:scriptKey/:vodId/:playbackIdx/:epIdx"
            element={<Play />}
          />
        </Routes>
      </div>
      {showSideNav && <SideNav />}
      {showBottomBar && <BottomTabBar />}
      <MusicMiniPlayer />
      <MusicContextMenuRoot />
      <MusicQueuePanel />
      <MusicCommentsPanel />
      <MusicErrorToast />
      {showWelcome && <WelcomeModal onDismiss={dismissWelcome} />}
    </>
  );
}
