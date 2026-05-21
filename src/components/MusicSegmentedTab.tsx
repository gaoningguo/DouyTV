/**
 * 分段标签 —— 参考 MusicFree `resultPanel/index.tsx:33-78` 的 TabView 与
 * lx-music `views/Search/index.vue` 的 `base-tab`。激活态用文字色 + 底部 ember 横线。
 *
 * 横向 scroll 默认开启（适合任意 tab 数），可指定 columns 强制等分铺满（如 2/3/4 个固定 tab）。
 */
import type { ReactNode } from "react";

export interface SegmentedTab<T extends string> {
  id: T;
  label: string;
  count?: number;
  /** 自定义前缀（如 icon） */
  prefix?: ReactNode;
}

interface Props<T extends string> {
  tabs: ReadonlyArray<SegmentedTab<T>>;
  active: T;
  onChange: (id: T) => void;
  /** 等分模式：固定列数（2/3/4...）。不传则横滑 */
  columns?: number;
  /** 容器额外 className */
  className?: string;
}

export function MusicSegmentedTab<T extends string>({
  tabs,
  active,
  onChange,
  columns,
  className,
}: Props<T>) {
  const wrapperBase = columns ? `grid gap-0` : `flex gap-0 overflow-x-auto no-scrollbar`;
  const wrapperStyle: React.CSSProperties = columns
    ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
    : {};

  return (
    <div
      className={`${wrapperBase} mb-3 border-b ${className ?? ""}`}
      style={{ ...wrapperStyle, borderColor: "var(--cream-line)" }}
      role="tablist"
    >
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.id)}
            className={`relative shrink-0 px-4 py-2.5 text-[12px] font-display font-semibold tap whitespace-nowrap`}
            style={{
              color: isActive ? "var(--ember)" : "var(--cream-dim)",
            }}
          >
            <span className="flex items-center gap-1.5">
              {t.prefix}
              {t.label}
              {t.count != null && (
                <span className="font-mono text-[10px] opacity-70">
                  · {t.count}
                </span>
              )}
            </span>
            {isActive && (
              <span
                aria-hidden
                className="absolute left-3 right-3 -bottom-px h-[2px] rounded"
                style={{
                  background: "var(--ember)",
                  boxShadow: "0 0 6px var(--ember-glow, rgba(255,107,53,0.4))",
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

export default MusicSegmentedTab;
