/**
 * JSON 漫画源管理 —— 三种导入路径。
 *
 * 导出 default (独立路由) + MangaSrcPanel (嵌入统一漫画设置 tab)。
 */
import { useEffect, useRef, useState } from "react";
import { useMangaSourceStore } from "@/stores/mangasource";
import type { MangaSourceV2 } from "@/lib/mangasources/types";
import { IconPlus, IconTrash, IconDownload } from "@/components/Icon";
import { SettingsSubPageLayout } from "./Layout";

type Mode = "list" | "url" | "paste" | "manual";

export default function SettingsMangaSrc() {
  return (
    <SettingsSubPageLayout eyebrow="MANGA · JSON SOURCES" title="JSON 漫画源">
      <MangaSrcPanel />
    </SettingsSubPageLayout>
  );
}

export function MangaSrcPanel() {
  const sources = useMangaSourceStore((s) => s.sources);
  const hydrate = useMangaSourceStore((s) => s.hydrate);
  const importByUrl = useMangaSourceStore((s) => s.importByUrl);
  const importByText = useMangaSourceStore((s) => s.importByText);
  const addManual = useMangaSourceStore((s) => s.addManual);
  const removeSource = useMangaSourceStore((s) => s.removeSource);
  const toggleEnabled = useMangaSourceStore((s) => s.toggleEnabled);
  const clearAll = useMangaSourceStore((s) => s.clearAll);

  const [mode, setMode] = useState<Mode>("list");

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const enabledCount = sources.filter((s) => s.enabled).length;

  return (
    <div>
      <p className="text-[11px] text-cream-faint mb-4 leading-relaxed">
        DouyTV 自定义 JSON 漫画源 —— 复用 legado 风格的 CSS/JsonPath/regex 规则引擎。
        与 Suwayomi 服务端方案并行（设置页另有专门项）。
      </p>

      <div className="grid grid-cols-3 gap-2 mb-4">
        <button
          type="button"
          onClick={() => setMode("url")}
          className="py-2.5 rounded-lg tap text-[11px] font-display font-semibold text-cream"
          style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
        >
          <IconDownload size={12} className="inline mr-1" />
          一键导入
        </button>
        <button
          type="button"
          onClick={() => setMode("paste")}
          className="py-2.5 rounded-lg tap text-[11px] font-display font-semibold text-cream"
          style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
        >
          手动 / 本地
        </button>
        <button
          type="button"
          onClick={() => setMode("manual")}
          className="py-2.5 rounded-lg tap text-[11px] font-display font-semibold text-cream"
          style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
        >
          <IconPlus size={12} className="inline mr-1" />
          自定义
        </button>
      </div>

      <section
        className="rounded-xl p-4 mb-4"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
      >
        <div className="flex items-center mb-3">
          <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
            INSTALLED · {sources.length} 总数 · {enabledCount} 启用
          </p>
          {sources.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (confirm(`确认清空全部 ${sources.length} 个源？`)) clearAll();
              }}
              className="ml-auto text-[10px] font-mono text-cream-faint hover:text-[#FF6B6B] tap"
            >
              清空
            </button>
          )}
        </div>
        {sources.length === 0 ? (
          <p className="text-center text-[11px] text-cream-faint py-4">
            尚未添加漫画源
          </p>
        ) : (
          <ul className="space-y-1.5 max-h-64 overflow-y-auto">
            {sources.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 px-2 py-2 rounded"
                style={{
                  background: "var(--ink-3)",
                  border: "1px solid var(--cream-line)",
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleEnabled(s.id)}
                  className="w-7 h-4 rounded-full shrink-0 relative"
                  style={{
                    background: s.enabled ? "var(--ember)" : "var(--ink-edge)",
                  }}
                >
                  <span
                    className="absolute top-0.5 w-3 h-3 rounded-full transition-all"
                    style={{
                      left: s.enabled ? "calc(100% - 14px)" : "2px",
                      background: s.enabled ? "var(--ink)" : "var(--cream)",
                    }}
                  />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-display font-semibold text-cream truncate">
                    {s.name}
                  </p>
                  <p className="text-[10px] font-mono text-cream-faint truncate">
                    {s.group ? `${s.group} · ` : ""}
                    {s.baseUrl}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => removeSource(s.id)}
                  className="w-6 h-6 flex items-center justify-center tap text-cream-faint hover:text-[#FF6B6B]"
                >
                  <IconTrash size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {mode === "url" && <ImportByUrlPanel onClose={() => setMode("list")} importByUrl={importByUrl} />}
      {mode === "paste" && <PasteJsonPanel onClose={() => setMode("list")} importByText={importByText} />}
      {mode === "manual" && <ManualPanel onClose={() => setMode("list")} addManual={addManual} />}

      <TachiyomiCatalogSection />

      <div
        className="rounded-xl p-3.5 text-[11px] text-cream-dim leading-relaxed"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
      >
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
          JSON 字段
        </p>
        <p>· name / baseUrl / searchUrl (必填)</p>
        <p>· ruleList / ruleDetail / ruleChapters / rulePages 规则块</p>
        <p className="mt-2 text-cream-faint">
          规则形态与 legado 兼容：css:.x@text / class:foo / $.json.path / R1 || R2 / ##regex##
        </p>
      </div>
    </div>
  );
}

function ImportByUrlPanel({
  onClose,
  importByUrl,
}: {
  onClose: () => void;
  importByUrl: (url: string) => Promise<{ ok: boolean; added: number; tachiyomi?: number; message?: string }>;
}) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const run = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const r = await importByUrl(url.trim());
      const tachi = r.tachiyomi ?? 0;
      const msg = r.ok
        ? r.message ??
          (tachi > 0
            ? `导入 ${r.added} 个源 · Tachiyomi 扩展 ${tachi} 条（需 Suwayomi）`
            : `成功导入 ${r.added} 个源`)
        : r.message ?? "导入失败";
      setResult({ ok: r.ok, msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      className="rounded-xl p-4 mb-4"
      style={{ background: "var(--ink-2)", border: "1px solid rgba(255,107,53,0.3)" }}
    >
      <div className="flex items-center mb-3">
        <p className="font-mono text-[10px] tracking-[0.2em] text-ember">一键导入</p>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-[10px] font-mono text-cream-faint hover:text-cream tap"
        >
          关闭
        </button>
      </div>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://.../manga-source.json"
        className="w-full px-3 py-2 rounded-lg text-xs font-mono outline-none text-cream placeholder:text-cream-faint mb-3"
        style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
      />
      <button
        type="button"
        onClick={() => void run()}
        disabled={loading || !url.trim()}
        className="w-full py-2 rounded-lg text-xs font-display font-semibold tap disabled:opacity-50"
        style={{ background: "var(--ember)", color: "var(--ink)" }}
      >
        {loading ? "导入中…" : "拉取并导入"}
      </button>
      {result && (
        <p
          className="mt-3 p-2 rounded text-[11px] font-mono"
          style={
            result.ok
              ? {
                  background: "var(--phosphor-soft)",
                  color: "var(--phosphor)",
                  border: "1px solid rgba(124,255,178,0.25)",
                }
              : {
                  background: "rgba(255,80,80,0.08)",
                  color: "#FF6B6B",
                  border: "1px solid rgba(255,80,80,0.25)",
                }
          }
        >
          {result.ok ? "✓" : "✗"} {result.msg}
        </p>
      )}
    </section>
  );
}

function PasteJsonPanel({
  onClose,
  importByText,
}: {
  onClose: () => void;
  importByText: (text: string) => Promise<{ ok: boolean; added: number; tachiyomi?: number; message?: string }>;
}) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const r = await importByText(text);
      const tachi = r.tachiyomi ?? 0;
      const msg = r.ok
        ? r.message ??
          (tachi > 0
            ? `导入 ${r.added} 个源 · Tachiyomi 扩展 ${tachi} 条（需 Suwayomi）`
            : `成功导入 ${r.added} 个源`)
        : r.message ?? "导入失败";
      setResult({ ok: r.ok, msg });
      if (r.ok) setText("");
    } finally {
      setLoading(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const t = await file.text();
    setText(t);
    e.target.value = "";
  };

  return (
    <section
      className="rounded-xl p-4 mb-4"
      style={{ background: "var(--ink-2)", border: "1px solid rgba(255,107,53,0.3)" }}
    >
      <div className="flex items-center mb-3">
        <p className="font-mono text-[10px] tracking-[0.2em] text-ember">手动 / 本地</p>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-[10px] font-mono text-cream-faint hover:text-cream tap"
        >
          关闭
        </button>
      </div>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="w-full py-2 rounded-lg text-[11px] tap text-cream mb-2"
        style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
      >
        选择 .json 文件
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        onChange={onFile}
        className="hidden"
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='粘贴 JSON … [{"name":"...","baseUrl":"...","searchUrl":"...","ruleList":{...}}]'
        rows={10}
        className="w-full px-3 py-2 rounded-lg text-[10px] font-mono outline-none text-cream placeholder:text-cream-faint mb-3"
        style={{
          background: "var(--ink-3)",
          border: "1px solid var(--cream-line)",
          resize: "vertical",
        }}
      />
      <button
        type="button"
        onClick={() => void run()}
        disabled={loading || !text.trim()}
        className="w-full py-2 rounded-lg text-xs font-display font-semibold tap disabled:opacity-50"
        style={{ background: "var(--ember)", color: "var(--ink)" }}
      >
        {loading ? "导入中…" : "导入"}
      </button>
      {result && (
        <p
          className="mt-3 p-2 rounded text-[11px] font-mono"
          style={
            result.ok
              ? {
                  background: "var(--phosphor-soft)",
                  color: "var(--phosphor)",
                  border: "1px solid rgba(124,255,178,0.25)",
                }
              : {
                  background: "rgba(255,80,80,0.08)",
                  color: "#FF6B6B",
                  border: "1px solid rgba(255,80,80,0.25)",
                }
          }
        >
          {result.ok ? "✓" : "✗"} {result.msg}
        </p>
      )}
    </section>
  );
}

