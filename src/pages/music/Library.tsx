/**
 * 我的音乐 — 收藏 / 歌单 / 历史 / 推荐 的入口聚合页。
 *
 * 仿 MusicFree home/operations.tsx，但走 CRT 美学（chip + 网格 + signal-bars 占位）。
 */
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useMusicStore } from "@/stores/music";
import { wrapImage } from "@/lib/proxy";
import {
  IconAlbum,
  IconDownload,
  IconFire,
  IconHeart,
  IconHistoryClock,
  IconMusic,
  IconPlus,
} from "@/components/Icon";
import { isDesktop } from "@/lib/platform";

export default function MusicLibrary() {
  const hydrate = useMusicStore((s) => s.hydrate);
  const favorites = useMusicStore((s) => s.favorites);
  const history = useMusicStore((s) => s.history);
  const playlists = useMusicStore((s) => s.playlists);
  const createPlaylist = useMusicStore((s) => s.createPlaylist);
  const playNow = useMusicStore((s) => s.playNow);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const handleNewList = async () => {
    const name = window.prompt("新建歌单名称");
    if (!name?.trim()) return;
    await createPlaylist(name.trim());
  };

  return (
    <div className="min-h-screen bg-ink text-cream p-4 pb-24">
      <div className="mb-5">
        <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
          MUSIC · LIBRARY
        </p>
        <h1 className="font-display text-2xl font-extrabold tracking-tight">我的音乐</h1>
      </div>

      {/* 4 action tiles */}
      <div className="grid grid-cols-4 gap-2 mb-6">
        <ActionTile to="/music/favorites" icon={<IconHeart size={18} />} label="收藏" />
        <ActionTile
          to="/music/history"
          icon={<IconHistoryClock size={18} />}
          label="历史"
        />
        <ActionTile
          to="/music/recommend"
          icon={<IconFire size={18} />}
          label="推荐"
        />
        <ActionTile to="/music" icon={<IconAlbum size={18} />} label="榜单" />
      </div>

      {/* 桌面专属：下载管理入口 */}
      {isDesktop() && (
        <Link
          to="/music/downloads"
          className="flex items-center gap-3 p-3 mb-6 rounded-lg tap"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
        >
          <span
            className="w-9 h-9 rounded flex items-center justify-center"
            style={{ background: "var(--ink-3)", color: "var(--ember)" }}
          >
            <IconDownload size={16} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-display font-semibold">下载管理</p>
            <p className="text-[10px] text-cream-faint">已下载 / 进行中 / 失败</p>
          </div>
          <span className="text-cream-faint">→</span>
        </Link>
      )}

      {/* 我喜欢的音乐预览 */}
      {favorites.length > 0 && (
        <section className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
              FAVORITES · {favorites.length}
            </p>
            <Link to="/music/favorites" className="text-[10px] text-ember font-mono">
              查看全部 →
            </Link>
          </div>
          <ul className="space-y-1.5">
            {favorites.slice(0, 5).map((f) => (
              <li key={`${f.source}-${f.songId}`}>
                <button
                  type="button"
                  onClick={() => void playNow(f)}
                  className="w-full flex items-center gap-3 p-2 rounded-lg tap text-left"
                  style={{
                    background: "var(--ink-2)",
                    border: "1px solid var(--cream-line)",
                  }}
                >
                  {f.cover ? (
                    <img
                      src={wrapImage(f.cover)}
                      alt=""
                      loading="lazy"
                      className="w-10 h-10 rounded shrink-0 object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded shrink-0 flex items-center justify-center bg-ink-3">
                      <IconMusic size={14} className="text-cream-faint" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-display font-semibold line-clamp-1">
                      {f.name}
                    </p>
                    <p className="text-[10px] font-mono text-cream-faint line-clamp-1">
                      {f.artist || "—"}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 最近播放 */}
      {history.length > 0 && (
        <section className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
              RECENT · {history.length}
            </p>
            <Link to="/music/history" className="text-[10px] text-ember font-mono">
              查看全部 →
            </Link>
          </div>
          <ul className="space-y-1.5">
            {history.slice(0, 5).map((h) => (
              <li key={`${h.source}-${h.songId}`}>
                <button
                  type="button"
                  onClick={() => void playNow(h)}
                  className="w-full flex items-center gap-3 p-2 rounded-lg tap text-left"
                  style={{
                    background: "var(--ink-2)",
                    border: "1px solid var(--cream-line)",
                  }}
                >
                  {h.cover ? (
                    <img
                      src={wrapImage(h.cover)}
                      alt=""
                      loading="lazy"
                      className="w-10 h-10 rounded shrink-0 object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded shrink-0 flex items-center justify-center bg-ink-3">
                      <IconMusic size={14} className="text-cream-faint" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-display font-semibold line-clamp-1">
                      {h.name}
                    </p>
                    <p className="text-[10px] font-mono text-cream-faint line-clamp-1">
                      {h.artist || "—"}
                    </p>
                  </div>
                  <span className="font-mono text-[9px] text-cream-faint">
                    ×{h.playCount}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 自建歌单 */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
            MY PLAYLISTS · {playlists.length}
          </p>
          <button
            type="button"
            onClick={() => void handleNewList()}
            className="text-[10px] text-ember font-mono tap"
          >
            + 新建
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void handleNewList()}
            className="rounded-lg p-4 flex flex-col items-center justify-center tap aspect-square"
            style={{
              background: "var(--ink-2)",
              border: "1px dashed var(--cream-line)",
            }}
          >
            <IconPlus size={20} className="text-cream-faint mb-1" />
            <span className="text-[10px] font-mono text-cream-faint">新建歌单</span>
          </button>
          {playlists.map((p) => (
            <Link
              key={p.id}
              to={`/music/my-playlist/${encodeURIComponent(p.id)}`}
              className="rounded-lg overflow-hidden tap"
              style={{
                background: "var(--ink-2)",
                border: "1px solid var(--cream-line)",
              }}
            >
              <div className="aspect-square flex items-center justify-center bg-ink-3">
                {p.cover ? (
                  <img
                    src={wrapImage(p.cover)}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <IconMusic size={32} className="text-cream-faint" />
                )}
              </div>
              <div className="p-2">
                <p className="text-xs font-display font-semibold line-clamp-1">{p.name}</p>
                <p className="text-[10px] font-mono text-cream-faint">
                  {p.songCount} 首
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function ActionTile({
  to,
  icon,
  label,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="rounded-lg p-3 flex flex-col items-center justify-center tap aspect-square"
      style={{
        background: "var(--ink-2)",
        border: "1px solid var(--cream-line)",
      }}
    >
      <span className="text-ember mb-1.5">{icon}</span>
      <span className="text-[11px] font-display font-semibold">{label}</span>
    </Link>
  );
}
