# Phase 6 — Distribution + Native App — design contract (m6.3)

Date: 2026-05-14
Author: @researchant (research-only scout, no code changes)
Status: DESIGN-FIRST. No m6.4 implementation claim until canonical PASS.
Cap: ≤180L. Maps to JWPK Phase 6 milestone m6.3-tauri-design-contract.

## TL;DR (delta-2: THIN-CLIENT LOCK per JWPK 2026-05-14)

Phase 6 ships fresh-ANT as a Tauri 2.x native desktop app that is a
**THIN CLIENT** — connects to the main ANT server (Tailscale-hosted or
operator-supplied), does NOT bundle fresh-ANT server locally. JWPK
architectural lock: Tauri is the shell + native capability boundary;
Fresh-ANT/v4 remains the server/control plane. No product fork.

JWPK Phase 6 milestone structure (6 milestones):
- M6.1 macOS Homebrew rail (CLI/dev install) — separate slice
- M6.2 Windows Scoop rail (CLI/dev install) — separate slice
- M6.3 THIS DOC — Tauri native app DESIGN contract (Mac+Windows first, Linux later)
- M6.4 Tauri desktop MVP — invite-first onboarding, secure token storage,
  table/grid/chat UI, NO local server
- M6.5 Local terminal bridge — controlled native-side PTY exposed via API
- M6.6 Clean-machine acceptance proof — clean Mac + Windows install proven

## Q1 — Tauri version pinning

**Default**: Tauri 2.x stable (latest minor at slice-claim time, pinned
in package.json). Tauri 2 is the current GA branch with macOS notarisation
support, native window-state plugin, and proper sidecar lifecycle. Tauri
1.x is feature-frozen and unsuitable for a v4 baseline.

## Q2 — Signing identity + notarisation (delta-4: M6.6 scope)

**Default proposal**: macOS Developer ID + notarisation via `xcrun
notarytool`; Windows Authenticode (JWPK-supplied cert); Linux AppImage
unsigned. M6.4 desktop MVP ships unsigned local-build artifacts only —
signing + notarisation wire in at **M6.6 clean-machine acceptance proof**,
which owns the release pipeline + signed-binary distribution.

**JWPK-blocking**: provision Apple Developer ID + team-id + Windows
Authenticode cert before M6.6 lands. M6.3/M6.4 do not need the certs.

## Q3 — Connection model (delta-2: THIN-CLIENT LOCK)

**JWPK lock (2026-05-14)**: Tauri app is a THIN CLIENT. It connects to
the operator's main ANT server (Tailscale-hosted or self-hosted) via
HTTPS. NO bundled fresh-ANT server, NO sidecar process, NO local
node/better-sqlite3 dependency. First-run wizard prompts for server URL
+ accepts an invite-token (M6.4 onboarding scope). Server URL persisted
to OS keychain alongside the bridge token.

**REMOVED from delta-1 (no longer applicable)**: externalBin /
per-target-triple binaries / bundle.resources for build/+node_modules /
sidecar runtime command. The thin-client flip eliminates the entire
sidecar packaging surface. Apps ship as pure Tauri shells.

**Implication**: build artifacts shrink dramatically (~5MB Tauri shell
+ static assets vs the ~100MB bundled-server estimate). better-sqlite3
ABI / Node version mismatch concerns disappear entirely from the
client-side bundle.

## Q4 — Rust toolchain version

**Default**: Rust stable channel via `rustup`, minimum 1.77 (Tauri 2.x
requires 1.77+). Pin in `rust-toolchain.toml` so contributors get the
right version automatically. CI uses `actions-rs/toolchain` or the
official `dtolnay/rust-toolchain` action.

## Q5 — UI rendering (delta-2: thin-client implications)

With THIN-CLIENT LOCK there are two clean options for what the Tauri
webview displays:
- **Option A (recommended)**: webview navigates to the remote ANT server
  URL directly (e.g. `https://<ANT_SERVER_HOST>:6461`). The
  existing SvelteKit adapter-node SSR + API routes serve the UI exactly
  as today; Tauri is purely a chrome wrapper. ZERO UI refactor needed.
