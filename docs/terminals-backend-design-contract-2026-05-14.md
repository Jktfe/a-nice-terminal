# Terminals backend — design contract

Date: 2026-05-14
Author: @researchant (research-and-evaluate scout per banked discipline)
Status: DESIGN-FIRST. T1 impl claim-first AFTER canonical PASS + JWPK ACK.
Cap: ≤180L. Closes JWPK terminals-first dogfood pivot.

## TL;DR

JWPK 2026-05-14: "I should be able to (a) create a terminal and (b) attach
a tmux session and then we can dogfood it properly." fresh-ANT today:
`/terminal` is a 48L stub; `/api/terminals/[id]` has agent-status +
fingerprint + delivery + linkedchat sub-routes but NO create endpoint and
NO PTY spawn surface. v3 has a 250+L `pty-daemon.ts` using `node-pty` +
Unix socket at `~/.ant/pty.sock` + tmux raw+ctrl PTY pair pattern, plus
`pty-client.ts` that other v3 modules use to talk to the daemon.

## Q1 — PTY mechanism

Three options (banked m6.5 PTY decision favoured Bun.Terminal but
fresh-ANT runs via `node build/index.js` so Bun.Terminal is unavailable):

**Option A (recommended)** — REUSE v3's pty-daemon via Unix socket.
fresh-ANT becomes a `pty-client` of the existing v3 daemon at
`~/.ant/pty.sock`. ZERO new daemon work, banked discipline (no v3
mutations), socket already lives at user-level so both servers can
connect. Only NEW code in fresh-ANT: a thin client wrapper over the
existing JSON-line protocol.

**Option B** — port the v3 daemon into fresh-ANT. Duplicates ~250L,
child-2tes banked v3-must-remain-untouched-but-feel-free-to-read.

**Option C** — child_process.spawn with pipes (no PTY). Limited (no
vim/htop/tmux), no resize, no escape sequences; rejected for v1 because
Q2 tmux attach requires PTY.

**Default**: Option A.

## Q2 — tmux attach approach

v3 daemon already implements raw + ctrl PTY pair attach pattern. Per
Option A, fresh-ANT delegates entirely to the daemon — JWPK attach UX
is a `pty-client` `attach-session <name>` call.

## Q3 — Streaming protocol (terminal output → browser)

**Default proposal**: REUSE GAP-55 SSE infrastructure for terminal
output. New endpoint `GET /api/terminals/[id]/stream` returns a
text/event-stream subscribed to the daemon's PTY output for that
terminal id. eventBroadcast.ts singleton extended with a per-terminal
channel (terminalId → Set<controller>); ptyClient pushes to it on
each daemon `data` event.

WS rejected per banked GAP-55 SSE-over-WS rationale (adapter-node, no
server.js wrapper, lower risk, sufficient for one-way output).
Bidirectional input (key presses) handled via separate `POST
/api/terminals/[id]/input` per-keystroke (or buffered).

## Q4 — OSC title parsing + agent fingerprint

v3 daemon already strips/forwards OSC sequences. `Osc133BlockParser`
handles command-block boundaries. OSC 0/2 (window title) parsing reuses
existing `fingerprintDetector` (banked: M3.2a fingerprint slice closed).
On title change, server emits `agent_kind` update via existing
`agentKindEnum.ts` + `agentStatusPoller.ts` infrastructure.

## Q5 — Member-panel terminals listing

NEW endpoint `GET /api/chat-rooms/[roomId]/terminals` returns active
terminals scoped to that room (`{terminalId, handle, agentKind,
spawnedAt}[]`). Uses existing `roomMembershipsStore` to map terminal_id
→ room_id. Renders in the Participants section (D1.6-T1b dropdown) as a
sub-list under each member.

## Touch points (T1 minimal scope — partial-frame 1 of 4)

