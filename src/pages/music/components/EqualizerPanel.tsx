import { EQ_FREQUENCIES, EQ_PRESETS } from "@/lib/music/audioGraph";
import { Switch } from "./ui";

function freqLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}k` : `${hz}`;
}

/**
 * 均衡器面板：开关 + 预设 chip + 多频段竖向滑杆（-12..+12 dB）。
 * 增益变更通过回调写入 store 并实时套到 BiquadFilter。
 */
export function EqualizerPanel({
  enabled,
  preset,
  gains,
  available,
  onToggle,
  onPreset,
  onGain,
}: {
  enabled: boolean;
  preset: string;
  gains: number[];
  available: boolean;
  onToggle: (enabled: boolean) => void;
  onPreset: (id: string, gains: number[]) => void;
  onGain: (index: number, gain: number) => void;
}) {
  return (
    <section className="music-eq">
      <div className="flex items-center gap-2">
        <h3 className="font-display text-sm font-semibold">均衡器</h3>
        <span className="ml-auto">
          <Switch checked={enabled} onChange={onToggle} />
        </span>
      </div>

      {!available && (
        <p className="mt-1 text-[11px] text-cream-faint">
          均衡器需开启「稳定流代理」后生效（提供无跨域限制的音频流）。
        </p>
      )}

      <div className="music-eq-presets mt-3">
        {EQ_PRESETS.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={!enabled}
            onClick={() => onPreset(item.id, item.gains)}
            className={preset === item.id ? "is-active" : undefined}
          >
            {item.label}
          </button>
        ))}
        {preset === "custom" && (
          <button type="button" className="is-active" disabled>
            自定义
          </button>
        )}
      </div>

      <div className="music-eq-bands mt-4" data-disabled={!enabled}>
        {EQ_FREQUENCIES.map((freq, index) => (
          <div key={freq} className="music-eq-band">
            <span className="music-eq-gain">
              {gains[index] > 0 ? "+" : ""}
              {gains[index] ?? 0}
            </span>
            <input
              type="range"
              min={-12}
              max={12}
              step={1}
              disabled={!enabled}
              value={gains[index] ?? 0}
              onChange={(event) => onGain(index, Number(event.target.value))}
              className="music-eq-slider"
              // 竖向滑杆
              style={{ writingMode: "vertical-lr", direction: "rtl" } as React.CSSProperties}
              title={`${freqLabel(freq)}Hz`}
            />
            <span className="music-eq-freq">{freqLabel(freq)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
