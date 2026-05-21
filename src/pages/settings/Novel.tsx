/**
 * 网络小说书源管理 —— 三种导入路径。
 *
 * 导出两个组件：
 *   - default: 带 SettingsSubPageLayout 的完整页面（独立路由用）
 *   - NovelSourcesPanel: 仅内容，用于嵌入电子书统一设置页的 tab
 */
import { useEffect, useRef, useState } from "react";
import { useNovelSourceStore } from "@/stores/novelsource";
import type { BookSourceV2 } from "@/lib/booksources/types";
import { IconPlus, IconTrash, IconDownload, IconRefresh } from "@/components/Icon";
import { SettingsSubPageLayout } from "./Layout";

type Mode = "list" | "url" | "paste" | "manual";

export default function SettingsNovel() {
  return (
    <SettingsSubPageLayout eyebrow="NOVEL · SOURCES" title="网络小说源">
      <NovelSourcesPanel />
    </SettingsSubPageLayout>
  );
}

export function NovelSourcesPanel() {
  const sources = useNovelSourceStore((s) => s.sources);
  const health = useNovelSourceStore((s) => s.health);
  const hydrate = useNovelSourceStore((s) => s.hydrate);
  const importByUrl = useNovelSourceStore((s) => s.importByUrl);
  const importByText = useNovelSourceStore((s) => s.importByText);
  const addManual = useNovelSourceStore((s) => s.addManual);
  const removeSource = useNovelSourceStore((s) => s.removeSource);
  const toggleEnabled = useNovelSourceStore((s) => s.toggleEnabled);
  const validateAll = useNovelSourceStore((s) => s.validateAll);
  const saveReplaceRegex = useNovelSourceStore((s) => s.saveReplaceRegex);
  const clearAll = useNovelSourceStore((s) => s.clearAll);

  const [mode, setMode] = useState<Mode>("list");
  const [validating, setValidating] = useState(false);
  const [replaceEditorFor, setReplaceEditorFor] = useState<BookSourceV2 | null>(
    null
  );

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const enabledCount = sources.filter((s) => s.enabled).length;

  const runValidate = async () => {
    setValidating(true);
    try {
      await validateAll(4);
    } finally {
      setValidating(false);
    }
  };

  return (
    <div>
      <p className="text-[11px] text-cream-faint mb-4 leading-relaxed">
        Legado 书源协议兼容 —— 可直接粘贴 GitHub 上的现成书源 JSON。
        支持 CSS / XPath / JsonPath / Regex 规则；现已支持 <code>@js:</code> /{" "}
        <code>@put:</code> / <code>@get:</code> 等高级语法。
      </p>

      {/* 操作按钮 */}
      <div className="grid grid-cols-3 gap-2 mb-3">
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

      {/* 批量验证 */}
      {enabledCount > 0 && (
        <button
          type="button"
          onClick={() => void runValidate()}
          disabled={validating}
          className="w-full py-2 mb-3 rounded-lg tap text-[11px] font-display font-semibold disabled:opacity-50"
          style={{
            background: validating ? "var(--ink-3)" : "var(--phosphor-soft)",
            color: validating ? "var(--cream-faint)" : "var(--phosphor)",
            border: "1px solid rgba(124,255,178,0.3)",
          }}
        >
          <IconRefresh size={12} className="inline mr-1" />
          {validating ? `批量验证中…` : `批量验证 ${enabledCount} 个启用源`}
        </button>
      )}

      {/* 当前列表 */}
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
                if (confirm(`确认清空全部 ${sources.length} 个书源？`)) clearAll();
              }}
              className="ml-auto text-[10px] font-mono text-cream-faint hover:text-[#FF6B6B] tap"
            >
              清空
            </button>
          )}
        </div>
        {sources.length === 0 ? (
          <p className="text-center text-[11px] text-cream-faint py-4">
            尚未添加书源 · 点击上方按钮导入
          </p>
        ) : (
          <ul className="space-y-1.5 max-h-72 overflow-y-auto">
            {sources.map((s) => {
              const h = health[s.id];
              return (
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
                  <span
                    className="inline-block w-2 h-2 rounded-full shrink-0"
                    style={{
                      background: h
                        ? h.ok
                          ? "#3FBA6A"
                          : "#E14F4F"
                        : "var(--cream-faint)",
                    }}
                    title={
                      h
                        ? `${h.ok ? "✓" : "✗"} ${h.message} · ${new Date(
                            h.checkedAt
                          ).toLocaleString()}`
                        : "尚未验证"
                    }
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-display font-semibold text-cream truncate">
                      {s.bookSourceName}
                    </p>
                    <p className="text-[10px] font-mono text-cream-faint truncate">
                      {s.bookSourceGroup ? `${s.bookSourceGroup} · ` : ""}
                      {s.bookSourceUrl}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReplaceEditorFor(s)}
                    className="px-1.5 py-0.5 rounded text-[10px] font-mono tap text-cream-faint hover:text-cream"
                    style={{
                      background: "var(--ink-2)",
                      border: "1px solid var(--cream-line)",
                    }}
                    title="编辑内容净化规则"
                  >
                    净化
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSource(s.id)}
                    className="w-6 h-6 flex items-center justify-center tap text-cream-faint hover:text-[#FF6B6B]"
                  >
                    <IconTrash size={12} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {replaceEditorFor && (
        <ReplaceRulesEditor
          source={replaceEditorFor}
          onSave={(rule) => {
            saveReplaceRegex(replaceEditorFor.id, rule);
            setReplaceEditorFor(null);
          }}
          onClose={() => setReplaceEditorFor(null)}
        />
      )}

      {mode === "url" && <ImportByUrlPanel onClose={() => setMode("list")} importByUrl={importByUrl} />}
      {mode === "paste" && <PasteJsonPanel onClose={() => setMode("list")} importByText={importByText} />}
      {mode === "manual" && <ManualPanel onClose={() => setMode("list")} addManual={addManual} />}

      <div
        className="rounded-xl p-3.5 text-[11px] text-cream-dim leading-relaxed"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
      >
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
          常见订阅
        </p>
        <p>· github 搜 <code>legado 书源</code> / <code>阅读 书源</code></p>
        <p className="mt-1">· 推荐：阅读 3.0 官方分流仓库，社区维护的精品源仓库等</p>
        <p className="mt-2 text-cream-faint">
          导入第三方源 = 在沙盒里执行任意 JS —— 请仅使用可信来源。
        </p>
      </div>
    </div>
  );
}

/* ───────────────── 替换规则编辑器（弹层） ───────────────── */
function ReplaceRulesEditor({
  source,
  onSave,
  onClose,
}: {
  source: BookSourceV2;
  onSave: (rule: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(source.ruleContent?.replaceRegex ?? "");
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl p-4"
        style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="font-mono text-[10px] tracking-[0.2em] text-ember mb-1">
          REPLACE RULES
        </p>
        <p className="text-[11px] text-cream truncate mb-2">
          {source.bookSourceName}
        </p>
        <p className="text-[10px] text-cream-dim mb-2 leading-relaxed">
          格式 <code className="font-mono">##正则##替换##</code> 可重复多组。<br />
          例：<code className="font-mono">##广告.+##</code> 删除整段；<br />
          <code className="font-mono">##本章未完.*?##\n##</code> 替换为换行。
        </p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={6}
          spellCheck={false}
          className="w-full p-2 rounded text-[11px] font-mono text-cream outline-none"
          style={{
            background: "var(--ink-3)",
            border: "1px solid var(--cream-line)",
            resize: "vertical",
          }}
          placeholder="##广告.+##"
        />
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2 rounded-lg text-[11px] tap text-cream"
            style={{ background: "var(--ink-3)", border: "1px solid var(--cream-line)" }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onSave(draft)}
            className="flex-1 py-2 rounded-lg text-[11px] font-display font-semibold tap"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportByUrlPanel({
  onClose,
  importByUrl,
}: {
  onClose: () => void;
  importByUrl: (url: string) => Promise<{ ok: boolean; added: number; message?: string }>;
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
      setResult({
        ok: r.ok,
        msg: r.ok ? `成功导入 ${r.added} 个书源` : r.message ?? "导入失败",
      });
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
        placeholder="https://example.com/booksource.json"
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
  importByText: (text: string) => Promise<{ ok: boolean; added: number; message?: string }>;
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
      setResult({
        ok: r.ok,
        msg: r.ok ? `成功导入 ${r.added} 个书源` : r.message ?? "导入失败",
      });
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
      <div className="flex gap-2 mb-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex-1 py-2 rounded-lg text-[11px] tap text-cream"
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
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='粘贴 legado 书源 JSON …  形如 [{"bookSourceName": "...", "bookSourceUrl": "...", "ruleSearch": {...}, ...}]'
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
  addManual: (source: Omit<BookSourceV2, "id" | "addedAt">) => BookSourceV2;
}) {
  const [form, setForm] = useState({
    name: "",
    url: "",
    group: "",
    searchUrl: "",
    bookListRule: "",
    bookNameRule: "",
    bookUrlRule: "",
    coverRule: "",
    authorRule: "",
    introInfoRule: "",
    tocUrlRule: "",
    chapterListRule: "",
    chapterNameRule: "",
    chapterUrlRule: "",
    contentRule: "",
    header: "",
  });
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = () => {
    if (!form.name || !form.url) {
      setError("name 和 url 必填");
      return;
    }
    const source: Omit<BookSourceV2, "id" | "addedAt"> = {
      enabled: true,
      bookSourceName: form.name,
      bookSourceUrl: form.url,
      bookSourceGroup: form.group || undefined,
      searchUrl: form.searchUrl || undefined,
      header: form.header || undefined,
      ruleSearch: {
        bookList: form.bookListRule || undefined,
        name: form.bookNameRule || undefined,
        bookUrl: form.bookUrlRule || undefined,
        coverUrl: form.coverRule || undefined,
        author: form.authorRule || undefined,
      },
      ruleBookInfo: {
        name: form.bookNameRule || undefined,
        author: form.authorRule || undefined,
        intro: form.introInfoRule || undefined,
        coverUrl: form.coverRule || undefined,
        tocUrl: form.tocUrlRule || undefined,
      },
      ruleToc: {
        chapterList: form.chapterListRule || undefined,
        chapterName: form.chapterNameRule || undefined,
        chapterUrl: form.chapterUrlRule || undefined,
      },
      ruleContent: {
        content: form.contentRule || undefined,
      },
    };
    addManual(source);
    onClose();
  };

  const Field = ({ label, k, ph }: { label: string; k: keyof typeof form; ph?: string }) => (
    <div className="mb-2">
      <label className="block font-mono text-[10px] tracking-[0.18em] text-cream-faint mb-0.5">
        {label}
      </label>
      <input
        value={form[k]}
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
        <p className="font-mono text-[10px] tracking-[0.2em] text-ember">自定义书源</p>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-[10px] font-mono text-cream-faint hover:text-cream tap"
        >
          关闭
        </button>
      </div>
      <Field label="书源名称 *" k="name" ph="起点中文" />
      <Field label="书源 URL *" k="url" ph="https://www.qidian.com" />
      <Field label="分组" k="group" ph="玄幻 / 综合" />
      <Field
        label="搜索 URL（{{key}} {{page}}）"
        k="searchUrl"
        ph="https://x.com/search?q={{key}}&page={{page}}"
      />
      <p className="font-mono text-[10px] tracking-[0.18em] text-cream-faint mt-3 mb-1">
        搜索结果规则
      </p>
      <Field label="bookList" k="bookListRule" ph="css:.book-item" />
      <Field label="name" k="bookNameRule" ph="css:.title@text" />
      <Field label="bookUrl" k="bookUrlRule" ph="css:a@href" />
      <Field label="coverUrl" k="coverRule" ph="css:img@src" />
      <Field label="author" k="authorRule" ph="css:.author@text" />
      <p className="font-mono text-[10px] tracking-[0.18em] text-cream-faint mt-3 mb-1">
        详情 / 目录
      </p>
      <Field label="intro" k="introInfoRule" ph="css:.intro@text" />
      <Field label="tocUrl" k="tocUrlRule" ph="css:.toc@href" />
      <Field label="chapterList" k="chapterListRule" ph="css:.chapter-item" />
      <Field label="chapterName" k="chapterNameRule" ph="css:a@text" />
      <Field label="chapterUrl" k="chapterUrlRule" ph="css:a@href" />
      <p className="font-mono text-[10px] tracking-[0.18em] text-cream-faint mt-3 mb-1">
        正文
      </p>
      <Field label="content" k="contentRule" ph="css:.content@html" />
      <p className="font-mono text-[10px] tracking-[0.18em] text-cream-faint mt-3 mb-1">
        HTTP Header (JSON)
      </p>
      <Field label="header" k="header" ph={`{"User-Agent":"..."}`} />

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
