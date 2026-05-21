# ROOMS-PERSISTENCE-A Phase 5.0 design contract — 2026-05-14

Author: @claude2 TTVPh3mnu8wERzALQLJO6
Gate: canonical @codex2 RQO32LuIK8xmcV7fq04Oq
Lane: A (per evolveantclaude tick 29.5 allocation)

## Why

fresh-ANT chatRoomStore + chatMessageStore are in-memory Maps lost on
process restart. Real dogfooded migration off v3 tmuxes requires rooms +
messages to survive restarts. M3.6a-v0/v1 + M3.4b discussions + M3.b.5
responders already persist via better-sqlite3 at `~/.ant/fresh-ant.db`;
this slice extends that pattern to rooms + messages.

## Scope

IN: chatRoomStore (rooms + member roster) + chatMessageStore (messages)
swap from `Map<string, ...>` to better-sqlite3 tables. Public function
exports unchanged. Reset helpers unchanged in signature.

OUT: WebSocket fanout (already persisted via PTY layer), aliases store
(already memory-only — separate slice), rooms list / search ordering
changes, schema migrations for existing v3 data, full-text search.

## Question locks (recommended defaults — REJECT to amend)

### Q1 Public API identity / no caller churn
**Lock**: Every exported function in chatRoomStore.ts + chatMessageStore.ts
keeps its current name + signature + return type. Internal storage swap
is invisible to the 102 caller files. New helpers (e.g. db-prepared
statement caches) live as module-local non-exports.

**Why**: 30+ test files + 20+ components + 6+ routes import these
directly. Caller churn = 102-file blast radius. Identity preservation
collapses it to single-module change + reset-helper tweak.

### Q2 resetXXXForTests semantics
**Lock**: `resetChatRoomStoreForTests()` runs `DELETE FROM chat_rooms;
DELETE FROM chat_room_members;` inside `getIdentityDb()`. Same for
`resetChatMessageStoreForTests()` → `DELETE FROM chat_messages;`. Tests
that already use `ANT_FRESH_DB_PATH` per-test tmpdir override (e.g.
closed-guard.test.ts) keep working unchanged. Tests that DON'T isolate
get DELETE-FROM cleanup, matching today's `clear()` semantics.

**Why**: Two co-existing test patterns today (in-memory clear vs tmpdir
override per closed-guard.test.ts). Both should keep working without
edits. DELETE FROM is fast on empty tables, safe inside same-process
better-sqlite3 transaction.

### Q3 DB env override + singleton pattern
**Lock**: Reuse `getIdentityDb()` from `src/lib/server/db.ts`. NEW DDL
statements added to `SCHEMA_DDL_STATEMENTS` array. `ANT_FRESH_DB_PATH`
env override path already wired; same `globalThis` singleton key
(`__antFreshIdentityDb`). No new DB connection, no new file path.

**Why**: One DB file, one schema bootstrap, one reset path. All other
fresh-ANT persisted stores use this pattern; rooms/messages joining is
mechanical.

### Q4 postOrder — global, table-shape locked
**Lock**: GLOBAL postOrder preserved. Table shape MUST be:

```sql
chat_messages (
  id              TEXT PRIMARY KEY,            -- public msg_xxxx id
  room_id         TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  post_order      INTEGER NOT NULL UNIQUE,     -- global monotonic
  ...
)
```

post_order populated by `COALESCE((SELECT MAX(post_order) FROM
chat_messages), 0) + 1` inside the INSERT statement, wrapped in a
`db.transaction()` block. better-sqlite3 is single-process serial-write,
so the MAX-then-INSERT race only matters across multiple connections —
fresh-ANT uses one DB handle per process via getIdentityDb singleton, so
the transaction guarantees monotonicity without a sequence table.

REJECTED: `INTEGER PRIMARY KEY AUTOINCREMENT` on post_order — conflicts
with the existing public ChatMessage.id (string `msg_xxxx`) which must
stay TEXT PRIMARY KEY for caller-API identity (Q1).

