/**
 * 音乐主页 —— 4 action tile + 平台 chip + 榜单 + 最近播放。
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMusicStore } from "@/stores/music";
import { getActiveBackendInfo, getToplists } from "@/lib/music/api";
import { hasMusicBackend } from "@/lib/music/config";
import {
  MUSIC_SOURCES,
  type MusicSource,
  type MusicToplist,
} from "@/lib/music/types";
import { wrapImage } from "@/lib/proxy";
import {
  IconAlbum,
  IconFire,
  IconHeart,
  IconHistoryClock,
  IconMusic,
  IconSearch,
} from "@/components/Icon";

export default function MusicHome() {
  const navigate = useNavigate();
  const store = useMusicStore();
  const hydrate = useMusicStore((s) => s.hydrate);

  const [platform, setPlatform] = useState<MusicSource>("wy");
  const [toplists, setToplists] = useState<MusicToplist[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (store.hydrated) setPlatform(store.defaultPlatform);
  }, [store.hydrated, store.defaultPlatform]);

  const loadToplists = useCallback(async () => {
    if (!hasMusicBackend()) return;
    const info = getActiveBackendInfo();
    if (!info?.capabilities.toplists) {
      setToplists([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const t = await getToplists(platform);
      setToplists(t);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [platform]);

  useEffect(() => {
    if (!store.hydrated) return;
    void loadToplists();
  }, [store.hydrated, loadToplists]);

  if (!store.hydrated) return null;

  if (!hasMusicBackend()) {
    return (
      <div className="min-h-screen bg-ink text-cream p-4">
        <div className="mb-5">
          <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
            MUSIC · NOT CONFIGURED
          </p>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">音乐</h1>
        </div>
        <div
          className="rounded-xl p-5 text-center"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
        >
          <IconMusic size={36} className="text-cream-faint mx-auto mb-3" />
          <p className="text-sm font-display font-semibold mb-1">未配置音乐后端</p>
          <p className="text-[11px] text-cream-faint mb-4 leading-relaxed">
            内置音乐源默认已开启，仍提示此问题请去设置页添加 backend
          </p>
          <Link
            to="/settings/music"
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
    <div className="min-h-screen bg-ink text-cream p-4 pb-24">
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
            MUSIC · BROWSE
          </p>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">音乐</h1>
        </div>
        <button
          type="button"
          onClick={() => navigate("/music/search")}
          className="w-9 h-9 flex items-center justify-center rounded-full tap text-cream"
          style={{ background: "var(--ink-2)", border: "1px solid var(--cream-line)" }}
          aria-label="搜索"
        >
          <IconSearch size={16} />
        </button>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-4 gap-2 mb-5">
        <ActionTile
          to="/music/library"
          icon={<IconHeart size={16} />}
          label="我的音乐"
        />
        <ActionTile
          to="/music/recommend"
          icon={<IconFire size={16} />}
          label="推荐"
        />
        <ActionTile
          to="/music/history"
          icon={<IconHistoryClock size={16} />}
          label="历史"
        />
        <ActionTile to="/music/favorites" icon={<IconAlbum size={16} />} label="收藏" />
      </div>

      {/* 平台 chip — 横向 scroll，扩容友好 */}
      <div className="flex gap-1 overflow-x-auto no-scrollbar pb-1 mb-4">
        {MUSIC_SOURCES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setPlatform(s.id as MusicSource)}
            className="shrink-0 px-3 py-1.5 rounded-md text-[11px] font-display font-semibold tap"
            style={{
              background: platform === s.id ? "var(--ember)" : "var(--ink-3)",
              color: platform === s.id ? "var(--ink)" : "var(--cream-dim)",
              border: "1px solid var(--cream-line)",
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* 榜单 */}
      <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-3">
        TOPLISTS · {toplists.length}
      </p>
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
      ) : toplists.length === 0 ? (
        <p className="text-[11px] text-cream-faint text-center py-4">
          当前后端 / 平台 暂无榜单数据
        </p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {toplists.map((t) => {
            const img = wrapImage(t.cover);
            return (
              <Link
                key={t.id}
                to={`/music/playlist/${encodeURIComponent(platform)}/${encodeURIComponent(t.id)}?toplist=1`}
                className="rounded-lg overflow-hidden tap"
                style={{
                  background: "var(--ink-2)",
                  border: "1px solid var(--cream-line)",
                }}
              >
                {img ? (
                  <img
                    src={img}
                    alt={t.name}
                    loading="lazy"
                    className="w-full aspect-square object-cover"
                  />
                ) : (
                  <div className="w-full aspect-square flex items-center justify-center bg-ink-3">
                    <IconMusic size={32} className="text-cream-faint" />
                  </div>
                )}
                <div className="p-2">
                  <p className="text-xs font-display font-semibold line-clamp-1">
                    {t.name}
                  </p>
                  {t.updateFrequency && (
                    <p className="text-[10px] font-mono text-cream-faint mt-0.5 line-clamp-1">
                      {t.updateFrequency}
                    </p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* 最近播放 */}
      {store.history.length > 0 && (
        <>
          <div className="flex items-center justify-between mt-6 mb-3">
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
              RECENT · {store.history.length}
            </p>
            <Link to="/music/history" className="text-[10px] text-ember font-mono">
              查看全部 →
            </Link>
          </div>
          <ul className="space-y-1.5">
            {store.history.slice(0, 10).map((h) => (
              <li key={`${h.source}-${h.songId}`}>
                <button
                  type="button"
                  onClick={() => void store.playNow(h)}
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
                      <IconMusic size={16} className="text-cream-faint" />
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
                  <span className="font-mono text-[10px] text-cream-faint">
                    ×{h.playCount}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
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
      className="rounded-lg p-2.5 flex flex-col items-center justify-center tap aspect-square"
      style={{
        background: "var(--ink-2)",
        border: "1px solid var(--cream-line)",
      }}
    >
      <span className="text-ember mb-1">{icon}</span>
      <span className="text-[10px] font-display font-semibold">{label}</span>
    </Link>
  );
}
