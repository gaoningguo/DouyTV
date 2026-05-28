/**
 * 直播管理 —— 双 Tab 布局
 *   ┌─ IPTV ─┬─ 网络直播 ─┐
 *   IPTV tab     : 频道源订阅 + 手动添加（弹窗） + EPG
 *   网络直播 tab : 插件订阅 + 手动导入（弹窗） + 插件列表 + 18+ 开关
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveStore } from "@/stores/live";
import { useLiveSubStore } from "@/stores/liveSubscription";
import { useEpgStore } from "@/stores/epg";
import { useNetLiveStore } from "@/stores/netlive";
import { useExternalPluginStore } from "@/stores/netliveExternalPlugins";
import { usePluginSubscriptionStore, type PluginSubscription } from "@/stores/netlivePluginSubscription";
import { NETLIVE_PLATFORMS } from "@/lib/netlive/types";
import type { NetLivePluginDescriptor } from "@/lib/netlive/external/types";
import { SettingsSubPageLayout } from "./Layout";
import {
  IconPlus,
  IconRefresh,
  IconTrash,
} from "@/components/Icon";

type Tab = "iptv" | "netlive";
const LIVE_TAB_KEY = "douytv:live-hub-tab";

function readLiveTab(): Tab {
  try { const v = localStorage.getItem(LIVE_TAB_KEY); if (v === "netlive") return v; } catch {}
  return "iptv";
}

export default function LiveSourcesHub() {
  const [tab, setTab] = useState<Tab>(readLiveTab);
  useEffect(() => { try { localStorage.setItem(LIVE_TAB_KEY, tab); } catch {} }, [tab]);

  const hydrateLive = useLiveStore((s) => s.hydrate);
  const hydrateSubs = useLiveSubStore((s) => s.hydrate);
  const hydrateEpg = useEpgStore((s) => s.hydrate);
  const hydrateNetLive = useNetLiveStore((s) => s.hydrate);
  const hydratePlugins = useExternalPluginStore((s) => s.hydrate);
  const hydratePluginSubs = usePluginSubscriptionStore((s) => s.hydrate);

  useEffect(() => {
    hydrateLive();
    hydrateSubs();
    hydrateEpg();
    hydrateNetLive();
    hydratePlugins();
    hydratePluginSubs();
  }, [hydrateLive, hydrateSubs, hydrateEpg, hydrateNetLive, hydratePlugins, hydratePluginSubs]);

  const tabBar = (
    <div className="flex gap-1 p-1 mx-4 mt-3 mb-1 rounded-lg" style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}>
      <TabBtn active={tab === "iptv"} onClick={() => setTab("iptv")}>IPTV</TabBtn>
      <TabBtn active={tab === "netlive"} onClick={() => setTab("netlive")}>网络直播</TabBtn>
    </div>
  );

  return (
    <SettingsSubPageLayout eyebrow="SETTINGS" title="直播管理" toolbar={tabBar}>
      {tab === "iptv" ? <IptvTab /> : <NetliveTab />}
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

function SectionHeader({ title, className }: { title: string; className?: string }) {
  return <h3 className={`font-display font-bold text-[13px] text-cream mb-3 ${className ?? ""}`}>{title}</h3>;
}

/* ═══════════════════════════════════════════════════
   IPTV Tab
   ═══════════════════════════════════════════════════ */
type IptvDialog = "add-sub" | "add-channel" | "import-m3u" | undefined;

