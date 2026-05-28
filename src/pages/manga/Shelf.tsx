import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMangaStore } from "@/stores/manga";
import { IconArrowLeft, IconManga } from "@/components/Icon";
import { CoverCard } from "@/components/CoverCard";
import { MediaGrid } from "@/components/MediaGrid";
import { EmptyState } from "@/components/EmptyState";

export default function MangaShelf() {
  const navigate = useNavigate();
  const store = useMangaStore();
  const hydrate = useMangaStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

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
        <div className="flex-1">
          <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
            MANGA · SHELF · {store.shelf.length}
          </p>
          <h1 className="font-display text-xl font-extrabold tracking-tight">我的书架</h1>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">

      {store.shelf.length === 0 ? (
        <EmptyState
          icon={<IconManga size={48} />}
          title="书架为空"
          subtitle="去发现 / 探索找几本喜欢的漫画加入"
        />
      ) : (
        <MediaGrid>
          {store.shelf.map((m) => (
            <CoverCard
              key={`${m.sourceId}-${m.mangaId}`}
              cover={m.cover}
              title={m.title}
              bottomBadge={m.lastChapterName ? `上次：${m.lastChapterName}` : undefined}
              onClick={() =>
                navigate(
                  `/manga/detail/${encodeURIComponent(m.sourceId)}/${encodeURIComponent(m.mangaId)}`
                )
              }
            />
          ))}
        </MediaGrid>
      )}
      </div>
    </div>
  );
}
