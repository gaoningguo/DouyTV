import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useMangaStore } from "@/stores/manga";
import { getMangaDetail } from "@/lib/manga/client";
import type { MangaDetail, MangaSearchItem } from "@/lib/manga/types";
import { IconArrowLeft, IconManga, IconHeart, IconHeartFill } from "@/components/Icon";

export default function MangaDetailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sourceId = "", mangaId = "" } = useParams<{ sourceId: string; mangaId: string }>();
  const store = useMangaStore();
  const hydrate = useMangaStore((s) => s.hydrate);

  const initial = (location.state || undefined) as MangaSearchItem | undefined;
  const [detail, setDetail] = useState<MangaDetail | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await getMangaDetail(mangaId);
      setDetail(d);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [mangaId]);

  useEffect(() => {
    if (store.hydrated) void load();
  }, [store.hydrated, load]);

  const isOnShelf = store.isOnShelf(sourceId, mangaId);
  const cover = detail?.cover || initial?.cover;
  const title = detail?.title || initial?.title || "未知";

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
      </div>

      <div className="flex gap-4 mb-5">
        <div className="w-28 shrink-0">
          {cover ? (
            <img
              src={cover}
              alt={title}
              className="w-full aspect-[3/4] rounded-lg object-cover"
              style={{ boxShadow: "0 12px 24px -12px rgba(0,0,0,0.7)" }}
            />
          ) : (
            <div className="w-full aspect-[3/4] rounded-lg flex items-center justify-center bg-ink-2">
              <IconManga size={32} className="text-cream-faint" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-display text-lg font-extrabold tracking-tight">{title}</h1>
          {detail?.author && <p className="text-xs text-cream-dim mt-1">{detail.author}</p>}
          {detail?.status && (
            <p className="text-[10px] font-mono text-cream-faint mt-2">{detail.status}</p>
          )}
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={() => {
                const item: MangaSearchItem = initial || {
                  id: mangaId,
                  sourceId,
                  sourceName: detail?.sourceName || "",
                  title,
                  cover: cover || "",
                  description: detail?.description,
                  author: detail?.author,
                  status: detail?.status,
                };
                if (isOnShelf) void store.removeFromShelf(sourceId, mangaId);
                else void store.addToShelf(item);
              }}
              className="px-3 py-1.5 rounded-full text-xs font-display font-semibold tap flex items-center gap-1"
              style={{
                background: isOnShelf ? "var(--ember-soft)" : "var(--ink-2)",
                border: `1px solid ${isOnShelf ? "var(--ember)" : "var(--cream-line)"}`,
                color: isOnShelf ? "var(--ember)" : "var(--cream)",
              }}
            >
              {isOnShelf ? <IconHeartFill size={12} /> : <IconHeart size={12} />}
              {isOnShelf ? "已在书架" : "加入书架"}
            </button>
          </div>
        </div>
      </div>

      {detail?.description && (
        <p className="text-xs text-cream-dim leading-relaxed mb-5 whitespace-pre-line">
          {detail.description}
        </p>
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

      {loading ? (
        <div className="signal-bars" style={{ height: 22 }}>
          <span></span>
          <span></span>
          <span></span>
        </div>
      ) : detail ? (
        <>
          <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-3">
            CHAPTERS · {detail.chapters.length}
          </p>
          <ul className="space-y-1.5">
            {detail.chapters.map((c) => {
              const history = store.getHistory(sourceId, mangaId, c.id);
              return (
                <li key={c.id}>
                  <Link
                    to={`/manga/read/${encodeURIComponent(sourceId)}/${encodeURIComponent(mangaId)}/${encodeURIComponent(c.id)}`}
                    state={{ chapterName: c.name, detail }}
                    className="block p-3 rounded-lg tap"
                    style={{
                      background: history ? "var(--ember-soft)" : "var(--ink-2)",
                      border: `1px solid ${
                        history ? "var(--ember)" : "var(--cream-line)"
                      }`,
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-display font-semibold line-clamp-1">{c.name}</p>
                        {c.scanlator && (
                          <p className="text-[10px] font-mono text-cream-faint mt-0.5 line-clamp-1">
                            {c.scanlator}
                          </p>
                        )}
                      </div>
                      {history && (
                        <span
                          className="font-mono text-[10px] shrink-0"
                          style={{ color: "var(--ember)" }}
                        >
                          {history.pageIndex + 1}/{history.pageCount}
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}
