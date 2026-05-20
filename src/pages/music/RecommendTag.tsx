/**
 * 某 tag 下的推荐歌单 — 分页加载。
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { getRecommendSheetsByTag } from "@/lib/music/api";
import type { IRecommendSheet } from "@/lib/music/types";
import { wrapImage } from "@/lib/proxy";
import { IconArrowLeft, IconMusic } from "@/components/Icon";

export default function MusicRecommendTag() {
  const navigate = useNavigate();
  const { tagId = "" } = useParams<{ tagId: string }>();
  const [list, setList] = useState<IRecommendSheet[]>([]);
  const [page, setPage] = useState(1);
  const [isEnd, setIsEnd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (p: number, append: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const r = await getRecommendSheetsByTag(tagId, p);
        setList((prev) => (append ? [...prev, ...r.list] : r.list));
        setPage(p);
        setIsEnd(r.isEnd ?? r.list.length === 0);
      } catch (e) {
        setError((e as Error).message ?? String(e));
      } finally {
        setLoading(false);
      }
    },
    [tagId]
  );

  useEffect(() => {
    void load(1, false);
  }, [load]);

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
          <h1 className="font-display text-xl font-extrabold tracking-tight">
            {decodeURIComponent(tagId)}
          </h1>
        </div>
      </div>

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

      {loading && list.length === 0 ? (
        <div className="signal-bars" style={{ height: 22 }}>
          <span></span>
          <span></span>
          <span></span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {list.map((sheet) => (
              <Link
                key={sheet.id}
                to={`/music/playlist/${encodeURIComponent(sheet.source)}/${encodeURIComponent(sheet.id)}`}
                className="rounded-lg overflow-hidden tap"
                style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
              >
                {sheet.cover ? (
                  <img
                    src={wrapImage(sheet.cover)}
                    alt=""
                    loading="lazy"
                    className="w-full aspect-square object-cover"
                  />
                ) : (
                  <div className="w-full aspect-square flex items-center justify-center bg-ink-3">
                    <IconMusic size={32} className="text-cream-faint" />
                  </div>
                )}
                <div className="p-2">
                  <p className="text-xs font-display font-semibold line-clamp-2">
                    {sheet.name}
                  </p>
                  {sheet.creator && (
                    <p className="text-[10px] font-mono text-cream-faint mt-0.5 line-clamp-1">
                      by {sheet.creator}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
          {!isEnd && !loading && list.length > 0 && (
            <button
              type="button"
              onClick={() => void load(page + 1, true)}
              className="mt-4 w-full py-2 rounded-lg text-xs tap text-cream"
              style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            >
              加载更多
            </button>
          )}
        </>
      )}
    </div>
  );
}
