# M6.5 T2d — stronghold-Rust-side config load — research doc

Date: 2026-05-14
Author: @researchant (research-only, no code changes)
Status: RESEARCH-DOC. T2d implementation claim-first AFTER canonical PASS.
Cap: ≤180L.

## TL;DR (delta-3: T2d-1 all-in-JSON v1 + T2d-2 split-source)

T2d replaces env-var PollerConfig fallback with file-backed config.
Per partial-framing now formally split into TWO sub-slices:

**T2d-1 (current shipped disk)**: all three values (serverUrl, roomId,
bridgeToken) loaded from `app_data_dir()/ant-desktop-config.json` via
plain JSON read. Operator hand-creates the file with chmod 600 in v1;
single-user desktop threat model accepts file-system-protected token.
Returns None gracefully when file missing/corrupt → env-var fallback
preserves dev workflow.

**T2d-2 (next slice)**: PROPER split-source. Wizard writes JSON for
serverUrl+roomId via tauri-plugin-fs (or via a Rust-exposed
tauri::command save_config wrapper); stronghold continues to hold
bridgeToken; Rust reads JSON for non-secret + raw iota_stronghold for
token. Argon2 derivation reproduction lives here.

## Q1 — Rust-side load path (delta-1: B1 lock — NOT plugin state)

**B1 CORRECTION (canonical 2026-05-14)**: tauri-plugin-stronghold v2.3.1
keeps `StrongholdCollection` private — `app.state::<StrongholdCollection>()`
is non-implementable. Three viable paths instead:

**Option A (recommended)**: side-channel CONFIG FILE at first-run wizard
time. Wizard writes a plain JSON config at `app_data_dir()/ant-desktop-
config.json` containing `{ serverUrl, roomId }` alongside the stronghold
write of bridgeToken. Rust reads the JSON via std::fs + reads
bridgeToken from stronghold via Option B's raw iota_stronghold path
(narrow scope: token-only). Cleanest separation: non-secret config in
plain JSON; secret bridgeToken in stronghold.

**Option B (fallback)**: raw `iota_stronghold` crate to open the same
snapshot file directly. Requires reproducing plugin's argon2 derivation
exactly. Higher coupling.

**Option C**: invoke the plugin's already-registered commands from Rust
via tauri::AppHandle::invoke (if exposed) — verified-needed.

**Default proposal**: Option A. Sidesteps the private-type problem;
keeps the secret-vs-config split clean.

## Q2 — Stored-record contract (delta-1: B2 wizard-write extension)

**B2 CORRECTION (canonical 2026-05-14)**: m6.4 wizard currently saves
only `serverUrl` + `bridgeToken`, NOT `roomId`. T2d cannot require
`roomId` from stronghold without first extending the wizard. Two paths:

**Option B2-A (recommended)**: extend the wizard to ALSO save `roomId`.
Tiny diff (~5L) to web/index.html — add a third input field +
saveEntry call. Slice this as a wizard-write precondition delta inside
T2d acceptance OR as a separate mini-slice.

**Option B2-B**: derive `roomId` from a stronghold-stored mapping that
the user-side ANT API surfaces (e.g. GET /api/auth/me → primary room).
Adds a new ANT API dependency and round-trip; rejected — JWPK no-fork.

**Default proposal**: B2-A. Wizard adds roomId input; Rust reads via
the Option A JSON config file (alongside serverUrl). bridgeToken stays
in stronghold (only secret). Password parity for stronghold-secret-load:
hardcode `'ant-desktop-v1-placeholder'` for v1 (matches wizard); machine-
bind in m6.6 clean-machine slice.

## Q3 — Verification strategy

Three options:
- **Integration test**: spawn a tokio test that mocks the dialog
  plugin (returns Ok(true)) + mocks reqwest with httpmock; assert
  spawn_with_consent → PtyRegistry::spawn called with expected args
  on a parsed pty_spawn message. Pure unit, no live infra.
- **Live :6461 proof**: kickstart com.ant.fresh, set
  ANT_DESKTOP_SERVER_URL/BRIDGE_TOKEN/ROOM_ID env vars (legacy fallback
  while stronghold lives at vault path bound to .app's current_exe
  parent — different from Rust harness), spawn the .app, post a
  pty_spawn message into the configured room, observe local PTY
  appearing in registry.list().

**Default proposal**: integration test for the mock-driven path
(deterministic, runs in CI). Live :6461 proof recommended as a one-shot
manual smoke before slice closure but not required for canonical PASS.