function IptvTab() {
  const channels = useLiveStore((s) => s.channels);
  const addChannel = useLiveStore((s) => s.add);
  const importM3U = useLiveStore((s) => s.importM3U);
  const subscriptions = useLiveSubStore((s) => s.subscriptions);
  const addSub = useLiveSubStore((s) => s.add);
  const removeSub = useLiveSubStore((s) => s.remove);
  const refreshSub = useLiveSubStore((s) => s.refresh);
  const refreshAllSubs = useLiveSubStore((s) => s.refreshAll);
  const setAuto = useLiveSubStore((s) => s.setAutoRefresh);

  const [dialog, setDialog] = useState<IptvDialog>(undefined);
  const [busy, setBusy] = useState<string | undefined>();
  const [refreshAllBusy, setRefreshAllBusy] = useState(false);
  const [doneMsg, setDoneMsg] = useState<string | undefined>();

  // Add subscription form
  const [subName, setSubName] = useState("");
  const [subUrl, setSubUrl] = useState("");
  // Add single channel form
  const [chName, setChName] = useState("");
  const [chUrl, setChUrl] = useState("");
  // M3U paste
  const [m3uText, setM3uText] = useState("");

  const onAddSub = async () => {
    if (!subName.trim() || !subUrl.trim()) return;
    setBusy("add");
    try { await addSub(subName.trim(), subUrl.trim(), true); setSubName(""); setSubUrl(""); setDialog(undefined); }
    catch (e) { alert(`订阅失败：${(e as Error).message}`); }
    finally { setBusy(undefined); }
  };

  const onAddChannel = () => {
    if (!chName.trim() || !chUrl.trim()) return;
    addChannel({ id: `user-${Date.now()}`, name: chName.trim(), url: chUrl.trim(), category: "自定义" });
    setChName(""); setChUrl(""); setDialog(undefined);
  };

  const onImportM3u = () => {
    if (!m3uText.trim()) return;
    const n = importM3U(m3uText);
    alert(`已导入 ${n} 个频道`);
    setM3uText(""); setDialog(undefined);
  };

  return (
    <div>
      {/* 概览 */}
      <div className="flex items-center gap-4 p-3 rounded-lg mb-4" style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}>
        <Stat label="IPTV 频道" value={channels.length} />
        <Stat label="订阅源" value={subscriptions.length} />
      </div>

      {/* 频道源订阅 */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-mono text-cream-faint">
          {subscriptions.length === 0 ? "暂无订阅，添加 M3U URL 自动拉取频道" : `${subscriptions.length} 个订阅源`}
          {(busy || refreshAllBusy) && <span className="ml-2 text-ember animate-pulse">刷新中…</span>}
          {doneMsg && <span className="ml-2 text-phosphor">{doneMsg}</span>}
        </p>
        <div className="flex gap-1.5">
          {subscriptions.length > 0 && (
            <button type="button" onClick={async () => { setRefreshAllBusy(true); setDoneMsg(undefined); try { await refreshAllSubs(); setDoneMsg("全部刷新完成"); setTimeout(() => setDoneMsg(undefined), 3000); } catch {} finally { setRefreshAllBusy(false); } }} disabled={refreshAllBusy} className="text-[9px] font-mono tap text-cream-faint px-2 py-1 rounded flex items-center gap-1 disabled:opacity-60" style={{ background: "var(--ink-3)" }}>
              <IconRefresh size={10} className={refreshAllBusy ? "animate-spin" : ""} />
              {refreshAllBusy ? "刷新中" : "全部刷新"}
            </button>
          )}
          <SmallBtn onClick={() => setDialog("add-sub")}>订阅</SmallBtn>
          <SmallBtn onClick={() => setDialog("add-channel")}>频道</SmallBtn>
          <SmallBtn onClick={() => setDialog("import-m3u")}>M3U</SmallBtn>
        </div>
      </div>

      <div className="space-y-1.5 mb-6">
        {subscriptions.map((sub) => (
          <div key={sub.id} className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-display font-semibold text-cream truncate">{sub.name}</p>
              <p className="font-mono text-[8px] text-cream-faint truncate">{sub.url}</p>
              <div className="flex gap-2 mt-0.5 text-[8px] font-mono text-cream-faint">
                {sub.channelCount !== undefined && <span>{sub.channelCount} ch</span>}
                {sub.lastFetchedAt && <span>{new Date(sub.lastFetchedAt).toLocaleDateString()}</span>}
                {sub.error && <span style={{ color: "#FF6B6B" }}>!</span>}
              </div>
            </div>
            <label className="flex items-center gap-1 text-[8px] text-cream-faint shrink-0">
              <input type="checkbox" checked={sub.autoRefresh} onChange={(e) => setAuto(sub.id, e.target.checked)} className="accent-ember w-3 h-3" />
              自动
            </label>
            <button type="button" onClick={() => { setBusy(sub.id); refreshSub(sub.id).then(() => { setDoneMsg("已更新"); setTimeout(() => setDoneMsg(undefined), 2000); }).finally(() => setBusy(undefined)); }} disabled={busy === sub.id} className="p-1 rounded tap text-cream-faint disabled:opacity-40" style={{ background: "var(--ink-3)" }}>
              <IconRefresh size={10} className={busy === sub.id ? "animate-spin" : ""} />
            </button>
            <button type="button" onClick={() => { if (confirm(`删除「${sub.name}」？`)) removeSub(sub.id); }} className="p-1 rounded tap" style={{ color: "#FF6B6B" }}>
              <IconTrash size={10} />
            </button>
          </div>
        ))}
      </div>

      <SectionHeader title="EPG 节目单" />
      <EpgSection />

      {/* ─── 弹窗 ─── */}
      {dialog === "add-sub" && (
        <DialogSheet onClose={() => setDialog(undefined)} title="添加订阅源" hint="M3U / M3U8 / TXT URL，添加后自动刷新拉取频道">
          <DInput value={subName} onChange={setSubName} placeholder="订阅名（如「央视 IPTV」）" />
          <DInput value={subUrl} onChange={setSubUrl} placeholder="https://example.com/playlist.m3u" mono />
          <DialogActions onCancel={() => setDialog(undefined)} onConfirm={onAddSub} disabled={!subName.trim() || !subUrl.trim() || busy === "add"} confirmLabel={busy === "add" ? "添加中…" : "添加并刷新"} />
        </DialogSheet>
      )}
      {dialog === "add-channel" && (
        <DialogSheet onClose={() => setDialog(undefined)} title="添加单个频道" hint="手动添加自定义频道">
          <DInput value={chName} onChange={setChName} placeholder="频道名" />
          <DInput value={chUrl} onChange={setChUrl} placeholder="m3u8 URL" mono />
          <DialogActions onCancel={() => setDialog(undefined)} onConfirm={onAddChannel} disabled={!chName.trim() || !chUrl.trim()} />
        </DialogSheet>
      )}
      {dialog === "import-m3u" && (
        <DialogSheet onClose={() => setDialog(undefined)} title="粘贴 M3U" hint="粘贴 #EXTM3U 文本批量导入">
          <textarea value={m3uText} onChange={(e) => setM3uText(e.target.value)} placeholder={'#EXTM3U\n#EXTINF:-1 group-title="新闻",CCTV-1\nhttps://...'} className="w-full h-36 p-2.5 rounded text-[11px] font-mono outline-none text-cream placeholder:text-cream-faint resize-none mb-2" style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }} />
          <DialogActions onCancel={() => setDialog(undefined)} onConfirm={onImportM3u} disabled={!m3uText.trim()} confirmLabel="导入" />
        </DialogSheet>
      )}
    </div>
  );
}

