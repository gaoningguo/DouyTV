import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMangaStore } from "@/stores/manga";
import { getRecommend, getSources, isMangaConfigured } from "@/lib/manga/client";
import type {
  MangaRecommendType,
  MangaSearchItem,
  MangaSource,
} from "@/lib/manga/types";
import { IconManga, IconSearch } from "@/components/Icon";
import MangaSrcHome from "./MangaSrcHome";

type Tab = "suwayomi" | "json";

const TAB_KEY = "douytv:manga-home-tab";

export default function MangaHome() {
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const v = localStorage.getItem(TAB_KEY);
      return v === "json" ? "json" : "suwayomi";
    } catch {
      return "suwayomi";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      /* private */
    }
  }, [tab]);

  return (
    <div className="min-h-screen bg-ink text-cream">
      <div
        className="sticky z-10 flex gap-2 px-3 pt-3 pb-2 backdrop-blur-md"
        style={{
          top: "env(safe-area-inset-top)",
          background: "rgba(14,15,17,0.92)",
          borderBottom: "1px solid var(--cream-line)",
        }}
      >
        <TabBtn active={tab === "suwayomi"} onClick={() => setTab("suwayomi")}>
          Suwayomi 服务
        </TabBtn>
        <TabBtn active={tab === "json"} onClick={() => setTab("json")}>
          JSON 自定义源
        </TabBtn>
      </div>
      {tab === "suwayomi" ? <SuwayomiPanel /> : <MangaSrcHome />}
    </div>
  );
}

function TabBtn({
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
      className="px-3 py-1.5 rounded-full text-[11px] font-display font-semibold tap"
      style={{
        background: active ? "var(--ember-soft)" : "var(--ink-2)",
        border: `1px solid ${
          active ? "rgba(255,107,53,0.4)" : "var(--cream-line)"
        }`,
        color: active ? "var(--ember)" : "var(--cream-dim)",
      }}
    >
      {children}
    </button>
  );
}

function SuwayomiPanel() {
  const navigate = useNavigate();
  const store = useMangaStore();
  const hydrate = useMangaStore((s) => s.hydrate);

  const [sources, setSources] = useState<MangaSource[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [type, setType] = useState<MangaRecommendType>("POPULAR");
  const [list, setList] = useState<MangaSearchItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!store.hydrated || !isMangaConfigured()) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await getSources("zh");
        if (cancelled) return;
        setSources(s);
        if (!sourceId && s.length > 0) setSourceId(s[0].id);
      } catch (e) {
        if (!cancelled) setError((e as Error).message ?? String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.hydrated, store.serverUrl]);

  const load = useCallback(
    async (p: number, append: boolean) => {
      const src = sources.find((s) => s.id === sourceId);
      if (!src) return;
      setLoading(true);
      setError(null);
      try {
        const r = await getRecommend(src, type, p);
        setList((prev) => (append ? [...prev, ...r.mangas] : r.mangas));
        setPage(p);
        setHasMore(r.hasNextPage);
      } catch (e) {
        setError((e as Error).message ?? String(e));
      } finally {
        setLoading(false);
      }
    },
    [sources, sourceId, type]
  );

  useEffect(() => {
    if (!sourceId) return;
    void load(1, false);
  }, [sourceId, type, load]);

  if (!store.hydrated) return null;

  if (!isMangaConfigured()) {
    return (
      <div className="p-4">
        <div
          className="rounded-xl p-5 text-center"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
        >
          <IconManga size={36} className="text-cream-faint mx-auto mb-3" />
          <p className="text-sm font-display font-semibold mb-1">未配置 Suwayomi 服务</p>
          <p className="text-[11px] text-cream-faint mb-4 leading-relaxed">
            请先去设置页填写 Suwayomi 服务地址
          </p>
          <Link
            to="/settings/manga"
            className="inline-block px-5 py-2 rounded-full text-xs font-display font-semibold tap"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            前往设置
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
            SUWAYOMI · BROWSE
          </p>
          <h1 className="font-display text-xl font-extrabold tracking-tight">Suwayomi</h1>
        </div>
        <div className="flex gap-2">
          <Link
            to="/manga/shelf"
            className="px-3 h-9 flex items-center rounded-full tap font-display text-xs text-cream"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          >
            书架 ({store.shelf.length})
          </Link>
          <button
            type="button"
            onClick={() => navigate("/manga/search")}
            className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream"
            style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
            aria-label="搜索"
          >
            <IconSearch size={16} />
          </button>
        </div>
      </div>

      {/* 源切换 */}
      {sources.length > 0 && (
        <div className="flex gap-1 overflow-x-auto no-scrollbar mb-3 pb-1">
          {sources.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSourceId(s.id)}
              className="px-3 py-1.5 rounded-md text-[11px] font-display font-semibold whitespace-nowrap tap shrink-0"
              style={{
                background: sourceId === s.id ? "var(--ember)" : "var(--ink-3)",
                color: sourceId === s.id ? "var(--ink)" : "var(--cream-dim)",
                border: "1px solid var(--cream-line)",
              }}
            >
              {s.displayName || s.name}
            </button>
          ))}
        </div>
      )}

      {/* 推荐类型 */}
      <div className="flex gap-1 mb-4">
        {(["POPULAR", "LATEST"] as MangaRecommendType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className="flex-1 py-1.5 rounded-md text-[11px] font-display font-semibold tap"
            style={{
              background: type === t ? "var(--ember)" : "var(--ink-3)",
              color: type === t ? "var(--ink)" : "var(--cream-dim)",
              border: "1px solid var(--cream-line)",
            }}
          >
            {t === "POPULAR" ? "热门" : "最新"}
          </button>
        ))}
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
          <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {list.map((m) => (
              <li key={`${m.sourceId}-${m.id}`}>
                <Link
                  to={`/manga/detail/${encodeURIComponent(m.sourceId)}/${encodeURIComponent(m.id)}`}
                  state={m}
                  className="block rounded-lg overflow-hidden tap"
                  style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
                >
                  {m.cover ? (
                    <img
                      src={m.cover}
                      alt={m.title}
                      loading="lazy"
                      className="w-full aspect-[3/4] object-cover"
                    />
                  ) : (
                    <div className="w-full aspect-[3/4] flex items-center justify-center bg-ink-3">
                      <IconManga size={32} className="text-cream-faint" />
                    </div>
                  )}
                  <div className="p-2">
                    <p className="text-xs font-display font-semibold line-clamp-2">{m.title}</p>
                    {(m.author || m.status) && (
                      <p className="text-[10px] text-cream-faint mt-1 line-clamp-1">
                        {[m.author, m.status].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {hasMore && !loading && (
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
