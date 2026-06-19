import { IconClose } from "@/components/Icon";

/** MV 视频播放弹层。netease MV 是 mp4,http 直链升级到 https 避免混合内容拦截。 */
export function MvModal({
  url,
  title,
  onClose,
}: {
  url: string;
  title: string;
  onClose: () => void;
}) {
  const src = url.replace(/^http:\/\//i, "https://");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <button
        type="button"
        aria-label="关闭"
        className="absolute inset-0 cursor-default"
        style={{ background: "rgba(0,0,0,0.85)" }}
        onClick={onClose}
      />
      <div className="relative w-full max-w-4xl">
        <div className="mb-2 flex items-center gap-3">
          <h2 className="min-w-0 flex-1 truncate font-display font-bold text-cream">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-lg grid place-items-center tap text-cream-dim hover:text-cream"
            title="关闭"
          >
            <IconClose size={18} />
          </button>
        </div>
        <video
          src={src}
          controls
          autoPlay
          className="w-full rounded-xl bg-black"
          style={{ aspectRatio: "16 / 9", border: "1px solid var(--cream-line)" }}
        />
      </div>
    </div>
  );
}
