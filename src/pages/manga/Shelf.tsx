import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMangaStore } from "@/stores/manga";
import { IconArrowLeft, IconManga } from "@/components/Icon";

export default function MangaShelf() {
  const navigate = useNavigate();
  const store = useMangaStore();
  const hydrate = useMangaStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

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
        <div className="flex-1">
          <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
            MANGA · SHELF · {store.shelf.length}
          </p>
          <h1 className="font-display text-xl font-extrabold tracking-tight">我的书架</h1>
        </div>
      </div>

      {store.shelf.length === 0 ? (
        <p className="text-[11px] text-cream-faint text-center py-12">书架为空</p>
      ) : (
        <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {store.shelf.map((m) => (
            <li key={`${m.sourceId}-${m.mangaId}`}>
              <Link
                to={`/manga/detail/${encodeURIComponent(m.sourceId)}/${encodeURIComponent(m.mangaId)}`}
                className="block rounded-lg overflow-hidden tap"
                style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
              >
                {m.cover ? (
                  <img src={m.cover} alt={m.title} loading="lazy" className="w-full aspect-[3/4] object-cover" />
                ) : (
                  <div className="w-full aspect-[3/4] flex items-center justify-center bg-ink-3">
                    <IconManga size={32} className="text-cream-faint" />
                  </div>
                )}
                <div className="p-2">
                  <p className="text-xs font-display font-semibold line-clamp-2">{m.title}</p>
                  {m.lastChapterName && (
                    <p className="text-[10px] font-mono text-cream-faint mt-1 line-clamp-1">
                      上次：{m.lastChapterName}
                    </p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
