# Music Module Migration Plan

Goal: migrate MoonTVPlus music behavior into DouyTV so LX/MoonTV-compatible music sources play through the same stable stream flow, with a complete music page, player, settings surface, and room for other source/plugin imports.

## Phase 1 - Current Health And MoonTV Contract
Status: complete

- Verify current TS/Rust build state.
- Re-read DouyTV music/proxy/store files and MoonTVPlus music API/page files.
- Record source/playback contract differences.

## Phase 2 - Playback Compatibility
Status: complete

- Fix local stream proxy compilation/runtime issues.
- Ensure LX playback uses a stable local stream URL that resolves real media URL on demand.
- Preserve Range/user-agent/referer/origin forwarding so full tracks play.

## Phase 3 - Discovery And Source APIs
Status: complete

- Add MoonTV-compatible leaderboard, playlist, playlist detail, tags, and hot-search helpers.
- Keep adapters open for lx-music-source, lx-music-api-server, MusicFree, and aggregate HTTP sources.

## Phase 4 - Music Store And Settings
Status: complete

- Expand persisted state for source settings, playback settings, history, queue, favorites, playlists, quality, mode, volume, and sleep timer.
- Add source/settings management UI inside the music module.

## Phase 5 - Music Page And Player
Status: complete

- Replace the placeholder page with a MoonTV-like music center: discover, rankings, playlists, search, library, queue, lyrics, and player controls.
- Fit DouyTV visual language without copying MoonTV theme colors directly.

## Phase 6 - Verification
Status: complete

- Run frontend build and Rust cargo check.
- Confirm generated LX audio src is local stream proxy for Tauri and not short-lived direct preview URLs.

## Phase 7 - Runtime Dev Server Check
Status: complete

- Confirm Vite can start normally in foreground at `http://127.0.0.1:5173/`.
- Attempt background startup for local preview.
- Record current shell-host limitation: background child processes created from the tool exit or fail to retain stdio/console state, while foreground Vite itself is healthy.

## Phase 8 - Music Page Visual Refactor
Status: complete

- Refactor the music page toward the 21-29 reference screens: music center, search, player detail, immersive lyrics, equalizer/settings, and library profile.
- Keep the existing MoonTV/LX playback and source-resolution logic intact.
- Add page-scoped music styles for hero, rails, search, library, bottom player, and drawers.
- Run frontend build verification.

## Phase 9 - Homepage Music Recommendation Feed
Status: complete

- Replace the homepage music static placeholder with a real recommendation feed.
- Load recommendations from enabled music sources, MoonTV-compatible music discovery APIs, hot search, fallback source search, and local listening signals.
- Support vertical swiping, in-feed playback, progress, favorite, queue, share, detail entry, refresh, cache restore, and mobile safe-area layout.
- Run frontend build verification.

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| Tried reading `tailwind.config.js` and `src/index.css`, but project uses `.cjs` and `src/styles.css`. | 1 | Switched to `rg --files` and found actual files. |
| `rg` treated `--cream` pattern as a flag. | 1 | Use `rg -e` for patterns starting with `-`. |
| `pnpm.cmd run build` failed after adding discovery helpers due to TypeScript narrowing/cast issues. | 1 | Added explicit hot-search return type and cast LX payload items to the `normalizeLxSong` input parameter type. |
| `pnpm.cmd run build` failed after adding settings hub due to unused icon imports. | 1 | Removed unused imports. |
| `Start-Process` and PowerShell environment enumeration failed due to duplicate `PATH`/`Path` keys. | 1 | Used direct `node node_modules/vite/bin/vite.js` foreground validation instead. |
| Vite CLI/Node API background startup from the tool host exited before listening. | 1 | Verified foreground startup works; treated as tool-host process lifetime limitation, not app build failure. |
