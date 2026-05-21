# Responders Design Contract — M3.b.5

**Author:** @claude2
**Date:** 2026-05-13
**Slice:** Phase 3b sub-slice M3.b.5 (per-room ordered responder list + heads-down routing)
**Scope:** Lock the design contract for the responders table + CLI/route shape + fanout integration that REPLACES the M3.b.4 heads-down warn-and-fallback hook with real walk-the-list routing. NO code in this slice.
**Audience:** @evolveantcodex (gate), @evolveantclaude (coordinator), JWPK
**Constraint:** compact, single-file, follows the room-mode contract shape; ≤260 lines (initial target 230L expanded post-HOLD to absorb B1+B2+B3 lock-in algorithms — same expansion pattern as the M3.b.4 contract).
**Depends on:** M3.b.4 (PASS, mode-state + fanout hook ready), terminals.pane_status (existing busy-ish signal).

---

## TL;DR

A chat room in **heads-down** mode picks ONE recipient for each inbound message instead of fanning out to every member. That recipient is the next non-busy entry in the room's **ordered responder list**. Authoring the list is what turns the M3.b.4 mode-state from "warn-and-fall-back-to-brainstorm" into a real routing decision. **Heads-down STAYS heads-down (per JWPK 2026-05-13)**: if no responder is available, the message is stored in the room and a rate-limited system-marker posts ("no responder available") — NO silent brainstorm-fallback, NO force-deliver to a busy responder. See Q8.

State lives in a NEW `chat_room_responders(id, room_id, terminal_id, order_index, set_by, set_at)` table in `~/.ant/fresh-ant.db`, same persistence tier as `chat_room_modes`. Unique on (room_id, terminal_id) and (room_id, order_index). Order is owned by the writer; gap-tolerant integer keys, never reflows on remove.

Fanout reads the list when mode === 'heads-down': walk in order, pick the first entry whose terminal has `pane_status='verified'` (the existing "pane is at a ready prompt" signal), inject to that one terminal only, stop. If no responder is `verified` OR list is empty → **no-responder system marker** (Q8 option C per JWPK).

CLI surface: `ant room responders --room ID` (list), `--set "@a,@b,@c"` (replace list), `--add @x [--at N]` (insert), `--remove @x` (drop), `--move @x --to N` (reorder). All writes go through IDENTITY-GATE.

**Busy-signal boundary (per coordinator brief):** v1 uses `pane_status='verified'` as the "ready to receive" signal — that's what M3.b.4's fanout already trusts when picking inject targets. A richer "actively typing / mid-task" status is Phase 3a M3.4a's deliverable; when it lands, the busy-skip predicate in this contract upgrades from `pane_status==='verified'` to `pane_status==='verified' && agentStatus !== 'thinking|typing'`. Designing for that upgrade now, not waiting.

---

## Q1 — Schema shape for the responders list

| Option | Shape | Trade-off |
|---|---|---|
| 1a | `chat_room_responders(id PK, room_id, terminal_id, order_index, set_by, set_at)` UNIQUE(room_id, terminal_id) + UNIQUE(room_id, order_index) | Clean separation; explicit order; gap-tolerant. |
| 1b | Single TEXT column on chat_room_modes: `responders` (JSON-encoded array of terminal_ids) | Smallest schema delta. Awkward for partial updates; loses set_by per-entry attribution. |
| 1c | Reuse room_memberships, add `responder_order INTEGER NULL` column | Couples membership + routing. Hard to have a member who's NOT a responder. |

**Recommendation: 1a.** Mirrors the chat_room_modes shape; explicit and queryable; gap-tolerant integer ordering means remove never has to reflow other rows. Trade-off: one more table to migrate later when rooms-persistence consolidates; acceptable per the same "one-job-per-table" principle that M3.b.4 used.

Schema: `chat_room_responders(id INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL, terminal_id TEXT NOT NULL REFERENCES terminals(id) ON DELETE CASCADE, order_index INTEGER NOT NULL, set_by TEXT, set_at INTEGER NOT NULL, UNIQUE(room_id, terminal_id), UNIQUE(room_id, order_index))`. Index `(room_id, order_index ASC)` so read-the-list is one scan.

