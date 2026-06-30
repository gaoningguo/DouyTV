import { useRef, useState } from "react";
import { IconCheck, IconClose, IconSettings } from "@/components/Icon";
import {
  createBuiltinNeteaseSource,
  createLxSourceDescriptor,
  decryptCyreneConfig,
  fetchAndParseLxScript,
  importMusicSourceFromText,
  normalizeMusicSourceDescriptor,
  parseLxScript,
  MUSIC_PLATFORMS,
  type MusicSourceDescriptor,
} from "@/lib/music";
import { EmptyBlock } from "./ui";
import { SourceRow } from "./SourceRow";

/** 添加音源的类型(对齐 CyreneMusic 的类型选择 + 我们额外保留的网易/LX Server/插件)。 */
type AddType = "netease" | "omni" | "lx" | "tunehub" | "lx-server" | "plugin";

const ADD_TYPES: Array<{ id: AddType; label: string; hint: string }> = [
  { id: "netease", label: "网易云", hint: "内置直连 / 自部署 API" },
  { id: "lx", label: "洛雪音源", hint: ".js 脚本 / 在线链接" },
  { id: "omni", label: "OmniParse", hint: ".cyrene 文件 / 手填" },
  { id: "tunehub", label: "TuneHub", hint: "公开 API + Key" },
  { id: "lx-server", label: "LX Server", hint: "MoonTV 同款 API" },
  { id: "plugin", label: "插件 / 聚合", hint: "MusicFree JS / JSON" },
];

interface ParsedPreview {
  name: string;
  detail: string;
}

