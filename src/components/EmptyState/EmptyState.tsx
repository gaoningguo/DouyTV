/**
 * EmptyState —— 大 icon + title + subtitle 的空态占位。
 * 复刻 pure_live `common/widgets/empty_view.dart` 的视觉：垂直居中、icon 用 disabled 色。
 */
import type { ReactNode } from "react";

export interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  className?: string;
  action?: ReactNode;
}

export function EmptyState({
  icon,
  title,
  subtitle,
  className,
  action,
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center py-12 px-4 ${className ?? ""}`}
      style={{ color: "var(--cream-faint)" }}
    >
      <div className="opacity-40 mb-4">{icon}</div>
      <p className="font-display font-semibold text-base text-cream-dim">
        {title}
      </p>
      {subtitle && (
        <p className="font-mono text-[11px] mt-2 max-w-sm leading-relaxed">
          {subtitle}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
