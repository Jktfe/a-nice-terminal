# Changelog

All notable changes to ANT (`a-nice-terminal`) are tracked here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once 1.0 ships.

## [Unreleased]

### Added
- iOS experience catch-up planning is active: safe-area layout, touch hit targets, keyboard reflow, gestures, composer ergonomics, and folder-drawer mobile acceptance criteria.

## [antchat-0.1.0] — 2026-05-06

First release of `antchat`, a single-binary macOS client for joining ANT rooms without running a server. Versioned and released independently of `a-nice-terminal` core via tags of the form `antchat-v*`; binaries are produced by `.github/workflows/release-antchat.yml`.

### Added
- WS1A — multi-token room config with per-room kind/handle/label and exported `parseShareString`
- WS4A — `antchat` skeleton: `join`, `rooms`, `msg`
- WS4B — `antchat chat` (SSE backfill + live), `open`, `tasks`, `plan`, plus macOS osascript notifier and `mentionsHandle()` helper
- WS4C — `antchat mcp serve|install|uninstall|print` (stdio JSON-RPC proxy; cross-platform `claude_desktop_config.json` writer)
- WS4E — `antchat watch run|install|uninstall|status` (LaunchAgent plist + `launchctl bootstrap` with `load -w` fallback)
- WS5A — `bun run build:antchat:{arm64,x64}` + `antchat/scripts/smoke.sh` smoke harness
- WS5B — `.github/workflows/release-antchat.yml` matrix build on macos-14 + macos-13 with tarballs, SHA-256 aggregate, and GitHub Release upload
- WS5C — `homebrew/antchat.rb` formula + `homebrew/update-tap.sh` post-release helper for `Jktfe/homebrew-antchat`
- WS6A — `antchat/README.md` user-facing walkthrough; root README "ANTchat" section

## [0.2.0] — 2026-05-04

### Added
- B1 — folder navigation drawer (Cmd+P / Ctrl+P, plus toolbar and side-panel tap targets for mobile)
- B2 — blocked-prompt visibility surfaced in ActivityRail and SessionList
- B3 — searchable CLI dropdown replacing the native `<select>` in ChatHeader
- B5 — sidebar terminal pinning (localStorage-backed, cross-tab via `storage` event)
- B6 — delete-safety guards on session removal
- B7 — trust-tier hardening on reference panel uploads (R4 §1)
- B9 — fuzzy/scored @-mention matching (B9 scoring algorithm: exact 1000 / prefix 500 / substring 200 / subsequence 50+)
- B10 — upload-hardening: auth + rate limit + content-addressed SHA-256 filenames
- B13 — Add Terminal button in Participants panel (paste join command via existing terminal_input endpoint)
- M1 — browser-reconnect closure: hook capture writes trust:high command_block run_events; OSC 10/11/12/4 colour-query reply filtering
- M2 — WebGL renderer behind feature flag (accepted-with-flag; DOM remains default)
- M3 — CommandBlock rendered from RunEvent with explicit trust-tier gate (raw never rich, medium escaped, high rich)
- M3.5 — Plan View live API + projector data layer; provenance ladder
- M4 — Pi RPC adapter projection (trust:high)
- M5 — Hermes ACP adapter projection (trust:high)

### Changed
- Test layout split: default `bun run test` runs unit tests only (109/109, 0 skipped); `bun run test:integration` covers live-server suites under `tests/integration/`.
- CI now uses Node 20.19.4 + bun (matches the launchd runtime) and drops `continue-on-error` on svelte-check — the green checkmark now means a real 0/0/0.
- `pasteCdToTerminal` shell-quotes paths so folders with spaces or shell metacharacters no longer truncate.

### Security
- Untrusted upload links hardened (M3 §1)
- Reference panel inline image rendering gated on `/uploads/` prefix (B7)
- SvelteKit and Vite updated to audited non-vulnerable ranges; `cookie` forced to a safe transitive version.

## [0.1.0] — 2026-04 (pre-changelog)

Initial v3 architecture: SvelteKit + Node + WebSocket + SQLite (better-sqlite3, FTS5), with PTY daemon survival across server restarts. See [docs/LESSONS.md](docs/LESSONS.md) for design decisions and the commit log for the full history.
