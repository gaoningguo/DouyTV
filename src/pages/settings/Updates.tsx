import { useEffect } from "react";
import { useUpdater } from "@/hooks/useUpdater";
import { isMobile, isTauri } from "@/lib/platform";
import { SettingsSubPageLayout } from "./Layout";

const APP_VERSION = "1.0.1";

export default function SettingsUpdates() {
  const { state, check, downloadAndInstall } = useUpdater(false);

  useEffect(() => {
    if (isTauri() && !isMobile()) {
      void check();
    }
  }, [check]);

  const mobile = isMobile();
  const browser = !isTauri();

  return (
    <SettingsSubPageLayout eyebrow="SYSTEM · UPDATES" title="检查更新">
      <section
        className="rounded-xl p-4 mb-4"
        style={{
          background: "var(--ink-2)",
          border: "1px solid var(--cream-line)",
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
              CURRENT
            </p>
            <p className="font-display text-lg font-extrabold mt-0.5">
              v{APP_VERSION}
            </p>
          </div>
          {!mobile && !browser && (
            <button
              type="button"
              onClick={() => void check()}
              disabled={state.status === "checking" || state.status === "downloading"}
              className="px-4 py-2 rounded-lg text-xs font-display font-semibold tap disabled:opacity-50"
              style={{
                background: "var(--ink-3)",
                border: "1px solid var(--cream-line)",
                color: "var(--cream)",
              }}
            >
              {state.status === "checking" ? "检查中…" : "立即检查"}
            </button>
          )}
        </div>

        {mobile && (
          <p className="text-[11px] text-cream-faint leading-relaxed">
            移动端通过应用商店 / APK 自行更新，DouyTV 本身不内置更新器
          </p>
        )}

        {browser && (
          <p className="text-[11px] text-cream-faint leading-relaxed">
            浏览器 dev 模式下不可用，请在 Tauri 桌面端检查
          </p>
        )}

        {!mobile && !browser && (
          <>
            {state.status === "up-to-date" && (
              <p
                className="p-2 rounded text-xs font-mono"
                style={{
                  background: "var(--phosphor-soft)",
                  color: "var(--phosphor)",
                  border: "1px solid rgba(124,255,178,0.25)",
                }}
              >
                ✓ 已是最新版本
              </p>
            )}

            {state.status === "available" && state.available && (
              <div>
                <div
                  className="p-3 rounded mb-3"
                  style={{
                    background: "var(--ember-soft)",
                    border: "1px solid rgba(255,107,53,0.3)",
                  }}
                >
                  <p
                    className="font-display font-bold text-sm"
                    style={{ color: "var(--ember)" }}
                  >
                    可更新到 v{state.available.version}
                  </p>
                  {state.available.date && (
                    <p className="font-mono text-[10px] text-cream-faint mt-1">
                      {state.available.date}
                    </p>
                  )}
                  {state.available.body && (
                    <p className="text-[11px] text-cream-dim mt-2 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
                      {state.available.body}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void downloadAndInstall()}
                  className="w-full py-2.5 rounded-lg text-xs font-display font-bold tap"
                  style={{ background: "var(--ember)", color: "var(--ink)" }}
                >
                  下载并安装（完成后自动重启）
                </button>
              </div>
            )}

            {state.status === "downloading" && (
              <div>
                <p className="font-mono text-[10px] text-cream-faint mb-2">
                  DOWNLOADING · {Math.round(state.progress * 100)}%
                </p>
                <div
                  className="h-1.5 rounded-full overflow-hidden"
                  style={{ background: "var(--ink-edge)" }}
                >
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${state.progress * 100}%`,
                      background: "var(--ember)",
                      boxShadow: "0 0 8px var(--ember-glow)",
                    }}
                  />
                </div>
              </div>
            )}

            {state.status === "installed" && (
              <p
                className="p-2 rounded text-xs font-mono"
                style={{
                  background: "var(--phosphor-soft)",
                  color: "var(--phosphor)",
                  border: "1px solid rgba(124,255,178,0.25)",
                }}
              >
                ✓ 安装完成，正在重启…
              </p>
            )}

            {state.status === "error" && (
              <p
                className="p-2 rounded text-xs font-mono break-all"
                style={{
                  background: "rgba(255,80,80,0.08)",
                  color: "#FF6B6B",
                  border: "1px solid rgba(255,80,80,0.25)",
                }}
              >
                ✗ {state.error}
              </p>
            )}
          </>
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
          UPDATE CHANNEL
        </p>
        <p>更新源 · GitHub Releases ({"GAONX6/DouyTV"})</p>
        <p className="mt-1">
          签名验证 · ed25519 公钥校验，防止中间人替换
        </p>
      </div>
    </SettingsSubPageLayout>
  );
}
