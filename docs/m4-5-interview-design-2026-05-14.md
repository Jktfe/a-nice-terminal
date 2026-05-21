# M4.5 ant interview start/end — design contract — 2026-05-14

Author: @claude2 TTVPh3mnu8wERzALQLJO6
Gate: canonical @codex2 RQO32LuIK8xmcV7fq04Oq
Source: DELIVERY-PLAN.md L131-132

## Why

DELIVERY-PLAN promises `ant interview start --room <id> --with @handle`
and `ant interview end <id>`. No interview surface exists in fresh-ANT
today (scouted: no `src/lib/server/interview*` files, no
`/api/interview*` routes). M4.5 is a from-scratch design + impl slice.
Pattern follows M4.4 chair handoff: per-room state column + audit
table + 2 CLI subverbs + pidChain-strict gate.

## Scope

IN: fresh-ANT CLI verbs `ant interview start` + `ant interview end`,
fresh-ANT route changes (POST start / PATCH end), schema additions
(chat_room_interviews table), pidChain-strict auth, system messages
on state transitions, manifest entries (2 rows defaulting fresh-ant).

OUT: interview-content recording (no transcript capture in v1),
voice/elevenlabs integration (L133 is a separate slice), interview
analytics, chair handoff integration (separate semantic; interviews
are NOT chair state — orthogonal).

## Question locks (recommended defaults — REJECT to amend)

### Q1 Interview semantic
**Lock**: an interview is a server-tracked "focused conversation"
state between a starter (caller) and a subject (`--with @handle`)
within a room. Both must be current room members. The state column
on `chat_rooms` is `current_interview_id TEXT` (nullable); one active
interview per room max. v1 does NOT alter chat routing or message
visibility — interview state is metadata that UIs/agents may render
(e.g., "Interview with @kimi in progress") but the server doesn't gate
messages by it.

**Why**: keeps the slice bounded. Active-interview metadata is useful
on its own; integrating with chat routing / chair / etc. comes later.

### Q2 Storage shape (delta-1 amendment)
**Lock**: NEW table `chat_room_interviews` (append-only history) +
`chat_rooms.current_interview_id` as an APP-LEVEL pointer column
(TEXT, no FK). Schema:

```sql
ALTER TABLE chat_rooms ADD COLUMN current_interview_id TEXT;
CREATE TABLE IF NOT EXISTS chat_room_interviews (
  id              TEXT PRIMARY KEY,
  room_id         TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  interviewer     TEXT NOT NULL,
  subject_handle  TEXT NOT NULL,
  started_at_ms   INTEGER NOT NULL,
  ended_at_ms     INTEGER,
  end_reason      TEXT
);
CREATE INDEX IF NOT EXISTS idx_chat_room_interviews_room_started
  ON chat_room_interviews (room_id, started_at_ms DESC);
```

**Delta-1**: prior Q2 wording said `current_interview_id` carries an
FK SET NULL. SQLite cannot ALTER TABLE ADD COLUMN with a foreign key
cleanly without a table rebuild — same constraint that drove M4.4 Q5
parent_message_id to no-FK. `current_interview_id` is an APP-LEVEL
pointer; the `chat_room_interviews.room_id` FK CASCADE remains the
authoritative cleanup edge. interviewStore code reads
`chat_room_interviews` by the pointer + verifies on lookup.

`ended_at_ms IS NULL` indicates active. Pattern mirrors M4.4's
`current_chair_handle` + `chat_room_chair_history` pair (where
current_chair_handle is also app-level, no FK).

### Q3 CLI verb shape + identifiers (delta-2 route-shape alignment)
**Lock**:
- `ant interview start --room <id> --with @handle [--json]` — POST
  `/api/chat-rooms/:roomId/interviews`. Creates a new interview row,
  sets `chat_rooms.current_interview_id`. Prints the new interview-id
  (for `end`).
- `ant interview end <interview-id> [--reason "..."] [--json]` — PATCH
  `/api/interviews/:interviewId/end` (top-level, NOT nested under
  chat-rooms). Route looks up `room_id` from the interview row first,
  then runs `resolveCallerIdentityStrict(roomId, request, body)` so
  the auth check happens against the correct room. Sets `ended_at_ms`,
  clears `chat_rooms.current_interview_id` if it matches. Optional
  `--reason` body persists as `end_reason`.

**Delta-2 rationale**: prior Q3 + T2 had `end` route nested under
chat-rooms, but the CLI signature has no room positional. The CLI
cannot construct a nested URL from interview-id alone. Top-level
route + internal room-lookup keeps the CLI signature ergonomic
(no `--room` required) and resolves the contract mismatch.

**Why**: `<interview-id>` is the audit-record key and uniquely
identifies the room. Route-internal lookup keeps the CLI surface
clean while preserving auth scope.

### Q4 Auth + access boundaries (delta-1 narrows end-authority)
**Lock**: pidChain-strict via `resolveCallerIdentityStrict` (same
helper as M4.4 chair handoff). Caller must be a current member of
`<room-id>` (for `start`) AND must specifically be the interviewer OR
the subject (for `end`) — NOT any room member. Strict-403 on missing/
invalid identity, strict-403 on ordinary-other-member trying to end.

**Why**: matches M4.4 Q4 precedent for the start-path room-internal
discipline. For end-path, only the two parties to the interview have
the right to terminate it; arbitrary room members ending an interview
they aren't part of is a coordination foul. Q7 is now closed by this
narrowing (both interviewer + subject can end; ordinary other members
cannot).

### Q5 Invariants
**Lock**:
1. `start`: room must exist (404), subject must be member (404), no
   other active interview in same room (409).
2. `end`: interview row must exist (404), caller must be the
   interviewer OR the subject of THIS interview (403 otherwise),
   already-ended is idempotent (200, `changed:false`).
3. Subject self-interview rejected (400) — interviewer ≠ subject.
4. System message on start ("@interviewer started interview with
   @subject") + on end ("Interview with @subject ended[: reason]").

**Tests required** (from canonical B1): interviewer-end 200, subject-
end 200, ordinary-other-member-end 403, non-member-end 403, already-
ended-idempotent 200/changed:false.

### Q6 Manifest entries
**Lock**: 2 separate `av` rows (`interview-start`, `interview-end`)
defaulting `repo: 'fresh-ant'`. Replaces existing single
`pl('interview', ...)` placeholder at manifest.ts:299. Pattern matches
M4.4's 4-row chair flip.

**Why**: 1:1 verb-to-manifest-row per `manifest-cli-verb-facing-only`.

## Acceptance for M4.5 PASS

1. Doc under 180L, canonical RQO PASS.
2. Q1-Q6 locks ratified or amended.
3. T1-T3 chunk plan locked:
   - T1: schema (current_interview_id ALTER + chat_room_interviews
     table) + `interviewStore.ts` (startInterview / endInterview /
     getActiveInterview / listInterviewsForRoom) + tests +
     ant-cli-interview.mjs scaffold (deferred dispatch wiring).
   - T2: routes (POST /api/chat-rooms/:roomId/interviews NEW for
     start + PATCH /api/interviews/:interviewId/end NEW top-level for
     end — route looks up room_id from the interview row internally
     before running resolveCallerIdentityStrict) + route tests
     covering all Q5 invariants.
   - T3: CLI dispatch re-wire + manifest 2-row flip + CLI bun-test.

## Q7 (delta-1 closed in Q4 narrowing)

**Resolved**: BOTH interviewer AND subject may end; arbitrary other
room members may NOT. See Q4 + Q5 invariant 2 + tests-required.
