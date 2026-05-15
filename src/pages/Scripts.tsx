import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useScriptStore } from "@/stores/scripts";
import { useConfigSubStore } from "@/stores/configSubscription";
import { BUILTIN_SCRIPTS } from "@/source-script/builtin";
import {
  IconArrowLeft,
  IconPlus,
  IconAntenna,
  IconDownload,
  IconScript,
  IconCheck,
  IconTrash,
} from "@/components/Icon";

type Dialog = "import" | "add-cms" | "add-script" | "config" | undefined;

export default function Scripts() {
  const scripts = useScriptStore((s) => s.scripts);
  const hydrate = useScriptStore((s) => s.hydrate);
  const toggle = useScriptStore((s) => s.toggle);
  const uninstall = useScriptStore((s) => s.uninstall);
  const install = useScriptStore((s) => s.install);
  const importFromJson = useScriptStore((s) => s.importFromJson);
  const toggleMany = useScriptStore((s) => s.toggleMany);
  const uninstallMany = useScriptStore((s) => s.uninstallMany);

  const [dialog, setDialog] = useState<Dialog>(undefined);
  // 多选模式
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | undefined>();
  const [cmsKey, setCmsKey] = useState("");
  const [cmsName, setCmsName] = useState("");
  const [cmsApi, setCmsApi] = useState("");
  const [cmsDetail, setCmsDetail] = useState("");
  const [cmsUa, setCmsUa] = useState("");
  const [cmsReferer, setCmsReferer] = useState("");
  const [scriptKey, setScriptKey] = useState("");
  const [scriptName, setScriptName] = useState("");
  const [scriptCode, setScriptCode] = useState("");

  const subUrl = useConfigSubStore((s) => s.url);
  const subAuto = useConfigSubStore((s) => s.autoUpdate);
  const subUpdatedAt = useConfigSubStore((s) => s.updatedAt);
  const subLoading = useConfigSubStore((s) => s.loading);
  const subError = useConfigSubStore((s) => s.error);
  const subLastResult = useConfigSubStore((s) => s.lastResult);
  const subHydrate = useConfigSubStore((s) => s.hydrate);
  const subSetUrl = useConfigSubStore((s) => s.setUrl);
  const subSetAuto = useConfigSubStore((s) => s.setAutoUpdate);
  const subRefresh = useConfigSubStore((s) => s.refresh);
  const subImportJson = useConfigSubStore((s) => s.importJson);
  const subClear = useConfigSubStore((s) => s.clear);

  const [subUrlInput, setSubUrlInput] = useState("");
  const [subJsonInput, setSubJsonInput] = useState("");

  useEffect(() => {
    hydrate();
    subHydrate();
  }, [hydrate, subHydrate]);

  useEffect(() => {
    setSubUrlInput(subUrl);
  }, [subUrl]);

  const builtinKeys = new Set(BUILTIN_SCRIPTS.map((b) => b.key));

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const toggleSelected = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelected(next);
  };

  const selectAll = () => setSelected(new Set(scripts.map((s) => s.key)));

  const batchEnable = () => {
    if (selected.size === 0) return;
    toggleMany(Array.from(selected), true);
  };

  const batchDisable = () => {
    if (selected.size === 0) return;
    toggleMany(Array.from(selected), false);
  };

  const batchDelete = () => {
    const removable = Array.from(selected).filter((k) => !builtinKeys.has(k));
    if (removable.length === 0) {
      alert("选中项均为内置源，不能删除");
      return;
    }
    if (
      !confirm(
        `删除 ${removable.length} 个源？${
          selected.size !== removable.length
            ? `（其中 ${selected.size - removable.length} 个为内置源，将被跳过）`
            : ""
        }`
      )
    )
      return;
    uninstallMany(removable);
    exitSelectMode();
  };

  const handleImport = () => {
    setImportError(undefined);
    const desc = importFromJson(importText);
    if (!desc) {
      setImportError(
        "导入失败：JSON 格式不正确。脚本式需要 code 字段，CMS 式需要 api 字段。"
      );
      return;
    }
    setImportText("");
    setDialog(undefined);
  };

  const handleAddCms = () => {
    if (!cmsKey.trim() || !cmsName.trim() || !cmsApi.trim()) return;
    install({
      key: cmsKey.trim(),
      name: cmsName.trim(),
      type: "cms",
      api: cmsApi.trim(),
      detail: cmsDetail.trim() || undefined,
      ua: cmsUa.trim() || undefined,
      referer: cmsReferer.trim() || undefined,
      enabled: true,
    });
    setCmsKey("");
    setCmsName("");
    setCmsApi("");
    setCmsDetail("");
    setCmsUa("");
    setCmsReferer("");
    setDialog(undefined);
  };

  const handleAddScript = () => {
    if (!scriptKey.trim() || !scriptName.trim() || !scriptCode.trim()) return;
    install({
      key: scriptKey.trim(),
      name: scriptName.trim(),
      type: "script",
      code: scriptCode,
      enabled: true,
    });
    setScriptKey("");
    setScriptName("");
    setScriptCode("");
    setDialog(undefined);
  };

  return (
    <div className="min-h-screen bg-ink text-cream p-4 pb-32">
      <div className="flex items-center gap-3 mb-2">
        <Link
          to="/"
          className="w-9 h-9 flex items-center justify-center rounded-full shrink-0 tap text-cream"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
        >
          <IconArrowLeft size={16} />
        </Link>
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
            CHANNEL · SOURCES
          </p>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">
            视频源
          </h1>
        </div>
        {scripts.length > 0 && (
          <button
            type="button"
            onClick={() =>
              selectMode ? exitSelectMode() : setSelectMode(true)
            }
            className={`px-4 py-2 rounded-full text-xs font-display font-semibold tracking-wider tap transition-all ${
              selectMode
                ? "shadow-ember"
                : ""
            }`}
            style={
              selectMode
                ? { background: "var(--ember)", color: "var(--ink)" }
                : {
                    background: "var(--ink-2)",
                    border: "1px solid var(--cream-line)",
                    color: "var(--cream)",
                  }
            }
          >
            {selectMode ? "完成" : "选择"}
          </button>
        )}
      </div>

      <p className="text-[11px] text-cream-faint mb-5 leading-relaxed">
        已安装 <span className="font-mono text-cream-dim">{scripts.length}</span> · 启用{" "}
        <span className="font-mono text-ember">{scripts.filter((s) => s.enabled).length}</span>
      </p>

      {!selectMode && (
        <div className="grid grid-cols-2 gap-2 mb-6">
          <button
            type="button"
            onClick={() => setDialog("add-cms")}
            className="px-3 py-3 rounded-xl text-xs font-display font-semibold tracking-wide tap flex items-center gap-2"
            style={{
              background: "var(--ember)",
              color: "var(--ink)",
              boxShadow: "0 8px 24px -8px rgba(255,107,53,0.4)",
            }}
          >
            <IconPlus size={16} />
            CMS 源
          </button>
          <button
            type="button"
            onClick={() => setDialog("add-script")}
            className="px-3 py-3 rounded-xl text-xs font-display font-semibold tap flex items-center gap-2 text-cream"
            style={{
              background: "var(--ink-2)",
              border: "1px solid var(--cream-line)",
            }}
          >
            <IconScript size={16} />
            JS 脚本
          </button>
          <button
            type="button"
            onClick={() => setDialog("config")}
            className="px-3 py-3 rounded-xl text-xs font-display font-semibold tap flex items-center gap-2 text-cream"
            style={{
              background: "var(--ink-2)",
              border: "1px solid var(--cream-line)",
            }}
          >
            <IconAntenna size={16} />
            配置订阅
          </button>
          <button
            type="button"
            onClick={() => setDialog("import")}
            className="px-3 py-3 rounded-xl text-xs font-display font-semibold tap flex items-center gap-2 text-cream"
            style={{
              background: "var(--ink-2)",
              border: "1px solid var(--cream-line)",
            }}
          >
            <IconDownload size={16} />
            JSON 单源
          </button>
        </div>
      )}

      {selectMode && (
        <p className="font-mono text-[10px] tracking-wider text-cream-faint mb-3">
          SELECTED · {String(selected.size).padStart(2, "0")} / {String(scripts.length).padStart(2, "0")} · 内置源不可删除
        </p>
      )}

      {scripts.length === 0 ? (
        <p className="text-sm text-cream-faint">还没有视频源</p>
      ) : (
        <ul className="space-y-2">
          {scripts.map((s) => {
            const isBuiltin = builtinKeys.has(s.key);
            const type = s.type ?? "script";
            const isSelected = selected.has(s.key);
            return (
              <li
                key={s.key}
                onClick={selectMode ? () => toggleSelected(s.key) : undefined}
                className={`p-3 rounded-xl tap transition-all ${
                  selectMode ? "cursor-pointer" : ""
                }`}
                style={{
                  background: selectMode && isSelected ? "var(--ember-soft)" : "var(--ink-2)",
                  border: `1px solid ${
                    selectMode && isSelected ? "var(--ember)" : "var(--cream-line)"
                  }`,
                }}
              >
                <div className="flex items-start gap-3">
                  {selectMode && (
                    <div
                      className="w-5 h-5 mt-0.5 rounded-md shrink-0 flex items-center justify-center"
                      style={{
                        background: isSelected ? "var(--ember)" : "transparent",
                        border: `1.5px solid ${isSelected ? "var(--ember)" : "var(--cream-faint)"}`,
                        color: "var(--ink)",
                      }}
                    >
                      {isSelected && <IconCheck size={14} />}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="text-sm font-display font-semibold text-cream">{s.name}</p>
                      <span
                        className="font-mono text-[9px] px-1.5 py-0.5 rounded tracking-wider"
                        style={
                          type === "cms"
                            ? {
                                background: "var(--vhs-soft)",
                                color: "var(--vhs)",
                                border: "1px solid rgba(79,195,247,0.25)",
                              }
                            : {
                                background: "var(--phosphor-soft)",
                                color: "var(--phosphor)",
                                border: "1px solid rgba(124,255,178,0.25)",
                              }
                        }
                      >
                        {type === "cms" ? "CMS" : "SCRIPT"}
                      </span>
                      {isBuiltin && (
                        <span className="chip-ch">BUILTIN</span>
                      )}
                      <span className="font-mono text-[10px] text-cream-faint">{s.key}</span>
                    </div>
                    {s.description && (
                      <p className="text-xs text-cream-dim line-clamp-2 leading-relaxed">
                        {s.description}
                      </p>
                    )}
                    {type === "cms" && s.api && (
                      <p className="font-mono text-[10px] text-cream-faint mt-1 line-clamp-1">
                        {s.api}
                      </p>
                    )}
                    {type === "script" && (
                      <p className="font-mono text-[10px] text-cream-faint mt-1">
                        {s.code?.length ?? 0} BYTES
                      </p>
                    )}
                    {(s.ua || s.referer) && (
                      <p className="font-mono text-[10px] text-cream-faint mt-0.5">
                        {s.ua && `UA: ${s.ua.slice(0, 40)}${s.ua.length > 40 ? "…" : ""}`}
                        {s.ua && s.referer && " · "}
                        {s.referer && `Referer: ${s.referer}`}
                      </p>
                    )}
                  </div>
                  {!selectMode && (
                    <div className="flex flex-col gap-2 items-end shrink-0">
                      <button
                        type="button"
                        onClick={() => toggle(s.key)}
                        className="relative w-11 h-6 rounded-full transition-all"
                        style={{
                          background: s.enabled ? "var(--ember)" : "var(--ink-edge)",
                          boxShadow: s.enabled
                            ? "0 0 12px rgba(255,107,53,0.4), inset 0 1px 0 rgba(255,255,255,0.18)"
                            : "inset 0 1px 0 rgba(255,255,255,0.04)",
                        }}
                      >
                        <span
                          className={`absolute top-0.5 w-5 h-5 rounded-full transition-transform ${
                            s.enabled ? "translate-x-0.5" : "translate-x-0.5"
                          }`}
                          style={{
                            background: s.enabled ? "var(--ink)" : "var(--cream)",
                          }}
                        />
                      </button>
                      {!isBuiltin && (
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`卸载源「${s.name}」？`)) uninstall(s.key);
                          }}
                          className="text-[10px] tap"
                          style={{ color: "var(--ember)" }}
                        >
                          卸载
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {selectMode && (
        <div
          className="fixed left-0 right-0 bottom-0 z-40 backdrop-blur-xl px-4 py-3"
          style={{
            background: "rgba(22, 24, 29, 0.92)",
            borderTop: "1px solid var(--ink-edge)",
          }}
        >
          <div className="flex gap-2 max-w-md mx-auto">
            <button
              type="button"
              onClick={selectAll}
              className="flex-1 py-2.5 rounded-lg text-[11px] font-display font-semibold tap text-cream"
              style={{
                background: "var(--ink-3)",
                border: "1px solid var(--cream-line)",
              }}
            >
              全选
            </button>
            <button
              type="button"
              onClick={batchEnable}
              disabled={selected.size === 0}
              className="flex-1 py-2.5 rounded-lg text-[11px] font-display font-semibold tap disabled:opacity-40"
              style={{
                background: "var(--ember-soft)",
                color: "var(--ember)",
                border: "1px solid rgba(255,107,53,0.35)",
              }}
            >
              启用
            </button>
            <button
              type="button"
              onClick={batchDisable}
              disabled={selected.size === 0}
              className="flex-1 py-2.5 rounded-lg text-[11px] font-display font-semibold tap disabled:opacity-40 text-cream"
              style={{
                background: "var(--ink-3)",
                border: "1px solid var(--cream-line)",
              }}
            >
              停用
            </button>
            <button
              type="button"
              onClick={batchDelete}
              disabled={selected.size === 0}
              className="flex-1 py-2.5 rounded-lg text-[11px] font-display font-semibold tap disabled:opacity-40 flex items-center justify-center gap-1"
              style={{
                background: "rgba(255,80,80,0.12)",
                color: "#FF6B6B",
                border: "1px solid rgba(255,80,80,0.3)",
              }}
            >
              <IconTrash size={12} />
              删除
            </button>
          </div>
        </div>
      )}

      {dialog === "add-cms" && (
        <div
          className="fixed inset-0 bg-black/70 flex items-end justify-center z-50"
          onClick={() => setDialog(undefined)}
        >
          <div
            className="bg-zinc-900 w-full max-w-md p-4 rounded-t-2xl max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold mb-1">添加 CMS V10 视频源</h2>
            <p className="text-xs text-white/40 mb-3">
              MoonTV 兼容协议：`{`{api}?ac=videolist&wd= / &ids=`}`
            </p>
            <input
              value={cmsKey}
              onChange={(e) => setCmsKey(e.target.value)}
              placeholder="唯一 key（如 myvod）"
              className="w-full bg-black/50 px-3 py-2 rounded text-sm mb-2 outline-none"
            />
            <input
              value={cmsName}
              onChange={(e) => setCmsName(e.target.value)}
              placeholder="显示名称"
              className="w-full bg-black/50 px-3 py-2 rounded text-sm mb-2 outline-none"
            />
            <input
              value={cmsApi}
              onChange={(e) => setCmsApi(e.target.value)}
              placeholder="API base，如 https://example.com/api.php/provider/vod"
              className="w-full bg-black/50 px-3 py-2 rounded text-sm mb-2 outline-none"
            />
            <input
              value={cmsDetail}
              onChange={(e) => setCmsDetail(e.target.value)}
              placeholder="详情页 URL（可选）"
              className="w-full bg-black/50 px-3 py-2 rounded text-sm mb-2 outline-none"
            />
            <input
              value={cmsUa}
              onChange={(e) => setCmsUa(e.target.value)}
              placeholder="User-Agent（可选）"
              className="w-full bg-black/50 px-3 py-2 rounded text-sm mb-2 outline-none"
            />
            <input
              value={cmsReferer}
              onChange={(e) => setCmsReferer(e.target.value)}
              placeholder="Referer（可选）"
              className="w-full bg-black/50 px-3 py-2 rounded text-sm mb-3 outline-none"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDialog(undefined)}
                className="flex-1 py-2 bg-white/10 rounded text-sm"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleAddCms}
                disabled={!cmsKey.trim() || !cmsName.trim() || !cmsApi.trim()}
                className="flex-1 py-2 bg-brand rounded text-sm disabled:opacity-50"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog === "add-script" && (
        <div
          className="fixed inset-0 bg-black/70 flex items-end justify-center z-50"
          onClick={() => setDialog(undefined)}
        >
          <div
            className="bg-zinc-900 w-full max-w-md p-4 rounded-t-2xl max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold mb-1">添加 JS 脚本源</h2>
            <p className="text-xs text-white/40 mb-3">
              MoonTV source-script 协议：导出 5 个 hook（getSources/search/recommend/detail/resolvePlayUrl）
            </p>
            <input
              value={scriptKey}
              onChange={(e) => setScriptKey(e.target.value)}
              placeholder="唯一 key"
              className="w-full bg-black/50 px-3 py-2 rounded text-sm mb-2 outline-none"
            />
            <input
              value={scriptName}
              onChange={(e) => setScriptName(e.target.value)}
              placeholder="显示名称"
              className="w-full bg-black/50 px-3 py-2 rounded text-sm mb-2 outline-none"
            />
            <textarea
              value={scriptCode}
              onChange={(e) => setScriptCode(e.target.value)}
              placeholder="return { meta:{name:'...'}, async search(ctx,{keyword,page}){ ... }, async detail(ctx,{id}){ ... }, ... }"
              className="w-full h-48 bg-black/50 px-3 py-2 rounded text-xs font-mono mb-3 outline-none"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setDialog(undefined)}
                className="flex-1 py-2 bg-white/10 rounded text-sm"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleAddScript}
                disabled={
                  !scriptKey.trim() || !scriptName.trim() || !scriptCode.trim()
                }
                className="flex-1 py-2 bg-brand rounded text-sm disabled:opacity-50"
              >
                添加
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog === "import" && (
        <div
          className="fixed inset-0 bg-black/70 flex items-end justify-center z-50"
          onClick={() => setDialog(undefined)}
        >
          <div
            className="bg-zinc-900 w-full max-w-md p-4 rounded-t-2xl max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold mb-1">单源 JSON 导入</h2>
            <p className="text-xs text-white/40 mb-3">
              粘贴单个源 JSON（MoonTV 兼容格式）
              <code className="text-[10px] block mt-1 text-white/40">
                {`{"key":"...","name":"...","type":"script|cms","code":"return{...}" | "api":"..."}`}
              </code>
            </p>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder='{"key":"my","name":"我的","type":"cms","api":"https://..."}'
              className="w-full h-40 p-2 bg-black/50 text-white text-xs font-mono rounded outline-none"
            />
            {importError && (
              <p className="mt-2 text-xs text-red-400">{importError}</p>
            )}
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={() => setDialog(undefined)}
                className="flex-1 py-2 bg-white/10 rounded text-sm"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={!importText.trim()}
                className="flex-1 py-2 bg-brand rounded text-sm disabled:opacity-50"
              >
                确认导入
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog === "config" && (
        <div
          className="fixed inset-0 bg-black/70 flex items-end justify-center z-50"
          onClick={() => setDialog(undefined)}
        >
          <div
            className="bg-zinc-900 w-full max-w-md p-4 rounded-t-2xl max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-semibold mb-1">配置文件 / 订阅</h2>
            <p className="text-xs text-white/40 mb-3">
              批量导入 MoonTV 配置文件（含 <code>api_site</code> + <code>lives</code>）。订阅模式会定期重新拉取（24h）。
            </p>

            <div className="mb-4">
              <p className="text-xs text-white/60 mb-2">📡 订阅 URL（远程配置文件）</p>
              <input
                value={subUrlInput}
                onChange={(e) => setSubUrlInput(e.target.value)}
                placeholder="https://example.com/config.json"
                className="w-full bg-black/50 px-3 py-2 rounded text-sm mb-2 outline-none"
              />
              <label className="flex items-center gap-2 text-xs text-white/60 mb-2">
                <input
                  type="checkbox"
                  checked={subAuto}
                  onChange={(e) => subSetAuto(e.target.checked)}
                  className="accent-brand"
                />
                启动时自动更新（每 24h 一次）
              </label>
              <p className="text-[10px] text-white/40 mb-2">
                {subLoading
                  ? "刷新中…"
                  : subError
                  ? `错误：${subError}`
                  : subUpdatedAt
                  ? `上次更新：${new Date(subUpdatedAt).toLocaleString()}`
                  : "未订阅"}
                {subLastResult &&
                  ` · 上次：源 ${subLastResult.sourcesAdded} / 直播 ${subLastResult.livesAdded}`}
              </p>
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    subSetUrl(subUrlInput.trim());
                    void subRefresh().catch(() => {});
                  }}
                  disabled={!subUrlInput.trim() || subLoading}
                  className="flex-1 min-w-[80px] py-2 bg-brand rounded text-xs disabled:opacity-50"
                >
                  保存并刷新
                </button>
                {subUrl && (
                  <button
                    type="button"
                    onClick={() => void subRefresh().catch(() => {})}
                    disabled={subLoading}
                    className="flex-1 min-w-[80px] py-2 bg-white/10 rounded text-xs disabled:opacity-50"
                  >
                    立即刷新
                  </button>
                )}
                {subUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      subClear();
                      setSubUrlInput("");
                    }}
                    className="flex-1 min-w-[80px] py-2 bg-red-500/10 text-red-400 rounded text-xs"
                  >
                    取消订阅
                  </button>
                )}
              </div>
            </div>

            <div className="border-t border-white/10 pt-4">
              <p className="text-xs text-white/60 mb-2">📋 JSON 文本（一次性导入）</p>
              <textarea
                value={subJsonInput}
                onChange={(e) => setSubJsonInput(e.target.value)}
                placeholder='{"api_site":{"key":{"name":"...","api":"..."}}, "lives":{"key":{"name":"...","url":"..."}}}'
                className="w-full h-32 p-2 bg-black/50 text-white text-xs font-mono rounded outline-none mb-2"
              />
              <button
                type="button"
                onClick={async () => {
                  try {
                    const result = await subImportJson(subJsonInput);
                    alert(
                      `导入成功：${result.sourcesAdded} 个源 + ${result.livesAdded} 个直播${
                        result.liveErrors.length
                          ? `（${result.liveErrors.length} 个直播源失败）`
                          : ""
                      }`
                    );
                    setSubJsonInput("");
                    setDialog(undefined);
                  } catch (e) {
                    alert(`导入失败：${(e as Error).message}`);
                  }
                }}
                disabled={!subJsonInput.trim() || subLoading}
                className="w-full py-2 bg-brand rounded text-xs disabled:opacity-50"
              >
                {subLoading ? "导入中…" : "导入 JSON"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
