# M4.4 ant chair enable/disable/handoff/board — design contract — 2026-05-14

Author: @claude2 TTVPh3mnu8wERzALQLJO6
Gate: canonical @codex2 RQO32LuIK8xmcV7fq04Oq
Source: DELIVERY-PLAN.md L128-130 (Plug-ins, MCP, Chair, Interview section)

## Why

The Chair plug-in is the always-on cheap-model agent that watches every
room and produces a per-room digest. Today it has fresh-ANT-native
server-side surface (`chairStore`, `chairEnabledStore`, `/api/chair*`
routes — all at `/CascadeProjects/ant/src/lib/server/` and
`/CascadeProjects/ant/src/routes/api/chair*/`) but NO `ant chair <verb>`
CLI. DELIVERY-PLAN locks four verbs: `enable`, `disable`, `handoff`,
`board`. M4.4 ships the fresh-ANT CLI wrapper around the existing
fresh-ANT server surface — distinct from M2.3 sessions-digest which
was a v3 wrapper. Handoff is the new semantic; the other three are
thin read/toggle wrappers.

## Scope

IN: `ant chair enable`, `ant chair disable`, `ant chair handoff
<room-id> --to @handle`, `ant chair board <room-id>`. Fresh-ANT CLI
wrapper + fresh-ANT route changes (POST handoff NEW, PUT chair-enabled
gains pidChain-strict guard) + tests + manifest flip pl→av. Manifest
entries default `repo: 'fresh-ant'` (explicit repo field omitted —
source_refs resolve under `/CascadeProjects/ant/`).

OUT: Chair-watching policy changes, model-routing decisions
(mymatedave's lane per [[ant-no-model-router-no-chairman]]),
plug-in installation/discovery, board UI changes.

## Question locks (recommended defaults — REJECT to amend)

### Q1 chair enable/disable scope (delta-6 amendment)
**Lock**: enable/disable toggle the per-INSTANCE `chairEnabledState` in
`chairEnabledStore.ts`. CLI usage is `ant chair enable` / `ant chair
disable` — no positional room-id argument. Future per-room scoping (if
it ships) is a separate design contract.

**Delta-6 amendment**: prior wording locked an aspirational "accepts
room-id for symmetry + emits deprecation warning" that the shipped CLI
silently ignored. Coordinator-recommended PATH B drops the symmetry
lock — no behaviour debt, no vapor-surface.

**Why**: existing `chairEnabledStore` is module-level singleton; per-
room would need a new table + migration. Defer to hypothetical M4.4b.

### Q2 chair handoff semantics
**Lock**: `ant chair handoff <room-id> --to @handle` re-assigns the
"current speaker / chair-of-conversation" role in a given room to the
named handle. NEW behaviour — no existing surface. v1 implementation:
post a `system` message to the room body `"@oldChair handed chair to
@newHandle"` + store the current chair handle in a new lightweight
state column (recommend `chat_rooms.current_chair_handle TEXT`).

**Why**: handoff is the semantic addition that distinguishes M4.4
from a pure CLI-wrap slice. Three minimum invariants:
1. Caller must be a current member of `<room-id>` (pidChain-gated)
2. `--to` target must be a current member of `<room-id>` (404 otherwise)
3. Idempotent: handing off to the current chair is a no-op (200)

Audit: every handoff produces a `system` message AND a
`chat_room_chair_history` table row (locked in Q6 below; not optional).

### Q3 chair board read shape (delta-1 amendment)
**Lock**: `ant chair board <room-id>` calls `GET /api/chair` (existing
all-rooms digest endpoint via `listChairDigest()`) and CLI-side
client-filters the result by roomId. Outputs human text by default,
`--json` for envelope. NO new server endpoint.

**Delta-1 rationale**: prior Q3 wording cited `GET
/api/chair/:roomId/llm-summary` but disk shows that route only exports
PUT + DELETE (server.ts L53/L74) — no GET. The actual read surface is
`GET /api/chair` returning `{ chairDigest: [...] }` for ALL rooms. PATH
A (filter client-side in the CLI) is the lower-blast-radius fix that
keeps Q3's "thin-wrapper, no new endpoint" intent intact. PATH B (add
a new `GET /api/chair/:roomId` endpoint) would split the read surface
and require route+test churn unjustified for v1.

**Why**: matches M2.3 sessions-digest wrapper pattern + preserves
"thin shim only" Q5 intent. CLI handles roomId-not-found by emitting
"No chair digest for room <id>" (empty array branch).