function ManualPanel({
  onClose,
  addManual,
}: {
  onClose: () => void;
  addManual: (source: Omit<MangaSourceV2, "id" | "addedAt">) => MangaSourceV2;
}) {
  const [f, setF] = useState({
    name: "",
    baseUrl: "",
    group: "",
    searchUrl: "",
    listItems: "",
    listName: "",
    listUrl: "",
    listCover: "",
    detailName: "",
    detailIntro: "",
    detailCover: "",
    chaptersItems: "",
    chaptersTitle: "",
    chaptersUrl: "",
    pagesItems: "",
    pagesImg: "",
    header: "",
  });
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  const save = () => {
    if (!f.name || !f.baseUrl) {
      setError("name 和 baseUrl 必填");
      return;
    }
    addManual({
      enabled: true,
      name: f.name,
      baseUrl: f.baseUrl,
      group: f.group || undefined,
      searchUrl: f.searchUrl || undefined,
      header: f.header || undefined,
      ruleList: {
        items: f.listItems || undefined,
        name: f.listName || undefined,
        url: f.listUrl || undefined,
        cover: f.listCover || undefined,
      },
      ruleDetail: {
        name: f.detailName || undefined,
        intro: f.detailIntro || undefined,
        cover: f.detailCover || undefined,
      },
      ruleChapters: {
        items: f.chaptersItems || undefined,
        title: f.chaptersTitle || undefined,
        url: f.chaptersUrl || undefined,
      },
      rulePages: {
        items: f.pagesItems || undefined,
        imageUrl: f.pagesImg || undefined,
      },
    });
    onClose();
  };

  const Field = ({ label, k, ph }: { label: string; k: keyof typeof f; ph?: string }) => (
    <div className="mb-2">
      <label className="block font-mono text-[10px] tracking-[0.18em] text-cream-faint mb-0.5">
        {label}
      </label>
      <input
        value={f[k]}
        onChange={(e) => set(k, e.target.value)}
        placeholder={ph}
        className="w-full px-2.5 py-1.5 rounded text-[11px] font-mono outline-none text-cream placeholder:text-cream-faint"
        style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
      />
    </div>
  );

  return (
    <section
      className="rounded-xl p-4 mb-4"
      style={{ background: "var(--ink-2)", border: "1px solid rgba(255,107,53,0.3)" }}
    >
      <div className="flex items-center mb-3">
        <p className="font-mono text-[10px] tracking-[0.2em] text-ember">自定义</p>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-[10px] font-mono text-cream-faint hover:text-cream tap"
        >
          关闭
        </button>
      </div>
      <Field label="源名称 *" k="name" />
      <Field label="baseUrl *" k="baseUrl" />
      <Field label="分组" k="group" />
      <Field label="searchUrl ({{key}} {{page}})" k="searchUrl" />
      <p className="font-mono text-[10px] tracking-[0.18em] text-cream-faint mt-3 mb-1">列表规则</p>
      <Field label="items" k="listItems" ph="css:.manga-item" />
      <Field label="name" k="listName" ph="css:.title@text" />
      <Field label="url" k="listUrl" ph="css:a@href" />
      <Field label="cover" k="listCover" ph="css:img@src" />
      <p className="font-mono text-[10px] tracking-[0.18em] text-cream-faint mt-3 mb-1">详情规则</p>
      <Field label="name" k="detailName" />
      <Field label="intro" k="detailIntro" />
      <Field label="cover" k="detailCover" />
      <p className="font-mono text-[10px] tracking-[0.18em] text-cream-faint mt-3 mb-1">章节规则</p>
      <Field label="items" k="chaptersItems" />
      <Field label="title" k="chaptersTitle" />
      <Field label="url" k="chaptersUrl" />
      <p className="font-mono text-[10px] tracking-[0.18em] text-cream-faint mt-3 mb-1">分镜图规则</p>
      <Field label="items" k="pagesItems" ph="css:.page-img" />
      <Field label="imageUrl" k="pagesImg" ph="img@src" />
      <Field label="header (JSON)" k="header" />

      {error && (
        <p
          className="mt-3 p-2 rounded text-[11px] font-mono"
          style={{
            background: "rgba(255,80,80,0.08)",
            color: "#FF6B6B",
            border: "1px solid rgba(255,80,80,0.25)",
          }}
        >
          ✗ {error}
        </p>
      )}

      <button
        type="button"
        onClick={save}
        className="w-full mt-3 py-2 rounded-lg text-xs font-display font-semibold tap"
        style={{ background: "var(--ember)", color: "var(--ink)" }}
      >
        添加
      </button>
    </section>
  );
}

