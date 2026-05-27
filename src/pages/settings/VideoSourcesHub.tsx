/**
 * 视频管理 —— 三 Tab 内联布局
 *   ┌─ 视频源 ─┬─ 订阅 ─┬─ 本地视频 ─┐
 *   视频源 tab : 源列表 + 批量操作 + 弹窗添加（CMS / JS / JSON）
 *   订阅 tab   : 多订阅管理 + JSON 文本导入
 *   本地视频 tab : 扫描目录入口
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useScriptStore } from "@/stores/scripts";
import { useConfigSubStore } from "@/stores/configSubscription";
import { BUILTIN_SCRIPTS } from "@/source-script/builtin";
import { SettingsSubPageLayout } from "./Layout";
import {
  IconPlus,
  IconTrash,
  IconRefresh,
  IconChevronRight,
  IconCheck,
} from "@/components/Icon";

type Tab = "scripts" | "config-sub" | "local";
type Dialog = "add-cms" | "add-script" | "import-json" | "add-sub" | undefined;
const TAB_KEY = "douytv:video-hub-tab";

function readTab(): Tab {
  try { const v = localStorage.getItem(TAB_KEY); if (v === "config-sub" || v === "local") return v; } catch {}
  return "scripts";
}

export default function VideoSourcesHub() {
  const [tab, setTab] = useState<Tab>(readTab);
  useEffect(() => { try { localStorage.setItem(TAB_KEY, tab); } catch {} }, [tab]);

  const hydrateScripts = useScriptStore((s) => s.hydrate);
  const hydrateConfigSub = useConfigSubStore((s) => s.hydrate);
  useEffect(() => { hydrateScripts(); hydrateConfigSub(); }, [hydrateScripts, hydrateConfigSub]);

  const tabBar = (
    <div className="flex gap-1 p-1 mx-4 mt-3 mb-1 rounded-lg" style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}>
      <TabBtn active={tab === "scripts"} onClick={() => setTab("scripts")}>视频源</TabBtn>
      <TabBtn active={tab === "config-sub"} onClick={() => setTab("config-sub")}>订阅</TabBtn>
      <TabBtn active={tab === "local"} onClick={() => setTab("local")}>本地视频</TabBtn>
    </div>
  );

  return (
    <SettingsSubPageLayout eyebrow="SETTINGS" title="视频管理" toolbar={tabBar}>
      {tab === "scripts" && <ScriptsTab />}
      {tab === "config-sub" && <ConfigSubTab />}
      {tab === "local" && <LocalTab />}
    </SettingsSubPageLayout>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className="flex-1 inline-flex items-center justify-center py-2 rounded-md text-[12px] font-display font-semibold tap transition-colors"
      style={{ background: active ? "var(--ember)" : "transparent", color: active ? "var(--ink)" : "var(--cream-dim)" }}
    >{children}</button>
  );
}

/* ═══════════════════════════════════════════════════
   视频源 Tab — 列表 + 批量 + 弹窗添加
   ═══════════════════════════════════════════════════ */
