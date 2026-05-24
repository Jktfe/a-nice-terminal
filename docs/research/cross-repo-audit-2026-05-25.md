---
doc_id: cross-repo-audit-2026-05-25
title: "Cross-repo audit — a-nice-terminal overnight wins → sibling repos"
status: punch-list
auditor: "@speedyclaude"
audited_at: 2026-05-25
trigger: "JWPK msg_78mmgq4ge6 2026-05-25 — cross-repo efficiency check across server / Mac app / remoteant Mac / Windows / antios / future antdroid"
linked_rooms: ["orsz2321qb", "hyz00k0ibh"]
---

# Cross-repo audit — overnight a-nice-terminal wins → sibling repos

## Scope

Inventory the user-facing capabilities shipped on `a-nice-terminal` overnight (2026-05-24 → 2026-05-25, 24 commits on main) and identify where the **antchat** (Mac SwiftUI), **antchat-windows** (Tauri/Svelte/Windows), **ant-native** (iOS/macOS native scaffolds), **antOS** (not yet started) need parallel work.

This is a PUNCH LIST, not a build sequence. Each item names the gap and proposes the minimum-viable parallel slice.

---

## Confirmed gaps

### 1. `ChatRoom.description` field — Mac app (antchat) + Windows app (antchat-windows)

**Server side**: Added at `a19a496` (a-nice-terminal). Optional, nullable, capped at 240 chars. `POST /api/chat-rooms` and `PATCH /api/chat-rooms/:id/description` both write it. The `GET /api/chat-rooms` response now includes the field on each room.

**Mac app gap**: `antchat/Antchat/Wire/ChatModels.swift:16-26` — `ChatRoom` struct doesn't include `description: String?`. Codable will silently drop the field; the Mac app sees no description.

**Mac app gap**: `antchat/Antchat/Wire/ChatModels.swift:7-10` — `CreateChatRoomRequestBody` doesn't include `description`. Mac users can't set description at room creation.

**Mac app gap**: `antchat/Antchat/Views/Rooms/RoomListPreviewView.swift:296` — uses `room.summary`, will continue showing the auto-derived latest-message preview instead of the user-set description.

**Windows app gap**: `antchat-windows/shared/api-types.ts` (last synced 2026-05-16) — `ChatRoom` interface doesn't include `description`. Same Codable-silent-drop shape via TypeScript.

**Proposed Mac slice** (~15 lines + UI work):
- Add `let description: String?` to `ChatRoom` struct
- Add `let description: String?` (optional) to `CreateChatRoomRequestBody`
- Add `description: String?` parameter to `AntchatAPIClient.createChatRoom(...)` + send when non-empty
- Update `RoomListPreviewView` to prefer `room.description` over `room.summary` when present
- Add a description editor in room detail (Mac equivalent of `EditRoomDescriptionForm.svelte`)
- New `PATCH /api/chat-rooms/:id/description` client method

**Proposed Windows slice** (~10 lines):
- Add `description?: string | null` to `ChatRoom` interface in `shared/api-types.ts`
- Update room list view + room detail to render + edit

**Owner candidate**: Mac team in hyz00k0ibh (@antchatmacdev / @antmacdevcodex). Windows: @claudev4 already touched that repo this morning per the activity log.

### 2. Filter chips + name filter UI — sibling apps

**a-nice-terminal**: `/rooms` shipped chips (All/Starred/Active/Quiet) + name+description filter + sort + compact density (claudev4 ebf4b90, my 2f6c223 follow-up). `/asks` shipped text filter + "/" shortcut (28323dc + 25724d2). `/plans` shipped text filter + "/" shortcut (ff495d8 / kimi).

**Mac app gap**: `OpsColumn.swift:82,94` has a `filterChip` view but it's narrower than the web version — no sort + density. Not blocking; less urgent.

**Windows app gap**: not investigated but worth checking against the Svelte source — if it mirrors the web shape pre-overnight, the same filter+sort+density patterns should drop in cleanly.

**Proposed**: lower priority than #1 because filter UX is "polish" rather than "missing data". Address after description field lands across all clients.

### 3. Away-mode tier wire surface — sibling apps

**Server side**: Added at `a25e38a` (a-nice-terminal). `away_modes` table + `GET/PUT /api/away-modes/:handle` + tier persisted server-side, agents can observe via `getAwayMode()`.

**Mac app gap**: no wire model for `AwayMode` / `AwayTier`, no `AwayModeAPIClient` surface. Mac app won't know its user's away tier, and can't set one.

**Windows app gap**: same.

**Proposed Mac slice** (~30 lines):
- New `AwayModeModels.swift` with `AwayTier` enum + `AwayMode` struct
- `AntchatAPIClient.fetchAwayMode(handle:)` + `setAwayMode(handle:tier:)`
- Mac-shaped equivalent of `AwayModeToggle.svelte` (the 3-pill control) in the room detail

### 4. Status pill in room header (SSE finish layer) — sibling apps

**Server side**: realtimeRoomStore consolidated at 4c18bf4 (claudev4). `RealtimeStatusIndicator` SVELTE component lands a green/amber/red live pill in the room header.

