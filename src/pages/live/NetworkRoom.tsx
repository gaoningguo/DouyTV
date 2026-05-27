/**
 * /live/room/:platform/:roomId —— 单独大屏直播间。
 *
 * 设计：
 *   - 顶栏：返回 + 平台 / 房间标题（透明叠在视频上半，hover 显隐）
 *   - 主区：全宽 16:9 player（高度 min(100vh - 控制条, 100vw * 9/16)）
 *   - 右侧浮层弹幕（lg 起，固定 360px；小屏可 toggle）
 *   - 底部：metadata + ResolutionsRow（清晰度切换）
 *
 * 入口：Network.tsx 房间卡片或 inline 播放器右上的 "全屏" 按钮，
 * 通过 navigate("/live/room/:p/:rid", { state: { room } }) 传入已知元信息，
 * 避免到达后再二次 fetch detail。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { getAdapter } from "@/lib/netlive/registry";
import type {
  NetLivePlatformId,
  NetLiveRoom,
  NetLiveStream,
} from "@/lib/netlive/types";
import { useNetLiveStore } from "@/stores/netlive";
import { createDouyuDanmaku } from "@/lib/netlive/danmaku/douyu";
import type {
  DanmakuClient,
  DanmakuMessage,
} from "@/lib/netlive/danmaku/types";
import VideoPlayer from "@/components/VideoPlayer";
import {
  IconArrowLeft,
  IconHeart,
  IconHeartFill,
  IconStats,
  IconRefresh,
  IconFire,
  IconQuality,
  IconChevronDown,
} from "@/components/Icon";
import type { MediaItem } from "@/types/media";

const DANMAKU_MAX = 200;
const PLATFORM_LABEL: Partial<Record<string, string>> = {
  bilibili: "哔哩哔哩",
  douyu: "斗鱼",
  huya: "虎牙",
  douyin: "抖音",
  kuaishou: "快手",
  cc: "网易 CC",
  twitch: "Twitch",
  youtube: "YouTube",
  kick: "Kick",
  trovo: "Trovo",
  bigo: "Bigo Live",
  live17: "17 Live",
  chaturbate: "Chaturbate",
  stripchat: "Stripchat",
  bongacams: "BongaCams",
  camsoda: "CamSoda",
};

interface LocationState {
  room?: NetLiveRoom;
}

export default function NetworkRoom() {
  const { platform, roomId } = useParams<{
    platform: NetLivePlatformId;
    roomId: string;
  }>();
  const navigate = useNavigate();
  const location = useLocation();
  const passedRoom = (location.state as LocationState | null)?.room;

  const favorites = useNetLiveStore((s) => s.favorites);
  const toggleFavorite = useNetLiveStore((s) => s.toggleFavorite);
  const noteVisit = useNetLiveStore((s) => s.noteVisit);
  const hydrate = useNetLiveStore((s) => s.hydrate);

  const [room, setRoom] = useState<NetLiveRoom | null>(passedRoom ?? null);
  const [stream, setStream] = useState<NetLiveStream | null>(null);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [danmaku, setDanmaku] = useState<DanmakuMessage[]>([]);
  const [danmakuStatus, setDanmakuStatus] = useState<string>("");
  const [danmakuOn, setDanmakuOn] = useState(true);
  const [paneOpen, setPaneOpen] = useState(true);
  const danmakuClientRef = useRef<DanmakuClient | null>(null);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  /* ─────────── 拉流（resolve） ─────────── */
  const resolveStream = useCallback(async () => {
    if (!platform || !roomId) return;
    setLoading(true);
    setError(null);
    try {
      const adapter = await getAdapter(platform);
      const s = await adapter.resolve(roomId);
      setStream(s);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [platform, roomId]);

  /* ─────────── 详情（无 passedRoom 时拉一份） ─────────── */
  const fetchDetail = useCallback(async () => {
    if (!platform || !roomId) return;
    try {
      const adapter = await getAdapter(platform);
      if (adapter.getRoomDetail) {
        const d = await adapter.getRoomDetail(roomId);
        setRoom(d);
        noteVisit(d);
      } else if (!room) {
        // 没 detail 接口也至少留个壳，让 UI 不空
        setRoom({
          platform,
          roomId,
          title: roomId,
          live: true,
        });
      }
    } catch (e) {
      console.warn("[netlive-room] detail failed", e);
    }
  }, [platform, roomId, noteVisit, room]);

  useEffect(() => {
    void resolveStream();
    void fetchDetail();
    // 进房就记录浏览（有 passedRoom 时直接记，detail 拉到后会再记一次覆盖）
    if (passedRoom) noteVisit(passedRoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, roomId]);

  /* ─────────── 弹幕（仅 douyu 已实现） ─────────── */
  useEffect(() => {
    danmakuClientRef.current?.stop();
    danmakuClientRef.current = null;
    setDanmaku([]);
    setDanmakuStatus("");
    if (!room || !danmakuOn) return;
    if (room.platform !== "douyu") return;
    const client = createDouyuDanmaku(room.roomId, {
      onMessage: (msg) => {
        setDanmaku((prev) => {
          const next =
            prev.length >= DANMAKU_MAX ? prev.slice(-DANMAKU_MAX + 1) : prev;
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
  }, [room, danmakuOn]);

  const switchQuality = useCallback(
    async (qn: string, fallbackUrl: string) => {
      if (!stream || !platform || !roomId) return;
      if (fallbackUrl) {
        setStream({ ...stream, url: fallbackUrl, qn });
        return;
      }
      setSwitching(true);
      try {
        const fresh = await (await getAdapter(platform)).resolve(roomId);
        const match = fresh.alternatives?.find((a) => a.qn === qn);
        const url = match?.url || fresh.url;
        setStream({ ...fresh, url, qn });
      } catch (e) {
        setError((e as Error).message ?? String(e));
      } finally {
        setSwitching(false);
      }
    },
    [stream, platform, roomId]
  );

  const mediaItem = useMemo<MediaItem | undefined>(() => {
    if (!stream || !room) return undefined;
    const headers: Record<string, string> = {};
    if (stream.ua) headers["User-Agent"] = stream.ua;
    if (stream.referer) headers["Referer"] = stream.referer;
    return {
      id: `netlive:${room.platform}:${room.roomId}`,
      kind: "live",
      title: room.title,
      url: stream.url,
      streamType: stream.streamType ?? "hls",
      poster: room.cover,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      agora: stream.agora,
    };
  }, [stream, room]);

  const fav = useMemo(
    () =>
      !!platform &&
      !!roomId &&
      favorites.some((r) => r.platform === platform && r.roomId === roomId),
    [favorites, platform, roomId]
  );

  const handleBack = useCallback(() => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/live");
    }
  }, [navigate]);

  // 弹幕计数（导航条 badge）
  const danmakuCount = danmaku.length;

  if (!platform || !roomId) {
    return (
      <div className="h-screen flex items-center justify-center text-cream-faint font-mono">
        参数缺失
      </div>
    );
  }

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden"
      style={{ background: "var(--ink)" }}
    >
      {/* 顶栏 —— 沉浸式，半透明 overlay 在视频上方 */}
      <header
        className="flex items-center gap-3 px-3 py-2 shrink-0 z-10"
        style={{
          background: "rgba(14,15,17,0.92)",
          borderBottom: "1px solid var(--cream-line)",
          paddingTop: "max(env(safe-area-inset-top), 8px)",
          paddingLeft: "calc(env(safe-area-inset-left) + 12px)",
          paddingRight: "calc(env(safe-area-inset-right) + 12px)",
        }}
      >
        <button
          type="button"
          onClick={handleBack}
          className="w-9 h-9 rounded-full flex items-center justify-center tap text-cream-dim hover:text-ember"
          style={{ background: "var(--ink-2)" }}
          aria-label="返回"
        >
          <IconArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-display font-bold text-cream text-sm line-clamp-1">
            {room?.title || "直播间"}
          </p>
          <p className="font-mono text-[11px] text-cream-faint mt-0.5">
            <span className="text-ember">
              {PLATFORM_LABEL[platform] ?? platform}
            </span>
            {" · "}
            {room?.uname ?? "—"}
            {room?.category ? ` · ${room.category}` : ""}
          </p>
        </div>
        {/* 收藏 */}
        {room && (
          <button
            type="button"
            onClick={() => toggleFavorite(room)}
            className="w-9 h-9 rounded-full flex items-center justify-center tap"
            style={{
              background: "var(--ink-2)",
              color: fav ? "var(--ember)" : "var(--cream-dim)",
            }}
            aria-label={fav ? "取消收藏" : "收藏"}
            title={fav ? "取消收藏" : "收藏"}
          >
            {fav ? <IconHeartFill size={14} /> : <IconHeart size={14} />}
          </button>
        )}
        {/* 刷新 / 重拉流 */}
        <button
          type="button"
          onClick={() => void resolveStream()}
          disabled={loading}
          className="w-9 h-9 rounded-full flex items-center justify-center tap text-cream-dim hover:text-ember disabled:opacity-50"
          style={{ background: "var(--ink-2)" }}
          aria-label="刷新"
          title="重新拉流"
        >
          <IconRefresh size={14} />
        </button>
        {/* 弹幕面板 toggle（仅有可显内容时显示） */}
        {room?.platform === "douyu" && (
          <button
            type="button"
            onClick={() => setPaneOpen((v) => !v)}
            className="px-3 h-9 rounded-full flex items-center gap-1.5 tap font-mono text-[11px]"
            style={{
              background: paneOpen ? "var(--ember-soft)" : "var(--ink-2)",
              color: paneOpen ? "var(--ember)" : "var(--cream-dim)",
            }}
            title="弹幕面板"
          >
            <IconStats size={12} />
            <span className="hidden sm:inline">弹幕</span>
            {danmakuCount > 0 && (
              <span className="text-[10px] opacity-70">
                {Math.min(danmakuCount, 999)}
              </span>
            )}
          </button>
        )}
      </header>

      {/* 主体 */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* 主视频区 */}
        <main className="flex-1 min-w-0 min-h-0 flex flex-col">
          <div
            className="relative flex-1 min-h-0"
            style={{ background: "black" }}
          >
            {error && (
              <div className="absolute top-3 left-3 right-3 z-10 p-3 rounded-lg text-[11px] font-mono"
                style={{
                  background: "rgba(255,80,80,0.12)",
                  color: "#FF6B6B",
                  border: "1px solid rgba(255,80,80,0.3)",
                }}
              >
                ✗ {error}
              </div>
            )}
            {mediaItem ? (
              <VideoPlayer item={mediaItem} active controls netlivePlatform={platform} />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-cream-faint font-mono text-[12px]">
                {loading ? (
                  <span className="text-ember animate-pulse tracking-widest">
                    RESOLVING…
                  </span>
                ) : (
                  <span>正在准备拉流…</span>
                )}
              </div>
            )}
          </div>

          {/* 底栏：清晰度 / 在线数 / 简介 */}
          {stream && (
            <ResolutionsRow
              stream={stream}
              online={room?.online}
              switching={switching}
              onSwitch={(qn, url) => void switchQuality(qn, url)}
            />
          )}
          {room?.introduction && (
            <div
              className="py-3 text-[12px] font-mono text-cream-faint leading-relaxed line-clamp-3"
              style={{
                background: "var(--ink-2)",
                borderTop: "1px solid var(--cream-line)",
                paddingLeft: "calc(env(safe-area-inset-left) + 16px)",
                paddingRight: "calc(env(safe-area-inset-right) + 16px)",
              }}
            >
              {room.introduction}
            </div>
          )}
          {/* 底部 safe-area spacer —— iOS Home Indicator 让位 */}
          <div
            aria-hidden
            style={{
              background: "var(--ink-2)",
              height: "env(safe-area-inset-bottom)",
            }}
          />
        </main>

        {/* 弹幕侧栏 */}
        {paneOpen && room?.platform === "douyu" && (
          <aside
            className="lg:w-[360px] lg:shrink-0 lg:border-l border-t lg:border-t-0 flex flex-col h-[40vh] lg:h-auto"
            style={{
              background: "var(--ink-2)",
              borderColor: "var(--cream-line)",
              // 移动端弹幕面板在屏幕底部 → Home Indicator 让位；
              // 桌面右侧面板贴底也要让；横屏刘海让位
              paddingBottom: "env(safe-area-inset-bottom)",
              paddingRight: "env(safe-area-inset-right)",
            }}
          >
            <DanmakuOverlay
              messages={danmaku}
              status={danmakuStatus}
              on={danmakuOn}
              onToggle={() => setDanmakuOn((v) => !v)}
              onClear={() => setDanmaku([])}
            />
          </aside>
        )}
      </div>
    </div>
  );
}

/* ─────────── ResolutionsRow（与 Network.tsx 同结构，独立一份避免互相耦合） ─────────── */
function ResolutionsRow({
  stream,
  online,
  switching,
  onSwitch,
}: {
  stream: NetLiveStream;
  online?: number;
  switching: boolean;
  onSwitch: (qn: string, url: string) => void;
}) {
  const alts = stream.alternatives ?? [];
  return (
    <div
      className="flex items-center justify-between py-2 shrink-0"
      style={{
        background: "var(--ink-2)",
        borderTop: "1px solid var(--cream-line)",
        paddingLeft: "calc(env(safe-area-inset-left) + 16px)",
        paddingRight: "calc(env(safe-area-inset-right) + 16px)",
      }}
    >
      <div className="flex items-center gap-2 text-cream-faint">
        <IconFire size={14} className="text-ember" />
        <span className="font-mono text-[12px]">
          {typeof online === "number" ? formatOnline(online) : "—"}
        </span>
        <span className="font-mono text-[10px] opacity-50 ml-1">人气</span>
      </div>
      <div className="flex items-center gap-2">
        {alts.length > 1 ? (
          <QualityDropdown
            stream={stream}
            switching={switching}
            onSwitch={onSwitch}
          />
        ) : (
          stream.qnLabel && (
            <span className="font-mono text-[12px] text-cream-dim inline-flex items-center gap-1">
              <IconQuality size={13} />
              {stream.qnLabel}
            </span>
          )
        )}
      </div>
    </div>
  );
}

function QualityDropdown({
  stream,
  switching,
  onSwitch,
}: {
  stream: NetLiveStream;
  switching: boolean;
  onSwitch: (qn: string, url: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const alts = stream.alternatives ?? [];
  const current =
    alts.find((a) => a.qn === stream.qn) ?? {
      label: stream.qnLabel ?? "原画",
      qn: stream.qn ?? "",
    };
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={switching}
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-[12px] font-mono tap text-ember disabled:opacity-50"
        style={{
          background: "var(--ember-soft)",
          border: "1px solid rgba(255,107,53,0.3)",
        }}
      >
        <IconQuality size={13} />
        {current.label || current.qn || "原画"}
        <IconChevronDown size={11} />
      </button>
      {open && (
        <div
          className="absolute right-0 bottom-full mb-1 rounded-lg overflow-hidden z-20 min-w-[120px]"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
            boxShadow: "0 6px 24px rgba(0,0,0,0.4)",
          }}
        >
          {alts.map((alt) => {
            const active = alt.qn === stream.qn;
            return (
              <button
                key={alt.qn}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onSwitch(alt.qn, alt.url);
                }}
                className="block w-full text-left px-3 py-2 text-[12px] font-mono tap hover:bg-ink-3"
                style={{
                  color: active ? "var(--ember)" : "var(--cream-dim)",
                  background: active ? "var(--ember-soft)" : "transparent",
                }}
              >
                {alt.label || alt.qn}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DanmakuOverlay({
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
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ borderBottom: "1px solid var(--cream-line)" }}
      >
        <div className="flex items-center gap-2">
          <IconStats
            size={13}
            className={on ? "text-ember" : "text-cream-faint"}
          />
          <span
            className="font-mono text-[11px] tracking-[0.2em]"
            style={{ color: on ? "var(--ember)" : "var(--cream-faint)" }}
          >
            DANMAKU
          </span>
          {status && (
            <span className="font-mono text-[10px] text-cream-faint">
              · {status}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onClear}
            className="px-2 py-0.5 rounded text-[10px] font-mono tap text-cream-faint hover:text-cream"
            style={{ background: "var(--ink-3)" }}
          >
            清空
          </button>
          <button
            type="button"
            onClick={onToggle}
            className="px-2 py-0.5 rounded text-[10px] font-mono tap"
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
        className="flex-1 overflow-y-auto px-3 py-2 space-y-1"
      >
        {messages.length === 0 ? (
          <p className="font-mono text-[11px] text-cream-faint text-center py-6">
            等待弹幕…
          </p>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className="text-[12px] font-mono leading-snug break-words"
            >
              <span className="text-cream-faint mr-1.5">{m.uname}:</span>
              <span style={{ color: m.color ?? "var(--cream)" }}>{m.text}</span>
            </div>
          ))
        )}
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
