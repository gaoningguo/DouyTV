/**
 * 豆瓣热门推荐 —— 点播页未输入关键词时的发现入口。
 *
 * 行为：
 *   - 第一行：kind 切换（电影 / 电视剧）
 *   - 第二行：标签胶囊（热门 / 美剧 / 经典 …），换行不溢出
 *   - 网格：豆瓣海报 + 标题 + 评分；点击卡片自动触发搜索（豆瓣 title 作为关键词）
 */
import { useEffect, useState } from "react";
import {
  fetchDoubanList,
  MOVIE_TAGS,
  TV_TAGS,
  type DoubanItem,
  type DoubanKind,
} from "@/lib/douban";
import { IconFilm } from "@/components/Icon";
import { wrapImage } from "@/lib/proxy";

interface Props {
  /** 用户点豆瓣卡片时调用 —— 实际触发 useSearch.search(title) */
  onPickTitle: (title: string) => void;
}

const KIND_KEY = "douytv:douban-kind";
const TAG_KEY = "douytv:douban-tag";

function readKind(): DoubanKind {
  try {
    const v = localStorage.getItem(KIND_KEY);
    return v === "tv" ? "tv" : "movie";
  } catch {
    return "movie";
  }
}

function readTag(): string {
  try {
    return localStorage.getItem(TAG_KEY) || "热门";
  } catch {
    return "热门";
  }
}

export default function HotRecommendations({ onPickTitle }: Props) {
  const [kind, setKind] = useState<DoubanKind>(readKind);
  const [tag, setTag] = useState<string>(readTag);
  const [items, setItems] = useState<DoubanItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const availableTags = kind === "movie" ? MOVIE_TAGS : TV_TAGS;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    fetchDoubanList(kind, tag, 20, 0)
      .then((list) => {
        if (!cancelled) setItems(list);
      })
      .catch((e) => {
        if (!cancelled) {
          setError((e as Error).message ?? String(e));
          setItems([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, tag]);

  const switchKind = (k: DoubanKind) => {
    setKind(k);
    try {
      localStorage.setItem(KIND_KEY, k);
    } catch {}
    // 切 kind 时如果当前 tag 不在新 kind 的预设里，回到"热门"
    const next = k === "movie" ? MOVIE_TAGS : TV_TAGS;
    if (!next.includes(tag)) {
      setTag("热门");
      try {
        localStorage.setItem(TAG_KEY, "热门");
      } catch {}
    }
  };

  const switchTag = (t: string) => {
    setTag(t);
    try {
      localStorage.setItem(TAG_KEY, t);
    } catch {}
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
          DISCOVER · 豆瓣
        </p>
        {/* kind 切换 */}
        <div
          className="flex rounded-full overflow-hidden"
          style={{ border: "1px solid var(--cream-line)" }}
        >
          {(["movie", "tv"] as DoubanKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => switchKind(k)}
              className="px-3 py-1 text-[11px] font-display tap"
              style={{
                background: kind === k ? "var(--ember-soft)" : "var(--ink-2)",
                color: kind === k ? "var(--ember)" : "var(--cream-dim)",
                borderLeft: k === "tv" ? "1px solid var(--cream-line)" : undefined,
              }}
            >
              {k === "movie" ? "电影" : "电视剧"}
            </button>
          ))}
        </div>
      </div>

      {/* 标签 —— 换行 */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {availableTags.map((t) => {
          const active = t === tag;
          return (
            <button
              key={t}
              type="button"
              onClick={() => switchTag(t)}
              className="px-2.5 py-1 rounded-full text-[11px] font-display tap whitespace-nowrap"
              style={{
                background: active ? "var(--ember-soft)" : "var(--ink-2)",
                border: `1px solid ${active ? "var(--ember)" : "var(--cream-line)"}`,
                color: active ? "var(--ember)" : "var(--cream-dim)",
              }}
            >
              {t}
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-[10px] font-mono text-cream-faint">
          <span className="signal-bars" style={{ height: 10 }}>
            <span></span>
            <span></span>
            <span></span>
          </span>
          <span>加载豆瓣 {tag} {kind === "movie" ? "电影" : "电视剧"}…</span>
        </div>
      )}
      {error && (
        <p className="text-[11px] font-mono text-ember">
          豆瓣加载失败：{error}
        </p>
      )}

      {!loading && items.length > 0 && (
        <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => onPickTitle(it.title)}
              className="rounded-lg overflow-hidden flex flex-col tap text-left"
              style={{
                background: "var(--ink-2)",
                border: "1px solid var(--cream-line)",
              }}
              title={`搜索「${it.title}」`}
            >
              <div
                className="aspect-[3/4] relative scanlines"
                style={{ background: "var(--ink-3)" }}
              >
                {it.cover ? (
                  <img
                    src={wrapImage(it.cover)}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                    alt={it.title}
                    loading="lazy"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-cream-faint">
                    <IconFilm size={28} />
                  </div>
                )}
                {it.rate && Number(it.rate) > 0 && (
                  <span
                    className="absolute top-1 right-1 font-mono text-[9px] px-1.5 py-0.5 rounded tracking-wider"
                    style={{
                      background: "rgba(14,15,17,0.85)",
                      color: "var(--ember)",
                      border: "1px solid rgba(255,107,53,0.3)",
                    }}
                  >
                    ★ {it.rate}
                  </span>
                )}
              </div>
              <p className="p-2 text-xs line-clamp-1 text-cream font-display">
                {it.title}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
