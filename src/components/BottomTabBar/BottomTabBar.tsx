import { NavLink } from "react-router-dom";
import {
  IconHome,
  IconSearch,
  IconLive,
  IconLibrary,
  IconSettings,
} from "@/components/Icon";

const TABS = [
  { to: "/", Icon: IconHome, label: "首页", end: true },
  { to: "/search", Icon: IconSearch, label: "搜索", end: false },
  { to: "/live", Icon: IconLive, label: "直播", end: false },
  { to: "/library", Icon: IconLibrary, label: "我的", end: false },
  { to: "/settings", Icon: IconSettings, label: "设置", end: false },
];

export default function BottomTabBar() {
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-30 h-14 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl"
      style={{
        background:
          "linear-gradient(180deg, rgba(14,15,17,0.6) 0%, rgba(14,15,17,0.92) 100%)",
        borderTop: "1px solid var(--cream-line)",
      }}
    >
      <div className="h-full flex items-stretch justify-around">
        {TABS.map(({ to, Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className="relative flex-1 flex flex-col items-center justify-center gap-0.5 tap text-cream-faint hover:text-cream-dim transition-colors"
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
