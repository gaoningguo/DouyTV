/**
 * 电子书设置 —— 统一管理 OPDS 源 + 网络小说书源，两 tab 切换。
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { SettingsSubPageLayout } from "./Layout";
import { useBooksStore } from "@/stores/books";
import { fetchCatalog } from "@/lib/books/client";
import type { BookAuthMode, BookSource } from "@/lib/books/types";
import { IconTrash, IconPlus } from "@/components/Icon";
import { NovelSourcesPanel } from "./Novel";

type Tab = "opds" | "novel";

export default function SettingsBooks() {
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const v = localStorage.getItem("douytv:settings-books-tab");
      return v === "novel" ? "novel" : "opds";
    } catch {
      return "opds";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("douytv:settings-books-tab", tab);
    } catch {
      /* private */
    }
  }, [tab]);

  return (
    <SettingsSubPageLayout eyebrow="BOOKS · SOURCES" title="电子书源">
      <div className="grid grid-cols-2 gap-1 mb-4 p-1 rounded-lg"
        style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}>
        <TabBtn active={tab === "opds"} onClick={() => setTab("opds")}>
          OPDS · 个人书库
        </TabBtn>
        <TabBtn active={tab === "novel"} onClick={() => setTab("novel")}>
          网络小说 (Legado)
        </TabBtn>
      </div>
      {tab === "opds" ? <OpdsSourcesPanel /> : <NovelSourcesPanel />}
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

function OpdsSourcesPanel() {
  const store = useBooksStore();
  const hydrate = useBooksStore((s) => s.hydrate);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState<Omit<BookSource, "id" | "addedAt">>({
    name: "",
    url: "",
    enabled: true,
    authMode: "none",
  });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: true; entries: number } | { ok: false; msg: string } | undefined
  >();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const reset = () => {
    setDraft({ name: "", url: "", enabled: true, authMode: "none" });
    setTestResult(undefined);
    setShowAdd(false);
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(undefined);
    try {
      const tmp: BookSource = {
        id: "tmp",
        name: draft.name || "tmp",
        url: draft.url,
        authMode: draft.authMode,
        username: draft.username,
        password: draft.password,
        headerName: draft.headerName,
        headerValue: draft.headerValue,
      };
      const r = await fetchCatalog(tmp);
      setTestResult({
        ok: true,
        entries: r.entries.length + r.navigation.length,
      });
    } catch (e) {
      setTestResult({ ok: false, msg: (e as Error).message ?? String(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <div className="flex items-center mb-3">
        <p className="text-[11px] text-cream-faint leading-relaxed flex-1">
          OPDS 协议：Calibre Server / Komga / Kavita 等开源书库均支持
        </p>
        {!showAdd && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="px-3 py-1.5 rounded-full text-xs font-display font-semibold tap flex items-center gap-1"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            <IconPlus size={12} />
            添加
          </button>
        )}
      </div>

      {showAdd && (
        <section
          className="rounded-xl p-4 mb-4"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
        >
          <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-3">
            NEW OPDS SOURCE
          </p>
          <input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="名称（如 我的 Calibre）"
            className="w-full px-3 py-2 rounded-lg text-xs outline-none text-cream placeholder:text-cream-faint mb-2"
            style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
          />
          <input
            value={draft.url}
            onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
            placeholder="OPDS Feed URL（如 http://server:8080/opds）"
            className="w-full px-3 py-2 rounded-lg text-xs font-mono outline-none text-cream placeholder:text-cream-faint mb-3"
            style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
          />
          <div className="grid grid-cols-3 gap-1 mb-3">
            {(["none", "basic", "header"] as BookAuthMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setDraft((d) => ({ ...d, authMode: m }))}
                className="py-1.5 rounded-md text-[10px] font-display font-semibold tap"
                style={{
                  background: draft.authMode === m ? "var(--ember)" : "var(--ink-3)",
                  color: draft.authMode === m ? "var(--ink)" : "var(--cream-dim)",
                  border: "1px solid var(--cream-line)",
                }}
              >
                {m === "none" ? "无认证" : m === "basic" ? "Basic 认证" : "自定义头"}
              </button>
            ))}
          </div>
          {draft.authMode === "basic" && (
            <>
              <input
                value={draft.username ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, username: e.target.value }))}
                placeholder="用户名"
                className="w-full px-3 py-2 rounded-lg text-xs outline-none text-cream placeholder:text-cream-faint mb-2"
                style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
              />
              <input
                type="password"
                value={draft.password ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, password: e.target.value }))}
                placeholder="密码"
                className="w-full px-3 py-2 rounded-lg text-xs outline-none text-cream placeholder:text-cream-faint mb-3"
                style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
              />
            </>
          )}
          {draft.authMode === "header" && (
            <>
              <input
                value={draft.headerName ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, headerName: e.target.value }))}
                placeholder="Header 名（如 X-Token）"
                className="w-full px-3 py-2 rounded-lg text-xs font-mono outline-none text-cream placeholder:text-cream-faint mb-2"
                style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
              />
              <input
                value={draft.headerValue ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, headerValue: e.target.value }))}
                placeholder="Header 值"
                className="w-full px-3 py-2 rounded-lg text-xs font-mono outline-none text-cream placeholder:text-cream-faint mb-3"
                style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
              />
            </>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void runTest()}
              disabled={!draft.url.trim() || testing}
              className="flex-1 py-2 rounded-lg text-xs tap text-cream disabled:opacity-50"
              style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
            >
              {testing ? "测试中" : "测试"}
            </button>
            <button
              type="button"
              onClick={() => {
                store.addSource(draft);
                reset();
              }}
              disabled={!draft.name.trim() || !draft.url.trim()}
              className="flex-1 py-2 rounded-lg text-xs font-display font-semibold tap disabled:opacity-50"
              style={{ background: "var(--ember)", color: "var(--ink)" }}
            >
              添加
            </button>
            <button
              type="button"
              onClick={reset}
              className="px-3 py-2 rounded-lg text-xs tap text-cream"
              style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
            >
              取消
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
                ? `✓ 连通 · ${testResult.entries} 条`
                : `✗ 失败 · ${testResult.msg}`}
            </p>
          )}
        </section>
      )}

      {store.sources.length === 0 && !showAdd ? (
        <p className="text-[11px] text-cream-faint text-center py-8">
          尚未添加 OPDS 源
        </p>
      ) : (
        <ul className="space-y-2">
          {store.sources.map((src) => (
            <li
              key={src.id}
              className="rounded-xl p-3"
              style={{
                background: "var(--ink-2)",
                border: "1px solid var(--cream-line)",
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{
                    background:
                      src.enabled !== false
                        ? "var(--phosphor)"
                        : "var(--ink-edge)",
                  }}
                />
                <p className="text-sm font-display font-semibold flex-1">
                  {src.name}
                </p>
                <button
                  type="button"
                  onClick={() => store.removeSource(src.id)}
                  className="w-7 h-7 flex items-center justify-center rounded tap text-cream-faint"
                  style={{ background: "var(--ink-3)" }}
                  aria-label="删除"
                >
                  <IconTrash size={12} />
                </button>
              </div>
              <p className="text-[10px] font-mono text-cream-faint truncate">
                {src.url}
              </p>
              {src.authMode && src.authMode !== "none" && (
                <p className="text-[10px] text-cream-faint mt-0.5">
                  认证：{src.authMode === "basic" ? "Basic" : "Header"}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6">
        <Link
          to="/books"
          className="block w-full text-center py-2 rounded-lg text-xs tap text-cream"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
        >
          打开电子书首页 →
        </Link>
      </div>
    </div>
  );
}
