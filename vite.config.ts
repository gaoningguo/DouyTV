import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import path from "node:path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [
    react(),
    // musicSdk（从 lxserver 原样移植）依赖 Node 的 Buffer/crypto/zlib，
    // 在 WebView 里用浏览器实现垫片，使 SDK 源码无需改动即可在前端运行。
    nodePolyfills({
      include: ["buffer", "crypto", "zlib", "stream", "util"],
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "video-vendor": ["hls.js"],
          "parser-vendor": ["cheerio"],
          "animation-vendor": ["framer-motion"],
        },
      },
    },
  },
});
