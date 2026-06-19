import { IconCheck, IconSettings, IconTrash } from "@/components/Icon";
import { type MusicSourceDescriptor } from "@/lib/music";
import { IconButton } from "./ui";

const KIND_LABELS: Record<MusicSourceDescriptor["kind"], string> = {
  "lx-server": "LX 音乐源",
  "plugin-js": "JS 插件",
  "aggregate-http": "聚合源",
  "netease-api": "网易云",
  "cyrene-aggregate": "Cyrene 聚合",
  local: "本地音乐",
};

function sourceTypeLabel(source: MusicSourceDescriptor): string {
  const base = KIND_LABELS[source.kind] ?? source.kind;
  if (source.kind === "netease-api") {
    return `${base} · ${source.neteaseMode === "external" ? "自部署" : "内置"}`;
  }
  if (source.kind === "cyrene-aggregate") {
    return `${base} · ${source.cyreneMode ?? "omni"}`;
  }
  return base;
}

export function SourceRow({
  source,
  active,
  onActive,
  onToggle,
  onDelete,
  onRename,
}: {
  source: MusicSourceDescriptor;
  active: boolean;
  onActive: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}) {
  return (
    <article className="rounded-lg px-3 py-3 flex items-center gap-3" style={{ background: active ? "rgba(255,107,53,0.10)" : "rgba(242,232,213,0.045)", border: `1px solid ${active ? "rgba(255,107,53,0.38)" : "transparent"}` }}>
      <button type="button" onClick={onActive} className="w-9 h-9 rounded-lg grid place-items-center shrink-0 tap" style={{ background: source.enabled ? "var(--phosphor-soft)" : "rgba(242,232,213,0.05)", color: source.enabled ? "var(--phosphor)" : "var(--cream-faint)" }}>
        {source.enabled ? <IconCheck size={16} /> : <IconSettings size={16} />}
      </button>
      <div className="min-w-0 flex-1">
        <input value={source.name} onChange={(event) => onRename(event.target.value)} className="w-full bg-transparent text-sm font-display font-semibold text-cream outline-none" />
        <p className="text-xs text-cream-faint line-clamp-1">
          {sourceTypeLabel(source)} {source.baseUrl ? `/ ${source.baseUrl}` : source.description ? `/ ${source.description}` : ""}
        </p>
      </div>
      <button type="button" onClick={onToggle} className="h-8 px-3 rounded-lg text-xs tap" style={{ background: source.enabled ? "var(--phosphor-soft)" : "var(--ink-3)", color: source.enabled ? "var(--phosphor)" : "var(--cream-dim)" }}>
        {source.enabled ? "启用" : "停用"}
      </button>
      <IconButton label="删除" onClick={onDelete}>
        <IconTrash size={15} />
      </IconButton>
    </article>
  );
}
