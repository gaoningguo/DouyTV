import { useEffect, useState } from "react";
import { useProxyStore } from "@/stores/proxy";
import { scriptFetch } from "@/source-script/fetch";
import { SettingsSubPageLayout } from "./Layout";

const TEST_URL = "https://www.google.com/generate_204";

export default function SettingsProxy() {
  const enabled = useProxyStore((s) => s.enabled);
  const url = useProxyStore((s) => s.url);
  const hydrate = useProxyStore((s) => s.hydrate);
  const setEnabled = useProxyStore((s) => s.setEnabled);
  const setUrl = useProxyStore((s) => s.setUrl);

  const [input, setInput] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: true; ms: number } | { ok: false; msg: string } | undefined
  >();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    setInput(url);
  }, [url]);

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

  return (
    <SettingsSubPageLayout eyebrow="NETWORK · PROXY" title="系统代理">
      <p className="text-[11px] text-cream-faint mb-4 leading-relaxed">
        启用后所有出站请求（脚本 fetch / 视频代理）都走配置的代理。失败时可在播放器内临时切换直连
      </p>

      <section
        className="rounded-xl p-4 mb-4"
        style={{
          background: "var(--ink-2)",
          border: "1px solid var(--cream-line)",
        }}
      >
        <label className="flex items-center justify-between mb-4">
          <div className="min-w-0">
            <p className="text-sm font-display font-semibold">启用代理</p>
            <p className="text-[11px] text-cream-faint mt-0.5">
              {enabled ? "ON · 所有请求走代理" : "OFF · 直连"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setEnabled(!enabled)}
            className="relative w-11 h-6 rounded-full transition-all shrink-0"
            style={{
              background: enabled ? "var(--ember)" : "var(--ink-edge)",
              boxShadow: enabled
                ? "0 0 12px rgba(255,107,53,0.4), inset 0 1px 0 rgba(255,255,255,0.18)"
                : "inset 0 1px 0 rgba(255,255,255,0.04)",
            }}
            aria-label={enabled ? "关闭代理" : "启用代理"}
          >
            <span
              className="absolute top-0.5 w-5 h-5 rounded-full transition-transform"
              style={{
                left: enabled ? "calc(100% - 22px)" : "2px",
                background: enabled ? "var(--ink)" : "var(--cream)",
              }}
            />
          </button>
        </label>

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
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setUrl(input.trim())}
            disabled={input.trim() === url}
            className="flex-1 py-2 rounded-lg text-xs font-display font-semibold tap disabled:opacity-50"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            保存
          </button>
          <button
            type="button"
            onClick={() => void runTest()}
            disabled={testing}
            className="flex-1 py-2 rounded-lg text-xs tap text-cream disabled:opacity-50"
            style={{
              background: "var(--ink-3)",
              border: "1px solid var(--cream-line)",
            }}
          >
            {testing ? "测试中…" : "测试连接"}
          </button>
        </div>

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
