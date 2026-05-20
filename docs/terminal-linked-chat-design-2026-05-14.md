# Terminal linked-chat — design contract (T2-LINKED-CHAT)

Date: 2026-05-14
Author: @researchant
Status: DESIGN-FIRST + impl follows immediately under locked acceptance.
Cap: ≤180L. Anchored to ant-fresh-flowspec-2026-05-13 + JWPK D-x dogfood
correction: "the terminal can simply be viewed and interacted with as a
chat, an ANT terminal, or a RAW terminal" + "linked chat".

## TL;DR — JWPK semantic correction

Chat view today: a filter on `kind='message'` rows from terminal_run_events.
**Wrong.** JWPK spec: each terminal has its own LINKED CHAT ROOM.
- Direct PTY input → ANT + RAW only (Chat stays silent for direct typing).
- Agent-chip-launch (claude-code/codex/etc per fingerprint) → user's
  message routed THROUGH the linked chat room → existing fanout chain
  injects into PTY → CLI's response routed back to same room.
- Each terminal_record has 1:1 linked chat room.

## Q1 — Schema

ADD `linked_chat_room_id TEXT` column to `terminal_records`. ALTER is
idempotent per existing migration runner. Nullable v1 (back-compat with
pre-T2-LINKED-CHAT records); auto-populated for NEW POSTs from this slice.

## Q2 — Auto-room-create on terminal create

