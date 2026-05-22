/**
 * 电子书首页 —— 顶部 tab：OPDS 个人书库 / 网络小说 (Legado)。
 * OPDS 走 BooksStore；网络小说走 NovelSourceStore (legado 兼容)。
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useBooksStore } from "@/stores/books";
import { IconBook, IconSearch } from "@/components/Icon";
import NovelHome from "./NovelHome";

type Tab = "opds" | "novel";

const TAB_KEY = "douytv:books-home-tab";

export default function BooksHome() {
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const v = localStorage.getItem(TAB_KEY);
      return v === "novel" ? "novel" : "opds";
    } catch {
      return "opds";
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
      {/* 顶部 tab bar */}
      <div
        className="sticky top-0 z-10 flex gap-2 px-3 pt-3 pb-2 backdrop-blur-md"
        style={{
          background: "rgba(14,15,17,0.92)",
          borderBottom: "1px solid var(--cream-line)",
        }}
      >
        <TabBtn active={tab === "opds"} onClick={() => setTab("opds")}>
          个人书库 · OPDS
        </TabBtn>
        <TabBtn active={tab === "novel"} onClick={() => setTab("novel")}>
          网络小说
        </TabBtn>
      </div>
      {tab === "opds" ? <OpdsPanel /> : <NovelHome />}
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

function OpdsPanel() {
  const store = useBooksStore();
  const hydrate = useBooksStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (!store.hydrated) return null;

  if (store.sources.length === 0) {
    return (
      <div className="p-4">
        <div
          className="rounded-xl p-5 text-center"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
        >
          <IconBook size={36} className="text-cream-faint mx-auto mb-3" />
          <p className="text-sm font-display font-semibold mb-1">
            尚未添加 OPDS 源
          </p>
          <p className="text-[11px] text-cream-faint mb-4 leading-relaxed">
            Calibre Server / Komga / Kavita 自部署后填入 URL 即可
          </p>
          <Link
            to="/settings/books"
            className="inline-block px-5 py-2 rounded-full text-xs font-display font-semibold tap"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            去添加
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
          SOURCES · {store.sources.length}
        </p>
        <Link
          to="/books/shelf"
          className="px-3 h-8 flex items-center rounded-full tap font-display text-xs text-cream"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
        >
          书架 ({store.shelf.length})
        </Link>
      </div>
      <ul className="space-y-2">
        {store.sources.map((src) => (
          <li
            key={src.id}
            className="rounded-xl p-4"
            style={{
              background: "var(--ink-2)",
              border: "1px solid var(--cream-line)",
            }}
          >
            <p className="text-sm font-display font-semibold mb-1">{src.name}</p>
            <p className="text-[10px] font-mono text-cream-faint truncate mb-3">
              {src.url}
            </p>
            <div className="flex gap-2">
              <Link
                to={`/books/catalog/${encodeURIComponent(src.id)}`}
                className="flex-1 text-center py-2 rounded-lg text-xs font-display font-semibold tap"
                style={{ background: "var(--ember)", color: "var(--ink)" }}
              >
                浏览目录
              </Link>
              <Link
                to={`/books/search/${encodeURIComponent(src.id)}`}
                className="px-4 py-2 rounded-lg text-xs tap flex items-center gap-1 text-cream"
                style={{
                  background: "var(--ink-3)",
                  border: "1px solid var(--cream-line)",
                }}
              >
                <IconSearch size={12} />
                搜索
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
