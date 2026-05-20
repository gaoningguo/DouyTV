/**
 * 音乐后端设置 —— 支持多 backend 共存 + 切换 active。
 *
 * 三种网络后端：MusicApi-V2 / LX-Music Server / MusicFree 插件。
 * 内置后端：builtin（开箱即用的 lx-music SDK 端口）。
 *
 * 新增分区：
 *  - 默认循环模式 / 默认音量 / 默认歌词翻译 / 默认歌词字号
 *  - 后端卡片显示 capability 徽章
 *  - MusicFree 插件支持编辑 userVariables
 */
import { useEffect, useMemo, useState } from "react";
import { useMusicStore } from "@/stores/music";
import {
  MUSIC_QUALITIES,
  MUSIC_REPEAT_MODES,
  MUSIC_SOURCES,
  type MusicQuality,
  type MusicRepeatMode,
  type MusicSource,
} from "@/lib/music/types";
import {
  MUSIC_BACKEND_LABELS,
  type MusicApiBackend,
  type LxMusicBackend,
  type PluginBackend,
  type MusicBackend,
  type MusicBackendKind,
} from "@/lib/music/backends/types";
import {
  describePlugin,
  parsePluginList,
  type PluginListEntry,
} from "@/lib/music/backends/plugin";
import { getBackendCapabilities, searchMusic } from "@/lib/music/api";
import { IconPlus, IconTrash, IconCheck, IconClose } from "@/components/Icon";
import { SettingsSubPageLayout } from "./Layout";

const REPEAT_LABELS: Record<MusicRepeatMode, string> = {
  list: "顺序",
  single: "单曲",
  shuffle: "随机",
};

const SIZE_LABELS = ["S", "M", "L", "XL"] as const;

