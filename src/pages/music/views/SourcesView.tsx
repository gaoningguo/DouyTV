import { IconPlus } from "@/components/Icon";
import { type MusicSourceDescriptor } from "@/lib/music";
import { EmptyBlock, SectionHeader } from "../components/ui";
import { SourceRow } from "../components/SourceRow";

export function SourcesView({
  sources,
  activeSourceId,
  onActive,
  onOpen,
  onToggle,
  onDelete,
  onRename,
}: {
  sources: MusicSourceDescriptor[];
  activeSourceId: string;
  onActive: (id: string) => void;
  onOpen: () => void;
  onToggle: (id: string) => void;
  onDelete: (source: MusicSourceDescriptor) => void;
  onRename: (source: MusicSourceDescriptor, name: string) => void;
}) {
  return (
    <div className="space-y-3 pb-4">
      <SectionHeader
        title="音乐源"
        meta={`${sources.filter((item) => item.enabled).length} 个已启用`}
        action={
          <button type="button" onClick={onOpen} className="h-8 px-3 rounded-lg inline-flex items-center gap-1.5 text-xs tap" style={{ background: "var(--ember)", color: "var(--ink)" }}>
            <IconPlus size={14} />
            导入
          </button>
        }
      />
      <div className="space-y-2">
        {sources.length === 0 ? (
          <EmptyBlock text="导入 LX Server、LX JS、MusicFree 或聚合源" />
        ) : (
          sources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              active={activeSourceId === source.id}
              onActive={() => onActive(source.id)}
              onToggle={() => onToggle(source.id)}
              onDelete={() => onDelete(source)}
              onRename={(name) => onRename(source, name)}
            />
          ))
        )}
      </div>
    </div>
  );
}