## Touch points (for T2d implementer)

- EDIT src-tauri/web/index.html: ADD `roomId` input + saveEntry per B2-A.
  Plain JSON config write at app_data_dir()/ant-desktop-config.json
  containing { serverUrl, roomId }; bridgeToken stays in stronghold.
- NEW src-tauri/src/strongholdcfg.rs ≤80L: `load_poller_config(app:
  &AppHandle) -> Option<PollerConfig>` reads JSON config + Option B
  raw iota_stronghold for bridgeToken-only secret read.
- EDIT src-tauri/src/lib.rs setup: try strongholdcfg::load_poller_config
  FIRST; env-var fallback if None.
- NEW src-tauri/src/poller.rs test seam: cfg(test) reqwest injection.

## Locked acceptance (split into T2d-1 + T2d-2 sub-slices)

T2d-1 (THIS slice — JSON config + lib.rs wiring):
- NEW src-tauri/src/strongholdcfg.rs with `load_poller_config(app_data_dir)
  -> Option<PollerConfig>` reading all three values from JSON.
- Returns None on missing/corrupt/empty-field; lib.rs env-var fallback.
- Wizard EXTENDS to collect roomId input (B2-A).
- 4+ unit tests covering all None paths + happy path.
- cargo check + cargo test + code-qa green.

T2d-2 (delta-4: split into T2d-2a + T2d-2b + T2d-2c sub-slices):

**T2d-2a (THIS slice — wizard JSON write via Rust command)**:
- NEW src-tauri/src/configcmd.rs ≤80L: tauri::command
  `save_desktop_config(server_url, room_id, bridge_token)` writes JSON
  to app_data_dir()/ant-desktop-config.json (atomic via tempfile+rename).
- EDIT src-tauri/src/lib.rs: register configcmd::save_desktop_config
  in invoke_handler.
- EDIT src-tauri/web/index.html: call `invoke('save_desktop_config',
  {...})` after the stronghold writes (defence-in-depth: stronghold
  remains the canonical token-store; JSON file is the Rust-side
  bootstrap source for poller config).
- 3+ unit tests on configcmd: write+read roundtrip, missing-fields-
  rejected, atomic-replace semantics.

**T2d-2b (DEFERRED — raw iota_stronghold bridgeToken read)**:
- strongholdcfg.rs adds raw iota_stronghold path for bridgeToken-only.
- Argon2 derivation reproduces tauri-plugin-stronghold's hash.
- Replaces the JSON bridgeToken read once parity verified.

**T2d-2c (DEFERRED — integration test)**:
- httpmock + mock-dialog via cfg(test) seam in poller.rs.
- Proves spawn_with_consent dispatch end-to-end deterministically.

Plan event m6.5-t2d-* status=done per sub-slice.

## Do-not-use

| Rejected | Why |
|---|---|
| Use raw iota_stronghold for non-secret config | Plain JSON side-channel is simpler. iota_stronghold reserved for SECRET bridgeToken-only read in T2d-2. |
| Reject all-in-JSON v1 outright | T2d-1 ships all-in-JSON for v1 with explicit chmod 600 + single-user threat model rationale; T2d-2 migrates to split-source. |
| Skip password constant matching | Vault opens with wrong key → silent zero records. |
| Live-only proof (no integration test) | Non-deterministic; CI can't run. |
| Hardcode server URL in Rust | Defeats m6.4 first-run-wizard purpose. |

## Open questions for JWPK

1. Machine-bound password derivation (hostid/IOPlatformUUID) for v2 vs
   stay with hardcoded constant for v1? Default: hardcoded for T2d;
   machine-bind in m6.6 clean-machine acceptance proof slice.
2. If stronghold vault is missing/corrupt at startup, fall back to env
   vars silently OR show first-run wizard? Default: env-var fallback
   silently (matches current dev workflow); first-run wizard launch
   is a UX-followup slice.

## What I did NOT verify

- Did NOT prototype the raw-iota_stronghold bridgeToken read path; plugin
  uses argon2 derivation that needs reproducing exactly in Rust caller.
- Did NOT prototype the JSON config-file write/read paths; assumes
  Tauri 2 app_data_dir() resolves consistently across dev + bundled .app.
- Did NOT measure integration-test runtime; assume <500ms p95.

## Next step

Awaiting canonical RQO PASS + JWPK ACK on Q1-Q3 defaults. T2d impl
proceeds claim-first under Locked Acceptance once both land.
