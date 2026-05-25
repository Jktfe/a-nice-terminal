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

### 6. Local CLI bridge (codex/pi process spawner) — Mac/Windows mirror is **NOT a priority slice**

**Product call locked 2026-05-25 (orsz2321qb msg_qpcmqnkeko + codex 244155c)**: this is a developer/operator tool, not a premium user-facing surface. Three distinct affordances were getting conflated under the same "Bring in an agent" label:

| Affordance | Status | Who it's for |
|---|---|---|
| **Remote invite** | Shipped (existing) | Invite an ANT-resident agent ALREADY RUNNING somewhere |
| **Local CLI bridge** | Shipped on web PRs #52 + #53 + #55; removed from prominent placement at 244155c; awaiting rename + gating before any client mirror | Dev/operator who has `codex`/`pi` binaries installed and wants a quick local pair |
| **Premium Bring in App** | Banked at `project_bring_in_llm_buttons_2026_05_23`; NOT YET BUILT | One-tap "open Claude Desktop / Claude Mobile / ChatGPT / Codex Desktop / Gemini" with room context + consent + membership |

**Mac PR closed**: antchat PR #2 (CLI bridge mirror, speedyclaude/cli-agent-bring-in-mirror commit 8407a49) was closed 2026-05-25 because it shipped against the conflated framing. Branch + code preserved; re-opens once the rename + gating contract is settled web-side first.

**Cross-repo discipline reinforced**: see `feedback_cross_repo_review_per_slice_2026_05_25.md` subrule banked 2026-05-25 — cross-repo mirror is only as good as the source's product framing. Wait for web shape-lock before mirroring.

**Re-open trigger**: when the web side ships the renamed + gated CLI bridge surface (label TBD, gating likely behind binary-detection or developer-mode toggle), the Mac + Windows mirror slices can re-open with the matching shape. **Not a Mac/Windows priority gap until that lands.**

### 6b. Premium "Bring in App" — separate slice, not yet built anywhere

The actual high-leverage cross-repo opportunity from `project_bring_in_llm_buttons_2026_05_23`. One-tap launchers in any client (web/Mac/iOS/Windows) that open Claude Desktop / Claude Mobile / ChatGPT / Codex Desktop / Gemini with the room's context pre-loaded and consent established.

**Not built anywhere yet.** Needs its own spec covering: identity onboarding flow, app-launch protocol per target, room-context payload shape, consent + membership UX, deep-link or Share Sheet integration per platform.

**Backlog**: this is the actual "Bring in an agent" affordance JWPK has been referring to. Spec ratification → web v0 → Mac/iOS/Windows mirrors.

---

## Suggested merge order

1. **Mac app + Windows app `description` field** (gap #1) — lowest risk, highest visible benefit. Mac PR #1 + Windows PR #1 open for JWPK pull+test.
2. **Mac app + Windows app `AwayMode` wire** (gap #3) — clear behavioural fix; agents can observe away tier across all clients. In Mac PR #1.
3. **Premium "Bring in App"** (gap #6b) — actual high-leverage cross-repo opportunity. Needs spec ratification first, NOT shipped anywhere yet.
4. **Filter UX parity** (gap #2) — polish; lower urgency.
5. **Status pill / SSE finish layer** (gap #4) — bigger architectural slice; needs the Mac team's real-time strategy to converge first.
6. **Click-to-explain Mac parallel** (gap #5) — waits on web v0 stabilising (kimi 8a62295 restyle was the v0 lock-in).
7. **Local CLI bridge Mac/Windows mirror** (gap #6, demoted) — NOT a priority until web ships renamed + gated surface. Mac PR #2 closed pending re-open.

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
