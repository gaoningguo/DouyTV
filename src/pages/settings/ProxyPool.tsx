import { useEffect, useState } from "react";
import { useProxyPoolStore } from "@/stores/proxyPool";
import { SettingsSubPageLayout } from "./Layout";

export default function SettingsProxyPool() {
  const {
    enabled,
    server,
    current,
    currentLatency,
    rotating,
    hydrate,
    setEnabled,
    setServer,
  } = useProxyPoolStore();

  const [input, setInput] = useState("");

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    setInput(server);
  }, [server]);

  const serverDirty = input.trim() !== server;

  return (
    <SettingsSubPageLayout eyebrow="NETWORK · PROXY POOL" title="代理池">
      <p className="text-[11px] text-cream-faint mb-4 leading-relaxed">
        对接一个自建的 proxypool 服务端（采集免费代理并提供 REST API）。开启后【反应式】工作：
        源脚本请求平时正常发；一旦遇到 429 / 封 IP，才从服务端抓一个随机代理切过去重试，
        之后沿用该代理直到它也被封再换。抓不到代理则回落系统代理 / 直连。
      </p>

      {/* 启用开关 */}
      <section
        className="rounded-xl p-4 mb-4 flex items-center justify-between"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
      >
        <div>
          <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-1">
            ENABLE
          </p>
          <p className="text-xs text-cream-dim">
            {enabled
              ? "已启用 · 被封时自动换代理"
              : server
                ? "已关闭"
                : "先填服务端地址"}
          </p>
        </div>
        <button
          type="button"
          disabled={!server}
          onClick={() => setEnabled(!enabled)}
          className="relative w-12 h-7 rounded-full tap shrink-0 disabled:opacity-40"
          style={{
            background: enabled ? "var(--ember)" : "var(--ink-3)",
            border: "1px solid var(--cream-line)",
          }}
          aria-pressed={enabled}
        >
          <span
            className="absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full transition-all"
            style={{
              left: enabled ? "calc(100% - 22px)" : "2px",
              background: enabled ? "var(--ink)" : "var(--cream-faint)",
            }}
          />
        </button>
      </section>

      {/* 服务端地址 */}
      <section
        className="rounded-xl p-4 mb-4"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
      >
        <label className="block font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-1">
          SERVER URL
        </label>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="https://myproxypool.up.railway.app"
          className="w-full px-3 py-2 rounded-lg text-xs font-mono outline-none text-cream placeholder:text-cream-faint mb-3"
          style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
        />
        <button
          type="button"
          onClick={() => setServer(input.trim())}
          disabled={!serverDirty}
          className="w-full py-2 rounded-lg text-xs font-display font-semibold tap disabled:opacity-50"
          style={{ background: "var(--ember)", color: "var(--ink)" }}
        >
          保存地址
        </button>
      </section>

      {/* 当前代理状态 */}
      <section
        className="rounded-xl p-4 mb-4"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
      >
        <div className="flex items-center justify-between mb-3">
          <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
            CURRENT PROXY
          </p>
          <span className="font-mono text-[10px] text-cream-faint">
            {rotating ? "换代理中…" : current ? "使用中" : "未启用(直连/全局)"}
          </span>
        </div>
        {current ? (
          <div
            className="flex items-center justify-between font-mono text-[11px] px-2 py-1.5 rounded"
            style={{ background: "var(--ink-3)" }}
          >
            <span className="text-cream-dim truncate mr-2">{current}</span>
            {currentLatency > 0 && (
              <span style={{ color: "var(--phosphor)" }}>{currentLatency}ms</span>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-cream-faint">
            当前走直连 / 全局代理，遇到 429 / 封 IP 时会自动抓代理。
          </p>
        )}
      </section>
    </SettingsSubPageLayout>
  );
}
