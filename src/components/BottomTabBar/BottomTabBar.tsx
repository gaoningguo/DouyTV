import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import {
  IconHome,
  IconSearch,
  IconMusic,
  IconBook,
  IconManga,
  IconLibrary,
} from "@/components/Icon";

const TABS = [
  { to: "/", Icon: IconHome, label: "首页", end: true },
  { to: "/search", Icon: IconSearch, label: "点播", end: false },
  { to: "/music", Icon: IconMusic, label: "音乐", end: false },
  { to: "/books", Icon: IconBook, label: "电子书", end: false },
  { to: "/manga", Icon: IconManga, label: "漫画", end: false },
  { to: "/library", Icon: IconLibrary, label: "我的", end: false },
];

export default function BottomTabBar() {
  // 把底栏总高度同步成 CSS var，让 MusicMiniPlayer 等浮层能正确避让，
  // 否则 MiniPlayer 会落在 bottom:0 把底栏盖住（user-reported bug）。
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--bottom-tab-h",
      "calc(56px + env(safe-area-inset-bottom))"
    );
    return () => {
      document.documentElement.style.removeProperty("--bottom-tab-h");
    };
  }, []);

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-30 backdrop-blur-xl"
      style={{
        // 总高度 = 内容 56px + iOS Home Indicator safe-area
        height: "calc(56px + env(safe-area-inset-bottom))",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
        background:
          "linear-gradient(180deg, rgba(14,15,17,0.6) 0%, rgba(14,15,17,0.92) 100%)",
        borderTop: "1px solid var(--cream-line)",
      }}
    >
      {/* 横向可滚 —— 窄屏 / tab 增多时右侧 tab 仍可滑到 + 点击 */}
      <div
        className="h-full flex items-stretch overflow-x-auto scrollbar-hide"
        style={{ scrollSnapType: "x proximity" }}
      >
        {TABS.map(({ to, Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className="relative flex-shrink-0 flex flex-col items-center justify-center gap-0.5 tap text-cream-faint hover:text-cream-dim transition-colors px-2"
            style={{ minWidth: 72, scrollSnapAlign: "start" }}
          >
            {({ isActive }) => (
              <>
                {/* 顶部 active 指示线 */}
                <span
                  aria-hidden
                  className={`absolute top-0 left-1/2 -translate-x-1/2 h-[2px] rounded-full transition-all ${
                    isActive ? "w-8 bg-ember" : "w-0 bg-transparent"
                  }`}
                  style={
                    isActive
                      ? { boxShadow: "0 0 8px var(--ember-glow)" }
                      : undefined
                  }
                />
                <Icon
                  size={20}
                  style={{
                    color: isActive ? "var(--ember)" : undefined,
                    strokeWidth: isActive ? 2 : 1.6,
                  }}
                />
                <span
                  className={`text-[10px] tracking-wider transition-colors ${
                    isActive ? "text-ember font-semibold" : ""
                  }`}
                  style={{
                    fontFeatureSettings: '"ss01"',
                  }}
                >
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
