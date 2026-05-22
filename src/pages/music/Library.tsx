/**
 * 我的音乐 —— 参考 MusicFree home/sheets 的双 tab + 右侧操作图标 + FlashList。
 *
 * 上方 SegmentedTab：我的歌单 / 收藏 / 历史 切换三种"我的"内容。
 * 右上 + 按钮新建歌单（仅在"我的歌单"tab）。
 * 移动 / 桌面统一单列瀑布流（移动友好）；桌面端附加"下载管理"入口。
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMusicStore } from "@/stores/music";
import { wrapImage } from "@/lib/proxy";
import {
  IconAlbum,
  IconDownload,
  IconHeart,
  IconHistoryClock,
  IconMusic,
  IconPlus,
} from "@/components/Icon";
import { MusicSegmentedTab } from "@/components/MusicSegmentedTab";
import { MusicListItem } from "@/components/MusicListItem";
import { MusicEmptyState } from "@/components/MusicEmptyState";
import { isDesktop } from "@/lib/platform";

type LibTab = "playlists" | "favorites" | "history";

function formatDuration(sec?: number) {
  if (!sec || !Number.isFinite(sec)) return undefined;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function MusicLibrary() {
  const hydrate = useMusicStore((s) => s.hydrate);
  const favorites = useMusicStore((s) => s.favorites);
  const history = useMusicStore((s) => s.history);
  const playlists = useMusicStore((s) => s.playlists);
  const createPlaylist = useMusicStore((s) => s.createPlaylist);
  const playNow = useMusicStore((s) => s.playNow);
  const [tab, setTab] = useState<LibTab>("playlists");

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const handleNewList = async () => {
    const name = window.prompt("新建歌单名称");
    if (!name?.trim()) return;
    await createPlaylist(name.trim());
  };

  const tabs = useMemo(
    () =>
      [
        { id: "playlists" as const, label: "歌单", count: playlists.length },
        { id: "favorites" as const, label: "收藏", count: favorites.length },
        { id: "history" as const, label: "历史", count: history.length },
      ] as const,
    [playlists.length, favorites.length, history.length]
  );

  return (
    <div className="min-h-screen bg-ink text-cream p-4">
      {/* 顶部 eyebrow + title */}
      <div className="mb-5">
        <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
          MUSIC · LIBRARY
        </p>
        <h1 className="font-display text-2xl font-extrabold tracking-tight">我的音乐</h1>
      </div>

      {/* 桌面专属：下载管理入口 */}
      {isDesktop() && (
        <Link
          to="/music/downloads"
          className="flex items-center gap-3 p-3 mb-5 rounded-lg tap"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
        >
          <span
            className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: "var(--ink-3)", color: "var(--ember)" }}
          >
            <IconDownload size={16} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-display font-semibold">下载管理</p>
            <p className="text-[10px] font-mono text-cream-faint">已下载 / 进行中 / 失败</p>
          </div>
          <span className="text-cream-faint">→</span>
        </Link>
      )}

      {/* 双 tab + 右侧操作图标 (MusicFree sheets.tsx 模式) */}
      <div className="flex items-end justify-between mb-1">
        <MusicSegmentedTab
          tabs={tabs}
          active={tab}
          onChange={setTab}
          className="!mb-0 flex-1"
        />
        {tab === "playlists" && (
          <button
            type="button"
            onClick={() => void handleNewList()}
            className="ml-2 mb-1 w-8 h-8 flex items-center justify-center rounded-full tap text-cream-dim hover:text-cream"
            style={{
              background: "var(--ink-2)",
              border: "1px solid var(--cream-line)",
            }}
            aria-label="新建歌单"
            title="新建歌单"
          >
            <IconPlus size={14} />
          </button>
        )}
      </div>

      <div className="mt-3">
        {tab === "playlists" && (
          <PlaylistsView playlists={playlists} onNewList={handleNewList} />
        )}
        {tab === "favorites" && (
          <FavoritesView favorites={favorites} playNow={playNow} />
        )}
        {tab === "history" && <HistoryView history={history} playNow={playNow} />}
      </div>
    </div>
  );
}

