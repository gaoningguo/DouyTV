import { type ReactNode } from "react";
import { IconAlbum, IconPlus } from "@/components/Icon";

export function CoverArt({
  src,
  title,
  size = "list",
  spinning,
}: {
  src?: string;
  title?: string;
  size?: "tiny" | "small" | "list" | "hero" | "detail";
  spinning?: boolean;
}) {
  const className =
    size === "detail"
      ? "w-56 h-56 sm:w-72 sm:h-72"
      : size === "hero"
      ? "w-32 h-32 sm:w-44 sm:h-44"
      : size === "list"
        ? "w-12 h-12"
        : size === "small"
          ? "w-11 h-11"
          : "w-10 h-10";
  return (
    <div className={`${className} rounded-lg overflow-hidden shrink-0 grid place-items-center`} style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}>
      {src ? (
        <img src={src} alt={title || ""} className={`w-full h-full object-cover ${spinning ? "music-vinyl-spin rounded-full scale-90" : ""}`} />
      ) : (
        <IconAlbum size={size === "hero" || size === "detail" ? 52 : 24} className="text-cream-faint" />
      )}
    </div>
  );
}

export function SectionHeader({ title, meta, action }: { title: string; meta?: string; action?: ReactNode }) {
  return (
    <div className="music-section-header h-10 flex items-center gap-3 mb-2">
      <h2 className="font-display text-base font-bold">{title}</h2>
      {meta && <span className="font-mono text-[10px] text-cream-faint">{meta}</span>}
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

export function TextTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="relative h-9 px-1 text-sm font-display tap transition-colors" style={{ color: active ? "var(--cream)" : "var(--cream-faint)" }}>
      {children}
      <span className="absolute left-0 right-0 bottom-1 mx-auto h-0.5 rounded-full transition-all" style={{ width: active ? 20 : 0, background: "var(--ember)", boxShadow: active ? "0 0 8px var(--ember-glow)" : undefined }} />
    </button>
  );
}

export function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="shrink-0 h-8 px-3 rounded-full text-xs tap" style={{ border: `1px solid ${active ? "var(--ember)" : "var(--cream-line)"}`, color: active ? "var(--ember)" : "var(--cream-dim)", background: active ? "var(--ember-soft)" : "transparent" }}>
      {children}
    </button>
  );
}

export function IconButton({ active, label, onClick, children }: { active?: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="w-8 h-8 rounded-lg grid place-items-center tap transition-colors" style={{ color: active ? "var(--ember)" : "var(--cream-dim)", background: active ? "var(--ember-soft)" : "transparent" }}>
      {children}
    </button>
  );
}

export function EmptyBlock({ text }: { text: string }) {
  return (
    <div className="h-48 rounded-lg grid place-items-center text-center text-cream-dim" style={{ background: "rgba(242,232,213,0.03)", border: "1px solid var(--cream-line)" }}>
      <div>
        <IconAlbum size={38} className="mx-auto mb-2 text-cream-faint" />
        <p className="text-sm">{text}</p>
      </div>
    </div>
  );
}

export function EmptyMusicState({ onOpenSource }: { onOpenSource: () => void }) {
  return (
    <section className="h-[68vh] grid place-items-center text-center">
      <div>
        <IconAlbum size={56} className="mx-auto mb-4 text-cream-faint" />
        <h1 className="font-display text-xl font-bold">还没有音乐源</h1>
        <p className="mt-2 text-sm text-cream-dim max-w-md">
          添加 MoonTV 同款 LX Music API Server 后，搜索、榜单、歌单和完整播放会自动可用。
        </p>
        <button type="button" onClick={onOpenSource} className="mt-5 h-10 px-4 rounded-lg inline-flex items-center gap-2 text-sm font-display font-bold tap" style={{ background: "var(--ember)", color: "var(--ink)" }}>
          <IconPlus size={16} />
          添加音乐源
        </button>
      </div>
    </section>
  );
}

export function Switch({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="w-12 h-7 rounded-full p-1 tap" style={{ background: checked ? "var(--ember)" : "var(--ink-3)" }}>
      <span className="block w-5 h-5 rounded-full transition-transform" style={{ background: checked ? "var(--ink)" : "var(--cream-dim)", transform: checked ? "translateX(20px)" : "translateX(0)" }} />
    </button>
  );
}

export function SettingRow({ title, desc, children }: { title: string; desc: string; children: ReactNode }) {
  return (
    <div className="rounded-lg p-3 flex items-center gap-3" style={{ background: "rgba(242,232,213,0.045)", border: "1px solid var(--cream-line)" }}>
      <div className="min-w-0 flex-1">
        <h3 className="font-display text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs text-cream-faint">{desc}</p>
      </div>
      {children}
    </div>
  );
}

export function MiniSpectrum({ active }: { active: boolean }) {
  return (
    <div className="hidden md:flex h-8 items-end gap-1 px-2" aria-hidden>
      {Array.from({ length: 10 }).map((_, index) => (
        <span
          key={index}
          className="music-visualizer-bar"
          style={{
            height: active ? 8 + ((index * 7) % 20) : 5,
            animationDelay: `${index * 70}ms`,
            opacity: active ? undefined : 0.28,
          }}
        />
      ))}
    </div>
  );
}
