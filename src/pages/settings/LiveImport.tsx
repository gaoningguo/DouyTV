import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveStore } from "@/stores/live";
import { SettingsSubPageLayout } from "./Layout";
import { IconDownload } from "@/components/Icon";

export default function SettingsLiveImport() {
  const navigate = useNavigate();
  const importM3U = useLiveStore((s) => s.importM3U);
  const [text, setText] = useState("");

  const submit = () => {
    if (!text.trim()) return;
    const n = importM3U(text);
    alert(`已导入 ${n} 个频道`);
    setText("");
    navigate("/settings");
  };

  return (
    <SettingsSubPageLayout eyebrow="LIVE · IMPORT" title="导入 M3U 文本">
      <p className="text-[11px] text-cream-faint mb-4 leading-relaxed">
        粘贴 M3U 文本。支持 #EXTINF / tvg-id / tvg-logo / group-title
      </p>

      <section
        className="rounded-xl p-4"
        style={{
          background: "var(--ink-2)",
          border: "1px solid var(--cream-line)",
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`#EXTM3U\n#EXTINF:-1 tvg-id="cctv1" tvg-logo="..." group-title="新闻",CCTV-1\nhttps://example.com/cctv1.m3u8`}
          className="w-full h-56 px-3 py-2 rounded-lg text-xs font-mono outline-none text-cream placeholder:text-cream-faint resize-none mb-3"
          style={{
            background: "var(--ink-3)",
            border: "1px solid var(--cream-line)",
          }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim()}
          className="w-full py-2.5 rounded-lg text-xs font-display font-semibold tap disabled:opacity-50 flex items-center justify-center gap-1.5"
          style={{ background: "var(--ember)", color: "var(--ink)" }}
        >
          <IconDownload size={14} />
          导入
        </button>
      </section>
    </SettingsSubPageLayout>
  );
}
