/**
 * 视频管理 Hub —— 把「视频源」「视频源订阅」「本地视频」合并到一个入口下的 tab。
 *
 * 设计：tab 切换三个状态卡片，每个卡片显示当前状态摘要 + 「打开管理」按钮跳转
 *      原有独立路由（/scripts / /scripts?dialog=config / /settings/local-scan）。
 *      不破坏现有页面结构，只是 Settings 顶层入口收敛到 1 个。
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useScriptStore } from "@/stores/scripts";
import { useConfigSubStore } from "@/stores/configSubscription";
import { SettingsSubPageLayout } from "./Layout";
import {
  IconScript,
  IconAntenna,
  IconLocal,
  IconChevronRight,
} from "@/components/Icon";

type Tab = "scripts" | "config-sub" | "local";

const TAB_KEY = "douytv:video-hub-tab";

function readTab(): Tab {
  try {
    const v = localStorage.getItem(TAB_KEY);
    if (v === "config-sub" || v === "local") return v;
  } catch {}
  return "scripts";
}

export default function VideoSourcesHub() {
  const [tab, setTab] = useState<Tab>(readTab);
  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {}
  }, [tab]);

  const scripts = useScriptStore((s) => s.scripts);
  const hydrateScripts = useScriptStore((s) => s.hydrate);
  const configSubUrl = useConfigSubStore((s) => s.url);
  const configSubUpdatedAt = useConfigSubStore((s) => s.updatedAt);
  const hydrateConfigSub = useConfigSubStore((s) => s.hydrate);

  useEffect(() => {
    hydrateScripts();
    hydrateConfigSub();
  }, [hydrateScripts, hydrateConfigSub]);

  const enabledCount = useMemo(
    () => scripts.filter((s) => s.enabled).length,
    [scripts]
  );
  const cmsCount = useMemo(
    () => scripts.filter((s) => s.type === "cms").length,
    [scripts]
  );
  const scriptCount = scripts.length - cmsCount;

  const formattedSubTs = configSubUpdatedAt
    ? new Date(configSubUpdatedAt).toLocaleString()
    : undefined;

  return (
    <SettingsSubPageLayout eyebrow="VIDEO · MANAGEMENT" title="视频管理">
      {/* tab 切换 */}
      <div
        className="grid grid-cols-3 gap-1 mb-4 p-1 rounded-lg"
        style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
      >
        <TabBtn active={tab === "scripts"} onClick={() => setTab("scripts")}>
          视频源
        </TabBtn>
        <TabBtn active={tab === "config-sub"} onClick={() => setTab("config-sub")}>
          订阅
        </TabBtn>
        <TabBtn active={tab === "local"} onClick={() => setTab("local")}>
          本地视频
        </TabBtn>
      </div>

      {tab === "scripts" && (
        <StatusCard
          Icon={IconScript}
          title="视频源（脚本 / CMS）"
          rows={[
            ["总数", `${scripts.length} 个`],
            ["启用", `${enabledCount} 个`],
            ["脚本类型", `${scriptCount} 脚本 · ${cmsCount} CMS`],
          ]}
          to="/scripts"
          ctaLabel="打开视频源管理"
          accent="ember"
        />
      )}

      {tab === "config-sub" && (
        <StatusCard
          Icon={IconAntenna}
          title="视频源订阅"
          rows={[
            ["状态", configSubUrl ? "已订阅" : "未订阅"],
            ["URL", configSubUrl || "—"],
            ["上次刷新", formattedSubTs || "—"],
          ]}
          to="/scripts?dialog=config"
          ctaLabel={configSubUrl ? "管理订阅" : "添加订阅"}
          accent="vhs"
          hint="订阅是 MoonTV 兼容的远程配置（含 api_site / lives 等），24h 自动刷新。"
        />
      )}

      {tab === "local" && (
        <StatusCard
          Icon={IconLocal}
          title="本地视频"
          rows={[["用途", "扫描本地目录中的视频文件，离线播放"]]}
          to="/settings/local-scan"
          ctaLabel="选择目录并扫描"
          accent="phosphor"
          hint="支持 mp4 / mkv / webm / mov / flv 等常见格式。"
        />
      )}
    </SettingsSubPageLayout>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 rounded text-xs font-display font-semibold tap transition-colors"
      style={{
        background: active ? "var(--ember)" : "transparent",
        color: active ? "var(--ink)" : "var(--cream-dim)",
      }}
    >
      {children}
    </button>
  );
}

type AccentName = "ember" | "vhs" | "phosphor";
const ACCENT_COLOR: Record<AccentName, string> = {
  ember: "var(--ember)",
  vhs: "var(--vhs)",
  phosphor: "var(--phosphor)",
};

function StatusCard({
  Icon,
  title,
  rows,
  to,
  ctaLabel,
  accent,
  hint,
}: {
  Icon: (p: { size?: number; className?: string }) => React.ReactElement;
  title: string;
  rows: [string, string][];
  to: string;
  ctaLabel: string;
  accent: AccentName;
  hint?: string;
}) {
  const color = ACCENT_COLOR[accent];
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
    >
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center"
          style={{ background: "rgba(255,107,53,0.06)", color }}
        >
          <Icon size={20} />
        </div>
        <h2 className="font-display text-base font-semibold">{title}</h2>
      </div>
      <dl className="space-y-1.5 mb-4">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="flex items-baseline justify-between text-xs"
          >
            <dt className="font-mono text-[10px] tracking-wider text-cream-faint">
              {k}
            </dt>
            <dd className="text-cream-dim line-clamp-1 ml-3 min-w-0">{v}</dd>
          </div>
        ))}
      </dl>
      {hint && (
        <p className="text-[11px] text-cream-faint leading-relaxed mb-3">
          {hint}
        </p>
      )}
      <Link
        to={to}
        className="flex items-center justify-between px-3 py-2.5 rounded-lg tap"
        style={{
          background: color,
          color: "var(--ink)",
          fontWeight: 600,
        }}
      >
        <span className="text-sm">{ctaLabel}</span>
        <IconChevronRight size={16} />
      </Link>
    </div>
  );
}
