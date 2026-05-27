import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { IconArrowLeft } from "@/components/Icon";

interface Props {
  eyebrow: string;
  title: string;
  children: ReactNode;
  /** 顶栏右侧自定义区域（如「全部刷新」按钮） */
  trailing?: ReactNode;
  /** 固定在 header 下方、滚动区上方的工具栏（tab 切换、批量操作等） */
  toolbar?: ReactNode;
}

export function SettingsSubPageLayout({ eyebrow, title, children, trailing, toolbar }: Props) {
  const navigate = useNavigate();
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-ink text-cream">
      <div
        className="shrink-0 flex items-center gap-3 px-4 pt-4 pb-3"
        style={{ borderBottom: "1px solid var(--cream-line)" }}
      >
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-full shrink-0 tap text-cream"
          style={{
            background: "var(--ink-2)",
            border: "1px solid var(--cream-line)",
          }}
          aria-label="返回"
        >
          <IconArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
            {eyebrow}
          </p>
          <h1 className="font-display text-xl font-extrabold tracking-tight line-clamp-1">
            {title}
          </h1>
        </div>
        {trailing}
      </div>
      {toolbar && <div className="shrink-0">{toolbar}</div>}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">{children}</div>
    </div>
  );
}
