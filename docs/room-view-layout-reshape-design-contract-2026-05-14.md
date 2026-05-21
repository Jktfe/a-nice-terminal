# Room view layout reshape (D1.6) — design contract

Date: 2026-05-14
Author: @researchant (impl follows immediately under locked acceptance)
Status: DESIGN-FIRST. Coordinator-pre-ratified per JWPK D1.6 dogfood batch.
Cap: ≤180L. Reshapes /rooms/[roomId] to put context above the message stream.

## TL;DR

JWPK D1.6 verbatim 6 asks (via coordinator):
1. Collapsible room-name (header collapsibility)
2. Composer-toolbar consolidation
3. Participants ABOVE chat (collapsible)
4. Asks ABOVE chat (collapsible)
5. Memory-recall placement
6. Invite-agent fold (collapsed by default)

Today layout is strictly top-to-bottom: header → composer → timeline →
attachments → uploads → participants → asks → memory → invite. Reshape:
context (Participants + Asks + Memory + Invite + Attachments) lives in a
collapsible TOP STRIP above the chat stream; chat (MessageList +
ChatComposer) gets the dominant body slot. Each context section is a
`<details>` HTML element — natively collapsible, zero extra JS.

## Q1 — Collapsibility mechanism

Native `<details><summary>` per section. v1: open/closed state lives in
the URL hash (`#participants` etc) so deep-links open the right section
+ no localStorage write surface. Per-section default-state per Q3.

**Default proposal**: `<details>` wrapper component (CollapsibleSection)
encapsulates the styling + summary chevron icon. v1 NO state-persistence
across reload (matches HTML spec; user reopens what they need).

## Q2 — Section ordering (top-to-bottom in new layout)

