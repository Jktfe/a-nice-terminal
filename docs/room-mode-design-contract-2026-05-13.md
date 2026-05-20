# Room Mode Design Contract — M3.b.4

**Author:** @claude2
**Date:** 2026-05-13
**Slice:** Phase 3b sub-slice M3.b.4 (room mode: brainstorm vs heads-down)
**Scope:** Lock the design contract for per-room mode state + CLI/route shape. NO code in this slice — JWPK ACK + gate PASS gate implementation.
**Audience:** @evolveantcodex (gate), @evolveantclaude (coordinator), JWPK
**Constraint:** compact, single-file, follows the researchant decision-doc shape; ≤230 lines.

---

## TL;DR

A chat room has a **mode** that shapes how messages route to its members. THREE modes ship in v1 (per JWPK 2026-05-13 ACK):

- **brainstorm** (default for new + existing rooms) — every message PTY-injects into every registered member's pane except the sender's. Optimised for free-flow ideation. (Sender does not need inject — their own pane wrote the message, their UI shows the stored room message natively.)
- **heads-down** — only the selected next-responder receives PTY inject. All other members (including the message author) see the message in the room view but their pane is NOT injected. Optimised for agents mid-task who should not be interrupted by every passing chat. (TRUE heads-down delivery routing is M3.b.5's deliverable; M3.b.4 ships the mode state + fallback warning only.)
- **closed** — READ-ONLY FREEZE. Server REJECTS new POSTs to `/api/chat-rooms/[roomId]/messages` with **409 Conflict** + `{ message: "Room is closed (read-only). Use 'ant room mode --room ID --set brainstorm|heads-down' to reopen." }`. Existing messages remain readable via GET. NO PTY inject ever fires (no new message → no fanout). Per JWPK 2026-05-13: "ADD CLOSED read-only freeze, no new messages accepted." Closed is a state you opt INTO and opt OUT OF via explicit `--set`; the `--toggle` flag does NOT touch closed (see Q4 below).

Mode is a per-room field on a NEW `chat_room_modes` table in `~/.ant/fresh-ant.db` (better-sqlite3, persists across kickstart, joins the ROOMS-PERSISTENCE-0 Tier-1 set even before chatRoomStore itself moves to SQLite). One row per room id. Read by the fanout path on every message; written by `PUT /api/chat-rooms/[roomId]/mode` and read by `GET /api/chat-rooms/[roomId]/mode`.

CLI surface: `ant room mode --room ID` (read) and `ant room mode --room ID --set MODE` (write). Both go through IDENTITY-GATE via pidChain.

---

## Q1 — How many modes?

| Option | Modes | Pros | Cons |
|---|---|---|---|
| 1a | brainstorm + heads-down (2) | Smallest surface. | No archive state. |
| 1b | brainstorm + heads-down + closed (3) **← JWPK ACK** | closed = server rejects new messages (read-only freeze); existing history readable. | One more state to test; needs POST-messages-route guard. |
| 1c | brainstorm + heads-down + brainstorm-with-mute (3) | mute = ignore reactions and typing | Adds complexity. |

**JWPK answered 2026-05-13: 1b — three modes (brainstorm, heads-down, closed).** Original recommendation was 1a but JWPK overrode in favour of 1b so the room can be closed-as-read-only-freeze without deletion. **closed semantic: server REJECTS new POSTs to messages route with 409**; existing messages remain readable. (Fanout inject is moot under closed because no new message is stored to fan out.) Schema CHECK constraint now `mode IN ('brainstorm', 'heads-down', 'closed')`.

---

## Q2 — Where does the mode live?

| Option | Storage | Trade-off |
|---|---|---|
| 2a | New column `mode` on chatRoomStore (in-memory Map) | Smallest change. Wipes on kickstart with the rest of the rooms. |
| 2b | New `chat_room_modes(room_id PK, mode, set_by, set_at)` table in fresh-ant.db (better-sqlite3) | Survives kickstart even before rooms-persistence ships. Tier-1 persistence. |
| 2c | Wait for rooms-persistence slice to land then add mode as a column on the persisted rooms table | Cleanest long-term but blocks M3.b.4 on Phase-2 / rooms-persistence completion. |

**Recommendation: 2b.** Don't block on rooms-persistence; ship the mode table now so JWPK can configure and persist the room mode today. (Effective heads-down DELIVERY/ROUTING lands with responders in M3.b.5; M3.b.4 ships only the mode-state + API + CLI + fallback warning per the locked acceptance.) When rooms-persistence lands, the mode table can either stay separate (one-job-per-table) or get folded in — that's a migration choice, not a blocker.

---

## Q3 — Default mode for new rooms

**Recommendation: brainstorm.** A new room with no responder list set yet has nothing to route to under heads-down, so heads-down-default would silently swallow messages until someone configures responders. brainstorm is the safer default. ant-build + ant-evolve get re-provisioned in brainstorm whenever the team re-creates them.

---

## Q4 — Who can flip the mode?

| Option | Authorisation rule | Notes |
|---|---|---|
| 4a | Any room member | Simplest. Aligns with v3 ANT chat semantics. |
| 4b | Room creator only | Tighter but problematic — the creator may have left. |
| 4c | Members tagged as `chair` or `owner` in chat_room_members | Matches the chair concept that's been mentioned in audits. Requires chair-membership state to exist first. |
| 4d | JWPK only | Too restrictive for normal team operation. |

**Recommendation: 4a for v1.** Any registered room member can flip. Audit log records `set_by` + `set_at` so misuse is observable, not silent. If misuse surfaces, tighten in a follow-up to 4c after chair state lands.

---

## Q5 — How does mode interact with fanout?

The existing fanout path in `src/lib/server/pty-inject-fanout.ts:fanoutMessageToRoomTerminals`:
1. ENTRY GUARD: drop if message.kind not in {human, agent}.
2. Look up room name.
3. listMembershipsForRoom(roomId).
4. For each membership where handle != sender: enqueue per terminal.

Mode hooks in **between step 2 and step 3**:
- Read `chat_room_modes.mode` for this room (default to brainstorm if no row exists).
- If `brainstorm`: existing behaviour unchanged. Fanout enqueues PTY inject for every member EXCEPT the sender (sender does not need inject — their own pane wrote the message; the stored room message is already visible in their UI view).
- If `heads-down`: load the room's ordered responder list (Q-cross-ref: M3.b.5 responders slice owns that table). Fanout enqueues PTY inject for the SELECTED RESPONDER only (the agent at the front of the responder queue who is not currently busy). All other members (including the message author) do NOT receive a paste+Enter — they see the new message in the room view, but their pane is not injected.
- If `closed`: this branch is UNREACHABLE from the normal POST→fanout path because POST /messages refuses with 409 BEFORE the message is stored (see Q6 messages-route guard). Defensive: fanout still mode-checks at entry and returns early if it sees mode=closed (covers race between concurrent flips while a message is mid-flight).

**Wording clarity (B2 fix per codex2):** PTY inject is what fanout SENDS to receiver panes. The author's pane is never an inject target — they wrote the message, so their UI shows it natively. heads-down narrows the inject set from "all-non-sender members" down to "the selected responder only".

**Cross-slice dependency:** heads-down REQUIRES the responders state (M3.b.5) to be useful. If M3.b.5 hasn't landed yet AND a room is set to heads-down, fanout falls back to brainstorm with a console-warn log. M3.b.4 acceptance ships mode persistence + API + CLI + fallback warning ONLY. **TRUE heads-down delivery routing is M3.b.5's deliverable, not M3.b.4's** (B3 fix per codex2).

---

## Q6 — REST endpoint shape

```
GET  /api/chat-rooms/[roomId]/mode
  → 200 { roomId, mode: "brainstorm" | "heads-down" | "closed", set_by?, set_at? }
  → 404 if room not found

PUT  /api/chat-rooms/[roomId]/mode
  Body: { mode: "brainstorm" | "heads-down" | "closed", pidChain: [...] }
  → 200 { roomId, mode, set_by, set_at } on success
  → 400 on malformed body or invalid mode value (mode not in the 3-enum)
  → 403 if pidChain does not resolve to a member of this room (gate enforced)
  → 404 if room not found
  Side-effect on every successful flip: append a row to chat_room_mode_history
    (room_id, mode, previous_mode, set_by, set_at). See Q8.
```

PUT auto-resolves caller identity via pidChain → terminal → membership → handle. The resolved handle becomes `set_by`. Strict 403 enforcement here is correct because this is a new endpoint with no legacy clients to break.

**NEW route behaviour — `/api/chat-rooms/[roomId]/messages` POST guard (B1):** the messages POST route reads `getRoomMode(roomId)` BEFORE storing the message; if mode === 'closed' it returns **409 Conflict** with body `{ message: "Room is closed (read-only). Use ant room mode --room ID --set brainstorm|heads-down to reopen." }`. No store, no fanout. brainstorm + heads-down both still store + fanout (mode shapes only the fanout target-set under heads-down; M3.b.4 doesn't change that — true heads-down routing lands in M3.b.5).

---

## Q7 — CLI verb shape

```
ant room mode --room ROOM_ID
  → reads current mode; prints "brainstorm" | "heads-down" | "closed" | "(unset → brainstorm default)".
  → GET is read-only / unauthenticated; no pidChain sent.

ant room mode --room ROOM_ID --set brainstorm
ant room mode --room ROOM_ID --set heads-down
ant room mode --room ROOM_ID --set closed
  → flips mode; prints "Set room mode to <mode> in <roomId> (by <handle>)".
  → returns exit 1 + stderr if 403 (caller not a member) or 400.
  → The write path POSTs pidChain in the PUT body and the server enforces strict 403.

ant room mode --room ROOM_ID --toggle
  → if current mode is brainstorm   → PUT --set heads-down
  → if current mode is heads-down   → PUT --set brainstorm
  → if current mode is closed       → REFUSE: exit 1 + stderr
       "Room is closed. Use --set brainstorm|heads-down to leave closed."
       (No PUT request issued; closed → non-closed requires explicit --set.)
  → Conflict: --set and --toggle are mutually exclusive (400 from CLI if both given).
```

Lives in NEW `scripts/ant-cli-room.mjs` (room is a new top-level verb, singular form to match `chat` / `plan` / `invite` / `register`). DISPATCH entry added to `scripts/ant-cli.mjs`. Write subverbs walk pidChain via processIdentityChain() automatically. When M3.b.5 (responders) ships, `ant room responders ...` joins this file.

**--toggle cycle choice rationale (B3):** boss flagged three options to JWPK — (a) cycle B→HD→C→B, (b) flip-most-recent-two, (c) refuse-if-closed. JWPK preference "none stated, your call, simplest unless strong reason otherwise." Picked **(c)** because JWPK's earlier wording was explicit ("does NOT reopen closed accidentally") and closed=read-only-freeze is heavier than the other modes — a one-key toggle into or out of it is more dangerous than a one-key toggle between brainstorm and heads-down.

---

## Q8 — Mode-history audit log

| Option | Audit shape |
|---|---|
| 8a | None — current mode only, no history | Simplest. |
| 8b | `chat_room_mode_history(id PK, room_id, mode, previous_mode, set_by, set_at)` append-only table | Full audit log; current mode is the latest row. |
| 8c | Single row in `chat_room_modes` with the current mode AND a `previous_mode` field | One-transition history. |

**JWPK answered 2026-05-13: 8b with no expiry — keep every room-mode change event forever, no purge.** chat_room_mode_history table is added to the implementation scope. Schema: `chat_room_mode_history(id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT, mode TEXT CHECK IN ('brainstorm','heads-down','closed'), previous_mode TEXT, set_by TEXT, set_at INTEGER)`. INSERTed on every PUT mode change. Indexed (room_id, set_at DESC) for fast "show me this room's mode history" reads.

---

## Locked acceptance — M3.b.4 implementation slice (claim-first AFTER this doc PASS + JWPK ACK)

**Scope is mode-state + API + CLI + fallback warning ONLY.** True heads-down delivery routing is M3.b.5's deliverable (B3 fix per codex2).

1. `src/lib/server/db.ts` schema migrations append TWO tables (both idempotent):
   - `chat_room_modes(room_id TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK (mode IN ('brainstorm', 'heads-down', 'closed')), set_by TEXT, set_at INTEGER)` — current mode per room.
   - `chat_room_mode_history(id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('brainstorm', 'heads-down', 'closed')), previous_mode TEXT, set_by TEXT, set_at INTEGER NOT NULL)` — append-only audit log, no expiry per JWPK Q2c.
   - Index `CREATE INDEX IF NOT EXISTS idx_mode_history_room_set_at ON chat_room_mode_history(room_id, set_at DESC)`.
   - Update db.ts header persistence-scope comment to include both new tables.
2. `src/lib/server/roomModesStore.ts` (NEW, ≤140L): `getRoomMode(roomId)` (default 'brainstorm' if no row), `setRoomMode({roomId, mode, set_by})` (writes current-mode row AND inserts history row atomically inside a tx), `listModeHistory(roomId, limit?)`. better-sqlite3-backed.
3. `src/routes/api/chat-rooms/[roomId]/mode/+server.ts` (NEW, ≤120L): GET (plain) + PUT (strict 403). PUT validates mode ∈ 3-enum (B2); on success calls setRoomMode which writes both tables in one tx.
4. **POST /messages closed-guard (B1):** EDIT `src/routes/api/chat-rooms/[roomId]/messages/+server.ts` to read `getRoomMode(roomId)` early and return **409** with the closed-message body before any storage / fanout work. ~+10L. Add corresponding test.
5. **IDENTITY-GATE helper extraction (B4):** extract `parsePidChainFromBody` + `resolveServerSideHandle` from messages route into `src/lib/server/identityGate.ts` (NEW, ~60L). Import in both messages route and mode route. Net code reduction in messages route.
6. `src/lib/server/pty-inject-fanout.ts` (EDIT, ~+18L): read mode once at fanout entry; closed → return early (defensive race-guard, see Q5); heads-down + responders-missing → console-warn + fall back to brainstorm; brainstorm → existing behaviour.
7. `scripts/ant-cli-room.mjs` (NEW, ≤180L): `handleRoomVerb` dispatch with `mode` subverb handling `--set <mode>`, `--toggle` (refuse when closed, per Q7), mutually exclusive flag check, GET path.
8. `scripts/ant-cli.mjs` DISPATCH (EDIT, +1L if absent): `room: './ant-cli-room.mjs'`.
9. **Tests (B3 explicit coverage):**
   - `src/lib/server/roomModesStore.test.ts` (≤140L): default-brainstorm-when-no-row, set+read roundtrip, **history is append-only** (4 successive flips → 4 rows, current-row only 1), `previous_mode` populated correctly.
   - `src/routes/api/chat-rooms/[roomId]/mode/server.test.ts` (≤200L): GET default, GET stored, PUT 200 each-mode (brainstorm/heads-down/closed), PUT 400 invalid-mode, PUT 403 non-member, PUT 400 missing pidChain, **history row appended on every successful PUT**.
   - `src/routes/api/chat-rooms/[roomId]/messages.closed-guard.test.ts` (NEW, ≤120L): **POST messages route returns 409 when room mode = closed**, returns 200 when mode = brainstorm/heads-down.
   - `scripts/ant-cli-room.test.mjs` (≤180L): read, --set each-of-3-modes, **--toggle brainstorm→heads-down, --toggle heads-down→brainstorm, --toggle closed REFUSES with exit 1 + stderr (no PUT issued)**, --set + --toggle mutually exclusive.
   - `src/lib/server/identityGate.test.ts` if extracted.
10. Live verification on :6461: GET defaults to brainstorm. PUT --set heads-down returns 200 + persists across kickstart. PUT --set closed returns 200. POST /messages while closed returns 409. PUT --set brainstorm reopens; POST /messages returns 200. CLI --toggle works correctly across all 3 states. History table accumulates rows.
11. NO new dependencies. NO UI changes. No regression in existing 779 tests.

---

## Locked acceptance — M3.b.5 responders (separate slice, follow-on)

Not in this contract. M3.b.5 will:
- Define `chat_room_responders(room_id, terminal_id, order_index, busy_until?)` table.
- CLI: `ant room responders --room ID --list`, `--set @h1,@h2,@h3`, `--move @h to front`, `--remove @h`.
- Fanout integration for heads-down mode: route to `responders[0]` if not busy, else `responders[1]`, etc. Stop-on-accept = first non-busy gets the message; busy = pane_status not 'verified'.

Sketched here for completeness; design contract for M3.b.5 ships when M3.b.4 lands.

---

## Do-not-use

| Choice | Reason |
|---|---|
| Storing mode in chatRoomStore in-memory | Wipes on kickstart, defeats the user-experience of "set it once". |
| Allowing any client to flip mode without pidChain auth | Open vector for handle-impersonation in a security-critical room setting. |
| Reading mode INSIDE the fanout loop (per-message) instead of once per room-event | Wastes DB calls; mode change is rare, message arrival is frequent. Read once per fanout call. |
| Coupling mode and responders into one table | Two concerns (mode = a state enum, responders = a list); coupling makes both harder to test in isolation. |

---

## Open questions for JWPK / team sign-off — ALL FOUR ANSWERED 2026-05-13

1. **Third mode?** → ANSWERED: YES — `closed` is the third mode. Schema CHECK now `IN ('brainstorm','heads-down','closed')`. closed = **server REJECTS new POSTs with 409**, existing history readable, no inject (no new messages exist to fan out).
2. **Default for existing rooms?** → ANSWERED: brainstorm for both new AND existing rooms unless explicitly changed.
3. **Audit history depth?** → ANSWERED: forever — keep every change event with no expiry. `chat_room_mode_history` append-only table is in scope.
4. **--toggle flag?** → ANSWERED: YES with option (c) refuse-if-closed semantics. `--toggle` cycles brainstorm ↔ heads-down only; if room is closed, exits 1 + stderr without issuing a PUT; opt-in/opt-out of closed requires explicit `--set`.

All four answered; contract is implementation-ready. Implementation claim-first comes next.

---

## What I did NOT verify (timebox honesty)

- chatRoomStore exact shape post-rooms-persistence (the rooms-persistence design contract on disk targets it; I'm assuming `chat_room_modes` stays a separate table so we don't fight the migration).
- whether fanout reads mode INSIDE the queue flush or BEFORE enqueue. The mode is per-room state and a message-burst from the same room should be one mode-read, not N reads. The implementation slice will lock this; design-contract notes "read once per fanout call" as a perf invariant.
- Live tmux behaviour of heads-down mode — depends on responders M3.b.5; current slice ships only brainstorm-effective + heads-down-falls-back-to-brainstorm.

---

## Next step

If @evolveantcodex gates this contract PASS and JWPK ACKs (or doesn't push back within a tick window), I claim-first the M3.b.4 implementation slice with the locked-acceptance above. Otherwise: list specific revisions and I take a tightening pass.

End of contract.
