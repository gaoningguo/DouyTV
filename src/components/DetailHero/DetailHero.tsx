/**
 * DetailHero —— 书 / 漫画 / 视频详情页顶部 hero。
 *
 * 复刻 mihon `MangaScreen` + legado `BookInfo` 的视觉骨架：
 *   - 顶部背景：cover 模糊放大 + 50% 黑色蒙板（沉浸感）
 *   - 内容：左大封面 (w-32 / sm:w-40) | 右元信息 (title / subtitle / chip row / actions)
 *   - 下方 description 区（可省略，由调用方决定是否传入）
 *
 * 给所有 Detail 页用，避免每页重复手写。
 */
import { useState, type ReactNode } from "react";
import { IconArrowLeft, IconBook, IconChevronDown, IconChevronUp } from "@/components/Icon";
import { wrapImage } from "@/lib/proxy";

export interface DetailHeroProps {
  cover?: string;
  title: string;
  /** 作者 / 主播 */
  subtitle?: string;
  /** chip row：来源 / 语言 / 状态等。传入 ReactNode 自由组合 */
  metaChips?: ReactNode;
  /** 简介长文本，自动折叠成 4 行，点 "展开" 全文 */
  description?: string;
  /** 右下角自定义徽标，例如进度百分比 */
  badge?: ReactNode;
  /** action 按钮行（继续阅读 / 加入书架 / 缓存 等） */
  actions?: ReactNode;
  onBack?: () => void;
  proxyCover?: boolean;
}

export function DetailHero({
  cover,
  title,
  subtitle,
  metaChips,
  description,
  badge,
  actions,
  onBack,
  proxyCover = false,
}: DetailHeroProps) {
  const coverUrl = cover
    ? proxyCover
      ? wrapImage(cover) ?? cover
      : cover.replace("http://", "https://")
    : undefined;

  const [expanded, setExpanded] = useState(false);

  return (
    <header className="relative -mx-4 -mt-4 mb-5">
      {/* Backdrop：模糊封面 */}
      {coverUrl && (
        <div
          aria-hidden
          className="absolute inset-0 overflow-hidden"
          style={{ height: 200 }}
        >
          <img
            src={coverUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="absolute inset-0 w-full h-full object-cover"
            style={{ filter: "blur(28px) saturate(1.2)", transform: "scale(1.4)", opacity: 0.55 }}
          />
          <div
            className="absolute inset-0"
            style={{
              background: "linear-gradient(to bottom, rgba(14,15,17,0.55) 0%, rgba(14,15,17,1) 95%)",
            }}
          />
        </div>
      )}

      <div className="relative">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="ml-4 mt-4 mb-3 w-9 h-9 flex items-center justify-center rounded-full tap text-cream"
            style={{
              background: "rgba(0,0,0,0.45)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              border: "1px solid var(--cream-line)",
            }}
            aria-label="返回"
          >
            <IconArrowLeft size={16} />
          </button>
        )}

        {/* 主体 */}
        <div className="px-4 pt-2 flex gap-4">
          {/* 封面 */}
          <div className="w-28 sm:w-36 shrink-0">
            <div
              className="w-full rounded-xl overflow-hidden relative"
              style={{
                aspectRatio: "2 / 3",
                background: "var(--ink-3)",
                boxShadow: "0 16px 36px -16px rgba(0,0,0,0.85)",
                border: "1px solid var(--cream-line)",
              }}
            >
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt={title}
                  referrerPolicy="no-referrer"
                  className="absolute inset-0 w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-cream-faint">
                  <IconBook size={36} />
                </div>
              )}
            </div>
          </div>

          {/* 元信息 */}
          <div className="flex-1 min-w-0 flex flex-col">
            <h1 className="font-display text-xl sm:text-2xl font-extrabold tracking-tight leading-tight line-clamp-3 text-cream">
              {title}
            </h1>
            {subtitle && (
              <p className="text-xs sm:text-sm text-cream-dim mt-1.5 line-clamp-2">
                {subtitle}
              </p>
            )}
            {metaChips && (
              <div className="flex items-center gap-1.5 flex-wrap mt-2">
                {metaChips}
              </div>
            )}
            {badge && (
              <div className="mt-auto pt-2">{badge}</div>
            )}
          </div>
        </div>

        {/* Actions */}
        {actions && <div className="px-4 mt-4 flex items-center gap-2 flex-wrap">{actions}</div>}

        {/* Description */}
        {description && (
          <div className="px-4 mt-4">
            <div
              className={`text-[12px] leading-relaxed text-cream-dim whitespace-pre-line ${
                expanded ? "" : "line-clamp-4"
              }`}
            >
              {description}
            </div>
            {description.length > 120 && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-1.5 text-[11px] font-mono text-ember tap inline-flex items-center gap-1"
              >
                {expanded ? (
                  <>
                    收起 <IconChevronUp size={11} />
                  </>
                ) : (
                  <>
                    展开 <IconChevronDown size={11} />
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

/** 元信息小 chip：source / language / status 用 */
export function MetaChip({
  children,
  color,
}: {
  children: ReactNode;
  color?: "default" | "ember" | "phosphor";
}) {
  const c =
    color === "ember"
      ? { bg: "var(--ember-soft)", fg: "var(--ember)", border: "rgba(255,107,53,0.3)" }
      : color === "phosphor"
      ? { bg: "var(--phosphor-soft)", fg: "var(--phosphor)", border: "rgba(124,255,178,0.3)" }
      : { bg: "var(--ink-2)", fg: "var(--cream-dim)", border: "var(--cream-line)" };
  return (
    <span
      className="px-2 py-0.5 rounded-full text-[10px] font-mono"
      style={{ background: c.bg, color: c.fg, border: `1px solid ${c.border}` }}
    >
      {children}
    </span>
  );
}
