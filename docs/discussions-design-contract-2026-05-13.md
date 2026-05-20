# Discussions Design Contract — M3.4b

**Author:** @claude2
**Date:** 2026-05-13
**Slice:** Phase 3b sub-slice M3.4b (discussion-create + discussion-close)
**Scope:** Lock the design contract for chat-discussion state + CLI/route shape + interaction with room-mode + M30 threading. NO code in this slice.
**Audience:** @evolveantcodex (gate), @evolveantclaude (coordinator), JWPK
**Constraint:** compact, single-file, follows the room-mode + responders contract shape; ≤260 lines (per the durable cap established post-M3.7b).
**Depends on:** M3.b.4 room-mode (PASS, closed-guard already rejects writes), M30 slice 2 parentMessageId threading (PASS, per-message parent linkage exists).

---

## TL;DR

A **discussion** is a named, opened-then-closed side-thread inside a chat room, seeded from a parent message. It exists so the room can keep multiple parallel conversations without losing track of which is which, and so an agent or human can mark a thread "done" with a written summary.

Three rules shape the v1:
- Discussion state lives in a NEW `chat_discussions(id, room_id, parent_message_id, title, status, opened_by, opened_at, closed_by, closed_at, summary)` table.
- Messages opt in via a new IN-MEMORY `discussion_id` field on the ChatMessage type (extends M30 parentMessageId; orthogonal — a message can have BOTH a parent AND a discussion_id). chat_messages remains in-memory in fresh-ANT v1; no SQL column lands in this slice (Q2/B3).
- Close records a summary (mutable via re-close PATCH per Q4) and SOFTLY marks subsequent posts with an envelope warning (`[Discussion closed <ago>, summary: ...]`) injected by the envelope formatter — does NOT hard-reject and does NOT store a marker on the message itself. Mirrors M3.b.4 room-mode-closed in spirit but allows postscripts (per @evolveantclaude lane-context guidance 2026-05-13).

CLI surface: `ant discussion create --room ROOM_ID --from MESSAGE_ID [--title "..."]`, `ant discussion close --id DISCUSSION_ID --summary "..."` (also re-close to update summary), `ant discussion list --room ROOM_ID`, `ant discussion show --id DISCUSSION_ID`. All writes through IDENTITY-GATE via pidChain.

Discussions are organisation, not access-control: all room members can read + reply within any open discussion in the room.

---

## Q1 — Where does discussion state live?

| Option | Storage | Trade-off |
|---|---|---|
| 1a | NEW `chat_discussions` table with status + summary + lifecycle | Distinct lifecycle/close-with-summary needs durable state. Clean separation from messages. |
| 1b | Derived from parentMessageId chains (no new table) | Cheapest schema but no place to store status/summary/close_at; close-with-summary impossible. |
| 1c | Extend chat_messages with discussion-marker fields | Couples message + discussion lifecycle; close-with-summary lives on the seed message; ugly. |

**Recommendation: 1a.** A discussion has its own lifecycle (open → close-with-summary), its own audit trail (opened_by/closed_by/closed_at), and exists independently of its child messages. Separate-table mirrors the discipline used by `chat_room_modes`/`chat_room_responders` in M3.b.4/5. Schema:

```
chat_discussions(
  id              TEXT PRIMARY KEY,
  room_id         TEXT NOT NULL,
  parent_message_id TEXT NOT NULL,
  title           TEXT,                   -- optional, defaults to parent message body excerpt
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_by       TEXT NOT NULL,
  opened_at       INTEGER NOT NULL,
  closed_by       TEXT,
  closed_at       INTEGER,
  summary         TEXT,
  UNIQUE(room_id, parent_message_id)      -- one discussion per parent message per room
)
INDEX idx_discussions_room_status ON chat_discussions(room_id, status)
```

UNIQUE constraint on `(room_id, parent_message_id)` prevents double-seeding the same message.