**B2 order_index algorithm lock (per codex2 HOLD 2026-05-13):** SPARSE INTEGER INDEXING with midpoint allocation, deferred compaction. Concrete algorithm:

- **Append** (default for `--add @x` with no `--at`): `order_index = (max(order_index for room_id) ?? 0) + 1000`. Initial step 1000 leaves room for ~10 midpoint insertions before forced compact.
- **Insert-at (`--add @x --at N`)**: N is a 0-based logical position. Compute `before = order_index of position N-1 (or 0 if N=0)`, `after = order_index of position N (or before+2000 if appending past end)`. New `order_index = floor((before + after) / 2)`. If `after - before < 2` → run compact-tx for the room then retry.
- **Move (`--move @x --to N`)**: same midpoint calc as insert-at, single UPDATE wrapped in a tx that first checks `before + 2 ≤ after`; if not, compact-then-update.
- **Remove**: pure DELETE. Other rows are NOT reflowed. Subsequent reads order by `order_index ASC` and pick logical positions from the sorted result.
- **PUT replace-all**: clears all rows for the room then inserts the new list with `order_index = 1000, 2000, 3000, ...`. One tx.
- **Compact** (internal, on-demand): renumbers all rows in a room to `1000, 2000, 3000, ...` in one tx. Triggered ONLY when an insert can't find a gap (rare; gives O(N) worst-case writes, O(1) common case).

The UNIQUE(room_id, order_index) constraint catches algorithm bugs at the DB layer — any concurrent collision throws and the tx rolls back, surfaced as 409 to the caller (retry-safe).

---

## Q2 — Who is identified — handle or terminal_id?

| Option | Identifier | Trade-off |
|---|---|---|
| 2a | terminal_id (PK from terminals table) | Stable when handle changes per-room. Direct link to pane_status. |
| 2b | room-scoped handle (UNIQUE in room_memberships) | Familiar in CLI ("@claude2"). Resolves to terminal at read-time. |
| 2c | Both — store terminal_id AND a snapshot of handle for display | Redundant; handle can drift, terminal_id is authoritative. |

**Recommendation: 2a.** terminal_id is the routing-relevant key — fanout needs pane_status and tmux_target_pane both of which hang off terminals. CLI accepts handles and resolves to terminal_id at write-time via `getTerminalIdByHandle(roomId, handle)` (existing). Display layer joins terminal_id back to membership for the handle to show.

---

## Q3 — Default state for new rooms

**Recommendation: empty list.** New rooms have no responders until someone sets them. Combined with default mode=brainstorm (M3.b.4), a freshly created room behaves as today; no one is silently picked-as-responder.

---

## Q4 — Who can edit the responder list?

Mirror M3.b.4 Q4 decision: **any room member** (JWPK ACKed 4a). All writes record `set_by` for audit; if abuse surfaces, tighten later.

---

## Q5 — Fanout integration (REPLACES the M3.b.4 warn hook)

`src/lib/server/pty-inject-fanout.ts:fanoutMessageToRoomTerminals` currently:

```
if (mode === 'closed') return;
if (mode === 'heads-down') console.warn("...M3.b.5 not yet implemented..."); // falls through to brainstorm
... loop all members ...
```

After M3.b.5 the heads-down branch becomes:

```
if (mode === 'heads-down') {
  const responders = listRespondersForRoom(roomId);          // ordered, joined to pane_status
  const recipient = pickNextResponder(responders, message);  // see Q8 (pure)
  if (recipient) {
    // enqueue to recipient terminal only (sender is skipped inside pickNextResponder)
    enqueueOne(roomId, recipient.terminal_id, message);
    return;
  }
  // null path: emit rate-limited marker + return. Heads-down stays heads-down per JWPK 2026-05-13. No brainstorm fallback. No force-inject.
  emitNoResponderSystemMarker(roomId);
  return;
}
```

Brainstorm and closed branches are unchanged. The walk function is pure given (responders, message) so it's unit-testable without any tmux mocking.

