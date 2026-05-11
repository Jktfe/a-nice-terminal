# AGENTS.md — onboarding for AI coding agents

**Audience:** any AI agent (Claude Code, Codex CLI, Cursor, Copilot, Aider,
Gemini CLI, etc.) tasked with reading or modifying this codebase. This file
is vendor-neutral; vendor-specific guidance lives in tool-specific files
(`CLAUDE.md` etc.) which are gitignored.

If you only have time to read one section, read **Conventions** below.

---

## What this repo is

ANT (a-nice-terminal) is a self-hosted multi-agent terminal orchestrator.
Two shippable artefacts live here:

| Surface | Where | Purpose |
|---|---|---|
| **ANT v3 server** | repo root (SvelteKit + Node) | the host orchestrator: terminals, chat, plans, agent registry |
| **`ant` CLI** | `cli/` | full operator interface — invites, rooms, terminals, tasks, memory |
| **`antchat` CLI + web UI** | `antchat/` | thin client (Bun-compiled binary) — joins a colleague's room from a laptop without running the full server. Includes a local web server for non-technical users (`antchat web`) |

The server speaks bearer-token HTTP/SSE/WebSocket on port `6458` by default
(HTTPS with self-signed cert in dev). Per-room invites mint long-lived tokens
that all three clients (`ant`, `antchat` CLI, `antchat web`, plus an MCP
proxy for Claude Desktop) accept interchangeably.

## Quick map

| Path | What lives there |
|---|---|
| `src/` | SvelteKit app: `src/routes/api/**` for the HTTP API, `src/routes/r/[id]` for the per-room web UI, `src/lib/server/**` for the host runtime (DB, PTY, agent registry, prompt-bridge, broadcast) |
| `src/lib/server/db.ts` | better-sqlite3 schema + `queries` object |
| `src/drivers/` | per-CLI drivers (claude-code, codex, copilot, gemini, qwen, pi, hermes, etc.) — fingerprint-driven, see `src/fingerprint/` |
| `src/fingerprint/` | the agent fingerprinting pipeline that generates drivers + the runtime probe schedule |
| `cli/` | full `ant` CLI (Bun + Node compatible). `cli/lib/` is the shared transport/config layer |
| `cli/lib/api.ts` | `request()` + `api.{get,post,put,del}` Bearer-auth helpers (handles self-signed TLS on Bun and Node) |
| `cli/lib/sse.ts` | `subscribeRoomStream()` — long-lived SSE subscriber with dedup |
| `cli/lib/config.ts` | `~/.ant/config.json` token store (per-room, multi-handle) |
| `cli/commands/` | `ant <subcommand>` implementations |
| `antchat/` | the thin client. Bun-compiled to a single binary; web UI under `antchat/web/` |
| `antchat/web/server.ts` | Bun.serve route table for `antchat web` |
| `antchat/web/auth.ts` | launch-token + Keychain + CSRF for the local web server |
| `antchat/web/sse-fanout.ts` | one upstream SSE per `(roomId, handle)`, fanned to N browser EventSources |
| `tests/` | vitest suites (TypeScript). `tests/integration/` for end-to-end scenarios |
| `docs/` | design notes, lessons, agent-setup walkthroughs |
| `homebrew/antchat.rb` | reference copy of the published Homebrew formula |

For multi-agent delivery, read `docs/multi-agent-protocol.md` first, then
`docs/multi-agent-session-guide.md`. The session guide captures the
server-split factory loop: canonical plan IDs, capped implementation lanes,
separate alignment review, PASS/BLOCKER discipline, and merge-chain hygiene.

## Conventions (read these before changing code)

These are load-bearing. Violate them and tests fail or features break in
hard-to-debug ways.

1. **`globalThis` for server singletons.** `src/lib/server/db.ts`,
   `ws-broadcast.ts`, the prompt-router, and the PTM writer all use
   `globalThis` so SvelteKit's hot reload doesn't create duplicate copies.
   New singletons MUST do the same.
2. **Plain text for PTY injection.** No ANSI escape codes. Use the
   two-call protocol (write text, 150ms gap, write `\r`). Works for every
   driver — see `feedback_plain_text_pty` in commit history.
3. **Bearer tokens, not cookies, for `/api/sessions/:id/*`.**
   Master `ANT_API_KEY` is admin-scoped. Per-room `ant_t_*` tokens are
   resolved in `src/lib/server/room-invites.ts`. SSE accepts `?token=`
   query param OR `Authorization: Bearer ...`.
4. **Three token kinds.** `cli` and `mcp` can post; `web` is read-only.
   Check `kind` before writing — `assertCanWrite()` in
   `src/lib/server/mcp-handler.ts` and `src/routes/api/sessions/[id]/messages/+server.ts`.
5. **`~/.ant/config.json` is shared.** The full `ant` CLI, `antchat` CLI,
   and `antchat web` all read/write the same file. Token bundles are
   keyed by `roomId` and may carry multiple handles per room.
6. **Self-signed TLS** on the upstream is normal in dev. Use the helpers
   in `cli/lib/api.ts` and `cli/lib/sse.ts` — they do the right thing on
   Bun (`tls: { rejectUnauthorized: false }`) and Node (undici
   dispatcher). Never set `NODE_TLS_REJECT_UNAUTHORIZED=0` in CI.
7. **Never shell out with interpolated user input.** Use the `execFile`
   variant with arg arrays, not the shell-splitting variant. Helper at
   `src/utils/execFileNoThrow.ts`.
8. **Trust tiers on capture.** `command_block` events are `trust:high`,
   raw bytes are `trust:low`, never render raw HTML/markdown from
   non-high events without escaping. Live capture goes through
   `src/lib/server/capture/`.