/* ─── EPG ─── */
function EpgSection() {
  const url = useEpgStore((s) => s.url);
  const programmes = useEpgStore((s) => s.programmes);
  const loading = useEpgStore((s) => s.loading);
  const error = useEpgStore((s) => s.error);
  const updatedAt = useEpgStore((s) => s.updatedAt);
  const setUrl = useEpgStore((s) => s.setUrl);
  const refresh = useEpgStore((s) => s.refresh);
  const clear = useEpgStore((s) => s.clear);
  const [input, setInput] = useState(url);
  useEffect(() => { setInput(url); }, [url]);
  const channelCount = Object.keys(programmes).length;

  return (
    <div className="p-3 rounded-lg" style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}>
      <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="XMLTV URL (https://example.com/epg.xml)" className="w-full px-2.5 py-1.5 rounded text-[11px] font-mono mb-2 outline-none text-cream placeholder:text-cream-faint" style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }} />
      <p className="text-[9px] font-mono text-cream-faint mb-2">
        {loading ? "刷新中…" : error ? `错误：${error}` : updatedAt ? `${channelCount} 频道节目 · ${new Date(updatedAt).toLocaleString()}` : "填写 XMLTV URL 后保存，按 tvg-id 自动匹配节目表"}
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={() => setUrl(input.trim())} disabled={!input.trim() || input.trim() === url} className="flex-1 py-1.5 rounded text-[10px] font-semibold tap disabled:opacity-40" style={{ background: "var(--ember)", color: "var(--ink)" }}>保存</button>
        {url && <button type="button" onClick={() => void refresh()} className="flex-1 py-1.5 rounded text-[10px] tap text-cream" style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}>刷新</button>}
        {url && <button type="button" onClick={() => { if (confirm("清除 EPG？")) { clear(); setInput(""); } }} className="py-1.5 px-3 rounded text-[10px] tap" style={{ color: "#FF6B6B" }}>清除</button>}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   网络直播 Tab
   ═══════════════════════════════════════════════════ */
