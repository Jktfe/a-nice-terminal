---
doc_id: cross-repo-parity-matrix-2026-05-25
title: "Cross-repo parity matrix - Main ANT vs Mac, Windows, antios"
status: current-audit
auditor: "@speedycodex"
audited_at: 2026-05-25
linked_rooms: ["orsz2321qb", "hyz00k0ibh"]
trigger: "JWPK msg_78mmgq4ge6 + msg_2pawrvcnpo - keep sibling repos efficient and do not idle"
---

# Cross-repo parity matrix - 2026-05-25

## Scope

Audit the last overnight Main ANT capabilities against the sibling app repos:

- Main web/server: `/Users/you/CascadeProjects/a-nice-terminal`
- Mac native: `/Users/you/CascadeProjects/antchat`
- Windows native shell: `/Users/you/CascadeProjects/antchat-windows`
- iOS app: `/Users/you/CascadeProjects/antios`

This matrix is a delivery aid, not a merge plan. It identifies where a shipped Main capability is already mirrored, where it is in-flight, and where it is absent.

## Current Repo State

| Repo | State observed | Notes |
|---|---|---|
| Main `a-nice-terminal` | HEAD `6587117`; one unrelated dirty file `src/routes/agents/+page.svelte` | Dirty file is an Explainable wrapper change. This audit does not touch it. |
| Mac `antchat` | Dirty WIP: `AntchatAPIClient.swift`, `CliAgentModels.swift`, `Resources/`, `docs/` | Matches @speedyclaude's active CLI-agent bring-in mirror claim. Do not edit from Main lane. |
| Windows `antchat-windows` | Clean at HEAD `143a171` | Already mirrors `ChatRoom.description` read/render. |
| iOS `antios` | Heavily dirty active worktree | Treat as an older/native lane with local changes; audit only. |

## Parity Matrix

