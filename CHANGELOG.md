# Changelog

All notable changes to ANT are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] — 2026-05-23

A polish release on top of `0.2.1` that fixes the JWPK-flagged dogfood layout
bug + lands two visible Concept D feature improvements.

### Fixed

- **Room view no longer duplicates the v0.1.x panel stack alongside the new
  RoomShelf.** The Slice 4 chat lift was bulk-importing
  `LegacyAppShellView`'s side panels (Participants / Focus mode / Open asks /
  Documents / Tasks / Artefacts / Screenshots / Linked rooms) into the
  Concept D `RoomColumn` body, alongside the new RoomShelf tabs in the right
  rail — producing a duplicated panel mess with the chat buried in the
  middle. `ChatRoomView` now takes `showsLegacyHeader: Bool` (default `true`
  for the logged-out / Legacy path); Concept D's `RoomColumn` passes `false`,
  which suppresses both the duplicate legacy header block and the legacy
  `RoomContextPanel` side-panel. `RoomColumn.body` end-state is exactly:
  `VStack { header · dragDropHint · ChatStream · ChatComposer }`. Logged-out
  users on `LegacyAppShellView` are untouched — the lift principle holds.
  (antchat `c666097`)

- **Drag-drop hint is no longer obscured.** Falls out of the layout fix
  above. Drop-hint band paints when a Finder drag enters the room area;
  the label-prompt sheet (`0.2.1`) fires correctly on release.

### Added — Mac client

- **Label-prompt sheet on file drop.** When a file is dragged from Finder
  into a room, a modal sheet opens prefilled with the filename as the
  label. The label is editable per-file (one row per file for multi-file
  drops, capped at 540 pt sheet height). Save uploads with the chosen
  labels; Cancel abandons. Filename extension is preserved server-side
  even if the user wipes it from the label. (antchat `43b14e6`)
- **User Status picker in the room header.** The Screenshot button (which
  was always covered by macOS `⌘⇧4` system shortcut anyway) is replaced
  with a 3-state status menu: **Working** (green dot) · **Away from desk**
  (warn-amber dot) · **Away from office** (muted-grey dot). Selection
  persists locally via `@AppStorage("user.status")`. Server sync +
  cross-room avatar dots + agent-behaviour routing are queued for `0.2.4`
  (status itself is decoration-only this release). (antchat `4e9ed78`)

### Changed

- **Concept D `RoomColumn` body is now strictly minimal.** No more
  legacy-panel hand-offs into the middle column. Any surface that used to
  live there now lives in a dedicated `RoomShelf` tab in the right rail
  (or is removed entirely — the cost / token meter stays out per the
  remoteant chrome cleanup).

### Install / upgrade

```sh
brew upgrade --cask antchat
```

Existing `0.2.1` users will be migrated transparently. Server-side
unchanged.

---

## [0.2.0] — 2026-05-23

A full rewrite of the macOS thin-client (`remoteant`) around the **Concept D**
design — light-mode, native macOS chrome, persistent operations awareness, and
room-deep focus in the same window. Server-side `a-nice-terminal` is unchanged
from `0.1.x` except for the minor surfaces noted below; this release is mostly
about the Mac surface.

### Added — Mac client (`remoteant`)

- **Concept D shell** — `NavigationSplitView` with a 224 w sources sidebar, a
  340 w Today operations column, and a flexible room column composed via
  `HStack` in the detail slot (banked architecture pattern: 2-column NavSplitView
  + HStack-in-detail; 3-column was rejected for fighting `@AppStorage`-driven
  independent collapse on macOS).
- **Sources sidebar** — Today / Asks / Rooms / Library / Agents / Vault / Memory
  with `@AppStorage("sources.selected")` persistence, plus a reorderable
  **Saved Rooms** section (drag-grip handles + ★ pin toggle + undo on
  unsave) and an **On this Mac** stub list (Finder · ANT Vault / Calendar · plan
  steps / Shortcuts).
- **Today ops column** — three live sections fed by services that mirror
  `ChatRoomsService`:
  - **Asks needing you** — `GET /api/asks?status=open`, count agrees with
    SourcesNav.Asks chip.
  - **Rooms (warm)** — 24-hour activity window (`RoomSummary.isLive`), live
    last-message preview.
  - **Plan progress** — `GET /api/plans?state=active`, name + N-of-M + bar.
