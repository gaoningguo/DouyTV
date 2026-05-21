/**
 * 圆角 chip —— 用于搜索历史 / 热搜 / 推荐 tag。参考 MusicFree
 * `historyPanel.tsx` 的 Chip + `onClose`。
 */
import type { ReactNode, MouseEvent } from "react";
import { IconClose } from "@/components/Icon";

interface Props {
  label: string;
  onClick?: () => void;
  /** 右侧 × 删除键（无传不显示） */
  onClose?: () => void;
  /** 高亮（ember bg） */
  active?: boolean;
  /** 弱化（小尺寸用于密集列表） */
  size?: "sm" | "md";
  /** 左侧前缀 icon */
  prefix?: ReactNode;
}

export function MusicChip({
  label,
  onClick,
  onClose,
  active,
  size = "md",
  prefix,
}: Props) {
  const handleClose = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClose?.();
  };

  const pad = size === "sm" ? "px-2 py-0.5" : "px-3 py-1";
  const text = size === "sm" ? "text-[10px]" : "text-[11px]";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 inline-flex items-center gap-1.5 ${pad} ${text} font-mono rounded-full tap`}
      style={{
        background: active ? "var(--ember)" : "var(--ink-3)",
        color: active ? "var(--ink)" : "var(--cream-dim)",
        border: `1px solid ${active ? "rgba(255,107,53,0.3)" : "var(--cream-line)"}`,
      }}
    >
      {prefix && <span className="opacity-80">{prefix}</span>}
      <span>{label}</span>
      {onClose && (
        <span
          role="button"
          aria-label={`删除 ${label}`}
          onClick={handleClose}
          className="ml-0.5 -mr-1 w-4 h-4 flex items-center justify-center rounded-full opacity-60 hover:opacity-100"
        >
          <IconClose size={8} />
        </span>
      )}
    </button>
  );
}

export default MusicChip;
