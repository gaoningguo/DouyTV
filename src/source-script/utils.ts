import type { ScriptUtils } from "./types";

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
];

export const utils: ScriptUtils = {
  buildUrl(base, query = {}) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      sp.append(k, String(v));
    }
    const qs = sp.toString();
    if (!qs) return base;
    return base + (base.includes("?") ? "&" : "?") + qs;
  },
  joinUrl(base, p) {
    try {
      return new URL(p, base).toString();
    } catch {
      return p;
    }
  },
  randomUA() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  },
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
  base64Encode(s) {
    return btoa(unescape(encodeURIComponent(s)));
  },
  base64Decode(s) {
    return decodeURIComponent(escape(atob(s)));
  },
  now() {
    return Date.now();
  },
};
