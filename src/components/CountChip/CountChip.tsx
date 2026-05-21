/**
 * CountChip —— stadium 形半透明 pill，icon + 文字。
 * 复刻 pure_live `common/widgets/room_card.dart` 里的 CountChip：
 * 半透明黑底白字，浮在 cover 角落作为热度 / 录播标记。
 */
import type { ReactNode } from "react";

export interface CountChipProps {
  icon?: ReactNode;
  children: ReactNode;
  /** 背景色，默认半透明黑 */
  background?: string;
  /** 文字色，默认白 */
  color?: string;
  className?: string;
  dense?: boolean;
}

export function CountChip({
  icon,
  children,
  background,
  color = "rgba(255,255,255,0.92)",
  className,
  dense = false,
}: CountChipProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-mono font-semibold ${
        dense ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]"
      } ${className ?? ""}`}
      style={{
        background: background ?? "rgba(0,0,0,0.55)",
        color,
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
    >
      {icon}
      {children}
    </span>
  );
}
