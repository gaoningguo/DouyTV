import { useEffect, useMemo, useState } from "react";
import { appAlert, appConfirm } from "@/components/AppDialog";
import { IconCheck, IconPlus, IconRefresh, IconTrash } from "@/components/Icon";
import { normalizeImportedLegadoSources } from "@/lib/book/legado.client";
import { errText } from "@/lib/book/subscription-store";
import { readingFetchText } from "@/lib/reading/net";
import type { BookSource } from "@/lib/book/types";
import { useBookStore } from "@/stores/book";
import { SettingsSubPageLayout } from "./Layout";

type Tab = "sources" | "subscriptions";

export default function SettingsBookSourcesHub() {
  const [tab, setTab] = useState<Tab>("sources");
  const hydrate = useBookStore((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const tabBar = (
    <div
      className="flex gap-1 p-1 mx-4 mt-3 mb-1 rounded-lg"
      style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
    >
      <TabButton active={tab === "sources"} onClick={() => setTab("sources")}>
        书源
      </TabButton>
      <TabButton
        active={tab === "subscriptions"}
        onClick={() => setTab("subscriptions")}
      >
        Legado 订阅
      </TabButton>
    </div>
  );

  return (
    <SettingsSubPageLayout eyebrow="SETTINGS · BOOK" title="小说管理" toolbar={tabBar}>
      {tab === "sources" ? <SourcesTab /> : <SubscriptionsTab />}
    </SettingsSubPageLayout>
  );
}

function SourcesTab() {
  const sources = useBookStore((s) => s.sources);
  const addSource = useBookStore((s) => s.addSource);
  const removeSource = useBookStore((s) => s.removeSource);
  const toggleSource = useBookStore((s) => s.toggleSource);

  const [opdsUrl, setOpdsUrl] = useState("");
  const [opdsName, setOpdsName] = useState("");
  const [legadoJson, setLegadoJson] = useState("");
  const [busy, setBusy] = useState(false);

  const addOpds = () => {
    const url = opdsUrl.trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      void appAlert("请填写合法的 OPDS 地址(http/https)", { tone: "danger" });
      return;
    }
    const id = `opds_${Date.now().toString(36)}`;
    addSource({
      id,
      name: opdsName.trim() || url,
      type: "opds",
      url,
      enabled: true,
      authMode: "none",
    });
    setOpdsUrl("");
    setOpdsName("");
  };

  // 把输入解析成 Legado 书源 JSON 文本。支持三种形态:
  //   1) 直接粘贴的 JSON(单条 / 数组)
  //   2) http(s):// 指向书源 JSON 的地址
  //   3) 深链 booktv:// / legado:// / yuedu://(阅读系分享链),
  //      形如 scheme://import/bookSource?src=<url或JSON>,或 scheme 后直接跟 url。
  const resolveLegadoText = async (input: string): Promise<string> => {
    const raw = input.trim();
    const scheme = raw.match(/^(booktv|legado|yuedu):\/\//i);
    if (scheme) {
      let payload = raw.slice(scheme[0].length);
      // 取 ?src= / ?url= 参数,否则用 scheme 后剩余部分(可能是 import/bookSource?src=... 或直接 url)。
      const qIndex = payload.indexOf("?");
      if (qIndex >= 0) {
        const params = new URLSearchParams(payload.slice(qIndex + 1));
        const src = params.get("src") || params.get("url");
        if (src) payload = src;
        else payload = payload.slice(0, qIndex);
      }
      payload = decodeURIComponent(payload.trim());
      // 深链的 src 通常是个 URL;若本身就是 JSON 则直接用。
      if (/^https?:\/\//i.test(payload)) {
        const res = await readingFetchText(payload, { timeout: 15000 });
        if (!res.ok) throw new Error(`书源地址请求失败: ${res.status}`);
        return res.text;
      }
      return payload;
    }
    if (/^https?:\/\//i.test(raw)) {
      const res = await readingFetchText(raw, { timeout: 15000 });
      if (!res.ok) throw new Error(`书源地址请求失败: ${res.status}`);
      return res.text;
    }
    return raw;
  };

  const importLegado = async () => {
    const raw = legadoJson.trim();
    if (!raw) return;
    setBusy(true);
    try {
      const text = await resolveLegadoText(raw);
      const parsed = JSON.parse(text);
      const imported = normalizeImportedLegadoSources(parsed);
      if (imported.length === 0) {
        await appAlert("没有识别到有效的 Legado 书源", { tone: "danger" });
        return;
      }
      imported.forEach((src) => addSource(src));
      setLegadoJson("");
      await appAlert(`已导入 ${imported.length} 个 Legado 书源。`);
    } catch (e) {
      await appAlert(`导入失败: ${errText(e)}`, { tone: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <section className="space-y-3">
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
          添加 OPDS 书源
        </p>
        <input
          value={opdsName}
          onChange={(e) => setOpdsName(e.target.value)}
          placeholder="名称(可选)"
          className="w-full rounded-lg px-3 py-2.5 text-sm bg-ink-2 text-cream outline-none"
          style={{ border: "1px solid var(--cream-line)" }}
        />
        <div className="flex gap-2">
          <input
            value={opdsUrl}
            onChange={(e) => setOpdsUrl(e.target.value)}
            placeholder="https://example.com/opds"
            className="flex-1 rounded-lg px-3 py-2.5 text-sm bg-ink-2 text-cream outline-none"
            style={{ border: "1px solid var(--cream-line)" }}
          />
          <button
            type="button"
            onClick={addOpds}
            className="rounded-lg px-4 text-sm tap glow-ember"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            <IconPlus size={16} />
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
          导入 Legado 书源 (JSON / URL / booktv://)
        </p>
        <textarea
          value={legadoJson}
          onChange={(e) => setLegadoJson(e.target.value)}
          placeholder='粘贴 Legado 书源 JSON、书源地址(http/https)或分享链接(booktv:// / legado://)'
          rows={4}
          className="w-full rounded-lg px-3 py-2.5 text-sm bg-ink-2 text-cream outline-none font-mono"
          style={{ border: "1px solid var(--cream-line)" }}
        />
        <button
          type="button"
          onClick={importLegado}
          disabled={busy || !legadoJson.trim()}
          className="w-full rounded-lg py-2.5 text-sm font-semibold tap"
          style={{
            background: "var(--ink-2)",
            color: "var(--cream)",
            border: "1px solid var(--cream-line)",
            opacity: busy || !legadoJson.trim() ? 0.5 : 1,
          }}
        >
          <IconCheck size={16} className="inline mr-1.5 -mt-0.5" />
          导入书源
        </button>
      </section>

      <section>
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
          已添加书源 ({sources.length})
        </p>
        {sources.length === 0 ? (
          <p className="text-xs text-cream-faint py-4 text-center">
            还没有手动书源。也可以在「Legado 订阅」页批量导入。
          </p>
        ) : (
          <div className="space-y-2">
            {sources.map((src) => (
              <SourceRow
                key={src.id}
                source={src}
                onToggle={() => toggleSource(src.id)}
                onDelete={async () => {
                  if (
                    await appConfirm(`删除书源「${src.name}」？`, {
                      tone: "danger",
                      confirmText: "删除",
                    })
                  ) {
                    removeSource(src.id);
                  }
                }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SourceRow({
  source,
  onToggle,
  onDelete,
}: {
  source: BookSource;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const enabled = source.enabled !== false;
  return (
    <div
      className="flex items-center gap-3 rounded-lg px-3 py-2.5"
      style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
    >
      <span
        className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0"
        style={{
          background: "var(--ember-soft)",
          color: "var(--ember)",
        }}
      >
        {source.type === "legado" ? "LEGADO" : "OPDS"}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-cream truncate">{source.name}</p>
        <p className="text-[11px] text-cream-faint font-mono truncate">
          {source.url}
        </p>
      </div>
      <button
        type="button"
        onClick={onToggle}
        className="text-[11px] px-2 py-1 rounded tap shrink-0"
        style={{
          background: enabled ? "var(--ember-soft)" : "transparent",
          color: enabled ? "var(--ember)" : "var(--cream-faint)",
          border: "1px solid var(--cream-line)",
        }}
      >
        {enabled ? "启用中" : "已停用"}
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="w-8 h-8 flex items-center justify-center rounded tap text-cream-faint shrink-0"
        aria-label="删除"
      >
        <IconTrash size={15} />
      </button>
    </div>
  );
}

function SubscriptionsTab() {
  const subscriptions = useBookStore((s) => s.subscriptions);
  const syncSubscription = useBookStore((s) => s.syncSubscription);
  const removeSubscription = useBookStore((s) => s.removeSubscription);
  const toggleSubscription = useBookStore((s) => s.toggleSubscription);

  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const add = async () => {
    const trimmed = url.trim();
    if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
      void appAlert("请填写合法的订阅地址(http/https)", { tone: "danger" });
      return;
    }
    setBusy("add");
    try {
      await syncSubscription({ name: name.trim() || undefined, url: trimmed });
      setUrl("");
      setName("");
    } catch (e) {
      await appAlert(`同步失败: ${errText(e)}`, { tone: "danger" });
    } finally {
      setBusy(null);
    }
  };

  const refresh = async (subUrl: string, subName: string, id: string) => {
    setBusy(id);
    try {
      await syncSubscription({ name: subName, url: subUrl });
    } catch (e) {
      await appAlert(`刷新失败: ${errText(e)}`, { tone: "danger" });
    } finally {
      setBusy(null);
    }
  };

  const total = useMemo(
    () => subscriptions.reduce((sum, s) => sum + (s.sourceCount || 0), 0),
    [subscriptions]
  );

  return (
    <div className="space-y-6 max-w-2xl">
      <section className="space-y-3">
        <p className="text-sm text-cream-dim leading-relaxed">
          Legado 订阅是一个返回书源 JSON 数组的 URL。同步后其中所有书源都会加入搜索。
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="订阅名称(可选)"
          className="w-full rounded-lg px-3 py-2.5 text-sm bg-ink-2 text-cream outline-none"
          style={{ border: "1px solid var(--cream-line)" }}
        />
        <div className="flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/sources.json"
            className="flex-1 rounded-lg px-3 py-2.5 text-sm bg-ink-2 text-cream outline-none"
            style={{ border: "1px solid var(--cream-line)" }}
          />
          <button
            type="button"
            onClick={add}
            disabled={busy === "add"}
            className="rounded-lg px-4 text-sm tap glow-ember"
            style={{
              background: "var(--ember)",
              color: "var(--ink)",
              opacity: busy === "add" ? 0.5 : 1,
            }}
          >
            {busy === "add" ? "…" : <IconPlus size={16} />}
          </button>
        </div>
      </section>

      <section>
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
          已订阅 ({subscriptions.length}) · 共 {total} 个书源
        </p>
        {subscriptions.length === 0 ? (
          <p className="text-xs text-cream-faint py-4 text-center">
            还没有订阅。
          </p>
        ) : (
          <div className="space-y-2">
            {subscriptions.map((sub) => {
              const enabled = sub.enabled !== false;
              return (
                <div
                  key={sub.id}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5"
                  style={{
                    background: "var(--ink-2)",
                    border: "1px solid var(--cream-line)",
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-cream truncate">{sub.name}</p>
                    <p className="text-[11px] text-cream-faint font-mono truncate">
                      {sub.sourceCount || 0} 源 · {sub.url}
                    </p>
                    {sub.lastError ? (
                      <p className="text-[11px] text-red-400 truncate">
                        {sub.lastError}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => refresh(sub.url, sub.name, sub.id)}
                    disabled={busy === sub.id}
                    className="w-8 h-8 flex items-center justify-center rounded tap text-cream-faint shrink-0"
                    aria-label="刷新"
                  >
                    <IconRefresh
                      size={15}
                      className={busy === sub.id ? "animate-spin" : ""}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleSubscription(sub.id)}
                    className="text-[11px] px-2 py-1 rounded tap shrink-0"
                    style={{
                      background: enabled ? "var(--ember-soft)" : "transparent",
                      color: enabled ? "var(--ember)" : "var(--cream-faint)",
                      border: "1px solid var(--cream-line)",
                    }}
                  >
                    {enabled ? "启用中" : "已停用"}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (
                        await appConfirm(`删除订阅「${sub.name}」？`, {
                          tone: "danger",
                          confirmText: "删除",
                        })
                      ) {
                        removeSubscription(sub.id);
                      }
                    }}
                    className="w-8 h-8 flex items-center justify-center rounded tap text-cream-faint shrink-0"
                    aria-label="删除"
                  >
                    <IconTrash size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 rounded-md py-1.5 text-xs font-semibold tap transition-colors"
      style={{
        background: active ? "var(--ember-soft)" : "transparent",
        color: active ? "var(--ember)" : "var(--cream-dim)",
      }}
    >
      {children}
    </button>
  );
}
