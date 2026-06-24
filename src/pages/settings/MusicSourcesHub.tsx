import { useEffect, useMemo, useState } from "react";
import { appAlert, appConfirm } from "@/components/AppDialog";
import {
  IconAlbum,
  IconCheck,
  IconSettings,
  IconTrash,
} from "@/components/Icon";
import {
  importMusicSourceFromText,
  normalizeMusicSourceDescriptor,
  type MusicQuality,
  type MusicSourceDescriptor,
} from "@/lib/music";
import {
  UNBLOCK_SOURCES,
  UNBLOCK_SOURCE_LABELS,
  type UnblockSource,
} from "@/lib/music/unblock";
import { useMusicStore } from "@/stores/music";
import { SettingsSubPageLayout } from "./Layout";

type Tab = "sources" | "player" | "library";

const QUALITY_OPTIONS: Array<{ id: MusicQuality; label: string; desc: string }> = [
  { id: "128k", label: "标准", desc: "兼容优先" },
  { id: "320k", label: "高品", desc: "默认推荐" },
  { id: "flac", label: "无损", desc: "按源能力" },
  { id: "flac24bit", label: "臻品", desc: "请求时按 MoonTV 归一到 flac" },
];

export default function SettingsMusicSourcesHub() {
  const [tab, setTab] = useState<Tab>("sources");
  const hydrate = useMusicStore((s) => s.hydrate);
  const sources = useMusicStore((s) => s.sources);
  const activeSourceId = useMusicStore((s) => s.activeSourceId);
  const quality = useMusicStore((s) => s.quality);
  const proxyEnabled = useMusicStore((s) => s.proxyEnabled);
  const showSpectrum = useMusicStore((s) => s.showSpectrum);
  const unblockEnabled = useMusicStore((s) => s.unblockEnabled);
  const unblockSources = useMusicStore((s) => s.unblockSources);
  const favorites = useMusicStore((s) => s.favorites);
  const history = useMusicStore((s) => s.history);
  const playlists = useMusicStore((s) => s.playlists);
  const setActiveSource = useMusicStore((s) => s.setActiveSource);
  const setQuality = useMusicStore((s) => s.setQuality);
  const setProxyEnabled = useMusicStore((s) => s.setProxyEnabled);
  const setShowSpectrum = useMusicStore((s) => s.setShowSpectrum);
  const setUnblockEnabled = useMusicStore((s) => s.setUnblockEnabled);
  const setUnblockSources = useMusicStore((s) => s.setUnblockSources);
  const installSource = useMusicStore((s) => s.installSource);
  const toggleSource = useMusicStore((s) => s.toggleSource);
  const updateSource = useMusicStore((s) => s.updateSource);
  const uninstallSource = useMusicStore((s) => s.uninstallSource);
  const clearHistory = useMusicStore((s) => s.clearHistory);
  const clearQueue = useMusicStore((s) => s.clearQueue);

  const enabledCount = useMemo(
    () => sources.filter((source) => source.enabled).length,
    [sources]
  );

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const tabBar = (
    <div
      className="flex gap-1 p-1 mx-4 mt-3 mb-1 rounded-lg"
      style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
    >
      <TabButton active={tab === "sources"} onClick={() => setTab("sources")}>
        音乐源
      </TabButton>
      <TabButton active={tab === "player"} onClick={() => setTab("player")}>
        播放器
      </TabButton>
      <TabButton active={tab === "library"} onClick={() => setTab("library")}>
        资料库
      </TabButton>
    </div>
  );

  return (
    <SettingsSubPageLayout eyebrow="SETTINGS · MUSIC" title="音乐管理" toolbar={tabBar}>
      {tab === "sources" && (
        <SourcesTab
          sources={sources}
          activeSourceId={activeSourceId}
          enabledCount={enabledCount}
          onActive={setActiveSource}
          onInstall={installSource}
          onToggle={toggleSource}
          onRename={(source, name) => updateSource(source.id, { name })}
          onDelete={async (source) => {
            if (
              await appConfirm(`删除音乐源「${source.name}」？`, {
                tone: "danger",
                confirmText: "删除",
              })
            ) {
              uninstallSource(source.id);
            }
          }}
        />
      )}
      {tab === "player" && (
        <PlayerTab
          quality={quality}
          proxyEnabled={proxyEnabled}
          showSpectrum={showSpectrum}
          unblockEnabled={unblockEnabled}
          unblockSources={unblockSources}
          onQuality={setQuality}
          onProxy={setProxyEnabled}
          onSpectrum={setShowSpectrum}
          onUnblockEnabled={setUnblockEnabled}
          onUnblockSources={setUnblockSources}
        />
      )}
      {tab === "library" && (
        <LibraryTab
          favorites={favorites.length}
          history={history.length}
          playlists={playlists.length}
          onClearHistory={async () => {
            if (
              await appConfirm("清空音乐播放历史？", {
                tone: "warning",
                confirmText: "清空",
              })
            ) {
              clearHistory();
            }
          }}
          onClearQueue={clearQueue}
        />
      )}
    </SettingsSubPageLayout>
  );
}

