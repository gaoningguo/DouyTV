/**
 * 直播管理 Hub —— 把「频道」「M3U 订阅」「EPG 节目单」「添加单频道」「导入 M3U 文本」
 * 5 个入口合并到一个 tab 容器。
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveStore } from "@/stores/live";
import { useLiveSubStore } from "@/stores/liveSubscription";
import { useEpgStore } from "@/stores/epg";
import { SettingsSubPageLayout } from "./Layout";
import {
  IconLive,
  IconAntenna,
  IconCalendar,
  IconPlus,
  IconDownload,
  IconChevronRight,
} from "@/components/Icon";

type Tab = "channels" | "subs" | "epg" | "add" | "import";

const TAB_KEY = "douytv:live-hub-tab";

function readTab(): Tab {
  try {
    const v = localStorage.getItem(TAB_KEY);
    if (v === "subs" || v === "epg" || v === "add" || v === "import") return v;
  } catch {}
  return "channels";
}

export default function LiveSourcesHub() {
  const [tab, setTab] = useState<Tab>(readTab);
  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {}
  }, [tab]);

  const channels = useLiveStore((s) => s.channels);
  const hydrateLive = useLiveStore((s) => s.hydrate);
  const subscriptions = useLiveSubStore((s) => s.subscriptions);
  const hydrateSubs = useLiveSubStore((s) => s.hydrate);
  const epgUrl = useEpgStore((s) => s.url);
  const programmes = useEpgStore((s) => s.programmes);
  const epgUpdatedAt = useEpgStore((s) => s.updatedAt);
  const hydrateEpg = useEpgStore((s) => s.hydrate);

  useEffect(() => {
    hydrateLive();
    hydrateSubs();
    hydrateEpg();
  }, [hydrateLive, hydrateSubs, hydrateEpg]);

  const formattedEpgTs = epgUpdatedAt
    ? new Date(epgUpdatedAt).toLocaleString()
    : undefined;
  const epgChannelCount = Object.keys(programmes).length;

  return (
    <SettingsSubPageLayout eyebrow="LIVE · MANAGEMENT" title="直播管理">
      <div
        className="grid grid-cols-5 gap-1 mb-4 p-1 rounded-lg"
        style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
      >
        <TabBtn active={tab === "channels"} onClick={() => setTab("channels")}>
          频道
        </TabBtn>
        <TabBtn active={tab === "subs"} onClick={() => setTab("subs")}>
          订阅
        </TabBtn>
        <TabBtn active={tab === "epg"} onClick={() => setTab("epg")}>
          EPG
        </TabBtn>
        <TabBtn active={tab === "add"} onClick={() => setTab("add")}>
          添加
        </TabBtn>
        <TabBtn active={tab === "import"} onClick={() => setTab("import")}>
          导入
        </TabBtn>
      </div>

      {tab === "channels" && (
        <StatusCard
          Icon={IconLive}
          title="直播频道"
          rows={[
            ["总数", `${channels.length} 频道`],
            ["来源", "订阅 + 手动添加 + 导入聚合"],
          ]}
          to="/live"
          ctaLabel="打开直播 IPTV"
          accent="ember"
          hint="频道按订阅组分类，支持搜索、播放、收藏。"
        />
      )}

      {tab === "subs" && (
        <StatusCard
          Icon={IconAntenna}
          title="M3U 订阅源"
          rows={[
            ["订阅数", `${subscriptions.length} 个`],
            [
              "自动刷新",
              `${subscriptions.filter((s) => s.autoRefresh).length} 启用`,
            ],
          ]}
          to="/settings/live-subs"
          ctaLabel="管理订阅"
          accent="vhs"
          hint="订阅 URL 会定期重新拉取（24h），多个订阅聚合到「频道」总表。"
        />
      )}

      {tab === "epg" && (
        <StatusCard
          Icon={IconCalendar}
          title="EPG 节目单"
          rows={[
            ["状态", epgUrl ? "已订阅" : "未订阅"],
            ["EPG URL", epgUrl || "—"],
            ["频道节目数", `${epgChannelCount}`],
            ["上次刷新", formattedEpgTs || "—"],
          ]}
          to="/settings/live-epg"
          ctaLabel={epgUrl ? "管理 EPG" : "添加 EPG"}
          accent="phosphor"
          hint="XMLTV 节目单，给直播频道附加节目预告。"
        />
      )}

      {tab === "add" && (
        <StatusCard
          Icon={IconPlus}
          title="添加单个频道"
          rows={[["用途", "手动添加一个 m3u8 / HLS 直播流"]]}
          to="/settings/live-add"
          ctaLabel="添加"
          accent="vhs"
          hint="适合临时加一两个不在订阅里的频道。"
        />
      )}

      {tab === "import" && (
        <StatusCard
          Icon={IconDownload}
          title="导入 M3U 文本"
          rows={[["用途", "粘贴 M3U / M3U8 文本批量导入频道"]]}
          to="/settings/live-import"
          ctaLabel="打开导入面板"
          accent="phosphor"
          hint="跟订阅不同：导入只在那一刻拉一次，之后不会刷新。"
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
      className="px-2 py-1.5 rounded text-xs font-display font-semibold tap transition-colors"
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
            className="flex items-baseline justify-between text-xs gap-3"
          >
            <dt className="font-mono text-[10px] tracking-wider text-cream-faint shrink-0">
              {k}
            </dt>
            <dd className="text-cream-dim line-clamp-1 min-w-0 text-right">{v}</dd>
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