**B1 naming lock (per canonical codex2 HOLD 2026-05-13 + matching established M3.b.4 mode / M3.b.5 responders / M3.5a delivery wire patterns):** DB/SQL = snake_case. Internal store types = snake_case matching DB. Wire/JSON inner fields for NEW discussion entity = snake_case (`discussion_id`, `opened_by`, `opened_at`, `closed_by`, `closed_at`, `summary`, `status`). Wire/JSON top-level wrappers stay camelCase (`roomId`, `discussionId` URL-param, `pidChain`, `discussions`, `messages`). CLI flags = kebab-case (`--room`, `--from`, `--id`, `--summary`, `--title`, `--status`). In-memory ChatMessage gains snake_case `discussion_id` field to match the new-discussion-entity convention used by responders' `terminal_id` + mode's `set_by` + delivery's `pane_status`. **EXCEPTION: `parentMessageId` stays camelCase across wire/CLI/store** for M30 backwards-compat (already shipped in chatMessageStore + messages POST body + parent-validation route logic). New discussion linkage uses snake_case `discussion_id`; legacy M30 parent linkage stays camelCase `parentMessageId`.

---

## Q2 — How does a discussion own its messages?

| Option | Linkage | Trade-off |
|---|---|---|
| 2a | Discussion holds parent_message_id; child messages found by walking M30 parentMessageId chains | No schema change to chat_messages. O(N) per read to assemble discussion body. |
| 2b | v1 in-memory ChatMessage `discussion_id` field + list/filter lookup; SQL column/index deferred to rooms-persistence slice | Orthogonal to parentMessageId (a message can have both). No SQL migration in this slice. |
| 2c | Flat discussion-membership table (chat_discussion_messages) | One row per (discussion, message) pair; supports cross-discussion message sharing (unwanted). |

**Recommendation: 2b.** Orthogonal to M30 parentMessageId — a message can declare BOTH a parent (M30 reply-chain semantics) AND a `discussion_id` (this side-thread). Read path in v1 is a simple in-memory filter over `listMessagesInRoom`; SQL indexed lookup is deferred to the rooms-persistence slice. (Note: B1 names the field `discussion_id` in snake_case to match the eventual SQL column + the established `terminal_id` / `set_by` / `pane_status` wire-JSON convention. In-memory ChatMessage carries the same snake_case key.)

**B3 persistence boundary lock (per canonical codex2 HOLD 2026-05-13):** chat_messages remains IN-MEMORY in fresh-ANT for v1. The in-memory ChatMessage type gains a nullable `discussion_id?: string` field. NO SQL migration to chat_messages in this slice. NO FOREIGN KEY constraint claim (chat_messages has no SQL representation today). When the rooms-persistence slice migrates chat_messages to SQL, that slice's design owns whether to add `discussion_id REFERENCES chat_discussions(id) ON DELETE SET NULL` — explicitly NOT this slice's call.

Integrity in v1: chatDiscussionStore on every `getDiscussion(id)` join-with-messages READ filters chat_messages by `discussion_id === id`. Orphaned references (discussion_id pointing at a deleted discussion) silently disappear from the discussion view — acceptable for in-memory v1; SQL FK addresses it later.

---

## Q3 — What does "close" do?

| Option | Close behaviour |
|---|---|
| 3a | status flag only; new replies allowed with no marker | Toothless; close has no observable effect. |
| 3b | status flag + POST /messages with this discussion_id returns 409 (hard-reject) | Mirrors room-mode-closed exactly. No postscripts possible. |
| 3c | Status flag + new POSTs allowed but envelope auto-prepends `[Discussion closed <ago>, summary: ...]` marker | Soft-close: visible warning, but postscripts OK. Boss lane-context preference. |

**Recommendation: 3c (per @evolveantclaude 2026-05-13).** Close records status + closed_at + closed_by + summary on chat_discussions. New POSTs to /messages with discussion_id-of-closed are ACCEPTED (201) and stored normally; the stored message carries NO marker field — the closed-state warning is added ONLY by the envelope formatter at fanout-assembly time (B-fix: marker is envelope-only, never on the stored message). When a recipient's pane receives the message, the envelope reads `[ANT room ... msg=... disc=...] [Discussion closed Nh ago, summary: "..."] @sender: body` — the marker is injected if discussionStore reports status='closed' at fanout time. The warning is visible to recipients; postscripts are explicitly allowed.

Trade-off vs 3b: less symmetry with room-mode-closed (which hard-rejects). Won on the product side: chat threads sometimes need a final "actually, one more thing" after the wrap-up — hard-reject feels punitive. If soft-close proves wrong (e.g. teams ignore the marker and pollute closed threads), follow-up slice swaps to 3b. Re-evaluation gate: 30-day usage review.

Reopen-via-clear-status is out of scope for v1. Close is the recorded action; re-close updates summary (Q4).

---

## Q4 — Summary field requirements

