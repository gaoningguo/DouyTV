/**
 * 详情页通用头部 —— 左封面 / 中信息 / 右操作的三段式 grid（参考 lx-music
 * songList/Detail 的 headerLeft/Middle/Right 布局）。
 *
 * 在 Playlist / Favorites / Album / UserPlaylist / History / Artist 等详情页统一复用。
 */
import type { ReactNode } from "react";
import { wrapImage } from "@/lib/proxy";
import { IconArrowLeft, IconMusic } from "@/components/Icon";

interface Props {
  eyebrow: string;
  title: string;
  cover?: string;
  /** 中部 meta 行，"·" 分隔自动加 */
  meta?: Array<string | number | undefined | null>;
  description?: string;
  /** 右上角额外按钮 (例如 more menu) */
  rightSlot?: ReactNode;
  /** 是否显示返回箭头 */
  onBack?: () => void;
  /** 自定义底部块（替代 description）—— 用于 author/playCount 自定义渲染 */
  footerSlot?: ReactNode;
}

export function MusicDetailHeader({
  eyebrow,
  title,
  cover,
  meta,
  description,
  rightSlot,
  onBack,
  footerSlot,
}: Props) {
  const metaLine = (meta ?? [])
    .filter((m): m is string | number => m != null && m !== "")
    .map((m) => String(m))
    .join("  ·  ");

  return (
    <header
      className="flex items-stretch gap-3 p-4 mb-3 rounded-xl relative overflow-hidden"
      style={{
        background: "var(--ink-2)",
        border: "1px solid var(--cream-line)",
      }}
    >
      {/* 模糊封面背景（弱化） */}
      {cover && (
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `url(${wrapImage(cover)})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            filter: "blur(40px) saturate(1.2)",
            opacity: 0.18,
          }}
        />
      )}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(to right, var(--ink-2) 30%, transparent 70%)",
        }}
      />

      {/* 顶部 back button overlay */}
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="absolute top-3 left-3 z-10 w-8 h-8 flex items-center justify-center rounded-full tap text-cream"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
          aria-label="返回"
        >
          <IconArrowLeft size={14} />
        </button>
      )}

      {/* 封面 */}
      <div
        className="relative shrink-0 w-24 h-24 sm:w-28 sm:h-28 rounded-lg overflow-hidden"
        style={{
          background: "var(--ink-3)",
          border: "1px solid var(--cream-line)",
        }}
      >
        {cover ? (
          <img
            src={wrapImage(cover)}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <IconMusic size={28} className="text-cream-faint" />
          </div>
        )}
      </div>

      {/* 中部信息 */}
      <div className="flex-1 min-w-0 flex flex-col justify-between relative z-10">
        <div>
          <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint mb-1">
            {eyebrow}
          </p>
          <h1 className="font-display text-lg sm:text-xl font-extrabold tracking-tight line-clamp-2 leading-tight">
            {title}
          </h1>
        </div>
        {metaLine && (
          <p className="font-mono text-[10px] text-cream-dim line-clamp-1 mt-1.5">
            {metaLine}
          </p>
        )}
        {footerSlot
          ? footerSlot
          : description && (
              <p className="text-[11px] text-cream-faint line-clamp-2 mt-1.5 leading-snug">
                {description}
              </p>
            )}
      </div>

      {/* 右部 slot */}
      {rightSlot && (
        <div className="relative z-10 flex items-start">{rightSlot}</div>
      )}
    </header>
  );
}

export default MusicDetailHeader;
