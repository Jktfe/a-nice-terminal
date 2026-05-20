# Linkedchat backend v3 audit (SLICE-2 of JWPK terminals-redesign)

Date: 2026-05-14
Author: @researchant (read-only scout per banked v3-untouched discipline)
Status: AUDIT-ONLY. Identifies v3 surfaces + maps to antv4 unified-terminal entity.
Cap: ≤180L. Pairs with claude2 SLICE-1 frontend audit.

## TL;DR — JWPK architectural correction

v3 treats `linkedchat` and `terminal` as separate concepts (split
ChatPane/ChatSidePanel/PtyChat components + linked_chat_id schema field).
JWPK D-x: "they are one and the same. the terminal can simply be viewed
and interacted with as a chat, an ANT terminal, or a RAW terminal." This
audit identifies which v3 backend logic to KEEP under the unified-terminal
banner (rendering + routing semantics) vs DROP (the separation itself).

## v3 backend surfaces inventory

### 1. Schema (sessions table — v3 db.ts)
- `linked_chat_id TEXT NULL` (db.ts L584) — terminal session points at a
  chat session it's "embedded under". One→one direction.
- `auto_forward_chat INTEGER NOT NULL DEFAULT 1` (L589) — controls the
  routing-mode semantics described in adapters/linked-chat-adapter.ts.

### 2. linked-chat-adapter.ts (165L — adapters/)
- `canDeliver`: any RouteTarget of `type === 'terminal'` is deliverable.
- `deliver` mode by `auto_forward_chat`:
  - `=1` + `role === 'user'` + sender_id set → raw keystrokes (`content + \r`)
    → user can answer interactive prompts from chat.
  - `=0` OR `role !== 'user'` → ANSI notification block (display only).
- `isTerminalDirectMessage` flag on meta.source = 'terminal_direct' skips
  raw-forward (avoids own-keystroke echo loop).

### 3. Output broadcast (pty-daemon.ts L910)
Daemon broadcasts `{type:'output', sessionId, data}` to ALL connected
clients. **Daemon is shape-agnostic** — no per-room or per-listener routing
in the daemon itself. Routing decisions live in the SERVER (message-router
+ adapters), NOT in the daemon. This is the correct layering — KEEP.

### 4. Cross-terminal allowed-list (M3.3a per fresh-ANT)
fresh-ANT already has `linkedChatPermissionStore` with per-`(terminal_id,
subject_handle)` allow/deny rows in the `linked_chat_permissions` table.
This is the cross-terminal visibility primitive JWPK referenced. KEEP +
EXTEND (currently scoped to subject_handle; may need to add allowed-from-
terminal-id rows for cross-terminal context awareness).

### 5. Driver layer + EventClass (per claude2 addendum)

v3 has 14 drivers (`src/drivers/<cli>/driver.ts`: claude-code, codex-cli,
gemini-cli, kimi-code, copilot-cli, qwen-cli, llm, llamafile, lemonade,
lm-studio, mlx-lm, msty, ollama, pi). `agent-event-bus.ts` (1022L) pipes
pty.onData → driver.detect → eventClass routing.

`src/fingerprint/types.ts` L9-16 `EventClass` union: `permission_request |
multi_choice | confirmation | free_text | tool_auth | progress |
error_retry`. **CRITICAL SCOPE NOTE per RQO addendum-HOLD on claude2**:
these are INTERACTIVE-EVENT classes (asks/prompts), NOT a full output
classifier. v3 `AgentDriver.detect(raw): NormalisedEvent | null` emits at
most ONE event per chunk. The CHAT/ANT view per-chunk classifier
(message/thinking/tool-call/raw) is **NEW v4 work**, not a v3 lift.

**Lift plan**: drivers + EventClass + agent-event-bus LIFT VERBATIM (only
the bus's init({getSession, broadcastGlobal}) DI seams need fresh-ANT
wiring). NEW v4 output-classifier per-CLI parsers are SEPARATE T2-redesign
sub-slice — design before impl.

### 6. Persistence tables (v3 db.ts L521-549) — JWPK "retained forever"
**`terminal_events`** (L521): `{id, session_id, ts_ms, kind, data}` — raw
event log per terminal session. Low-level. Append-only.

**`run_events`** (L535 + helper L66-79): `{id, session_id, ts_ms, source,
trust, kind, text, payload, raw_ref, created_at}` with source CHECK enum +
trust ∈ ('high','medium','raw'). Schema comment L531-534: "the interpreted,
trust-labelled stream that sits between linked chat and raw terminal:
hooks/JSON where available, parsed terminal diffs otherwise, with optional
pointers back to raw transcript chunks for audit." **THIS IS THE ANT VIEW
STREAM JWPK DESCRIBED.** Already exists in v3 — LIFT VERBATIM.

**`command_events`** (L541): per-command metadata `{command, cwd, exit_code,
started_at, ended_at, duration_ms, output_snippet}`. Powers ANT-view
command-block rendering.

## Mapping to antv4 unified-terminal

### Currently-linkedchat-named fields → unified terminal entity

| v3 field | New antv4 location | Rationale |
|---|---|---|
| `sessions.linked_chat_id` | `terminals.routing_room_id` (nullable) | Same fact — terminal-points-at-room. Renamed for unified vocab. |
| `sessions.auto_forward_chat` | `terminals.auto_forward_chat` (1/0) | Routing-mode flag stays per-terminal. Verbatim port. |
| `linked_chat_permissions(terminal_id, subject_handle)` | `terminals.allowed_subjects[]` (or keep table) | Already terminal-scoped. KEEP table for normalization. |

