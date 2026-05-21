import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useMangaStore } from "@/stores/manga";
import { getMangaDetail } from "@/lib/manga/client";
import type { MangaDetail, MangaSearchItem } from "@/lib/manga/types";
import { IconHeart, IconHeartFill } from "@/components/Icon";
import { DetailHero, MetaChip } from "@/components/DetailHero";

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
      <DetailHero
        cover={cover}
        title={title}
        subtitle={detail?.author}
        onBack={() => navigate(-1)}
        metaChips={
          <>
            {detail?.status && <MetaChip>{detail.status}</MetaChip>}
            {isOnShelf && <MetaChip color="ember">已在书架</MetaChip>}
          </>
        }
        description={detail?.description}
        actions={
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
            className="px-4 py-2 rounded-lg text-sm font-display font-semibold tap inline-flex items-center gap-1.5"
            style={{
              background: isOnShelf ? "var(--ember-soft)" : "var(--ember)",
              border: `1px solid ${isOnShelf ? "var(--ember)" : "var(--ember)"}`,
              color: isOnShelf ? "var(--ember)" : "var(--ink)",
            }}
          >
            {isOnShelf ? <IconHeartFill size={14} /> : <IconHeart size={14} />}
            {isOnShelf ? "已在书架" : "加入书架"}
          </button>
        }
      />

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
