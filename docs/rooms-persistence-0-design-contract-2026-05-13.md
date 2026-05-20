# ROOMS-PERSISTENCE-0 Design Contract — extending ~/.ant/fresh-ant.db

**Author:** researchant
**Date:** 2026-05-13
**Timebox:** 30 min compact, read-only
**Scope:** Lock the design for persisting fresh-ANT chat-room state across kickstart. Builds on PTY-INJECT-A's better-sqlite3 + ABI mitigation pattern. NO code in this slice. JWPK morning ACK gates implementation.
**Audience:** evolveantcodex (gate), claude2 (implementer-in-waiting), JWPK
**Constraint:** compact, no 2h doc.

---

## TL;DR

**Extend `~/.ant/fresh-ant.db` (A's existing better-sqlite3 file) with rooms-persistence tables in a single new SLICE-A** covering five critical-mass stores: `chatRoomStore`, `chatMessageStore`, `chatInviteStore`, `chatRoomAliasStore`, `chatMembershipBinding`. Schema migrations follow A's `SCHEMA_DDL_STATEMENTS` append-only pattern. globalThis singleton via the existing key. ABI mitigation stays as documented in A's `db.ts` header.

This stops the 5-IDs-rotated-per-day pattern: kickstart no longer wipes ant-build / ant-evolve. Coordinator no longer re-provisions after every restart.

**Tier-2 stores** (planModeStore, askStore, agentTimelineStore) — DEFERRED to a follow-up SLICE-B. planModeStore is recoverable via re-running the PLAN-VISIBLE seed script; ask/timeline are nice-to-have but not on the critical path.

**Observer drop-in clarifications (added 2026-05-13 after coordinator + codex2 + claude2 notes):**

- **Monitor-surface persistence (per coordinator):** JWPK's monitor URL `/plan-mode/ant-vnext-overnight-2026-05-13` is backed by planModeStore which IS in-memory. So the monitor itself only survives kickstart via re-running PLAN-VISIBLE seed:overnight. **JWPK pick (Q-J2 below):** is a re-run on every kickstart acceptable (lossless via idempotent seed) OR is the monitor important enough to bump planModeStore from Tier 2 to Tier 1?

- **Durable-vs-replay-convenience distinction (per codex2):** chatRooms / chatMessages / chatInvites / chatRoomAliases / chatMembershipBindings are DURABLE source-of-truth stores — losing them is data loss. planModeStore / agentTimelineStore / askStore are REPLAY/SEED conveniences — re-derivable from other sources (seed script, message stream, agent re-post). The two categories warrant different persistence treatments. This slice covers durable Tier 1; replay-conveniences fit a lighter Slice B (could even be hybrid — keep in-memory but persist a snapshot every N minutes, restore on boot).

- **Supersedence of earlier persistence-doc (per claude2):** `docs/persistence-research-2026-05-12.md` recommended `bun:sqlite` Option B as the persistence driver. PTY-INJECT-A SUPERSEDED that recommendation by adopting `better-sqlite3` instead, per [[feedback_verify_runtime_via_lsof_not_plist]] — the bun-spawns-node pattern means the live runtime is Node v20.19.4, not Bun. The earlier doc's bun:sqlite recommendation was never tested against the actual runtime; the lsof check post-A proved it would have crashed. **Recommendation: amend `persistence-research-2026-05-12.md` with a SUPERSEDED stamp** at the top + pointer to this doc + the lsof feedback memory entry. ROOMS-PERSISTENCE-0 inherits the better-sqlite3 + ABI mitigation pattern from PTY-INJECT-A's `db.ts` header — same driver, same hazard, same recovery procedure. The FTS5 question from the earlier doc is still open and remains a follow-up slice.

**Tier-3 stores** (typingIndicator, composerDraft, messageReadReceipt, messageReaction) — INTENTIONALLY EPHEMERAL. Persisting "user X is typing" across a reboot would be confusing UX, not a feature.

---

## Inventory: in-memory stores at risk on kickstart

Verified via `wc -l src/lib/server/*Store.ts` 2026-05-13 ~07:30 BST:

### TIER 1 — critical for real-team coordination (THIS SLICE)
| Store | LOC | Why persist |
|---|---|---|
| `chatRoomStore` | 210 | Rooms-survive-kickstart is the headline ask |
| `chatMessageStore` | 178 | Message history must survive — JWPK reading scrollback after restart |
| `chatInviteStore` | 251 | Outstanding invites must survive (token + ttl semantics) |
| `chatRoomAliasStore` | 145 | Per-room aliases (e.g. ant-build short-name) tied to room IDs |
| `chatMembershipBinding` | (file exists, LOC not measured in 30min) | Maps room↔terminal — already-shipped roomMembershipsStore (A) is the source-of-truth for terminal membership; binding is the room-scoped membership glue |

### TIER 2 — useful but reseedable / non-critical (SLICE B FOLLOWUP)
| Store | LOC | Why deferrable |
|---|---|---|
| `planModeStore` | 133 | PLAN-VISIBLE seed:overnight script re-emits 27 events idempotently. Lossless |
| `askStore` | 185 | New asks can be re-posted by agents. Lossy but recoverable conversationally |
| `agentTimelineStore` | 99 | Useful for retrospective; not blocking real-time coordination |
| `chairStore` + `chairEnabledStore` + `chairDigestNoteStore` | 159+24+65 | Chair feature; not on critical path per ANT scope memory |
| `chatRoomParticipationHistoryStore` | 81 | Read-mostly; can re-derive from message stream if needed |
| `focusModeStore` | 107 | Per-member queueing; loses queued state but doesn't break flow |

### TIER 3 — INTENTIONALLY EPHEMERAL (DO NOT PERSIST)
| Store | LOC | Why NOT persist |
|---|---|---|
| `typingIndicatorStore` | 72 | "User X is typing" across a reboot is confusing UX |
| `composerDraftStore` | 86 | Browser-local concept; server should not be the source-of-truth |
| `messageReadReceiptStore` | 83 | Read state across reboot is OK to reset; better than re-marking everything unread |
| `messageReactionStore` | 106 | Reactions are presentation; loss across reboot is acceptable for now (could be Tier 2 later if JWPK wants it persistent) |
| `messageSearchStore` | 80 | Index is derivable from messages; rebuild on first search |
| `chatAttachmentStore` | 148 | Attachments themselves should be on disk (filesystem); metadata can be Tier 2 |

### TIER 4 — already persistent (PTY-INJECT-A)
| Store | LOC | Backing |
|---|---|---|
| `terminalsStore` | 180 | better-sqlite3 ~/.ant/fresh-ant.db |
| `roomMembershipsStore` | 117 | better-sqlite3 ~/.ant/fresh-ant.db |

### TIER 5 — special case
| Store | LOC | Notes |
|---|---|---|
| `memoryRecallStore` | 324 | **Exceeds 260L cap.** Pre-existing. Not in scope for this slice. Worth flagging for separate refactor. |

---

## Q1 — Single-DB vs separate file

| Option | Approach | Trade-off |
|---|---|---|
| 1a | Extend `~/.ant/fresh-ant.db` (A's existing file) with new tables | Atomic transactions across stores; one file to back up; one ABI hazard surface |
| 1b | New `~/.ant/fresh-ant-rooms.db` separate file | Isolation if rooms schema fails; doubles ABI hazard surface; no cross-table txns |
| 1c | One file per store (chatrooms.db, chatmessages.db, etc.) | Maximum isolation; impossible cross-table txns; complex ops |

**Recommendation: 1a (extend fresh-ant.db).** Single-DB matches the v2 doc Option B persistence framing AND the established A pattern. Atomic transactions across stores enable correct cascading deletes (delete room → delete its messages → delete its invites). One ABI hazard surface is simpler to monitor than two.

---

## Q2 — Schema migration pattern

| Option | Approach | Trade-off |
|---|---|---|
| 2a | Lift A's `SCHEMA_DDL_STATEMENTS` array — append-only `CREATE TABLE IF NOT EXISTS` | Already proven in A; idempotent; simple |
| 2b | Versioned migrations (e.g. `0001_init.sql`, `0002_add_rooms.sql`) with a `schema_version` table | Heavier; future-proof for `ALTER TABLE` |
| 2c | ORM-managed (Drizzle / Prisma) | Out of scope per persistence-doc do-not-use list |

**Recommendation: 2a.** A's pattern handles greenfield schemas cleanly. The day we need an `ALTER TABLE` (column add / type change), we add a `schema_version` table then. YAGNI. Append the new `CREATE TABLE` statements to A's existing `SCHEMA_DDL_STATEMENTS` array; on next process boot, the new tables get created.

---

## Q3 — Schema shape for the 5 Tier-1 stores

Following A's terminalsStore + roomMembershipsStore template (id, ts columns, indexes on hot lookups):

```
chat_rooms(
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  created_by    TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  archived_at   INTEGER,
  meta          TEXT  -- JSON for extension fields
);

chat_messages(
  id            TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  post_order    INTEGER NOT NULL,         -- monotonic per-room, used for tail / pagination
  author_handle TEXT,
  author_kind   TEXT,                     -- human | agent | system | system-break
  body          TEXT NOT NULL,
  posted_at     INTEGER NOT NULL,
  meta          TEXT,
  UNIQUE(room_id, post_order)
);

chat_invites(
  id              TEXT PRIMARY KEY,
  room_id         TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  invite_token    TEXT NOT NULL UNIQUE,
  ttl_seconds     INTEGER,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER,
  redeemed_at     INTEGER,
  redeemed_by     TEXT,
  meta            TEXT
);

chat_room_aliases(
  id            TEXT PRIMARY KEY,
  room_id       TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  alias         TEXT NOT NULL,
  scope         TEXT,                       -- e.g. global / per-terminal
  created_at    INTEGER NOT NULL,
  UNIQUE(alias, scope)
);

chat_membership_bindings(
  id              TEXT PRIMARY KEY,
  room_id         TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  membership_id   TEXT NOT NULL REFERENCES room_memberships(id) ON DELETE CASCADE,
  bound_at        INTEGER NOT NULL,
  meta            TEXT,
  UNIQUE(room_id, membership_id)
);
```

Indices: `chat_messages(room_id, post_order DESC)` for tail queries; `chat_invites(invite_token)` UNIQUE for redemption lookup; `chat_room_aliases(alias)` for resolution.

WAL mode + foreign_keys ON per A's existing pattern.

---

## Q4 — Acceptance: kickstart-survival proof shape

Required acceptance evidence:
1. Pre-kickstart: create a room, post 3 messages, create 1 invite, register an alias, bind a member.
2. Capture room_id, message ids, invite token, alias string.
3. Run `launchctl kickstart -k gui/501/com.ant.fresh` (this is the operation that has been wiping rooms 5x today).
4. Wait for service alive.
5. GET `/api/chat-rooms` returns the room with the SAME id (not re-provisioned).
6. GET `/api/chat-rooms/<id>/messages` returns the same 3 messages with same post_order, same author_handle, same body bytes.
7. GET invite token → still valid (or expired correctly per ttl_seconds).
8. GET alias → resolves to the same room_id.
9. GET membership binding → same terminal_id.
10. v3 /ant 200 (untouched).
11. No PTY-cap exhaustion (lsof /dev/ptmx unchanged before/after).

This is THE binding gate. The whole point of the slice is that the 5-IDs-rotation pattern stops.

---

## Q5 — Perf budget for hot lookups

Hot paths and budgets:
- `getRoomById(id)` — single-row PRIMARY KEY lookup. Budget: <0.5ms p99.
- `getMessagesByRoom(room_id, since_post_order, limit)` — index scan with LIMIT. Budget: <2ms p99 for limit=50.
- `getInviteByToken(token)` — single-row UNIQUE lookup. Budget: <0.5ms p99.
- `resolveAlias(alias)` — single-row UNIQUE lookup. Budget: <0.5ms p99.

better-sqlite3 + WAL mode comfortably hits these budgets at fresh-ANT scale (single-Mac, single-user). No performance concerns. Acceptance test: a synthetic burst of 100 messages posted in <1s should not block the fanout pipeline.

---

## Q6 — System-message provenance after replay

Open question for JWPK: when a room is restored from disk after kickstart, system-messages emitted DURING the previous run (e.g. stale-marker "@claude2 appears offline") were authored by `@evolveantcodex` (the bridge agent). After replay, they appear authored by an agent that may not currently be on the membership.

| Option | Behavior |
|---|---|
| 6a | Preserve original `author_handle` exactly | Honest. May confuse users if author is no longer a member |
| 6b | Replace with `@system` for replay | Less honest. Loses original-author trace |
| 6c | Preserve + add `replay_provenance: { original_author, replay_run_id }` | Most honest, schema bloat |

Researchant view: 6a (preserve). System messages are author-attributed in the v2 contract for the live case; persistence shouldn't change that semantics. JWPK to confirm.

---

## Q7 — Message ID stability across replay

Currently message IDs are generated server-side at POST time (e.g. `msg_abc123`). On replay, these IDs are loaded from disk verbatim. No regeneration. This is the right behavior — IDs are the canonical reference for click-through, citations in plan events, etc. JWPK should know: any client that cached a message_id pre-kickstart will still resolve it post-kickstart.

---

## Q8 — Ordering preservation

`post_order` is monotonic per-room (`UNIQUE(room_id, post_order)` enforces it). On replay, ordering is preserved by sorting on `post_order DESC` (newest first) for tail queries. No ambiguity.

NEW MESSAGE post-replay continues from MAX(post_order) + 1 for the room. Server tracks this in-memory after the first read; persists via the natural INSERT ordering.

---

## Do-not-use

| Choice | Reason |
|---|---|
| **bun:sqlite** | Per [[feedback_verify_runtime_via_lsof_not_plist]]: launchd com.ant.fresh actually runs Node v20.19.4, not Bun. bun:sqlite would crash on import. better-sqlite3 is the correct driver for this stack — already proven in A. |
| **Persisting Tier-3 stores** (typing, composer-draft, read-receipt) | These are intentionally ephemeral. Persisting "user X is typing" across reboots is anti-feature. |
| **FTS5 in this slice** | Per the persistence-doc Option B FTS5-on-macOS probe gate. Not blocking rooms-survive-kickstart. Add as separate slice when search becomes a real ask. |
| **Obsidian markdown mirror** | Per PTY-INJECT-0 Q3. Out of scope for this slice; tracked separately. |
| **Schema-version table now** | YAGNI. Append-only `CREATE IF NOT EXISTS` works for greenfield. Add when first `ALTER TABLE` is needed. |
| **Drizzle / Prisma ORM** | Per the persistence-doc do-not-use list (CLI-style, out of fresh-ANT pattern). |

---

## Open questions for JWPK

### Q-J1: scope confirmation

Does ROOMS-PERSISTENCE-A (the next implementation slice) cover exactly the 5 Tier-1 stores listed, or do you want more/fewer? Researchant default = the 5 named.

### Q-J2: planModeStore — defer to Slice B or include in Slice A?

planModeStore is Tier-2 in researchant view (re-seed via PLAN-VISIBLE seeder works lossless). evolveantcodex correction noted it's also at-risk. JWPK pick: defer to Slice B (smaller A, faster ship) or include in A (one-shot, larger slice).

### Q-J3: system-message provenance after replay (Q6)

Researchant default = preserve original author exactly (option 6a). JWPK confirm or pick alternative.

### Q-J4: Tier-3 ephemerality

Researchant claims typing/composer-draft/read-receipt should NOT be persisted. Is JWPK aligned? If JWPK wants read-receipts persistent (e.g. for "you've read up to here" memory across sessions), bump to Tier 2.

### Q-J5: backup / recovery story

The DB at `~/.ant/fresh-ant.db` lives in `~/.ant/`. Do you want any periodic backup (Time Machine handles already, or explicit copy-to-Obsidian)? Out of scope for this slice but worth a Q.

---

## What I did NOT verify (timebox honesty)

- `chatMembershipBinding` exact LOC and exact schema fields — verified file exists but didn't read it. Schema sketch above is researchant's best inference; implementer should adjust to match the existing in-memory shape.
- Whether any of the Tier-1 stores have inter-store dependencies (e.g. chatMessageStore implicitly assumes chatRoomStore membership). The CASCADE constraints in the schema sketch should handle this if dependencies follow the obvious shape.
- `memoryRecallStore` at 324L exceeds the 260L cap — pre-existing, not in this slice's scope, but worth a separate refactor flag.
- Whether better-sqlite3 WAL mode handles the synthetic-burst test (100 messages in <1s) without write-stall. Should be fine at this scale but unverified by probe.
- Whether the existing `~/.ant/fresh-ant.db` SQLite size + index growth fits the worst-case fresh-ANT use (years of message history). At fresh-ANT-scale this is non-issue, but a future archival/compaction slice should track it.

---

## Next step

If JWPK ACKs Option 1a + the 5-store Tier-1 scope: claude2 claims **ROOMS-PERSISTENCE-A** with locked acceptance from Q4.

Slice A acceptance evidence template:
1. New stores at `src/lib/server/chatRoomStorePersistent.ts` (or refactor existing in-place — JWPK call) following terminalsStore template
2. Schema appended to db.ts SCHEMA_DDL_STATEMENTS
3. All existing tests still pass (no behavioral regression)
4. NEW kickstart-survival integration test per Q4 evidence shape
5. Live deploy + real kickstart cycle on :6461 → ant-build/ant-evolve survive

Slice B (Tier-2: planModeStore + askStore + agentTimelineStore + chair*) is a separate slice after A passes.

End of contract.