function SourcesTab({
  sources,
  activeSourceId,
  enabledCount,
  onActive,
  onInstall,
  onToggle,
  onRename,
  onDelete,
}: {
  sources: MusicSourceDescriptor[];
  activeSourceId: string;
  enabledCount: number;
  onActive: (id: string) => void;
  onInstall: (source: MusicSourceDescriptor) => void;
  onToggle: (id: string) => void;
  onRename: (source: MusicSourceDescriptor, name: string) => void;
  onDelete: (source: MusicSourceDescriptor) => void;
}) {
  const [lxBaseUrl, setLxBaseUrl] = useState("");
  const [lxToken, setLxToken] = useState("");
  const [importText, setImportText] = useState("");
  const [busy, setBusy] = useState(false);

  const addLxServer = async () => {
    if (!lxBaseUrl.trim()) {
      await appAlert("请输入 LX Music API Server 地址", { tone: "warning" });
      return;
    }
    onInstall(
      normalizeMusicSourceDescriptor({
        name: "LX Music API Server",
        kind: "lx-server",
        baseUrl: lxBaseUrl.trim(),
        token: lxToken.trim(),
        defaultPlatform: "all",
      })
    );
    setLxBaseUrl("");
    setLxToken("");
  };

  const importSource = async () => {
    if (!importText.trim()) return;
    setBusy(true);
    try {
      const source = await importMusicSourceFromText(importText);
      onInstall(source);
      setImportText("");
      await appAlert(`已导入：${source.name}`, { title: "音乐源" });
    } catch (error) {
      await appAlert(error instanceof Error ? error.message : "导入失败", {
        title: "导入失败",
        tone: "warning",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="总源数" value={sources.length} />
        <Stat label="已启用" value={enabledCount} />
        <Stat label="LX 源" value={sources.filter((s) => s.kind === "lx-server").length} />
      </div>

      <section className="rounded-lg p-3" style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}>
        <h2 className="font-display text-sm font-bold mb-2">添加 LX Music API Server</h2>
        <div className="grid gap-2 md:grid-cols-[1fr_180px_auto]">
          <input
            value={lxBaseUrl}
            onChange={(event) => setLxBaseUrl(event.target.value)}
            placeholder="http://127.0.0.1:9763"
            className="h-10 rounded-lg px-3 bg-ink text-sm text-cream outline-none"
            style={{ border: "1px solid var(--cream-line)" }}
          />
          <input
            value={lxToken}
            onChange={(event) => setLxToken(event.target.value)}
            placeholder="Token（可选）"
            className="h-10 rounded-lg px-3 bg-ink text-sm text-cream outline-none"
            style={{ border: "1px solid var(--cream-line)" }}
          />
          <button
            type="button"
            onClick={() => void addLxServer()}
            className="h-10 px-4 rounded-lg text-xs font-display font-bold tap"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            添加
          </button>
        </div>
      </section>

      <section className="rounded-lg p-3" style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}>
        <h2 className="font-display text-sm font-bold mb-2">导入插件 / 聚合源</h2>
        <textarea
          value={importText}
          onChange={(event) => setImportText(event.target.value)}
          placeholder="粘贴 lx-music-source / MusicFree 插件源码、JS URL、LX Server URL，或 aggregate-http JSON 配置"
          className="w-full h-32 rounded-lg p-3 bg-ink text-sm text-cream outline-none resize-none"
          style={{ border: "1px solid var(--cream-line)" }}
        />
        <div className="mt-2 flex items-center gap-2">
          <p className="text-xs text-cream-faint flex-1">
            LX Server 与 MoonTV 播放链路一致；MusicFree/LX JS/聚合源通过统一适配层预留兼容。
          </p>
          <button
            type="button"
            onClick={() => void importSource()}
            disabled={!importText.trim() || busy}
            className="h-9 px-4 rounded-lg text-xs font-display font-bold tap disabled:opacity-50"
            style={{ background: "var(--vhs)", color: "var(--ink)" }}
          >
            {busy ? "导入中" : "导入"}
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-sm font-bold">已安装源</h2>
        {sources.length === 0 ? (
          <EmptyText text="暂无音乐源" />
        ) : (
          sources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              active={activeSourceId === source.id}
              onActive={() => onActive(source.id)}
              onToggle={() => onToggle(source.id)}
              onRename={(name) => onRename(source, name)}
              onDelete={() => onDelete(source)}
            />
          ))
        )}
      </section>
    </div>
  );
}

