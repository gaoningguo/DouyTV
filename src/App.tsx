import { useEffect, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import Home from "@/pages/Home";
import Library from "@/pages/Library";
import Scripts from "@/pages/Scripts";
import Search from "@/pages/Search";
import Detail from "@/pages/Detail";
import Play from "@/pages/Play";
import Live from "@/pages/Live";
import Local from "@/pages/Local";
import Settings from "@/pages/Settings";
import SettingsLiveSubs from "@/pages/settings/LiveSubs";
import SettingsLiveEpg from "@/pages/settings/LiveEpg";
import SettingsLiveAdd from "@/pages/settings/LiveAdd";
import SettingsLiveImport from "@/pages/settings/LiveImport";
import SettingsLocalScan from "@/pages/settings/LocalScan";
import SettingsProxy from "@/pages/settings/Proxy";
import BottomTabBar from "@/components/BottomTabBar";
import SideNav from "@/components/SideNav";
import WelcomeModal from "@/components/WelcomeModal";
import { useConfigSubStore } from "@/stores/configSubscription";
import { useLiveSubStore } from "@/stores/liveSubscription";
import { useLibraryStore } from "@/stores/library";
import { useLiveStore } from "@/stores/live";
import { useProxyStore } from "@/stores/proxy";
import { useViewport } from "@/hooks/useViewport";

const HIDE_NAV_PREFIXES = ["/play", "/detail"];
const ONBOARDED_KEY = "douytv:onboarded";

export default function App() {
  const location = useLocation();
  const hideNav = HIDE_NAV_PREFIXES.some((p) =>
    location.pathname.startsWith(p)
  );
  const { isDesktop } = useViewport();
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
    useProxyStore.getState().hydrate();
  }, []);

  const dismissWelcome = () => {
    try {
      localStorage.setItem(ONBOARDED_KEY, "true");
    } catch {}
    setShowWelcome(false);
  };

  const showSideNav = isDesktop && !hideNav;
  const showBottomBar = !isDesktop && !hideNav;
  const mainPadLeft = showSideNav ? (sideExpanded ? 192 : 56) : 0;

  return (
    <>
      <div
        style={{
          paddingLeft: mainPadLeft,
          transition: "padding-left 200ms ease",
          minHeight: "100vh",
        }}
      >
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/library" element={<Library />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/live-subs" element={<SettingsLiveSubs />} />
          <Route path="/settings/live-epg" element={<SettingsLiveEpg />} />
          <Route path="/settings/live-add" element={<SettingsLiveAdd />} />
          <Route path="/settings/live-import" element={<SettingsLiveImport />} />
          <Route path="/settings/local-scan" element={<SettingsLocalScan />} />
          <Route path="/settings/proxy" element={<SettingsProxy />} />
          <Route path="/scripts" element={<Scripts />} />
          <Route path="/search" element={<Search />} />
          <Route path="/live" element={<Live />} />
          <Route path="/local" element={<Local />} />
          <Route path="/detail/:scriptKey/:vodId" element={<Detail />} />
          <Route
            path="/play/:scriptKey/:vodId/:playbackIdx/:epIdx"
            element={<Play />}
          />
        </Routes>
      </div>
      {showSideNav && <SideNav />}
      {showBottomBar && <BottomTabBar />}
      {showWelcome && <WelcomeModal onDismiss={dismissWelcome} />}
    </>
  );
}
