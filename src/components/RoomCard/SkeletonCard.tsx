/**
 * SkeletonCard —— RoomCard 加载占位。
 * 16:9 灰块 cover + 下面两行 shimmer，列数和 RoomCard 完全对齐。
 */
import { memo } from "react";

function SkeletonCardImpl({ dense = false }: { dense?: boolean }) {
  return (
    <div
      className="rounded-xl overflow-hidden relative flex flex-col"
      style={{
        background: "var(--ink-2)",
        border: "1px solid var(--cream-line)",
      }}
    >
      <div
        className="w-full skeleton-shimmer"
        style={{ aspectRatio: "16 / 9" }}
      />
      <div className={dense ? "p-2" : "p-2.5"}>
        <div className="flex items-start gap-2">
          <div
            className="rounded-full skeleton-shimmer shrink-0"
            style={{
              width: dense ? 22 : 28,
              height: dense ? 22 : 28,
            }}
          />
          <div className="flex-1 min-w-0 space-y-1.5">
            <div
              className="rounded skeleton-shimmer"
              style={{ height: dense ? 10 : 12, width: "85%" }}
            />
            <div
              className="rounded skeleton-shimmer"
              style={{ height: dense ? 8 : 10, width: "55%" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export const SkeletonCard = memo(SkeletonCardImpl);