### NEW antv4 fields needed (per JWPK reframed scope)
- `terminals.name TEXT` — user-editable display label (sessionId hidden from UI per JWPK).
- `terminals.terminal_local INTEGER 1/0` — when 1, output never routes to room (private scratchpad). v3 has no equivalent — NEW capability.
- `terminals.allowed_from_terminal_ids[]` (junction table) — which OTHER terminal sessions can see this one's output in their cross-terminal-context awareness panel. v3 implicit via shared room membership; antv4 makes it explicit.

### Single stream + 3 filter pipelines (per JWPK 2026-05-14 clarify)

JWPK: "All output goes to all 3, it is just filtered differently."
Backend exposes 3 read-side surfaces against the SAME terminal session:

| View | Source | Filter | Persistence |
|---|---|---|---|
| RAW | SSE /api/terminals/[id]/stream (T1) | none — bytes-as-is | ephemeral (tmux compacts) |
| CHAT | NEW REST /api/terminals/[id]/messages | only kind ∈ {chat-msg, linked-chat-msg} from run_events | retained forever |
| ANT | NEW REST /api/terminals/[id]/run-events | full run_events feed (all kinds) | retained forever |

The CHAT + ANT views need NEW backend endpoints reading run_events; RAW
view is the existing T1 SSE. View-toggle in frontend is data-source
switch, not parser switch.

## Lift-vs-rewrite per backend piece

| Piece | Verdict | Notes |
|---|---|---|
| linked-chat-adapter routing semantics | LIFT (rename + relocate) | auto_forward_chat + raw-keystroke vs ANSI-notification fork is correct. Rename file → terminal-routing-adapter.ts. |
| linked_chat_id field migration | REWRITE (rename to routing_room_id) | One-shot ALTER + data migration if any rows exist (post-reset = none). |
| Cross-terminal allowed-from logic | NEW (no v3 equivalent) | Build per JWPK ask. Simple junction table + adapter check. |
| Daemon output broadcast | KEEP AS-IS | Already correctly shape-agnostic. T1 backend already wired. |
| ChatSidePanel/PtyChat parsing | DROP (frontend collapses) | claude2 SLICE-1 captures rendering logic, but the SEPARATION goes away. |

## NEW antv4 backend surfaces required (T2-redesign)

- LIFT `run_events` + `terminal_events` + `command_events` verbatim (rename FK → terminals).
- LIFT `agent-event-bus.ts` + 14 drivers + `EventClass` (DI-rewire only).
- NEW `terminalsStore` SQLite-backed (~120L) per Q-table schema.
- NEW POST/PATCH `/api/terminals` extended body `{name?, routing_room_id?, terminal_local?, auto_forward_chat?}`.
- NEW GET `/api/terminals` returns full `[{sessionId, name, routing_room_id, ...}]`.
- NEW GET `/api/terminals/[id]/run-events?since=ts_ms&kinds=...` paginated read.
- NEW SSE `/api/terminals/[id]/run-events/stream?kinds=...` (per Q4).
- NEW POST `/api/terminals/[id]/cross-allow` body `{otherTerminalId, allow}`.
- NEW v4-output-classifier per-CLI parsers (NOT a v3 lift — design first).
- NEW route adapter (rename from linked-chat-adapter).

## Locked acceptance (T2 backend redesign — separate slice from this audit)

- terminalsStore SQLite table with schema per Q-table.
- POST/PATCH/GET extended bodies + responses.
- linked-chat-adapter renamed + lifted into fresh-ANT.
- Cross-terminal allow junction table + endpoint.
- 19+ tests across store + adapter + endpoint surfaces.
- Plan event `terminals-backend-t2-unified-redesign` status=done after canonical PASS.

## Do-not-use

| Rejected | Why |
|---|---|
| Keep `linked_chat_id` name in antv4 | JWPK explicit: linkedchat ≠ separate concept. Rename. |
| Build server-side chat-render endpoint | View-mode is frontend pipeline switch (JWPK). |
| Migrate v3 sessions table directly | Post-reset clean slate; new schema, no migration. |
| Allow daemon-level per-room routing | Daemon stays shape-agnostic; routing is server policy. |

## Q4 (claude2 asked) — TWO streams not multiplexed

`GET /api/terminals/[id]/stream` (T1) = RAW bytes high-volume. NEW `GET
/api/terminals/[id]/run-events/stream?kinds=...` = parsed events with
optional `kinds` filter (CHAT view = message-kinds subset, ANT view =
all kinds). High-volume raw + low-volume parsed never mix → view-switch
is a clean EventSource swap.

## Open questions for JWPK

1. `terminal_local` flag v1 or defer? Default: defer.
2. Cross-terminal allowed-from default? Default: implicit-from-shared-room-membership v1; explicit junction v2.
3. Rename `auto_forward_chat`? Default: keep v3 name (verbatim lift).

## What I did NOT verify

- terminalsStore SQL DDL not prototyped. linked-chat-adapter caller-trace incomplete. fresh-ANT linked_chat_permissions junction-shape extension unverified.

## Next step

T2 backend redesign claim-first under THIS audit once canonical PASS +
JWPK Q1-Q3 ACK. Pairs with claude2 frontend T2 over unified terminal entity.
