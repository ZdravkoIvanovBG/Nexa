# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

Package manager is `pnpm` (workspace uses `vite-plus`, invoked as `vp`). Node 24 LTS, Rust stable.

```bash
pnpm install
pnpm run setup          # fetches native sidecars (libmpv, mpv, yt-dlp, ffmpeg) into src-tauri/ — required once before first build
pnpm tauri dev           # full desktop dev app
pnpm dev                 # frontend-only dev server (vite), hot reload, no Tauri shell
pnpm run check           # vp check — lint + fmt check for changed files (run before considering a TS/JS task done)
pnpm run typecheck       # tsc -b --pretty false (run after any TypeScript change)
pnpm run lint            # vp lint
pnpm run fmt             # vp fmt (auto-fix formatting; pre-commit hook runs `vp staged`)
pnpm run test            # node --test tests/*.test.ts
node --test tests/svp-policy.test.ts   # run a single test file directly
pnpm build                # tsc -b && vp build (frontend compiles)
pnpm tauri:build:linux-system   # full Linux binary via tauri.linux-system.conf.json
pnpm run i18n:check        # verifies locale JSON files have matching keys/placeholders
```

Rust:

```bash
cargo check --manifest-path src-tauri/Cargo.toml     # after any Rust change in src-tauri
cargo test --manifest-path harbor-core/Cargo.toml    # harbor-core unit tests
wasm-pack build harbor-core --target web              # rebuild the WASM build of harbor-core (web-only fallback path)
```

There are four Tauri config variants under `src-tauri/`: `tauri.conf.json` (default/macOS/Windows), `tauri.windows.conf.json`, `tauri.linux-system.conf.json`, `tauri.flatpak.conf.json`. Pick the one matching the target when building for Linux packaging.

CI (`.github/workflows/ci.yml`) runs two independent jobs: `quality` (fmt check, `vp check`, typecheck, test — frontend only, scoped to changed files) and `native` (`cargo check` for `src-tauri` and `harbor-core`, skipped entirely if neither directory changed). Match this locally before pushing.

## Architecture

Harbor is a Tauri 2 desktop app (also runnable in a plain browser as a degraded "web" mode): a React 19 + TypeScript frontend renders the whole UI, and a Rust shell (`src-tauri/`) owns native integrations — playback, casting, OS behavior, sidecars. `harbor-core/` is a separate Rust crate with no Tauri dependency, holding pure protocol logic shared by both the native shell and (via wasm-bindgen) the browser.

```
src/                 React frontend
src-tauri/            Rust shell: Tauri commands, mpv, casting, sidecars
harbor-core/          pure Rust: stream parse/trust/score, compiled to rlib (native) and WASM (web fallback)
cast-receiver/        web cast receiver app (separate from the main frontend)
```

### Frontend structure (`src/`)

- `router/` — TanStack Router shell. `router/sync.tsx` is a bidirectional bridge between a legacy in-memory "view stack" (`src/lib/view.tsx`, root tab + nested frames like meta/player) and the router's URL path (`router/paths.ts`). Not everything is migrated to router-driven state yet — nested stack frames stay view-only.
- `views/` — one entry point per room/screen (home, movies, shows, anime, live, player, settings, ...), each usually paired with a same-named folder for its sub-components.
- `chrome/` — the app shell around views: sidebar/topbar/dock variants per theme (nord, dracula, forest, royal, minui, stremio-rail), window controls.
- `components/` — shared, reusable UI components used across views.
- `lib/` — framework-independent business logic, one concern per module (addons, auth, cast, debrid, discover, i18n, player, streams, trakt, iptv/dvr, theme, together (watch parties), ...). Prefer putting logic here over inside components; components should stay thin.
- `lib/player/` — the mpv-facing player logic (bridge, subtitle handling, HDR/tonemap policy, SVP, anime4k modes). `lib/player/bridge.ts` defines the pure/derived state shape (`PlayerStatus`, loading-surface logic) kept in sync with native mpv events — see Playback rules in AGENTS.md.
- `lib/streams/` — the frontend half of the stream ranking pipeline (see below).

### The stream ranking pipeline (parse → trust → score → rank)

This logic exists in **two places that must stay behaviorally in sync**:

1. `harbor-core/src/{parser,trust,scoring}.rs` — the canonical Rust implementation.
2. `src/lib/streams/{parser,trust,scoring}.ts` — a parallel TypeScript implementation.

At runtime, `src/lib/streams/pipeline.ts` (`runCorePipeline`) tries the **native path first**: when running inside Tauri, it calls the `streams_run_pipeline` command (`src-tauri/src/streams.rs`), which calls `harbor-core` directly as a linked Rust crate (not WASM — that's a separate build target only used for the plain-browser/web build). If not running in Tauri, or the native call throws, it falls back to the pure-TS pipeline in `src/lib/streams/`. When changing ranking/parsing/trust behavior, check whether both the Rust and TypeScript implementations need the change — a fix in one place can silently leave the other path with the old behavior.

`tests/ci-native-change-detection.test.ts` guards that CI's native-change detection watches all of `src-tauri` and `harbor-core` — a meta-test on the CI config itself, not on the pipeline behavior.

### Native shell (`src-tauri/src/`)

Notable modules: `mpv.rs`/`mpv_render_{linux,mac}.rs` (player), `cast.rs`/`cast_server.rs`/`cast_hls.rs`/`cast_subs.rs`/`dlna.rs`/`airplay.rs`/`roku.rs` (casting), `torrent_engine/` (bundled torrent streaming), `subsync/` (subtitle sync), `cf_relay.rs` (Together watch-party relay deploy to the user's own Cloudflare account), `discord_rp.rs` (Rich Presence), `web_server.rs` (local HTTP surface for the WebView/cast receiver), `settings_store.rs`, `local_lib.rs`/`local_lib` (local file library).

Keep platform-specific window/player logic (`pip_mac.rs`, `fullscreen.rs`, `mpv_render_linux.rs` vs `mpv_render_mac.rs`) isolated per-platform rather than branching deep inside shared logic — see AGENTS.md.

### Tests

`tests/*.test.ts` run under Node's built-in test runner (`node --test`), not Vitest, despite `vitest` being pinned in the workspace catalog for other tooling. Tests are plain `.ts` files using `node:assert/strict` and `node:test`, often targeting a single `lib/` module's pure logic (e.g. `player-buffer-policy.test.ts`, `svp-policy.test.ts`, `subtitle-autoload.test.ts`) or a CI/config invariant (`ci-native-change-detection.test.ts`).

## Key third-party integration points

- Playback engines: native libmpv (primary, bundled sidecar), hls.js and mpegts.js for live/broadcast, HTML5/WebView2 as an alternate engine — see `src/lib/player/`.
- Metadata/services are all optional, user-supplied API keys (TMDB, RPDB, OMDB, Fanart.tv, Trakt, debrid providers) — nothing is bundled or required; Cinemeta works with no key.
- `stremio-server` and `yt-dlp` are bundled sidecar binaries fetched by `pnpm run setup`, not built from source in this repo.