| Option | Summary policy |
|---|---|
| 4a | Required at close-time | Forces team to articulate outcome. |
| 4b | Required at close-time AND mutable via re-close PATCH | Allows post-hoc summary edit. Boss lane-context preference. |
| 4c | Required at close-time AND immutable post-close (no edit) | Strongest decisions-record invariant. |
| 4d | Append-only history of summaries (chat_discussion_summary_history) | Audit-rich but possibly over-engineered. |

**Recommendation: 4b (per @evolveantclaude 2026-05-13).** PATCH /api/discussions/{id} with body `{ summary, pidChain }` always returns 200 — if already closed, updates summary in place; if open, transitions to closed + records summary. Empty summary on the transition-to-closed PATCH = 400. set_by/set_at update on every close-or-re-close. No history table — single mutable summary field.

Trade-off vs 4c: less discipline (teams can edit after the fact). Won on the product side: bad summaries get fixed instead of living forever. The audit lives in `closed_by` + `closed_at` being mutable (each PATCH stamps), and the immutable record is the discussion's existence + child messages, not the summary.

---

## Q5 — REST endpoint shape

```
POST /api/chat-rooms/:roomId/discussions
  Body: { parentMessageId, title?, pidChain }
  → 201 { discussion: { id, room_id, parent_message_id, title, status='open', opened_by, opened_at } }
  → 400 missing fields; 404 if parentMessageId not in this room (matches M30 /messages route precedent for cross-room/unknown — avoids existence side-channel)
  → 403 strict identity-gate (pidChain unresolved)
  → 404 room not found
  → 409 if a discussion already exists for this (room, parentMessageId) — return existing id

GET /api/chat-rooms/:roomId/discussions [?status=open|closed|all]
  → 200 { discussions: [...] } sorted opened_at DESC

GET /api/discussions/:discussionId
  → 200 { discussion: {...}, messages: [...] } (messages filtered by discussion_id, ordered by postOrder ASC)
  → 404 unknown id

PATCH /api/discussions/:discussionId
  Body: { summary, pidChain }
  → 200 { discussion: {..., status='closed', closed_by, closed_at, summary} }
       (transitions open→closed on first PATCH; subsequent PATCH updates summary in place per Q4-4b)
  → 400 if summary missing / empty
  → 403 strict identity-gate
  → 404 unknown id

(REST verb is PATCH on root, not POST on /close sub-path, per @evolveantclaude lane-context 2026-05-13 — keeps URLs short for the close action and aligns with single-field-update PATCH semantics.)
```

All writes use the extracted `identityGate.ts` helpers from M3.b.5 T2. GET endpoints are read-only / no pidChain required (matches M3.4a-v1 status route convention). POST /messages route (M3.b.4 closed-guard) does NOT extend with discussion-closed reject — soft-close (Q3-3c) means messages still post; envelope formatter appends the closed marker.

---

## Q6 — Who can create / close?

Mirror M3.b.4/5 Q4: **any room member**. Audit via `opened_by` + `closed_by`. Tighten later if misuse surfaces (e.g. only-discussion-opener-can-close).

Rationale: a heavy authorization model upfront is harder to remove than add. The audit trail is observable + the summary is the durable record; misuse is visible.

---

## Q7 — Interaction with room-mode

| Mode | Discussion-create | Discussion-close | POST messages within discussion |
|---|---|---|---|
| brainstorm (default) | allowed | allowed | normal fanout to all room members; closed-discussion marker prepended if discussion_id-of-closed |
| heads-down | allowed (discussion is meta, not message) | allowed | heads-down picker walks per M3.b.5; closed-discussion marker prepended if applicable |
| closed (room) | rejected 409 (room read-only) | allowed (tidies up before freeze) | rejected 409 (room-mode closed-guard) |

Discussions are a layer above messages. Room-mode = closed prevents new state writes in the room (the existing M3.b.4 closed-guard handles it), but allows closing/re-closing existing open discussions for tidiness. Discussion-close while room-closed is intentional: lets a team finalise outstanding threads before leaving the room frozen.

POST /messages route only checks room-mode closed (M3.b.4); the discussion-closed marker is added by the envelope formatter (Q3-3c soft-close), not by a reject. Order remains single-check at message-post; soft-marker work happens at fanout-envelope assembly.

---

## Q8 — Fanout behaviour for discussion messages

Discussion messages flow through the SAME `pty-inject-fanout.ts` path. The discussion_id is just metadata; routing decisions remain at the room/mode level.

