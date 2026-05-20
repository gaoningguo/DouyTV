/**
 * 漫画设置 —— Suwayomi 服务 + JSON 漫画源 两 tab。
 */
import { useEffect, useState } from "react";
import { useMangaStore } from "@/stores/manga";
import { getSources } from "@/lib/manga/client";
import { SettingsSubPageLayout } from "./Layout";
import { MangaSrcPanel } from "./MangaSrc";

type Tab = "suwayomi" | "json";

export default function SettingsManga() {
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const v = localStorage.getItem("douytv:settings-manga-tab");
      return v === "json" ? "json" : "suwayomi";
    } catch {
      return "suwayomi";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("douytv:settings-manga-tab", tab);
    } catch {
      /* private */
    }
  }, [tab]);

  return (
    <SettingsSubPageLayout eyebrow="MANGA · SOURCES" title="漫画源">
      <div
        className="grid grid-cols-2 gap-1 mb-4 p-1 rounded-lg"
        style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
      >
        <TabBtn active={tab === "suwayomi"} onClick={() => setTab("suwayomi")}>
          Suwayomi 服务
        </TabBtn>
        <TabBtn active={tab === "json"} onClick={() => setTab("json")}>
          JSON 自定义源
        </TabBtn>
      </div>
      {tab === "suwayomi" ? <SuwayomiPanel /> : <MangaSrcPanel />}
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
      className="py-1.5 rounded text-[11px] font-display font-semibold tap"
      style={{
        background: active ? "var(--ember-soft)" : "transparent",
        color: active ? "var(--ember)" : "var(--cream-dim)",
        border: `1px solid ${active ? "rgba(255,107,53,0.4)" : "transparent"}`,
      }}
    >
      {children}
    </button>
  );
}

function SuwayomiPanel() {
  const store = useMangaStore();
  const hydrate = useMangaStore((s) => s.hydrate);
  const [urlInput, setUrlInput] = useState("");
  const [userInput, setUserInput] = useState("");
  const [passInput, setPassInput] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: true; count: number } | { ok: false; msg: string } | undefined
  >();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    setUrlInput(store.serverUrl);
    setUserInput(store.username);
    setPassInput(store.password);
  }, [store.serverUrl, store.username, store.password]);

  const save = () => {
    store.setServerUrl(urlInput.trim());
    store.setUsername(userInput.trim());
    store.setPassword(passInput);
  };

  const runTest = async () => {
    save();
    setTesting(true);
    setTestResult(undefined);
    try {
      const list = await getSources("zh");
      setTestResult({ ok: true, count: list.length });
    } catch (e) {
      setTestResult({ ok: false, msg: (e as Error).message ?? String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <p className="text-[11px] text-cream-faint mb-4 leading-relaxed">
        Suwayomi-Server (Tachidesk 后继) —— 自部署服务，扩展在 Suwayomi 后台安装管理
      </p>

      <section
        className="rounded-xl p-4 mb-4"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
      >
        <label className="block font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-1">
          SERVER URL
        </label>
        <input
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="http://localhost:4567"
          className="w-full px-3 py-2 rounded-lg text-xs font-mono outline-none text-cream placeholder:text-cream-faint mb-3"
          style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
        />
        <label className="block font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-1">
          BASIC USERNAME（可选）
        </label>
        <input
          value={userInput}
          onChange={(e) => setUserInput(e.target.value)}
          placeholder="（如未启用 Basic 认证则留空）"
          className="w-full px-3 py-2 rounded-lg text-xs font-mono outline-none text-cream placeholder:text-cream-faint mb-3"
          style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
        />
        <label className="block font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-1">
          BASIC PASSWORD（可选）
        </label>
        <input
          type="password"
          value={passInput}
          onChange={(e) => setPassInput(e.target.value)}
          className="w-full px-3 py-2 rounded-lg text-xs font-mono outline-none text-cream placeholder:text-cream-faint mb-3"
          style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
        />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={save}
            className="flex-1 py-2 rounded-lg text-xs font-display font-semibold tap"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            保存
          </button>
          <button
            type="button"
            onClick={() => void runTest()}
            disabled={testing || !urlInput.trim()}
            className="flex-1 py-2 rounded-lg text-xs tap text-cream disabled:opacity-50"
            style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
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
              ? `✓ 连通 · ${testResult.count} 个已启用源`
              : `✗ 失败 · ${testResult.msg}`}
          </p>
        )}
      </section>
    </div>
  );
}
