# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

DouyTV — TikTok-style vertical-feed media client (videos + live IPTV + local files) built with **Tauri v2 + React 18 + TypeScript**, targeting Windows / macOS / Linux / Android / iOS from a single codebase. The plugin layer is intentionally **MoonTV-compatible** so existing MoonTV source scripts and config files (`api_site` / `lives` / `custom_category`, including base58-encoded subscriptions) can be installed unmodified.

## Commands

Frontend / Tauri (run from repo root, `pnpm` is the only supported package manager — `pnpm-lock.yaml` is committed):

- `pnpm dev` — Vite dev server (port 1420, strict). Mostly used by `tauri dev`.
- `pnpm tauri dev` — desktop dev with the Rust shell + auto-reload (this is the normal dev loop).
- `pnpm build` — `tsc` (no-emit type check) then `vite build` → `dist/`.
- `pnpm tauri build` — production native bundle.
- `pnpm tauri android init` / `pnpm tauri android build --apk` — Android (CI auto-runs `init` each build).
- `pnpm tauri ios init` / `pnpm tauri ios build` — iOS.

There are **no test runners and no linter configured** — type checking via `tsc` (run by `pnpm build`) is the only static gate. TypeScript is `strict` with `noUnusedLocals` / `noUnusedParameters` on; the build will reject dead bindings, so prefer to remove unused code rather than prefix-underscore it.

CI: `.github/workflows/build.yml` runs the desktop matrix (win/linux/macos-arm64/macos-intel) plus Android APK and iOS IPA on every push; tagged pushes (`v*`) cut a GitHub Release.

## Architecture

### Frontend layout (`src/`)

- `pages/` — route components, mapped in `App.tsx`. Top-level routes: `/` (Home feed), `/library`, `/live`, `/local`, `/scripts`, `/search`, `/settings/*`, `/detail/:scriptKey/:vodId`, `/play/:scriptKey/:vodId/:playbackIdx/:epIdx`. The `HIDE_NAV_PREFIXES = ["/play","/detail"]` list controls when the side/bottom nav hides.
- `components/VideoFeed/` — vertical drag-to-snap pager (framer-motion `drag="y"` + snap threshold). Only mounts current ± 1 `VideoPlayer` so HLS manifests can pre-parse for instant playback on swipe.
- `components/VideoPlayer/` — single 50k-LOC component wrapping hls.js + native `<video>`, including custom controls, gesture handling, and the "re-resolve" fallback used when a URL goes stale.
- `stores/` — zustand slices. Each store owns its own persistence (mostly `localStorage` under `douytv:*` keys; `library` upgrades to SQLite when running under Tauri and one-shot migrates legacy localStorage rows).
- `hooks/` — `useFeed` (recommendation pipeline), `useDetail`, `useSearch`, `useViewport` (desktop/mobile breakpoint that drives nav choice).
- `lib/` — `db.ts` (SQLite handle, throws outside Tauri), `proxy.ts` (frontend side of `dyproxy://`), `configFile.ts` (MoonTV-style JSON + base58 subscription parsing), `recommend.ts` (rankAndShuffle), `epg.ts`, `thumbnail.ts`.
- `source-script/` — the plugin runtime; see below.
- `types/media.ts` — single canonical `MediaItem` shape consumed by feed, player, library, history.

### Source-script protocol (`src/source-script/`)

This is the heart of the app. Plugins are user-supplied JS that returns an object with up to 5 hooks: `getSources / search / recommend / detail / resolvePlayUrl`. Each hook receives a `ctx` with `fetch`, `request.{get,getJson,getHtml,post}`, `html.load` (cheerio), `cache`, `log`, `utils`, `config`, and `runtime` metadata. Scripts are compiled with `new Function(code)` and cached by source-code hash (`runtime.ts`).

Two descriptor types share the same hook surface:
- `type: 'script'` — user JS in `desc.code` (default; matches MoonTV).
- `type: 'cms'` — `desc.api` is a MoonTV CMS V10 endpoint; `cms.ts` synthesizes a `ScriptModule` that calls `?ac=videolist&wd=…` / `&ids=…` and parses `vod_play_url` (`$$$` between playbacks, `#` between episodes, `$` between title and URL).

