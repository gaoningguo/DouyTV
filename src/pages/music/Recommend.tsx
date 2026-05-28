/**
 * 推荐歌单 —— pinned chip + 按分组 chip 网格。capability gate 显示空态。
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getActiveBackendInfo, getRecommendSheetTags } from "@/lib/music/api";
import type { IRecommendSheetTagsResult } from "@/lib/music/types";
import { IconArrowLeft, IconFire } from "@/components/Icon";
import { useMusicStore } from "@/stores/music";
import { MusicChip } from "@/components/MusicChip";
import { MusicEmptyState } from "@/components/MusicEmptyState";

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
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-ink text-cream">
      <div
        className="shrink-0 flex items-center gap-3 px-4 pt-4 pb-3"
        style={{ borderBottom: "1px solid var(--cream-line)" }}
      >
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

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
      {!supported && !loading && (
        <MusicEmptyState
          icon={<IconFire size={32} />}
          title="当前后端不支持推荐歌单"
          subtitle="切换到提供 getRecommendSheetTags 的 MusicFree 插件以查看"
          cta={{ label: "前往设置", to: "/settings/music" }}
        />
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
            <section className="mb-6">
              <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
                <IconFire size={10} className="inline mr-1 text-ember" />
                PINNED
              </p>
              <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
                {data.pinned.map((t) => (
                  <MusicChip
                    key={t.id}
                    label={t.name}
                    active
                    onClick={() => navigate(`/music/recommend/${encodeURIComponent(t.id)}`)}
                  />
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
                  <MusicChip
                    key={t.id}
                    label={t.name}
                    onClick={() => navigate(`/music/recommend/${encodeURIComponent(t.id)}`)}
                  />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
      </div>
    </div>
  );
}
