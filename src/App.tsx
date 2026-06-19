import { useEffect, useState } from "react";
import { Route, Routes, useLocation, type Location } from "react-router-dom";
import Home from "@/pages/Home";
import Library from "@/pages/Library";
import Search from "@/pages/Search";
import Browse from "@/pages/Browse";
import Douban from "@/pages/Douban";
import Duanju from "@/pages/Duanju";
import Detail from "@/pages/Detail";
import Play from "@/pages/Play";
import Live from "@/pages/Live";
import NetworkRoom from "@/pages/live/NetworkRoom";
import Local from "@/pages/Local";
import Music from "@/pages/Music";
import { DesktopLyric } from "@/pages/music/DesktopLyric";
import Settings from "@/pages/Settings";
import SettingsLocalScan from "@/pages/settings/LocalScan";
import SettingsProxy from "@/pages/settings/Proxy";
import SettingsDanmaku from "@/pages/settings/Danmaku";
import SettingsSync from "@/pages/settings/Sync";
import SettingsUpdates from "@/pages/settings/Updates";
import SettingsVideoHub from "@/pages/settings/VideoSourcesHub";
import SettingsLiveHub from "@/pages/settings/LiveSourcesHub";
import SettingsMusicHub from "@/pages/settings/MusicSourcesHub";
import SettingsStripchatKeys, {
  loadKeysFromStorage as loadStripchatKeys,
  syncKeysToRust as syncStripchatKeys,
} from "@/pages/settings/StripchatKeys";
import BottomTabBar from "@/components/BottomTabBar";
import SideNav from "@/components/SideNav";
import WelcomeModal from "@/components/WelcomeModal";
import { AppDialogProvider } from "@/components/AppDialog";
import { useConfigSubStore } from "@/stores/configSubscription";
import { useLiveSubStore } from "@/stores/liveSubscription";
import { useLibraryStore } from "@/stores/library";
import { useLiveStore } from "@/stores/live";
import { useProxyStore } from "@/stores/proxy";
import { useNetliveProxyStore } from "@/stores/netliveProxy";
import { useExternalPluginStore } from "@/stores/netliveExternalPlugins";
import { usePluginSubscriptionStore } from "@/stores/netlivePluginSubscription";
import { useMusicStore } from "@/stores/music";
import { startAutoSyncTimer, useSyncStore } from "@/stores/sync";
import { useViewport } from "@/hooks/useViewport";

const HIDE_NAV_PREFIXES = ["/play", "/detail", "/live/room", "/music/player"];
const ONBOARDED_KEY = "douytv:onboarded";

interface RouteState {
  backgroundLocation?: Location;
}

export default function App() {
  const location = useLocation();
  const routeState = location.state as RouteState | null;
  const backgroundLocation = routeState?.backgroundLocation;
  const routeLocation = backgroundLocation ?? location;
  const hideNav = HIDE_NAV_PREFIXES.some((p) =>
    location.pathname.startsWith(p)
  );
  const layoutHideNav = HIDE_NAV_PREFIXES.some((p) =>
    routeLocation.pathname.startsWith(p)
  );
  const { isDesktop } = useViewport();
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
    useMusicStore.getState().hydrate();
    useProxyStore.getState().hydrate();
    useNetliveProxyStore.getState().hydrate();
    useSyncStore.getState().hydrate();
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
  const reserveSideNavSpace = isDesktop && !layoutHideNav;
  const reserveBottomBarSpace = !isDesktop && !layoutHideNav;
  const sideNavWidth = reserveSideNavSpace ? (sideExpanded ? 192 : 56) : 0;
  const isFeedPage = routeLocation.pathname === "/";
  const skipTopSafeArea = isFeedPage || layoutHideNav;
  const mainPadTop = skipTopSafeArea ? 0 : "env(safe-area-inset-top)";
  const mainPadLeft = showSideNav
    ? `calc(${sideNavWidth}px + env(safe-area-inset-left))`
    : "env(safe-area-inset-left)";
  const mainPadRight = "env(safe-area-inset-right)";
  const mainPadBottom = isFeedPage
    ? 0
    : reserveBottomBarSpace
      ? "var(--bottom-tab-h, calc(56px + env(safe-area-inset-bottom)))"
      : 0;
  const hasOverlayLiveRoom =
    !!backgroundLocation && location.pathname.startsWith("/live/room/");

  // 桌面歌词独立窗口：完全脱离主布局/导航，只渲染歌词层（透明背景）。
  if (location.pathname === "/music/desktop-lyric") {
    return <DesktopLyric />;
  }

  return (
    <AppDialogProvider>
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
        <Routes location={routeLocation}>
          <Route path="/" element={<Home feedPaused={hasOverlayLiveRoom} />} />
          <Route path="/library" element={<Library />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/video-hub" element={<SettingsVideoHub />} />
          <Route path="/settings/live-hub" element={<SettingsLiveHub />} />
          <Route path="/settings/music-hub" element={<SettingsMusicHub />} />
          <Route
            path="/settings/stripchat-keys"
            element={<SettingsStripchatKeys />}
          />
          <Route path="/settings/local-scan" element={<SettingsLocalScan />} />
          <Route path="/settings/proxy" element={<SettingsProxy />} />
          <Route path="/settings/danmaku" element={<SettingsDanmaku />} />
          <Route path="/settings/sync" element={<SettingsSync />} />
          <Route path="/settings/updates" element={<SettingsUpdates />} />
          <Route path="/scripts" element={<SettingsVideoHub />} />
          <Route path="/search" element={<Search />} />
          <Route path="/douban" element={<Douban />} />
          <Route path="/duanju" element={<Duanju />} />
          <Route path="/browse/:key" element={<Browse />} />
          <Route path="/live" element={<Live />} />
          <Route path="/music/*" element={<Music />} />
          <Route
            path="/live/room/:platform/:roomId"
            element={<NetworkRoom />}
          />
          <Route path="/local" element={<Local />} />
          <Route path="/detail/:scriptKey/:vodId" element={<Detail />} />
          <Route
            path="/play/:scriptKey/:vodId/:playbackIdx/:epIdx"
            element={<Play />}
          />
        </Routes>
      </div>
      {hasOverlayLiveRoom && (
        <div className="fixed inset-0 z-50 bg-ink">
          <Routes>
            <Route
              path="/live/room/:platform/:roomId"
              element={<NetworkRoom />}
            />
          </Routes>
        </div>
      )}
      {showSideNav && <SideNav />}
      {showBottomBar && <BottomTabBar />}
      {showWelcome && <WelcomeModal onDismiss={dismissWelcome} />}
    </AppDialogProvider>
  );
}