9. **Don't break `git status` discipline.** Stage explicit files, never
   `git add -A` (the working tree often holds machine-specific files
   like `.env`, `.mcp.json`, `CLAUDE.md`, `.claude/settings.local.json`
   that are intentionally gitignored).
10. **Three tiers for chat-message writes.** Lifecycle documented in
    `docs/persist-tier-lifecycle.md`. The short version:
    - **Tier 1 — Persist library** (`src/lib/persist/`). Every chat-
      message write goes through `writeMessage(input)`. Inserts the row
      with `broadcast_state='pending'` inside a transaction; writes
      ask rows and meta + auto-membership upsert in the same
      transaction. Pure DB work, no in-memory state, callable from any
      process (HTTP handler, CLI, future MCP). `actorSessionId`-gated
      for `source: 'cli'`.
    - **Tier 2 — Processor** (`src/lib/server/processor/`).
      `runSideEffects(result)` owns every live-server side effect:
      channel HTTP fanout (idempotent per-adapter via `delivery_log`),
      `MessageRouter.route`, asks WS broadcast, agent event bus. Flips
      `broadcast_state` to `'done'` on success. `replayPendingBroadcasts()`
      runs the same module on rows that landed offline.
    - **Tier 3 — UI** (SvelteKit). Reads from DB, subscribes to WS
      events. Restartable without affecting the data plane.
    Anything that touches in-memory state (WS clients, PTY adapters,
    routing decisions) belongs in Tier 2. Anything that produces a
    durable chat message should route through `writeMessage`; direct
    `queries.createMessage` is acceptable for non-chat system events
    (focus digests, interview summaries, hooks-emitted assistant
    events) that intentionally bypass the broadcast queue.

## Run / build / test

```sh
# Server (dev with hot reload)
bun install
bun run dev                  # http://localhost:5173 (vite)
bun run build && bun run start   # production via build/handler.js

# Server tests
bun test                     # full vitest run
bun test tests/some.test.ts  # focused

# CLI
cd cli && bun install && bun link
ant --help

# antchat (Bun-compiled binary)
bun run build:antchat        # arm64 + x64 in dist/
bun run smoke:antchat        # CI-safe smoke (no network)
./dist/antchat-darwin-arm64 web   # local web UI
```

## Commit / PR conventions

- Conventional commit prefixes: `feat(scope)`, `fix(scope)`, `refactor(scope)`,
  `docs:`, `chore:`. Look at recent `git log --oneline -20` for the in-house
  flavour before writing yours.
- Body: explain *why*, not what. Link to the issue or relevant doc.
- Add `Co-Authored-By:` for AI-pair-programming attribution if the change is
  AI-generated.
- Don't commit secrets. `.env`, `*.plist`, `.mcp.json`, `CLAUDE.md`, and
  `.claude/settings.local.json` are gitignored — keep them that way.
- Don't commit screenshots with personal data. `screenshots/` and
  `docs/*-evidence.png` are gitignored.

## Security model (skim before touching auth)

- Master API key (env `ANT_API_KEY`): admin-scoped.
- Room bearer tokens (`ant_t_*`): scoped to one room, one handle, one
  `kind`. Resolved at request time; `kind=web` is read-only.
- `ANT_TAILSCALE_ONLY=true` restricts external API calls to `100.x.x.x`
  CIDR + loopback. The browser UI is exempt (same-origin).
- `antchat web` runs on `127.0.0.1` only. Per-launch UUID delivered via
  URL fragment → `__antchat` cookie + CSRF double-submit + Origin check.
  See `antchat/web/auth.ts`.
- Brute-force protection on invite exchange: `ANT_INVITE_MAX_FAILURES`
  bad passwords auto-revokes the invite (`src/lib/server/room-invites.ts`).
- Report vulnerabilities via private advisory:
  `https://github.com/Jktfe/a-nice-terminal/security/advisories/new`
  (see `SECURITY.md`).

## Where to ask before changing

- `src/lib/server/db.ts` schema — coordinate with the migrations file
  (`src/lib/server/db-migrate.ts`) and bump the version.
- `src/fingerprint/agent-state-reader.ts` — driver state contract; many
  drivers depend on it. Touch carefully.
- `cli/lib/config.ts` — token format is shared with the host's resolver;
  changing the JSON shape is a breaking change for installed CLIs.
- The Homebrew formula. The local `homebrew/antchat.rb` is a reference
  copy; the live one lives in `Jktfe/homebrew-antchat`. Cut a new release
  via `release-antchat.yml` and PUT the new SHAs into the tap.

## Fast facts

- Default port: `6458` (HTTPS, self-signed in dev).
- Database: better-sqlite3 at `~/.ant-v3/ant.db`.
- Native module: `better-sqlite3`. ABI must match the Node version that
  runs the server. If launchd loads the daemon under a different Node
  than the one used to install deps, the server crashes on startup —
  rebuild with `npm rebuild better-sqlite3` against the launchd Node.
- Build artefact for the server: `build/handler.js` (SvelteKit
  adapter-node output). The startup logic in `server.ts` snapshots `build/`
  into `.ant-runtime/build-snapshots/<id>` and serves the snapshot — this
  way an in-place rebuild doesn't crash a running server. If `build/` is
  missing entirely, the server can't boot. Run `bun run build` before
  `launchctl kickstart`.
- The agent fingerprinting pipeline runs nightly via GitHub Actions and
  publishes drivers under `src/drivers/`. Don't hand-edit those drivers
  unless you're also updating the upstream specs in
  `docs/agent-setup/<NAME>.md`.
