import { type ReactNode } from "react";
import { IconRepeat, IconRepeatOne, IconShuffle } from "@/components/Icon";
import { type MusicPlayMode, type MusicQuality } from "@/lib/music";

export const QUALITY_OPTIONS: Array<{ id: MusicQuality; label: string }> = [
  { id: "128k", label: "标准" },
  { id: "320k", label: "高品" },
  { id: "flac", label: "无损" },
  { id: "flac24bit", label: "臻品" },
];

export const PLAY_MODE_ICON: Record<MusicPlayMode, ReactNode> = {
  loop: <IconRepeat size={17} />,
  single: <IconRepeatOne size={17} />,
  random: <IconShuffle size={17} />,
};

export const PLAY_MODE_LABEL: Record<MusicPlayMode, string> = {
  loop: "列表循环",
  single: "单曲循环",
  random: "随机播放",
};
