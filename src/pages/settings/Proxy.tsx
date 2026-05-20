import { useEffect, useState } from "react";
import { useProxyStore, type ProxyMode } from "@/stores/proxy";
import { isMobile } from "@/lib/platform";
import { scriptFetch } from "@/source-script/fetch";
import { SettingsSubPageLayout } from "./Layout";

const TEST_URL = "https://www.google.com/generate_204";

const MODE_OPTIONS: Array<{ id: ProxyMode; label: string; desc: string }> = [
  { id: "auto", label: "AUTO", desc: "跟随系统代理" },
  { id: "manual", label: "MANUAL", desc: "手动指定" },
  { id: "off", label: "OFF", desc: "直连" },
];

export default function SettingsProxy() {
  const mode = useProxyStore((s) => s.mode);
  const manualUrl = useProxyStore((s) => s.manualUrl);
  const systemProxyUrl = useProxyStore((s) => s.systemProxyUrl);
  const hydrate = useProxyStore((s) => s.hydrate);
  const setMode = useProxyStore((s) => s.setMode);
  const setManualUrl = useProxyStore((s) => s.setManualUrl);
  const refreshSystemProxy = useProxyStore((s) => s.refreshSystemProxy);

  const [input, setInput] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: true; ms: number } | { ok: false; msg: string } | undefined
  >();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    setInput(manualUrl);
  }, [manualUrl]);

  const runTest = async () => {
    setTesting(true);
    setTestResult(undefined);
    const start = Date.now();
    try {
      const res = await scriptFetch(TEST_URL, { timeout: 8000 });
      if (res.status >= 200 && res.status < 400) {
        setTestResult({ ok: true, ms: Date.now() - start });
      } else {
        setTestResult({ ok: false, msg: `HTTP ${res.status}` });
      }
    } catch (e) {
      setTestResult({ ok: false, msg: (e as Error).message ?? String(e) });
    } finally {
      setTesting(false);
    }
  };

  const mobile = isMobile();

  return (
    <SettingsSubPageLayout eyebrow="NETWORK · PROXY" title="系统代理">
      <p className="text-[11px] text-cream-faint mb-4 leading-relaxed">
        AUTO 会自动读取桌面 OS 的系统代理；MANUAL 用你填的地址；OFF 强制直连。
        {mobile && " · 移动端 VPN/系统代理已在网络栈层透明转发，固定 AUTO 即可。"}
      </p>

      {/* 模式切换 */}
      <section
        className="rounded-xl p-4 mb-4"
        style={{
          background: "var(--ink-2)",
          border: "1px solid var(--cream-line)",
        }}
      >
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
          MODE
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          {MODE_OPTIONS.map((opt) => {
            const active = mode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                disabled={mobile && opt.id !== "auto"}
                onClick={() => setMode(opt.id)}
                className="py-2.5 rounded-lg tap text-center disabled:opacity-40"
                style={{
                  background: active ? "var(--ember-soft)" : "var(--ink-3)",
                  border: `1px solid ${
                    active ? "rgba(255,107,53,0.5)" : "var(--cream-line)"
                  }`,
                  boxShadow: active
                    ? "0 0 12px rgba(255,107,53,0.25), inset 0 1px 0 rgba(255,255,255,0.06)"
                    : undefined,
                }}
              >
                <p
                  className="font-mono text-[11px] tracking-[0.18em] font-bold"
                  style={{ color: active ? "var(--ember)" : "var(--cream)" }}
                >
                  {opt.label}
                </p>
                <p className="text-[10px] text-cream-faint mt-0.5">{opt.desc}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* AUTO 模式：展示检测到的系统代理 */}
      {mode === "auto" && (
        <section
          className="rounded-xl p-4 mb-4"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
              DETECTED
            </p>
            {!mobile && (
              <button
                type="button"
                onClick={() => void refreshSystemProxy()}
                className="text-[10px] font-mono tracking-wider text-cream-faint hover:text-cream tap"
              >
                REFRESH
              </button>
            )}
          </div>
          <p className="font-mono text-xs">
            {mobile ? (
              <span className="text-cream-faint">
                ─ 移动端不读取，由 OS VPN 接管
              </span>
            ) : systemProxyUrl ? (
              <span style={{ color: "var(--phosphor)" }}>{systemProxyUrl}</span>
            ) : (
              <span className="text-cream-faint">─ 未检测到系统代理（直连）</span>
            )}
          </p>
        </section>
      )}

      {/* MANUAL 模式：URL 输入 */}
      {mode === "manual" && (
        <section
          className="rounded-xl p-4 mb-4"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
        >
          <label className="block font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-1">
            PROXY URL
          </label>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="http://127.0.0.1:7890 或 socks5://127.0.0.1:1080"
            className="w-full px-3 py-2 rounded-lg text-xs font-mono outline-none text-cream placeholder:text-cream-faint mb-3"
            style={{
              background: "var(--ink-3)",
              border: "1px solid var(--cream-line)",
            }}
          />
          <button
            type="button"
            onClick={() => setManualUrl(input.trim())}
            disabled={input.trim() === manualUrl}
            className="w-full py-2 rounded-lg text-xs font-display font-semibold tap disabled:opacity-50"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            保存
          </button>
        </section>
      )}

      {/* 测试连接（所有模式都可用） */}
      <section
        className="rounded-xl p-4 mb-4"
        style={{
          background: "var(--ink-2)",
          border: "1px solid var(--cream-line)",
        }}
      >
        <button
          type="button"
          onClick={() => void runTest()}
          disabled={testing}
          className="w-full py-2 rounded-lg text-xs tap text-cream disabled:opacity-50"
          style={{
            background: "var(--ink-3)",
            border: "1px solid var(--cream-line)",
          }}
        >
          {testing ? "测试中…" : "测试连接 (google.com/generate_204)"}
        </button>
        {testResult && (
          <p
            className="mt-3 p-2 rounded text-xs font-mono"
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
            {testResult.ok
              ? `✓ 连通 · ${testResult.ms}ms`
              : `✗ 失败 · ${testResult.msg}`}
          </p>
        )}
      </section>

      <div
        className="rounded-xl p-3.5 text-[11px] text-cream-dim leading-relaxed"
        style={{
          background: "var(--ink-2)",
          border: "1px solid var(--cream-line)",
        }}
      >
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
          支持格式
        </p>
        <ul className="space-y-1 font-mono text-[10px]">
          <li>
            <span className="text-ember">http://</span> · HTTP 代理
          </li>
          <li>
            <span className="text-ember">https://</span> · HTTPS 代理
          </li>
          <li>
            <span className="text-ember">socks5://</span> · SOCKS5 代理
          </li>
        </ul>
        <p className="mt-2 text-[10px]">
          代理失败时在 VideoPlayer 错误页可临时切换至直连
        </p>
      </div>
    </SettingsSubPageLayout>
  );
}
