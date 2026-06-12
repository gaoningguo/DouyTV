import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import {
  IconHome,
  IconSearch,
  IconLive,
  IconAlbum,
  IconLibrary,
  IconSettings,
} from "@/components/Icon";

// 顺序与 PC SideNav 一致，窄屏仍允许横向滚动。
const TABS = [
  { to: "/", Icon: IconHome, label: "首页", end: true },
  { to: "/search", Icon: IconSearch, label: "点播", end: false },
  { to: "/live", Icon: IconLive, label: "直播", end: false },
  { to: "/music", Icon: IconAlbum, label: "音乐", end: false },
  { to: "/library", Icon: IconLibrary, label: "我的", end: false },
  { to: "/settings", Icon: IconSettings, label: "设置", end: false },
];

export default function BottomTabBar() {
  // 把底栏总高度同步成 CSS var，供沉浸页和浮层布局避让。
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
      {/* 横向可滚 —— 8 个 tab 在窄屏一定溢出，必须能滑 */}
      <div
        className="h-full flex items-stretch overflow-x-auto scrollbar-hide relative"
        style={{ scrollSnapType: "x proximity" }}
      >
        {TABS.map(({ to, Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className="relative flex-shrink-0 flex flex-col items-center justify-center gap-0.5 tap text-cream-faint hover:text-cream-dim transition-colors px-2"
            style={{ minWidth: 64, scrollSnapAlign: "start" }}
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
      {/* 右侧渐变 fade —— 视觉提示"右边还有更多" */}
      <span
        aria-hidden
        className="pointer-events-none absolute top-0 right-0 h-full w-8"
        style={{
          background:
            "linear-gradient(to left, rgba(14,15,17,0.95), transparent)",
          // 让 fade 不盖住 safe-area-inset-right（横屏刘海）
          marginRight: "env(safe-area-inset-right)",
        }}
      />
    </nav>
  );
}
