import { useEffect, useState } from "react";
import { appAlert } from "@/components/AppDialog";
import { IconCheck, IconRefresh } from "@/components/Icon";
import { getMangaSources } from "@/lib/manga";
import type { MangaSource } from "@/lib/manga/types";
import { useMangaStore } from "@/stores/manga";
import { SettingsSubPageLayout } from "./Layout";

export default function SettingsMangaSourcesHub() {
  const hydrate = useMangaStore((s) => s.hydrate);
  const config = useMangaStore((s) => s.config);
  const setConfig = useMangaStore((s) => s.setConfig);

  const [serverUrl, setServerUrl] = useState(config.serverUrl);
  const [authMode, setAuthMode] = useState(config.authMode);
  const [username, setUsername] = useState(config.username || "");
  const [password, setPassword] = useState(config.password || "");
  const [defaultLang, setDefaultLang] = useState(config.defaultLang);
  const [testing, setTesting] = useState(false);
  const [sources, setSources] = useState<MangaSource[]>([]);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    setServerUrl(config.serverUrl);
    setAuthMode(config.authMode);
    setUsername(config.username || "");
    setPassword(config.password || "");
    setDefaultLang(config.defaultLang);
  }, [config]);

  const save = (enabled: boolean) => {
    setConfig({
      enabled,
      serverUrl: serverUrl.trim().replace(/\/$/, ""),
      authMode,
      username: username.trim() || undefined,
      password: password || undefined,
      defaultLang: defaultLang.trim() || "zh",
    });
  };

  const test = async () => {
    save(true);
    setTesting(true);
    setSources([]);
    try {
      const list = await getMangaSources();
      setSources(list);
      await appAlert(`连接成功,识别到 ${list.length} 个可用源。`);
    } catch (e) {
      await appAlert(`连接失败: ${(e as Error).message}`, { tone: "danger" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <SettingsSubPageLayout eyebrow="SETTINGS · MANGA" title="漫画管理">
      <div className="space-y-5 max-w-2xl">
        <p className="text-sm text-cream-dim leading-relaxed">
          漫画功能对接你自部署的{" "}
          <span className="text-ember font-mono">Suwayomi</span> 服务
          (Tachidesk)。填写服务地址后即可用其安装的插件源搜索、阅读漫画。
        </p>

        <Field label="服务地址">
          <input
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="http://192.168.1.10:4567"
            className="w-full rounded-lg px-3 py-2.5 text-sm bg-ink-2 text-cream outline-none"
            style={{ border: "1px solid var(--cream-line)" }}
          />
        </Field>

        <Field label="鉴权方式">
          <div className="flex gap-2">
            {(["none", "basic_auth", "simple_login"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setAuthMode(mode)}
                className="flex-1 rounded-lg px-3 py-2 text-xs tap transition-colors"
                style={{
                  background: authMode === mode ? "var(--ember-soft)" : "var(--ink-2)",
                  color: authMode === mode ? "var(--ember)" : "var(--cream-dim)",
                  border: "1px solid var(--cream-line)",
                }}
              >
                {mode === "none" ? "无" : mode === "basic_auth" ? "Basic Auth" : "登录"}
              </button>
            ))}
          </div>
        </Field>

        {authMode !== "none" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="用户名">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm bg-ink-2 text-cream outline-none"
                style={{ border: "1px solid var(--cream-line)" }}
              />
            </Field>
            <Field label="密码">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-sm bg-ink-2 text-cream outline-none"
                style={{ border: "1px solid var(--cream-line)" }}
              />
            </Field>
          </div>
        )}

        <Field label="默认语言(过滤源)">
          <input
            value={defaultLang}
            onChange={(e) => setDefaultLang(e.target.value)}
            placeholder="zh"
            className="w-full rounded-lg px-3 py-2.5 text-sm bg-ink-2 text-cream outline-none"
            style={{ border: "1px solid var(--cream-line)" }}
          />
        </Field>

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={() => save(true)}
            className="flex-1 rounded-lg py-2.5 text-sm font-semibold tap glow-ember"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            <IconCheck size={16} className="inline mr-1.5 -mt-0.5" />
            保存并启用
          </button>
          <button
            type="button"
            onClick={test}
            disabled={testing || !serverUrl.trim()}
            className="rounded-lg px-4 py-2.5 text-sm tap"
            style={{
              background: "var(--ink-2)",
              color: "var(--cream)",
              border: "1px solid var(--cream-line)",
              opacity: testing || !serverUrl.trim() ? 0.5 : 1,
            }}
          >
            <IconRefresh size={16} className={`inline mr-1.5 -mt-0.5 ${testing ? "animate-spin" : ""}`} />
            {testing ? "测试中" : "测试连接"}
          </button>
        </div>

        {config.enabled && (
          <button
            type="button"
            onClick={() => save(false)}
            className="w-full rounded-lg py-2 text-xs tap text-cream-faint"
            style={{ border: "1px solid var(--cream-line)" }}
          >
            停用漫画功能
          </button>
        )}

        {sources.length > 0 && (
          <div className="pt-2">
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
              可用源 ({sources.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {sources.map((s) => (
                <span
                  key={s.id}
                  className="chip-ch text-[11px] px-2 py-1 rounded"
                  style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
                >
                  {s.displayName || s.name}
                  {s.lang ? ` · ${s.lang}` : ""}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </SettingsSubPageLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] tracking-[0.2em] text-cream-faint block mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}