function ScriptsTab() {
  const scripts = useScriptStore((s) => s.scripts);
  const toggle = useScriptStore((s) => s.toggle);
  const uninstall = useScriptStore((s) => s.uninstall);
  const install = useScriptStore((s) => s.install);
  const importFromJson = useScriptStore((s) => s.importFromJson);
  const toggleMany = useScriptStore((s) => s.toggleMany);
  const uninstallMany = useScriptStore((s) => s.uninstallMany);

  const [dialog, setDialog] = useState<Dialog>(undefined);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const builtinKeys = useMemo(() => new Set(BUILTIN_SCRIPTS.map((b) => b.key)), []);
  const enabledCount = useMemo(() => scripts.filter((s) => s.enabled).length, [scripts]);

  // CMS form
  const [cmsKey, setCmsKey] = useState("");
  const [cmsName, setCmsName] = useState("");
  const [cmsApi, setCmsApi] = useState("");
  const [cmsUa, setCmsUa] = useState("");
  const [cmsReferer, setCmsReferer] = useState("");
  // Script form
  const [scriptKey, setScriptKey] = useState("");
  const [scriptName, setScriptName] = useState("");
  const [scriptCode, setScriptCode] = useState("");
  // JSON import
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | undefined>();

  const exitSelect = () => { setSelectMode(false); setSelected(new Set()); };
  const toggleSel = (key: string) => { const n = new Set(selected); if (n.has(key)) n.delete(key); else n.add(key); setSelected(n); };

  const handleAddCms = () => {
    if (!cmsKey.trim() || !cmsName.trim() || !cmsApi.trim()) return;
    install({ key: cmsKey.trim(), name: cmsName.trim(), type: "cms", api: cmsApi.trim(), ua: cmsUa.trim() || undefined, referer: cmsReferer.trim() || undefined, enabled: true });
    setCmsKey(""); setCmsName(""); setCmsApi(""); setCmsUa(""); setCmsReferer(""); setDialog(undefined);
  };
  const handleAddScript = () => {
    if (!scriptKey.trim() || !scriptName.trim() || !scriptCode.trim()) return;
    install({ key: scriptKey.trim(), name: scriptName.trim(), type: "script", code: scriptCode, enabled: true });
    setScriptKey(""); setScriptName(""); setScriptCode(""); setDialog(undefined);
  };
  const handleImport = () => {
    setImportError(undefined);
    if (!importFromJson(importText)) { setImportError("JSON 格式不正确"); return; }
    setImportText(""); setDialog(undefined);
  };

  return (
    <div>
      {/* 概览 + 操作栏 */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-mono text-cream-faint">
          {scripts.length} 个源 · {enabledCount} 启用
        </p>
        <div className="flex gap-1.5">
          {!selectMode ? (
            <>
              <SmallBtn onClick={() => setDialog("add-cms")}>CMS</SmallBtn>
              <SmallBtn onClick={() => setDialog("add-script")}>脚本</SmallBtn>
              <SmallBtn onClick={() => setDialog("import-json")}>JSON</SmallBtn>
              {scripts.length > 0 && (
                <button type="button" onClick={() => setSelectMode(true)} className="text-[9px] font-mono tap text-cream-faint px-2 py-1 rounded" style={{ background: "var(--ink-3)" }}>选择</button>
              )}
            </>
          ) : (
            <button type="button" onClick={exitSelect} className="text-[9px] font-display font-semibold tap px-2 py-1 rounded" style={{ background: "var(--ember)", color: "var(--ink)" }}>完成</button>
          )}
        </div>
      </div>

      {/* 批量操作栏 */}
      {selectMode && (
        <div className="flex gap-1.5 mb-3 sticky top-0 z-10 py-2 -mx-4 px-4" style={{ background: "var(--ink)" }}>
          <button type="button" onClick={() => setSelected(new Set(scripts.map((s) => s.key)))} className="flex-1 py-1.5 rounded text-[9px] font-mono tap text-cream" style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}>全选</button>
          <button type="button" onClick={() => { if (selected.size) toggleMany(Array.from(selected), true); }} disabled={!selected.size} className="flex-1 py-1.5 rounded text-[9px] tap disabled:opacity-40" style={{ background: "var(--ember-soft)", color: "var(--ember)" }}>启用</button>
          <button type="button" onClick={() => { if (selected.size) toggleMany(Array.from(selected), false); }} disabled={!selected.size} className="flex-1 py-1.5 rounded text-[9px] tap disabled:opacity-40 text-cream" style={{ background: "var(--ink-3)" }}>停用</button>
          <button type="button" onClick={() => {
            const removable = Array.from(selected).filter((k) => !builtinKeys.has(k));
            if (!removable.length) { alert("选中项均为内置源"); return; }
            if (confirm(`删除 ${removable.length} 个源？`)) { uninstallMany(removable); exitSelect(); }
          }} disabled={!selected.size} className="flex-1 py-1.5 rounded text-[9px] tap disabled:opacity-40" style={{ background: "rgba(255,80,80,0.12)", color: "#FF6B6B" }}>删除</button>
        </div>
      )}

      {/* 源列表 */}
      <div className="space-y-1.5">
        {scripts.map((s) => {
          const isBuiltin = builtinKeys.has(s.key);
          const type = s.type ?? "script";
          const isSel = selected.has(s.key);
          return (
            <div key={s.key} onClick={selectMode ? () => toggleSel(s.key) : undefined}
              className={`p-2.5 rounded-lg ${selectMode ? "cursor-pointer" : ""}`}
              style={{ background: selectMode && isSel ? "var(--ember-soft)" : "var(--ink-2)", border: `1px solid ${selectMode && isSel ? "var(--ember)" : s.enabled ? "rgba(255,107,53,0.2)" : "var(--cream-line)"}`, opacity: s.enabled ? 1 : 0.6 }}>
              <div className="flex items-center gap-2">
                {selectMode && (
                  <div className="w-4 h-4 rounded shrink-0 flex items-center justify-center" style={{ background: isSel ? "var(--ember)" : "transparent", border: `1.5px solid ${isSel ? "var(--ember)" : "var(--cream-faint)"}` }}>
                    {isSel && <IconCheck size={10} />}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="font-display font-semibold text-[11px] text-cream truncate">{s.name}</p>
                    <span className="font-mono text-[8px] px-1 py-0.5 rounded" style={type === "cms" ? { background: "var(--vhs-soft)", color: "var(--vhs)" } : { background: "var(--phosphor-soft)", color: "var(--phosphor)" }}>{type === "cms" ? "CMS" : "SCRIPT"}</span>
                    {isBuiltin && <span className="font-mono text-[8px] px-1 py-0.5 rounded" style={{ background: "var(--ink-3)", color: "var(--cream-faint)" }}>内置</span>}
                  </div>
                  <p className="font-mono text-[8px] text-cream-faint truncate mt-0.5">{s.key}{type === "cms" && s.api ? ` · ${s.api}` : ""}</p>
                </div>
                {!selectMode && (
                  <>
                    <button type="button" onClick={() => toggle(s.key)} className="px-2 py-1 rounded text-[9px] font-mono font-bold tap" style={{ background: s.enabled ? "var(--ember-soft)" : "var(--ink-3)", color: s.enabled ? "var(--ember)" : "var(--cream-faint)" }}>
                      {s.enabled ? "ON" : "OFF"}
                    </button>
                    {!isBuiltin && (
                      <button type="button" onClick={() => { if (confirm(`卸载「${s.name}」？`)) uninstall(s.key); }} className="p-1 rounded tap" style={{ color: "#FF6B6B" }}>
                        <IconTrash size={10} />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ─── 弹窗 ─── */}
      {dialog === "add-cms" && (
        <DialogSheet onClose={() => setDialog(undefined)} title="添加 CMS V10 源" hint="MoonTV 兼容：?ac=videolist&wd= / &ids=">
          <DInput value={cmsKey} onChange={setCmsKey} placeholder="唯一 key（如 myvod）" />
          <DInput value={cmsName} onChange={setCmsName} placeholder="显示名称" />
          <DInput value={cmsApi} onChange={setCmsApi} placeholder="API base URL" />
          <DInput value={cmsUa} onChange={setCmsUa} placeholder="User-Agent（可选）" />
          <DInput value={cmsReferer} onChange={setCmsReferer} placeholder="Referer（可选）" />
          <DialogActions onCancel={() => setDialog(undefined)} onConfirm={handleAddCms} disabled={!cmsKey.trim() || !cmsName.trim() || !cmsApi.trim()} />
        </DialogSheet>
      )}
      {dialog === "add-script" && (
        <DialogSheet onClose={() => setDialog(undefined)} title="添加 JS 脚本源" hint="source-script 协议：导出 getSources/search/recommend/detail/resolvePlayUrl">
          <DInput value={scriptKey} onChange={setScriptKey} placeholder="唯一 key" />
          <DInput value={scriptName} onChange={setScriptName} placeholder="显示名称" />
          <textarea value={scriptCode} onChange={(e) => setScriptCode(e.target.value)} placeholder="return { meta:{...}, async search(ctx,{keyword,page}){...} }" className="w-full h-40 p-2.5 rounded text-[11px] font-mono outline-none text-cream placeholder:text-cream-faint resize-none mb-2" style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }} />
          <DialogActions onCancel={() => setDialog(undefined)} onConfirm={handleAddScript} disabled={!scriptKey.trim() || !scriptName.trim() || !scriptCode.trim()} />
        </DialogSheet>
      )}
      {dialog === "import-json" && (
        <DialogSheet onClose={() => setDialog(undefined)} title="单源 JSON 导入" hint='{"key":"...","name":"...","type":"script|cms","code":"..." | "api":"..."}'>
          <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="粘贴单个源 JSON" className="w-full h-36 p-2.5 rounded text-[11px] font-mono outline-none text-cream placeholder:text-cream-faint resize-none mb-2" style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }} />
          {importError && <p className="text-[10px] font-mono p-2 rounded mb-2" style={{ background: "rgba(255,80,80,0.08)", color: "#FF6B6B" }}>{importError}</p>}
          <DialogActions onCancel={() => setDialog(undefined)} onConfirm={handleImport} disabled={!importText.trim()} confirmLabel="导入" />
        </DialogSheet>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   订阅 Tab — 多订阅 + JSON 导入
   ═══════════════════════════════════════════════════ */
function ConfigSubTab() {
  const subscriptions = useConfigSubStore((s) => s.subscriptions);
  const refreshing = useConfigSubStore((s) => s.refreshing);
  const loading = useConfigSubStore((s) => s.loading);
  const add = useConfigSubStore((s) => s.add);
  const remove = useConfigSubStore((s) => s.remove);
  const refresh = useConfigSubStore((s) => s.refresh);
  const refreshAll = useConfigSubStore((s) => s.refreshAll);
  const setAutoUpdate = useConfigSubStore((s) => s.setAutoUpdate);
  const importJson = useConfigSubStore((s) => s.importJson);

  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [jsonInput, setJsonInput] = useState("");
  const [showJson, setShowJson] = useState(false);
  const [refreshAllBusy, setRefreshAllBusy] = useState(false);
  const [doneMsg, setDoneMsg] = useState<string | undefined>();

  const onAdd = async () => {
    if (!addUrl.trim()) return;
    setAddBusy(true);
    try { await add(addName.trim(), addUrl.trim()); setAddName(""); setAddUrl(""); setShowAdd(false); }
    catch (e) { alert(`订阅失败：${(e as Error).message}`); }
    finally { setAddBusy(false); }
  };

  const onRefreshAll = async () => {
    setRefreshAllBusy(true);
    setDoneMsg(undefined);
    try {
      await refreshAll();
      setDoneMsg("全部刷新完成");
      setTimeout(() => setDoneMsg(undefined), 3000);
    } catch {}
    finally { setRefreshAllBusy(false); }
  };

  const isAnyRefreshing = refreshing.size > 0 || refreshAllBusy;

  return (
    <div>
      {/* 操作栏 */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-mono text-cream-faint">
          {subscriptions.length === 0 ? "暂无订阅，添加远程配置 URL" : `${subscriptions.length} 个订阅`}
          {isAnyRefreshing && <span className="ml-2 text-ember animate-pulse">刷新中…</span>}
          {doneMsg && <span className="ml-2 text-phosphor">{doneMsg}</span>}
        </p>
        <div className="flex gap-1.5">
          {subscriptions.length > 0 && (
            <button type="button" onClick={onRefreshAll} disabled={refreshAllBusy} className="text-[9px] font-mono tap text-cream-faint px-2 py-1 rounded flex items-center gap-1 disabled:opacity-60" style={{ background: "var(--ink-3)" }}>
              <IconRefresh size={10} className={refreshAllBusy ? "animate-spin" : ""} />
              {refreshAllBusy ? "刷新中" : "全部刷新"}
            </button>
          )}
          <SmallBtn onClick={() => setShowAdd((v) => !v)}>添加订阅</SmallBtn>
        </div>
      </div>

      {/* 添加表单 */}
      {showAdd && (
        <div className="p-3 rounded-lg mb-3" style={{ background: "var(--ink-2)", border: "1px solid rgba(255,107,53,0.3)" }}>
          <p className="text-[10px] font-mono text-cream-faint mb-1.5">MoonTV / TVBox 兼容配置文件，24h 自动刷新</p>
          <DInput value={addName} onChange={setAddName} placeholder="订阅名（可选）" />
          <DInput value={addUrl} onChange={setAddUrl} placeholder="https://example.com/config.json" />
          <div className="flex gap-2">
            <button type="button" onClick={onAdd} disabled={!addUrl.trim() || addBusy} className="flex-1 py-1.5 rounded text-[10px] font-display font-semibold tap disabled:opacity-40" style={{ background: "var(--ember)", color: "var(--ink)" }}>
              {addBusy ? "添加中…" : "添加并刷新"}
            </button>
            <button type="button" onClick={() => setShowAdd(false)} className="px-3 py-1.5 rounded text-[10px] tap text-cream-faint" style={{ background: "var(--ink-3)" }}>取消</button>
          </div>
        </div>
      )}

      {/* 订阅列表 */}
      <div className="space-y-1.5 mb-4">
        {subscriptions.map((sub) => (
          <div key={sub.id} className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-display font-semibold text-cream truncate">{sub.name}</p>
              <p className="font-mono text-[8px] text-cream-faint truncate">{sub.url}</p>
              <div className="flex gap-2 mt-0.5 text-[8px] font-mono text-cream-faint">
                {sub.lastResult && <span>源 {sub.lastResult.sourcesAdded} / 直播 {sub.lastResult.livesAdded}</span>}
                {sub.updatedAt && <span>{new Date(sub.updatedAt).toLocaleDateString()}</span>}
                {sub.error && <span style={{ color: "#FF6B6B" }}>!</span>}
              </div>
            </div>
            <label className="flex items-center gap-1 text-[8px] text-cream-faint shrink-0">
              <input type="checkbox" checked={sub.autoUpdate} onChange={(e) => setAutoUpdate(sub.id, e.target.checked)} className="accent-ember w-3 h-3" />
              自动
            </label>
            <button type="button" onClick={() => void refresh(sub.id).catch(() => {})} disabled={refreshing.has(sub.id)} className="p-1 rounded tap text-cream-faint disabled:opacity-40" style={{ background: "var(--ink-3)" }}>
              <IconRefresh size={10} className={refreshing.has(sub.id) ? "animate-spin" : ""} />
            </button>
            <button type="button" onClick={() => { if (confirm(`删除订阅「${sub.name}」？`)) remove(sub.id); }} className="p-1 rounded tap" style={{ color: "#FF6B6B" }}>
              <IconTrash size={10} />
            </button>
          </div>
        ))}
      </div>

      {/* JSON 文本导入 */}
      <button type="button" onClick={() => setShowJson((v) => !v)} className="flex items-center gap-1.5 text-[10px] font-mono text-cream-faint tap mb-2">
        <span className={`transition-transform ${showJson ? "" : "-rotate-90"}`}>▾</span>
        JSON 文本导入（一次性）
      </button>
      {showJson && (
        <div className="p-3 rounded-lg" style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}>
          <p className="text-[10px] font-mono text-cream-faint mb-1.5">粘贴 MoonTV/TVBox 配置 JSON 批量导入</p>
          <textarea value={jsonInput} onChange={(e) => setJsonInput(e.target.value)} placeholder='{"api_site":{...}, "lives":{...}}' className="w-full h-28 px-2.5 py-1.5 rounded text-[10px] font-mono outline-none text-cream placeholder:text-cream-faint resize-none mb-2" style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }} />
          <button type="button" onClick={async () => {
            try {
              const result = await importJson(jsonInput);
              alert(`导入成功：${result.sourcesAdded} 个源 + ${result.livesAdded} 个直播${result.ignoredJarSites ? ` · 跳过 ${result.ignoredJarSites} 个 Java 源` : ""}`);
              setJsonInput("");
            } catch (e) { alert(`导入失败：${(e as Error).message}`); }
          }} disabled={!jsonInput.trim() || loading} className="w-full py-1.5 rounded text-[10px] font-display font-semibold tap disabled:opacity-40" style={{ background: "var(--ember)", color: "var(--ink)" }}>
            {loading ? "导入中…" : "导入 JSON"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   本地视频 Tab
   ═══════════════════════════════════════════════════ */
function LocalTab() {
  return (
    <div className="p-4 rounded-lg" style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}>
      <p className="text-[11px] font-display font-semibold text-cream mb-1">本地视频扫描</p>
      <p className="text-[10px] font-mono text-cream-faint mb-3">扫描本地目录中的视频文件（mp4/mkv/webm/mov/flv 等），离线播放。</p>
      <Link to="/settings/local-scan" className="flex items-center justify-between px-3 py-2 rounded-lg tap" style={{ background: "var(--ember)", color: "var(--ink)", fontSize: 11, fontWeight: 600 }}>
        <span>选择目录并扫描</span>
        <IconChevronRight size={14} />
      </Link>
    </div>
  );
}

/* ─── Shared UI ─── */
function SmallBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-[9px] font-display font-semibold tap px-2 py-1 rounded" style={{ background: "var(--ember-soft)", color: "var(--ember)" }}>
      <IconPlus size={9} />{children}
    </button>
  );
}

function DInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full px-2.5 py-1.5 rounded text-[11px] mb-2 outline-none text-cream placeholder:text-cream-faint" style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }} />;
}

function DialogSheet({ onClose, title, hint, children }: { onClose: () => void; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-50" onClick={onClose}>
      <div className="w-full max-w-md p-4 rounded-t-2xl max-h-[85vh] overflow-auto" style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-[14px] font-display font-bold text-cream mb-1">{title}</h2>
        {hint && <p className="text-[10px] font-mono text-cream-faint mb-3">{hint}</p>}
        {children}
      </div>
    </div>
  );
}

function DialogActions({ onCancel, onConfirm, disabled, confirmLabel }: { onCancel: () => void; onConfirm: () => void; disabled?: boolean; confirmLabel?: string }) {
  return (
    <div className="flex gap-2 mt-2">
      <button type="button" onClick={onCancel} className="flex-1 py-2 rounded text-[11px] tap text-cream" style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}>取消</button>
      <button type="button" onClick={onConfirm} disabled={disabled} className="flex-1 py-2 rounded text-[11px] font-display font-semibold tap disabled:opacity-40" style={{ background: "var(--ember)", color: "var(--ink)" }}>{confirmLabel ?? "添加"}</button>
    </div>
  );
}