- brainstorm + discussion message → fanout to all room members (sender excluded). Recipients see envelope tagged `[ANT room <name> id=<id> msg=<msg-id> disc=<disc-id>] @<sender>: <body>` (the `disc=` tag is new; envelope formatter gets a +1 line edit).
- heads-down + discussion message → picker selects first verified non-sender responder. If null → rate-limited no-responder marker (same JWPK-C semantic).
- closed → message rejected at route, never reaches fanout.

Discussion membership is NOT a separate access-control concept. All room members can read/reply within any open discussion. This keeps the model simple; access-control is at room level.

---

## Q9 — CLI verb shape

```
ant discussion create --room ROOM_ID --from MESSAGE_ID [--title "..."] [--json]
  → POSTs to /api/chat-rooms/{roomId}/discussions with pidChain.
  → Prints discussion id + parent message ref + opened_by.

ant discussion close --id DISCUSSION_ID --summary "..." [--json]
  → PATCHes /api/discussions/{id} with body { summary, pidChain } (per Q5; not POST sub-path).
  → On first call: transitions open→closed + records summary.
  → On subsequent call: updates summary in place (Q4-4b re-close mutability).
  → Refuses (exit 1 + stderr) if --summary is missing/empty (mirrors server 400).

ant discussion list --room ROOM_ID [--status open|closed|all] [--json]
  → GETs discussions for room; default --status open.

ant discussion show --id DISCUSSION_ID [--json]
  → GETs discussion + child messages.
```

Lives in NEW `scripts/ant-cli-discussion.mjs`. Adds DISPATCH entry in `scripts/ant-cli.mjs`. Single new file; no extension of room-cli (different verb namespace `discussion` vs `room`).

---

## Locked acceptance — M3.4b implementation slice (claim-first AFTER doc PASS + JWPK ACK)

1. `src/lib/server/db.ts` schema append `chat_discussions` table + index; idempotent CREATE IF NOT EXISTS.
2. `src/lib/server/chatDiscussionStore.ts` (NEW, target 140L cap 160L): `createDiscussion`, `closeDiscussion` (sets status + summary atomically), `getDiscussion`, `listDiscussionsForRoom(roomId, status?)`. better-sqlite3.
3. `src/lib/server/chatMessageStore.ts` (EDIT, ~+5L): in-memory ChatMessage type gains nullable `discussion_id?: string` field (snake_case per B1); postMessage accepts/persists it. NO SQL migration in this slice — chat_messages remains in-memory; column lands when rooms-persistence ships. NO `closed_marker` field added (marker is envelope-only per Q3-3c).
4. `src/routes/api/chat-rooms/[roomId]/discussions/+server.ts` (NEW, target 100L cap 120L): GET list + POST create. identity-gated via shared helpers.
5. `src/routes/api/discussions/[discussionId]/+server.ts` (NEW, target 130L cap 150L): GET read (no pidChain, returns discussion + filtered child messages) AND PATCH close-or-re-close (identity-gated; transitions open→closed on first PATCH OR updates summary in place on subsequent PATCH per Q4-4b; 400 if summary missing/empty).
6. **NO separate /close route** — PATCH-on-root per Q5 (per @evolveantclaude). Removed from acceptance.
7. `src/routes/api/chat-rooms/[roomId]/messages/+server.ts` (EDIT, ~+3L): extract optional `discussion_id` (snake_case wire inner field per B1) from POST body and pass it to `postMessage({ ..., discussion_id })`. NO closed-discussion reject (Q3-3c soft-close — closed-marker is added by the envelope formatter, item 8, not by a POST guard). Unknown `discussion_id` is silently accepted in v1 (orphan filtering happens at GET-time per Q2 B3); production hardening to 400 on unknown is a follow-up.
8. `src/lib/server/pty-inject-bridge.ts` (EDIT, ~+10L formatEnvelope): when message has `discussion_id`, look up the discussion via chatDiscussionStore at envelope-format time; ALWAYS include `disc=<id>` tag in the envelope header (per Q8 + B4 default-locked YES); if status='closed', also prepend `[Discussion closed <ago>, summary: "<summary>"]` to the envelope body. Marker is computed per-fanout-call from store state — never read from message field.
9. `scripts/ant-cli-discussion.mjs` (NEW, target 150L cap 180L): 4 subverbs (create/close/list/show) with mutual-exclusion-free flag shapes.
10. `scripts/ant-cli.mjs` DISPATCH (EDIT, +1L): `discussion: './ant-cli-discussion.mjs'`.
11. Tests:
    - `chatDiscussionStore.test.ts` (≤140L): create + close (PATCH-transition) + re-close (PATCH-update-summary per Q4-4b) + list + roundtrip + UNIQUE-on-parent.
    - `discussions-rooms/server.test.ts` (≤180L): GET list + POST create + 403/400/404/409 paths for /chat-rooms/[roomId]/discussions.
    - `discussions/server.test.ts` (≤180L): GET read + PATCH close + PATCH re-close-updates-summary + 400 summary-empty + 403 identity-gate + 404 unknown discussion.
    - `pty-inject-envelope.test.ts` (EDIT, +~30L): envelope renders `disc=<id>` tag when `discussion_id` set on the message; envelope prepends `[Discussion closed ...]` marker when discussion status='closed'.
    - `ant-cli-discussion.test.mjs` (≤180L scripts-harness): 4-subverb CRUD shape + flag handling.
