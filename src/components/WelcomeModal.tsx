import {
  IconHome,
  IconSearch,
  IconLive,
  IconLocal,
  IconWave,
} from "@/components/Icon";

interface Props {
  onDismiss: () => void;
}

const FEATURES = [
  {
    Icon: IconHome,
    title: "上下滑流",
    desc: "首页抖音式信息流，↑↓ 或滚轮切换",
    accent: "ember",
  },
  {
    Icon: IconSearch,
    title: "聚合搜索",
    desc: "MoonTV 兼容脚本，多源同时查询",
    accent: "phosphor",
  },
  {
    Icon: IconLive,
    title: "直播频道",
    desc: "M3U 订阅 + EPG 节目单",
    accent: "vhs",
  },
  {
    Icon: IconLocal,
    title: "本地视频",
    desc: "扫描本地目录，离线播放",
    accent: "ember",
  },
] as const;

const ACCENT_COLORS: Record<string, string> = {
  ember: "var(--ember)",
  phosphor: "var(--phosphor)",
  vhs: "var(--vhs)",
};

export default function WelcomeModal({ onDismiss }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 overflow-auto"
      style={{
        background:
          "radial-gradient(ellipse at center, rgba(14,15,17,0.85) 30%, rgba(0,0,0,0.96) 100%)",
        backdropFilter: "blur(12px)",
      }}
    >
      <div
        className="w-full max-w-md my-6 animate-blur-in"
        style={{
          background: "var(--ink-2)",
          border: "1px solid var(--ink-edge)",
          borderRadius: 22,
          boxShadow:
            "0 32px 64px -16px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.04)",
        }}
      >
        {/* CRT 屏幕头部 */}
        <div
          className="px-6 pt-7 pb-5 relative overflow-hidden"
          style={{
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            background:
              "linear-gradient(180deg, rgba(255,107,53,0.12) 0%, transparent 100%)",
            borderBottom: "1px solid var(--cream-line)",
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <span className="font-mono text-[10px] tracking-[0.25em] text-cream-faint">
              CH 00 · BROADCAST
            </span>
            <span className="signal-bars">
              <span></span>
              <span></span>
              <span></span>
            </span>
          </div>

          <h1
            className="font-display font-extrabold leading-[0.92] tracking-tight"
            style={{ fontSize: "44px" }}
          >
            <span className="text-cream">DOUY</span>
            <span style={{ color: "var(--ember)" }}>TV</span>
            <span className="rec-dot" style={{ marginLeft: 10, verticalAlign: "middle" }} />
          </h1>
          <p className="text-sm text-cream-dim mt-3 font-display">
            MoonTV 兼容 · 全平台媒体客户端
          </p>
        </div>

        {/* Features */}
        <div className="px-6 py-5 space-y-2.5">
          {FEATURES.map((f, i) => {
            const Icon = f.Icon;
            return (
              <div
                key={f.title}
                className="flex items-center gap-3.5 p-3 rounded-xl animate-slide-up"
                style={{
                  background: "var(--ink-3)",
                  border: "1px solid var(--cream-line)",
                  animationDelay: `${i * 60}ms`,
                }}
              >
                <span
                  className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                  style={{
                    background: `${ACCENT_COLORS[f.accent]}1A`,
                    color: ACCENT_COLORS[f.accent],
                    border: `1px solid ${ACCENT_COLORS[f.accent]}33`,
                  }}
                >
                  <Icon size={20} />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-cream font-display">
                    {f.title}
                  </p>
                  <p className="text-xs text-cream-dim mt-0.5">{f.desc}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer + CTA */}
        <div className="px-6 pb-6">
          <p className="text-[11px] text-cream-faint text-center mb-4 leading-relaxed">
            <IconWave size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: 4 }} />
            已自动加载 5 个公开测试源 · 可在「视频源」中导入更多
          </p>
          <button
            type="button"
            onClick={onDismiss}
            className="w-full py-3.5 font-display font-bold text-sm tracking-wider tap glow-ember"
            style={{
              background: "var(--ember)",
              color: "var(--ink)",
              borderRadius: 12,
            }}
          >
            POWER ON →
          </button>
        </div>
      </div>
    </div>
  );
}
