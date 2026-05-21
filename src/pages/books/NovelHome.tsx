/**
 * 网络小说入口 —— 三个子 tab：
 *   - 搜索：跨源聚合搜索，结果带源徽章
 *   - 探索：每个 enabled 源的分类（exploreUrl 解析）+ 按分类拉书
 *   - 书架：已收藏 + 在读
 *
 * 当无 enabled 书源时显示「去添加书源」引导。
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useNovelSourceStore } from "@/stores/novelsource";
import {
  exploreBooks,
  parseExploreCategories,
  searchBooks,
  type ExploreCategory,
} from "@/lib/booksources/runtime";
import type { BookSourceV2, NovelBook } from "@/lib/booksources/types";
import { IconBook, IconSearch, IconSettings } from "@/components/Icon";
import { CoverCard } from "@/components/CoverCard";
import { MediaGrid } from "@/components/MediaGrid";
import { EmptyState } from "@/components/EmptyState";

type Tab = "search" | "explore" | "shelf";
const TAB_KEY = "douytv:novel-home-tab";

interface SearchResultWithSources {
  /** 主代表 */
  book: NovelBook;
  /** 同名其它源（按 sourceId 去重）—— 用于"换源"提示 */
  alternates: NovelBook[];
}

export default function NovelHome() {
  const navigate = useNavigate();
  const sources = useNovelSourceStore((s) => s.sources);
  const shelf = useNovelSourceStore((s) => s.shelf);
  const health = useNovelSourceStore((s) => s.health);
  const hydrate = useNovelSourceStore((s) => s.hydrate);

  const [tab, setTab] = useState<Tab>(() => {
    try {
      const v = localStorage.getItem(TAB_KEY);
      return v === "explore" || v === "shelf" ? (v as Tab) : "search";
    } catch {
      return "search";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      /* ignore */
    }
  }, [tab]);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const enabledSources = sources.filter((s) => s.enabled);

  /* ─────────── 搜索 ─────────── */
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<SearchResultWithSources[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doSearch = async () => {
    if (!keyword.trim() || enabledSources.length === 0) return;
    setLoading(true);
    setError(null);
    setResults([]);
    // 并发跨源搜，合并按 name+author，保留所有源的副本作为换源 alternates
    const byKey = new Map<string, SearchResultWithSources>();
    await Promise.allSettled(
      enabledSources.map(async (src) => {
        try {
          const list = await searchBooks(src, keyword.trim(), 1);
          for (const b of list.slice(0, 10)) {
            const key = `${b.name}::${b.author ?? ""}`;
            const existing = byKey.get(key);
            if (existing) {
              if (
                existing.book.sourceId !== b.sourceId &&
                !existing.alternates.find((x) => x.sourceId === b.sourceId)
              ) {
                existing.alternates.push(b);
              }
            } else {
              byKey.set(key, { book: b, alternates: [] });
            }
          }
        } catch (e) {
          console.warn("[novel] source search failed", src.bookSourceName, e);
        }
      })
    );
    setResults(Array.from(byKey.values()));
    setLoading(false);
    if (byKey.size === 0) {
      setError("所有源都没搜到结果 —— 试试别的关键词或检查源是否正常");
    }
  };

  /* ─────────── 探索 ─────────── */
  const [exploreSourceId, setExploreSourceId] = useState<string>("");
  const [exploreCategories, setExploreCategories] = useState<
    Record<string, ExploreCategory[]>
  >({});
  const [exploreActiveCat, setExploreActiveCat] =
    useState<ExploreCategory | null>(null);
  const [exploreList, setExploreList] = useState<NovelBook[]>([]);
  const [exploreLoading, setExploreLoading] = useState(false);
  const [exploreError, setExploreError] = useState<string | null>(null);

  // 进入 explore tab 时计算各源的分类
  useEffect(() => {
    if (tab !== "explore") return;
    const next: Record<string, ExploreCategory[]> = {};
    for (const s of enabledSources) {
      const cats = parseExploreCategories(s);
      if (cats.length > 0) next[s.id] = cats;
    }
    setExploreCategories(next);
    // 默认选第一个有分类的源
    if (!exploreSourceId || !next[exploreSourceId]) {
      const firstId = Object.keys(next)[0] ?? "";
      setExploreSourceId(firstId);
      setExploreActiveCat(next[firstId]?.[0] ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, sources]);

  const loadExploreList = useCallback(
    async (src: BookSourceV2 | undefined, cat: ExploreCategory | null) => {
      if (!src || !cat) {
        setExploreList([]);
        return;
      }
      setExploreLoading(true);
      setExploreError(null);
      setExploreList([]);
      try {
        const list = await exploreBooks(src, cat, 1);
        setExploreList(list);
        if (list.length === 0) {
          setExploreError("该分类暂时没有结果（可能源 ruleExplore 缺失）");
        }
      } catch (e) {
        setExploreError((e as Error).message ?? String(e));
      } finally {
        setExploreLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (tab !== "explore") return;
    const src = sources.find((s) => s.id === exploreSourceId);
    void loadExploreList(src, exploreActiveCat);
  }, [tab, exploreSourceId, exploreActiveCat, sources, loadExploreList]);

  /* ─────────── 渲染 ─────────── */

  return (
    <div className="min-h-screen bg-ink text-cream p-4 pb-24">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex-1">
          <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
            NOVEL · WEB
          </p>
          <h1 className="font-display text-xl font-extrabold tracking-tight">
            网络小说
          </h1>
        </div>
        <Link
          to="/settings/novel"
          className="px-3 py-1.5 rounded-lg text-[11px] font-display font-semibold text-cream tap"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
        >
          <IconSettings size={12} className="inline mr-1" />
          书源管理
        </Link>
      </div>

      {/* 顶部子 tab */}
      <div
        className="flex gap-1 mb-4 p-0.5 rounded-lg"
        style={{
          background: "var(--ink-2)",
          border: "1px solid var(--cream-line)",
        }}
      >
        {(
          [
            ["search", "搜索"],
            ["explore", "探索"],
            ["shelf", `书架 · ${shelf.length}`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className="flex-1 py-1.5 rounded text-[11px] font-display font-semibold tap"
            style={{
              background:
                tab === k ? "var(--ember)" : "transparent",
              color: tab === k ? "var(--ink)" : "var(--cream)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 无源引导 */}
      {enabledSources.length === 0 && (
        <EmptyState
          icon={<IconBook size={48} />}
          title="尚无可用书源"
          subtitle="先去添加 / 启用至少一个书源"
          action={
            <Link
              to="/settings/novel"
              className="inline-block px-4 py-2 rounded-lg text-[11px] font-display font-semibold tap"
              style={{ background: "var(--ember)", color: "var(--ink)" }}
            >
              去添加书源
            </Link>
          }
        />
      )}

      {/* ── 搜索 tab ── */}
      {tab === "search" && enabledSources.length > 0 && (
        <>
          <div className="flex gap-2 mb-4">
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void doSearch()}
              placeholder="搜索书名 / 作者…"
              className="flex-1 px-3 py-2 rounded-lg text-sm outline-none text-cream placeholder:text-cream-faint"
              style={{
                background: "var(--ink-2)",
                border: "1px solid var(--cream-line)",
              }}
            />
            <button
              type="button"
              onClick={() => void doSearch()}
              disabled={loading || !keyword.trim()}
              className="px-4 py-2 rounded-lg text-xs font-display font-semibold tap disabled:opacity-50"
              style={{ background: "var(--ember)", color: "var(--ink)" }}
            >
              <IconSearch size={12} className="inline mr-1" />
              {loading ? `${enabledSources.length} 源搜索中…` : "搜索"}
            </button>
          </div>

          {error && <ErrorBox text={error} />}

          {results.length > 0 && (
            <section className="mb-6">
              <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
                SEARCH RESULTS · {results.length}
              </p>
              <MediaGrid>
                {results.map((r) => (
                  <CoverCard
                    key={r.book.id}
                    cover={r.book.cover}
                    title={r.book.name}
                    subtitle={r.book.author}
                    meta={
                      <>
                        {sources.find((s) => s.id === r.book.sourceId)?.bookSourceName ?? ""}
                        {r.alternates.length > 0 && (
                          <span className="ml-1 text-ember">+{r.alternates.length}</span>
                        )}
                      </>
                    }
                    bottomBadge={r.book.kind}
                    onClick={() =>
                      navigate(
                        `/books/novel/detail/${r.book.sourceId}/${encodeURIComponent(r.book.url)}`,
                        { state: { book: r.book } }
                      )
                    }
                  />
                ))}
              </MediaGrid>
            </section>
          )}
        </>
      )}

      {/* ── 探索 tab ── */}
      {tab === "explore" && enabledSources.length > 0 && (
        <>
          {/* 源选择 */}
          <div className="mb-3">
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-1.5">
              SOURCE
            </p>
            <div className="flex gap-1 flex-wrap">
              {enabledSources
                .filter((s) => exploreCategories[s.id]?.length)
                .map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setExploreSourceId(s.id);
                      setExploreActiveCat(exploreCategories[s.id]?.[0] ?? null);
                    }}
                    className="px-3 py-1 rounded-full text-[11px] tap"
                    style={{
                      background:
                        exploreSourceId === s.id
                          ? "var(--ember)"
                          : "var(--ink-2)",
                      color:
                        exploreSourceId === s.id ? "var(--ink)" : "var(--cream)",
                      border: "1px solid var(--cream-line)",
                    }}
                  >
                    {s.bookSourceName}
                  </button>
                ))}
              {enabledSources.every(
                (s) => !exploreCategories[s.id]?.length
              ) && (
                <p className="text-[11px] text-cream-dim">
                  当前启用的书源都没有 exploreUrl 配置 —— 你可在书源管理里手动编辑。
                </p>
              )}
            </div>
          </div>

          {/* 分类 chip */}
          {exploreSourceId && exploreCategories[exploreSourceId] && (
            <div className="mb-3">
              <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-1.5">
                CATEGORY
              </p>
              <div className="flex gap-1 flex-wrap">
                {exploreCategories[exploreSourceId].map((c) => (
                  <button
                    key={c.title + c.url}
                    type="button"
                    onClick={() => setExploreActiveCat(c)}
                    className="px-2.5 py-0.5 rounded-full text-[11px] tap"
                    style={{
                      background:
                        exploreActiveCat?.url === c.url
                          ? "rgba(255,107,53,0.2)"
                          : "var(--ink-2)",
                      color:
                        exploreActiveCat?.url === c.url
                          ? "var(--ember)"
                          : "var(--cream)",
                      border: "1px solid var(--cream-line)",
                    }}
                  >
                    {c.group ? `${c.group}·${c.title}` : c.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          {exploreLoading && (
            <p className="text-[11px] text-cream-dim">加载中…</p>
          )}
          {exploreError && <ErrorBox text={exploreError} />}

          {exploreList.length > 0 && (
            <MediaGrid>
              {exploreList.map((b) => (
                <CoverCard
                  key={b.id}
                  cover={b.cover}
                  title={b.name}
                  subtitle={b.author}
                  meta={sources.find((s) => s.id === b.sourceId)?.bookSourceName}
                  bottomBadge={b.kind}
                  onClick={() =>
                    navigate(
                      `/books/novel/detail/${b.sourceId}/${encodeURIComponent(b.url)}`,
                      { state: { book: b } }
                    )
                  }
                />
              ))}
            </MediaGrid>
          )}
        </>
      )}

      {/* ── 书架 tab ── */}
      {tab === "shelf" && (
        <>
          {shelf.length === 0 ? (
            <EmptyState
              icon={<IconBook size={48} />}
              title="书架空空"
              subtitle="先去搜索或探索找几本喜欢的书加入吧"
            />
          ) : (
            <MediaGrid>
              {shelf.map((b) => (
                <CoverCard
                  key={b.id}
                  cover={b.cover}
                  title={b.name}
                  subtitle={b.author}
                  meta={sources.find((s) => s.id === b.sourceId)?.bookSourceName}
                  bottomBadge={
                    b.lastReadChapterTitle
                      ? `上次：${b.lastReadChapterTitle}`
                      : undefined
                  }
                  onClick={() => {
                    navigate(
                      `/books/novel/detail/${b.sourceId}/${encodeURIComponent(b.url)}`,
                      { state: { book: b } }
                    );
                  }}
                />
              ))}
            </MediaGrid>
          )}
        </>
      )}

      {/* 已启用源（贴底） */}
      {tab === "search" && enabledSources.length > 0 && (
        <section className="mt-6">
          <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
            ACTIVE SOURCES · {enabledSources.length}
          </p>
          <ul className="space-y-1">
            {enabledSources.map((s) => {
              const h = health[s.id];
              return (
                <li
                  key={s.id}
                  className="px-3 py-2 rounded text-[11px] flex items-center gap-2"
                  style={{
                    background: "var(--ink-2)",
                    border: "1px solid var(--cream-line)",
                  }}
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{
                      background: h
                        ? h.ok
                          ? "#3FBA6A"
                          : "#E14F4F"
                        : "var(--cream-faint)",
                    }}
                  />
                  <span className="text-cream font-display font-semibold flex-1">
                    {s.bookSourceName}
                  </span>
                  {s.bookSourceGroup && (
                    <span className="text-cream-faint font-mono text-[10px]">
                      {s.bookSourceGroup}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ───────────────── 内部组件 ───────────────── */

function ErrorBox({ text }: { text: string }) {
  return (
    <p
      className="p-2 rounded text-[11px] font-mono mb-3"
      style={{
        background: "rgba(255,80,80,0.08)",
        color: "#FF6B6B",
        border: "1px solid rgba(255,80,80,0.25)",
      }}
    >
      ✗ {text}
    </p>
  );
}
