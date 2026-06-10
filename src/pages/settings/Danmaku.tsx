import { useEffect, useMemo, useState } from "react";
import { useDanmakuStore } from "@/stores/danmaku";
import {
  clearAllDanmakuCache,
  getDanmakuCacheStats,
} from "@/lib/danmaku/cache";
import {
  BUILTIN_DANMAKU_API_BASE,
  BUILTIN_DANMAKU_API_TOKEN,
} from "@/lib/danmaku/config";
import { searchAnime } from "@/lib/danmaku/api";
import { SettingsSubPageLayout } from "./Layout";
import { appConfirm } from "@/components/AppDialog";

/** 简单的横向滑块封装，复用主题 token。 */
function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
  suffix?: string;
}) {
  return (
    <label className="block mb-3">
      <div className="flex justify-between items-center mb-1">
        <span className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
          {label}
        </span>
        <span className="font-mono text-[11px] text-cream">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, var(--ember) 0%, var(--ember) ${
            ((value - min) / (max - min)) * 100
          }%, var(--ink-edge) ${
            ((value - min) / (max - min)) * 100
          }%, var(--ink-edge) 100%)`,
        }}
      />
    </label>
  );
}

function Switch({
  on,
  onChange,
  label,
  sub,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  sub?: string;
}) {
  return (
    <label className="flex items-center justify-between py-2">
      <div className="min-w-0 pr-3">
        <p className="text-sm font-display font-semibold">{label}</p>
        {sub && <p className="text-[11px] text-cream-faint mt-0.5">{sub}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!on)}
        className="relative w-11 h-6 rounded-full transition-all shrink-0"
        style={{
          background: on ? "var(--ember)" : "var(--ink-edge)",
          boxShadow: on
            ? "0 0 12px rgba(255,107,53,0.4), inset 0 1px 0 rgba(255,255,255,0.18)"
            : "inset 0 1px 0 rgba(255,255,255,0.04)",
        }}
        aria-label={on ? "关闭" : "开启"}
      >
        <span
          className="absolute top-0.5 w-5 h-5 rounded-full transition-transform"
          style={{
            left: on ? "calc(100% - 22px)" : "2px",
            background: on ? "var(--ink)" : "var(--cream)",
          }}
        />
      </button>
    </label>
  );
}

export default function SettingsDanmaku() {
  const store = useDanmakuStore();
  const hydrate = useDanmakuStore((s) => s.hydrate);

  const [apiInput, setApiInput] = useState("");
  const [tokenInput, setTokenInput] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: true; count: number } | { ok: false; msg: string } | undefined
  >();

  const [stats, setStats] = useState(() => getDanmakuCacheStats());

  // 新增过滤规则的输入
  const [newKw, setNewKw] = useState("");
  const [newType, setNewType] = useState<"normal" | "regex">("normal");

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    setApiInput(store.apiBase);
    setTokenInput(store.token);
  }, [store.apiBase, store.token]);

  const refreshStats = () => setStats(getDanmakuCacheStats());

  const runTest = async () => {
    setTesting(true);
    setTestResult(undefined);
    try {
      const res = await searchAnime("测试");
      if (res.success) {
        setTestResult({ ok: true, count: res.animes.length });
      } else {
        setTestResult({ ok: false, msg: res.errorMessage || "未知错误" });
      }
    } catch (e) {
      setTestResult({ ok: false, msg: (e as Error).message ?? String(e) });
    } finally {
      setTesting(false);
    }
  };

  const cacheSize = useMemo(() => {
    const kb = stats.approxBytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(2)} MB`;
  }, [stats]);

  return (
    <SettingsSubPageLayout eyebrow="DANMAKU · 弹幕" title="弹幕设置">
      <p className="text-[11px] text-cream-faint mb-4 leading-relaxed">
        弹幕后端兼容 DanDanPlay / danmu_api 协议。内置源由 MoonTV 团队提供共享部署，可能受高峰影响，自部署请切到自定义源
      </p>

      {/* 源类型 */}
      <section
        className="rounded-xl p-4 mb-4"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
      >
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-3">
          SOURCE
        </p>
        <div
          className="flex rounded-lg p-1 mb-3"
          style={{ background: "var(--ink-3)" }}
        >
          {(["builtin", "custom"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => store.setSourceType(s)}
              className="flex-1 py-1.5 rounded-md text-xs font-display font-semibold transition-colors"
              style={{
                background: store.sourceType === s ? "var(--ember)" : "transparent",
                color: store.sourceType === s ? "var(--ink)" : "var(--cream-dim)",
              }}
            >
              {s === "builtin" ? "内置源" : "自定义源"}
            </button>
          ))}
        </div>

        {store.sourceType === "builtin" && (
          <p className="text-[11px] text-cream-faint leading-relaxed font-mono">
            {BUILTIN_DANMAKU_API_BASE}
          </p>
        )}

        {store.sourceType === "custom" && (
          <>
            <label className="block font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-1 mt-2">
              API BASE
            </label>
            <input
              value={apiInput}
              onChange={(e) => setApiInput(e.target.value)}
              placeholder="http://localhost:9321"
              className="w-full px-3 py-2 rounded-lg text-xs font-mono outline-none text-cream placeholder:text-cream-faint mb-2"
              style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
            />
            <label className="block font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-1">
              TOKEN
            </label>
            <input
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder={BUILTIN_DANMAKU_API_TOKEN}
              className="w-full px-3 py-2 rounded-lg text-xs font-mono outline-none text-cream placeholder:text-cream-faint mb-3"
              style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  store.setApiBase(apiInput.trim());
                  store.setToken(tokenInput.trim());
                }}
                className="flex-1 py-2 rounded-lg text-xs font-display font-semibold tap"
                style={{ background: "var(--ember)", color: "var(--ink)" }}
              >
                保存
              </button>
              <button
                type="button"
                onClick={() => void runTest()}
                disabled={testing}
                className="flex-1 py-2 rounded-lg text-xs tap text-cream disabled:opacity-50"
                style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
              >
                {testing ? "测试中…" : "测试连接"}
              </button>
            </div>
          </>
        )}

        {store.sourceType === "builtin" && (
          <button
            type="button"
            onClick={() => void runTest()}
            disabled={testing}
            className="mt-2 w-full py-2 rounded-lg text-xs tap text-cream disabled:opacity-50"
            style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
          >
            {testing ? "测试中…" : "测试连接"}
          </button>
        )}

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
              ? `✓ 连通 · 返回 ${testResult.count} 条结果`
              : `✗ 失败 · ${testResult.msg}`}
          </p>
        )}
      </section>

      {/* 行为开关 */}
      <section
        className="rounded-xl px-4 py-2 mb-4"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
      >
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-1 mt-2">
          BEHAVIOR
        </p>
        <Switch
          on={store.enabled}
          onChange={(v) => store.patchPrefs({ enabled: v })}
          label="启用弹幕"
          sub="Play 页默认展示弹幕层"
        />
        <Switch
          on={store.autoLoad}
          onChange={(v) => store.patchPrefs({ autoLoad: v })}
          label="自动加载上次选择"
          sub="按标题记忆，进入 Play 页时自动套用"
        />
        <Switch
          on={store.enabledInFeed}
          onChange={(v) => store.patchPrefs({ enabledInFeed: v })}
          label="首页 Feed 也显示弹幕"
          sub="抖音式短视频流自动匹配，默认关闭（避免遮挡）"
        />
      </section>

      {/* 显示设置 */}
      <section
        className="rounded-xl p-4 mb-4"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
      >
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-3">
          DISPLAY
        </p>
        <Slider
          label="不透明度"
          value={Math.round(store.opacity * 100)}
          min={20}
          max={100}
          onChange={(n) => store.patchPrefs({ opacity: n / 100 })}
          suffix="%"
        />
        <Slider
          label="字体大小"
          value={store.fontSize}
          min={12}
          max={48}
          onChange={(n) => store.patchPrefs({ fontSize: n })}
          suffix="px"
        />
        <Slider
          label="滚动速度"
          value={store.speed}
          min={3}
          max={20}
          onChange={(n) => store.patchPrefs({ speed: n })}
          suffix="s"
        />
        <Slider
          label="同屏弹幕上限"
          value={store.maxlength}
          min={20}
          max={500}
          step={10}
          onChange={(n) => store.patchPrefs({ maxlength: n })}
        />
      </section>

      {/* 过滤规则 */}
      <section
        className="rounded-xl p-4 mb-4"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
      >
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-3">
          FILTER · {store.filterRules.length}
        </p>
        <div className="flex gap-2 mb-3">
          <input
            value={newKw}
            onChange={(e) => setNewKw(e.target.value)}
            placeholder="关键词或正则"
            className="flex-1 px-3 py-2 rounded-lg text-xs font-mono outline-none text-cream placeholder:text-cream-faint"
            style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
          />
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as "normal" | "regex")}
            className="px-2 py-2 rounded-lg text-xs font-mono outline-none text-cream"
            style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
          >
            <option value="normal">包含</option>
            <option value="regex">正则</option>
          </select>
          <button
            type="button"
            onClick={() => {
              const kw = newKw.trim();
              if (!kw) return;
              store.addFilterRule({ enabled: true, type: newType, keyword: kw });
              setNewKw("");
            }}
            className="px-3 py-2 rounded-lg text-xs font-display font-semibold tap"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            添加
          </button>
        </div>
        {store.filterRules.length === 0 ? (
          <p className="text-[11px] text-cream-faint">尚未配置过滤规则</p>
        ) : (
          <ul className="space-y-1.5">
            {store.filterRules.map((r, i) => (
              <li
                key={`${r.keyword}-${i}`}
                className="flex items-center gap-2 p-2 rounded-lg"
                style={{ background: "var(--ink-3)" }}
              >
                <button
                  type="button"
                  onClick={() => store.toggleFilterRule(i)}
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: r.enabled ? "var(--ember)" : "var(--ink-edge)" }}
                  aria-label={r.enabled ? "停用" : "启用"}
                />
                <span
                  className="font-mono text-[10px] tracking-[0.1em] px-1.5 py-0.5 rounded"
                  style={{
                    background: "var(--cream-pale)",
                    color: "var(--cream-dim)",
                  }}
                >
                  {r.type === "regex" ? "REGEX" : "TEXT"}
                </span>
                <span
                  className={`flex-1 text-xs font-mono truncate ${
                    r.enabled ? "text-cream" : "text-cream-faint line-through"
                  }`}
                >
                  {r.keyword}
                </span>
                <button
                  type="button"
                  onClick={() => store.removeFilterRule(i)}
                  className="text-cream-faint hover:text-ember text-xs px-2 py-0.5 tap"
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 缓存 */}
      <section
        className="rounded-xl p-4 mb-6"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
      >
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-3">
          CACHE
        </p>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-display font-semibold">
              {stats.entries} 集 · {stats.totalComments} 条
            </p>
            <p className="text-[11px] text-cream-faint mt-0.5 font-mono">
              {cacheSize}
            </p>
          </div>
          <button
            type="button"
            onClick={async () => {
              if (!(await appConfirm("清除所有弹幕缓存？已下载的弹幕将丢失。", { tone: "danger" }))) return;
              void clearAllDanmakuCache().then(refreshStats);
            }}
            className="px-4 py-2 rounded-lg text-xs tap text-cream"
            style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
          >
            清除全部
          </button>
        </div>
      </section>
    </SettingsSubPageLayout>
  );
}