function PlayerTab({
  quality,
  proxyEnabled,
  showSpectrum,
  unblockEnabled,
  unblockSources,
  onQuality,
  onProxy,
  onSpectrum,
  onUnblockEnabled,
  onUnblockSources,
}: {
  quality: MusicQuality;
  proxyEnabled: boolean;
  showSpectrum: boolean;
  unblockEnabled: boolean;
  unblockSources: UnblockSource[];
  onQuality: (quality: MusicQuality) => void;
  onProxy: (enabled: boolean) => void;
  onSpectrum: (enabled: boolean) => void;
  onUnblockEnabled: (enabled: boolean) => void;
  onUnblockSources: (sources: UnblockSource[]) => void;
}) {
  const toggleUnblockSource = (src: UnblockSource) => {
    onUnblockSources(
      unblockSources.includes(src)
        ? unblockSources.filter((s) => s !== src)
        : [...unblockSources, src]
    );
  };
  return (
    <div className="space-y-4">
      <section className="rounded-lg p-3" style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}>
        <h2 className="font-display text-sm font-bold mb-2">默认音质</h2>
        <div className="grid grid-cols-2 gap-2">
          {QUALITY_OPTIONS.map((option) => {
            const active = quality === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onQuality(option.id)}
                className="rounded-lg p-3 text-left tap"
                style={{
                  background: active ? "var(--ember-soft)" : "var(--ink-3)",
                  border: `1px solid ${active ? "var(--ember)" : "var(--cream-line)"}`,
                  color: active ? "var(--ember)" : "var(--cream)",
                }}
              >
                <p className="font-display text-sm font-bold">{option.label}</p>
                <p className="mt-1 text-[10px] text-cream-faint">{option.desc}</p>
              </button>
            );
          })}
        </div>
      </section>

      <SettingSwitch
        title="稳定流代理"
        desc="LX 源播放时生成本地稳定流地址，每次请求由原生代理解析真实音频并转发 Range。"
        checked={proxyEnabled}
        onChange={onProxy}
      />
      <SettingSwitch
        title="频谱动画"
        desc="播放条显示轻量动态频谱，不影响音频解析。"
        checked={showSpectrum}
        onChange={onSpectrum}
      />

      <SettingSwitch
        title="灰曲解灰"
        desc="网易云版权/VIP 灰曲无法播放时，自动从其它平台匹配同名歌曲补链。已启用外部网易云 API 时优先用其服务端解灰，否则用内置移植源。"
        checked={unblockEnabled}
        onChange={onUnblockEnabled}
      />
      {unblockEnabled && (
        <section
          className="rounded-lg p-3"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
        >
          <h2 className="font-display text-sm font-bold mb-1">解灰音源</h2>
          <p className="text-xs text-cream-faint mb-2">
            勾选用于补链的平台，按勾选顺序优先匹配。
          </p>
          <div className="grid grid-cols-3 gap-2">
            {UNBLOCK_SOURCES.map((src) => {
              const active = unblockSources.includes(src);
              return (
                <button
                  key={src}
                  type="button"
                  onClick={() => toggleUnblockSource(src)}
                  className="rounded-lg py-2 text-xs font-display font-semibold tap"
                  style={{
                    background: active ? "var(--ember-soft)" : "var(--ink-3)",
                    border: `1px solid ${active ? "var(--ember)" : "var(--cream-line)"}`,
                    color: active ? "var(--ember)" : "var(--cream-dim)",
                  }}
                >
                  {UNBLOCK_SOURCE_LABELS[src]}
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function LibraryTab({
  favorites,
  history,
  playlists,
  onClearHistory,
  onClearQueue,
}: {
  favorites: number;
  history: number;
  playlists: number;
  onClearHistory: () => void;
  onClearQueue: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="收藏" value={favorites} />
        <Stat label="历史" value={history} />
        <Stat label="歌单" value={playlists} />
      </div>
      <div className="rounded-lg p-3 space-y-2" style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}>
        <button
          type="button"
          onClick={onClearQueue}
          className="w-full h-10 rounded-lg text-xs tap text-cream"
          style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
        >
          清空播放队列
        </button>
        <button
          type="button"
          onClick={onClearHistory}
          className="w-full h-10 rounded-lg text-xs tap"
          style={{ background: "rgba(255,80,80,0.12)", color: "#FF6B6B", border: "1px solid rgba(255,80,80,0.25)" }}
        >
          清空播放历史
        </button>
      </div>
    </div>
  );
}

function SourceRow({
  source,
  active,
  onActive,
  onToggle,
  onRename,
  onDelete,
}: {
  source: MusicSourceDescriptor;
  active: boolean;
  onActive: () => void;
  onToggle: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  return (
    <article
      className="rounded-lg p-3 flex items-center gap-3"
      style={{
        background: active ? "rgba(255,107,53,0.1)" : "var(--ink-2)",
        border: `1px solid ${active ? "rgba(255,107,53,0.42)" : "var(--cream-line)"}`,
      }}
    >
      <button
        type="button"
        onClick={onActive}
        className="w-9 h-9 rounded-lg grid place-items-center shrink-0 tap"
        style={{
          background: source.enabled ? "var(--phosphor-soft)" : "rgba(242,232,213,0.05)",
          color: source.enabled ? "var(--phosphor)" : "var(--cream-faint)",
        }}
      >
        {source.enabled ? <IconCheck size={16} /> : <IconSettings size={16} />}
      </button>
      <div className="min-w-0 flex-1">
        <input
          value={source.name}
          onChange={(event) => onRename(event.target.value)}
          className="w-full bg-transparent text-sm font-display font-semibold text-cream outline-none"
        />
        <p className="text-xs text-cream-faint line-clamp-1">
          {source.kind} {source.baseUrl ? `/ ${source.baseUrl}` : source.description || ""}
        </p>
      </div>
      <button
        type="button"
        onClick={onToggle}
        className="h-8 px-3 rounded-lg text-xs tap"
        style={{
          background: source.enabled ? "var(--phosphor-soft)" : "var(--ink-3)",
          color: source.enabled ? "var(--phosphor)" : "var(--cream-dim)",
        }}
      >
        {source.enabled ? "启用" : "停用"}
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="w-8 h-8 rounded-lg grid place-items-center tap"
        style={{ color: "#FF6B6B" }}
        title="删除"
      >
        <IconTrash size={15} />
      </button>
    </article>
  );
}

function SettingSwitch({
  title,
  desc,
  checked,
  onChange,
}: {
  title: string;
  desc: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <section className="rounded-lg p-3 flex items-center gap-3" style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}>
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-sm font-bold">{title}</h2>
        <p className="mt-1 text-xs text-cream-faint">{desc}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className="w-12 h-7 rounded-full p-1 tap"
        style={{ background: checked ? "var(--ember)" : "var(--ink-3)" }}
      >
        <span
          className="block w-5 h-5 rounded-full transition-transform"
          style={{
            background: checked ? "var(--ink)" : "var(--cream-dim)",
            transform: checked ? "translateX(20px)" : "translateX(0)",
          }}
        />
      </button>
    </section>
  );
}

function TabButton({
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
      className="flex-1 inline-flex items-center justify-center py-2 rounded-md text-[12px] font-display font-semibold tap"
      style={{
        background: active ? "var(--ember)" : "transparent",
        color: active ? "var(--ink)" : "var(--cream-dim)",
      }}
    >
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg p-3" style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}>
      <p className="font-mono text-[10px] text-cream-faint">{label}</p>
      <p className="mt-1 font-display text-xl font-bold">{value}</p>
    </div>
  );
}

function EmptyText({ text }: { text: string }) {
  return (
    <div className="h-36 rounded-lg grid place-items-center text-center text-cream-dim" style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}>
      <div>
        <IconAlbum size={34} className="mx-auto mb-2 text-cream-faint" />
        <p className="text-sm">{text}</p>
      </div>
    </div>
  );
}