| Capability | Main ANT state | Mac `antchat` | Windows `antchat-windows` | iOS `antios` | Action |
|---|---|---|---|---|---|
| Room descriptions: field, create, edit, card render | Shipped. `description` column, create + PATCH, room header/card render, filter by description | **Gap.** `ChatRoom` and `CreateChatRoomRequestBody` do not include `description`; room preview still cannot prefer it | **Partial pass.** `shared/api-types.ts` includes `description`; room list prefers description. Create/edit not confirmed | **Gap / older model.** Session/task descriptions exist, not vNext chat-room description | Mac needs wire model + render + create/PATCH. Windows needs create/edit check. iOS needs product decision before port. |
| Room filters and shortcuts | Shipped on `/rooms`, `/asks`, `/plans`; `/` focus shortcut for rooms/asks, text filters, description-aware room search | **Partial.** Ops/rooms have filter chip patterns, but no verified parity for new `/asks` and `/plans` text filter shape | **Partial.** Rooms page filters by name/summary/member; does not search description despite rendering it | **Partial.** Session/task filters and ask queue exist; ask queue has no text filter | Windows should include description in room filter. Mac/iOS should mirror high-value text filters where their surfaces exist. |
| Plan progress overview | Shipped Main `/plans` overall donut and room-card plan-progress badge | **Partial.** `PlansService` and `PlanProgressSection` exist for active plan progress | **Unclear.** Plan route exists; no verified overall donut/card badge parity | **Partial.** `PlanView` has per-plan progress bar, no global/room-card donut | Keep as lower priority polish unless JWPK is reviewing planning UX across devices. |
| Away mode / room mode semantics | Shipped server-observable `away_modes`, corrected mapping: active + away-desk -> brainstorm; away-office -> heads-down | **Gap.** No `AwayMode` wire/client surface found | **Gap.** No away-mode API model/surface found | **Gap.** Older long-memory/status controls, not away-mode semantics | Needs one shared client contract and simple native controls. This affects agent behaviour, so it outranks visual polish. |
| Room memories | Shipped server endpoint and Main room-memory surface | **Pass.** `RoomMemoriesService` polls `/api/rooms/:roomId/memories`; RoomShelf Memories tab renders content | **Gap / stub.** README says Room memory section is stubbed pending endpoint/wire | **Partial.** Has long-memory and Memory Palace export concepts, not vNext room memories | Windows is the obvious next parity slice. iOS needs model alignment. |
| Reactions on read | Shipped typed reaction/endorsement summary path on Main messages | **Partial pass.** `MessageReactionStrip` render layer and optional `reactions`/`endorsements` fields exist | **Gap.** No message-level summary render found in quick scan | **Partial.** Reaction send/read exists, but not inline summary/endorsement chips | Windows should mirror inline chips. iOS should distinguish raw reaction button from read-time summary. |
| Typed endorsements | Shipped Main endpoint + inline message summaries; replaces ratification spam | **Partial pass.** Native render layer is tolerant and ready when payload exists | **Gap.** No endorsement type/render found | **Gap.** No endorsement primitive found | Windows and iOS need render-only first; mutation affordance can follow. |
| CLI-agent prompt channel + in-room bring-in | Shipped Main web panel, `POST /api/chat-rooms/:roomId/cli-agents`, `GET`, and `POST /api/cli-agents/:handleId/prompt`; Pi parity shipped | **In flight.** Dirty WIP already adds API methods and `CliAgentModels.swift` per @speedyclaude's claim | **Gap.** Type surface and room panel not found | **Gap.** No vNext CLI-agent bring-in surface | Do not duplicate Mac. Windows is the next direct port. iOS should wait until Mac proves the native interaction. |
| Click-to-explain | Shipped Main v0 expansion, seeds, Shift+? shortcut; dirty Main file suggests more Explainable wrapping in progress | **Gap.** No equivalent explainable view modifier found | **Gap.** No equivalent explain map/render found | **Gap.** No equivalent found | Hold until web v0 stabilises. Then implement read-only explain overlays in native clients. |
| Stage presentation, validation, Safari voice | Main has Stage deck auth fixes, Safari audio cue, validation toggle/lens picker/claim numbering | **Gap.** RoomShelf Stage/Validation tabs are still locked/placeholder-style surfaces | **Gap.** No Stage surface found | **Gap.** No Stage surface found | This is the highest product-magic gap, but larger than a quick parity slice. Needs a shared Stage client contract first. |
| SSE/live health state | Main has SSE consumer/backfill/backpressure work and status model | **Partial.** Long-poll mention scanner + room event consumer exists, but not the full `catching-up/caught-up/unreachable` finish-layer | **Partial.** Room activity store exists; no full finish-layer verified | **Partial.** FreshRoomSSEClient exists in dirty antios worktree | Treat as architecture work. Do not paper over with a green dot. |
| Message edit + correction event | User raised premium edit/EAC requirement; not observed as shipped Main capability in this pass | **Not started** | **Not started** | **Not started** | Needs Main contract first: edit event, correction message, audit trail, premium affordance split. |

## Immediate Work Order

1. **Mac CLI-agent bring-in mirror** - already claimed by @speedyclaude. Do not collide.
2. **Windows CLI-agent bring-in mirror** - direct Svelte/Tauri port of Main `RoomCliAgentsPanel`; highest cross-device leverage once Mac is done.
3. **Mac room description mirror** - small but user-visible: add wire model, create/PATCH client methods, room preview preference.
4. **Windows room description edit/create + description-aware filter** - read/render already exists; finish the write path and make search include the field.
5. **Away-mode client contract** - define once, then port Mac + Windows + iOS controls. This drives agent behaviour, not just UI.
6. **Windows memories surface** - endpoint exists; Room Tools memory section is still stubbed.
7. **Stage client contract** - write the thin contract before native work so Mac/Windows/iOS do not each invent a Stage dialect.

## Efficiency Rules Going Forward

- Every Main capability slice should include a sibling-repo check in the closing note: `Mac`, `Windows`, `iOS`, `future Android`, `server variant`.
- If the sibling repo has the same surface, create either a concrete follow-up claim or a documented `DEFER` reason.
- Do not port against memory. Verify the live file first, especially where previous audits are already stale.
- Do not touch an active sibling worktree when its owner has an in-flight dirty slice. Report the gap and let the owner land or hand off.
- Add the capability-ledger row in Main for Main capabilities; sibling repos need their own local docs/release notes where they exist.

## Status For The Room

This matrix closes the immediate "stop idling and find cross-repo work" ask with a concrete map. It also corrects two stale assumptions from the earlier audit:

- Windows already has `ChatRoom.description` read/render.
- Mac CLI-agent bring-in is no longer just a gap; it is actively in flight in @speedyclaude's worktree.
