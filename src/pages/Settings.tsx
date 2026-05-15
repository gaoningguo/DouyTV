import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useScriptStore } from "@/stores/scripts";
import { useLiveStore } from "@/stores/live";
import { useLiveSubStore } from "@/stores/liveSubscription";
import { useEpgStore } from "@/stores/epg";
import { useConfigSubStore } from "@/stores/configSubscription";
import { useLibraryStore } from "@/stores/library";
import { useProxyStore } from "@/stores/proxy";
import {
  IconScript,
  IconLive,
  IconLocal,
  IconAntenna,
  IconCalendar,
  IconUpload,
  IconDownload,
  IconTrash,
  IconChevronRight,
  IconKeyboard,
  IconPlus,
  IconWave,
} from "@/components/Icon";

function snapshotAppData(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith("douytv:")) continue;
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    try {
      out[key] = JSON.parse(raw);
    } catch {
      out[key] = raw;
    }
  }
  return out;
}

function clearAllAppData() {
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("douytv:")) toRemove.push(key);
  }
  for (const key of toRemove) localStorage.removeItem(key);
}

function exportBackup() {
  const payload = {
    app: "DouyTV",
    version: "0.1.0",
    exportedAt: Date.now(),
    data: snapshotAppData(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `douytv-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importBackup(file: File): Promise<number> {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || !parsed.data) {
    throw new Error("文件格式不正确，缺少 data 字段");
  }
  clearAllAppData();
  let count = 0;
  for (const [key, value] of Object.entries(
    parsed.data as Record<string, unknown>
  )) {
    if (!key.startsWith("douytv:")) continue;
    localStorage.setItem(key, JSON.stringify(value));
    count++;
  }
  return count;
}

const HOTKEYS: Array<[string, string]> = [
  ["空格 / K", "播放 / 暂停（单视频页）"],
  ["← / →", "后退 / 前进 5 秒"],
  ["↑ / ↓", "上一个 / 下一个视频（首页滑动）"],
  ["M", "静音切换"],
  ["F", "全屏切换"],
  ["P", "画中画"],
  ["J / PgDn / 滚轮↓", "下一个视频（首页）"],
  ["K / PgUp / 滚轮↑", "上一个视频（首页）"],
];

export default function Settings() {
  const scripts = useScriptStore((s) => s.scripts);
  const hydrateScripts = useScriptStore((s) => s.hydrate);
  const channels = useLiveStore((s) => s.channels);
  const hydrateLive = useLiveStore((s) => s.hydrate);
  const subscriptions = useLiveSubStore((s) => s.subscriptions);
  const hydrateSubs = useLiveSubStore((s) => s.hydrate);
  const epgUrl = useEpgStore((s) => s.url);
  const programmes = useEpgStore((s) => s.programmes);
  const epgUpdatedAt = useEpgStore((s) => s.updatedAt);
  const hydrateEpg = useEpgStore((s) => s.hydrate);
  const configSubUrl = useConfigSubStore((s) => s.url);
  const configSubUpdatedAt = useConfigSubStore((s) => s.updatedAt);
  const hydrateConfigSub = useConfigSubStore((s) => s.hydrate);
  const hydrateLibrary = useLibraryStore((s) => s.hydrate);
  const proxyEnabled = useProxyStore((s) => s.enabled);
  const proxyUrl = useProxyStore((s) => s.url);
  const hydrateProxy = useProxyStore((s) => s.hydrate);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showHotkeys, setShowHotkeys] = useState(false);

  useEffect(() => {
    hydrateScripts();
    hydrateLive();
    hydrateSubs();
    hydrateEpg();
    hydrateConfigSub();
    hydrateProxy();
    void hydrateLibrary();
  }, [
    hydrateScripts,
    hydrateLive,
    hydrateSubs,
    hydrateEpg,
    hydrateConfigSub,
    hydrateProxy,
    hydrateLibrary,
  ]);

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      if (!confirm(`从「${file.name}」导入将先清除当前数据，确认继续？`)) {
        e.target.value = "";
        return;
      }
      const count = await importBackup(file);
      alert(`成功导入 ${count} 项数据，应用将重启`);
      window.location.reload();
    } catch (err) {
      alert(`导入失败：${(err as Error).message}`);
    } finally {
      e.target.value = "";
    }
  };

  const onClearAll = () => {
    if (
      !confirm(
        "确认清除所有数据？将移除所有脚本、收藏、历史、直播频道和扫描记录，无法恢复。"
      )
    )
      return;
    clearAllAppData();
    window.location.reload();
  };

  const enabledCount = scripts.filter((s) => s.enabled).length;
  const formattedConfigSubTs = configSubUpdatedAt
    ? new Date(configSubUpdatedAt).toLocaleDateString()
    : undefined;
  const formattedEpgTs = epgUpdatedAt
    ? new Date(epgUpdatedAt).toLocaleDateString()
    : undefined;

  return (
    <div className="min-h-screen bg-ink text-cream p-4 pb-20">
      <div className="mb-5">
        <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
          SETTINGS · CONTROL
        </p>
        <h1 className="font-display text-2xl font-extrabold tracking-tight">
          设置
        </h1>
      </div>

      {/* 内容源 */}
      <section className="mb-6">
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-3">
          CONTENT SOURCES
        </p>
        <div className="space-y-2">
          <SettingsRow
            to="/scripts"
            Icon={IconScript}
            title="视频源"
            subtitle={`${scripts.length} 个 · ${enabledCount} 启用`}
            accent="ember"
          />
          <SettingsRow
            to="/scripts?dialog=config"
            Icon={IconAntenna}
            title="视频源订阅"
            subtitle={
              configSubUrl
                ? `已订阅 · ${formattedConfigSubTs ?? "未刷新"}`
                : "未订阅"
            }
            accent="vhs"
          />
          <SettingsRow
            to="/settings/local-scan"
            Icon={IconLocal}
            title="本地视频"
            subtitle="扫描本地目录，离线播放"
            accent="phosphor"
          />
        </div>
      </section>

      {/* 直播 */}
      <section className="mb-6">
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-3">
          LIVE · IPTV
        </p>
        <div className="space-y-2">
          <SettingsRow
            to="/live"
            Icon={IconLive}
            title="直播频道"
            subtitle={`${channels.length} 频道`}
            accent="ember"
          />
          <SettingsRow
            to="/settings/live-subs"
            Icon={IconAntenna}
            title="M3U 订阅源"
            subtitle={`${subscriptions.length} 个订阅`}
            accent="vhs"
          />
          <SettingsRow
            to="/settings/live-epg"
            Icon={IconCalendar}
            title="EPG 节目单"
            subtitle={
              epgUrl
                ? `${Object.keys(programmes).length} 频道 · ${formattedEpgTs ?? "未刷新"}`
                : "未订阅"
            }
            accent="phosphor"
          />
          <SettingsRow
            to="/settings/live-add"
            Icon={IconPlus}
            title="添加直播频道"
            subtitle="手动添加单个 m3u8"
            accent="vhs"
          />
          <SettingsRow
            to="/settings/live-import"
            Icon={IconDownload}
            title="导入 M3U 文本"
            subtitle="粘贴 M3U 批量导入"
            accent="phosphor"
          />
        </div>
      </section>

      {/* 网络 */}
      <section className="mb-6">
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-3">
          NETWORK
        </p>
        <div className="space-y-2">
          <SettingsRow
            to="/settings/proxy"
            Icon={IconWave}
            title="系统代理"
            subtitle={
              proxyEnabled
                ? proxyUrl
                  ? `ON · ${proxyUrl}`
                  : "ON · 未设置 URL"
                : "OFF · 直连"
            }
            accent="vhs"
          />
        </div>
      </section>

      {/* 数据 */}
      <section className="mb-6">
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-3">
          DATA · BACKUP
        </p>
        <div className="space-y-2">
          <button
            type="button"
            onClick={exportBackup}
            className="w-full flex items-center gap-3 p-3 rounded-lg text-sm tap text-cream"
            style={{
              background: "var(--ink-2)",
              border: "1px solid var(--cream-line)",
            }}
          >
            <span
              className="w-9 h-9 rounded-md flex items-center justify-center shrink-0"
              style={{
                background: "var(--phosphor-soft)",
                color: "var(--phosphor)",
                border: "1px solid rgba(124,255,178,0.25)",
              }}
            >
              <IconUpload size={16} />
            </span>
            <div className="flex-1 text-left">
              <p className="text-sm font-display font-semibold">导出备份</p>
              <p className="text-[11px] text-cream-faint mt-0.5">
                JSON 文件包含全部脚本/收藏/历史/订阅
              </p>
            </div>
            <IconChevronRight size={14} className="text-cream-faint" />
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center gap-3 p-3 rounded-lg text-sm tap text-cream"
            style={{
              background: "var(--ink-2)",
              border: "1px solid var(--cream-line)",
            }}
          >
            <span
              className="w-9 h-9 rounded-md flex items-center justify-center shrink-0"
              style={{
                background: "var(--vhs-soft)",
                color: "var(--vhs)",
                border: "1px solid rgba(79,195,247,0.25)",
              }}
            >
              <IconDownload size={16} />
            </span>
            <div className="flex-1 text-left">
              <p className="text-sm font-display font-semibold">导入备份</p>
              <p className="text-[11px] text-cream-faint mt-0.5">
                从 JSON 恢复（覆盖当前数据）
              </p>
            </div>
            <IconChevronRight size={14} className="text-cream-faint" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={onImportFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={onClearAll}
            className="w-full flex items-center gap-3 p-3 rounded-lg text-sm tap"
            style={{
              background: "rgba(255,80,80,0.06)",
              border: "1px solid rgba(255,80,80,0.2)",
              color: "#FF6B6B",
            }}
          >
            <span
              className="w-9 h-9 rounded-md flex items-center justify-center shrink-0"
              style={{
                background: "rgba(255,80,80,0.15)",
                border: "1px solid rgba(255,80,80,0.3)",
              }}
            >
              <IconTrash size={16} />
            </span>
            <div className="flex-1 text-left">
              <p className="text-sm font-display font-semibold">清除所有数据</p>
              <p className="text-[11px] opacity-70 mt-0.5">不可恢复</p>
            </div>
            <IconChevronRight size={14} />
          </button>
        </div>
      </section>

      {/* 帮助 */}
      <section className="mb-6">
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-3">
          HELP
        </p>
        <button
          type="button"
          onClick={() => setShowHotkeys((x) => !x)}
          className="w-full flex items-center gap-3 p-3 rounded-lg text-sm tap text-cream"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
        >
          <span
            className="w-9 h-9 rounded-md flex items-center justify-center shrink-0"
            style={{
              background: "var(--ember-soft)",
              color: "var(--ember)",
              border: "1px solid rgba(255,107,53,0.25)",
            }}
          >
            <IconKeyboard size={16} />
          </span>
          <div className="flex-1 text-left">
            <p className="text-sm font-display font-semibold">键盘快捷键</p>
            <p className="text-[11px] text-cream-faint mt-0.5">
              {showHotkeys ? "点击收起" : "点击展开"}
            </p>
          </div>
          <IconChevronRight
            size={14}
            className="text-cream-faint transition-transform"
            style={{
              transform: showHotkeys ? "rotate(90deg)" : "rotate(0)",
            }}
          />
        </button>
        {showHotkeys && (
          <ul className="space-y-1.5 mt-2">
            {HOTKEYS.map(([key, desc]) => (
              <li
                key={key}
                className="flex items-center justify-between p-2 rounded text-xs"
                style={{
                  background: "var(--ink-2)",
                  border: "1px solid var(--cream-line)",
                }}
              >
                <code className="text-ember font-mono text-[11px]">{key}</code>
                <span className="text-cream-dim">{desc}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="font-mono text-[10px] text-cream-faint mt-6 text-center tracking-[0.2em]">
        DOUYTV · MOONTV COMPATIBLE · v0.1.0
      </p>
    </div>
  );
}

function SettingsRow({
  to,
  Icon,
  title,
  subtitle,
  accent,
}: {
  to: string;
  Icon: (p: { size?: number }) => JSX.Element;
  title: string;
  subtitle?: string;
  accent: "ember" | "phosphor" | "vhs";
}) {
  const accentColor = `var(--${accent})`;
  const accentSoft = `var(--${accent}-soft)`;
  return (
    <Link
      to={to}
      className="w-full flex items-center gap-3 p-3 rounded-lg text-sm tap text-cream"
      style={{
        background: "var(--ink-2)",
        border: "1px solid var(--cream-line)",
      }}
    >
      <span
        className="w-9 h-9 rounded-md flex items-center justify-center shrink-0"
        style={{
          background: accentSoft,
          color: accentColor,
          border: `1px solid ${accentColor}33`,
        }}
      >
        <Icon size={16} />
      </span>
      <div className="flex-1 text-left min-w-0">
        <p className="text-sm font-display font-semibold line-clamp-1">{title}</p>
        {subtitle && (
          <p className="text-[11px] text-cream-faint mt-0.5 line-clamp-1">
            {subtitle}
          </p>
        )}
      </div>
      <IconChevronRight size={14} className="text-cream-faint" />
    </Link>
  );
}