**Mac app gap**: SSE consumer in `Antchat/Core/Bridge/MessageSource.swift` exists but no equivalent of the finish-layer status (`connecting → connected → catching-up → caught-up → disconnected → unreachable`).

**Proposed**: deeper slice. Mac team probably has their own real-time strategy via `MessageSource`. Defer until they ratify.

### 5. Click-to-explain v0 spec — exists, not yet implemented

**a-nice-terminal**: spec at `docs/research/click-to-explain-spec-v0.md` (kimi fcf959b). Awaiting JWPK ratification before implementation.

**Mac app**: spec covers static OSS map + dynamic Premium dump. Mac equivalent is a SwiftUI `Explainable` view modifier + popover. Worth scoping in parallel once the web v0 stabilises the explain-map JSON shape.

**Proposed**: hold until web v0 ships + JWPK ratifies premium-vs-OSS split.

### 6. CLI-agent prompt channel + in-room bring-in — Mac app (antchat) + Windows app (antchat-windows)

**Server side**: `POST /api/cli-agents/:handleId/prompt` body `{text}` (shipped PR #52, ff59ee0) + `POST/GET /api/chat-rooms/:roomId/cli-agents` (shipped PR #53, claudev4/in-room-bring-in-codex). The web room page now exposes a Bring-in-codex button + per-agent textarea that talks to these. Source: `src/lib/components/RoomCliAgentsPanel.svelte` + `src/routes/api/chat-rooms/[roomId]/cli-agents/+server.ts`.

**Mac app gap**: no equivalent surface in `antchat/Antchat/Views/Rooms/`. JWPK's mobile-companion pitch in `project_bring_in_llm_buttons_2026_05_23` explicitly names "Bring in Claude Desktop / Claude Mobile / ChatGPT / Gemini" buttons living on the Mac/iOS clients — the operator-driven prompt channel is the foundation those depend on. Without the Mac surface, the bring-in flow is web-only and the Mac app stays a read-mostly viewer of cli_hook_events.

**Windows app gap**: same shape. `antchat-windows/shared/api-types.ts` would need the `CliAgentHandle` wire-type (+ optional `roomId`) and the room-page Svelte component would need an in-room bring-in panel parallel to `RoomCliAgentsPanel.svelte`.

**Cross-link**: codex JSON-RPC method names verified against `codex app-server generate-json-schema` — banked as [[verify-protocol-methods-against-generator-2026-05-24]]. Any Mac/Windows wrapper should re-verify against the same generator (don't trust the web-side method names blindly; codex versions may diverge).

**Proposed Mac slice** (~80 lines, contained):
- New `BringInAgentSheet` SwiftUI view bound to a room
- Two `AntchatAPIClient` methods: `bringInCliAgent(roomId:cli:cwd:)` POST + `listRoomCliAgents(roomId:)` GET + `sendPrompt(handleId:text:)` POST
- Per-agent card with prompt textarea (mirrors `RoomCliAgentsPanel.svelte` styling)
- Polls `/api/chat-rooms/:roomId/cli-agents` every 4s on room screen
- Out of scope (parity with web): codex auto-posting back to chat — multi-piece follow-up everywhere

**Proposed Windows slice** (~120 lines): direct port of `RoomCliAgentsPanel.svelte` since the Windows app is Svelte; the four endpoints are already proxied.

**Reason cross-team ask**: closes dogfood findings #4 + #5 across all clients, not just web. The "operator can bring in a codex from any of their devices and feed it a brief" pitch only works when every entry-point has the affordance.

---

## Suggested merge order

1. **Mac app + Windows app `description` field** (gap #1) — lowest risk, highest visible benefit. Mac team to own per `hyz00k0ibh`.
2. **Mac app + Windows app `AwayMode` wire** (gap #3) — clear behavioural fix; agents can observe away tier across all clients.
3. **CLI-agent prompt channel + bring-in** (gap #6) — bring-in flow only works from web today; mobile companion pitch needs Mac/Windows parity. Highest *new-capability* leverage of the list.
4. **Filter UX parity** (gap #2) — polish; lower urgency.
5. **Status pill / SSE finish layer** (gap #4) — bigger architectural slice; needs the Mac team's real-time strategy to converge first.
6. **Click-to-explain Mac parallel** (gap #5) — waits on web v0 + JWPK spec ratification.

## What this audit did NOT cover

- `antOS` — JWPK noted "I don't think is delivered or even started yet"; nothing to audit.
- Future `antdroid` / server variants — same; no source yet.
- `ant-native` `macos-native` and `ios` subdirs — initial scan found no ChatRoom-handling code; if those become active clients, re-audit.

## Next-step asks for JWPK

- Approve auditor to cross-post specific gap items into `hyz00k0ibh` (Mac team room) as work-items for @antchatmacdev / @antmacdevcodex to pick up.
- Or: have @speedyclaude / @speedycodex / @speedykimi ship Mac/Windows patches directly if you'd prefer the speed-pact trio carries cross-repo too.
- Standing offer to scope a more detailed checklist per gap before any commits.

---

**Banked**: `feedback_cross_repo_review_per_slice_2026_05_25.md` enshrines this as a per-slice habit going forward.
