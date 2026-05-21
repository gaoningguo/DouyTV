/**
 * 空态卡片 —— 详情页 / 历史 / 收藏 / 推荐没有数据时显示。
 * 比直接 inline 一个 div 更统一：dashed border + 居中 icon + 主副标题 + 可选 CTA。
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

interface Props {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  /** 可选行动按钮 */
  cta?: { label: string; to?: string; onClick?: () => void };
  /** 紧凑模式（默认 padding 较大） */
  compact?: boolean;
}

export function MusicEmptyState({ icon, title, subtitle, cta, compact }: Props) {
  const pad = compact ? "p-4" : "p-6";
  return (
    <div
      className={`rounded-xl ${pad} text-center`}
      style={{
        background: "var(--ink-2)",
        border: "1px dashed var(--cream-line)",
      }}
    >
      <span className="text-cream-faint mx-auto mb-2 inline-flex">{icon}</span>
      <p className="text-sm font-display font-semibold text-cream-dim mb-1">
        {title}
      </p>
      {subtitle && (
        <p className="text-[11px] text-cream-faint leading-relaxed">
          {subtitle}
        </p>
      )}
      {cta &&
        (cta.to ? (
          <Link
            to={cta.to}
            className="inline-block mt-3 px-5 py-2 rounded-full text-xs font-display font-semibold tap"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            {cta.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={cta.onClick}
            className="inline-block mt-3 px-5 py-2 rounded-full text-xs font-display font-semibold tap"
            style={{ background: "var(--ember)", color: "var(--ink)" }}
          >
            {cta.label}
          </button>
        ))}
    </div>
  );
}

export default MusicEmptyState;
