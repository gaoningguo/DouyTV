/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // 复古 CRT 美学 token — 通过 CSS variables 引入便于统一调
        ink: {
          DEFAULT: "var(--ink)",
          2: "var(--ink-2)",
          3: "var(--ink-3)",
          edge: "var(--ink-edge)",
        },
        ember: {
          DEFAULT: "var(--ember)",
          deep: "var(--ember-deep)",
          soft: "var(--ember-soft)",
        },
        phosphor: {
          DEFAULT: "var(--phosphor)",
          soft: "var(--phosphor-soft)",
        },
        vhs: {
          DEFAULT: "var(--vhs)",
          soft: "var(--vhs-soft)",
        },
        cream: {
          DEFAULT: "var(--cream)",
          dim: "var(--cream-dim)",
          faint: "var(--cream-faint)",
          line: "var(--cream-line)",
          pale: "var(--cream-pale)",
        },
        // brand 兼容：保留旧引用，渐进替换
        brand: {
          DEFAULT: "var(--ember)",
          dark: "var(--ember-deep)",
        },
      },
      fontFamily: {
        display: [
          '"Bricolage Grotesque"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          "system-ui",
          "sans-serif",
        ],
        mono: [
          '"JetBrains Mono"',
          '"SF Mono"',
          "Consolas",
          "monospace",
        ],
      },
      borderRadius: {
        crt: "14px",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translate(-50%, -45%) scale(0.92)" },
          "100%": { opacity: "1", transform: "translate(-50%, -50%) scale(1)" },
        },
        "blur-in": {
          "0%": { opacity: "0", filter: "blur(8px)" },
          "100%": { opacity: "1", filter: "blur(0)" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 180ms ease-out",
        "blur-in": "blur-in 320ms ease-out",
        "slide-up": "slide-up 220ms ease-out both",
      },
      boxShadow: {
        ember: "0 12px 40px -12px rgba(255, 107, 53, 0.55), inset 0 1px 0 rgba(255,255,255,0.18)",
        phosphor: "0 6px 24px -8px rgba(124, 255, 178, 0.45)",
        crt: "0 24px 48px -24px rgba(0, 0, 0, 0.8), 0 0 0 1px var(--ink-edge)",
      },
    },
  },
  plugins: [],
};