1. Room-name header (collapsible — JWPK ask #1) — open default.
2. Participants (collapsible — ask #3) — closed default (members count visible in summary).
3. Asks (collapsible — ask #4) — open default IF asks pending, else closed.
4. Memory (collapsible — ask #5) — closed default (launcher button only).
5. Attachments + Upload (collapsible) — closed default.
6. Invite agent (collapsible — ask #6) — closed default.
7. Message list (NOT collapsible — primary body).
8. Chat composer (NOT collapsible — primary action).
9. Agent timeline (conditional, NOT collapsible).

Rationale: user-action sections fold; reading + writing sections stay open.

## Q3 — Default open/closed per section (v1)

| Section | Default | Why |
|---|---|---|
| Room-name header | Open | Always visible context |
| Participants | Closed | JWPK ask #3 implies hidden by default |
| Asks | Open if any open, else Closed | JWPK noted Open asks need surface |
| Memory | Closed | Launcher button compact |
| Attachments + Upload | Closed | Rare-action |
| Invite agent | Closed | Ask #6 explicit fold |

## Q4 — Composer-toolbar consolidation (ask #2)

Defer composer-toolbar consolidation to a follow-up slice. Today the
composer footer hint string + Send button live in ChatComposer.svelte
itself. Consolidating a toolbar implies surfacing /break + attach +
mention into a single row — that's a ChatComposer internal refactor,
not a room-page reshape concern. Out of scope for D1.6-T1; tracked as
D1.6-T2 (DEFERRED).

## Q5 — URL-hash deep-link

Each `<details>` gets `id="participants"` etc. Page mount reads
`location.hash` and forces matching `<details>` open. Same pattern as
Settings home tabs. Lightweight; no state library.

## Touch points

- NEW src/lib/components/CollapsibleSection.svelte ≤80L: details/summary
  wrapper with chevron + title + count + open prop + body slot.
- EDIT src/routes/rooms/[roomId]/+page.svelte ≤260L: reshape layout per
  Q2 ordering. Wrap each context section in CollapsibleSection. Keep
  MessageList + ChatComposer + AgentTimeline in body unchanged.
- NO new server routes.
- NO change to ParticipantsPanel/InviteAgentForm/etc internals.

## Locked acceptance

- All 9 sections render in new top-to-bottom order per Q2.
- 6 context sections are collapsible via `<details>`; defaults per Q3.
- URL hash deep-link opens the matching section.
- MessageList + ChatComposer remain primary body (not collapsed).
- D1.6-T2 composer-toolbar consolidation explicitly deferred.
- svelte-check passes 0 errors 0 warnings.
- Plan event `room-view-layout-reshape-d1-6-t1` status=done after canonical PASS.

## Do-not-use

| Rejected | Why |
|---|---|
| Custom React-style accordion | `<details>` is native + zero JS. |
| localStorage open-state persistence | URL-hash deep-link is enough v1. |
| Side-pane two-column layout | Bigger reshape; mobile-hostile; defer. |
| Bundle composer-toolbar refactor | Cross-cutting ChatComposer change; needs own contract. |
| Auto-collapse Asks section when 0 open | Per Q3 already closed when 0 open. |

## Open questions for JWPK

1. Open-state persistence across reload (localStorage)? Default: no v1.
2. Asks section default-open when N>0 vs always-closed? Default: open-when-N>0.
3. Side-pane two-column layout for desktop? Default: defer (mobile parity).

## What I did NOT verify

- Did NOT measure render-cost of `<details>` content trees being eagerly mounted.
- Did NOT confirm InteractiveAsksPanel renders sensibly in collapsed state.
- Did NOT prototype URL-hash auto-open on cross-section navigation.

## D1.6-T1b reshape (delta-1, supersedes T1 stacked layout per JWPK D2.7)

JWPK screenshot annotation 2026-05-14: vertical space is wasted by 6
stacked CollapsibleSection nodes above chat. Reshape:

- ONE `RoomMenuDropdown` on the room-name card — replaces the 6
  stacked sections.
- Edit-name CTA INLINE next to the room-name h1 (replaces the
  "Room name" CollapsibleSection wrapper entirely).
- Dropdown content holds: Participants (with nested Invite at the
  end of the participants list), Open asks, Room memory, Attachments.
- Drop the SimplePageShell eyebrow + summary block on the room view —
  the page-title duplicates the room-name card per screenshot.
- Chat (MessageList + ChatComposer) gets full vertical real-estate.

T1b touch points:
- NEW src/lib/components/RoomMenuDropdown.svelte ≤120L: native
  `<details><summary>` with menu items via slots; menu items collapse
  individually inside.
- NEW src/lib/components/RoomNameHeader.svelte ≤80L: room-name h1 +
  inline RenameRoomHeaderForm trigger + RoomMenuDropdown slot.
- EDIT src/routes/rooms/[roomId]/+page.svelte: replace
  SimplePageShell eyebrow/title with RoomNameHeader; remove the 6
  individual CollapsibleSection wrappers; nest the per-section bodies
  inside RoomMenuDropdown menu items. Invite section becomes a child
  of the Participants menu item (Q-NEW: nested-dropdown behaviour).

T1b acceptance:
- Page renders with single room-name card at top + chat dominant body.
- Edit-name pencil opens inline rename UI.
- Dropdown chevron opens menu; each menu item expands its body.
- Invite agent UI lives nested inside Participants menu item (per JWPK
  D2.7 ask #4 — Invites should be a NESTED dropdown INSIDE Participants).
- focusInviteForm path still works (called from ParticipantsPanel
  +Invite CTA → opens Participants menu item + scrolls to nested invite).
- svelte-check passes 0 errors 0 warnings.

T1b do-not-use:
- Bring back the 6-section stacked layout — JWPK explicitly rejected.
- Standalone Invite top-level menu item — must be NESTED in Participants.
- Custom JS for dropdown (use native `<details>` per banked Q1).

## Next step

D1.6-T1b implementation proceeds claim-first under THIS doc delta-1
Locked Acceptance.
