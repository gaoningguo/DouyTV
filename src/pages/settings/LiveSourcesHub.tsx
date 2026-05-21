/**
 * 直播管理 Hub —— 把「频道」「M3U 订阅」「EPG 节目单」「添加单频道」「导入 M3U 文本」
 * + 「网络直播」（18+ 开关）6 个入口合并到一个 tab 容器。
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveStore } from "@/stores/live";
import { useLiveSubStore } from "@/stores/liveSubscription";
import { useEpgStore } from "@/stores/epg";
import { useNetLiveStore } from "@/stores/netlive";
import { NETLIVE_PLATFORMS } from "@/lib/netlive/types";
import { SettingsSubPageLayout } from "./Layout";
import {
  IconLive,
  IconAntenna,
  IconCalendar,
  IconPlus,
  IconDownload,
  IconChevronRight,
} from "@/components/Icon";

type Tab = "channels" | "subs" | "epg" | "add" | "import" | "netlive";

const TAB_KEY = "douytv:live-hub-tab";

function readTab(): Tab {
  try {
    const v = localStorage.getItem(TAB_KEY);
    if (
      v === "subs" ||
      v === "epg" ||
      v === "add" ||
      v === "import" ||
      v === "netlive"
    )
      return v;
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
  const adultEnabled = useNetLiveStore((s) => s.adultEnabled);
  const setAdultEnabled = useNetLiveStore((s) => s.setAdultEnabled);
  const hydrateNetLive = useNetLiveStore((s) => s.hydrate);

  useEffect(() => {
    hydrateLive();
    hydrateSubs();
    hydrateEpg();
    hydrateNetLive();
  }, [hydrateLive, hydrateSubs, hydrateEpg, hydrateNetLive]);

  const formattedEpgTs = epgUpdatedAt
    ? new Date(epgUpdatedAt).toLocaleString()
    : undefined;
  const epgChannelCount = Object.keys(programmes).length;
  const netlivePlatforms = NETLIVE_PLATFORMS.filter((p) => !p.adult);
  const adultPlatforms = NETLIVE_PLATFORMS.filter((p) => p.adult);

  return (
    <SettingsSubPageLayout eyebrow="LIVE · MANAGEMENT" title="直播管理">
      <div
        className="grid grid-cols-6 gap-1 mb-4 p-1 rounded-lg"
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
        <TabBtn active={tab === "netlive"} onClick={() => setTab("netlive")}>
          网络
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

      {tab === "netlive" && (
        <div className="space-y-4">
          <div
            className="rounded-xl p-4"
            style={{
              background: "var(--ink-2)",
              border: "1px solid var(--cream-line)",
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{
                  background: "rgba(255,107,53,0.06)",
                  color: "var(--ember)",
                }}
              >
                <IconAntenna size={20} />
              </div>
              <h2 className="font-display text-base font-semibold">
                网络直播平台
              </h2>
            </div>
            <p className="text-[11px] text-cream-faint leading-relaxed mb-3">
              内置 {netlivePlatforms.length} 个直播平台 adapter（B站 / 斗鱼 / 虎牙 /
              抖音 / 快手 / CC / Twitch / YouTube Live）。
              在 <code className="text-ember">/live</code> 页面的「网络直播」tab 切换平台。
            </p>
            <div className="flex flex-wrap gap-1.5">
              {netlivePlatforms.map((p) => (
                <span
                  key={p.id}
                  className="text-[10px] font-mono px-2 py-0.5 rounded"
                  style={{
                    background: "var(--ink-3)",
                    color: "var(--cream-dim)",
                    border: "1px solid var(--cream-line)",
                  }}
                >
                  {p.label}
                </span>
              ))}
            </div>
          </div>

          <div
            className="rounded-xl p-4"
            style={{
              background: adultEnabled ? "rgba(255,80,80,0.06)" : "var(--ink-2)",
              border: `1px solid ${
                adultEnabled ? "rgba(255,80,80,0.3)" : "var(--cream-line)"
              }`,
            }}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h2 className="font-display text-base font-semibold flex items-center gap-2">
                  成人内容（18+）
                  <span
                    className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                    style={{
                      background: "rgba(255,80,80,0.18)",
                      color: "#FF6B6B",
                    }}
                  >
                    NSFW
                  </span>
                </h2>
                <p className="text-[11px] text-cream-faint mt-1">
                  开启后会在 /live 网络直播 tab 显示 {adultPlatforms.length} 个成人直播平台。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAdultEnabled(!adultEnabled)}
                className="px-3 py-1.5 rounded font-mono text-[11px] font-semibold tap shrink-0"
                style={{
                  background: adultEnabled
                    ? "var(--ember)"
                    : "var(--ink-3)",
                  color: adultEnabled ? "var(--ink)" : "var(--cream-dim)",
                  border: "1px solid var(--cream-line)",
                }}
              >
                {adultEnabled ? "已开启" : "关闭"}
              </button>
            </div>

            {adultEnabled && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {adultPlatforms.map((p) => (
                  <span
                    key={p.id}
                    className="text-[10px] font-mono px-2 py-0.5 rounded"
                    style={{
                      background: "rgba(255,80,80,0.12)",
                      color: "#FF6B6B",
                      border: "1px solid rgba(255,80,80,0.3)",
                    }}
                  >
                    {p.label}
                  </span>
                ))}
              </div>
            )}

            <p className="text-[10px] text-cream-faint leading-relaxed">
              <strong className="text-cream-dim">⚠ 提示：</strong>
              成人内容平台仅供 18 岁及以上、所在地区法律允许浏览成人内容的用户使用。
              内容由第三方平台提供，DouyTV 不存储、不审核任何成人内容。
              在公共 / 共享设备上请保持关闭。
            </p>
            <p className="text-[10px] text-cream-faint leading-relaxed mt-2">
              <strong className="text-cream-dim">寻找更多：</strong>
              内置 Chaturbate / Stripchat 两个公开 API 站点。其他公开 API 站点
              （如 BongaCams / CamSoda / MFC）可仿照 <code className="text-ember">
                src/lib/netlive/platforms/chaturbate.ts
              </code> 模式自行新增 adapter。
            </p>
          </div>
        </div>
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