POST /api/terminals (or createTerminalRecord) now ALSO creates a
`chat_rooms` row named `Terminal: <terminal.name>` (e.g. "Terminal:
Terminal 1") via existing `createChatRoom` + records the new room's id
on `terminal_records.linked_chat_room_id`. Idempotent: if record already
has linked_chat_room_id, skip room creation.

## Q3 — Agent-launch endpoint

NEW `POST /api/terminals/[id]/agent-launch` body `{message: string,
agentKind?: string}`:
1. Resolve terminal_record by sessionId.
2. Resolve linked_chat_room_id (404 if absent).
3. POST to that room via existing chatMessageStore.postMessage with
   `body=message` + `kind='human'` + `authorHandle='@you'`.
4. Existing fanoutMessageToRoomTerminals chain (already wired in
   /messages POST + persists message + emits broadcast) handles delivery
   to the terminal's PTY pane via pty-inject-fanout.
5. Return `{messageId, roomId}`.

## Q4 — Fanout wiring (delta-2: PATH A merge per RQO + flowspec lift)

`src/lib/server/pty-inject-fanout.ts` (198L) requires terminalsStore
rows with `tmux_target_pane`. Daemon-spawned terminal_records (T2d)
don't have those today.

**PATH A chosen** (RQO + flowspec LIFT discipline — terminal_records
IS the terminalsStore for fresh-ANT, per ant-fresh-flowspec-2026-05-13
"handle + pane + agent_kind colocated"):

Sub-slices:
- T1a: ALTER terminal_records ADD COLUMN tmux_target_pane TEXT;
  POST /api/terminals daemon-spawn populates as `<sessionId>:0.0`
  (daemon `tmux new-session -A -s <sessionId>` creates session, default
  window + pane `0.0` per tmux convention).
- T1b: linked_chat_room_id ALTER + auto-room-create on POST + NEW
  POST /api/terminals/[id]/agent-launch endpoint that posts to chat
  room — existing fanout chain delivers via tmux_target_pane.
- T1c: adapt pty-inject-fanout's `getTerminalById` to query
  terminal_records (or sync into terminalsStore); fanout's
  matchReadyStateFor + makeInjectQueue + twoCallSubmit unchanged.
- T1d: POST /api/identity/register attach-existing flow per JWPK two-
  tier UX click-to-attach; queries tmux list-panes for known panes.

**Rejected**: Option B adapter via ptyClient — bypasses fanout but
violates flowspec LIFT discipline + leaves cross-terminal visibility
(membership lookup) unwired.

**Rejected**: Option C force register-flow — daemon-spawned terminals
have no fresh-ANT pid; can't satisfy register's pids[] requirement.

## Q4b — v3 → fresh-ANT mapping (coordinator gate, 2026-05-14)

Concrete v3 lift sources mapped to fresh-ANT counterparts. Identifies what
T1b needs vs what is already lifted vs what remains for T1c/T2.

| v3 surface | fresh-ANT counterpart | Status |
|---|---|---|
| `message-router.ts` `parseMentions(content, knownHandles)` | not lifted in T1b. Single-member room delivery is unambiguous; no @handle disambiguation needed for agent-launch. Defer to multi-handle slice. | NOT-LIFTED v1 |
| `message-router.ts` `resolveRoomFanout(content, knownHandles, senderType)` | `pty-inject-fanout.ts` `fanoutMessageToRoomTerminals(roomId, message)` — already handles per-room iteration over memberships. | ALREADY LIFTED |
| `message-router.ts` `handlesForMember(member)` | `roomMembershipsStore.ts` `membership.handle` — currently set at insert time per member. | ALREADY LIFTED (different shape) |
| `adapters/pty-injection-adapter.ts` `PtyInjectionAdapter.deliver` | `pty-inject-bridge.ts` `injectToTerminal(terminal, envelope)` + `formatEnvelope(input)` — header/body/reply-cmd same shape. | ALREADY LIFTED |
| `adapters/pty-injection-adapter.ts` two-call protocol (text + \r) | `pty-inject-bridge.ts` `twoCallSubmit(sessionId, payload, opts)` — same 150/200ms cadence. | ALREADY LIFTED |
| `adapters/pty-injection-adapter.ts` `ptmWrite` globalThis | `pty-inject-bridge.ts` calls `ptyClient.write` directly (no globalThis indirection — fresh-ANT runs single process). | INTENTIONAL DIVERGENCE |
| v3 `terminals` table id+pid+pid_start lookup | fresh-ANT `terminals` table (terminalsStore) — PID-bound identity for `ant register --handle @x`. | EXISTS, separate from terminal_records |
| v3 `terminal.tmux_target_pane` | fresh-ANT `terminal_records.tmux_target_pane` (T1a, shipped). Fanout's `getTerminalById` reads from terminalsStore today; T1c lifts to terminal_records. | T1a SHIPPED, T1c PENDING |

**Implication for T1b**: No new v3 lift needed. Re-uses already-lifted
chain: post chat message → fanoutMessageToRoomTerminals → injectToTerminal →
twoCallSubmit. Critical missing edge is `getTerminalById(membership.terminal_id)`
returning a row with `tmux_target_pane`. T1c lifts that lookup; T1b ships
with a direct-write fallback (ptyClient.write to sessionId) so live proof is
demonstrable.

## Q5 — Frontend Chat view (FRONT-3v2-5 separate slice, claude2)

Chat view consumer changes from filtering run_events kind=message to
SUBSCRIBING TO LINKED CHAT ROOM messages via existing /api/chat-rooms/
[roomId]/messages + SSE /api/realtime/[roomId]/events. Backend already
supports this; FRONT just changes data source.

## Touch points (T1 scope — partial-frame 1 of 2)

T1 ships (delta-1 Option B):
- EDIT db.ts: ALTER terminal_records ADD COLUMN linked_chat_room_id TEXT
  + idempotent migration tolerance.
- EDIT terminalRecordsStore.ts: createTerminalRecord auto-creates room
  via chatRoomStore.createChatRoom + writes linked_chat_room_id back
  to terminal_records row. NO room_memberships insert (Option B
  bypasses fanout).
- NEW src/routes/api/terminals/[id]/agent-launch/+server.ts ≤80L:
  POST {message, agentKind?} → resolve terminal_record + linked_chat_
  room_id (404 if absent), POST to chat room (existing chatMessageStore),
  ALSO call ptyClient.writeInput(sessionId, message + '\n') to deliver
  the prompt to the terminal pane directly. Returns {messageId, roomId}.
- EDIT GET /api/terminals + /api/terminals/[id] expose linkedChatRoomId
  in response (claude2 FRONT subscribes via this id).
- 4-6 vitest covering store auto-room + endpoint happy/404/missing-room.

T2 (DEFERRED): handle-as-first-class column on terminal_records, register
flow integration with v3 ant register --pane semantics.

## Locked acceptance (T1)

- POST /api/terminals creates terminal_record + chat_room + membership.
- GET /api/terminals returns terminals[] with linkedChatRoomId.
- POST /api/terminals/[id]/agent-launch posts message to linked room +
  existing fanout delivers to terminal PTY (verify via /input echo).
- svelte-check + tests green.
- Plan event `t2-linked-chat-t1` status=done after canonical PASS.

## Do-not-use

| Rejected | Why |
|---|---|
| Filter on kind=message for Chat view | JWPK explicit correction. |
| Build new fanout layer | fresh-ANT already has pty-inject-fanout. |
| Per-terminal room-id-equals-terminal-id | Existing chat_rooms PK auto-generated; reuse pattern. |
| Skip auto-membership row | Without it, fanout lookup returns no terminals. |

## Locked assumptions (no JWPK-questionnaire)

1. Linked-room name format: `Terminal: <terminal.name>` v1; configurable later.
2. Default authorHandle for agent-launch posts: `@you` (matches composer default).
3. Existing fanout's matchReadyStateFor only handles claude_code; other agents will inject without ready-state verify (fanout already handles this gracefully).

## What I did NOT verify

- Did NOT confirm existing chatRoomStore.createChatRoom signature accepts the kind/name shape needed.
- Did NOT trace whether v3 has additional invite-token flow needed for terminal-as-member.
- Did NOT prototype agent-chip frontend UX (claude2 FRONT-3v2-5 lane).

## Next step

T1 implementation proceeds claim-first under THIS doc Locked Acceptance.
T2 + frontend chip slice queued.
