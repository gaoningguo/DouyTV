/**
 * 推荐歌单 — capabilities.recommendSheets=false 时给出空态。
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getActiveBackendInfo, getRecommendSheetTags } from "@/lib/music/api";
import type { IRecommendSheetTagsResult } from "@/lib/music/types";
import { IconArrowLeft, IconFire } from "@/components/Icon";
import { useMusicStore } from "@/stores/music";

export default function MusicRecommend() {
  const navigate = useNavigate();
  const hydrate = useMusicStore((s) => s.hydrate);
  const [data, setData] = useState<IRecommendSheetTagsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await getRecommendSheetTags();
        if (!cancelled) {
          setData(r);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message ?? String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const info = getActiveBackendInfo();
  const supported = info?.capabilities.recommendSheets ?? false;

  return (
    <div className="min-h-screen bg-ink text-cream p-4 pb-24">
      <div className="flex items-center gap-3 mb-5">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          aria-label="返回"
        >
          <IconArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
            MUSIC · RECOMMEND
          </p>
          <h1 className="font-display text-xl font-extrabold tracking-tight">推荐歌单</h1>
        </div>
      </div>

      {!supported && !loading && (
        <div
          className="rounded-xl p-6 text-center"
          style={{ background: "var(--ink-2)", border: "1px dashed var(--cream-line)" }}
        >
          <IconFire size={32} className="text-cream-faint mx-auto mb-2" />
          <p className="text-sm text-cream-dim mb-1">当前后端不支持推荐歌单</p>
          <p className="text-[11px] text-cream-faint">
            切换到提供 getRecommendSheetTags 的 MusicFree 插件以查看
          </p>
        </div>
      )}

      {loading && (
        <div className="signal-bars" style={{ height: 22 }}>
          <span></span>
          <span></span>
          <span></span>
        </div>
      )}

      {error && (
        <p
          className="p-2 rounded text-xs font-mono mb-3"
          style={{
            background: "rgba(255,80,80,0.08)",
            color: "#FF6B6B",
            border: "1px solid rgba(255,80,80,0.25)",
          }}
        >
          {error}
        </p>
      )}

      {data && supported && (
        <>
          {data.pinned.length > 0 && (
            <section className="mb-5">
              <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
                PINNED
              </p>
              <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                {data.pinned.map((t) => (
                  <Link
                    key={t.id}
                    to={`/music/recommend/${encodeURIComponent(t.id)}`}
                    className="shrink-0 px-3 py-1.5 rounded-full text-[11px] font-display font-semibold tap"
                    style={{
                      background: "var(--ember)",
                      color: "var(--ink)",
                      border: "1px solid rgba(255,107,53,0.3)",
                    }}
                  >
                    {t.name}
                  </Link>
                ))}
              </div>
            </section>
          )}
          {data.groups.map((g) => (
            <section key={g.title} className="mb-5">
              <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
                {g.title.toUpperCase()}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {g.tags.map((t) => (
                  <Link
                    key={t.id}
                    to={`/music/recommend/${encodeURIComponent(t.id)}`}
                    className="px-2.5 py-1.5 rounded text-[11px] font-display font-semibold tap"
                    style={{
                      background: "var(--ink-3)",
                      color: "var(--cream)",
                      border: "1px solid var(--cream-line)",
                    }}
                  >
                    {t.name}
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
