import { useEffect, useRef } from "react";
import { getSpectrum, isAudioGraphReady } from "@/lib/music/audioGraph";

/**
 * 真实频谱可视化：RAF 每帧从 AnalyserNode 取频谱画到 canvas。
 * 图未就绪（未代理/不支持 Web Audio）时回退到轻量装饰柱条。
 */
export function Spectrum({
  bars = 48,
  playing,
  className,
}: {
  bars?: number;
  playing: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    // 装饰回退用的相位（图不可用时用正弦波模拟律动）。
    let phase = 0;
    const smoothed = new Float32Array(bars);

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const ember = getComputedStyle(canvas).getPropertyValue("--ember").trim() || "#ff6b35";

    const draw = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      const real = playing ? getSpectrum(bars) : null;
      const gap = 2;
      const barW = (w - gap * (bars - 1)) / bars;

      for (let i = 0; i < bars; i += 1) {
        let value: number;
        if (real) {
          value = real[i];
        } else if (playing) {
          // 装饰回退：多频正弦叠加，制造起伏。
          value =
            0.12 +
            0.32 * Math.abs(Math.sin(phase + i * 0.4)) +
            0.18 * Math.abs(Math.sin(phase * 1.7 + i * 0.9));
        } else {
          value = 0.04;
        }
        // 平滑，避免回退模式抖动 / 真实模式过冲。
        smoothed[i] = smoothed[i] * 0.6 + value * 0.4;
        const barH = Math.max(2, smoothed[i] * h);
        const x = i * (barW + gap);
        const y = h - barH;
        const alpha = 0.35 + smoothed[i] * 0.65;
        ctx.fillStyle = ember;
        ctx.globalAlpha = alpha;
        const r = Math.min(barW / 2, 2);
        ctx.beginPath();
        ctx.roundRect(x, y, barW, barH, r);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      phase += 0.08;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [bars, playing]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden
      data-real={isAudioGraphReady() ? "1" : "0"}
    />
  );
}
