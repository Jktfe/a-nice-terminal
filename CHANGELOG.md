# Changelog

All notable changes to ANT are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
