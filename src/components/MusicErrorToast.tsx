/**
 * 全局音乐错误 toast —— 订阅 useMusicStore.error，4s 自动消失。
 * 错误信息含"配置 / 插件 / MusicApi / LX-Music"时附带"前往设置"链接。
 *
 * 参考 MusicFree `components/base/noPlugin.tsx` 的 NoPlugin 提示思路，让"播不出来"的根因
 * 直接呈现给用户。
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMusicStore } from "@/stores/music";
import { IconClose, IconMusic } from "@/components/Icon";

const SETTINGS_KEYWORDS = ["配置", "插件", "MusicApi", "LX-Music", "backend", "后端"];

export default function MusicErrorToast() {
  const error = useMusicStore((s) => s.error);
  const setError = useMusicStore((s) => s.setError);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!error) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const t = window.setTimeout(() => {
      setVisible(false);
      // 5s 后清掉 error 避免下次再触发
      window.setTimeout(() => setError(null), 200);
    }, 5000);
    return () => window.clearTimeout(t);
  }, [error, setError]);

  if (!error || !visible) return null;

  const showSettingsLink = SETTINGS_KEYWORDS.some((k) =>
    error.toLowerCase().includes(k.toLowerCase())
  );

  return (
    <div
      className="fixed left-1/2 z-[60] -translate-x-1/2 max-w-md w-[calc(100vw-2rem)] pointer-events-auto"
      style={{
        bottom: "calc(var(--bottom-tab-h, 0px) + 80px)",
        animation: "toast-in 240ms ease-out both",
      }}
      role="alert"
    >
      <div
        className="flex items-start gap-3 p-3 rounded-xl backdrop-blur-md"
        style={{
          background: "rgba(20,15,17,0.92)",
          border: "1px solid rgba(255,107,53,0.35)",
          boxShadow: "0 16px 40px -16px rgba(0,0,0,0.7)",
        }}
      >
        <span
          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
          style={{
            background: "rgba(255,107,53,0.15)",
            color: "var(--ember)",
          }}
        >
          <IconMusic size={16} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-mono tracking-[0.2em] text-cream-faint mb-0.5">
            MUSIC · ERROR
          </p>
          <p className="text-xs text-cream leading-snug break-words">{error}</p>
          {showSettingsLink && (
            <Link
              to="/settings/music"
              onClick={() => {
                setVisible(false);
                setError(null);
              }}
              className="inline-block mt-2 px-3 py-1 rounded-full text-[10px] font-display font-semibold tap"
              style={{ background: "var(--ember)", color: "var(--ink)" }}
            >
              前往设置 →
            </Link>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setVisible(false);
            setError(null);
          }}
          className="w-7 h-7 flex items-center justify-center tap text-cream-faint hover:text-cream shrink-0"
          aria-label="关闭"
        >
          <IconClose size={12} />
        </button>
      </div>
    </div>
  );
}
