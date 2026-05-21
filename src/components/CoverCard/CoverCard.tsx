/**
 * CoverCard —— 通用书/漫画/视频封面卡。
 *
 * 复刻 mihon Library/Browse grid + legado 书架的视觉：
 *   - 顶部 2:3 portrait cover（img 或 fallback icon）
 *   - 右上 topBadge slot（更新红点 / 自定义角标）
 *   - 底部 ListTile：title (line-clamp-2) + subtitle (line-clamp-1) + meta (line-clamp-1) + bottomBadge
 *
 * 适用于：NovelHome / MangaSrcHome / Books-Shelf / Manga-Shelf
 */
import type { ReactNode } from "react";
import { IconBook } from "@/components/Icon";
import { wrapImage } from "@/lib/proxy";

export interface CoverCardProps {
  cover?: string;
  title: string;
  /** 作者 / 主播 / 一行副标题 */
  subtitle?: string;
  /** 来源名 / 分类标签 / 第三行小字 */
  meta?: ReactNode;
  /** 右上角徽标（更新红点 / 多源 chip）*/
  topBadge?: ReactNode;
  /** 底部 meta 后再加一行，常用于 lastRead 进度 */
  bottomBadge?: ReactNode;
  active?: boolean;
  onClick?: () => void;
  /** 默认 false：cover 不走 dyproxy 代理；true 时调 wrapImage 包一层防盗链 */
  proxyCover?: boolean;
  /** 给无障碍工具用 */
  ariaLabel?: string;
}

export function CoverCard({
  cover,
  title,
  subtitle,
  meta,
  topBadge,
  bottomBadge,
  active = false,
  onClick,
  proxyCover = false,
  ariaLabel,
}: CoverCardProps) {
  const coverUrl = cover
    ? proxyCover
      ? wrapImage(cover) ?? cover
      : cover.replace("http://", "https://")
    : undefined;
  return (
    <div
      onClick={onClick}
      aria-label={ariaLabel ?? title}
      className="rounded-xl overflow-hidden tap cursor-pointer relative flex flex-col group"
      style={{
        background: "var(--ink-2)",
        border: `1px solid ${
          active ? "rgba(255,107,53,0.5)" : "var(--cream-line)"
        }`,
        transition: "transform 120ms ease, border-color 120ms ease",
      }}
    >
      {/* 2:3 cover */}
      <div
        className="relative w-full overflow-hidden"
        style={{ aspectRatio: "2 / 3", background: "var(--ink-3)" }}
      >
        {coverUrl ? (
          <img
            src={coverUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-cream-faint opacity-40">
            <IconBook size={36} />
          </div>
        )}
        {/* 顶部渐变让 topBadge 在亮图上也可读 */}
        {topBadge && (
          <div className="absolute top-0 left-0 right-0 h-10 pointer-events-none" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.45), transparent)" }} />
        )}
        {topBadge && (
          <div className="absolute top-1.5 right-1.5 flex items-center gap-1">
            {topBadge}
          </div>
        )}
      </div>

      {/* 底部信息 */}
      <div className="p-2 flex-1 flex flex-col gap-0.5">
        <p className="text-[12px] font-display font-semibold line-clamp-2 text-cream leading-snug">
          {title}
        </p>
        {subtitle && (
          <p className="text-[10px] font-mono text-cream-faint line-clamp-1">
            {subtitle}
          </p>
        )}
        {meta && (
          <p className="text-[10px] text-cream-dim font-mono line-clamp-1">
            {meta}
          </p>
        )}
        {bottomBadge && (
          <p className="text-[10px] font-mono line-clamp-1 mt-0.5" style={{ color: "var(--ember)" }}>
            {bottomBadge}
          </p>
        )}
      </div>
    </div>
  );
}
