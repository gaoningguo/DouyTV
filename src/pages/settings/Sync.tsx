import { useEffect, useState } from "react";
import { useSyncStore } from "@/stores/sync";
import { SettingsSubPageLayout } from "./Layout";

const INTERVAL_OPTIONS = [
  { value: 0, label: "OFF" },
  { value: 15, label: "15 分钟" },
  { value: 60, label: "1 小时" },
  { value: 360, label: "6 小时" },
  { value: 1440, label: "1 天" },
];

export default function SettingsSync() {
  const baseUrl = useSyncStore((s) => s.baseUrl);
  const username = useSyncStore((s) => s.username);
  const password = useSyncStore((s) => s.password);
  const autoIntervalMin = useSyncStore((s) => s.autoIntervalMin);
  const lastSyncAt = useSyncStore((s) => s.lastSyncAt);
  const syncing = useSyncStore((s) => s.syncing);
  const hydrate = useSyncStore((s) => s.hydrate);
  const setBaseUrl = useSyncStore((s) => s.setBaseUrl);
  const setUsername = useSyncStore((s) => s.setUsername);
  const setPassword = useSyncStore((s) => s.setPassword);
  const setAutoInterval = useSyncStore((s) => s.setAutoInterval);
  const testConnection = useSyncStore((s) => s.testConnection);
  const pushNow = useSyncStore((s) => s.pushNow);
  const pullNow = useSyncStore((s) => s.pullNow);

  const [urlInput, setUrlInput] = useState("");
  const [userInput, setUserInput] = useState("");
  const [passInput, setPassInput] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [result, setResult] = useState<
    | { kind: "test" | "push" | "pull"; ok: boolean; message?: string }
    | undefined
  >();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    setUrlInput(baseUrl);
    setUserInput(username);
    setPassInput(password);
  }, [baseUrl, username, password]);

  const saveConfig = () => {
    setBaseUrl(urlInput.trim());
    setUsername(userInput.trim());
    setPassword(passInput);
  };

  const onTest = async () => {
    saveConfig();
    setResult(undefined);
    const r = await testConnection();
    setResult({ kind: "test", ok: r.ok, message: r.message });
  };

  const onPush = async () => {
    saveConfig();
    setResult(undefined);
    const r = await pushNow();
    setResult({ kind: "push", ok: r.ok, message: r.message });
  };

  const onPull = async () => {
    if (
      !confirm("拉取远端数据将覆盖本地所有 DouyTV 设置/脚本/订阅，确认继续？")
    ) {
      return;
    }
    saveConfig();
    setResult(undefined);
    const r = await pullNow();
    setResult({
      kind: "pull",
      ok: r.ok,
      message: r.ok
        ? `已恢复 ${(r as { applied?: number }).applied ?? 0} 项数据，将重启`
        : r.message,
    });
    if (r.ok) {
      setTimeout(() => window.location.reload(), 800);
    }
  };

  return (
    <SettingsSubPageLayout eyebrow="SYSTEM · SYNC" title="WebDAV 同步">
      <p className="text-[11px] text-cream-faint mb-4 leading-relaxed">
        通过 WebDAV 同步设置 / 脚本 / 订阅。SQL 数据（收藏 / 历史 / 书架）不在同步范围。
        推荐 Nextcloud · 坚果云 · OcisServer · WebDAV 网盘
      </p>

      <section
        className="rounded-xl p-4 mb-4"
        style={{
          background: "var(--ink-2)",
          border: "1px solid var(--cream-line)",
        }}
      >
        <label className="block font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-1">
          WEBDAV URL
        </label>
        <input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="https://dav.example.com/dav/douytv"
          className="w-full px-3 py-2 rounded-lg text-xs font-mono outline-none text-cream placeholder:text-cream-faint mb-3"
          style={{
            background: "var(--ink-3)",
            border: "1px solid var(--cream-line)",
          }}
        />

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-1">
              USERNAME
            </label>
            <input
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder="username"
              className="w-full px-3 py-2 rounded-lg text-xs font-mono outline-none text-cream placeholder:text-cream-faint"
              style={{
                background: "var(--ink-3)",
                border: "1px solid var(--cream-line)",
              }}
            />
          </div>
          <div>
            <label className="block font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-1">
              PASSWORD
            </label>
            <div className="relative">
              <input
                type={showPass ? "text" : "password"}
                value={passInput}
                onChange={(e) => setPassInput(e.target.value)}
                placeholder="••••••"
                className="w-full px-3 py-2 pr-12 rounded-lg text-xs font-mono outline-none text-cream placeholder:text-cream-faint"
                style={{
                  background: "var(--ink-3)",
                  border: "1px solid var(--cream-line)",
                }}
              />
              <button
                type="button"
                onClick={() => setShowPass((b) => !b)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-cream-faint hover:text-cream tap"
              >
                {showPass ? "HIDE" : "SHOW"}
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => void onTest()}
            disabled={syncing}
            className="py-2 rounded-lg text-xs tap text-cream disabled:opacity-50"
            style={{
              background: "var(--ink-3)",
              border: "1px solid var(--cream-line)",
            }}
          >
            测试连接
          </button>
          <button
            type="button"
            onClick={() => void onPush()}
            disabled={syncing}
            className="py-2 rounded-lg text-xs font-display font-semibold tap disabled:opacity-50"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            {syncing ? "…" : "推送"}
          </button>
          <button
            type="button"
            onClick={() => void onPull()}
            disabled={syncing}
            className="py-2 rounded-lg text-xs font-display font-semibold tap disabled:opacity-50"
            style={{ background: "var(--vhs-soft)", color: "var(--vhs)" }}
          >
            {syncing ? "…" : "拉取"}
          </button>
        </div>

        {result && (
          <p
            className="mt-3 p-2 rounded text-xs font-mono"
            style={
              result.ok
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
            {result.ok ? `✓ ${result.kind} 成功` : `✗ ${result.message ?? "失败"}`}
          </p>
        )}
      </section>

      {/* 自动同步 */}
      <section
        className="rounded-xl p-4 mb-4"
        style={{
          background: "var(--ink-2)",
          border: "1px solid var(--cream-line)",
        }}
      >
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
          AUTO PUSH
        </p>
        <div className="grid grid-cols-5 gap-1.5">
          {INTERVAL_OPTIONS.map((opt) => {
            const active = autoIntervalMin === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setAutoInterval(opt.value)}
                className="py-2 rounded-lg tap text-center text-[11px]"
                style={{
                  background: active ? "var(--ember-soft)" : "var(--ink-3)",
                  border: `1px solid ${
                    active ? "rgba(255,107,53,0.5)" : "var(--cream-line)"
                  }`,
                  color: active ? "var(--ember)" : "var(--cream)",
                  fontWeight: active ? 700 : 400,
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-cream-faint mt-2">
          仅在 DouyTV 运行时计时；启动后第一次到点才会推送
        </p>
      </section>

      {/* 状态 */}
      <div
        className="rounded-xl p-3.5 text-[11px] text-cream-dim leading-relaxed"
        style={{
          background: "var(--ink-2)",
          border: "1px solid var(--cream-line)",
        }}
      >
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
          STATUS
        </p>
        <p>
          上次同步 ·{" "}
          {lastSyncAt
            ? new Date(lastSyncAt).toLocaleString()
            : "尚未同步"}
        </p>
        <p className="mt-1">
          自动推送 · {autoIntervalMin === 0 ? "已关闭" : `每 ${autoIntervalMin} 分钟`}
        </p>
        <p className="mt-1">
          远端文件 · douytv-snapshot.json
        </p>
      </div>
    </SettingsSubPageLayout>
  );
}