**Why**: Today's `nextPostOrder` is global. Some downstream code (memory-
recall, search ordering) reads postOrder as a monotonic counter across
rooms. Per-room postOrder would silently break those ordering invariants.

### Q5 parent_message_id — permissive, no FK (delta-2 amendment)
**Lock**: `parent_message_id TEXT` — NO foreign key, NO cascade,
NO existence check at the store layer. Matches the M30 slice 1 store-
permissive contract: the store accepts any string verbatim, and the
/messages POST route owns the parent-exists / same-room 404 contract
via `validateAndResolveParentMessageId` (+server.ts L175-L194).

**Delta-2 amendment rationale** (Phase 5.2 implementation surface): the
prior Q5 wording locked `REFERENCES chat_messages(id) ON DELETE SET
NULL`, but that FK rejects INSERTs with unknown parent IDs — directly
breaking the M30 slice 1 test "store layer is permissive: unknown
parentMessageId still persists (validation is endpoint-level in slice
2)". Phase 5.2 implementation chose no-FK to honor the load-bearing
test invariant + the discussion_id permissive precedent (Q6). ON
DELETE SET NULL behaviour is moot today because messages aren't
individually deleted — only CASCADE-deleted via room removal. If
individual message deletion ever ships, revisit this column with an
explicit FK at that slice.

**Same-room invariant**: today enforced APP-LEVEL by
`validateAndResolveParentMessageId` in /messages/+server.ts L175-L194
(404 if parentMessageId references another room). DB CHECK via trigger
would be defense-in-depth but introduces SQLite trigger complexity for
no current test failure. RECOMMEND: keep app-level only in Phase 5.2;
revisit if cross-room replies surface in dogfood.

**Why permissive wins over FK SET NULL**: the M30 slice 1 store-only
test is the contract-of-record for store behaviour. Permissive store +
strict route is the same pattern used by discussion_id (Q6) — both are
"label" columns where the route owns validation. Adding a FK would
force two places to know about parent-existence, and the store would
silently reject INSERTs the route hasn't pre-validated.

### Q6 discussion_id permissive behaviour from M3.4b
**Lock**: `discussion_id TEXT` column (no FK, no NOT NULL, no existence
check at store layer). Mirrors today's M3.4b T2 Q3-3c soft-close
contract: discussion_id is a string label, store accepts any value, route
+ render layers own discussion-state semantics. NOT NULL or FK would
break the deferred soft-close pattern.

**Why**: Discussions are first-class rows in chat_discussions table, but
chat_messages.discussion_id is a permissive label (Q3-3c). The
permissiveness is load-bearing for the soft-close envelope marker, NOT
a missing feature.

### Q7 M3.6a-v1 auth-gate preservation
**Lock**: ZERO changes to /messages, /discussions, /members POST/DELETE
handlers. authGate.ts + authDeprecation.ts + identityGate.ts untouched.
Persistence swap happens BENEATH the route's `postMessage()` /
`createChatRoom()` / `inviteAgentToRoom()` calls. The 4 write-surface
strict-403 contracts (cookie-first, pidChain mixed-mode, deprecation
window, discussions strict-only) are runtime behavior the route owns;
this slice only changes WHERE the resulting state is stored.

**Why**: M3.6a-v1 canonical PASS landed delta-1 same day. Reverting any
of its 6+ test files OR any of the 4 write-surface handlers as a side
effect of persistence would re-open the spoofing hole. Test count
invariant: 1216/1216 vitest MUST stay green after both 5.1 + 5.2 land.

## Schema DDL sketches (delta-1 add for B2)

Implementer-verify against existing 11-table schema in Phase 5.1/5.2;
column ordering may shift to match db.ts house style but column set +
types + constraints are locked.