### Q4 auth + access boundaries (delta-4 fresh-ANT realignment)
**Lock — per-verb auth, all helpers from fresh-ANT**:
- `chair enable` / `chair disable`: pidChain-strict via
  `resolveCallerIdentityStrict` (existing helper in
  `src/lib/server/authGate.ts`, same as discussions POST). T2 ADDS
  this guard to `/api/chair-enabled/+server.ts` PUT only
  (disk-verified: GET at L36 + PUT at L40, NO DELETE). `enable` sends
  `PUT /api/chair-enabled` with body `{ enabled: true, pidChain }`;
  `disable` sends `{ enabled: false, pidChain }`. Current PUT is
  UNAUTHENTICATED; T2 ADDS the gate. Caller must be a registered
  identity per the M3.6a-v1 write-surface treatment.
- `chair handoff`: pidChain-strict via `resolveCallerIdentityStrict`.
  Caller MUST be a current member of `<room-id>` (Q2 invariant 1).
  Strict-403 on missing identity.
- `chair board`: read-only, current baseline preserved (unauthenticated
  GET). T2 does NOT change board auth.

**Delta-4 rationale**: prior Q4 referenced `chatInviteAuth.require-
AdminAuth` which is a v3-only helper not present in fresh-ANT. The
chair surface lives entirely in fresh-ANT (chairStore + chairEnabled-
Store + /api/chair* routes all at `/CascadeProjects/ant/`), so the
auth helper must come from fresh-ANT. `resolveCallerIdentityStrict`
is the right fit: it's the same gate M3.6a-v1 used to fail-closed
writes on discussions POST, and chair-enabled toggles are write
surfaces by the same logic. No NEW auth helper introduced.

**Why**: keeps chair within fresh-ANT's existing auth toolkit (matches
M3.6a-v1 strict-403 write-surface treatment). Drops the cross-repo
v3 admin-bearer dependency that doesn't have a fresh-ANT equivalent.

### Q5 manifest entries (delta-4 fresh-ANT realignment)
**Lock**: 4 separate manifest entries (one per subverb) under
primaryVerb='chair', each defaulting to `repo: 'fresh-ant'` (the av
factory default — explicit repo field omitted). Status flips pl→av
on T-final landing. The existing single `chair` row at manifest.ts:298
(planned, repo:'delivery-plan') is REMOVED and replaced with 4 explicit
rows. Source_refs resolve under `/CascadeProjects/ant/`. Pattern
matches the linkedchat allow/deny/list split.

**Delta-4 rationale**: prior Q5 specified `repo: 'v3'` but the chair
surface lives entirely in fresh-ANT (chairStore + chairEnabledStore +
routes all at `/CascadeProjects/ant/`). Manifest entries must reference
the actual file location; v3 has no chair surface.

**Why**: manifest entries should map 1:1 to user-facing CLI verbs per
[[manifest-cli-verb-facing-only]]. A single combined entry hides the
per-verb flag surface. Per-repo accuracy is enforced by the manifest
test that joins source_ref to repoRoot(verb).

### Q6 chair handoff history table (delta-1 lock)
**Lock**: INCLUDE in v1. T1 already touches schema for the
`current_chair_handle` column on `chat_rooms`; adding a sibling
`chat_room_chair_history` table in the same migration is essentially
free (~10L DDL) and closes the audit-trail gap permanently.

**Schema sketch**:
```sql
CREATE TABLE IF NOT EXISTS chat_room_chair_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id      TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  from_handle  TEXT,        -- NULL for first-ever chair assignment
  to_handle    TEXT NOT NULL,
  set_by       TEXT NOT NULL,
  set_at_ms    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chair_history_room_set_at
  ON chat_room_chair_history (room_id, set_at_ms DESC);
```

**Why**: canonical recommendation per gate verdict — system-message-
only audit would be a "future audit gap" given schema is already in
T1 scope. Same pattern as `chat_room_mode_history` table that audits
`chat_room_modes` flips.

## Acceptance for M4.4 PASS

1. Doc at `docs/m4-4-chair-handoff-design-2026-05-14.md` under 180L,
   canonical RQO PASS.
2. Q1-Q6 all locked (Q3 delta-1 amended; Q6 delta-1 locked).
3. T1-T4 chunk plan locked:
   - T1: schema (chat_rooms.current_chair_handle column +
     chat_room_chair_history table) + store helpers;
     ant-cli-chair.mjs scaffold
   - T2: routes — fresh-ANT (POST /api/chat-rooms/:roomId/chair/handoff
     NEW + PUT /api/chair-enabled GAINS resolveCallerIdentityStrict
     guard, no DELETE surface — enable/disable both use PUT with body
     `{enabled:true|false, pidChain}`) + route tests covering pidChain-
     strict-403 on both routes (one test enable=true, one test
     enable=false)
   - T3: CLI (4 subverbs: enable/disable/handoff/board with board
     calling GET /api/chair + client-filter) + manifest 4-row flip
     + CLI bun-test
   - T4: live :6461 verify + plan_milestone done