**Delta-1 (RQO32 HOLD absorbed)**: v3 daemon protocol verified narrower
than initial assumption. Daemon `spawn` accepts `{sessionId, cwd?, cols?,
rows?}` only — starts `tmux new-session -A` with shell integration; NO
arbitrary cmd/args. Client `activeSessions()` returns local-only state;
listing all daemon sessions requires explicit `{type:'list'}` IPC.

T1 ships:
- NEW src/lib/server/ptyClient.ts ≤120L: thin wrapper over `~/.ant/pty.sock`
  newline-JSON protocol; exports `spawn({sessionId, cwd?, cols?, rows?})`
  → tmux session start, `write(sessionId, data)`, `subscribeOutput(sessionId,
  onData)`, `resize(sessionId, cols, rows)`, `kill(sessionId)`, `list()` —
  `list()` sends `{type:'list'}` IPC and awaits daemon response (NOT a local
  activeSessions readback).
- NEW src/routes/api/terminals/+server.ts ≤80L: POST body `{sessionId?,
  cwd?, cols?, rows?}` — sessionId optional (server generates if absent);
  default shell+tmux session only (no arbitrary cmd/args in v1; daemon
  protocol amendment required to support that, deferred). GET lists active
  terminals via ptyClient.list() IPC round-trip.
- NEW src/routes/api/terminals/[id]/stream/+server.ts ≤60L: SSE endpoint
  reusing eventBroadcast pattern from GAP-55.
- NEW src/routes/api/terminals/[id]/input/+server.ts ≤40L: POST writes
  bytes/string to terminal stdin via ptyClient.write.

T2-T4 deferred:
- T2: tmux attach-session verb + reuse session on reconnect (1-2hr).
- T3: OSC title parsing → agent_kind classification on terminal record (1hr).
- T4: per-room member-panel terminals listing endpoint + UI surface (1hr).

## Locked acceptance (T1 only — delta-1)

- POST /api/terminals with body `{sessionId?, cwd?, cols?, rows?}` returns
  201 + sessionId after daemon spawn (tmux new-session -A).
- GET /api/terminals returns daemon-side active session list via list IPC.
- GET /api/terminals/[id]/stream serves SSE; daemon output flows through.
- POST /api/terminals/[id]/input writes input → daemon echoes to stream.
- v3 pty-daemon untouched; daemon socket reused as-is.
- Arbitrary cmd/args explicitly DEFERRED — requires daemon protocol amend.
- svelte-check 0 errors 0 warnings.
- Plan event `terminals-backend-t1-spawn-stream-input` status=done after canonical PASS.

## Do-not-use

| Rejected | Why |
|---|---|
| Port v3 pty-daemon into fresh-ANT | Duplicates 250L; child-2tes v3-untouched. |
| WS for terminal stream | adapter-node, no server.js wrapper; SSE works (GAP-55 proven). |
| node-pty in fresh-ANT process | v3 daemon already owns PTY allocation; client is enough. |
| child_process.spawn (no PTY) | Q2 tmux attach requires PTY. |
| Skip auth on terminals | Future hardening — but v1 ships open since dogfood single-user. |

## Open questions for JWPK

1. v3 pty-daemon must be running for fresh-ANT terminals to work. Is that acceptable, or should fresh-ANT auto-launch the daemon? Default: assume daemon running (manual `bun /a-nice-terminal/.../pty-daemon.ts` start); auto-launch is a follow-up.
2. Per-key POST vs WebSocket input upstream? Default: per-key POST v1; WS later if latency unacceptable.
3. T3 OSC fingerprint detection on every terminal vs only on register? Default: every terminal — JWPK D-x dogfood will surface lots of agent kinds.

## What I did NOT verify

- Did NOT confirm v3 pty-daemon is currently running (likely yes since v3 terminal works, but not lsof-verified).
- Did NOT prototype the JSON-line protocol bytes; assumes v3 pty-client.ts public API is stable.
- Did NOT measure SSE backpressure for high-output terminals (vim-heavy use).

## Next step

T1 impl claim-first under THIS doc Locked Acceptance once canonical
PASS + JWPK ACK on Q1-Q5 defaults land. T2-T4 partial-framed for
sequencing.