export function SourceDialog({
  sources,
  onClose,
  onInstall,
  onToggle,
  onDelete,
  onRename,
}: {
  sources: MusicSourceDescriptor[];
  onClose: () => void;
  onInstall: (source: MusicSourceDescriptor) => void;
  onToggle: (id: string) => void;
  onDelete: (source: MusicSourceDescriptor) => void;
  onRename: (source: MusicSourceDescriptor, name: string) => void;
}) {
  const [addType, setAddType] = useState<AddType>("netease");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [neteaseMode, setNeteaseMode] = useState<"builtin" | "external">("builtin");
  const [lxText, setLxText] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<ParsedPreview | null>(null);
  // 解析出的待保存描述符(洛雪/OmniParse 文件解析后暂存,点保存才安装)。
  const [pending, setPending] = useState<MusicSourceDescriptor | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setName("");
    setUrl("");
    setApiKey("");
    setLxText("");
    setPasteText("");
    setError("");
    setPreview(null);
    setPending(null);
  };

  const switchType = (next: AddType) => {
    setAddType(next);
    resetForm();
  };

  const install = (descriptor: MusicSourceDescriptor) => {
    onInstall(descriptor);
    resetForm();
  };

  // 网易:内置免部署 / 自部署 API。
  const addNetease = () => {
    if (neteaseMode === "builtin") {
      install(createBuiltinNeteaseSource());
      return;
    }
    if (!url.trim()) {
      setError("请输入自部署 NeteaseCloudMusicApi 地址");
      return;
    }
    install(
      normalizeMusicSourceDescriptor({
        name: name.trim() || "网易云(自部署)",
        kind: "netease-api",
        neteaseMode: "external",
        baseUrl: url.trim(),
      })
    );
  };

  // OmniParse:手填 url+key,或导入 .cyrene 加密文件。
  const addOmni = () => {
    if (!url.trim()) {
      setError("请输入 OmniParse 后端地址");
      return;
    }
    install(
      normalizeMusicSourceDescriptor({
        name: name.trim() || "OmniParse 聚合源",
        kind: "cyrene-aggregate",
        cyreneMode: "omni",
        baseUrl: url.trim(),
        token: apiKey.trim() || undefined,
        defaultPlatform: "all",
        platforms: MUSIC_PLATFORMS.map((item) => item.id),
      })
    );
  };

  const addTunehub = () => {
    if (!url.trim()) {
      setError("请输入 TuneHub 后端地址");
      return;
    }
    install(
      normalizeMusicSourceDescriptor({
        name: name.trim() || "TuneHub 聚合源",
        kind: "cyrene-aggregate",
        cyreneMode: "tunehub",
        baseUrl: url.trim(),
        token: apiKey.trim() || undefined,
        defaultPlatform: "all",
        platforms: MUSIC_PLATFORMS.map((item) => item.id),
      })
    );
  };

  const addLxServer = () => {
    if (!url.trim()) {
      setError("请输入 LX Music API Server 地址");
      return;
    }
    install(
      normalizeMusicSourceDescriptor({
        name: name.trim() || "LX Music API Server",
        kind: "lx-server",
        baseUrl: url.trim(),
        token: apiKey.trim() || undefined,
        defaultPlatform: "all",
        platforms: MUSIC_PLATFORMS.map((item) => item.id),
      })
    );
  };

  // 洛雪音源在线导入:下载脚本 → 解析元数据 → 暂存预览。
  const importLxOnline = async () => {
    if (!lxText.trim()) {
      setError("请输入洛雪音源脚本直链 URL");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const parsed = lxText.trim().startsWith("http")
        ? await fetchAndParseLxScript(lxText.trim())
        : parseLxScript(lxText.trim());
      if (!parsed) {
        setError("解析失败:脚本下载或读取出错,请检查链接/源码");
        return;
      }
      const descriptor = createLxSourceDescriptor(parsed);
      setPending(descriptor);
      setPreview({
        name: parsed.name,
        detail: [
          parsed.version && `v${parsed.version}`,
          parsed.author,
          parsed.mode === "runtime" ? "执行模式(脚本算签名取链)" : parsed.apiUrl,
        ]
          .filter(Boolean)
          .join(" · "),
      });
    } catch {
      setError("脚本下载或解析失败,请检查链接");
    } finally {
      setBusy(false);
    }
  };

  // 通用插件 / 聚合源:粘贴源码、URL 或 JSON,走统一识别管线。
  const importPlugin = async () => {
    if (!pasteText.trim()) {
      setError("请粘贴插件源码、URL 或 JSON 配置");
      return;
    }
    setBusy(true);
    setError("");
    try {
      install(await importMusicSourceFromText(pasteText.trim()));
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "导入失败");
    } finally {
      setBusy(false);
    }
  };

  // 本地文件导入:.cyrene(OmniParse 加密配置) / .js(洛雪音源脚本)。
  const onFile = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      if (file.name.endsWith(".cyrene")) {
        const config = await decryptCyreneConfig(new Uint8Array(await file.arrayBuffer()));
        if (!config) {
          setError("配置文件解析失败,请确认文件完整且为 .cyrene 格式");
          return;
        }
        setAddType("omni");
        setName(config.name);
        setUrl(config.url);
        setApiKey(config.apiKey);
        setPreview({ name: config.name, detail: "已从 .cyrene 导入(URL 已隐藏)" });
        setPending(null);
      } else {
        // .js 洛雪音源脚本
        const parsed = parseLxScript(await file.text());
        if (!parsed) {
          setError("脚本解析失败,请确认是有效的洛雪音源脚本");
          return;
        }
        setAddType("lx");
        const descriptor = createLxSourceDescriptor(parsed);
        setPending(descriptor);
        setPreview({
          name: parsed.name,
          detail: [
            parsed.version && `v${parsed.version}`,
            parsed.author,
            parsed.mode === "runtime" ? "执行模式(脚本算签名取链)" : parsed.apiUrl,
          ]
            .filter(Boolean)
            .join(" · "),
        });
      }
    } catch {
      setError("文件读取失败");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const savePending = () => {
    if (pending) {
      install(pending);
    } else if (addType === "omni") {
      addOmni();
    }
  };

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
        <input
          type="file"
          ref={fileRef}
          accept=".cyrene,.js,.mjs,.txt"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onFile(file);
          }}
        />
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <section>
            <h3 className="text-sm font-display font-bold mb-2">添加音源</h3>
            {/* 类型选择卡(对齐 CyreneMusic 类型选择) */}
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {ADD_TYPES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => switchType(item.id)}
                  className="rounded-lg p-2.5 text-center tap transition-colors"
                  style={{
                    background: addType === item.id ? "var(--ember-soft)" : "var(--ink-2)",
                    border: `1px solid ${addType === item.id ? "var(--ember)" : "var(--cream-line)"}`,
                    color: addType === item.id ? "var(--ember)" : "var(--cream-dim)",
                  }}
                >
                  <span className="block text-xs font-display font-bold">{item.label}</span>
                  <span className="mt-0.5 block text-[10px] text-cream-faint line-clamp-1">{item.hint}</span>
                </button>
              ))}
            </div>

            <div className="mt-3 space-y-3 rounded-lg p-3" style={{ background: "rgba(242,232,213,0.04)", border: "1px solid var(--cream-line)" }}>
              {addType === "netease" && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {(["builtin", "external"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setNeteaseMode(mode)}
                        className="h-9 rounded-lg text-xs tap"
                        style={{
                          background: neteaseMode === mode ? "var(--ember-soft)" : "var(--ink-2)",
                          border: `1px solid ${neteaseMode === mode ? "var(--ember)" : "var(--cream-line)"}`,
                          color: neteaseMode === mode ? "var(--ember)" : "var(--cream-dim)",
                        }}
                      >
                        {mode === "builtin" ? "内置直连(免部署)" : "自部署 API"}
                      </button>
                    ))}
                  </div>
                  {neteaseMode === "builtin" ? (
                    <p className="text-xs text-cream-faint">
                      内置直连 music.163.com,开箱即用(搜索/歌词/发现;免费曲 320k、版权曲 128k,VIP 曲自动回落其它源)。
                    </p>
                  ) : (
                    <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="自部署 NeteaseCloudMusicApi 地址(如 http://127.0.0.1:3000)" className={inputCls} style={inputStyle} />
                  )}
                  <button type="button" onClick={addNetease} className={primaryBtn} style={{ background: "var(--ember)", color: "var(--ink)" }}>
                    添加网易云源
                  </button>
                </>
              )}

              {addType === "lx" && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => fileRef.current?.click()} className={primaryBtn} style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)", color: "var(--cream-dim)" }}>
                      导入 .js 脚本文件
                    </button>
                    <span className="text-xs text-cream-faint">洛雪自定义源:解析头部信息 + 直链模板,免执行沙箱。</span>
                  </div>
                  <div className="grid md:grid-cols-[1fr_auto] gap-2">
                    <input value={lxText} onChange={(e) => setLxText(e.target.value)} placeholder="或粘贴脚本直链 URL / 脚本源码" className={inputCls} style={inputStyle} />
                    <button type="button" onClick={() => void importLxOnline()} disabled={busy} className={primaryBtn} style={{ background: "var(--vhs)", color: "var(--ink)" }}>
                      {busy ? "解析中…" : "在线导入"}
                    </button>
                  </div>
                  {pending && (
                    <button type="button" onClick={savePending} className={primaryBtn} style={{ background: "var(--ember)", color: "var(--ink)" }}>
                      保存音源
                    </button>
                  )}
                </>
              )}

              {addType === "omni" && (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => fileRef.current?.click()} className={primaryBtn} style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)", color: "var(--cream-dim)" }}>
                      导入 .cyrene 文件
                    </button>
                    <span className="text-xs text-cream-faint">导入加密配置自动填写,或在下方手填。</span>
                  </div>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="音源名称(可选)" className={inputCls} style={inputStyle} />
                  <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="OmniParse 后端地址" className={inputCls} style={inputStyle} />
                  <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="API Key(可选)" type="password" className={inputCls} style={inputStyle} />
                  <button type="button" onClick={addOmni} className={primaryBtn} style={{ background: "var(--ember)", color: "var(--ink)" }}>
                    添加 OmniParse 源
                  </button>
                </>
              )}

              {addType === "tunehub" && (
                <>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="音源名称(可选)" className={inputCls} style={inputStyle} />
                  <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="TuneHub 后端地址" className={inputCls} style={inputStyle} />
                  <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="API Key(可选)" type="password" className={inputCls} style={inputStyle} />
                  <button type="button" onClick={addTunehub} className={primaryBtn} style={{ background: "var(--ember)", color: "var(--ink)" }}>
                    添加 TuneHub 源
                  </button>
                </>
              )}

              {addType === "lx-server" && (
                <>
                  <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="LX Music API Server 地址(如 http://35.208.239.12:9527/)" className={inputCls} style={inputStyle} />
                  <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Token(可选)" className={inputCls} style={inputStyle} />
                  <button type="button" onClick={addLxServer} className={primaryBtn} style={{ background: "var(--ember)", color: "var(--ink)" }}>
                    添加 LX Server
                  </button>
                </>
              )}

              {addType === "plugin" && (
                <>
                  <textarea
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder="粘贴 MusicFree 插件源码、JS URL,或 aggregate-http JSON 配置"
                    className="w-full h-28 rounded-lg p-3 bg-ink text-sm text-cream outline-none resize-none"
                    style={inputStyle}
                  />
                  <button type="button" onClick={() => void importPlugin()} disabled={busy} className={primaryBtn} style={{ background: "var(--ember)", color: "var(--ink)" }}>
                    {busy ? "导入中…" : "导入"}
                  </button>
                </>
              )}
            </div>

            {error && <p className="mt-2 text-xs text-ember">{error}</p>}
            {preview && (
              <div className="mt-2 flex items-start gap-2 rounded-lg p-3" style={{ background: "var(--ember-soft)", border: "1px solid rgba(255,107,53,0.3)" }}>
                <IconCheck size={16} className="mt-0.5 shrink-0 text-ember" />
                <div className="min-w-0">
                  <p className="text-sm font-display font-semibold text-cream">解析成功:{preview.name}</p>
                  <p className="text-xs text-cream-faint line-clamp-2">{preview.detail}</p>
                </div>
              </div>
            )}
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
                    onRename={(value) => onRename(source, value)}
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

// shared input className
const inputCls = "h-10 w-full rounded-lg px-3 bg-ink text-sm outline-none text-cream";
const inputStyle = { border: "1px solid var(--cream-line)" } as const;
const primaryBtn = "h-10 px-4 rounded-lg text-xs font-display font-bold tap shrink-0";

