/**
 * RoomCard —— 直播间卡片。复刻 pure_live `common/widgets/room_card.dart`：
 *   16:9 cover (img)
 *     + 左上 / 左下 LIVE 角标
 *     + 右上 收藏星 button
 *     + 右下 热度 CountChip
 *   + 下方 ListTile：avatar | title (单行 ellipsis) + nick (单行) | 平台 tag
 *
 * dense=true 用更紧凑的字号 / padding，适合 grid 多列；false 适合详情页大卡。
 *
 * Perf：组件 React.memo 包裹，回调收 (room) → parent 用 useCallback 保持稳定引用，
 * 避免切平台 / hover 时 grid 全量 re-render。
 */
import { memo, useState, type ReactNode } from "react";
import {
  IconFire,
  IconHeart,
  IconHeartFill,
  IconTv,
} from "@/components/Icon";
import { CountChip } from "@/components/CountChip";
import type { NetLiveRoom } from "@/lib/netlive/types";

const PLATFORM_LABEL: Partial<Record<string, string>> = {
  bilibili: "B站",
  douyu: "斗鱼",
  huya: "虎牙",
  douyin: "抖音",
  kuaishou: "快手",
  cc: "CC",
  twitch: "TW",
  youtube: "YT",
  kick: "KK",
  trovo: "TR",
  bigo: "BG",
  live17: "17",
  chaturbate: "CB",
  stripchat: "SC",
  bongacams: "BC",
  camsoda: "CS",
};

export interface RoomCardProps {
  room: NetLiveRoom;
  active?: boolean;
  resolving?: boolean;
  fav?: boolean;
  dense?: boolean;
  /** 回调收 room 实例，parent 可用单一稳定引用；避免每个卡片传内联 lambda */
  onSelect?: (room: NetLiveRoom) => void;
  onFavToggle?: (room: NetLiveRoom) => void;
  /** 自定义角标（例如健康检测红绿点）；放在右上、收藏星左边 */
  badge?: ReactNode;
}

function RoomCardImpl({
  room,
  active = false,
  resolving = false,
  fav = false,
  dense = false,
  onSelect,
  onFavToggle,
  badge,
}: RoomCardProps) {
  const platformTag = PLATFORM_LABEL[room.platform] ?? room.platform.toUpperCase();
  const cover = room.cover?.replace("http://", "https://");
  const [imgLoaded, setImgLoaded] = useState(false);
  return (
    <div
      onClick={onSelect ? () => onSelect(room) : undefined}
      className="rounded-xl overflow-hidden tap cursor-pointer relative flex flex-col group"
      style={{
        background: "var(--ink-2)",
        border: `1px solid ${
          active ? "rgba(255,107,53,0.5)" : "var(--cream-line)"
        }`,
        transition: "transform 120ms ease, border-color 120ms ease",
      }}
    >
      {/* 16:9 cover */}
      <div
        className="relative w-full overflow-hidden"
        style={{ aspectRatio: "16 / 9", background: "var(--ink-3)" }}
      >
        {cover ? (
          <img
            src={cover}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03]"
            style={{
              opacity: imgLoaded ? 1 : 0,
              transition: "opacity 220ms ease, transform 300ms ease",
            }}
            onLoad={() => setImgLoaded(true)}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-cream-faint opacity-40">
            <IconTv size={dense ? 28 : 40} />
          </div>
        )}

        {/* Resolving overlay */}
        {resolving && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/45 backdrop-blur-sm">
            <span className="font-mono text-[10px] text-ember tracking-widest animate-pulse">
              RESOLVING…
            </span>
          </div>
        )}

        {/* 左上 LIVE / 录播 角标 */}
        {!resolving && room.live && !room.isRecord && (
          <CountChip
            background="var(--ember)"
            color="var(--ink)"
            dense
            className="absolute top-1.5 left-1.5 !rounded"
          >
            <span
              className="inline-block w-1 h-1 rounded-full mr-0.5"
              style={{ background: "var(--ink)" }}
            />
            LIVE
          </CountChip>
        )}
        {!resolving && room.isRecord && (
          <CountChip
            background="rgba(80,80,80,0.85)"
            color="white"
            dense
            className="absolute top-1.5 left-1.5 !rounded"
          >
            录播
          </CountChip>
        )}

        {/* 右下 热度 */}
        {!resolving && typeof room.online === "number" && room.online > 0 && (
          <CountChip
            dense
            icon={<IconFire size={10} />}
            className="absolute bottom-1.5 right-1.5"
          >
            {formatOnline(room.online)}
          </CountChip>
        )}

        {/* 右上：自定义 badge + 收藏星 */}
        <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
          {badge}
          {onFavToggle && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onFavToggle(room);
              }}
              className="w-7 h-7 rounded-full flex items-center justify-center tap"
              style={{
                background: "rgba(0,0,0,0.55)",
                color: fav ? "var(--ember)" : "white",
                backdropFilter: "blur(4px)",
                WebkitBackdropFilter: "blur(4px)",
              }}
              aria-label={fav ? "取消收藏" : "收藏"}
            >
              {fav ? <IconHeartFill size={13} /> : <IconHeart size={13} />}
            </button>
          )}
        </div>
      </div>

      {/* ListTile：avatar | title+nick | 平台 tag */}
      <div
        className={`flex items-start gap-2 ${
          dense ? "p-2" : "p-2.5"
        }`}
      >
        <Avatar
          url={room.avatar}
          fallback={room.uname ?? ""}
          dense={dense}
        />
        <div className="flex-1 min-w-0">
          <p
            className={`font-display font-semibold text-cream line-clamp-1 ${
              dense ? "text-[12px]" : "text-[13px]"
            }`}
          >
            {room.title || "（未命名直播间）"}
          </p>
          <p
            className={`font-mono text-cream-faint line-clamp-1 mt-0.5 ${
              dense ? "text-[10px]" : "text-[11px]"
            }`}
          >
            {room.uname ?? "—"}
            {room.category ? ` · ${room.category}` : ""}
          </p>
        </div>
        {!dense && (
          <span
            className="font-mono text-[9px] font-bold text-cream-faint shrink-0 mt-0.5 tracking-wider"
            style={{ letterSpacing: "0.05em" }}
          >
            {platformTag}
          </span>
        )}
      </div>
    </div>
  );
}

export const RoomCard = memo(RoomCardImpl);

function Avatar({
  url,
  fallback,
  dense,
}: {
  url?: string;
  fallback: string;
  dense: boolean;
}) {
  const size = dense ? 22 : 28;
  const initial = fallback?.[0]?.toUpperCase() ?? "?";
  if (!url) {
    return (
      <div
        className="rounded-full flex items-center justify-center text-cream-faint font-mono font-bold shrink-0"
        style={{
          width: size,
          height: size,
          background: "var(--ink-3)",
          border: "1px solid var(--cream-line)",
          fontSize: dense ? 10 : 11,
        }}
      >
        {initial}
      </div>
    );
  }
  return (
    <img
      src={url.replace("http://", "https://")}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      className="rounded-full shrink-0 object-cover"
      style={{
        width: size,
        height: size,
        border: "1px solid var(--cream-line)",
      }}
      onError={(e) => {
        const el = e.target as HTMLImageElement;
        el.style.display = "none";
      }}
    />
  );
}

function formatOnline(n: number): string {
  if (n >= 100_0000) return `${(n / 100_0000).toFixed(1)}千万`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