type NetliveDialog = "add-sub" | "import-url" | "import-batch-url" | "import-file" | "import-code" | undefined;

function NetliveTab() {
  const adultEnabled = useNetLiveStore((s) => s.adultEnabled);
  const setAdultEnabled = useNetLiveStore((s) => s.setAdultEnabled);
  const plugins = useExternalPluginStore((s) => s.plugins);
  const enable = useExternalPluginStore((s) => s.enable);
  const disable = useExternalPluginStore((s) => s.disable);
  const removePlugin = useExternalPluginStore((s) => s.remove);
  const updateCode = useExternalPluginStore((s) => s.updateCode);
  const addPlugin = useExternalPluginStore((s) => s.add);
  const batchEnable = useExternalPluginStore((s) => s.batchEnable);
  const batchDisable = useExternalPluginStore((s) => s.batchDisable);
  const batchRemove = useExternalPluginStore((s) => s.batchRemove);
  const subscriptions = usePluginSubscriptionStore((s) => s.subscriptions);
  const refreshing = usePluginSubscriptionStore((s) => s.refreshing);
  const addSub = usePluginSubscriptionStore((s) => s.add);
  const removeSub = usePluginSubscriptionStore((s) => s.remove);
  const refreshSub = usePluginSubscriptionStore((s) => s.refresh);
  const refreshAllSubs = usePluginSubscriptionStore((s) => s.refreshAll);

  const netlivePlatforms = NETLIVE_PLATFORMS.filter((p) => !p.adult);
  const adultPlatforms = NETLIVE_PLATFORMS.filter((p) => p.adult);
  const visiblePlatforms = adultEnabled ? netlivePlatforms.length + adultPlatforms.length : netlivePlatforms.length;
  const enabledPlugins = plugins.filter((p) => p.enabled).length;

  const [dialog, setDialog] = useState<NetliveDialog>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [netliveRefreshAllBusy, setNetliveRefreshAllBusy] = useState(false);
  const [netliveDoneMsg, setNetliveDoneMsg] = useState<string | undefined>();

  // Batch selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const batchMode = selected.size > 0;
  const allSelected = plugins.length > 0 && selected.size === plugins.length;
  const toggleSelect = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
  const toggleSelectAll = useCallback(() => {
    if (allSelected) { setSelected(new Set()); }
    else { setSelected(new Set(plugins.map((p) => p.key))); }
  }, [allSelected, plugins]);
  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // Add subscription
  const [subUrl, setSubUrl] = useState("");
  const [subBusy, setSubBusy] = useState(false);
  // Import URL
  const [importUrl, setImportUrl] = useState("");
  // Batch import URLs
  const [batchUrls, setBatchUrls] = useState("");
  const [batchImportBusy, setBatchImportBusy] = useState(false);
  const [batchImportProgress, setBatchImportProgress] = useState("");
  // Import code
  const [importCode, setImportCode] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const tryAdd = useCallback((code: string) => {
    setError(null);
    try {
      const fn = new Function('"use strict";\n' + code);
      const mod = fn();
      if (!mod?.manifest?.id || !mod?.manifest?.label || !mod?.resolve) {
        setError("插件格式错误：必须 return { manifest: { id, label }, resolve: async (ctx, {roomId}) => ... }");
        return false;
      }
      const desc: NetLivePluginDescriptor = {
        key: `ext:${mod.manifest.id}`,
        name: mod.manifest.label,
        code,
        enabled: true,
        installedAt: Date.now(),
      };
      addPlugin(desc);
      return true;
    } catch (err) {
      setError(`编译失败: ${(err as Error).message}`);
      return false;
    }
  }, [addPlugin]);

  const onAddSub = async () => {
    if (!subUrl.trim()) return;
    setError(null);
    setSubBusy(true);
    try { await addSub(subUrl.trim()); setSubUrl(""); setDialog(undefined); }
    catch (e) { setError((e as Error).message); }
    finally { setSubBusy(false); }
  };

  const onImportUrl = async () => {
    const url = importUrl.trim();
    if (!url) return;
    setError(null);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const code = await res.text();
      if (tryAdd(code)) { setImportUrl(""); setDialog(undefined); }
    } catch (err) { setError(`下载失败: ${(err as Error).message}`); }
  };

  const onImportCode = () => {
    if (tryAdd(importCode)) { setImportCode(""); setDialog(undefined); }
  };

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setError(null);
    let success = 0;
    for (const file of Array.from(files)) {
      try { const code = await file.text(); if (tryAdd(code)) success++; }
      catch (err) { setError(`读取 ${file.name} 失败: ${(err as Error).message}`); }
    }
    if (success > 0 && !error) setDialog(undefined);
    e.target.value = "";
  };

  const openDialog = (d: NetliveDialog) => { setError(null); setBatchImportProgress(""); setDialog(d); };

  const onBatchImportUrls = async () => {
    const lines = batchUrls.split(/\n/).map((l) => l.trim()).filter((l) => l && (l.startsWith("http://") || l.startsWith("https://")));
    if (lines.length === 0) { setError("没有找到有效的 URL（每行一个，需以 http:// 或 https:// 开头）"); return; }
    setError(null);
    setBatchImportBusy(true);
    let success = 0;
    let fail = 0;
    for (let i = 0; i < lines.length; i++) {
      setBatchImportProgress(`${i + 1} / ${lines.length}`);
      try {
        const res = await fetch(lines[i]);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const code = await res.text();
        if (tryAdd(code)) success++; else fail++;
      } catch { fail++; }
    }
    setBatchImportBusy(false);
    setBatchImportProgress("");
    if (success > 0) {
      setError(fail > 0 ? `成功 ${success} 个，失败 ${fail} 个` : null);
      if (fail === 0) { setBatchUrls(""); setDialog(undefined); }
    } else {
      setError(`全部失败（${fail} 个）`);
    }
  };

  return (
    <div>
      {/* 概览 */}
      <div className="flex items-center gap-4 p-3 rounded-lg mb-4" style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}>
        <Stat label="可用平台" value={visiblePlatforms} />
        <Stat label="已启用插件" value={enabledPlugins} />
        <Stat label="订阅源" value={subscriptions.length} />
      </div>

      {/* 插件订阅 */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] font-mono text-cream-faint">
          {subscriptions.length === 0 ? "暂无订阅，添加 GitHub 仓库自动同步插件" : `${subscriptions.length} 个订阅源`}
          {(refreshing.size > 0 || netliveRefreshAllBusy) && <span className="ml-2 text-ember animate-pulse">刷新中…</span>}
          {netliveDoneMsg && <span className="ml-2 text-phosphor">{netliveDoneMsg}</span>}
        </p>
        <div className="flex gap-1.5">
          {subscriptions.length > 0 && (
            <button type="button" onClick={async () => { setNetliveRefreshAllBusy(true); setNetliveDoneMsg(undefined); try { await refreshAllSubs(); setNetliveDoneMsg("全部刷新完成"); setTimeout(() => setNetliveDoneMsg(undefined), 3000); } catch {} finally { setNetliveRefreshAllBusy(false); } }} disabled={netliveRefreshAllBusy} className="text-[9px] font-mono tap text-cream-faint px-2 py-1 rounded flex items-center gap-1 disabled:opacity-60" style={{ background: "var(--ink-3)" }}>
              <IconRefresh size={10} className={netliveRefreshAllBusy ? "animate-spin" : ""} />
              {netliveRefreshAllBusy ? "刷新中" : "全部刷新"}
            </button>
          )}
          <SmallBtn onClick={() => openDialog("add-sub")}>订阅</SmallBtn>
          <SmallBtn onClick={() => openDialog("import-url")}>URL</SmallBtn>
          <SmallBtn onClick={() => openDialog("import-batch-url")}>批量URL</SmallBtn>
          <SmallBtn onClick={() => openDialog("import-file")}>文件</SmallBtn>
          <SmallBtn onClick={() => openDialog("import-code")}>代码</SmallBtn>
        </div>
      </div>

      <div className="space-y-1.5 mb-6">
        {subscriptions.map((sub) => (
          <PluginSubCard
            key={sub.id}
            sub={sub}
            isRefreshing={refreshing.has(sub.id)}
            onRefresh={() => refreshSub(sub.id)}
            onRemove={() => { if (confirm(`删除订阅「${sub.name}」？相关插件会被移除`)) removeSub(sub.id); }}
          />
        ))}
      </div>

      {/* 已安装插件 */}
      <div className="flex items-center justify-between mb-3">
        <SectionHeader title={`已安装插件${plugins.length > 0 ? ` (${plugins.length})` : ""}`} className="!mb-0" />
        {plugins.length > 0 && (
          <button type="button" onClick={toggleSelectAll} className="text-[9px] font-mono tap px-2 py-1 rounded" style={{ background: allSelected ? "var(--ember-soft)" : "var(--ink-3)", color: allSelected ? "var(--ember)" : "var(--cream-faint)" }}>
            {allSelected ? "取消全选" : "全选"}
          </button>
        )}
      </div>
      {/* 批量操作栏 */}
      {batchMode && (
        <div className="flex items-center gap-2 p-2.5 rounded-lg mb-3" style={{ background: "rgba(255,107,53,0.06)", border: "1px solid rgba(255,107,53,0.25)" }}>
          <p className="text-[10px] font-mono text-ember flex-1">已选 {selected.size} 个</p>
          <button type="button" onClick={() => { batchEnable(Array.from(selected)); clearSelection(); }} className="px-2 py-1 rounded text-[9px] font-mono font-semibold tap" style={{ background: "var(--ember)", color: "var(--ink)" }}>批量启用</button>
          <button type="button" onClick={() => { batchDisable(Array.from(selected)); clearSelection(); }} className="px-2 py-1 rounded text-[9px] font-mono tap text-cream" style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}>批量禁用</button>
          <button type="button" onClick={() => { if (confirm(`确认删除 ${selected.size} 个插件？`)) { batchRemove(Array.from(selected)); clearSelection(); } }} className="px-2 py-1 rounded text-[9px] font-mono tap" style={{ color: "#FF6B6B" }}>批量删除</button>
          <button type="button" onClick={clearSelection} className="px-2 py-1 rounded text-[9px] font-mono tap text-cream-faint" style={{ background: "var(--ink-3)" }}>取消</button>
        </div>
      )}
      {plugins.length === 0 ? (
        <div className="p-4 rounded-lg text-center mb-6" style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}>
          <p className="text-[11px] font-display text-cream-faint">还没有安装任何插件</p>
          <p className="text-[9px] font-mono text-cream-faint mt-1">添加订阅源或手动导入开始</p>
        </div>
      ) : (
        <div className="space-y-1.5 mb-6">
          {plugins.map((p) => (
            <PluginCard
              key={p.key}
              plugin={p}
              selected={selected.has(p.key)}
              onToggleSelect={() => toggleSelect(p.key)}
              onEnable={() => enable(p.key)}
              onDisable={() => disable(p.key)}
              onRemove={() => { if (confirm(`删除「${p.name}」？`)) removePlugin(p.key); }}
              onUpdate={(code) => updateCode(p.key, code)}
            />
          ))}
        </div>
      )}

      {/* 18+ 开关 */}
      <SectionHeader title="成人平台" />
      <div className="flex items-center justify-between p-3 rounded-lg" style={{ background: adultEnabled ? "rgba(255,80,80,0.04)" : "var(--ink-2)", border: `1px solid ${adultEnabled ? "rgba(255,80,80,0.25)" : "var(--cream-line)"}` }}>
        <div>
          <p className="text-[11px] font-display font-semibold text-cream">18+ 成人平台</p>
          <p className="text-[8px] font-mono text-cream-faint mt-0.5">
            {adultEnabled ? `${adultPlatforms.length} 个平台已启用` : `已隐藏 ${adultPlatforms.length} 个成人平台`}
          </p>
        </div>
        <button type="button" onClick={() => setAdultEnabled(!adultEnabled)} className="px-3 py-1 rounded text-[10px] font-mono font-bold tap" style={{ background: adultEnabled ? "#FF6B6B" : "var(--ink-3)", color: adultEnabled ? "#fff" : "var(--cream-dim)" }}>
          {adultEnabled ? "ON" : "OFF"}
        </button>
      </div>

      {/* ─── 弹窗 ─── */}
      {dialog === "add-sub" && (
        <DialogSheet onClose={() => setDialog(undefined)} title="添加插件订阅" hint="GitHub 仓库地址或 index.json URL，添加后自动同步插件">
          <DInput value={subUrl} onChange={setSubUrl} placeholder="github.com/user/repo 或 https://.../index.json" mono />
          {error && <ErrorBox text={error} />}
          <DialogActions onCancel={() => setDialog(undefined)} onConfirm={onAddSub} disabled={!subUrl.trim() || subBusy} confirmLabel={subBusy ? "同步中…" : "订阅并同步"} />
        </DialogSheet>
      )}
      {dialog === "import-url" && (
        <DialogSheet onClose={() => setDialog(undefined)} title="URL 下载安装" hint="输入插件 .js 文件的直链 URL">
          <DInput value={importUrl} onChange={setImportUrl} placeholder="https://example.com/plugin.js" mono />
          {error && <ErrorBox text={error} />}
          <DialogActions onCancel={() => setDialog(undefined)} onConfirm={onImportUrl} disabled={!importUrl.trim()} confirmLabel="下载并安装" />
        </DialogSheet>
      )}
      {dialog === "import-file" && (
        <DialogSheet onClose={() => setDialog(undefined)} title="选择文件" hint="选择一个或多个 .js 插件文件">
          <button type="button" onClick={() => fileRef.current?.click()} className="w-full py-2.5 rounded text-[11px] font-mono tap text-cream mb-2" style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}>
            选择 .js 文件（支持多选）
          </button>
          <input ref={fileRef} type="file" accept=".js,.txt" multiple className="hidden" onChange={onImportFile} />
          {error && <ErrorBox text={error} />}
          <div className="flex gap-2 mt-2">
            <button type="button" onClick={() => setDialog(undefined)} className="flex-1 py-2 rounded text-[11px] tap text-cream" style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}>关闭</button>
          </div>
        </DialogSheet>
      )}
      {dialog === "import-batch-url" && (
        <DialogSheet onClose={() => setDialog(undefined)} title="批量 URL 导入" hint="每行一个插件 .js 文件的直链 URL，批量下载安装">
          <textarea value={batchUrls} onChange={(e) => setBatchUrls(e.target.value)} placeholder={'https://example.com/plugin-a.js\nhttps://example.com/plugin-b.js\nhttps://example.com/plugin-c.js'} className="w-full h-40 p-2.5 rounded text-[11px] font-mono outline-none text-cream placeholder:text-cream-faint resize-none mb-2" style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }} />
          {batchImportProgress && <p className="text-[10px] font-mono text-ember mb-2 animate-pulse">下载中 {batchImportProgress}</p>}
          {error && <ErrorBox text={error} />}
          <DialogActions onCancel={() => setDialog(undefined)} onConfirm={onBatchImportUrls} disabled={!batchUrls.trim() || batchImportBusy} confirmLabel={batchImportBusy ? "导入中…" : "批量导入"} />
        </DialogSheet>
      )}
      {dialog === "import-code" && (
        <DialogSheet onClose={() => setDialog(undefined)} title="粘贴插件代码" hint="必须 return { manifest: { id, label }, resolve: async (ctx, {roomId}) => ... }">
          <textarea value={importCode} onChange={(e) => setImportCode(e.target.value)} placeholder={'return {\n  manifest: { id: "my-platform", label: "我的平台" },\n  async resolve(ctx, { roomId }) { ... }\n}'} className="w-full h-40 p-2.5 rounded text-[11px] font-mono outline-none text-cream placeholder:text-cream-faint resize-none mb-2" style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }} />
          {error && <ErrorBox text={error} />}
          <DialogActions onCancel={() => setDialog(undefined)} onConfirm={onImportCode} disabled={!importCode.trim()} confirmLabel="安装" />
        </DialogSheet>
      )}
    </div>
  );
}