**Skip-the-sender rule:** if the message's authorHandle resolves to a terminal that's in the responder list, that terminal is skipped during pick (don't echo a message back to the author's pane). The pick walks past them.

---

## Q6 — REST endpoint shape

```
GET  /api/chat-rooms/:roomId/responders
  → 200 { roomId, responders: [{ terminal_id, handle, order_index, pane_status, set_by, set_at }, ...] }
       handle is joined from room_memberships at read-time; pane_status from terminals.
  → 404 if room not found.

PUT  /api/chat-rooms/:roomId/responders
  Body: { handles: ["@a", "@b", "@c"], pidChain: [...] }
  → 200 { roomId, responders: [...resolved...] } — REPLACES the entire ordered list (set semantics).
  → 400 on malformed body, unknown handle, or duplicate handle.
  → 403 strict, IDENTITY-GATE via pidChain.

POST /api/chat-rooms/:roomId/responders
  Body: { handle: "@x", at?: number, pidChain: [...] } (insert-at-position or append)
  → 200 { responders: [...] }
  → 400 on duplicate or unknown handle.
  → 403 strict.

PATCH /api/chat-rooms/:roomId/responders
  Body: { handle: "@x", to: number, pidChain: [...] } (move existing handle to position)
  → 200 { responders: [...] }
  → 400 if handle not in list or `to` out of range.

DELETE /api/chat-rooms/:roomId/responders
  Body: { handle: "@x", pidChain: [...] }
  → 200 { responders: [...] } (remaining)
  → 404 if handle not in list.
  → 403 strict.
```

**B1 lock (per codex2 HOLD 2026-05-13):** DELETE WITH JSON BODY is the chosen transport. SvelteKit's `request.json()` handles DELETE-with-body the same as POST/PUT/PATCH (Node's fetch + the SvelteKit dev/prod handlers parse JSON regardless of verb). No query-string pidChain (avoids URL-length + URL-encoding hazards on long pidChains) and no POST-with-_method tunnelling (keeps the verb honest for RESTful caches/loggers). If a downstream proxy or framework upgrade ever strips DELETE bodies, the migration path is POST /responders/remove — but no current evidence justifies the up-front complexity.

All 4 write routes share the identityGate.ts helpers extracted in M3.b.4 T2. Net new code in the route is small.

---

## Q7 — CLI verb shape

```
ant room responders --room ID                          → list (text or --json)
ant room responders --room ID --set "@a,@b,@c"          → REPLACES the whole ordered list
ant room responders --room ID --add @x [--at N]         → insert (default: append at end)
ant room responders --room ID --remove @x               → drop one
ant room responders --room ID --move @x --to N          → reorder one
```

Lives in `scripts/ant-cli-room.mjs` (already extended for `mode` in M3.b.4). Stays under the 260L cap; budget allows ~80L of additions. Same processIdentityChain pidChain pattern for writes. `--set` and `--add`/`--remove`/`--move` are mutually exclusive (CLI 400).

---

## Q8 — Pick policy when responders is empty OR all busy

**Definition of busy (v1):** `terminal.pane_status !== 'verified'` (i.e. unknown OR stale). When M3.4a status callable lands, upgrade to also exclude agents whose status is 'thinking' / 'typing' / 'busy'.

