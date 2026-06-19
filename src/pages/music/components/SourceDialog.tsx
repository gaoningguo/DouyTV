import { IconClose, IconSettings } from "@/components/Icon";
import { type MusicSourceDescriptor } from "@/lib/music";
import { EmptyBlock } from "./ui";
import { SourceRow } from "./SourceRow";

export function SourceDialog({
  sources,
  importText,
  lxBaseUrl,
  lxToken,
  neteaseBaseUrl,
  onImportText,
  onLxBaseUrl,
  onLxToken,
  onNeteaseBaseUrl,
  cyreneBaseUrl,
  cyreneMode,
  onCyreneBaseUrl,
  onCyreneMode,
  onClose,
  onImport,
  onAddLx,
  onAddNeteaseBuiltin,
  onAddNeteaseExternal,
  onAddCyrene,
  onToggle,
  onDelete,
  onRename,
}: {
  sources: MusicSourceDescriptor[];
  importText: string;
  lxBaseUrl: string;
  lxToken: string;
  neteaseBaseUrl: string;
  onImportText: (value: string) => void;
  onLxBaseUrl: (value: string) => void;
  onLxToken: (value: string) => void;
  onNeteaseBaseUrl: (value: string) => void;
  cyreneBaseUrl: string;
  cyreneMode: "omni" | "tunehub" | "lx";
  onCyreneBaseUrl: (value: string) => void;
  onCyreneMode: (value: "omni" | "tunehub" | "lx") => void;
  onClose: () => void;
  onImport: () => void;
  onAddLx: () => void;
  onAddNeteaseBuiltin: () => void;
  onAddNeteaseExternal: () => void;
  onAddCyrene: () => void;
  onToggle: (id: string) => void;
  onDelete: (source: MusicSourceDescriptor) => void;
  onRename: (source: MusicSourceDescriptor, name: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <button type="button" aria-label="关闭" className="absolute inset-0 cursor-default" style={{ background: "rgba(0,0,0,0.68)" }} onClick={onClose} />
      <section className="relative w-full max-w-3xl max-h-full overflow-hidden rounded-xl flex flex-col" style={{ background: "rgba(22,24,29,0.98)", border: "1px solid var(--cream-line)", boxShadow: "0 28px 90px -35px rgba(0,0,0,0.9)" }}>
        <header className="h-14 px-4 flex items-center gap-3 shrink-0" style={{ borderBottom: "1px solid var(--cream-line)" }}>
          <IconSettings size={19} style={{ color: "var(--ember)" }} />
          <h2 className="font-display font-bold">音乐源管理</h2>
          <button type="button" onClick={onClose} className="ml-auto w-9 h-9 rounded-lg grid place-items-center tap text-cream-dim">
            <IconClose size={17} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <section>
            <h3 className="text-sm font-display font-bold mb-2">网易云音乐</h3>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 text-xs text-cream-faint">
                  内置直连 music.163.com，免部署、全平台、开箱即用（搜索/歌词/发现；免费曲 320k、版权曲 128k，VIP 曲自动回落其它源）。
                </div>
                <button type="button" onClick={onAddNeteaseBuiltin} className="h-9 px-4 rounded-lg text-xs font-display font-bold tap shrink-0" style={{ background: "var(--ember)", color: "var(--ink)" }}>添加内置源</button>
              </div>
              <div className="grid md:grid-cols-[1fr_auto] gap-2">
                <input value={neteaseBaseUrl} onChange={(event) => onNeteaseBaseUrl(event.target.value)} placeholder="自部署 NeteaseCloudMusicApi 地址（可选，如 http://127.0.0.1:3000）" className="h-10 rounded-lg px-3 bg-ink text-sm outline-none text-cream" style={{ border: "1px solid var(--cream-line)" }} />
                <button type="button" onClick={onAddNeteaseExternal} className="h-10 px-4 rounded-lg text-xs font-display font-bold tap" style={{ background: "var(--vhs)", color: "var(--ink)" }}>添加自部署</button>
              </div>
            </div>
          </section>
          <section>
            <h3 className="text-sm font-display font-bold mb-2">添加 LX Music API Server</h3>
            <div className="grid md:grid-cols-[1fr_180px_auto] gap-2">
              <input value={lxBaseUrl} onChange={(event) => onLxBaseUrl(event.target.value)} placeholder="http://35.208.239.12:9527/" className="h-10 rounded-lg px-3 bg-ink text-sm outline-none text-cream" style={{ border: "1px solid var(--cream-line)" }} />
              <input value={lxToken} onChange={(event) => onLxToken(event.target.value)} placeholder="Token（可选）" className="h-10 rounded-lg px-3 bg-ink text-sm outline-none text-cream" style={{ border: "1px solid var(--cream-line)" }} />
              <button type="button" onClick={onAddLx} className="h-10 px-4 rounded-lg text-xs font-display font-bold tap" style={{ background: "var(--ember)", color: "var(--ink)" }}>添加</button>
            </div>
          </section>
          <section>
            <h3 className="text-sm font-display font-bold mb-2">Cyrene 聚合源</h3>
            <div className="grid md:grid-cols-[1fr_140px_auto] gap-2">
              <input value={cyreneBaseUrl} onChange={(event) => onCyreneBaseUrl(event.target.value)} placeholder="聚合后端地址（如 https://music.nekofun.top）" className="h-10 rounded-lg px-3 bg-ink text-sm outline-none text-cream" style={{ border: "1px solid var(--cream-line)" }} />
              <select value={cyreneMode} onChange={(event) => onCyreneMode(event.target.value as "omni" | "tunehub" | "lx")} className="h-10 rounded-lg px-2 bg-ink text-sm outline-none text-cream" style={{ border: "1px solid var(--cream-line)" }}>
                <option value="omni">OmniParse</option>
                <option value="tunehub">TuneHub</option>
                <option value="lx">LX 直链</option>
              </select>
              <button type="button" onClick={onAddCyrene} className="h-10 px-4 rounded-lg text-xs font-display font-bold tap" style={{ background: "var(--vhs)", color: "var(--ink)" }}>添加</button>
            </div>
            <p className="mt-1 text-xs text-cream-faint">多平台搜索(网易/QQ/酷我/酷狗)；播放解析按所选模式。公共实例常禁播放，建议填自有后端。</p>
          </section>
          <section>
            <h3 className="text-sm font-display font-bold mb-2">导入插件 / 聚合源</h3>
            <textarea
              value={importText}
              onChange={(event) => onImportText(event.target.value)}
              placeholder="粘贴 lx-music-source / MusicFree 插件源码、JS URL、LX Server URL，或 aggregate-http JSON 配置"
              className="w-full h-32 rounded-lg p-3 bg-ink text-sm text-cream outline-none resize-none"
              style={{ border: "1px solid var(--cream-line)" }}
            />
            <div className="mt-2 flex items-center gap-2">
              <p className="text-xs text-cream-faint flex-1">
                当前优先兼容 LX API Server；JS/MusicFree/聚合源保留统一导入入口。
              </p>
              <button type="button" onClick={onImport} className="h-9 px-4 rounded-lg text-xs font-display font-bold tap" style={{ background: "var(--vhs)", color: "var(--ink)" }}>导入</button>
            </div>
          </section>
          <section>
            <h3 className="text-sm font-display font-bold mb-2">已安装源</h3>
            <div className="space-y-2">
              {sources.length === 0 ? (
                <EmptyBlock text="暂无音乐源" />
              ) : (
                sources.map((source) => (
                  <SourceRow
                    key={source.id}
                    source={source}
                    active={false}
                    onActive={() => undefined}
                    onToggle={() => onToggle(source.id)}
                    onDelete={() => onDelete(source)}
                    onRename={(name) => onRename(source, name)}
                  />
                ))
              )}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