- **Room view (`Slice 4`)** — chat surface lifted from `LegacyAppShellView`
  into `Antchat/Views/Chat/` (preserves FINDING-3 self-post, fanout, focus
  mode); composer with Send + `—break—` button + `/break <label>` slash;
  RoomShelf tab strip with Artefacts (default active), Plan, Interviews,
  Memories, Attachments, ★ Chair, ★ Validation, Linked rooms, and the
  Slice-7 first-draft Bring-in-LLM strip in the room header (Claude Desktop /
  Claude Mobile / ChatGPT / Gemini deep-links).
- **Native bridges strip** — bottom drawer with 12 chips (Mail · Calendar ·
  Reminders · Notes · Safari · Chrome · Teams · Zoom · Office · iWork · Files ·
  + Connect), visible-but-passive in v0.2 (chips render, functional drag-drop
  ships in v0.3).
- **Persistent toolbar toggles** — `sidebar.left` + `sidebar.squares.left` SF
  Symbols on the leading edge of the NSToolbar, state-filled when visible, so
  no collapsed column is ever a dead end.
- **Brand mark** — canonical `>_ANT` wordmark (chevron `#0A85F0`, underscore
  `#1AC270`, `ANT` `--ink-strong`) plus the live `ant-logo.svg` illustration.
  Mirrors `src/lib/components/AntLogo.svelte` exactly.
- **Token palette** — `Tokens.swift` mirrors `src/app.css` (`--surface-app` /
  `--accent` / `--info` / `--ok` / `--purple` / `--warn` / `--line-soft`);
  no raw hex in `Views/`.
- **UndoToast** — reusable value-type slide-up toast in
  `Views/Components/UndoToast.swift`; local `@State` on `AppShellView` for
  v0.2, scaled up to a shared queue when a second consumer arrives.
- **Stable Apple Development signing** — `project.yml` Code Signing Identity
  switched from ad-hoc to `Apple Development` with a stable team. Keychain
  ACLs now persist across dev rebuilds; "Always Allow" works for real.
- **Window restore** via `NSWindow.frameAutosaveName`. Window size, position,
  and column visibility survive relaunch.
- **Keyboard:** ⌘1 / ⌘2 / ⌘3 toggle sidebar / Today / room shelf · ⌘B alias
  for sidebar · ⌘K focus search · ⌘⇧4 room screenshot · ⌘⇧B toggle bridges
  strip. Surfaced via `.commands { }` in the menu bar.
- **VoiceOver** — labels and hints on every chrome and content element; chat
  rows announced `.polite` as they arrive; saved-room rows expose
  position-in-list (`"Room X, saved room N of M"`) plus `Move up` / `Move down`
  accessibility custom actions.
- **First-run flow** — Team Login (email + password + licence key) or Invite
  Token (server URL + room ID + token) per `README.md`.

### Added — invite UX (`Slice 2.5`)

- **Remote-agent invite modal** — invite an agent into the active room from
  within `remoteant`; binds against the existing `/api/chat-rooms/:id/members`
  flow.

### Added — server (small surface)

- **Saved-rooms persistence cleanup** — `GET /api/chat-rooms` now silently
  drops IDs from any stale `savedRooms.order` payload on first load. No
  client-visible churn; deleted rooms no longer poison the persisted list.

### Changed

- Mac thin-client default window size is now **1440 × 1080**, minimum **1280
  × 800**. `.windowResizability(.contentSize)` is set on the scene.
- The legacy `LegacyAppShellView` chat surface is **extracted** rather than
  rewritten — `ChatStream.swift` / `ChatMessageRow.swift` / `ChatComposer.swift`
  are mechanical lifts. All seven v0.1.x message kinds (`chat`,
  `system_break`, `focus_banner`, `agent_status`, `plan_step`, `ask_card`,
  `deck_slide`) render unchanged.
- Server-side cost / uptime / substrate-live indicators are **removed from
  `remoteant` chrome**. Those concerns stay in the server's `/dashboard`;
  `remoteant` is the thin client and shows only client-relevant state
  (Connected + notifications + share + profile).

### Deferred to `v0.3`