12. Live :6461 verification: create discussion from a message, post 2 child messages with discussion_id, PATCH close with summary, verify subsequent POST messages with the closed discussion_id returns 201 (NOT 409 — Q3-3c soft-close) AND that the envelope formatter prepends the closed marker, verify GET shows the 3 messages (2 pre-close + 1 post-close postscript) + discussion close metadata. Verify re-PATCH updates the summary in place (Q4-4b).
13. NO new dependencies. NO UI changes (UI is its own follow-up). No regression in current 939 baseline.

---

## Do-not-use

| Choice | Reason |
|---|---|
| Deriving discussion from parentMessageId tree-walk | Loses status/summary/audit; toothless close. |
| Coupling discussion to chat_messages schema (option 1c) | Lifecycles are different (message immutable, discussion has open→close). |
| Adding reopen to v1 | Discourages clean summaries; if real ask surfaces, separate slice. |
| Per-discussion access-control (members must opt-in) | Discussions are organisation, not access-control. Room-membership is the gate. |
| Immutable summary post-close | Q4-4b locks summary as mutable via re-close PATCH. The audit lives in closed_by + closed_at being re-stamped on each PATCH, not in summary immutability. |
| Required title on create | Title is helpful but not load-bearing; default to parent message excerpt. |

---

## B4 default-locks (per canonical codex2 HOLD 2026-05-13)

To unblock implementation claim-first without round-tripping JWPK, defaults are LOCKED here. If JWPK later overrides, follow-up patch slice.

1. **Required summary at close** → LOCKED: required + MUTABLE via re-close PATCH (Q4-4b). Empty summary on first close = 400. Re-close PATCH updates summary in place. (Boss lane-context preference; chosen over immutable 4c.)
2. **Reopen in v1** → LOCKED: NO. v1 supports close + re-close (summary edit) only. Status transitions are one-way open→closed; no closed→open. If reopen becomes a real ask, separate slice handles it.
3. **Closing-room auto-close open discussions** → LOCKED: NO auto-close. Room-mode=closed simply rejects new discussion-creates (409); existing open discussions stay open. Discussion-close requires explicit PATCH per discussion. (Rationale: auto-close would silently overwrite open discussions with placeholder summaries — worse than leaving them open.)
4. **Envelope `disc=<id>` tag** → LOCKED: YES include the tag. Low-byte (~10 chars per envelope), high-readability value (recipients can grep their inbox by discussion). Soft-close marker `[Discussion closed ...]` is the other envelope addition.

JWPK can override any of the 4 defaults via a single chat message; the contract patches in <1 tick.

---

## What I did NOT verify (timebox honesty)

- Whether the rooms-persistence design contract (researchant draft) has a specific stance on `discussion_id` column placement when chat_messages migrates to SQL — assumed safe to land the in-memory shape now; SQL migration is the rooms-persistence slice's call.
- Whether fanout perf under deep-discussion scenarios (200+ messages on one discussion_id) needs the GET to paginate. Implementation slice will assess; v1 returns full list with no cursor.
- Whether title auto-default (parent message body excerpt) needs special-casing for system-break or media messages — assumed first 80 chars of body works for the human-readable case; edge cases addressed in implementation.

---

## Next step

If @evolveantcodex gates this contract PASS and JWPK ACKs (or doesn't push back within a tick window), I claim-first the M3.4b implementation slice with the locked-acceptance above. Otherwise: list specific revisions and I take a tightening pass.

End of contract.
