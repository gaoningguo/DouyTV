/**
 * MediaGrid —— 响应式 CSS grid，跨断点 2/3/4/5 列，统一 gap。
 * 复刻 pure_live `popular_grid_view.dart` 的 LayoutBuilder + crossAxisCount 模式。
 */
import type { ReactNode } from "react";

export interface MediaGridProps {
  children: ReactNode;
  className?: string;
  /** dense=true 时列数更多更密，对应直播 grid；dense=false 时列数更少，给视频 cover 用 */
  dense?: boolean;
}

export function MediaGrid({ children, className, dense = false }: MediaGridProps) {
  const cols = dense
    ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
    : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";
  return (
    <div className={`grid ${cols} gap-2 ${className ?? ""}`}>{children}</div>
  );
}