```sql
-- Phase 5.1
CREATE TABLE IF NOT EXISTS chat_rooms (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  summary             TEXT NOT NULL DEFAULT '',
  attention_state     TEXT NOT NULL DEFAULT 'ready',
  last_update         TEXT NOT NULL,
  when_it_was_created TEXT NOT NULL,
  who_created_it      TEXT NOT NULL,
  creation_order      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_creation_order
  ON chat_rooms (creation_order DESC);

CREATE TABLE IF NOT EXISTS chat_room_members (
  id            TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  handle        TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  joined_at     TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('human','agent')),
  UNIQUE(room_id, handle)
);

-- Phase 5.2
CREATE TABLE IF NOT EXISTS chat_messages (
  id                  TEXT PRIMARY KEY,
  room_id             TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  author_handle       TEXT NOT NULL,
  author_display_name TEXT NOT NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('human','agent','system','system-break')),
  body                TEXT NOT NULL,
  posted_at           TEXT NOT NULL,
  post_order          INTEGER NOT NULL UNIQUE,
  parent_message_id   TEXT,                       -- no FK; Q5 permissive lock
  discussion_id       TEXT                        -- no FK; Q6 permissive lock
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_room_post_order
  ON chat_messages (room_id, post_order ASC);
```

DDL string committed to db.ts SCHEMA_DDL_STATEMENTS array in Phase 5.1
(rooms + members) and Phase 5.2 (messages) — split mirrors the FK
dependency order.

## Reset semantics + FK cascade policy (delta-1 add for B3)

`PRAGMA foreign_keys = ON` is already set at db.ts L228 → ON DELETE
CASCADE WILL fire. Explicit reset order (children before parent) so
tests don't rely on cascade chain:

```ts
function resetChatRoomStoreForTests() {
  const db = getIdentityDb();
  db.prepare('DELETE FROM chat_room_members').run();
  db.prepare('DELETE FROM chat_rooms').run();
}

function resetChatMessageStoreForTests() {
  const db = getIdentityDb();
  db.prepare('DELETE FROM chat_messages').run();
}
```

If a test calls both resets, messages MUST be cleared before rooms (FK
constraint would block otherwise). The two reset helpers are
independent; test files that import both (e.g. discussions test file)
already call them in messages-then-rooms order — no caller churn.

## Acceptance for Phase 5.0 PASS

1. Doc at `docs/rooms-persistence-a-phase-5-0-design-contract-2026-05-14.md`
   under 260L, canonical RQO PASS.
2. Q1-Q7 locks RATIFIED or AMENDED in canonical PASS verdict body.
3. Schema DDL sketches in this doc reviewed + ratified by canonical RQO
   (column set, types, constraints, FK cascade). Implementer may adjust
   column order in Phase 5.1 to match db.ts house style.
4. Phase 5.1 / 5.2 ordering CONFIRMED: rooms (incl. members) first
   because chat_messages.room_id FK references chat_rooms.id.

## Phase 5.1 deferral (scope locked at design PASS, NOT implementation)

- Add `chat_rooms` + `chat_room_members` tables to db.ts DDL array.
- Swap chatRoomStore.ts Map storage → prepared-statement read/write.
- `resetChatRoomStoreForTests()` runs DELETE FROM both tables.
- Full vitest suite green; M3.6a-v1 strict-403 tests untouched.
- Live :6461 dogfood: create room via UI, restart fresh-ANT process,
  confirm room survives restart (the WHOLE POINT of this slice).

## Phase 5.2 deferral (scope locked at design PASS)

- Add `chat_messages` table to db.ts DDL array (depends on 5.1 chat_rooms).
- Swap chatMessageStore.ts Map storage → prepared-statement read/write.
- postOrder via SELECT MAX(post_order)+1 inside INSERT transaction.
- `resetChatMessageStoreForTests()` runs DELETE FROM chat_messages.
- Full vitest suite green; M3.6a-v1 + M3.4b discussions tests untouched.
- Live :6461 dogfood: post message, restart, confirm message survives.

## Open Q for canonical (single)

**Q8 5.0 timebox**: design contract sized 60-90 minutes from claim. If
canonical wants Q1-Q7 expanded (e.g. specific DDL strings inline,
indexed-column shortlist for chat_messages, transaction-isolation
mode), add as delta-1 amendment OR signal "approve as-is + amend in
Phase 5.1 design pass". Recommended: approve as-is — DDL details land
naturally in 5.1 where they can be implementer-verified against the
existing 11-table schema, not contract-locked here.
