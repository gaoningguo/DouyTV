/**
 * 音乐主页 —— 参考 MusicFree home/operations + lx-music 排行榜 grid。
 *
 * 结构：eyebrow header → 4 action tile (1×4 mobile, 4 col desktop)
 * → 平台 chip 横滑 → 榜单 grid → 推荐预览 (capability) → 最近播放。
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMusicStore } from "@/stores/music";
import {
  getActiveBackendInfo,
  getRecommendSheetTags,
  getToplists,
} from "@/lib/music/api";
import { hasMusicBackend } from "@/lib/music/config";
import {
  MUSIC_SOURCES,
  type IRecommendSheetTag,
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
import { MusicChip } from "@/components/MusicChip";
import { MusicListItem } from "@/components/MusicListItem";
import { MusicEmptyState } from "@/components/MusicEmptyState";

function formatDuration(sec?: number) {
  if (!sec || !Number.isFinite(sec)) return undefined;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function MusicHome() {
  const navigate = useNavigate();
  const store = useMusicStore();
  const hydrate = useMusicStore((s) => s.hydrate);

  const [platform, setPlatform] = useState<MusicSource>("wy");
  const [toplists, setToplists] = useState<MusicToplist[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pinned, setPinned] = useState<IRecommendSheetTag[]>([]);

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

  // pinned 推荐 tag —— capability gated，作为榜单的备选 chip 行
  useEffect(() => {
    const info = getActiveBackendInfo();
    if (!info?.capabilities.recommendSheets) {
      setPinned([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const r = await getRecommendSheetTags();
        if (!cancelled) setPinned(r.pinned.slice(0, 8));
      } catch {
        if (!cancelled) setPinned([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store.activeBackendId]);

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
        <MusicEmptyState
          icon={<IconMusic size={36} />}
          title="未配置音乐后端"
          subtitle="内置音乐源默认已开启，仍提示此问题请去设置页添加 backend"
          cta={{ label: "前往设置", to: "/settings/music" }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink text-cream p-4 pb-24">
      {/* 顶部 hero */}
      <div className="flex items-end justify-between mb-5">
        <div>
          <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
            MUSIC · BROWSE
          </p>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">音乐</h1>
        </div>
        <button
          type="button"
          onClick={() => navigate("/music/search")}
          className="w-10 h-10 flex items-center justify-center rounded-full tap text-cream"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
          aria-label="搜索"
        >
          <IconSearch size={16} />
        </button>
      </div>

      {/* 4 大入口磁贴 —— MusicFree operations 风格 */}
      <div className="grid grid-cols-4 gap-2.5 mb-6">
        <ActionTile to="/music/library" icon={<IconHeart size={18} />} label="我的音乐" />
        <ActionTile to="/music/recommend" icon={<IconFire size={18} />} label="推荐歌单" />
        <ActionTile to="/music/history" icon={<IconHistoryClock size={18} />} label="历史" />
        <ActionTile to="/music/favorites" icon={<IconAlbum size={18} />} label="收藏" />
      </div>

      {/* 平台 chip 横滑 */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1 mb-5">
        {MUSIC_SOURCES.map((s) => (
          <MusicChip
            key={s.id}
            label={s.label}
            active={platform === s.id}
            onClick={() => setPlatform(s.id as MusicSource)}
          />
        ))}
      </div>

      {/* 推荐 tag pinned —— capability gated */}
      {pinned.length > 0 && (
        <section className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
              <IconFire size={10} className="inline mr-1 text-ember" />
              RECOMMEND · {pinned.length}
            </p>
            <Link to="/music/recommend" className="text-[10px] text-ember font-mono">
              查看全部 →
            </Link>
          </div>
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
            {pinned.map((t) => (
              <MusicChip
                key={t.id}
                label={t.name}
                onClick={() => navigate(`/music/recommend/${encodeURIComponent(t.id)}`)}
              />
            ))}
          </div>
        </section>
      )}

      {/* 榜单 */}
      <section className="mb-6">
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
                  className="rounded-lg overflow-hidden tap transition-transform hover:-translate-y-0.5"
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
      </section>

      {/* 最近播放 */}
      {store.history.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint">
              RECENT · {store.history.length}
            </p>
            <Link to="/music/history" className="text-[10px] text-ember font-mono">
              查看全部 →
            </Link>
          </div>
          <ul className="space-y-1.5">
            {store.history.slice(0, 8).map((h) => (
              <li key={`${h.source}-${h.songId}`}>
                <MusicListItem
                  song={h}
                  duration={formatDuration(h.durationSec)}
                  onClick={() => void store.playNow(h)}
                  trailing={
                    <span className="font-mono text-[9px] text-cream-faint shrink-0 mr-1">
                      ×{h.playCount}
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
        </section>
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
      className="rounded-xl py-3 flex flex-col items-center justify-center tap aspect-square transition-transform hover:-translate-y-0.5"
      style={{
        background: "var(--ink-2)",
        border: "1px solid var(--cream-line)",
      }}
    >
      <span
        className="w-9 h-9 rounded-full flex items-center justify-center mb-1.5"
        style={{ background: "var(--ink-3)", color: "var(--ember)" }}
      >
        {icon}
      </span>
      <span className="text-[10px] font-display font-semibold text-center">
        {label}
      </span>
    </Link>
  );
}
