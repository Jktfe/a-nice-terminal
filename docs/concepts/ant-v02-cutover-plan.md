---
title: ANT v0.2 — Cut-Over Execution Plan + Call-Site Inventory
date: 2026-05-29
authors: ["@cv4 (planning subagent)"]
status: drafted — companion to ant-v02-identity-and-recovery.md (spec) and ant-v02-post-cutover-runbook.md (re-register dance)
scope: this doc is for the **cut-over implementer** (next agent). It enumerates every importer / endpoint / CLI verb the cut-over PR must flip, sequences the merge, and pins the regression-corpus gate.
supersedes: nothing — first pass
companion to:
  - docs/concepts/ant-v02-identity-and-recovery.md (the 11-table spec)
  - docs/concepts/ant-v02-post-cutover-runbook.md (post-merge re-registration sequence)
  - scripts/v0.2-regression.test.ts (the 9-case CI gate)
---

# ANT v0.2 — Cut-Over Execution Plan

> **This is a planning artefact, not code.** The implementer who picks this up should treat every file:line citation as a snapshot in time (today: 2026-05-29). Run the verification greps in §9 before trusting the inventory.

JWPK ratified **archive-and-ditch** in msg_jnh0l9idnb (2026-05-29): the cut-over PR ships **no data migration**. The 11 `v02_` tables start empty; JWPK re-registers the active dev team (@cv4, @codex4, @speedyc) under the new schema per `ant-v02-post-cutover-runbook.md`. This shrinks the cut-over from a multi-hour migration script to a server config flip + a re-register dance.

The cut-over PR's job:

1. Flip every server-side call site from the legacy stores (`terminalsStore`, `terminalRecordsStore`, `roomMembershipsStore`, the `chat_room_members` paths inside `chatRoomStore`) to v02-shaped equivalents.
2. Leave the legacy tables in place (they survive 30 days as audit history; not dropped this PR).
3. Pass the v0.2 regression corpus (9 cases) as a required CI gate.

That's it. No backfill, no dual-write, no archive script in the same PR.

---

## §1 Call-site inventory (importers of the four legacy stores)

The four "legacy" data surfaces:

| Surface | Source of truth file | Underlying table |
|---|---|---|
| `terminalsStore` | `src/lib/server/terminalsStore.ts` | `terminals` |
| `terminalRecordsStore` | `src/lib/server/terminalRecordsStore.ts` | `terminal_records` |
| `roomMembershipsStore` | `src/lib/server/roomMembershipsStore.ts` | `room_memberships` |
| (no dedicated store) | `src/lib/server/chatRoomStore.ts` (inline SQL) | `chat_room_members` |

