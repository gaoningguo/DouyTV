/**
 * 网络直播面板 —— 嵌入 /live 页面的 "网络直播" tab。
 *
 * 流程：选平台 → 拉推荐列表 → 点房间 → adapter.resolve() → VideoPlayer 播放
 * 复用既有 VideoPlayer + MediaItem 接口，所以直播代理 / 弹幕 / 截屏 全套都跟着上。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNetLiveStore } from "@/stores/netlive";
import { getAdapter, listSupportedPlatforms } from "@/lib/netlive/registry";
import {
  NETLIVE_PLATFORMS,
  type NetLiveCategory,
  type NetLivePlatformId,
  type NetLiveRoom,
  type NetLiveStream,
} from "@/lib/netlive/types";
import { createDouyuDanmaku } from "@/lib/netlive/danmaku/douyu";
import type { DanmakuClient, DanmakuMessage } from "@/lib/netlive/danmaku/types";
import VideoPlayer from "@/components/VideoPlayer";
import type { MediaItem } from "@/types/media";
import { IconHeart, IconHeartFill, IconRefresh, IconLive } from "@/components/Icon";

const DANMAKU_MAX = 120;

export default function NetworkLivePanel() {
  const activePlatform = useNetLiveStore((s) => s.activePlatform);
  const favorites = useNetLiveStore((s) => s.favorites);
  const setActivePlatform = useNetLiveStore((s) => s.setActivePlatform);
  const toggleFavorite = useNetLiveStore((s) => s.toggleFavorite);
  const isFavorite = useNetLiveStore((s) => s.isFavorite);
  const hydrate = useNetLiveStore((s) => s.hydrate);

  const [list, setList] = useState<NetLiveRoom[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<NetLiveStream | null>(null);
  const [activeRoom, setActiveRoom] = useState<NetLiveRoom | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [danmaku, setDanmaku] = useState<DanmakuMessage[]>([]);
  const [danmakuStatus, setDanmakuStatus] = useState<string>("");
  const [danmakuOn, setDanmakuOn] = useState(true);
  const danmakuClientRef = useRef<DanmakuClient | null>(null);
  const [categories, setCategories] = useState<NetLiveCategory[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null); // null = 推荐
  const [switchingQn, setSwitchingQn] = useState(false);

  const supported = useMemo(() => listSupportedPlatforms(), []);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const loadList = useCallback(
    async (
      platform: NetLivePlatformId,
      p: number,
      append: boolean,
      categoryId: string | null
    ) => {
      setLoading(true);
      setError(null);
      try {
        const adapter = getAdapter(platform);
        const res =
          categoryId && adapter.getCategoryRooms
            ? await adapter.getCategoryRooms(categoryId, p)
            : await adapter.getRecommend(p, 30);
        setList((prev) => (append ? [...prev, ...res.list] : res.list));
      } catch (e) {
        setError((e as Error).message ?? String(e));
        if (!append) setList([]);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // 切平台时拉分类树（异步），同时拉默认推荐
  useEffect(() => {
    setActiveCategory(null);
    setPage(1);
    setCategories([]);
    void loadList(activePlatform, 1, false, null);
    const adapter = (() => {
      try {
        return getAdapter(activePlatform);
      } catch {
        return null;
      }
    })();
    if (!adapter?.getCategories) return;
    let cancelled = false;
    adapter
      .getCategories()
      .then((cats) => {
        if (!cancelled) setCategories(cats);
      })
      .catch((e) => {
        console.warn("[netlive] categories failed", e);
      });
    return () => {
      cancelled = true;
    };
  }, [activePlatform, loadList]);

  // 切分类时重新拉第一页
  useEffect(() => {
    setPage(1);
    void loadList(activePlatform, 1, false, activeCategory);
    // activePlatform 变化时由上面的 effect 处理，这里不再触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory]);

  const playRoom = useCallback(async (room: NetLiveRoom) => {
    setResolvingId(`${room.platform}:${room.roomId}`);
    setError(null);
    try {
      const stream = await getAdapter(room.platform).resolve(room.roomId);
      setResolved(stream);
      setActiveRoom(room);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setResolvingId(null);
    }
  }, []);

  // 弹幕：activeRoom 变化时启停 WS。目前仅 douyu 实现，其他平台后续接入。
  useEffect(() => {
    danmakuClientRef.current?.stop();
    danmakuClientRef.current = null;
    setDanmaku([]);
    setDanmakuStatus("");
    if (!activeRoom || !danmakuOn) return;
    if (activeRoom.platform !== "douyu") return;
    const client = createDouyuDanmaku(activeRoom.roomId, {
      onMessage: (msg) => {
        setDanmaku((prev) => {
          const next = prev.length >= DANMAKU_MAX ? prev.slice(-DANMAKU_MAX + 1) : prev;
          return [...next, msg];
        });
      },
      onReady: () => setDanmakuStatus("已连接"),
      onClose: (reason) => setDanmakuStatus(reason),
    });
    danmakuClientRef.current = client;
    setDanmakuStatus("连接中…");
    client.start();
    return () => {
      client.stop();
    };
  }, [activeRoom, danmakuOn]);

  const switchQuality = useCallback(
    async (qn: string, fallbackUrl: string) => {
      if (!activeRoom || !resolved) return;
      // 如果 alternative 已经带可播 URL 直接换
      if (fallbackUrl) {
        setResolved({ ...resolved, url: fallbackUrl, qn });
        return;
      }
      // 否则 fall back 到再 resolve 一次（多数 adapter 在 resolve 里返回所有清晰度的 URL，所以这条路径很少走）
      setSwitchingQn(true);
      try {
        const fresh = await getAdapter(activeRoom.platform).resolve(
          activeRoom.roomId
        );
        const match = fresh.alternatives?.find((a) => a.qn === qn);
        const url = match?.url || fresh.url;
        setResolved({ ...fresh, url, qn });
      } catch (e) {
        setError((e as Error).message ?? String(e));
      } finally {
        setSwitchingQn(false);
      }
    },
    [activeRoom, resolved]
  );

  const mediaItem = useMemo<MediaItem | undefined>(() => {
    if (!resolved || !activeRoom) return undefined;
    const headers: Record<string, string> = {};
    if (resolved.ua) headers["User-Agent"] = resolved.ua;
    if (resolved.referer) headers["Referer"] = resolved.referer;
    return {
      id: `netlive:${activeRoom.platform}:${activeRoom.roomId}`,
      kind: "live",
      title: activeRoom.title,
      url: resolved.url,
      streamType: resolved.streamType ?? "hls",
      poster: activeRoom.cover,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
    };
  }, [resolved, activeRoom]);

  return (
    <div className="flex flex-col lg:flex-row gap-3 p-3">
      {/* 左：列表 */}
      <div className="flex-1 min-w-0">
        {/* 平台 tabs */}
        <div className="flex items-center gap-2 mb-3 overflow-x-auto">
          {NETLIVE_PLATFORMS.map((p) => {
            const enabled = supported.includes(p.id);
            const active = activePlatform === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => enabled && setActivePlatform(p.id)}
                disabled={!enabled}
                className="px-3 py-1.5 rounded-full text-[11px] font-display font-semibold whitespace-nowrap tap disabled:opacity-40"
                style={{
                  background: active ? "var(--ember-soft)" : "var(--ink-2)",
                  border: `1px solid ${
                    active ? "rgba(255,107,53,0.5)" : "var(--cream-line)"
                  }`,
                  color: active ? "var(--ember)" : "var(--cream-dim)",
                }}
              >
                {p.label}
                {!enabled && " · 即将支持"}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              setPage(1);
              void loadList(activePlatform, 1, false, activeCategory);
            }}
            disabled={loading}
            className="ml-auto px-3 py-1.5 rounded-full text-[11px] tap text-cream-faint hover:text-cream disabled:opacity-50"
            style={{
              background: "var(--ink-2)",
              border: "1px solid var(--cream-line)",
            }}
            title="刷新"
          >
            <IconRefresh size={12} className="inline mr-1" />
            刷新
          </button>
        </div>

        {/* 分类导航 */}
        {categories.length > 0 && (
          <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className="px-2.5 py-1 rounded-full text-[10px] font-mono tap whitespace-nowrap"
              style={{
                background:
                  activeCategory === null ? "var(--ember-soft)" : "var(--ink-2)",
                border: `1px solid ${
                  activeCategory === null
                    ? "rgba(255,107,53,0.5)"
                    : "var(--cream-line)"
                }`,
                color:
                  activeCategory === null
                    ? "var(--ember)"
                    : "var(--cream-faint)",
              }}
            >
              推荐
            </button>
            {categories.slice(0, 60).map((c) => {
              const active = activeCategory === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setActiveCategory(c.id)}
                  className="px-2.5 py-1 rounded-full text-[10px] font-mono tap whitespace-nowrap"
                  style={{
                    background: active ? "var(--ember-soft)" : "var(--ink-2)",
                    border: `1px solid ${
                      active ? "rgba(255,107,53,0.5)" : "var(--cream-line)"
                    }`,
                    color: active ? "var(--ember)" : "var(--cream-faint)",
                  }}
                  title={c.parent ? `${c.parent} · ${c.name}` : c.name}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
        )}

        {error && (
          <p
            className="p-2 rounded text-[11px] font-mono mb-3"
            style={{
              background: "rgba(255,80,80,0.08)",
              color: "#FF6B6B",
              border: "1px solid rgba(255,80,80,0.25)",
            }}
          >
            ✗ {error}
          </p>
        )}

        {/* 房间 grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
          {list.map((room) => (
            <RoomCard
              key={`${room.platform}:${room.roomId}`}
              room={room}
              active={
                activeRoom?.platform === room.platform &&
                activeRoom?.roomId === room.roomId
              }
              resolving={resolvingId === `${room.platform}:${room.roomId}`}
              fav={isFavorite(room.platform, room.roomId)}
              onSelect={() => void playRoom(room)}
              onFavToggle={() => toggleFavorite(room)}
            />
          ))}
        </div>

        {list.length > 0 && (
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={() => {
                const np = page + 1;
                setPage(np);
                void loadList(activePlatform, np, true, activeCategory);
              }}
              disabled={loading}
              className="px-4 py-2 rounded-lg text-[11px] font-display font-semibold tap text-cream disabled:opacity-50"
              style={{
                background: "var(--ink-2)",
                border: "1px solid var(--cream-line)",
              }}
            >
              {loading ? "加载中…" : "加载更多"}
            </button>
          </div>
        )}

        {!loading && list.length === 0 && !error && (
          <div className="text-center text-cream-faint text-sm py-8">
            <IconLive size={36} className="inline mb-2 opacity-40" />
            <p>暂无直播间</p>
          </div>
        )}

        {/* 收藏 */}
        {favorites.length > 0 && (
          <div className="mt-6">
            <p className="font-mono text-[10px] tracking-[0.2em] text-cream-faint mb-2">
              MY FAVORITES
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
              {favorites.map((room) => (
                <RoomCard
                  key={`fav:${room.platform}:${room.roomId}`}
                  room={room}
                  active={
                    activeRoom?.platform === room.platform &&
                    activeRoom?.roomId === room.roomId
                  }
                  resolving={
                    resolvingId === `${room.platform}:${room.roomId}`
                  }
                  fav
                  onSelect={() => void playRoom(room)}
                  onFavToggle={() => toggleFavorite(room)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 右：播放器（桌面端固定侧栏，移动端浮在上方） */}
      <div className="lg:w-[420px] lg:shrink-0">
        <div
          className="aspect-video rounded-xl overflow-hidden"
          style={{
            background: "var(--ink-3)",
            border: "1px solid var(--cream-line)",
          }}
        >
          {mediaItem ? (
            <VideoPlayer item={mediaItem} active controls />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-cream-faint text-xs">
              选择一个直播间开始观看
            </div>
          )}
        </div>
        {activeRoom && (
          <div className="mt-2">
            <p className="font-display font-bold text-sm line-clamp-2">
              {activeRoom.title}
            </p>
            <p className="font-mono text-[11px] text-cream-faint mt-1">
              {activeRoom.uname ?? "—"} · {activeRoom.category ?? ""}
            </p>
          </div>
        )}

        {/* 清晰度切换 */}
        {resolved?.alternatives && resolved.alternatives.length > 1 && (
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            {resolved.alternatives.map((alt) => {
              const active = resolved.qn === alt.qn;
              return (
                <button
                  key={alt.qn}
                  type="button"
                  disabled={switchingQn || active}
                  onClick={() => void switchQuality(alt.qn, alt.url)}
                  className="px-2 py-0.5 rounded text-[10px] font-mono tap disabled:opacity-60"
                  style={{
                    background: active ? "var(--ember-soft)" : "var(--ink-3)",
                    border: `1px solid ${
                      active ? "rgba(255,107,53,0.5)" : "var(--cream-line)"
                    }`,
                    color: active ? "var(--ember)" : "var(--cream-faint)",
                  }}
                  title={`bitrate ${alt.qn}`}
                >
                  {alt.label || alt.qn}
                </button>
              );
            })}
            {switchingQn && (
              <span className="font-mono text-[10px] text-cream-faint">
                切换中…
              </span>
            )}
          </div>
        )}

        {activeRoom && activeRoom.platform === "douyu" && (
          <DanmakuPane
            messages={danmaku}
            status={danmakuStatus}
            on={danmakuOn}
            onToggle={() => setDanmakuOn((v) => !v)}
            onClear={() => setDanmaku([])}
          />
        )}
      </div>
    </div>
  );
}

function RoomCard({
  room,
  active,
  resolving,
  fav,
  onSelect,
  onFavToggle,
}: {
  room: NetLiveRoom;
  active: boolean;
  resolving: boolean;
  fav: boolean;
  onSelect: () => void;
  onFavToggle: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className="rounded-lg overflow-hidden tap cursor-pointer relative"
      style={{
        background: "var(--ink-2)",
        border: `1px solid ${
          active ? "rgba(255,107,53,0.5)" : "var(--cream-line)"
        }`,
      }}
    >
      <div
        className="aspect-video bg-cover bg-center"
        style={{
          backgroundImage: room.cover
            ? `url(${room.cover.replace("http://", "https://")})`
            : undefined,
          background: !room.cover ? "var(--ink-3)" : undefined,
        }}
      >
        {resolving && (
          <div className="w-full h-full flex items-center justify-center backdrop-blur-sm bg-black/40">
            <span className="font-mono text-[10px] text-ember tracking-wider">
              RESOLVING…
            </span>
          </div>
        )}
        {!resolving && room.live && (
          <span
            className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold tracking-wider"
            style={{
              background: "var(--ember)",
              color: "var(--ink)",
            }}
          >
            ● LIVE
          </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onFavToggle();
          }}
          className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full flex items-center justify-center tap"
          style={{
            background: "rgba(0,0,0,0.5)",
            color: fav ? "var(--ember)" : "var(--cream)",
          }}
        >
          {fav ? <IconHeartFill size={14} /> : <IconHeart size={14} />}
        </button>
      </div>
      <div className="p-2">
        <p className="text-[11px] font-display font-semibold line-clamp-1 text-cream">
          {room.title}
        </p>
        <p className="text-[10px] font-mono text-cream-faint line-clamp-1 mt-0.5">
          {room.uname ?? "—"}
          {room.online ? ` · ${formatOnline(room.online)}` : ""}
        </p>
      </div>
    </div>
  );
}

function formatOnline(n: number): string {
  if (n >= 100_0000) return `${(n / 100_0000).toFixed(1)}千万`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function DanmakuPane({
  messages,
  status,
  on,
  onToggle,
  onClear,
}: {
  messages: DanmakuMessage[];
  status: string;
  on: boolean;
  onToggle: () => void;
  onClear: () => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  // 新弹幕自动滚到底
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);
  return (
    <div
      className="mt-3 rounded-lg overflow-hidden flex flex-col"
      style={{
        background: "var(--ink-2)",
        border: "1px solid var(--cream-line)",
        height: 280,
      }}
    >
      <div
        className="flex items-center justify-between px-2.5 py-1.5"
        style={{ borderBottom: "1px solid var(--cream-line)" }}
      >
        <div className="flex items-center gap-2">
          <span
            className="font-mono text-[10px] tracking-[0.2em]"
            style={{ color: on ? "var(--ember)" : "var(--cream-faint)" }}
          >
            DANMAKU
          </span>
          {status && (
            <span className="font-mono text-[9px] text-cream-faint">
              · {status}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onClear}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono tap text-cream-faint hover:text-cream"
            style={{ background: "var(--ink-3)" }}
          >
            清空
          </button>
          <button
            type="button"
            onClick={onToggle}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono tap"
            style={{
              background: on ? "var(--ember-soft)" : "var(--ink-3)",
              color: on ? "var(--ember)" : "var(--cream-faint)",
            }}
          >
            {on ? "ON" : "OFF"}
          </button>
        </div>
      </div>
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto px-2.5 py-1.5 space-y-1"
      >
        {messages.length === 0 ? (
          <p className="font-mono text-[10px] text-cream-faint text-center py-4">
            等待弹幕…
          </p>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className="text-[11px] font-mono leading-snug break-words"
            >
              <span className="text-cream-faint mr-1.5">
                {m.uname}:
              </span>
              <span style={{ color: m.color ?? "var(--cream)" }}>
                {m.text}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
