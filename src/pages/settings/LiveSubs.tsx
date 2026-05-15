import { useEffect, useState } from "react";
import { useLiveSubStore } from "@/stores/liveSubscription";
import { SettingsSubPageLayout } from "./Layout";
import { IconAntenna, IconPlus, IconRefresh, IconTrash } from "@/components/Icon";

export default function SettingsLiveSubs() {
  const subscriptions = useLiveSubStore((s) => s.subscriptions);
  const hydrate = useLiveSubStore((s) => s.hydrate);
  const add = useLiveSubStore((s) => s.add);
  const remove = useLiveSubStore((s) => s.remove);
  const refresh = useLiveSubStore((s) => s.refresh);
  const refreshAll = useLiveSubStore((s) => s.refreshAll);
  const setAuto = useLiveSubStore((s) => s.setAutoRefresh);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [refreshing, setRefreshing] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const onAdd = async () => {
    if (!name.trim() || !url.trim()) return;
    setSubmitting(true);
    try {
      await add(name.trim(), url.trim(), true);
      setName("");
      setUrl("");
    } catch (e) {
      alert(`订阅失败：${(e as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const onRefresh = async (id: string) => {
    setRefreshing(id);
    try {
      await refresh(id);
    } catch (e) {
      alert(`刷新失败：${(e as Error).message}`);
    } finally {
      setRefreshing(undefined);
    }
  };

  const trailing =
    subscriptions.length > 0 ? (
      <button
        type="button"
        onClick={() => void refreshAll()}
        className="px-3 py-1.5 text-xs rounded-full font-mono tap text-cream"
        style={{
          background: "var(--ink-2)",
          border: "1px solid var(--cream-line)",
        }}
      >
        全部刷新
      </button>
    ) : undefined;

  return (
    <SettingsSubPageLayout
      eyebrow="LIVE · SUBSCRIPTIONS"
      title="M3U 订阅源"
      trailing={trailing}
    >
      <p className="text-[11px] text-cream-faint mb-4 leading-relaxed">
        填入 M3U URL，会自动拉取频道并按订阅名分组
      </p>

      <section className="space-y-2 mb-6">
        {subscriptions.length === 0 ? (
          <div
            className="rounded-xl p-6 text-center"
            style={{
              background: "var(--ink-2)",
              border: "1px dashed var(--cream-line)",
            }}
          >
            <IconAntenna size={36} className="mx-auto text-cream-faint opacity-50 mb-2" />
            <p className="text-sm text-cream-dim">还没有订阅</p>
          </div>
        ) : (
          subscriptions.map((sub) => (
            <div
              key={sub.id}
              className="p-3 rounded-xl"
              style={{
                background: "var(--ink-2)",
                border: "1px solid var(--cream-line)",
              }}
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-display font-semibold line-clamp-1">
                    {sub.name}
                  </p>
                  <p className="font-mono text-[10px] text-cream-faint line-clamp-1 mt-0.5">
                    {sub.url}
                  </p>
                  <div className="flex flex-wrap gap-3 mt-1.5 text-[10px] font-mono text-cream-faint">
                    {sub.lastFetchedAt && (
                      <span>{new Date(sub.lastFetchedAt).toLocaleString()}</span>
                    )}
                    {sub.channelCount !== undefined && (
                      <span className="text-cream-dim">{sub.channelCount} 频道</span>
                    )}
                  </div>
                  {sub.error && (
                    <p className="text-[10px] text-ember mt-1.5 line-clamp-2">{sub.error}</p>
                  )}
                </div>
                <div className="flex flex-col gap-2 items-end shrink-0">
                  <label className="flex items-center gap-1.5 text-[10px] text-cream-dim">
                    <input
                      type="checkbox"
                      checked={sub.autoRefresh}
                      onChange={(e) => setAuto(sub.id, e.target.checked)}
                      className="accent-ember"
                    />
                    自动 24h
                  </label>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => void onRefresh(sub.id)}
                      disabled={refreshing === sub.id}
                      className="w-8 h-8 rounded-full flex items-center justify-center tap text-cream disabled:opacity-50"
                      style={{
                        background: "var(--ink-3)",
                        border: "1px solid var(--cream-line)",
                      }}
                      title="刷新"
                    >
                      <IconRefresh size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          confirm(
                            `删除订阅「${sub.name}」？\n该订阅下的频道也会一并清除。`
                          )
                        )
                          remove(sub.id);
                      }}
                      className="w-8 h-8 rounded-full flex items-center justify-center tap"
                      style={{
                        background: "rgba(255,80,80,0.08)",
                        color: "#FF6B6B",
                        border: "1px solid rgba(255,80,80,0.25)",
                      }}
                      title="删除"
                    >
                      <IconTrash size={13} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </section>

      <section
        className="rounded-xl p-4"
        style={{
          background: "var(--ink-2)",
          border: "1px solid var(--cream-line)",
        }}
      >
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-3">
          NEW · SUBSCRIPTION
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="订阅名（用作频道分类，如「央视 IPTV」）"
          className="w-full px-3 py-2 rounded-lg text-sm mb-2 outline-none text-cream placeholder:text-cream-faint"
          style={{
            background: "var(--ink-3)",
            border: "1px solid var(--cream-line)",
          }}
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="M3U URL"
          className="w-full px-3 py-2 rounded-lg text-sm mb-3 outline-none text-cream placeholder:text-cream-faint font-mono text-xs"
          style={{
            background: "var(--ink-3)",
            border: "1px solid var(--cream-line)",
          }}
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={!name.trim() || !url.trim() || submitting}
          className="w-full py-2.5 rounded-lg text-xs font-display font-semibold tap disabled:opacity-50 flex items-center justify-center gap-1.5"
          style={{ background: "var(--ember)", color: "var(--ink)" }}
        >
          <IconPlus size={14} />
          {submitting ? "添加中…" : "添加并刷新"}
        </button>
      </section>
    </SettingsSubPageLayout>
  );
}
