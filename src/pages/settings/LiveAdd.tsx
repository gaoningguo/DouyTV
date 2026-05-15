import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveStore } from "@/stores/live";
import { SettingsSubPageLayout } from "./Layout";
import { IconPlus } from "@/components/Icon";

export default function SettingsLiveAdd() {
  const navigate = useNavigate();
  const add = useLiveStore((s) => s.add);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [epgId, setEpgId] = useState("");
  const [ua, setUa] = useState("");
  const [referer, setReferer] = useState("");

  const submit = () => {
    if (!name.trim() || !url.trim()) return;
    add({
      id: `user-${Date.now()}`,
      name: name.trim(),
      url: url.trim(),
      category: "自定义",
      epgId: epgId.trim() || undefined,
      ua: ua.trim() || undefined,
      referer: referer.trim() || undefined,
    });
    navigate("/settings");
  };

  return (
    <SettingsSubPageLayout eyebrow="LIVE · ADD CHANNEL" title="添加直播频道">
      <p className="text-[11px] text-cream-faint mb-4 leading-relaxed">
        手动添加单个频道。批量请用 M3U 订阅或导入
      </p>

      <section
        className="rounded-xl p-4 space-y-3"
        style={{
          background: "var(--ink-2)",
          border: "1px solid var(--cream-line)",
        }}
      >
        <Field label="频道名称" value={name} onChange={setName} placeholder="如 CCTV-1" />
        <Field
          label="m3u8 URL"
          value={url}
          onChange={setUrl}
          placeholder="https://..."
          mono
        />
        <Field
          label="EPG tvg-id（可选）"
          value={epgId}
          onChange={setEpgId}
          placeholder="cctv1"
          mono
        />
        <Field
          label="User-Agent（可选）"
          value={ua}
          onChange={setUa}
          placeholder="AptvPlayer/1.4.10"
          mono
        />
        <Field
          label="Referer（可选）"
          value={referer}
          onChange={setReferer}
          placeholder="防盗链时填"
          mono
        />
        <button
          type="button"
          onClick={submit}
          disabled={!name.trim() || !url.trim()}
          className="w-full py-2.5 rounded-lg text-xs font-display font-semibold tap disabled:opacity-50 flex items-center justify-center gap-1.5"
          style={{ background: "var(--ember)", color: "var(--ink)" }}
        >
          <IconPlus size={14} />
          添加
        </button>
      </section>
    </SettingsSubPageLayout>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="block font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-1">
        {label.toUpperCase()}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-3 py-2 rounded-lg text-sm outline-none text-cream placeholder:text-cream-faint ${
          mono ? "font-mono text-xs" : ""
        }`}
        style={{
          background: "var(--ink-3)",
          border: "1px solid var(--cream-line)",
        }}
      />
    </div>
  );
}