/**
 * Tachiyomi / Mihon 扩展索引目录 ——
 * DouyTV 不能直接消费这些扩展（逻辑在 .apk 内），但导入仓库索引时把扩展元信息
 * 存下来展示给用户，告诉他们需要 Suwayomi 才能实际抓取。
 */
function TachiyomiCatalogSection() {
  const catalog = useMangaSourceStore((s) => s.tachiyomiCatalog);
  const clear = useMangaSourceStore((s) => s.clearTachiyomiCatalog);
  const removeOne = useMangaSourceStore((s) => s.removeTachiyomiExtension);

  if (catalog.length === 0) return null;

  return (
    <section
      className="rounded-xl p-4 mb-4"
      style={{
        background: "var(--ink-2)",
        border: "1px solid rgba(124,255,178,0.25)",
      }}
    >
      <div className="flex items-center mb-3">
        <p className="font-mono text-[10px] tracking-[0.2em] text-phosphor">
          TACHIYOMI · 扩展索引（只读 · 需 Suwayomi）
        </p>
        <button
          type="button"
          onClick={() => {
            if (confirm(`清空 Tachiyomi 目录中的 ${catalog.length} 条扩展？`)) clear();
          }}
          className="ml-auto text-[10px] font-mono text-cream-faint hover:text-[#FF6B6B] tap"
        >
          清空
        </button>
      </div>

      <p className="text-[11px] text-cream-faint mb-3 leading-relaxed">
        这些是 Tachiyomi / Mihon 格式的扩展条目（如 CopyManga / vomic / 包子漫画）。
        DouyTV 客户端无法直接抓取（逻辑封装在 .apk 内），需要在 PC/NAS 部署
        Suwayomi-Server 后装上对应扩展，再通过设置页「Suwayomi」连接服务端使用。
      </p>

      <ul className="space-y-1.5 max-h-80 overflow-y-auto">
        {catalog.map((ext) => (
          <li
            key={ext.pkg}
            className="px-2 py-2 rounded"
            style={{
              background: "var(--ink-3)",
              border: "1px solid var(--cream-line)",
            }}
          >
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-display font-semibold text-cream truncate">
                  {ext.name}
                  {ext.version && (
                    <span className="ml-2 text-[10px] font-mono text-cream-faint">
                      v{ext.version}
                    </span>
                  )}
                  {ext.nsfw && (
                    <span className="ml-2 text-[10px] font-mono text-[#FF6B6B]">
                      NSFW
                    </span>
                  )}
                </p>
                <p className="text-[10px] font-mono text-cream-faint truncate">
                  {ext.pkg}
                </p>
              </div>
              <button
                type="button"
                onClick={() => removeOne(ext.pkg)}
                className="w-6 h-6 flex items-center justify-center tap text-cream-faint hover:text-[#FF6B6B]"
                aria-label="移除"
              >
                <IconTrash size={12} />
              </button>
            </div>
            {ext.sources.length > 0 && (
              <ul className="mt-1.5 ml-1 space-y-0.5">
                {ext.sources.map((s) => (
                  <li
                    key={`${ext.pkg}-${s.id}`}
                    className="text-[10px] font-mono text-cream-dim flex items-center gap-1.5"
                  >
                    <span className="inline-block w-1 h-1 rounded-full bg-phosphor shrink-0" />
                    <span className="truncate">
                      {s.name}
                      {s.baseUrl && (
                        <span className="ml-1.5 text-cream-faint">
                          {s.baseUrl}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