function PluginSubCard({ sub, isRefreshing, onRefresh, onRemove }: { sub: PluginSubscription; isRefreshing: boolean; onRefresh: () => void; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-display font-semibold text-cream truncate">{sub.name}</p>
        <p className="font-mono text-[8px] text-cream-faint truncate">{sub.url}</p>
        <div className="flex gap-2 mt-0.5 text-[8px] font-mono text-cream-faint">
          {sub.pluginCount !== undefined && <span>{sub.pluginCount} 个</span>}
          {sub.lastFetchedAt && <span>{new Date(sub.lastFetchedAt).toLocaleDateString()}</span>}
          {sub.error && <span style={{ color: "#FF6B6B" }} title={sub.error}>!</span>}
        </div>
      </div>
      <button type="button" onClick={onRefresh} disabled={isRefreshing} className="p-1 rounded tap text-cream-faint disabled:opacity-40" style={{ background: "var(--ink-3)" }}>
        <IconRefresh size={10} className={isRefreshing ? "animate-spin" : ""} />
      </button>
      <button type="button" onClick={onRemove} className="p-1 rounded tap" style={{ color: "#FF6B6B" }}>
        <IconTrash size={10} />
      </button>
    </div>
  );
}

function PluginCard({ plugin, selected, onToggleSelect, onEnable, onDisable, onRemove, onUpdate }: {
  plugin: NetLivePluginDescriptor;
  selected?: boolean;
  onToggleSelect?: () => void;
  onEnable: () => void;
  onDisable: () => void;
  onRemove: () => void;
  onUpdate: (code: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState(plugin.code);

  return (
    <div className="p-2.5 rounded-lg" style={{ background: selected ? "rgba(255,107,53,0.06)" : "var(--ink-2)", border: `1px solid ${selected ? "rgba(255,107,53,0.4)" : plugin.enabled ? "rgba(255,107,53,0.3)" : "var(--cream-line)"}`, opacity: plugin.enabled ? 1 : 0.6 }}>
      <div className="flex items-center gap-2">
        <input type="checkbox" checked={!!selected} onChange={onToggleSelect} className="accent-ember w-3.5 h-3.5 shrink-0 cursor-pointer" />
        <div className="flex-1 min-w-0">
          <p className="font-display font-semibold text-[11px] text-cream truncate">{plugin.name}</p>
          <p className="font-mono text-[8px] text-cream-faint truncate">
            {plugin.key}
            {plugin.installedAt && ` · ${new Date(plugin.installedAt).toLocaleDateString()}`}
          </p>
        </div>
        <button type="button" onClick={() => setEditing((v) => !v)} className="px-2 py-1 rounded text-[9px] font-mono tap text-cream-faint" style={{ background: "var(--ink-3)" }}>编辑</button>
        <button type="button" onClick={plugin.enabled ? onDisable : onEnable} className="px-2 py-1 rounded text-[9px] font-mono font-bold tap" style={{ background: plugin.enabled ? "var(--ember-soft)" : "var(--ink-3)", color: plugin.enabled ? "var(--ember)" : "var(--cream-faint)" }}>
          {plugin.enabled ? "ON" : "OFF"}
        </button>
        <button type="button" onClick={onRemove} className="p-1 rounded tap" style={{ color: "#FF6B6B" }}>
          <IconTrash size={10} />
        </button>
      </div>
      {editing && (
        <div className="mt-2">
          <textarea value={code} onChange={(e) => setCode(e.target.value)} className="w-full h-32 p-2 rounded text-[10px] font-mono resize-none outline-none" style={{ background: "var(--ink-3)", color: "var(--cream)", border: "1px solid var(--cream-line)" }} />
          <div className="flex gap-2 mt-1.5">
            <button type="button" onClick={() => { onUpdate(code); setEditing(false); }} className="px-2.5 py-1 rounded text-[10px] font-display font-semibold tap" style={{ background: "var(--ember)", color: "var(--ink)" }}>保存</button>
            <button type="button" onClick={() => { setCode(plugin.code); setEditing(false); }} className="px-2.5 py-1 rounded text-[10px] font-mono tap text-cream-faint" style={{ background: "var(--ink-3)" }}>取消</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Shared UI ─── */
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center flex-1">
      <p className="text-[16px] font-display font-bold text-cream">{value}</p>
      <p className="text-[9px] font-mono text-cream-faint mt-0.5">{label}</p>
    </div>
  );
}

function SmallBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-[9px] font-display font-semibold tap px-2 py-1 rounded" style={{ background: "var(--ember-soft)", color: "var(--ember)" }}>
      <IconPlus size={9} />{children}
    </button>
  );
}

function DInput({ value, onChange, placeholder, mono }: { value: string; onChange: (v: string) => void; placeholder: string; mono?: boolean }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`w-full px-2.5 py-1.5 rounded text-[11px] mb-2 outline-none text-cream placeholder:text-cream-faint ${mono ? "font-mono" : ""}`} style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }} />;
}

function ErrorBox({ text }: { text: string }) {
  return <p className="text-[10px] font-mono p-2 rounded mb-2" style={{ background: "rgba(255,80,80,0.08)", color: "#FF6B6B", border: "1px solid rgba(255,80,80,0.25)" }}>{text}</p>;
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