- **Option B (defer to v2)**: ship a static SvelteKit build (adapter-static)
  inside the Tauri app, fetch data from remote ANT API. Decouples client
  app version from server but requires UI route refactor (server-only
  routes can't render).

**Default proposal**: Option A for M6.4 v1 — minimum viable thin client.
adapter-node stays untouched. Option B remains an upgrade path if M6.x+
needs offline-cache or fast cold-start.

## Q6 — Window state persistence

**Default**: `@tauri-apps/plugin-window-state` (official plugin) — saves
size+position+maximised state per window to the standard OS config dir.
No custom code. Plugin handles multi-window cases when m6.x adds them.

## Q7 — Native menu shape

**Default proposal (minimal v1)**: standard macOS App menu (About / Hide /
Quit) + Edit menu (Cut/Copy/Paste/SelectAll for the webview) + Window menu
(Minimise/Zoom) + Help menu (Open documentation / Open issue tracker).
NO custom verbs in v1. m6.x can extend later.

## Q8 — Boundary handoffs to other m6.x milestones

JWPK 6-milestone structure (re-iterated for clarity):
- **M6.1 macOS Homebrew rail** — `brew install ant` for the CLI/dev path
  (separate from the Tauri app entirely; SHIPS the `ant` CLI binary, not
  the desktop app). Owned outside this design.
- **M6.2 Windows Scoop rail** — `scoop install ant` for the CLI/dev path
  (Windows mirror of M6.1). Separate slice.
- **M6.3 (THIS DOC)** — Tauri native app DESIGN contract. Implementation
  lives in M6.4.
- **M6.4 Tauri desktop MVP (thin-client)** — implementer takes this doc
  and ships the Tauri shell. No release/signing scope here.
- **M6.5 Local terminal bridge** — controlled native-side PTY exposed to
  ANT via the existing API. Separate slice; M6.3 contract is shell-only.
- **M6.6 Clean-machine acceptance proof** — clean Mac + Windows install
  verified end-to-end. Owns release/signing/notarisation as part of the
  proof bar. Apple Developer ID + Authenticode cert wire in HERE.


## Touch points (for m6.4 implementer — thin-client)

- NEW `src-tauri/` directory: `Cargo.toml`, `tauri.conf.json`,
  `src/main.rs` (Tauri 2.x scaffold).
- NEW root-level `package.json` script: `tauri` → `tauri` CLI passthrough.
- EDIT root `.gitignore`: add `src-tauri/target/` + `src-tauri/gen/`.
- NEW `rust-toolchain.toml` pinning stable.
- NEW first-run wizard component: prompts server URL + invite-token.
  Slice 1 = localStorage placeholder; Slice 2 = stronghold/keychain.
- README addition: `bun tauri dev` instructions (lands with Slice 3).
- NO src-tauri/binaries/ (no sidecar — thin client per Q3).
- NO src-tauri/resources/build/ (UI loads from remote per Q5).

## Locked acceptance (delta-5: 3-slice partial-framing 2026-05-14)

M6.4 ships in three canonical-PASS chunks per partial-framing discipline.

**SLICE 1 `m6.4-structural`**: src-tauri/ scaffold + first-run wizard
HTML (localStorage placeholder; stronghold = slice 2) + rust-toolchain
+ package.json `tauri` script + .gitignore. `tauri info` recognises;
check/code-qa/build green; additive-only; thin-client (no bundled server).

**SLICE 2 `m6.4-followup-stronghold`**: replace localStorage with
tauri-plugin-stronghold (or platform keychain) — Rust plugin init + JS
bindings + cross-platform abstraction.

**SLICE 3 `m6.4-followup-tauri-build-proof`** (macOS-only): live
`bun tauri build` → .app + .dmg unsigned + .app launch proves dev-window
opens. Windows .msi DEFERRED to Slice 4.

**SLICE 4 `m6.4-followup-windows-msi-proof`**: Windows .msi via cross-
compile or real Windows host. JWPK-blocking on Windows toolchain.
Each slice posts its own `m6.4-*` plan event after canonical PASS.

## Do-not-use

| Rejected | Why |
|---|---|
| adapter-static for SvelteKit | Breaks SSR routes + API endpoints. |
| Run Node embedded in Tauri webview | Webview is JS-only, no Node runtime. |
| Pin Tauri 1.x | Feature-frozen; v4 baseline must be on 2.x. |
| Sign in m6.4 | Signing/notarisation is M6.6 clean-machine-proof scope. |
| Custom window-state code | Use the official plugin. |

## Open questions for JWPK

1. Apple Developer ID + Authenticode cert: confirm before M6.6 lands.
2. Default first-run server URL: blank vs JWPK Tailscale pre-filled? Default: blank.
3. v3+v4 coexistence: same .app bundle vs separate apps? Default: separate.

## What I did NOT verify

- Did NOT prototype Tauri code; design only.
- Did NOT enumerate OS keychain API per platform; assumes stronghold/keyring covers macOS+Windows.
- Did NOT measure thin-client bundle size empirically (~5MB estimate).

## Next step

Awaiting canonical RQO PASS + JWPK ACK on Q1-Q9 defaults. M6.4 impl
claim-first under Slice 1 acceptance once both land. M6.3 = design-only;
m6.1/m6.2/m6.5/m6.6 have separate design surfaces.
