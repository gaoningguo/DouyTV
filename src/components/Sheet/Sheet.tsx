import { useEffect } from "react";
import { createPortal } from "react-dom";
import { IconClose } from "@/components/Icon";

// 通用浮层原语 —— 阅读器章节抽屉 / 设置面板 / 历史操作菜单共用。
// 仓库原本没有 sheet/drawer/modal 组件,只有小对话框 AppDialog。这里用现有的
// animate-sheet(底部升起)/ animate-slide-right(右侧抽屉)keyframe 手搓,
// 走 createPortal 挂 body,带遮罩 + ESC 关闭 + safe-area。

export type SheetSide = "bottom" | "right";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  side?: SheetSide;
  title?: string;
  /** 右侧抽屉宽度(side=right 时),默认 22rem。 */
  width?: string;
  /** 底部面板最大高度(side=bottom 时),默认 70vh。 */
  maxHeight?: string;
  children: React.ReactNode;
  /** 头部右侧额外操作(如排序切换按钮)。 */
  headerActions?: React.ReactNode;
}

export function Sheet({
  open,
  onClose,
  side = "bottom",
  title,
  width = "22rem",
  maxHeight = "70vh",
  children,
  headerActions,
}: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isRight = side === "right";
  const panelPosition = isRight
    ? "top-0 right-0 bottom-0"
    : "left-0 right-0 bottom-0";
  const panelAnim = isRight ? "animate-slide-right" : "animate-sheet";
  const panelRadius = isRight ? "rounded-l-2xl" : "rounded-t-2xl";

  return createPortal(
    <div className="fixed inset-0 z-[60] flex" aria-modal role="dialog">
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-black/60 animate-fade-in"
        onClick={onClose}
        onPointerDownCapture={(e) => e.stopPropagation()}
      />
      {/* 面板 */}
      <div
        className={`absolute ${panelPosition} ${panelAnim} ${panelRadius} flex flex-col bg-ink-2 shadow-2xl`}
        style={{
          width: isRight ? `min(${width}, 88vw)` : undefined,
          maxHeight: isRight ? undefined : maxHeight,
          borderLeft: isRight ? "1px solid var(--cream-line)" : undefined,
          borderTop: isRight ? undefined : "1px solid var(--cream-line)",
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingRight: isRight ? "env(safe-area-inset-right)" : undefined,
          paddingTop: isRight ? "env(safe-area-inset-top)" : undefined,
        }}
        onPointerDownCapture={(e) => e.stopPropagation()}
      >
        {(title || headerActions) && (
          <div
            className="shrink-0 flex items-center gap-3 px-4 py-3"
            style={{ borderBottom: "1px solid var(--cream-line)" }}
          >
            <h2 className="flex-1 font-display text-sm font-bold text-cream line-clamp-1">
              {title}
            </h2>
            {headerActions}
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full tap text-cream-dim shrink-0"
              style={{ background: "var(--ink)", border: "1px solid var(--cream-line)" }}
              aria-label="关闭"
            >
              <IconClose size={15} />
            </button>
          </div>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>,
    document.body
  );
}