// ─── tab 内容 ─────────────────────────────────────────

function PlaylistsView({
  playlists,
  onNewList,
}: {
  playlists: Array<{ id: string; name: string; cover?: string; songCount: number }>;
  onNewList: () => Promise<void>;
}) {
  if (playlists.length === 0) {
    return (
      <MusicEmptyState
        icon={<IconMusic size={32} />}
        title="还没有自建歌单"
        subtitle='点击右上 "+" 新建第一个歌单'
        cta={{ label: "新建歌单", onClick: () => void onNewList() }}
      />
    );
  }
  return (
    <ul className="space-y-1.5">
      {playlists.map((p) => (
        <li key={p.id}>
          <Link
            to={`/music/my-playlist/${encodeURIComponent(p.id)}`}
            className="w-full flex items-center gap-3 p-2 rounded-lg tap"
            style={{
              background: "var(--ink-2)",
              border: "1px solid var(--cream-line)",
            }}
          >
            {p.cover ? (
              <img
                src={wrapImage(p.cover)}
                alt=""
                loading="lazy"
                className="w-12 h-12 rounded shrink-0 object-cover"
              />
            ) : (
              <div className="w-12 h-12 rounded shrink-0 flex items-center justify-center bg-ink-3">
                <IconAlbum size={20} className="text-cream-faint" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-display font-semibold line-clamp-1">{p.name}</p>
              <p className="text-[10px] font-mono text-cream-faint mt-0.5">
                {p.songCount} 首
              </p>
            </div>
            <span className="text-cream-faint">→</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function FavoritesView({
  favorites,
  playNow,
}: {
  favorites: ReturnType<typeof useMusicStore.getState>["favorites"];
  playNow: (s: import("@/lib/music/types").MusicSong) => Promise<void>;
}) {
  if (favorites.length === 0) {
    return (
      <MusicEmptyState
        icon={<IconHeart size={32} />}
        title="还没有收藏的歌曲"
        subtitle="在搜索 / 榜单 / 歌单中点心形即可收藏"
        cta={{ label: "去搜索", to: "/music/search" }}
      />
    );
  }
  // 收藏列表头部：查看全部按钮 + 倒序展示前 12 首
  const sorted = [...favorites]
    .sort((a, b) => (b.favoritedAt ?? 0) - (a.favoritedAt ?? 0))
    .slice(0, 12);
  return (
    <>
      <ul className="space-y-1.5 mb-3">
        {sorted.map((f) => (
          <li key={`${f.source}-${f.songId}`}>
            <MusicListItem
              song={f}
              duration={formatDuration(f.durationSec)}
              onClick={() => void playNow(f)}
            />
          </li>
        ))}
      </ul>
      {favorites.length > 12 && (
        <Link
          to="/music/favorites"
          className="block text-center py-2 rounded-lg text-[11px] font-mono tap text-ember"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
        >
          查看全部 {favorites.length} 首 →
        </Link>
      )}
    </>
  );
}

function HistoryView({
  history,
  playNow,
}: {
  history: ReturnType<typeof useMusicStore.getState>["history"];
  playNow: (s: import("@/lib/music/types").MusicSong) => Promise<void>;
}) {
  if (history.length === 0) {
    return (
      <MusicEmptyState
        icon={<IconHistoryClock size={32} />}
        title="还没有播放记录"
        subtitle="开始听一首歌就有了"
      />
    );
  }
  const top = history.slice(0, 12);
  return (
    <>
      <ul className="space-y-1.5 mb-3">
        {top.map((h) => (
          <li key={`${h.source}-${h.songId}`}>
            <MusicListItem
              song={h}
              duration={formatDuration(h.durationSec)}
              onClick={() => void playNow(h)}
              trailing={
                <span className="font-mono text-[9px] text-cream-faint shrink-0 mr-1">
                  ×{h.playCount}
                </span>
              }
            />
          </li>
        ))}
      </ul>
      {history.length > 12 && (
        <Link
          to="/music/history"
          className="block text-center py-2 rounded-lg text-[11px] font-mono tap text-ember"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
        >
          查看全部 {history.length} 首 →
        </Link>
      )}
    </>
  );
}
