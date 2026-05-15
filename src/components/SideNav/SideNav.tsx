import { NavLink, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  IconHome,
  IconSearch,
  IconLive,
  IconLibrary,
  IconSettings,
  IconChevronRight,
} from "@/components/Icon";

const NAV_TABS = [
  { to: "/", Icon: IconHome, label: "首页", end: true },
  { to: "/search", Icon: IconSearch, label: "搜索", end: false },
  { to: "/live", Icon: IconLive, label: "直播", end: false },
  { to: "/library", Icon: IconLibrary, label: "我的", end: false },
  { to: "/settings", Icon: IconSettings, label: "设置", end: false },
];

const STORAGE_KEY = "douytv:sidenav-expanded";

/**
 * PC 侧边导航 — 可收缩（图标 only 56px / 展开 192px）。
 * 折叠状态持久化到 localStorage。
 */
export default function SideNav() {
  const [expanded, setExpanded] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const location = useLocation();

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, expanded ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [expanded]);

  const width = expanded ? 192 : 56;

  return (
    <aside
      className="fixed top-0 left-0 bottom-0 z-30 flex flex-col transition-[width] duration-200 backdrop-blur-xl"
      style={{
        width,
        background: "linear-gradient(180deg, rgba(14,15,17,0.95) 0%, rgba(14,15,17,0.92) 100%)",
        borderRight: "1px solid var(--cream-line)",
      }}
    >
      {/* Logo */}
      <div
        className="h-14 flex items-center px-4 shrink-0"
        style={{ borderBottom: "1px solid var(--cream-line)" }}
      >
        <span
          className="font-display font-extrabold tracking-tight text-cream"
          style={{ fontSize: expanded ? 18 : 16 }}
        >
          {expanded ? (
            <>
              DOUY<span style={{ color: "var(--ember)" }}>TV</span>
            </>
          ) : (
            <span style={{ color: "var(--ember)" }}>Y</span>
          )}
        </span>
        {expanded && (
          <span className="rec-dot ml-auto" style={{ marginRight: 0 }} />
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto py-3">
        {NAV_TABS.map(({ to, Icon, label, end }) => {
          const isActive =
            end ? location.pathname === to : location.pathname.startsWith(to);
          return (
            <NavLink
              key={to}
              to={to}
              end={end}
              className="flex items-center gap-3 mx-2 mb-1 px-3 py-2.5 rounded-lg tap transition-colors relative"
              style={{
                background: isActive ? "var(--ember-soft)" : "transparent",
                color: isActive ? "var(--ember)" : "var(--cream-dim)",
              }}
              title={!expanded ? label : undefined}
            >
              {isActive && (
                <span
                  aria-hidden
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full"
                  style={{
                    background: "var(--ember)",
                    boxShadow: "0 0 8px var(--ember-glow)",
                  }}
                />
              )}
              <Icon
                size={20}
                style={{ strokeWidth: isActive ? 2 : 1.6, flexShrink: 0 }}
              />
              {expanded && (
                <span
                  className={`text-sm font-display ${
                    isActive ? "font-semibold" : ""
                  }`}
                >
                  {label}
                </span>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        className="h-12 flex items-center justify-center tap text-cream-faint hover:text-cream"
        style={{ borderTop: "1px solid var(--cream-line)" }}
        title={expanded ? "收起侧栏" : "展开侧栏"}
      >
        <IconChevronRight
          size={16}
          className="transition-transform"
          style={{ transform: expanded ? "rotate(180deg)" : "rotate(0)" }}
        />
        {expanded && (
          <span className="ml-2 text-[10px] font-mono tracking-wider">
            COLLAPSE
          </span>
        )}
      </button>
    </aside>
  );
}
