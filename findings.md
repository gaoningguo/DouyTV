# Music Migration Findings

## Project Context

- DouyTV is a React + Vite + Tauri application with Zustand state.
- Current music implementation files are under `src/pages/Music.tsx`, `src/stores/music.ts`, and `src/lib/music/*`.
- Native stream proxy is `src-tauri/src/stream_proxy.rs`.

## MoonTVPlus Contract To Preserve

- LX source ids: `wy`, `tx`, `kw`, `kg`, `mg`.
- Search endpoint: `GET /api/music/search?name={q}&source={source}&page={page}&limit={limit}`.
- Play endpoint in MoonTV returns a stable stream route, not a direct CDN URL.
- Stream route resolves `/api/music/url` at request time, forwards Range and browser-like headers, and streams upstream bytes.
- The reported 30-35 second playback issue is consistent with using a direct/preview URL instead of MoonTV's stable stream route.
- Discovery endpoints used by MoonTVPlus:
  - `/api/music/leaderboard/boards?source={source}` with fallback source order `[source, kg, kw, tx, wy, mg]`.
  - `/api/music/leaderboard/list?source={source}&bangid={boardId}&page={page}`.
  - `/api/music/songList/list?source={source}&tagId={tagId}&sortId={sortId}&page={page}`.
  - `/api/music/songList/detail?source={source}&id={id}&page={page}`.
  - `/api/music/songList/tags?source={source}`.
  - `/api/music/hotSearch?source={source}` with fallback source order `[source, mg, kw, tx, wy, kg]`.
- MoonTVPlus accepts LX search records without `id` by deriving a stable id from `{source}_{songmid}`.
- MoonTVPlus exposes `flac24bit` in UI but normalizes it to `flac` for LX URL resolution.

## Design Direction

- Music should behave like a real playback surface, not a static placeholder.
- Keep DouyTV's dark system style and compact app navigation.
- Use stable dimensions and fixed content/player areas so mobile bottom navigation is not covered.
