import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useScriptStore } from "@/stores/scripts";
import { useLiveStore } from "@/stores/live";
import { useLiveSubStore } from "@/stores/liveSubscription";
import { useEpgStore } from "@/stores/epg";
import { useConfigSubStore } from "@/stores/configSubscription";
import { useLibraryStore } from "@/stores/library";
import { useProxyStore } from "@/stores/proxy";
import { useDanmakuStore } from "@/stores/danmaku";
import { useSyncStore } from "@/stores/sync";
import {
  IconScript,
  IconLive,
  IconAntenna,
  IconUpload,
  IconDownload,
  IconTrash,
  IconChevronRight,
  IconKeyboard,
  IconWave,
  IconRefresh,
  IconDownload as IconUpdateDownload,
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
  ["↑ / ↓", "上一条 / 下一条视频（首页滑动）"],
  ["M", "静音切换"],
  ["F", "全屏切换"],
  ["P", "画中画"],
  ["J / PgDn / 滚轮↓", "下一条视频（首页）"],
  ["K / PgUp / 滚轮↑", "上一条视频（首页）"],
];

export default function Settings() {
  const scripts = useScriptStore((s) => s.scripts);
  const hydrateScripts = useScriptStore((s) => s.hydrate);
  const channels = useLiveStore((s) => s.channels);
  const hydrateLive = useLiveStore((s) => s.hydrate);
  const subscriptions = useLiveSubStore((s) => s.subscriptions);
  const hydrateSubs = useLiveSubStore((s) => s.hydrate);
  const epgUrl = useEpgStore((s) => s.url);
  const hydrateEpg = useEpgStore((s) => s.hydrate);
  const configSubUrl = useConfigSubStore((s) => s.url);
  const hydrateConfigSub = useConfigSubStore((s) => s.hydrate);
  const hydrateLibrary = useLibraryStore((s) => s.hydrate);
  const proxyMode = useProxyStore((s) => s.mode);
  const proxyManualUrl = useProxyStore((s) => s.manualUrl);
  const proxySystemUrl = useProxyStore((s) => s.systemProxyUrl);
  const hydrateProxy = useProxyStore((s) => s.hydrate);
  const danmakuEnabled = useDanmakuStore((s) => s.enabled);
  const danmakuSource = useDanmakuStore((s) => s.sourceType);
  const hydrateDanmaku = useDanmakuStore((s) => s.hydrate);
  const syncBaseUrl = useSyncStore((s) => s.baseUrl);
  const syncAutoIntervalMin = useSyncStore((s) => s.autoIntervalMin);
  const syncLastSyncAt = useSyncStore((s) => s.lastSyncAt);
  const hydrateSync = useSyncStore((s) => s.hydrate);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showHotkeys, setShowHotkeys] = useState(false);

  useEffect(() => {
    hydrateScripts();
    hydrateLive();
    hydrateSubs();
    hydrateEpg();
    hydrateConfigSub();
    hydrateProxy();
    hydrateDanmaku();
    void hydrateLibrary();
    hydrateSync();
  }, [
    hydrateScripts,
    hydrateLive,
    hydrateSubs,
    hydrateEpg,
    hydrateConfigSub,
    hydrateProxy,
    hydrateDanmaku,
    hydrateLibrary,
    hydrateSync,
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
        "确认清除所有数据？将移除脚本、收藏、历史、直播频道、订阅和扫描记录，无法恢复。"
      )
    ) {
      return;
    }
    clearAllAppData();
    window.location.reload();
  };

  const enabledCount = scripts.filter((s) => s.enabled).length;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-ink text-cream">
      <div
        className="shrink-0 px-4 pt-4 pb-3"
        style={{ borderBottom: "1px solid var(--cream-line)" }}
      >
        <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
          SETTINGS · CONTROL
        </p>
        <h1 className="font-display text-2xl font-extrabold tracking-tight">
          设置
        </h1>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <section className="mb-6">
          <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-3">
            CONTENT SOURCES
          </p>
          <div className="space-y-2">
            <SettingsRow
              to="/settings/video-hub"
              Icon={IconScript}
              title="视频管理"
              subtitle={
                configSubUrl
                  ? `${scripts.length} 源 · ${enabledCount} 启用 · 已订阅`
                  : `${scripts.length} 源 · ${enabledCount} 启用 · 含本地`
              }
              accent="ember"
            />
            <SettingsRow
              to="/settings/local-scan"
              Icon={IconDownload}
              title="本地扫描"
              subtitle="扫描本地视频目录"
              accent="vhs"
            />
          </div>
        </section>

        <section className="mb-6">
          <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-3">
            LIVE · IPTV
          </p>
          <div className="space-y-2">
            <SettingsRow
              to="/settings/live-hub"
              Icon={IconLive}
              title="直播管理"
              subtitle={`${channels.length} 频道 · ${subscriptions.length} 订阅${
                epgUrl ? " · EPG 已订阅" : ""
              }`}
              accent="ember"
            />
          </div>
        </section>

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
                proxyMode === "off"
                  ? "OFF · 直连"
                  : proxyMode === "manual"
                    ? proxyManualUrl
                      ? `MANUAL · ${proxyManualUrl}`
                      : "MANUAL · 未设置 URL"
                    : proxySystemUrl
                      ? `AUTO · ${proxySystemUrl}`
                      : "AUTO · 未检测到系统代理"
              }
              accent="vhs"
            />
            <SettingsRow
              to="/settings/danmaku"
              Icon={IconAntenna}
              title="弹幕设置"
              subtitle={
                danmakuEnabled
                  ? danmakuSource === "builtin"
                    ? "ON · 内置源"
                    : "ON · 自定义源"
                  : "OFF · 关闭弹幕"
              }
              accent="ember"
            />
          </div>
        </section>

        <section className="mb-6">
          <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-3">
            SYSTEM
          </p>
          <div className="space-y-2">
            <SettingsRow
              to="/settings/sync"
              Icon={IconRefresh}
              title="WebDAV 同步"
              subtitle={
                syncBaseUrl
                  ? syncAutoIntervalMin > 0
                    ? `AUTO · 每 ${syncAutoIntervalMin}min · ${
                        syncLastSyncAt
                          ? new Date(syncLastSyncAt).toLocaleDateString()
                          : "未同步"
                      }`
                    : `MANUAL · ${
                        syncLastSyncAt
                          ? new Date(syncLastSyncAt).toLocaleDateString()
                          : "未同步"
                      }`
                  : "未配置 · 自部署 WebDAV 服务"
              }
              accent="vhs"
            />
            <SettingsRow
              to="/settings/updates"
              Icon={IconUpdateDownload}
              title="检查更新"
              subtitle="GitHub Releases · 自动签名校验"
              accent="phosphor"
            />
          </div>
        </section>

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
                  JSON 文件包含脚本、收藏、历史和订阅
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
                  从 JSON 恢复，导入前会清空当前数据
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
        <p className="text-sm font-display font-semibold line-clamp-1">
          {title}
        </p>
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
