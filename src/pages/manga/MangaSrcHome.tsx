/**
 * JSON 漫画源入口 —— 三 tab：搜索 / 探索 / 书架。
 *
 *  - 搜索：跨源聚合，结果带源徽章
 *  - 探索：每源的分类（exploreUrl 解析）+ 按分类拉漫画列表
 *  - 书架：本地收藏；带"检查更新"按钮 + 有新章节红点
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMangaSourceStore } from "@/stores/mangasource";
import {
  searchManga,
  exploreManga,
  exploreCategoryMangas,
  parseMangaExploreCategories,
  type MangaExploreCategory,
} from "@/lib/mangasources/runtime";
import type { MangaItem, MangaSourceV2 } from "@/lib/mangasources/types";
import { IconManga, IconRefresh, IconSearch, IconSettings } from "@/components/Icon";
import { CoverCard } from "@/components/CoverCard";
import { MediaGrid } from "@/components/MediaGrid";
import { EmptyState } from "@/components/EmptyState";

type Tab = "search" | "explore" | "shelf";
const TAB_KEY = "douytv:mangasrc-home-tab";

interface SearchResultWithSources {
  manga: MangaItem;
  alternates: MangaItem[];
}

export default function MangaSrcHome() {
  const navigate = useNavigate();
  const sources = useMangaSourceStore((s) => s.sources);
  const shelf = useMangaSourceStore((s) => s.shelf);
  const health = useMangaSourceStore((s) => s.health);
  const hydrate = useMangaSourceStore((s) => s.hydrate);
  const hasUpdate = useMangaSourceStore((s) => s.hasUpdate);
  const checkUpdates = useMangaSourceStore((s) => s.checkUpdates);

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

  const enabled = sources.filter((s) => s.enabled);

  /* ─────── 搜索 ─────── */
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<SearchResultWithSources[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doSearch = async () => {
    if (!keyword.trim() || enabled.length === 0) return;
    setLoading(true);
    setError(null);
    setResults([]);
    const byKey = new Map<string, SearchResultWithSources>();
    await Promise.allSettled(
      enabled.map(async (src) => {
        try {
          const list = await searchManga(src, keyword.trim(), 1);
          for (const m of list.slice(0, 10)) {
            const key = `${m.name}::${m.author ?? ""}`;
            const existing = byKey.get(key);
            if (existing) {
              if (
                existing.manga.sourceId !== m.sourceId &&
                !existing.alternates.find((x) => x.sourceId === m.sourceId)
              ) {
                existing.alternates.push(m);
              }
            } else {
              byKey.set(key, { manga: m, alternates: [] });
            }
          }
        } catch (e) {
          console.warn("[mangasrc] search failed", src.name, e);
        }
      })
    );
    setResults(Array.from(byKey.values()));
    setLoading(false);
    if (byKey.size === 0) {
      setError("所有源都没搜到结果 —— 试试别的关键词");
    }
  };

  /* ─────── 探索 ─────── */
  const [exploreSourceId, setExploreSourceId] = useState<string>("");
  const [exploreCategories, setExploreCategories] = useState<
    Record<string, MangaExploreCategory[]>
  >({});
  const [exploreActiveCat, setExploreActiveCat] =
    useState<MangaExploreCategory | null>(null);
  const [exploreList, setExploreList] = useState<MangaItem[]>([]);
  const [exploreLoading, setExploreLoading] = useState(false);
  const [exploreError, setExploreError] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== "explore") return;
    const next: Record<string, MangaExploreCategory[]> = {};
    for (const s of enabled) {
      // 显式 explore 分类
      const cats = parseMangaExploreCategories(s);
      if (cats.length > 0) next[s.id] = cats;
      else if (s.exploreUrl)
        // 只有简单 exploreUrl 时也允许作为单一"推荐"分类
        next[s.id] = [{ title: "推荐", url: s.exploreUrl }];
    }
    setExploreCategories(next);
    if (!exploreSourceId || !next[exploreSourceId]) {
      const firstId = Object.keys(next)[0] ?? "";
      setExploreSourceId(firstId);
      setExploreActiveCat(next[firstId]?.[0] ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, sources]);

  const loadExploreList = useCallback(
    async (src: MangaSourceV2 | undefined, cat: MangaExploreCategory | null) => {
      if (!src) {
        setExploreList([]);
        return;
      }
      setExploreLoading(true);
      setExploreError(null);
      setExploreList([]);
      try {
        let list: MangaItem[];
        if (!cat || cat.title === "推荐") {
          list = await exploreManga(src, 1);
        } else {
          list = await exploreCategoryMangas(src, cat, 1);
        }
        setExploreList(list);
        if (list.length === 0) {
          setExploreError("该分类暂时没有结果（检查 ruleList / exploreUrl）");
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

  /* ─────── 书架更新检查 ─────── */
  const [updateChecking, setUpdateChecking] = useState(false);
  const runCheckUpdates = async () => {
    setUpdateChecking(true);
    try {
      await checkUpdates();
    } finally {
      setUpdateChecking(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-ink text-cream">
      <div
        className="shrink-0 flex items-center gap-2 px-4 pt-4 pb-3"
        style={{ borderBottom: "1px solid var(--cream-line)" }}
      >
        <div className="flex-1">
          <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
            MANGA · JSON SOURCES
          </p>
          <h1 className="font-display text-xl font-extrabold tracking-tight">
            漫画源
          </h1>
        </div>
        <Link
          to="/settings/manga-src"
          className="px-3 py-1.5 rounded-lg text-[11px] font-display font-semibold text-cream tap"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
        >
          <IconSettings size={12} className="inline mr-1" />
          源管理
        </Link>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-4">

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
              background: tab === k ? "var(--ember)" : "transparent",
              color: tab === k ? "var(--ink)" : "var(--cream)",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {enabled.length === 0 && (
        <EmptyState
          icon={<IconManga size={48} />}
          title="尚无可用漫画源"
          subtitle="先去添加 / 启用至少一个漫画源"
          action={
            <Link
              to="/settings/manga-src"
              className="inline-block px-4 py-2 rounded-lg text-[11px] font-display font-semibold tap"
              style={{ background: "var(--ember)", color: "var(--ink)" }}
            >
              去添加源
            </Link>
          }
        />
      )}

      {/* ── 搜索 tab ── */}
      {tab === "search" && enabled.length > 0 && (
        <>
          <div className="flex gap-2 mb-4">
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void doSearch()}
              placeholder="搜索漫画…"
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
              {loading ? `${enabled.length} 源…` : "搜索"}
            </button>
          </div>

          {error && <ErrorBox text={error} />}

          {results.length > 0 && (
            <Section title={`SEARCH · ${results.length}`}>
              <Grid
                items={results.map((r) => ({
                  manga: r.manga,
                  sourceName: sources.find((s) => s.id === r.manga.sourceId)
                    ?.name,
                  altCount: r.alternates.length,
                }))}
                onOpen={(m) => openManga(navigate, m)}
              />
            </Section>
          )}

          {/* 源列表 */}
          <Section title={`ACTIVE SOURCES · ${enabled.length}`}>
            <ul className="space-y-1">
              {enabled.map((s) => {
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
                      {s.name}
                    </span>
                    {s.group && (
                      <span className="text-cream-faint font-mono text-[10px]">
                        {s.group}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>
        </>
      )}

      {/* ── 探索 tab ── */}
      {tab === "explore" && enabled.length > 0 && (
        <>
          <div className="mb-3">
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-1.5">
              SOURCE
            </p>
            <div className="flex gap-1 flex-wrap">
              {enabled
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
                        exploreSourceId === s.id
                          ? "var(--ink)"
                          : "var(--cream)",
                      border: "1px solid var(--cream-line)",
                    }}
                  >
                    {s.name}
                  </button>
                ))}
              {enabled.every((s) => !exploreCategories[s.id]?.length) && (
                <p className="text-[11px] text-cream-dim">
                  当前启用的源都没有 exploreUrl 配置。
                </p>
              )}
            </div>
          </div>

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
            <Grid
              items={exploreList.map((m) => ({
                manga: m,
                sourceName: sources.find((s) => s.id === m.sourceId)?.name,
              }))}
              onOpen={(m) => openManga(navigate, m)}
            />
          )}
        </>
      )}

      {/* ── 书架 tab ── */}
      {tab === "shelf" && (
        <>
          {shelf.length === 0 ? (
            <EmptyState
              icon={<IconManga size={48} />}
              title="书架空空"
              subtitle="先去搜索或探索找几本喜欢的漫画加入吧"
            />
          ) : (
            <>
              <button
                type="button"
                onClick={() => void runCheckUpdates()}
                disabled={updateChecking}
                className="w-full mb-3 py-2 rounded-lg tap text-[11px] font-display font-semibold disabled:opacity-50"
                style={{
                  background: "var(--phosphor-soft)",
                  color: "var(--phosphor)",
                  border: "1px solid rgba(124,255,178,0.3)",
                }}
              >
                <IconRefresh size={12} className="inline mr-1" />
                {updateChecking ? "正在检查…" : `检查 ${shelf.length} 本漫画更新`}
              </button>
              <Grid
                items={shelf.map((m) => ({
                  manga: m,
                  sourceName: sources.find((s) => s.id === m.sourceId)?.name,
                  badge: m.lastReadChapterTitle,
                  showUpdate: hasUpdate(m.id),
                }))}
                onOpen={(m) => openManga(navigate, m)}
              />
            </>
          )}
        </>
      )}
      </div>
    </div>
  );
}

/* ───────────────── helpers ───────────────── */

function openManga(
  navigate: ReturnType<typeof useNavigate>,
  manga: MangaItem
) {
  navigate(
    `/manga/src/detail/${manga.sourceId}/${encodeURIComponent(manga.url)}`,
    { state: { manga } }
  );
}

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

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
        {title}
      </p>
      {children}
    </section>
  );
}

interface CardItem {
  manga: MangaItem;
  sourceName?: string;
  badge?: string;
  altCount?: number;
  showUpdate?: boolean;
}

function Grid({
  items,
  onOpen,
}: {
  items: CardItem[];
  onOpen: (m: MangaItem) => void;
}) {
  return (
    <MediaGrid>
      {items.map((it) => (
        <CoverCard
          key={it.manga.id}
          cover={it.manga.cover}
          title={it.manga.name}
          subtitle={it.manga.author}
          proxyCover
          meta={
            it.sourceName ? (
              <>
                {it.sourceName}
                {it.altCount && it.altCount > 0 ? (
                  <span className="ml-1 text-ember">+{it.altCount}</span>
                ) : null}
              </>
            ) : undefined
          }
          bottomBadge={it.badge}
          topBadge={
            it.showUpdate ? (
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: "#E14F4F" }}
                title="有新章节"
              />
            ) : undefined
          }
          onClick={() => onOpen(it.manga)}
        />
      ))}
    </MediaGrid>
  );
}