export default function SettingsMusic() {
  const backends = useMusicStore((s) => s.backends);
  const activeBackendId = useMusicStore((s) => s.activeBackendId);
  const defaultPlatform = useMusicStore((s) => s.defaultPlatform);
  const defaultQuality = useMusicStore((s) => s.defaultQuality);
  const repeatMode = useMusicStore((s) => s.repeatMode);
  const volume = useMusicStore((s) => s.volume);
  const showTranslation = useMusicStore((s) => s.showTranslation);
  const lrcSize = useMusicStore((s) => s.lrcSize);
  const hydrate = useMusicStore((s) => s.hydrate);
  const addBackend = useMusicStore((s) => s.addBackend);
  const updateBackend = useMusicStore((s) => s.updateBackend);
  const removeBackend = useMusicStore((s) => s.removeBackend);
  const setActiveBackend = useMusicStore((s) => s.setActiveBackend);
  const setDefaultPlatform = useMusicStore((s) => s.setDefaultPlatform);
  const setDefaultQuality = useMusicStore((s) => s.setDefaultQuality);
  const setRepeatMode = useMusicStore((s) => s.setRepeatMode);
  const setVolume = useMusicStore((s) => s.setVolume);
  const setShowTranslation = useMusicStore((s) => s.setShowTranslation);
  const setLrcSize = useMusicStore((s) => s.setLrcSize);

  const [adding, setAdding] = useState<MusicBackendKind | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<
    Record<string, { ok: boolean; msg: string }>
  >({});
  const [editingVarsId, setEditingVarsId] = useState<string | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const runTest = async (id: string) => {
    setTestingId(id);
    setTestResult((r) => ({ ...r, [id]: { ok: false, msg: "测试中…" } }));
    const wasActive = activeBackendId;
    if (id !== wasActive) setActiveBackend(id);
    try {
      const r = await searchMusic("test", defaultPlatform, 1, 1);
      setTestResult((m) => ({
        ...m,
        [id]: { ok: true, msg: `连通 · 返回 ${r.total} 条` },
      }));
    } catch (e) {
      setTestResult((m) => ({
        ...m,
        [id]: { ok: false, msg: (e as Error).message ?? String(e) },
      }));
    } finally {
      if (wasActive && wasActive !== id) setActiveBackend(wasActive);
      setTestingId(null);
    }
  };

  return (
    <SettingsSubPageLayout eyebrow="MUSIC · BACKENDS" title="音乐服务">
      <p className="text-[11px] text-cream-faint mb-4 leading-relaxed">
        四种音乐后端可任意组合：内置（开箱即用，无需配置） · MusicApi-V2 · LX-Music Server
        · MusicFree 插件。可保留多套配置，点击切换 active。
      </p>

      {/* Backends list */}
      <div className="space-y-2 mb-4">
        {backends.length === 0 && (
          <div
            className="rounded-xl p-4 text-center text-[12px] text-cream-faint"
            style={{ background: "var(--ink-2)", border: "1px dashed var(--cream-line)" }}
          >
            尚未添加任何后端 · 点击下方按钮添加
          </div>
        )}
        {backends.map((b) => (
          <BackendCard
            key={b.id}
            backend={b}
            active={b.id === activeBackendId}
            testing={testingId === b.id}
            testResult={testResult[b.id]}
            onActivate={() => setActiveBackend(b.id)}
            onTest={() => void runTest(b.id)}
            onRemove={() => {
              if (confirm(`删除后端「${b.name}」？`)) removeBackend(b.id);
            }}
            onUpdate={(patch) => updateBackend(b.id, patch)}
            onEditVars={() => setEditingVarsId(b.id)}
          />
        ))}
      </div>

      {/* Add buttons — builtin 自动注入，无须 add 按钮 */}
      <div className="grid grid-cols-3 gap-2 mb-6">
        {(Object.keys(MUSIC_BACKEND_LABELS) as MusicBackendKind[])
          .filter((k) => k !== "builtin")
          .map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setAdding(k)}
              className="py-2.5 rounded-lg tap text-[11px] font-display font-semibold"
              style={{
                background: "var(--ink-3)",
                border: "1px solid var(--cream-line)",
                color: "var(--cream)",
              }}
            >
              <IconPlus size={12} className="inline mr-1" />
              {MUSIC_BACKEND_LABELS[k]}
            </button>
          ))}
      </div>

      {adding && (
        <AddBackendDialog
          kind={adding}
          onClose={() => setAdding(null)}
          onAdd={(input) => addBackend(input)}
        />
      )}

      {editingVarsId && (
        <PluginVarsDialog
          backendId={editingVarsId}
          onClose={() => setEditingVarsId(null)}
        />
      )}

      {/* Default platform */}
      <section
        className="rounded-xl p-4 mb-4"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
      >
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-3">
          DEFAULT PLATFORM
        </p>
        <div className="grid grid-cols-5 gap-1">
          {MUSIC_SOURCES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setDefaultPlatform(s.id as MusicSource)}
              className="py-2 rounded-md text-[11px] font-display font-semibold tap"
              style={{
                background:
                  defaultPlatform === s.id ? "var(--ember)" : "var(--ink-3)",
                color: defaultPlatform === s.id ? "var(--ink)" : "var(--cream-dim)",
                border: "1px solid var(--cream-line)",
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </section>

      <section
        className="rounded-xl p-4 mb-4"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
      >
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-3">
          DEFAULT QUALITY
        </p>
        <div className="grid grid-cols-4 gap-1">
          {MUSIC_QUALITIES.map((q) => (
            <button
              key={q.id}
              type="button"
              onClick={() => setDefaultQuality(q.id as MusicQuality)}
              className="py-2 rounded-md text-[11px] font-display font-semibold tap"
              style={{
                background:
                  defaultQuality === q.id ? "var(--ember)" : "var(--ink-3)",
                color: defaultQuality === q.id ? "var(--ink)" : "var(--cream-dim)",
                border: "1px solid var(--cream-line)",
              }}
            >
              {q.label}
            </button>
          ))}
        </div>
      </section>

      {/* 默认循环模式 */}
      <section
        className="rounded-xl p-4 mb-4"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
      >
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-3">
          DEFAULT REPEAT
        </p>
        <div className="grid grid-cols-3 gap-1">
          {MUSIC_REPEAT_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setRepeatMode(m.id)}
              className="py-2 rounded-md text-[11px] font-display font-semibold tap"
              style={{
                background: repeatMode === m.id ? "var(--ember)" : "var(--ink-3)",
                color: repeatMode === m.id ? "var(--ink)" : "var(--cream-dim)",
                border: "1px solid var(--cream-line)",
              }}
            >
              {REPEAT_LABELS[m.id]}
            </button>
          ))}
        </div>
      </section>

      {/* 默认音量 */}
      <section
        className="rounded-xl p-4 mb-4"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
      >
        <div className="flex items-center justify-between mb-3">
          <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
            DEFAULT VOLUME
          </p>
          <span className="font-mono text-[11px] text-cream-dim">
            {Math.round(volume * 100)}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          className="w-full"
        />
      </section>

      {/* 歌词偏好 */}
      <section
        className="rounded-xl p-4 mb-4"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
      >
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-3">
          LYRICS
        </p>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[12px] text-cream">显示翻译（双语歌词）</span>
          <button
            type="button"
            onClick={() => setShowTranslation(!showTranslation)}
            className="relative w-10 h-5 rounded-full tap"
            style={{
              background: showTranslation ? "var(--ember)" : "var(--ink-3)",
              border: "1px solid var(--cream-line)",
            }}
            aria-label="切换翻译"
          >
            <span
              className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
              style={{
                left: showTranslation ? 22 : 2,
                background: showTranslation ? "var(--ink)" : "var(--cream)",
              }}
            />
          </button>
        </div>
        <div>
          <span className="text-[10px] font-mono text-cream-faint block mb-2">
            字号
          </span>
          <div className="grid grid-cols-4 gap-1">
            {([0, 1, 2, 3] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setLrcSize(s)}
                className="py-2 rounded-md text-[11px] font-display font-semibold tap"
                style={{
                  background: lrcSize === s ? "var(--ember)" : "var(--ink-3)",
                  color: lrcSize === s ? "var(--ink)" : "var(--cream-dim)",
                  border: "1px solid var(--cream-line)",
                }}
              >
                {SIZE_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div
        className="rounded-xl p-3.5 text-[11px] text-cream-dim leading-relaxed"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
      >
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
          后端 RECIPE
        </p>
        <ul className="space-y-1">
          <li>· 内置 · 基于 lx-music SDK 的开箱即用音源（搜索 / 榜单 / 歌词，URL 解析需其他后端配合）</li>
          <li>· MusicApi-V2 · MoonTV 同款，huangxd-/MusicAPI-V2-Server</li>
          <li>· LX-Music · lyswhut/lx-music-api-server，活跃维护</li>
          <li>· MusicFree 插件 · maotoumao/MusicFreePlugins 生态，粘贴 JS 即用</li>
        </ul>
      </div>
    </SettingsSubPageLayout>
  );
}

