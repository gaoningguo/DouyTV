/**
 * 播放全部条 —— 详情页 (Playlist / Favorites / Album / UserPlaylist) 列表上方的吸顶式
 * 操作条。参考 MusicFree `components/base/playAllBar`。
 *
 * 左：主 CTA "播放全部 · N 首"；右：随机 + 其他可选 slot（添加到歌单 / 更多）。
 */
import type { ReactNode } from "react";
import { IconPlay, IconShuffle } from "@/components/Icon";

interface Props {
  count: number;
  /** 自定义标签，默认 "播放全部" */
  label?: string;
  onPlayAll: () => void;
  onShuffle?: () => void;
  /** 右侧追加节点（例如 "添加到歌单" 按钮组） */
  rightSlot?: ReactNode;
  /** 禁用主按钮（例如列表为空时）—— shuffle 会一并禁用 */
  disabled?: boolean;
}

export function MusicPlayAllBar({
  count,
  label = "播放全部",
  onPlayAll,
  onShuffle,
  rightSlot,
  disabled,
}: Props) {
  return (
    <div
      className="flex items-center gap-2 mb-3 px-3 py-2.5 rounded-lg sticky top-0 z-[5]"
      style={{
        background: "var(--ink-2)",
        border: "1px solid var(--cream-line)",
        backdropFilter: "blur(6px)",
      }}
    >
      <button
        type="button"
        onClick={onPlayAll}
        disabled={disabled || count === 0}
        className="flex items-center gap-2 tap text-cream font-display text-sm font-semibold disabled:opacity-40"
      >
        <span
          className="w-7 h-7 flex items-center justify-center rounded-full"
          style={{ background: "var(--ember)", color: "var(--ink)" }}
        >
          <IconPlay size={12} />
        </span>
        <span>{label}</span>
        <span className="font-mono text-[11px] text-cream-faint">
          · {count}
        </span>
      </button>

      <div className="flex-1" />

      {onShuffle && (
        <button
          type="button"
          onClick={onShuffle}
          disabled={disabled || count === 0}
          className="w-8 h-8 flex items-center justify-center rounded tap text-cream-dim hover:text-cream disabled:opacity-40"
          aria-label="随机播放"
          title="随机播放"
        >
          <IconShuffle size={14} />
        </button>
      )}

      {rightSlot}
    </div>
  );
}

export default MusicPlayAllBar;