`scriptFetch` (`fetch.ts`) is the single network entry-point used by every plugin. Under Tauri it goes through the Rust `script_http` command (ureq, bypasses WebView CORS, honours the user's proxy from `useProxyStore`); in the browser dev environment it falls back to `window.fetch` (subject to CORS — used only for quick iteration).

Builtin demo source (`builtin.ts`) is injected on first hydrate if no script with that key is stored — it points at Google/Blender/Mux public test videos and validates the whole pipeline without network.

### Rust backend (`src-tauri/src/lib.rs`)

Three responsibilities:

1. **`script_http` Tauri command** — ureq-based HTTP for source scripts, with optional `proxy_url` (http/socks5). The single command serves both raw page fetches and the CMS API.
2. **`scan_local_videos` Tauri command** — recursive directory walk (depth-limited, hidden-dir-skipping) for the Local page.
3. **`dyproxy://` URI scheme handler** — registered via `register_asynchronous_uri_scheme_protocol` and dispatched onto `spawn_blocking` (the IPC thread must return immediately or HLS segment storms cause `PostMessage failed / 0x80070578`). It:
   - Fetches the upstream with a custom UA / Referer / optional proxy.
   - Detects m3u8 three ways: URL path ending `/m3u8`, upstream `Content-Type` containing `mpegurl`, or body starting with `#EXTM3U` (handles upstream content-type misconfiguration).
   - For m3u8: rewrites every `URI="..."` attribute (KEY/MAP/MEDIA/I-FRAME-STREAM-INF) and every relative segment line back to a `dyproxy://` URL so hls.js stays inside the proxy. Lightweight ad filter strips `#EXT-X-DISCONTINUITY` and segments matching `ADS_KEYWORDS` (sponsor / ad / advert / redtraffic).
   - For everything else: binary passthrough with CORS + Range headers (so MP4 seeking works).

SQL migrations are declared inline in `run()` (`favorites` + `history` tables, with later `ALTER TABLE history ADD COLUMN episodes_watched`). The frontend opens this DB via `tauri-plugin-sql` (`sqlite:douytv.db`) in `src/lib/db.ts`.

### Custom URI scheme on Windows / Android

`dyproxy://localhost` works on macOS/iOS/Linux, but **WebView2 (Windows) and Android WebView refuse XHR/fetch to non-standard schemes**. Both the frontend (`src/lib/proxy.ts`) and the Rust m3u8 rewriter (`src-tauri/src/lib.rs#proxy_origin`) detect platform and emit `http://dyproxy.localhost` on those targets instead. **Any new code that constructs a `dyproxy://` URL must use one of these helpers, not a hard-coded string** — otherwise Windows/Android will silently fail to load segments.

### Persistence model

- **localStorage** — anything that needs to survive a refresh without a Tauri shell: scripts (`douytv:scripts`), live channels + subscriptions (`douytv:live-*`), config-file subscriptions (`douytv:config-subscription-*`), proxy settings, sidebar collapsed state, onboarded flag. Keys are all `douytv:` prefixed.
- **SQLite** (`sqlite:douytv.db` via `tauri-plugin-sql`) — `library` store uses this for favorites + history when `isSqlAvailable()`, with a one-time migration from the legacy `douytv:favorites` / `douytv:history` localStorage arrays. Outside Tauri (web preview), it transparently falls back to localStorage.

Both layers merge rather than overwrite on hydrate — see `mergeFavorites` / `mergeHistory` in `stores/library.ts` — because users can interact (toggle a favorite) before the async hydrate completes, and a naive `set` would clobber the in-flight change.

### Design system

CRT / "After Hours" aesthetic, **not** generic modern flat UI:
- Colors are CSS variables in `src/styles.css` and surfaced through Tailwind tokens (`ink`, `ember`, `phosphor`, `vhs`, `cream`). Use these tokens, don't hard-code hex.
- Fonts: `Bricolage Grotesque` (display) + `JetBrains Mono` (numeric/code), loaded from Google Fonts in `index.html`.
- All icons are hand-drawn SVG in `components/Icon/Icon.tsx` (24×24, `stroke=1.6`, `currentColor`). **Do not introduce emoji or external icon libraries** — the visual language is deliberately uniform.
- Reusable visual primitives: `.scanlines`, `.crt`, `.glow-ember`, `.chip-ch`, `.rec-dot`, `.signal-bars`, plus animation keyframes (`sheet-up`, `slide-in-right`, `fade-in`, `toast-in`).

## Gotchas

- **Rust toolchain pinning**: `Cargo.toml` deliberately uses `ureq` rather than `reqwest` to avoid `encoding_rs`'s incompatibility with `rustc 1.95` (no_std prelude regression — `Some`/`None`/`Vec` become unreachable in dependent crates). If the local build mysteriously fails on `encoding_rs` / `flate2` / `infer`, downgrade via `rustup default 1.84` rather than patching deps.
- **Don't use the IPC main thread for HLS work in Rust**. Anything inside `register_asynchronous_uri_scheme_protocol` must `spawn_blocking` before doing ureq calls — HLS pulls hundreds of segments per minute and will deadlock IPC otherwise.
- **framer-motion drag eats clicks**. The vertical feed wraps everything in `motion.div drag="y"`; any button rendered as a child needs `onPointerDownCapture={(e) => e.stopPropagation()}` (or `e.preventDefault()` on the relevant pointer event) — see `InteractionBar` for the working pattern. Without this, the drag handler captures the pointer and `click` never fires.
- **Local file scanning is depth-limited** (`max_depth = 4` in `scan_local_videos`). Bumping this without a UI affordance can hang the scan on deep filesystems.
- The script compile cache (`compiledCache` in `runtime.ts`) keys on a 32-bit hash of the source code. If you mutate a script's `code` in place without updating `updatedAt`, the cache will still serve the old module — always go through `useScriptStore.update`.