- Native bridges functional drag-drop wiring (the chips render in v0.2 but
  drops are no-ops; v0.3 wires `NSItemProvider` receivers + the
  `Antchat/Views/Shell/RoomShelf/ReviewPanel.swift` queue).
- Bring-in-LLM full round-trip — Slice 7 first-draft ships the deep-link
  chips; the auto-return via Share Sheet / MCP / FileProvider + Approve/Reject
  queue is v0.3.
- Multi-line composer + paperclip + Continuity Camera + Dictate + router-picker.
- Break-delete UI — server `DELETE /api/chat-rooms/:id/breaks/:breakId`
  endpoint must land first.
- Premium feature wiring — ★ Chair (session tracker) + ★ Validation (claim
  extraction + %-score) render as locked tabs in v0.2; v0.3 wires the
  subscription gate + actual feature implementation.
- Keyboard reorder of saved rooms — pointer drag persists in v0.2; VoiceOver
  custom actions deferred to v0.3 polish.

### Pricing (unchanged from `0.1.x`)

| SKU | Price | Per |
|---|---|---|
| OSS self-host server | £0 | — |
| `remoteant` (Mac + Windows thin client) | £6/mo | Human |
| `antios` (iPhone + iPad) | £6/mo | Human |
| `remoteant + antios` bundle | £10/mo | Human |
| `antOS native server` (managed) | £10/mo | Instance |

### Install / upgrade

```sh
# fresh install (macOS)
brew install jktfe/antchat/ant

# upgrade from v0.1.x
brew upgrade jktfe/antchat/ant
```

Existing `v0.1.x` users will be migrated transparently — server-side state is
unchanged; the Mac shell renders the same data against the new Concept D
layout.

---

## [0.1.0] — 2026-05-20

The initial public release of ANT (`a-nice-terminal`).

ANT is a self-hosted multi-agent terminal orchestrator built around **long-lived
agent personae** — the substrate (memory, plans, room context, identity) is the
durable part; the model behind each agent is just the muscle. Out of the box
it runs the agents you actually want to keep working with, across CLIs (Claude
Code, Codex, Gemini, pi, Qwen, Copilot), without phoning home and without
requiring any paid SaaS dependency.

### Added — server

- Operator UI (SvelteKit + Tauri thin-client shell) with rooms, plans, tasks,
  asks, decks, artefacts, terminals, manual canvas, vault, agents dashboard,
  cron jobs page.
- `ant` CLI with chat / plan / task / room / terminal / deck / sheet / ask /
  flag / hook / memory / doc / share verbs (60+ commands; manifest at
  `src/lib/cli-manifest/manifest.ts`).
- Cron primitive — operator-defined recurring jobs with named lifecycle
  (`start | pause | stop | delete`), four action types (`room.message`,
  `console.log`, `webhook.post`, `task.create`), 5-second ticker, SSRF guard
  on `webhook.post`.
- Plan triggers — event-driven dispatch on plan + task lifecycle, same four
  actions as cron, with the shared webhook-safety guard.
- Multi-CLI integration matrix — per-CLI transcript-tail watchers, statusline
  contracts, `ant hooks doctor` health check for hardcoded URLs / stale ports
  / template drift.
- 6 transcript-tail watchers (one per supported CLI) booted via globalThis
  flag; visible in `/api/health` booted flags.
- Browser-session auth with 30-day default TTL, Path=/ cookie scoping, same-
  origin Origin-header check, auto-mint cookie path on identity-gate 403.
- Demo-login gate via `ANT_DEMO_EMAIL` + `ANT_DEMO_PASSWORD` env (timing-safe
  password compare). Disabled by default; unset env vars → anonymous walk-in.

### Added — UI surfaces

- `/manual` canvas — every screen on one board, real Playwright-harvested
  screenshots, hover-peek + click-to-pin detail rail.
- `/cron` page — full lifecycle UI for cron jobs (create form + active/stopped
  sections + per-row Start/Pause/Stop/Delete).
- `/agents` page with per-agent context-window chip, availability-return
  digest banner (missed @-tags while idle), focus-mode entry.
- `/plans/[id]/gantt` — read-only svar-gantt timeline view; existing plans
  dashboard untouched.
- Terminal settings modal (write-grant + persistence + only-respond + kill-
  default-disposition) with manual handle input so operators can configure
  terminals that have no pre-loaded room candidates.