There is **no dedicated `chatRoomMembersStore.ts`** — every read/write of `chat_room_members` lives inside `chatRoomStore.ts` as raw SQL. The cut-over implementer must extract this into a small `v02MembershipsStore` and re-point `chatRoomStore` at it (or fold it directly into `chatRoomStore`'s v02 successor).

### §1.1 Importers of `terminalsStore`

Found via `grep -rln "from '\$lib/server/terminalsStore'" --include='*.ts' --include='*.svelte' src/`.

| File | Imported symbols | v02_ replacement | Notes |
|---|---|---|---|
| `src/routes/api/identity/register/+server.ts:7` | `upsertTerminal, updatePaneTarget, getTerminalById, getTerminalByName` | `upsertRuntime(agent_id, pid, pid_start_iso, ...)` from a new `v02RuntimesStore`; `getRuntimeById`, `getAgentByHandle` | This endpoint is the **register** path — central to the cut-over. Today it creates/updates `terminals` rows; in v0.2 it must INSERT a `v02_runtimes` row (after resolving the agent_id), then flip `v02_agents.current_runtime_id`. The endpoint is also bound to PR #96 (auto-rebind on register) — confirm that fix is preserved or made redundant by the partial unique index. |
| `src/routes/api/identity/resolve/+server.ts:20` | `lookupTerminalByPidChain, type PidChainEntry` | `lookupRuntimeByPidChain` filtering on `status='live'` (regression case #2) | This is the pidChain walker. **Must filter status='live'** per the v0.2 spec (Phase A3-style) — otherwise shadow runtimes resolve to the wrong agent. |
| `src/routes/api/terminals/+server.ts:24` | `autoRegisterTerminalForSpawnedSession` | `v02RuntimesStore.autoRegisterRuntimeForSpawnedSession` | The terminals.list endpoint. Probably needs to surface BOTH legacy + v02 rows in the cut-over UI tier (or the UI tier flips entirely — read §4 step e). |
| `src/routes/api/terminals/[id]/+server.ts` (none direct here, but `terminalRecordsStore` import on line 10) | n/a | n/a | This file routes through `terminalRecordsStore`; see §1.2. |
| `src/routes/api/terminals/[id]/adopt/+server.ts:14` | `adoptExternalProcessForTerminal` | `v02RuntimesStore.adoptExternalProcessForRuntime` | Adoption flow — must respect the partial-unique-on-live invariant. |
| `src/routes/api/terminals/[id]/agent-status/+server.ts:22` | `lookupTerminalByPidChain, PidChainEntry` | `lookupRuntimeByPidChain` | Same pidChain concern as `/api/identity/resolve`. |
| `src/routes/api/terminals/[id]/chatrooms/+server.ts:13` | `getTerminalById` | `getRuntimeById` (or higher-level `getAgentByRuntimeId` then `listRoomsForAgent`) | Read-only — easier to flip. |
| `src/routes/api/terminals/[id]/context-fill/+server.ts:22` | `getTerminalById, setAgentContextFill` | `getRuntimeById, setAgentContextFill` (the field migrates with the runtime row, not the agent) | The context-fill concept is per-runtime per spec; field lands on `v02_runtimes` (add a `context_fill_pct INTEGER` column in a follow-up if not yet present). **Open question §8 #2**. |
| `src/routes/api/terminals/[id]/fingerprint/+server.ts:9` | `getTerminalById` | `getRuntimeById` | Read-only. |
| `src/routes/api/terminals/[id]/heal/+server.ts:36` | (multiple — see file) | `v02RuntimesStore.healRuntime` | Healing is the recovery path — overlaps with `reclaim_requests` from PR #100. The cut-over PR may collapse heal-as-reclaim. |
| `src/routes/api/terminals/[id]/kill/+server.ts:49` | `deleteTerminalById` | `archiveRuntime` (set `status='archived', ended_at_ms`); **never DELETE** in v0.2 (audit preservation) | Important semantic change: kill becomes archive, not delete. |
| `src/routes/api/terminals/[id]/settings/+server.ts:25` | `getTerminalById, upsertTerminal` | `getRuntimeById, updateRuntimeSettings` (settings split between runtime + agent depending on what setting) | Settings may need decomposition — display_color belongs on the AGENT, agent_kind on the RUNTIME. Cut-over implementer must classify each. **Open question §8 #3**. |
| `src/routes/api/terminals/[terminalId]/delivery/+server.ts:18` | `getTerminalById` | `getRuntimeById` | Read-only — straight flip. |
| `src/routes/api/cli-hook/+server.ts:50` | `getTerminalById` | `getRuntimeById` | The CLI-hook receiver; read-only resolution. |
| `src/routes/api/sessions/add/+server.ts:8` | `upsertTerminal, getTerminalByName, getTerminalById, updatePaneTarget` | `v02RuntimesStore` equivalents + `v02AgentsStore.upsertByHandle` | Sessions/add is the membership-add flow. Hits both runtimes AND memberships — high-risk endpoint. |
| `src/routes/api/auth/demo-login/+server.ts:40` | `upsertTerminal` | `v02RuntimesStore.upsertRuntime` (demo path — may stay legacy through cut-over if demo is non-prod) | **Open question §8 #4**: does demo-login need to be v0.2-aware on day 1, or can it stay broken pending a follow-up? |
| `src/routes/api/chat-rooms/[roomId]/audit/+server.ts:22` | `getTerminalById` | `getRuntimeById` (or skip — audit-events table will replace audit endpoint entirely in a follow-up) | Read-only. |
| `src/routes/api/chat-rooms/[roomId]/browser-session/+server.ts:5` | `lookupTerminalByPidChain, upsertTerminal` | `lookupRuntimeByPidChain, upsertRuntime` | Browser-session is an SSE flow — must not break mid-flight. |
| `src/routes/api/chat-rooms/[roomId]/identity-table/+server.ts:25` | `getTerminalById` | `getRuntimeById` + `getAgentByRuntimeId` | Read-only. |
| `src/routes/api/chat-rooms/[roomId]/messages/+server.ts:30` | `lookupTerminalByPidChain, touchLastMessageSentAt` + `upsertTerminal` (line 32) | `lookupRuntimeByPidChain, touchLastMessageSentAt(runtime_id)` | The **hot path** for message posts. Touched by every fanout. The cut-over PR must verify SSE delivery survives the flip. |
| `src/routes/api/chat-rooms/[roomId]/responders/+server.ts:23` | `getTerminalById` | `getRuntimeById` | Read-only. |
| `src/routes/api/chat-rooms/[roomId]/status/+server.ts:21` | `getTerminalById` | `getRuntimeById` | Read-only. |
| `src/lib/server/agentStatusStore.ts:56, 92, 97` | direct SQL on `terminals` | direct SQL on `v02_runtimes` (`agent_status` column migrates onto runtime row) | Indirect import — must also flip. |
| `src/lib/server/agentStatusHookAuth.ts:30, 43` | direct SQL on `terminals.meta` | direct SQL on `v02_runtimes.meta` (or move to `v02_agents.meta` if hook-auth is identity-scoped) | **Open question §8 #5**: is hook-auth per-runtime or per-agent? |
| `src/lib/server/agentStatusPoller.ts` | `terminalsStore` (imports) | `v02RuntimesStore` | Poller drives the lifecycle flips logged in 0.1.13 Phase A3 memory. |
| `src/lib/server/browserSessionStore.ts:96, 191` | direct INSERT `terminals` | direct INSERT `v02_runtimes` (browser sessions become a `cli_provider_id='browser'` runtime) | Browser-session-as-runtime is per spec — verify. |
| `src/lib/server/fingerprintDetector.ts:170, 174` | direct UPDATE `terminals` | direct UPDATE `v02_runtimes` (agent_kind moves to runtime row) | Mechanical flip. |
| `src/lib/server/remoteMappingStore.ts:107` | direct INSERT `terminals` | direct INSERT `v02_runtimes` + ensure agent row exists | The remote-mappings store (RemoteAnt bridges) creates synthetic runtimes — must respect partial-unique-on-live. |
| `src/lib/server/linkedRoomTerminalLookup.ts:47, 58, 79` | direct SELECT `terminal_records` (with terminals JOIN) | flip to `v02_runtimes` JOIN `v02_agents` | Read-only. |
| `src/lib/server/antRegistryFile.ts:147, 168` | SELECT `terminal_records` + `terminals` | flip to `v02_agents` + `v02_runtimes` | Registry file is the on-disk audit dump — semantic equivalent must be preserved for `~/.ant/registry.json`. |
| `src/lib/server/agentFleetStore.ts:245, 339` | SELECT `terminal_records` + `room_memberships` | flip to `v02_agents` + `v02_memberships` | Fleet view. |
| `src/lib/server/terminalReplyRouter.ts` | `terminalRecordsStore` import | flip | Reply-router routes messages back to the originating runtime. |
| `src/lib/server/transcriptTailParser.ts` | `terminalRecordsStore` | flip | Transcript parser. |
| `src/lib/server/sessionExportStore.ts` | `terminalRecordsStore` | flip | Session export. |
| `src/lib/server/pty-inject-fanout.ts` | `terminalsStore` + `terminalRecordsStore` + `roomMembershipsStore` | flip ALL three; this file is the **fanout engine** and is the highest-risk single file in the cut-over | Critical. Re-test SSE end-to-end. |
| `src/lib/server/pty-inject-bridge.ts` | `terminalsStore` (`verifyPaneTargetState`) | flip to `v02_runtimes`-aware bridge | Pane-state verifier — gates lifecycle flips. |
| `src/lib/server/identityGate.ts` | `terminalsStore` + `terminalRecordsStore` + `roomMembershipsStore` | flip — identity gate is the auth perimeter | High-risk; touches every authenticated request. |
| `src/lib/server/authGate.ts` | `terminalsStore` | flip | Same. |
| `src/lib/server/chatRoomReadGate.ts` | `terminalsStore` + `terminalRecordsStore` | flip | Read-gate touches every chat-room GET; verify latency hasn't regressed (per the 2026-05-25 closure memory). |
| `src/lib/server/allowlistGuard.ts` | `terminalRecordsStore` | flip | Allowlist enforcement. |
| `src/lib/server/humanInboxBackfill.ts` | `terminalRecordsStore` + `chat_room_members` SQL | flip | Backfill of human-inbox rooms. |
| `src/lib/server/humanInboxMembership.ts` | `terminalRecordsStore` + `chat_room_members` SQL | flip | Human-inbox membership. |
| `src/lib/server/humanInboxRoomStore.ts` | `chat_room_members` SQL | flip | Human-inbox room. |
| `src/lib/server/tmuxPaneSnapshot.ts` | `terminalRecordsStore` | flip | Pane snapshot. |
| `src/lib/server/tmuxCapture.ts` | `terminalsStore` | flip | tmux capture for ANT View. |
| `src/lib/server/availabilityDigestStore.ts:128, 151` | direct SELECT `room_memberships` | flip to `v02_memberships` | Availability digest. |
| `src/lib/server/agentAvailabilityStore.ts:217` | direct SELECT `room_memberships` | flip | Agent availability. |
| `src/lib/server/consentGate.ts:98` | direct SELECT `room_memberships` | flip | Consent gate. |
| `src/lib/server/transcriptToChatFanout.ts` | `terminalRecordsStore` | flip | Transcript-to-chat fanout — secondary fanout path. |
| `src/lib/server/genericTranscriptTailWatcher.ts` + `claudeCodeTranscriptTail.ts` + `geminiTranscriptTail.ts` + `codexTranscriptTail.ts` + `copilotTranscriptTail.ts` + `piTranscriptTail.ts` + `qwenTranscriptTail.ts` | `terminalsStore` + `terminalRecordsStore` | flip — these are all per-CLI transcript tailers; pattern is identical | Bulk mechanical flip — likely a single PR commit. |
| `src/lib/cli-manifest/manifest.ts` | `terminalsStore` (type only, possibly) | verify | CLI manifest definitions. |
| `src/routes/terminals/+page.svelte` | comment reference only (line 6) | n/a | Comment in the page header; update for clarity. |

**Total files importing or directly SQL'ing the four legacy surfaces: ~50** (54 hits in non-test paths counting the route handlers + lib stores).

### §1.2 Importers of `terminalRecordsStore`

The dense ones overlap with §1.1 (terminals + terminal_records often co-imported). Notable additions:

| File | Imported symbols | v02_ replacement |
|---|---|---|
| `src/routes/api/terminals/[id]/+server.ts:10` | `getTerminalRecord, updateTerminalRecord, parseAllowlist, deriveHandle` | `getAgentByRuntimeId, updateAgent, parseAllowlist, deriveHandle` (handle derivation moves to AGENT level) |
| `src/routes/api/terminals/[id]/access/+server.ts:3` | `getTerminalRecord` | `getAgentByRuntimeId` (or skip — access becomes `tool_grants`-mediated in v0.2) |
| `src/routes/api/terminals/[id]/agent-launch/+server.ts:26` | `getTerminalRecord` | `getAgentByRuntimeId` |
| `src/routes/api/terminals/[id]/agent-state/+server.ts:22` + `agent-state/stream/+server.ts:25` | `getTerminalRecord` | `getAgentByRuntimeId` |
| `src/routes/api/terminals/[id]/launch/+server.ts:21` | `getTerminalRecord` | `getAgentByRuntimeId` |
| `src/routes/api/terminals/handles/+server.ts:12` | `listKnownHandles, listAllPickableHandles` | `v02AgentsStore.listKnownHandles, listAllPickableHandles` |
| `src/routes/api/chat-rooms/[roomId]/members/+server.ts:35` | `findTerminalRecordByHandle` | `v02AgentsStore.findAgentByHandle` |
| `src/routes/api/asks/+server.ts:44` | `deriveHandle, getTerminalRecord` | flip |
| `src/lib/components/InviteAgentFormLocalPicker.svelte` | `terminalRecordsStore` (likely via prop / loader) | inspect — UI props may need adjusting if shape changes |
| `src/lib/server/interactiveEvents/agentKindResolver.ts:33` | SELECT `terminal_records` | flip |

### §1.3 Importers of `roomMembershipsStore`

| File | Imported symbols | v02_ replacement |
|---|---|---|
| `src/routes/api/identity/resolve/+server.ts:21` | `getRoomScopedHandle` | `getRoomScopedHandle` from `v02MembershipsStore` (room_alias column lives on the membership row) |
| `src/routes/api/terminals/[id]/chatrooms/+server.ts:14` | `listChatRoomsForTerminal` | `listChatRoomsForAgent` (the call site receives a terminalId today; in v0.2 it receives a runtimeId → agentId) |
| `src/routes/api/terminals/[terminalId]/linkedchat/+server.ts:17` | `listMembershipsForTerminal` | `listMembershipsForAgent` |
| `src/routes/api/auth/demo-login/+server.ts:39` | `addMembership, getTerminalIdByHandle` | `addMembership(agent_id, room_id)`, `getAgentIdByHandle` |
| `src/routes/api/asks/+server.ts:83` | direct SELECT `room_memberships` | flip to `v02_memberships` |
| `src/routes/api/agents/[handle]/timeline/+server.ts:139` | direct SELECT `room_memberships` (`SELECT DISTINCT terminal_id`) | flip to `SELECT DISTINCT agent_id` |
| `src/routes/api/chat-rooms/[roomId]/agent-statuses/+server.ts:64` | direct SELECT `room_memberships` | flip |
| `src/routes/api/chat-rooms/[roomId]/audit/+server.ts:21` + `identity-table/+server.ts:24` + `status/+server.ts:20` | `listMembershipsForRoom` | `v02MembershipsStore.listActiveMembershipsForRoom` (filtered by `left_at_ms IS NULL`) |
| `src/routes/api/chat-rooms/[roomId]/browser-session/+server.ts:4` | `addMembership, getTerminalIdByHandle` | flip |
| `src/routes/api/chat-rooms/[roomId]/messages/+server.ts:29` | `getTerminalIdByHandle, addMembership` | flip — and **derive fanout target from agents.current_runtime_id at send time** (the structural fix) |
| `src/routes/api/chat-rooms/[roomId]/members/+server.ts:36` | `addMembership, removeMembership` | flip; removeMembership becomes "set left_at_ms" (soft-leave) |
| `src/routes/api/chat-rooms/[roomId]/responders/+server.ts:22, 24` | `getTerminalIdByHandle, listMembershipsForRoom` | flip |
| `src/routes/api/sessions/add/+server.ts:9` | `addMembership` | flip |
| `src/lib/server/availabilityDigestStore.ts:128, 151` | (already in §1.1) | (already covered) |
| `src/lib/server/agentAvailabilityStore.ts:217` | (already in §1.1) | (already covered) |
| `src/lib/server/consentGate.ts:98` | (already in §1.1) | (already covered) |
| `src/lib/server/remoteMappingStore.ts:113, 158` | direct INSERT/UPDATE `room_memberships` | flip — REMEMBER: `revoked_at_ms` becomes `left_at_ms` in v0.2 |
| `src/lib/server/browserSessionStore.ts:72, 114, 260` | direct SQL `room_memberships` | flip |

### §1.4 Direct SQL on `chat_room_members` (no dedicated store)

The chat_room_members table is owned by `chatRoomStore.ts` via inline SQL. The cut-over implementer must extract these into a v02-shaped helper (or fold them into the v02 memberships path entirely — see Open Question §8 #1).

| File | Line(s) | Operation | v02 equivalent |
|---|---|---|---|
| `src/lib/server/chatRoomStore.ts` | 254 (SELECT) | Load room members | `SELECT FROM v02_memberships WHERE room_id=? AND left_at_ms IS NULL` |
| `src/lib/server/chatRoomStore.ts` | 332, 348, 536, 587 (INSERT) | Add member | `INSERT INTO v02_memberships (membership_id, agent_id, room_id, role, joined_at_ms) VALUES (...)` |
| `src/lib/server/chatRoomStore.ts` | 418 (DELETE) | Bulk-wipe (test path?) | should become `UPDATE v02_memberships SET left_at_ms=...` if production; or restrict to test-only |
| `src/lib/server/chatRoomStore.ts` | 525, 576, 626 (SELECT 1) | Presence check | `SELECT 1 FROM v02_memberships WHERE agent_id=? AND room_id=? AND left_at_ms IS NULL` |
| `src/lib/server/chatRoomStore.ts` | 675 (DELETE) | Remove member | `UPDATE v02_memberships SET left_at_ms=?` (soft-leave) |
| `src/lib/server/chatRoomStore.ts` | 785 (UPDATE) | Update member display | new column on `v02_memberships` OR moves to `v02_agents` (display_name belongs to agent, color may stay per-room) |
| `src/lib/server/chatRoomStore.ts:299, 300` | direct SELECT `room_memberships` (in createChatRoom for binding detection) | flip; same agent-binding-detect logic against `v02_memberships` |
| `src/lib/server/deckAccessGate.ts:29` | `SELECT 1 FROM chat_room_members WHERE room_id=? AND handle=?` | `SELECT 1 FROM v02_memberships m JOIN v02_agents a ON a.agent_id=m.agent_id WHERE m.room_id=? AND a.primary_handle=? AND m.left_at_ms IS NULL` |
| `src/lib/server/humanInboxBackfill.ts:29, 42` | SELECT `chat_room_members` | flip |
| `src/lib/server/humanInboxRoomStore.ts:67, 115` | SELECT + INSERT OR IGNORE | flip; INSERT OR IGNORE becomes the partial-unique-friendly form |
| `src/lib/server/agentRegistryStore.ts` | references `chatRoomStore` (no direct SQL) | indirect — will flip with chatRoomStore |
| `src/lib/server/askStore.ts` | references `chatRoomStore` | indirect |
| `src/lib/server/chairHandoffStore.ts` | references `chatRoomStore` | indirect |
| `src/lib/server/pendingMessagesStore.ts` | references `chatRoomStore` | indirect |
| `src/lib/server/chatMembershipBinding.ts` | references `chatRoomStore` | indirect |
| `src/lib/server/handleBindings.ts` | references `chatRoomStore` | indirect |
| `src/routes/mcp/room/[roomId]/+server.ts` | `chatRoomStore` | indirect — MCP server room endpoint |
| `src/routes/api/status/chasing/+server.ts` | `chatRoomStore` | indirect |
| `src/routes/api/me/mentions/+server.ts` | `chatRoomStore` | indirect |
| `src/routes/api/chat-rooms/[roomId]/join-with-token/+server.ts` | `chatRoomStore` | indirect |
| `src/routes/api/chat-rooms/[roomId]/agent-statuses/+server.ts` | `chatRoomStore` | indirect |
| `src/routes/api/interviews/[interviewId]/end/server.test.ts` | `chatRoomStore` (test only) | indirect |

The chat_room_members extraction may be the largest single semantic change in the cut-over because it's spread across one file (`chatRoomStore.ts`) with multiple inline call sites. Recommend a **separate prep commit** in the cut-over PR that pulls the inline SQL into named helpers, then a follow-up commit that swaps the table name.

---

## §2 API endpoint inventory (production routes only — `*.test.ts` excluded)

Grouped by surface area. R/W classification reflects what the **endpoint** does, not what the imported store can do.

### §2.1 Identity surface (HIGHEST RISK — auth perimeter)

| Endpoint | Method | Legacy touches | Mode | v02 equivalent |
|---|---|---|---|---|
| `/api/identity/register` | POST | terminals (W), terminal_records (W via auto-bind) | BOTH | INSERT v02_agents (if new handle) + INSERT v02_runtimes + UPDATE v02_agents.current_runtime_id |
| `/api/identity/resolve` | POST | terminals (R via pidChain), room_memberships (R via getRoomScopedHandle) | READ | lookup v02_runtimes WHERE status='live' → derive agent → derive membership |
| `/api/cli-hook` | POST | terminals (R for getTerminalById) | READ | lookup v02_runtimes |

### §2.2 Terminals surface (the wide one)

| Endpoint | Method | Legacy touches | Mode | v02 equivalent |
|---|---|---|---|---|
| `/api/terminals` | GET, POST | terminals (BOTH), terminal_records (BOTH), chat_rooms (W) | BOTH | LIST v02_runtimes (filter status), POST → create v02_agents + v02_runtimes |
| `/api/terminals/[id]` | GET, PATCH, DELETE | terminal_records (BOTH) | BOTH | get/update/archive v02_agents+v02_runtimes |
| `/api/terminals/[id]/access` | GET, PATCH | terminal_records (R) | BOTH | become tool_grants-driven (longer-term); for cut-over, read v02_agents.allowlist |
| `/api/terminals/[id]/adopt` | POST | terminals (W), terminal_records (R) | BOTH | adopt → INSERT v02_runtimes with adoption metadata |
| `/api/terminals/[id]/agent-launch` | POST | terminal_records (R), chat_rooms (R) | READ | resolve agent → launch in pane |
| `/api/terminals/[id]/agent-state` | GET, POST | terminal_records (BOTH) | BOTH | agent_state moves onto v02_runtimes |
| `/api/terminals/[id]/agent-state/stream` | GET (SSE) | terminal_records (R) | READ | SSE on runtime state |
| `/api/terminals/[id]/agent-status` | POST | terminals (R via pidChain) | READ | flip to runtimes |
| `/api/terminals/[id]/chatrooms` | GET | terminals (R), room_memberships (R) | READ | list rooms for agent (not terminal) |
| `/api/terminals/[id]/context-fill` | POST | terminals (BOTH for setAgentContextFill) | WRITE | context_fill column moves to v02_runtimes (see §1.1) |
| `/api/terminals/[id]/fingerprint` | POST | terminals (R) | READ | resolve runtime |
| `/api/terminals/[id]/heal` | POST | terminals (BOTH), terminal_records (R) | BOTH | heal → mark stale + create new runtime (overlaps with reclaim) |
| `/api/terminals/[id]/kill` | POST | terminals (W DELETE), terminal_records (W DELETE), chat_rooms (W archive) | WRITE | becomes "archive runtime + archive agent if last runtime" — **never DELETE in v0.2** |
| `/api/terminals/[id]/launch` | POST | terminal_records (R) | READ | resolve agent → launch in pane |
| `/api/terminals/[id]/model` | POST | (no direct legacy store import — uses indirect path) | n/a | verify |
| `/api/terminals/[id]/settings` | GET, PATCH | terminals (BOTH), terminal_records (R) | BOTH | settings split agent-vs-runtime |
| `/api/terminals/[terminalId]/delivery` | POST | terminals (R) | READ | flip |
| `/api/terminals/[terminalId]/linkedchat` | GET | terminal_records (R), room_memberships (R), terminals (R), chat_rooms (R) | READ | flip; linkedchat becomes "the room where this agent's mentions land" |
| `/api/terminals/handles` | GET | terminal_records (R) | READ | listKnownHandles from v02_agents |

### §2.3 Chat-rooms surface

| Endpoint | Method | Legacy touches | Mode | v02 equivalent |
|---|---|---|---|---|
| `/api/chat-rooms/[roomId]/messages` | GET, POST | terminals (BOTH), room_memberships (BOTH), chat_rooms (R) | BOTH | **HOT PATH** — derive fanout target from `agents.current_runtime_id` at send time |
| `/api/chat-rooms/[roomId]/members` | GET, POST, DELETE | chat_room_members + terminal_records (R) + room_memberships (W) | BOTH | flip all three to v02_memberships |
| `/api/chat-rooms/[roomId]/members/[handle]/reclaim` | POST | (PR #100 — not yet merged on dev; bound to reclaim_requests) | WRITE | already v02-aware via reclaim_requests table |
| `/api/chat-rooms/[roomId]/responders` | GET, POST | chat_rooms (R), room_memberships (R), terminals (R) | READ | flip |
| `/api/chat-rooms/[roomId]/status` | GET | chat_rooms (R), room_memberships (R), terminals (R) | READ | flip |
| `/api/chat-rooms/[roomId]/audit` | GET | chat_rooms (R), room_memberships (R), terminals (R) | READ | flip; long-term, audit endpoint replaced by `audit_events` query |
| `/api/chat-rooms/[roomId]/identity-table` | GET | chat_rooms (R), room_memberships (R), terminals (R) | READ | flip |
| `/api/chat-rooms/[roomId]/browser-session` | POST | chat_rooms (R), room_memberships (W), terminals (BOTH) | BOTH | flip; browser sessions become a `cli_provider_id='browser'` runtime |
| `/api/sessions/add` | POST | terminals (BOTH), room_memberships (W) | BOTH | flip; this is the membership-mode add path used by ant-cli-register + ant-cli-redeem-autoregister |
| `/api/auth/demo-login` | POST | chat_rooms (R), room_memberships (W), terminals (W) | BOTH | flip (or temp-fence — see §8 #4) |
| `/api/asks/+server.ts` | GET, POST | chat_rooms (R), terminals (R), terminal_records (R), room_memberships (R) | BOTH | flip |

### §2.4 Endpoint touch totals

- **Read-only endpoints**: ~14
- **Write endpoints**: ~5 (kill, register, sessions/add, members POST/DELETE, browser-session, settings PATCH)
- **Both R+W endpoints**: ~15
- **Total production +server.ts files touching the four legacy surfaces**: **34**

---

## §3 CLI verb inventory

No CLI script in `scripts/ant-cli-*.mjs` touches the DB directly — confirmed via `grep -l "better-sqlite3\|getIdentityDb\|fresh-ant.db" scripts/ant-cli-*.mjs` returning empty. **Every CLI verb calls the HTTP API.** This is excellent for the cut-over: flip the server, every CLI verb adopts the new shape automatically.

CLI verbs that hit endpoints in §2 (and therefore will change behaviour at cut-over without code changes):

| CLI verb | Endpoint(s) | Behaviour change |
|---|---|---|
| `ant register` | `/api/identity/register`, `/api/sessions/add` | Creates v02_agents + v02_runtimes rows instead of terminals + room_memberships rows. Auto-rebind from PR #96 becomes redundant (partial unique index enforces structurally). |
| `ant identity grant` | `/api/sessions/add` | Membership-add becomes a v02_memberships INSERT. |
| `ant rooms invite` / `ant rooms members` | `/api/chat-rooms/[roomId]/members` | Membership rows live in v02_memberships; removal becomes soft-leave (`left_at_ms`) instead of DELETE. |
| `ant chat send` | `/api/chat-rooms/[roomId]/messages` | Fanout target derives at send time from `agents.current_runtime_id` — the bug class this PR fixes. |
| `ant terminal list` | `/api/terminals` | Returns v02_runtimes (filtered by `status='live'` by default; `--include-stale` flag to surface others). |
| `ant terminal kill` | `/api/terminals/[id]/kill` | Becomes archive (status='archived'), not DELETE. Old behaviour permanently changes. |
| `ant terminal heal` | `/api/terminals/[id]/heal` | Heal becomes "create new runtime + flip current_runtime_id" — overlaps with `ant admin reclaim` from PR #100. |
| `ant admin reclaim` | (added by PR #100) | Already v02-shaped. |
| `ant identity resolve` (under the hood) | `/api/identity/resolve` | pidChain walker filters `status='live'` — shadow runtimes (case #2) cannot resolve. |
| `ant status` | `/api/identity/resolve` | Same as above; reports current agent identity correctly post-cut-over. |
| `ant chair`, `ant ask`, `ant artefact`, `ant decks`, `ant chat-pending`, etc. | Various — all eventually resolve identity via `/api/identity/resolve` | Inherit the structural fix transparently. |
| `ant redeem-autoregister` | `/api/sessions/add` (membership-mode) | Becomes v02_memberships INSERT. |
| `ant rooms break` (lifecycle 0.1.13) | `/api/chat-rooms/[roomId]/members` (DELETE) | Soft-leave instead of DELETE. |

**Total CLI verbs whose user-facing behaviour changes at cut-over: 14 (verb-level); ~30 (subcommand-level).** No script needs code changes — the HTTP contract is preserved.

### §3.1 Watch-out: `ant terminal kill` semantics

This is the only verb whose **user-visible** behaviour is semantically different post-cut-over:
- **Before**: `kill` DELETEs the terminals row + the terminal_records row.
- **After**: `kill` sets `status='archived'` on the v02_runtime, archives the v02_agent only if it has no other live runtimes, and never DELETEs anything.

JWPK should be told about this once — possibly add a one-line note to `ant terminal kill --help` reflecting the new behaviour ("archives; row remains for audit").

---

## §4 Cut-over execution sequence

This is the playbook the cut-over implementer runs. Each step has an explicit verification.

### Step a — Verify v0.2 schema PR is merged + tables exist

```bash
# After PR #103 (feat/v0.2-schema-tables) merges to dev:
git checkout dev && git pull
# Spin up dev server, then:
sqlite3 ~/.ant/fresh-ant.db ".tables" | grep -c "^v02_"  # expect 11
sqlite3 ~/.ant/fresh-ant.db ".schema v02_runtimes" | grep "uq_v02_runtimes_agent_live"  # expect 1 hit
```

If either check fails — abort. The cut-over PR cannot land until schema PR has bedded in.

### Step b — Backup #3 of this push

Per the post-cutover runbook §0 (already drafted):

```bash
STAMP=$(date +%Y-%m-%d-%H%M%S)
cp ~/.ant/fresh-ant.db ~/.ant/fresh-ant-pre-cutover-${STAMP}.db
gzip -k ~/.ant/fresh-ant-pre-cutover-${STAMP}.db
sqlite3 ~/.ant/fresh-ant-pre-cutover-${STAMP}.db "PRAGMA integrity_check;"  # expect "ok"
```

Keep all three backups for the 30-day audit window.

### Step c — Pause writes (optional but recommended)

Briefly stop the server accepting register / post / membership-change requests. Two ways:

- **Soft pause**: deploy a feature flag (`ANT_PAUSE_WRITES=1`) that returns 503 from the WRITE endpoints listed in §2. Re-deploy with flag off after step e completes. Implementer's call whether to ship this in the cut-over PR or hand-add.
- **Hard pause**: stop the server, perform the flip, restart. Faster but a ~30s window where every agent's CLI errors. Given the small team (3 agents + JWPK), hard pause is fine. **Recommended: hard pause.**

### Step d — Server code flip (the cut-over PR itself)

The cut-over PR ships:

1. New stores: `v02RuntimesStore.ts`, `v02AgentsStore.ts`, `v02MembershipsStore.ts`. Each implements the same public API surface as its legacy counterpart so endpoints can `import { upsertRuntime as upsertTerminal } from '$lib/server/v02RuntimesStore'` for the smallest diff.
2. Endpoint import flips per §1 + §2 (mechanical search-and-replace on `from '$lib/server/terminalsStore'` etc.).
3. Inline-SQL helper extraction for `chat_room_members` (§1.4).
4. Removal of any pidChain-string-compare code (regression case #1 — covered by ISO normalisation PR #94, but verify the legacy code path is deleted, not just bypassed).
5. CI: the regression corpus (`scripts/v0.2-regression.test.ts`) becomes a REQUIRED check on this PR (§7).

The PR should land as a **single squashed merge** to dev — bisecting half-way through a multi-commit flip is a debugging nightmare.

### Step e — Restart server pointing at v02 tables

`fresh-ant.db` is the same file. The cut-over isn't about a different DB file — it's about which tables the server reads. Existing legacy tables (`terminals`, etc.) remain intact and queryable (used during the 30-day audit window).

```bash
# On the mac mini:
launchctl unload ~/Library/LaunchAgents/sh.ant.daemon.plist
launchctl load ~/Library/LaunchAgents/sh.ant.daemon.plist
# OR if running ad-hoc:
pkill -f "ant-server" && cd /Users/jamesking/CascadeProjects/a-nice-terminal && bun run dev:server &
```

Verify it boots clean:

```bash
curl -s http://localhost:6174/api/health  # expect {"ok":true}
sqlite3 ~/.ant/fresh-ant.db "SELECT COUNT(*) FROM v02_agents"  # expect 0 (no JWPK yet)
```

### Step f — Re-register JWPK + dev team

Run the post-cutover runbook §2 + §3 (already drafted in `ant-v02-post-cutover-runbook.md`). Roughly:

```bash
ant agents create --name "James" --handle "@you" --kind human --super-admin
ant register --agent "@you" --name "james-tigerresearch"
# Then for each agent (cv4, codex4, speedyc):
ant agents create --name "cv4" --handle "@cv4" --kind claude --owner-org <jwpk-org>
ant register --agent "@cv4" --name "cv4"
# ... repeat
ant agents list  # verify 4 rows, all live, all with current_runtime_id non-null
```

### Step g — Verify

Run the smoke test from runbook §5 plus the regression corpus locally:

```bash
bun x vitest run scripts/v0.2-regression.test.ts  # expect 9/9 green
```

Plus a manual round-trip:

1. JWPK posts in v4.1 room.
2. Each agent's pane receives via fanout (pty-inject).
3. Each agent replies.
4. JWPK queries audit_events:
   ```bash
   sqlite3 ~/.ant/fresh-ant.db "SELECT kind, COUNT(*) FROM v02_audit_events GROUP BY kind"
   ```
   Expect rows for `agent.created`, `runtime.registered`, `membership.joined`, `message.posted`.

### Step h — Old tables stay (do NOT drop)

The cut-over PR explicitly does NOT include `DROP TABLE terminals`. The 30-day audit window starts now. Drop in a separate PR scheduled for week +5 (per runbook §7 #3).

---

## §5 Dual-read shim — should we?

**Recommendation: NO. Ship atomic.**

### The argument FOR a dual-read shim

If we shipped a brief window where server reads from BOTH v02_ and legacy tables (preferring v02, falling back to legacy on miss), we could:

- Tolerate a few hours where the server reads v02 but legacy data is still authoritative — useful if a backfill script were planned.
- Roll back without a server restart — just toggle a feature flag.
- Catch v02 schema bugs while still serving traffic from legacy.

### The argument AGAINST

- JWPK ratified **archive-and-ditch** (msg_jnh0l9idnb). There is no backfill. The v02 tables start empty. A dual-read shim would read empty v02 tables, fall back to legacy, and effectively do nothing different from the current code — until JWPK re-registers, at which point v02 starts winning. So the "shim" buys us a few minutes of overlap during which the agent population is migrating from "all legacy" to "all v02", and that overlap is exactly the re-register dance which is hands-on JWPK-driven anyway.
- Shim code is dead code 24h after cut-over. Two-PR debt: cut-over PR adds the shim, follow-up PR removes it. Each PR has its own review + CI cost.
- Atomic flip + post-cutover runbook (which is already drafted) gets us the same outcome in one PR.
- Rollback is a single revert commit + server restart + backup restore (per §6). That's a 30-second operation per the runbook §8 closing note.

### Decision

**Atomic flip.** The cut-over PR replaces all legacy imports with v02 stores in one go. Server restart on merge. Re-register JWPK + agents on the other side. If anything breaks within 1h: revert the merge commit + restore backup. 30 seconds either way.

If the cut-over implementer feels strongly about a shim despite the above, they should re-raise with JWPK in v4.1 — but the recommendation is to skip it.

---

## §6 Rollback plan

The cut-over PR is reversible because:

1. The legacy tables (`terminals`, `terminal_records`, `room_memberships`, `chat_room_members`) are NOT dropped. They remain populated with everything that existed before the cut-over.
2. The backup snapshot (`fresh-ant-pre-cutover-<stamp>.db`) preserves the exact DB state at cut-over moment.
3. The server code that reads from those tables is deleted, but lives in git history — revertible by `git revert <cut-over-merge-sha>`.

### §6.1 If the cut-over PR breaks something within 1h

```bash
# 1. Revert the merge commit on dev:
git checkout dev
git revert -m 1 <cut-over-merge-sha>  # use -m 1 because merge commit
git push origin dev

# 2. On the mac mini, restart the server with the reverted code:
cd /Users/jamesking/CascadeProjects/a-nice-terminal
git pull
pkill -f "ant-server" && bun run dev:server &

# 3. Restore the backup IF v02_ rows were written in the broken window:
cp ~/.ant/fresh-ant-pre-cutover-<stamp>.db ~/.ant/fresh-ant.db
# (Restart the server AGAIN after the swap)

# 4. JWPK + agents are now in their pre-cut-over identity.
#    They were already in the broken-window v02 world, but those rows
#    are gone with the backup restore. Their LEGACY rows are untouched.
#    They should be able to `ant status` and see their old identity.
```

### §6.2 If broken window discovered AFTER 1h (some agents have v02 identity)

Less clean. The legacy rows are stale (no activity since cut-over); v02 rows have ~hours of activity. Options:

- **Option Roll-Forward**: leave v02 in place, identify what broke, ship a fix on top of the cut-over PR (not a revert). This is the right call if the breakage is a bug in a specific endpoint, not a foundational schema issue.
- **Option Restore-and-Lose-Hours**: restore the backup, lose any messages/memberships created in the broken window. Only do this if the breakage is foundational (e.g., audit_events not being written).

JWPK calls it in the moment. The runbook §8 failure-mode table covers the common cases.

### §6.3 If broken window discovered AFTER 24h

The 30-day audit window is the safety net. Diagnose, ship fixes forward, do not revert. The cut-over PR is past the point of clean rollback at this point.

---

## §7 Regression corpus alignment

The 9 cases in `scripts/v0.2-regression.test.ts` (per `chore/v02-regression-corpus-skeleton` branch, awaiting merge) map to v02 tables as follows. Each case asserts the failure is **structurally impossible** under v0.2.

| # | Case (one-liner) | v02 table(s) asserted | Should FAIL on legacy schema? | Structural fix |
|---|---|---|---|---|
| 1 | Locale-format pid_start mismatch | `v02_runtimes` (column `pid_start_iso`) | YES — legacy uses `pid_start` TEXT with locale | ISO 8601 column type; PR #94 also closes against legacy |
| 2 | Shadow-terminal shadowing in pidChain walk | `v02_runtimes` (status filter) | YES — legacy pidChain walker has no status filter | `WHERE status='live'` + partial unique index |
| 3 | Dual-bind on fresh register (roster/fanout drift) | `v02_runtimes` (unique index) + `v02_memberships` + `v02_agents.current_runtime_id` | YES — legacy room_memberships caches terminal_id | Derived fanout target + uq_v02_runtimes_agent_live |
| 4 | Six-rooms × stub-id breakage (concurrent rebind) | `v02_audit_events` (rebind is an audit INSERT, not row UPDATE) + `v02_agents.current_runtime_id` | YES — legacy UPDATE-race on terminals.pid_start | INSERT-not-UPDATE for state changes; atomic swap on current_runtime_id |
| 5 | Competing-rebind race (instance #4) | Same as #4 | YES | Same as #4 |
| 6 | Fleet-restart auto-reclaim | `v02_reclaim_requests` (batch path) + `v02_audit_events` | YES — no batch primitive exists on legacy | `ant admin reclaim --all-stale --auto-approve` |
| 7 | Peer-driven upgrade reclaim | `v02_reclaim_requests` (requesting_agent_id != agent_id) + `v02_tool_grants` (peer holds reclaim grant) | YES — legacy has no concept of peer reclaim | reclaim_requests + tool_grants |
| 8 | Nifty-orphan-grant (deleted skill still loading) | `v02_tool_grants` (revoked_at_ms FK propagation) | YES — legacy skills load from FS globs | Tools catalog as DB rows; soft-delete invalidates grants |
| 9 | Multi-key survives device-revoke | `v02_agent_trust_keys` (multiple rows per agent) | YES — legacy has single trust_pubkey | Multi-key with key_kind enum |

**CI gate for the cut-over PR**: all 9 tests must transition from `it.todo()` to `it()` with passing assertions in the same PR. If any stays `todo()` at merge time, the cut-over PR is not done.

The cut-over PR should also propose promoting `v0.2-regression.test.ts` to a REQUIRED check on every PR touching `src/lib/server/` (per spec Open Question #1 — awaiting JWPK ratification). Recommend the cut-over implementer adds this to the PR description as an explicit ask.

---

## §8 Open questions for JWPK

**1. Extract `chat_room_members` into a dedicated v02 store, or fold into chatRoomStore?**

The legacy code has no `chatRoomMembersStore.ts` — every read/write lives inline in `chatRoomStore.ts`. Options:

- **A. Extract**: create `v02MembershipsStore.ts` as the new home (mirrors the v02_agents/v02_runtimes pattern). chatRoomStore.ts becomes thinner.
- **B. Fold**: keep memberships logic inside `chatRoomStore.ts` but switch to v02_memberships table.
- **C. Already extracted by `roomMembershipsStore` v02 successor**: the rename `room_memberships → v02_memberships` would mean `roomMembershipsStore.ts` (already a separate file) IS the new home, and `chatRoomStore.ts`'s inline SQL gets replaced with calls into that store.

**Recommendation: C.** It minimises new files and uses the existing store-extraction precedent.

**2. Where does `context_fill_pct` live in v02 — agent or runtime?**

The legacy code stores `agent_context_fill` on the `terminals` row. Per the spec, the runtime is ephemeral; context-fill is a property of the AGENT's current state, not the runtime binding.

Options:
- **A**: column on v02_runtimes (mirrors today).
- **B**: column on v02_agents (philosophically correct — context is the agent's, not the pane's).
- **C**: rolling-window in v02_audit_events (kind='context.fill.observed').

**Recommendation: A.** Pragmatic — context fill resets on each runtime change anyway (new pane = new context window).

**3. Settings split: which settings belong to v02_agents vs v02_runtimes?**

Today, `terminals.meta` is a JSON blob holding settings. In v0.2:

- Definitely AGENT-level: display_name, primary_handle, owner_org, allowlist.
- Definitely RUNTIME-level: pid, tmux_pane, host, agent_kind (CLI provider), pid_start_iso.
- AMBIGUOUS: display_color (today on chat_room_members per-room; per spec could move to v02_agents OR stay per-membership), notification preferences, ANT-View capture preferences.

**Recommendation: cut-over implementer to draft a 2-column table in the PR description, JWPK to ratify in PR review.**

**4. Demo-login: v02-aware on day 1 or follow-up?**

`/api/auth/demo-login` is dev-only; it creates a demo session bypassing real identity. Options:

- **A**: flip it to v02 in the cut-over PR (more work but no broken endpoints).
- **B**: leave it on legacy + add a header check so dev knows demo-login is broken until day 2.

**Recommendation: B.** Demo-login is non-prod; the cut-over PR scope is already large.

**5. agentStatusHookAuth: per-runtime or per-agent?**

`src/lib/server/agentStatusHookAuth.ts` stores hook-auth tokens on `terminals.meta`. In v0.2, is hook-auth bound to the runtime (rotates with the runtime — new pane gets new token) or to the agent (stable across runtime changes, simpler for the user)?

**Recommendation: per-agent (v02_agents.meta).** A stable hook-auth token across pane changes feels right; otherwise every `ant register` requires a hook-auth re-bind.

---

## §9 Verification grep checklist (run before trusting this doc)

This inventory is a snapshot from 2026-05-29. Before the cut-over implementer treats any file:line citation as load-bearing, run these greps to detect drift:

```bash
# Total importers of the 3 named legacy stores (expect ~109 hits across src/ — was 109 on 2026-05-29):
grep -rln "terminalsStore" --include="*.ts" --include="*.svelte" src/ scripts/ | wc -l
grep -rln "terminalRecordsStore" --include="*.ts" --include="*.svelte" src/ scripts/ | wc -l
grep -rln "roomMembershipsStore" --include="*.ts" --include="*.svelte" src/ scripts/ | wc -l

# Direct SQL on legacy tables outside the 3 store files (drift detection):
grep -rn "FROM terminals\b\|INTO terminals\b\|UPDATE terminals\b\|DELETE FROM terminals\b" \
  --include="*.ts" src/ | grep -v "\.test\.ts" | grep -v "terminalsStore.ts"
grep -rn "FROM terminal_records\|INTO terminal_records\|UPDATE terminal_records\|DELETE FROM terminal_records" \
  --include="*.ts" src/ | grep -v "\.test\.ts" | grep -v "terminalRecordsStore.ts"
grep -rn "FROM room_memberships\|INTO room_memberships\|UPDATE room_memberships\|DELETE FROM room_memberships" \
  --include="*.ts" src/ | grep -v "\.test\.ts" | grep -v "roomMembershipsStore.ts"
grep -rn "FROM chat_room_members\|INTO chat_room_members\|UPDATE chat_room_members\|DELETE FROM chat_room_members" \
  --include="*.ts" src/ | grep -v "\.test\.ts"

# Production endpoint count touching the 3 stores (expect ~34 on 2026-05-29):
grep -rln "terminalsStore\|terminalRecordsStore\|roomMembershipsStore" \
  --include="*.ts" --include="*.svelte" src/routes/ | grep -v "\.test\.ts" | sort -u | wc -l

# v02 table presence (after schema PR lands):
sqlite3 ~/.ant/fresh-ant.db ".tables" | tr ' ' '\n' | grep "^v02_" | wc -l   # expect 11
sqlite3 ~/.ant/fresh-ant.db ".schema v02_runtimes" | grep "WHERE status='live'"  # expect 1 hit (partial unique index)

# CLI scripts directly hitting the DB (expect 0):
grep -l "better-sqlite3\|getIdentityDb\|fresh-ant.db" scripts/ant-cli-*.mjs 2>/dev/null | wc -l

# PRs whose status the cut-over depends on:
gh pr view 103  # feat/v0.2-schema-tables — must be merged before cut-over PR opens
gh pr view 100  # feat/super-admin-reclaim-v0.2 — reclaim primitive; cut-over PR should land after this
gh pr view 99   # feat/identity-keys-multi-device — needed for case #9 regression test
gh pr view 96   # fix/auto-rebind-on-register — partially superseded by partial unique index
gh pr view 95   # chore/v02-regression-corpus-skeleton — the test stubs
gh pr view 94   # fix/pid-start-iso-normalisation — closes case #1 on legacy schema
```

If any of those counts have drifted by >10% from the values in §1 + §2, regenerate the inventories before relying on them.

---

## §10 Dependencies (PR order)

The cut-over PR sits at the end of a chain. To merge cleanly, these should be in dev first (in order):

1. **#94** `fix/pid-start-iso-normalisation` — closes case #1 against legacy; safe to merge anytime.
2. **#95** `chore/v02-regression-corpus-skeleton` — adds the test file with `todo()` stubs.
3. **#96** `fix/auto-rebind-on-register` — closes case #3 symptom against legacy.
4. **#97** `docs/v02-spec-concept-doc` — spec doc (already merged via e6fe08f).
5. **#99** `feat/identity-keys-multi-device` — needed for case #9 assertion (the identity_keys foundation; v02_agent_trust_keys ships in this PR's space).
6. **#100** `feat/super-admin-reclaim-v0.2` — reclaim primitive; needed for cases #6 and #7.
7. **#103** `feat/v0.2-schema-tables` — the 11 additive tables. **THE BLOCKER for the cut-over PR.**
8. **THIS PLAN** (`docs/v0.2-cutover-plan`) — doc landed; no code dep.
9. **CUT-OVER PR** — the actual flip. Depends on everything above being on dev.

The cut-over PR should bump version to v0.2.0 (matching the schema-tables PR if not already done) and update CHANGELOG.

---

## §11 Estimated diff size

Rough estimate from §1 + §2 counts (for sizing review effort):

- 50 server files touched (3-15 line diff each — mostly import + variable rename) → ~400-500 lines
- 34 endpoint files touched (10-30 line diff each — endpoint logic adjustments) → ~600-800 lines
- 3 new v02 store files (200-300 lines each) → ~700-900 lines
- 1 extracted helper file for chat_room_members SQL (200 lines)
- 9 regression test bodies (50 lines each, replacing 9 `todo()` calls) → ~450 lines
- CHANGELOG + version bump

**Total: ~2500-3000 line PR.** Large but mechanical. Reviewable in chunks if split by surface (identity surface / terminals surface / chat-rooms surface) but a single squash merge is recommended for atomicity.

---

## §12 Implementer's first three commands

For the agent picking this up:

```bash
# 1. Verify the plan is still current
cd /Users/jamesking/CascadeProjects/a-nice-terminal
cat docs/concepts/ant-v02-cutover-plan.md | head -50  # confirm date + status
# Run the §9 grep checklist; if counts drift >10%, refresh the inventory before coding.

# 2. Verify dependencies are merged
gh pr view 103  # must be MERGED before opening the cut-over PR
gh pr view 100  # must be MERGED
gh pr view 99   # must be MERGED

# 3. Branch from dev
git checkout dev && git pull
git checkout -b feat/v0.2-cutover

# Then start with the smallest surface: read-only endpoints first (§2.1 + §2.2 read-only rows).
# Hot path (chat-rooms/messages POST) goes LAST so it gets the most scrutiny.
# CI must show 9/9 regression cases green at every push.
```

Good luck. The flip is mechanical — the discipline is in not skipping the regression assertions.

---

*This plan is a living document. If the inventory drifts before the cut-over PR opens, update §1 + §2 inline rather than spawning a v2 doc. The spec doc (`ant-v02-identity-and-recovery.md`) is canonical for design; this doc is canonical for execution.*