/* ───────────────────────── BackendCard ───────────────────────── */

function BackendCard({
  backend,
  active,
  testing,
  testResult,
  onActivate,
  onTest,
  onRemove,
  onUpdate,
  onEditVars,
}: {
  backend: MusicBackend;
  active: boolean;
  testing: boolean;
  testResult?: { ok: boolean; msg: string };
  onActivate: () => void;
  onTest: () => void;
  onRemove: () => void;
  onUpdate: (patch: Partial<MusicBackend>) => void;
  onEditVars: () => void;
}) {
  // 取 capability 列表用于徽章
  const caps = useMemo(() => {
    try {
      const c = getBackendCapabilities(backend.id);
      if (!c) return [];
      const items: string[] = [];
      if (c.search) items.push("搜索");
      if (c.parse) items.push("解析");
      if (c.lyrics) items.push("歌词");
      if (c.toplists) items.push("榜单");
      if (c.playlists) items.push("歌单");
      if (c.albums) items.push("专辑");
      if (c.artists) items.push("歌手");
      if (c.recommendSheets) items.push("推荐");
      if (c.comments) items.push("评论");
      if (c.hotSearch) items.push("热搜");
      return items;
    } catch {
      return [];
    }
  }, [backend.id]);

  // 检测插件是否有 userVariables — 仅插件类型有
  const hasUserVars =
    backend.kind === "plugin" &&
    (() => {
      try {
        const meta = describePlugin((backend as PluginBackend).code);
        return !!meta.userVariables && meta.userVariables.length > 0;
      } catch {
        return false;
      }
    })();

  return (
    <div
      className="rounded-xl p-3"
      style={{
        background: "var(--ink-2)",
        border: active
          ? "1px solid rgba(255,107,53,0.5)"
          : "1px solid var(--cream-line)",
        boxShadow: active ? "0 0 16px rgba(255,107,53,0.18)" : undefined,
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="px-1.5 py-0.5 rounded font-mono text-[9px] tracking-wider"
          style={{
            background: "var(--ember-soft)",
            color: "var(--ember)",
            border: "1px solid rgba(255,107,53,0.3)",
          }}
        >
          {MUSIC_BACKEND_LABELS[backend.kind]}
        </span>
        <input
          value={backend.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          className="flex-1 px-2 py-1 rounded text-xs font-display font-semibold outline-none text-cream bg-transparent"
        />
        {active && (
          <span
            className="font-mono text-[9px] tracking-wider"
            style={{ color: "var(--phosphor)" }}
          >
            ACTIVE
          </span>
        )}
        {backend.kind !== "builtin" && (
          <button
            type="button"
            onClick={onRemove}
            className="w-7 h-7 rounded flex items-center justify-center tap text-cream-faint hover:text-[#FF6B6B]"
            title="删除"
          >
            <IconTrash size={14} />
          </button>
        )}
      </div>

      {/* 类型相关字段 */}
      {backend.kind === "musicapi" && (
        <div className="space-y-2">
          <input
            value={backend.baseUrl}
            onChange={(e) =>
              onUpdate({ baseUrl: e.target.value } as Partial<MusicApiBackend>)
            }
            placeholder="http://localhost:3300"
            className="w-full px-2 py-1.5 rounded text-[11px] font-mono outline-none text-cream placeholder:text-cream-faint"
            style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
          />
          <input
            value={backend.token}
            onChange={(e) =>
              onUpdate({ token: e.target.value } as Partial<MusicApiBackend>)
            }
            placeholder="X-API-Key（解析必须）"
            className="w-full px-2 py-1.5 rounded text-[11px] font-mono outline-none text-cream placeholder:text-cream-faint"
            style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
          />
        </div>
      )}
      {backend.kind === "lxmusic" && (
        <div className="space-y-2">
          <input
            value={backend.baseUrl}
            onChange={(e) =>
              onUpdate({ baseUrl: e.target.value } as Partial<LxMusicBackend>)
            }
            placeholder="http://localhost:1233"
            className="w-full px-2 py-1.5 rounded text-[11px] font-mono outline-none text-cream placeholder:text-cream-faint"
            style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
          />
          <input
            value={backend.authKey}
            onChange={(e) =>
              onUpdate({ authKey: e.target.value } as Partial<LxMusicBackend>)
            }
            placeholder="X-LX-AUTH（可选）"
            className="w-full px-2 py-1.5 rounded text-[11px] font-mono outline-none text-cream placeholder:text-cream-faint"
            style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
          />
        </div>
      )}
      {backend.kind === "plugin" && (
        <div className="space-y-1">
          <p className="font-mono text-[10px] text-cream-faint">
            插件 · {backend.platform ?? "?"}
            {backend.version ? ` · v${backend.version}` : ""}
          </p>
          {backend.sourceUrl && (
            <p className="font-mono text-[10px] text-cream-faint truncate">
              来源 · {backend.sourceUrl}
            </p>
          )}
        </div>
      )}
      {backend.kind === "builtin" && (
        <p className="font-mono text-[10px] text-cream-faint">
          内置 · 网易云/酷我 公开 API
        </p>
      )}

      {/* capability 徽章 */}
      {caps.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {caps.map((c) => (
            <span
              key={c}
              className="px-1.5 py-0.5 rounded text-[9px] font-mono"
              style={{
                background: "var(--ink-3)",
                color: "var(--cream-dim)",
                border: "1px solid var(--cream-line)",
              }}
            >
              {c}
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2 mt-3">
        {!active && (
          <button
            type="button"
            onClick={onActivate}
            className="flex-1 py-1.5 rounded text-[11px] font-display font-semibold tap"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            <IconCheck size={12} className="inline mr-1" />
            设为 ACTIVE
          </button>
        )}
        {hasUserVars && (
          <button
            type="button"
            onClick={onEditVars}
            className="flex-1 py-1.5 rounded text-[11px] tap text-cream"
            style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
          >
            插件设置
          </button>
        )}
        <button
          type="button"
          onClick={onTest}
          disabled={testing}
          className="flex-1 py-1.5 rounded text-[11px] tap text-cream disabled:opacity-50"
          style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
        >
          {testing ? "测试中…" : "测试连接"}
        </button>
      </div>
      {testResult && (
        <p
          className="mt-2 p-1.5 rounded text-[10px] font-mono"
          style={
            testResult.ok
              ? {
                  background: "var(--phosphor-soft)",
                  color: "var(--phosphor)",
                  border: "1px solid rgba(124,255,178,0.25)",
                }
              : {
                  background: "rgba(255,80,80,0.08)",
                  color: "#FF6B6B",
                  border: "1px solid rgba(255,80,80,0.25)",
                }
          }
        >
          {testResult.ok ? "✓" : "✗"} {testResult.msg}
        </p>
      )}
    </div>
  );
}

/* ───────────────────────── 插件 userVariables 编辑器 ───────────────────────── */

function PluginVarsDialog({
  backendId,
  onClose,
}: {
  backendId: string;
  onClose: () => void;
}) {
  const backend = useMusicStore((s) => s.backends.find((b) => b.id === backendId));
  const pluginUserVariables = useMusicStore((s) => s.pluginUserVariables);
  const setPluginUserVariable = useMusicStore((s) => s.setPluginUserVariable);

  const schema = useMemo(() => {
    if (!backend || backend.kind !== "plugin") return [];
    try {
      const meta = describePlugin((backend as PluginBackend).code);
      return meta.userVariables ?? [];
    } catch {
      return [];
    }
  }, [backend]);

  const values = pluginUserVariables[backendId] ?? {};

  if (!backend) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl p-4"
        style={{
          background: "var(--ink)",
          border: "1px solid var(--cream-line)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
              PLUGIN · USER VARIABLES
            </p>
            <h3 className="font-display text-base font-extrabold">{backend.name}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center tap text-cream-faint"
            aria-label="关闭"
          >
            <IconClose size={12} />
          </button>
        </div>

        {schema.length === 0 ? (
          <p className="text-[11px] text-cream-faint">
            该插件未声明 userVariables
          </p>
        ) : (
          <div className="space-y-3">
            {schema.map((v) => (
              <div key={v.key}>
                <label className="block font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-1">
                  {v.name || v.key}
                </label>
                <input
                  value={values[v.key] ?? ""}
                  onChange={(e) =>
                    setPluginUserVariable(backendId, v.key, e.target.value)
                  }
                  placeholder={v.hint || v.key}
                  className="w-full px-3 py-2 rounded-lg text-xs font-mono outline-none text-cream placeholder:text-cream-faint"
                  style={{
                    background: "var(--ink-3)",
                    border: "1px solid var(--cream-line)",
                  }}
                />
                {v.hint && (
                  <p className="text-[10px] text-cream-faint mt-1">{v.hint}</p>
                )}
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={onClose}
          className="w-full mt-4 py-2 rounded-lg text-xs font-display font-semibold tap"
          style={{ background: "var(--ember)", color: "var(--ink)" }}
        >
          完成
        </button>
      </div>
    </div>
  );
}

/* ───────────────────────── AddBackendDialog ───────────────────────── */

function AddBackendDialog({
  kind,
  onClose,
  onAdd,
}: {
  kind: MusicBackendKind;
  onClose: () => void;
  onAdd: (input: Omit<MusicBackend, "id" | "addedAt">) => void;
}) {
  const [name, setName] = useState(MUSIC_BACKEND_LABELS[kind]);
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [authKey, setAuthKey] = useState("");
  const [pluginCode, setPluginCode] = useState("");
  const [pluginUrl, setPluginUrl] = useState("");
  const [pluginList, setPluginList] = useState<PluginListEntry[] | null>(null);
  const [bulkLog, setBulkLog] = useState<
    Array<{ name: string; ok: boolean; msg?: string }>
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const placeholders = useMemo(() => {
    if (kind === "musicapi") return { url: "http://localhost:3300", auth: "X-API-Key" };
    if (kind === "lxmusic") return { url: "http://localhost:1233", auth: "X-LX-AUTH（可选）" };
    return {
      url: "https://.../plugin.js 或 .../plugins.json（列表）",
      auth: "",
    };
  }, [kind]);

  const fetchPlugin = async () => {
    if (!pluginUrl) return;
    setLoading(true);
    setError(null);
    setPluginList(null);
    setBulkLog([]);
    try {
      const { scriptFetch } = await import("@/source-script/fetch");
      const res = await scriptFetch(pluginUrl, { method: "GET", timeout: 30_000 });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const trimmed = text.trim();
      const looksJson = trimmed.startsWith("{") || trimmed.startsWith("[");
      if (looksJson) {
        try {
          const list = parsePluginList(text);
          if (list.length === 0) {
            throw new Error("JSON 解析到 0 个插件");
          }
          setPluginList(list);
          return;
        } catch (e) {
          console.warn("[music] parse plugin list failed, treat as JS", e);
        }
      }
      setPluginCode(text);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  const bulkInstall = async () => {
    if (!pluginList) return;
    setLoading(true);
    setBulkLog([]);
    const { scriptFetch } = await import("@/source-script/fetch");
    for (const entry of pluginList) {
      try {
        const res = await scriptFetch(entry.url, { method: "GET", timeout: 30_000 });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const code = await res.text();
        const meta = describePlugin(code);
        const input: Omit<PluginBackend, "id" | "addedAt"> = {
          kind: "plugin",
          name: entry.name || meta.platform,
          code,
          platform: meta.platform,
          version: entry.version ?? meta.version,
          sourceUrl: entry.url,
          enabled: true,
        };
        onAdd(input);
        setBulkLog((prev) => [...prev, { name: entry.name, ok: true }]);
      } catch (e) {
        setBulkLog((prev) => [
          ...prev,
          { name: entry.name, ok: false, msg: (e as Error).message ?? String(e) },
        ]);
      }
    }
    setLoading(false);
  };

  const save = () => {
    setError(null);
    try {
      if (kind === "musicapi") {
        if (!baseUrl.trim()) throw new Error("URL 必填");
        const input: Omit<MusicApiBackend, "id" | "addedAt"> = {
          kind: "musicapi",
          name: name.trim() || "MusicApi-V2",
          baseUrl: baseUrl.trim(),
          token: token.trim(),
          enabled: true,
        };
        onAdd(input);
        onClose();
        return;
      }
      if (kind === "lxmusic") {
        if (!baseUrl.trim()) throw new Error("URL 必填");
        const input: Omit<LxMusicBackend, "id" | "addedAt"> = {
          kind: "lxmusic",
          name: name.trim() || "LX-Music",
          baseUrl: baseUrl.trim(),
          authKey: authKey.trim(),
          enabled: true,
        };
        onAdd(input);
        onClose();
        return;
      }
      if (kind === "builtin") {
        // builtin 不通过 add 流程，但兼容意外触发
        return;
      }
      // plugin (单个)
      if (!pluginCode.trim()) throw new Error("请粘贴插件代码或从 URL 拉取");
      const meta = describePlugin(pluginCode);
      const input: Omit<PluginBackend, "id" | "addedAt"> = {
        kind: "plugin",
        name: name.trim() || meta.platform,
        code: pluginCode,
        platform: meta.platform,
        version: meta.version,
        sourceUrl: pluginUrl || undefined,
        enabled: true,
      };
      onAdd(input);
      onClose();
    } catch (e) {
      setError((e as Error).message ?? String(e));
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl p-4"
        style={{
          background: "var(--ink)",
          border: "1px solid var(--cream-line)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-1">
          NEW BACKEND
        </p>
        <h3 className="font-display text-lg font-extrabold mb-3">
          {MUSIC_BACKEND_LABELS[kind]}
        </h3>

        <label className="block font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-1">
          名称
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 rounded-lg text-xs font-mono outline-none text-cream mb-3"
          style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
        />

        {kind !== "plugin" && kind !== "builtin" && (
          <>
            <label className="block font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-1">
              URL
            </label>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={placeholders.url}
              className="w-full px-3 py-2 rounded-lg text-xs font-mono outline-none text-cream placeholder:text-cream-faint mb-3"
              style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
            />
            <label className="block font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-1">
              {placeholders.auth}
            </label>
            <input
              value={kind === "musicapi" ? token : authKey}
              onChange={(e) =>
                kind === "musicapi" ? setToken(e.target.value) : setAuthKey(e.target.value)
              }
              className="w-full px-3 py-2 rounded-lg text-xs font-mono outline-none text-cream mb-3"
              style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
            />
          </>
        )}

        {kind === "plugin" && (
          <>
            <label className="block font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-1">
              插件 URL（.js 单插件 · 或 .json 订阅列表）
            </label>
            <div className="flex gap-2 mb-3">
              <input
                value={pluginUrl}
                onChange={(e) => setPluginUrl(e.target.value)}
                placeholder={placeholders.url}
                className="flex-1 px-3 py-2 rounded-lg text-xs font-mono outline-none text-cream placeholder:text-cream-faint"
                style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
              />
              <button
                type="button"
                onClick={() => void fetchPlugin()}
                disabled={loading || !pluginUrl}
                className="px-3 py-2 rounded-lg text-[11px] tap text-cream disabled:opacity-50"
                style={{
                  background: "var(--ink-3)",
                  border: "1px solid var(--cream-line)",
                }}
              >
                {loading ? "…" : "拉取"}
              </button>
            </div>

            {pluginList && (
              <div
                className="rounded-lg p-3 mb-3"
                style={{
                  background: "var(--ember-soft)",
                  border: "1px solid rgba(255,107,53,0.3)",
                }}
              >
                <p className="font-mono text-[10px] tracking-[0.2em] text-ember mb-2">
                  PLUGIN LIST · {pluginList.length} 个
                </p>
                <ul className="space-y-1 max-h-48 overflow-y-auto mb-3">
                  {pluginList.map((p) => {
                    const log = bulkLog.find((l) => l.name === p.name);
                    return (
                      <li
                        key={p.url}
                        className="flex items-center gap-2 text-[11px] font-mono"
                      >
                        <span className="flex-1 truncate text-cream">
                          {p.name}
                          {p.version ? ` v${p.version}` : ""}
                        </span>
                        {log && (
                          <span
                            style={{
                              color: log.ok ? "var(--phosphor)" : "#FF6B6B",
                            }}
                            title={log.msg}
                          >
                            {log.ok ? "✓" : `✗ ${log.msg ?? ""}`}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <button
                  type="button"
                  onClick={() => void bulkInstall()}
                  disabled={loading}
                  className="w-full py-2 rounded text-xs font-display font-semibold tap disabled:opacity-50"
                  style={{ background: "var(--ember)", color: "var(--ink)" }}
                >
                  {loading
                    ? `安装中… (${bulkLog.length}/${pluginList.length})`
                    : `一键安装全部 ${pluginList.length} 个`}
                </button>
              </div>
            )}

            {!pluginList && (
              <>
                <label className="block font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-1">
                  插件代码（JS · MusicFree 或 LX-Music-Desktop 用户源都支持）
                </label>
                <textarea
                  value={pluginCode}
                  onChange={(e) => setPluginCode(e.target.value)}
                  placeholder="粘贴插件源码 ……  支持 module.exports = {...} (MusicFree) / globalThis.lx (落雪)"
                  rows={8}
                  className="w-full px-3 py-2 rounded-lg text-[10px] font-mono outline-none text-cream placeholder:text-cream-faint mb-3"
                  style={{
                    background: "var(--ink-3)",
                    border: "1px solid var(--cream-line)",
                    resize: "vertical",
                  }}
                />
              </>
            )}
          </>
        )}

        {error && (
          <p
            className="p-2 rounded text-[11px] font-mono mb-3"
            style={{
              background: "rgba(255,80,80,0.08)",
              color: "#FF6B6B",
              border: "1px solid rgba(255,80,80,0.25)",
            }}
          >
            ✗ {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2 rounded-lg text-xs tap text-cream"
            style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
          >
            {pluginList && bulkLog.length === pluginList.length ? "关闭" : "取消"}
          </button>
          {(!pluginList || bulkLog.length === 0) && (
            <button
              type="button"
              onClick={save}
              disabled={!!pluginList}
              className="flex-1 py-2 rounded-lg text-xs font-display font-semibold tap disabled:opacity-40"
              style={{ background: "var(--ember)", color: "var(--ink)" }}
              title={pluginList ? "订阅列表请用上方按钮安装" : undefined}
            >
              添加
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