- Plan card hard-delete affordance on `/plans?show=archived` + `?show=deleted`
  with arm→commit confirm + cascade-count receipt.
- Linked rooms create-new mode (v3 parity) — create + link in one step.
- Login next-URL preservation across the demo-login gate.

### Added — distribution

- macOS Homebrew install rail (`brew install ant-cli`).
- Windows MSI via Scoop (unsigned; SHA256-verified).
- Tauri thin-client shell for Mac + Windows native windows.

### Security

- Pre-launch code-review subagent passes (×2) caught and patched 11 launch-
  blockers before push:
  - **CVE-LAUNCH-A** — terminals/input + terminals/escape required auth gates.
  - **CVE-LAUNCH-B** — terminals/kill + agent-launch now server-resolve caller
    identity; body-supplied `callerHandle: "@you"` no longer spoofable.
  - **CVE-LAUNCH-C** — chat-room sub-routes (DELETE / name / archive +
    artefacts + decks) gated through shared `chatRoomAuthGate`.
  - **CVE-LAUNCH-D** — 8 additional chat-room content sub-routes (aliases,
    attachments, composer-draft, docs, decks, members, reactions, room-links)
    gated.
  - **CVE-LAUNCH-1** — `/api/cron-jobs` POST + GET + PATCH require auth
    (anonymous network callers can no longer create cron jobs).
  - **CVE-LAUNCH-2** — `planTriggerDispatcher.ts` webhook.post action shares
    the SSRF guard from cron via `webhookSafety.ts` (blocks localhost /
    private / metadata IPs unless `ANT_WEBHOOK_ALLOW_PRIVATE=true`).
  - **CVE-LAUNCH-3** — terminal settings PATCH adds ownership check
    (resolveCallerHandleAnyRoom + `terminal_records.created_by` / `.handle`).
  - **CVE-LAUNCH-5** — `availability-digest` + `asks/pickup` read endpoints
    gated against anonymous probes (digest requires caller==queried-handle;
    pickup requires room membership; both admin-bearer-overridable).
  - **Auth-vs-target anti-spoof** on reactions / members / aliases /
    composer-draft / docs — caller can only act as themselves; admin-bearer
    bypass.
  - **Hardcoded URL scrub** — all references to internal/personal Tailnet
    hostnames replaced with `<ANT_SERVER_HOST>` / `your-host.example.com` /
    `test-host.invalid` placeholders per file context.
- Regression harnesses pinned to CI: `audit-auth-gates.sh` (CVE-A..H probes),
  `audit-auth-target-gaps.sh` (spoof-target gaps), `audit-server-down-fallback
  .sh` (CLI degradation when ANT server is down).
- Full vitest suite: 3671/3671 pass across 417 files (isolated forks, 152s).

### Configuration

- `ANT_API_KEY` / `ANT_ADMIN_TOKEN`: admin bearer for privileged routes.
- `ANT_FRESH_DB_PATH`: optional SQLite path.
- `ANT_OPERATIONAL_RETENTION_DAYS` + `ANT_OPERATIONAL_RETENTION_MAX_DB_BYTES`:
  operational telemetry retention + size threshold.
- `HOST` / `PORT`: bind address + port.
- `ANT_DEMO_EMAIL` / `ANT_DEMO_PASSWORD` / `ANT_DEMO_HANDLE` /
  `ANT_DEMO_ROOM_ID`: demo-login gate (off by default). ⚠️ Rotate before
  exposing the server publicly.
- `ANT_WEBHOOK_ALLOW_PRIVATE=true`: allow cron `webhook.post` to target
  private/loopback IPs (for self-host sidecar webhook flows). Default fails
  closed.

### Notes

- Premium native iOS/Android apps, managed hosted services, and verification-
  policy workflows live outside this OSS repo and are never required to run
  the self-hosted ANT distribution.
- AGPL-3.0-or-later: if you fork and host, offer the corresponding source to
  your users. See `LICENSE` + `NOTICE` + `COMMERCIAL_LICENSE.md`.
- Security reports: see `SECURITY.md`.

---

Versioned entries below this line follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
sections: Added · Changed · Deprecated · Removed · Fixed · Security.
