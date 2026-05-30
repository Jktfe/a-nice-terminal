---
doc_id: pane-binding-supersession-scope-2026-05-27
title: "Scope: pane-binding supersession for tmux-pane reuse leak"
status: in-progress
author: "@claudev4"
trigger: "JWPK msg_wlvguvfvqu antV4 2026-05-27 — Vera codex spawn inherited prior @xenocc room subscription via tmux pane reuse, saw xenoChat message without membership. Full fix greenlit msg_8390722mjh."
linked_rooms: ["yz4clwzvbm", "4cvriarue1"]
---

# Scope: pane-binding supersession

## Repro

Vera spawned `codex --yolo` in a tmux pane previously hosting an @xenocc terminal_record bound to `linked_chat_room_id = 0mcytty7ng`. Mark posted in xenoChat. Fanout walked `listLinkedTerminalRowsForRoom(0mcytty7ng)`, found the prior @xenocc record still pointing at Vera's pane, PTY-injected the xenoChat message there. Vera saw the message despite having no membership in 0mcytty7ng.

## Root cause

`src/lib/server/pty-inject-fanout.ts:448-475` runs a "linked-chat-room direct path" AFTER the membership-gated path. It calls `listLinkedTerminalRowsForRoom(roomId)` (linkedRoomTerminalLookup.ts:43-52) which has no filter for "is this still the active occupant of that pane":

```sql
SELECT session_id, tmux_target_pane, agent_kind
  FROM terminal_records
 WHERE linked_chat_room_id = ?
   AND tmux_target_pane IS NOT NULL
```

When a tmux pane is recycled (Vera spawned in @xenocc's old pane), the prior terminal_record still claims that pane via `tmux_target_pane = <pane-id>`. Fanout walks it, doesn't check whether the binding is still valid, delivers the message.

## Fix shape

### Schema migration

```sql
ALTER TABLE terminal_records ADD COLUMN superseded_at_ms INTEGER;
CREATE INDEX idx_terminal_records_superseded ON terminal_records (superseded_at_ms);
```

Backwards-compatible — NULL means "active." All existing rows default to NULL on the migration.

### Insert/update logic (`terminalRecordsStore.ts`)

When `createTerminalRecord` or `updateTerminalRecord` sets a `tmux_target_pane`, mark any OTHER terminal_records sharing that pane as superseded:

```ts
if (tmuxTargetPane) {
  db.prepare(`
    UPDATE terminal_records
       SET superseded_at_ms = ?
     WHERE tmux_target_pane = ?
       AND session_id != ?
       AND superseded_at_ms IS NULL
  `).run(now, tmuxTargetPane, sessionId);
}
```

Prior records stay in the table for history/audit; their `superseded_at_ms` is non-null so production readers can filter them out. No DELETEs, no cascade risk.

### Cross-substrate readers (the impact surface)

Production code that SELECTs from `terminal_records` and uses results for "live" routing/membership decisions — all need the `superseded_at_ms IS NULL` filter:

| File | Line | Purpose | Needs filter? |
|---|---|---|---|
| `pty-inject-fanout.ts` | 456 (via listLinkedTerminalRowsForRoom) | Fanout to PTY panes | **YES** — primary leak surface |
| `linkedRoomTerminalLookup.ts` | 43-52 | listLinkedTerminalRowsForRoom | **YES** |
| `linkedRoomTerminalLookup.ts` | 54-63 | getLinkedTerminalRowBySessionId | **YES** |
| `linkedRoomTerminalLookup.ts` | 74-85 | isLinkedChatRoom | **YES** |
| `terminalRecordsStore.ts` | 205-210 | listAllPickableHandles (the picker fix I shipped in PR #77) | **YES** — `listLiveTerminalRecords` should gain this filter |
| `terminalRecordsStore.ts` | 177-185 | listKnownHandles | **YES** |
| `humanInboxMembership.ts` | 43 | Detect agent's inbox-eligible rooms | **YES** (live inbox membership) |
| `humanInboxBackfill.ts` | 49 | Backfill inbox edges | **YES** (only live records contribute new edges) |
| `roomMembershipsStore.ts` | 183 | Filter non-linked room ids from member list | **YES** (linked status reads on terminal_records) |
| `agentFleetStore.ts` | 171, 245 | Fleet roster | **YES** (operator-facing live view) |
| `linkedRoomAgentGuffPurge.ts` | 28 | Purge old agent guff | **NO** — cleanup task; SHOULD see superseded rows |
| `antRegistryFile.ts` | (registry projection) | Markdown registry projection | **YES** for current state; keep superseded out of the projected registry |

That's **10 production readers** that need the filter + **1 cleanup reader** that explicitly should NOT. Plus 6 test files that need updating to seed `superseded_at_ms = NULL` on test data + add coverage for the supersession behaviour.

### Test plan

Per-reader:
1. **Insert-time supersession**: createTerminalRecord with tmux_target_pane X → prior records with pane X get `superseded_at_ms != NULL`.
2. **Fanout exclusion**: superseded record does NOT receive PTY-inject.
3. **Picker exclusion**: listLiveTerminalRecords + listAllPickableHandles + listKnownHandles all skip superseded.
4. **Inbox exclusion**: humanInboxMembership/Backfill skip superseded.
5. **Linked-room predicates**: isLinkedChatRoom returns false when only superseded records point at the room.
6. **Cleanup INCLUSION**: linkedRoomAgentGuffPurge still operates on superseded rows (auditable cleanup target).
7. **Audit preservation**: `listTerminalRecords` (no filter) still returns superseded rows — history surfaces unchanged.

### Edge cases worth testing

- **A registers in pane X**, **B registers in pane Y**, **A re-registers in pane Y**: A's first record (pane X) stays active; A's second record (pane Y) supersedes B's. Both A records survive in audit.
- **Same agent re-registers in same pane**: no-op self-supersession risk. Filter `session_id != ?` handles this.
- **Update changes pane**: updateTerminalRecord moving from pane X → pane Y should supersede anything currently on pane Y, AND release pane X (no supersession effect there).
- **Multiple null tmux_target_pane records**: no supersession fires (NULL != NULL in SQL).

## Lane split proposal

- **@claudev4 (me)**: schema migration + insert/update supersession + reader filters across all 10 surfaces + tests + capability-ledger row.
- **@speedyclaude**: sanity-check the F-slice intersection (your `redeem-autoregister` writes a terminal_records row + a room_memberships row; the new insert-time supersession should auto-cover the F flow but worth verifying), plus impact review on any code path I missed in the 10-reader audit above.

Both lanes can run in parallel; mine produces the PR, yours produces the impact-review crosscheck.

## Ship target

Main directly. Privacy bug on rock-solid surface — JWPK explicit greenlight (antV4 msg_8390722mjh: "Co-ordinate with speedy and get the full fix in and on main").

ETA on PR: ~1h after @speedyclaude lane-split confirm.