| Option | Empty list | All-busy |
|---|---|---|
| 8a | Fall back to brainstorm fanout (today's M3.b.4 warn behaviour, no log) | Same — fall back to brainstorm |
| 8b | Fall back to brainstorm fanout | Inject to first-in-list anyway (best-effort delivery) |
| 8c | Reject POST messages with 412 "set responders first" | Reject POST messages with 412 |
| 8d | DLQ a system message into the room: "no responder available" | DLQ system message |

**JWPK answered 2026-05-13: option C (8d) — heads-down stays heads-down.** "If every listed responder is busy/unavailable, ANT should post a system marker / no-responder-available notice and deliver to nobody until a responder is available. Do NOT silently fallback to brainstorm, and do NOT force-deliver to the first unavailable responder."

Both the empty-list AND all-busy cases collapse into the same behaviour: the message IS still stored in the room (history preserves it), but NO PTY inject fires and ONE rate-limited system-marker posts saying "no responder available". Sender sees the marker in the room and knows to either set responders, mark someone available, or wait.

**B3 picker/fanout boundary lock (per codex2 HOLD 2026-05-13 + JWPK option C 2026-05-13):** Picker stays PURE and KNOWS NOTHING about fallback policy. Fanout OWNS the policy:

- `pickNextResponder(responders, message)` returns the first non-sender entry whose `terminal.pane_status === 'verified'`, OR `null`. Null covers BOTH empty list AND no-verified-non-sender — picker does NOT distinguish.
- Fanout (in pty-inject-fanout.ts heads-down branch) executes the null-case fallback explicitly per JWPK C:

```
const responders = listRespondersForRoom(roomId);          // ordered, joined to pane_status
const pick = pickNextResponder(responders, message);
if (pick) { enqueueOne(pick); return; }
// null path — heads-down stays heads-down per JWPK 2026-05-13.
// Message is already stored in chatMessageStore (caller already postMessaged it).
// We do NOT inject anyone and we do NOT broadcast as brainstorm.
emitNoResponderSystemMarker(roomId);  // rate-limited per (room) — see below
return;
```

Rate-limit pattern: reuse the existing stale-marker rate-limit Map (60-min per key), keyed by roomId alone (not room+handle, since the marker is a property of the room not the recipient). One marker per room per hour max — avoids flood when a steady stream of messages hits a no-responder room.

Tests pin BOTH sides:
- responderPicker.test.ts: returns null on empty list, returns null when all are non-verified, returns null when only non-sender entries are non-verified, returns first-verified-non-sender on happy path.
- pty-inject-fanout.test.ts: heads-down + empty list → 0 enqueued + emitNoResponderSystemMarker called once; heads-down + all-busy → 0 enqueued + marker called once; heads-down + all-busy + repeat-fire within 60min → marker called ONCE not twice (rate-limit); heads-down + verified responder → exactly 1 enqueued + marker NOT called.

Trade-off (per JWPK rationale): heads-down narrowness is preserved — no surprise broadcasts, no force-pings to busy agents. Cost is delivery latency when responders are all busy (sender must wait for someone to become verified). That cost is intentional: heads-down is FOR teams that prefer focused delivery over broadcast.

---

## Locked acceptance — M3.b.5 implementation slice (claim-first AFTER this doc PASS + JWPK ACK)

1. `src/lib/server/db.ts` schema migration appends `chat_room_responders` table + ordered-list index. Idempotent.
2. `src/lib/server/roomRespondersStore.ts` (NEW, ≤180L): `listRespondersForRoom(roomId)`, `setResponders({roomId, terminalIds, set_by})` (replace-all in tx), `addResponder({roomId, terminalId, at?, set_by})`, `removeResponder({roomId, terminalId})`, `moveResponder({roomId, terminalId, to})`. better-sqlite3.
3. `src/lib/server/responderPicker.ts` (NEW, ≤80L): pure `pickNextResponder(responders, message)` — returns first responder where `pane_status === 'verified'` AND `handle !== message.authorHandle`, OR null. NO knowledge of fallback policy; null covers both empty + all-busy (see Q8 B3). Side-effect-free + unit-testable.
4. `src/routes/api/chat-rooms/[roomId]/responders/+server.ts` (NEW, ≤200L): GET + PUT + POST + PATCH + DELETE handlers, all writes via identityGate.ts.
5. `src/lib/server/pty-inject-fanout.ts` (EDIT, ~+30L): heads-down branch replaces the warn-and-fall-through with the Q8/B3/JWPK-C algorithm: `pick → enqueueOne` happy path; `null → emitNoResponderSystemMarker(roomId)` (rate-limited 60-min per room) + return. NO brainstorm fallback. NO force-inject to busy responders. The existing stale-marker Map can be reused (or a parallel `noResponderMarkerLastEmitted` Map — implementation pick).
6. `scripts/ant-cli-room.mjs` (EDIT, ~+90L of 260L cap): `responders` subverb with --set/--add/--remove/--move and mutual-exclusion check.
7. Tests:
   - `roomRespondersStore.test.ts` (≤180L): set+read roundtrip, add-at-position, remove, move (forward + backward), unique constraints, gap-tolerant ordering after remove.
   - `responderPicker.test.ts` (≤150L): empty list returns null, single verified returns it, first-verified skipped if = sender, all-busy returns null (caller does fallback), mixed verified/stale returns first-verified.
   - `responders/server.test.ts` (≤220L): full CRUD endpoint test with 403/400/404 paths.
   - `pty-inject-fanout.test.ts` (EDIT, ~+50L) — pinned to JWPK-C invariants:
       * heads-down + verified responder → exactly 1 enqueue + NO marker emit.
       * heads-down + empty list → 0 enqueue + emitNoResponderSystemMarker called once.
       * heads-down + populated list with all non-verified → 0 enqueue + marker called once.
       * heads-down + repeat-fire within 60-min rate-limit window → marker called ONCE not twice.
       * heads-down + verified responder = the sender → 0 enqueue (skip-sender) + marker called once (degenerate case treated as no available responder).
   - `ant-cli-room.test.mjs` (EDIT, ~+80L): responders --set/--add/--move/--remove flows + mutual-exclusion.
8. Live :6461 verification: set 2 responders, post message in heads-down, observe inject lands on responders[0] only; mark responders[0] stale via direct DB write, post again, observe inject on responders[1].
9. NO new dependencies. NO UI changes. No regression in baseline (currently 885).

---

## Do-not-use

| Choice | Reason |
|---|---|
| Storing responders in JSON column on chat_room_modes | Loses per-entry attribution, fragile to partial updates. |
| Reusing room_memberships with an `order` column | Couples membership and routing; can't have a member who isn't a responder, can't have a responder who isn't a member (latter is intentional). |
| Reflowing order_index on every remove | Quadratic on bulk operations. Gap-tolerant integer ordering scales. |
| Hard-rejecting POST messages when responder list is empty | Bad UX during transition; surprising for a team that just flipped to heads-down. |
| Implementing rich BUSY status here | Lane confusion — that's M3.4a / Phase 3a status callable. Use pane_status as v1 proxy. |

---

## Open questions for JWPK / team sign-off

1. ~~**Empty-list policy**~~ — LOCKED by JWPK 2026-05-13 option C: emit rate-limited system marker, no brainstorm fallback.
2. ~~**All-busy policy**~~ — LOCKED by JWPK 2026-05-13 option C: same as empty-list. Heads-down stays heads-down.
3. **Cap on responder list length** — practical bound (e.g. 10), or unlimited? Affects pick perf negligibly but bounds CLI display.
4. **Sender-in-list** — if @a posts in a room where the responder list is [@a, @b, @c], should we (a) skip @a + inject @b (recommended, the obvious "don't echo to author") or (b) treat the message as "from outside" and inject @a anyway?
5. ~~**DELETE-with-body**~~ — LOCKED per B1: DELETE accepts a JSON body with handle + pidChain. Migration to POST /responders/remove only if a downstream proxy strips DELETE bodies (no current evidence).

---

## What I did NOT verify (timebox honesty)

- Exact M3.4a status-callable interface shape — referenced but not built. The pickNextResponder predicate is designed to be upgradable without changing callers.
- Whether listRespondersForRoom should JOIN terminals.pane_status at SQL level vs let pickNextResponder call getTerminalById per entry. Tied to perf; the implementation slice will pick (likely JOIN — one query beats N).
- Sparse-integer compact-tx perf under high-churn insert-at-position workloads. Algorithm is locked at sparse midpoint + 1000-step compact-on-collision (B2); only the perf characteristics under pathological reorder bursts are unverified.

---

## Next step

If @evolveantcodex gates this contract PASS and JWPK ACKs (or doesn't push back within a tick window), I claim-first the M3.b.5 implementation slice with the locked-acceptance above. Otherwise: list specific revisions and I take a tightening pass.

End of contract.
