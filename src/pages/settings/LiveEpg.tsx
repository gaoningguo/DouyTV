import { useEffect, useState } from "react";
import { useEpgStore } from "@/stores/epg";
import { SettingsSubPageLayout } from "./Layout";

export default function SettingsLiveEpg() {
  const url = useEpgStore((s) => s.url);
  const programmes = useEpgStore((s) => s.programmes);
  const loading = useEpgStore((s) => s.loading);
  const error = useEpgStore((s) => s.error);
  const updatedAt = useEpgStore((s) => s.updatedAt);
  const hydrate = useEpgStore((s) => s.hydrate);
  const setUrl = useEpgStore((s) => s.setUrl);
  const refresh = useEpgStore((s) => s.refresh);
  const clear = useEpgStore((s) => s.clear);

  const [input, setInput] = useState("");

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    setInput(url);
  }, [url]);

  const channelCount = Object.keys(programmes).length;

  return (
    <SettingsSubPageLayout eyebrow="LIVE · EPG" title="节目单订阅">
      <p className="text-[11px] text-cream-faint mb-4 leading-relaxed">
        填写 XMLTV 格式的 EPG URL，频道按 tvg-id 自动匹配节目表
      </p>

      <section
        className="rounded-xl p-4 mb-4"
        style={{
          background: "var(--ink-2)",
          border: "1px solid var(--cream-line)",
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="https://example.com/epg.xml"
          className="w-full px-3 py-2 rounded-lg text-xs mb-3 outline-none text-cream placeholder:text-cream-faint font-mono"
          style={{
            background: "var(--ink-3)",
            border: "1px solid var(--cream-line)",
          }}
        />
        <p className="font-mono text-[10px] text-cream-faint mb-3 leading-relaxed">
          {loading
            ? "刷新中…"
            : error
            ? `错误：${error}`
            : updatedAt
            ? `已加载 ${channelCount} 个频道节目 · ${new Date(updatedAt).toLocaleString()}`
            : "未加载"}
        </p>
        <div className="flex gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setUrl(input.trim())}
            disabled={!input.trim() || input.trim() === url}
            className="flex-1 min-w-[80px] py-2 rounded-lg text-xs font-display font-semibold tap disabled:opacity-50"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            保存
          </button>
          {url && (
            <button
              type="button"
              onClick={() => void refresh()}
              className="flex-1 min-w-[80px] py-2 rounded-lg text-xs tap text-cream"
              style={{
                background: "var(--ink-3)",
                border: "1px solid var(--cream-line)",
              }}
            >
              立即刷新
            </button>
          )}
          {url && (
            <button
              type="button"
              onClick={() => {
                if (confirm("清除 EPG 配置和缓存？")) {
                  clear();
                  setInput("");
                }
              }}
              className="flex-1 min-w-[80px] py-2 rounded-lg text-xs tap"
              style={{
                background: "rgba(255,80,80,0.08)",
                color: "#FF6B6B",
                border: "1px solid rgba(255,80,80,0.25)",
              }}
            >
              清除
            </button>
          )}
        </div>
      </section>
    </SettingsSubPageLayout>
  );
}
