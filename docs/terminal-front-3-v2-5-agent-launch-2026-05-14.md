# FRONT-3v2-5 design — agent-launch chips + linked-chat scope — 2026-05-14

Author: @claude2 TTVPh3mnu8wERzALQLJO6
Gate: canonical @codex2 RQO32LuIK8xmcV7fq04Oq
Driver: JWPK dogfood feedback — Chat-view semantic correction

## STATUS: DEFERRED — awaiting linked-chat T1 contract clearance

Per canonical 3-slice HOLD verdict 2026-05-14: this design currently locks
Chat/agent-launch around `/run-events?dest_room` + classifier dest_room
tagging, but the upstream linked-chat T1 design is itself HOLD pending
choice between:

- **PATH A** — merge `terminal_records` with `terminalsStore` (unified
  store, one row per pane, linked_chat_room_id column added there)
- **PATH B** — actual chat-message room + SSE (route messages through
  `/api/chat-rooms` infrastructure as ordinary messages)

This design's filter shape (`?dest_room=X` on `/run-events`) only fits
PATH A. If canonical picks PATH B, the Chat view subscribes to a
different stream entirely and the agent-launch endpoint POSTs to
`/api/chat-rooms/[linkedRoomId]/messages` not `/input`. Re-anchor this
doc post-linked-chat T1 PASS — don't claim impl until that resolution.

## JWPK verbatim spec (locked)

> if you type it straight enters to the terminal, no response that's in
> ANT and RAW
>
> if you launch an agent and click an agent type (the fingerprinted ones)
> then it sends it in an ant chat format where the response is sent back
> via the cli as if it has its own personal chat room — i.e. the linked chat

**Translation lock:**
- Chat is NOT `kind=message` filter — Chat IS this terminal's linked-chat-room
- Direct PTY input → ANT + RAW only; Chat stays silent
- Agent-chip-launch → user msg routed as ant-chat-format to PTY + tagged
  `dest_room=linked_chat_room_id`; CLI response classified + same tag
- Each terminal has its own 1:1 linked-chat-room
- Chat view = `/run-events?dest_room=linked_chat_room_id` (researchant T2-LINKED-CHAT)

## Locked assumptions (no JWPK gate)

| # | Assumption | Why |
|---|---|---|
| A1 | Agent chips render INSIDE TerminalHeader on a 2nd row | Already the focal control surface; matches mental model |
| A2 | Chip click opens a modal w/ textarea + "Send to {agent}" | Mirrors create-terminal modal — familiar UX |
| A3 | Chip list seeded from terminal_records.agentKind + FingerprintDetector hits | Both surfaces exist post-T2b-impl-1 |
| A4 | Empty-Chat state copy: "Launch an agent above to start a conversation" | Direct signpost, no jargon |
| A5 | TerminalChatView swaps SSE filter from kinds=message → dest_room=linked_chat_room_id | scope correction |
| A6 | Composer in Chat view stays — used for follow-up turns to active agent | minor UX nicety |

## Components to ship

### TerminalHeader.svelte (+~40L)
- New `agentChips: AgentChip[]` prop ({ agentKind, label, icon? })
- Render below view-switcher: agent-chip row when `agentChips.length > 0`
- Each chip: `onclick={() => onAgentLaunch(chip)}`
- New prop `onAgentLaunch(chip): void` callback

### TerminalCard.svelte (+~80L)
- Fetch + reactive state: `agentChips = $state<AgentChip[]>([])`
  - GET `/api/terminals/[id]` returns `agentKind` (record) + new
    `availableAgents: AgentChip[]` array (researchant adds — fingerprint
    detector output)
- Modal state: `launchModalOpen = $state(false)` + `pendingAgent` +
  `pendingMessage`
- Handler `confirmAgentLaunch()`: POST `/api/terminals/[id]/agent-launch`
  { agentType, message } → endpoint wraps msg in ant-chat-format + writes
  to PTY tagged with `dest_room=linked_chat_room_id`
- Pass `agentChips` + `onAgentLaunch` down to TerminalHeader

### TerminalChatView.svelte (rescope, ~30L delta)
- Replace `?kinds=message` filter on both seed + stream with
  `?dest_room=<linkedChatRoomId>` (param name per researchant contract)
- Read `linkedChatRoomId` from TerminalCard via new prop
- Empty-state copy: "Launch an agent above to start a conversation"
- Bubble render unchanged — kind label still shown, just gated by routing tag

## Contract requested from researchant (T2-LINKED-CHAT)

1. `terminal_records` schema add: `linked_chat_room_id` (string, auto-gen on
   create)
2. GET `/api/terminals/[id]` response includes `availableAgents` array
   (fingerprint-derived) + `linkedChatRoomId`
3. NEW POST `/api/terminals/[id]/agent-launch` { agentType: string,
   message: string }
   - wraps message in ant-chat envelope (e.g. `@<agentType> <message>\n`)
   - writes to PTY (`/input` internally)
   - tags resulting `terminal_run_events` rows with
     `dest_room=linkedChatRoomId`
4. `terminal_run_events` filter extends: `GET /run-events?dest_room=X`
   returns rows where `dest_room=X` (existing column or new — researchant
   choice)
5. Classifier dispatch tags response rows with same `dest_room` for the
   active in-flight agent-launch (researchant decides timing window or
   PTY-marker scheme)

## Trust + safety boundary

- Agent-launch endpoint writes BYTES into the PTY — must escape/validate
  message (e.g. block embedded `\x03` Ctrl+C, sanity-cap length 8KB)
- Linked-chat-room id is opaque server-generated UUID; never user-input
- Chat view never renders unsanitised HTML — bubble component already
  uses `<pre>` text escape

## Out of scope (deferred)

- Cross-terminal linked-chat sharing — single terminal owns single room v1
- Read-receipts / typing indicators — v3 doesn't have them either
- Multi-turn dialogue thread depth UI — v1 = flat list of bubbles ordered
  by ts_ms
- @-mention parsing inside agent dialogue — string-only ant-chat-format v1

## Acceptance

- Doc ≤180L
- 3 components diff'd correctly; no regression on FRONT-1/2/3 v1/v2 PASS surfaces
- Live verify with claude-code-fingerprinted terminal:
  - Agent chip strip shows in TerminalHeader
  - Click chip → modal opens with textarea
  - Submit → POST agent-launch returns 201 + Chat view populates with
    user msg + CLI response bubbles tagged dest_room
- Direct PTY input via Special Keys row or Raw xterm does NOT appear in
  Chat view (only ANT + RAW)

## Ship order

1. **FRONT-3v2-5a**: TerminalHeader agentChips row + onAgentLaunch callback (~30min, design)
2. **FRONT-3v2-5b**: TerminalCard fetch availableAgents + modal + agent-launch POST (~1h)
3. **FRONT-3v2-5c**: TerminalChatView rescope filter to dest_room + empty-state copy (~30min)

All slices claim-first under canonical RQO + browser-runtime verified.
Awaits researchant T2-LINKED-CHAT contract delivery before code-impl claim.
