# Room view (mobile) — redesign spec

**Status:** spec ready for implementation
**Owners:** @antchatmacdev (build) · @antmacdevcodex (QC) · @antux (UX)
**Plan / task:** `antios-make-it-functional-2026-05-26` task T5 (the 8 walkthrough fixes) + the rolled-in mobile RoomShelf design
**Trigger:** JWPK FlowDeck walkthrough 2026-05-26 (`msg_jr4okt38b5`) — 8 concrete findings on the current Room view + `msg_v2gpqd82hn` confirmed the Settings-shelf parallel
**Outcome:** Room view that reads as "Mac remoteant-parity, sized for mobile" — progress + context above the fold, real composer tools, threads + filtering work, More button reveals desktop-style room utilities.

---

## What's wrong with the current view (from walkthrough)

The eight findings JWPK delivered in one breath (`msg_jr4okt38b5`):

1. **Y/N quick-reply shortcuts** at the bottom are nonsensical chrome
2. Attachment + table affordances are good to keep, but verify they actually work
3. **Message composer is single-line** — must expand as user types
4. **Reply + React buttons are too small** vs Mac remoteant equivalents
5. **Threads + filtering must work end-to-end** — not just rendered
6. **Infinity (∞) symbol is too prominent** — it's a minor/advanced feature, must not dominate
7. **More button currently does Share room** — wrong. Should reveal desktop-style room utilities (participants / artefacts / screenshots / search / filter / settings)
8. **"This is quite off as well"** — the whole register is wrong, needs reset

Pattern: **the room view was scaffolded transcript-first, but mobile rooms need progress/context-first.** The chat is the back-half, not the front-door. JWPK is looking for a "what's going on here" surface that opens the room as an oriented user.

---

## The new layout (above the fold)

```
╭─────────────────────────────────────╮
│   [< Back]  Room name      [More]   │  ← Room header — sticky
│                                     │
│   3 active · last 14m               │  ← Status line — small, ink-soft
│                                     │
│   ┌─────────────────────────┐       │  ← Progress card — sticky if
│   │ Plan: NMVC monthly      │       │     room has a linked plan;
│   │ 4/7 steps · @kimi → @you│       │     hidden if no plan
│   └─────────────────────────┘       │
│                                     │
│   ┌─────────────────────────┐       │  ← Open asks for this room
│   │ ⚠ 2 asks need you here │       │     accent border if > 0
│   └─────────────────────────┘       │
│                                     │
├─────────────────────────────────────┤
│                                     │
│   ▼ Transcript                      │  ← Section divider; tap to
│                                     │     collapse the chat
│   [chat messages here]              │
│                                     │
│   ↕ Filter chips:                   │  ← Persistent filter chips
│   [Decisions] [Asks] [Files]        │     above the composer
│   [@me] [Unread] ⏰ [Today]         │
│                                     │
├─────────────────────────────────────┤
│   ┌─────────────────────────┐       │  ← Composer
│   │ Type a message...       │       │     expanding TextEditor,
│   │ [growing as user types] │       │     ~6 lines max before scroll
│   └─────────────────────────┘       │
│   📎 📊 [Reply ↺] [React 😀] [Send] │  ← Composer toolbar
╰─────────────────────────────────────╯
```

---

## Header (sticky)

| Element | Spec |
|---|---|
| **Back chevron** | `chevron.left` SF Symbol, 17pt, accent. Tap → spin-back to ANT Cards (matched-geometry reverse of the spin-into-room) |
| **Room name** | 17pt weight 700 ink-strong, truncates with ellipsis if long, tap to enter rename mode |
| **More button** | `ellipsis.circle` SF Symbol, 17pt accent. Tap → **Mobile RoomShelf bottom sheet** (see below) |
| **Status line** | 13pt ink-soft, format: `"N active · last Nm/Nh/Nd"`. Updates live from member presence + last message |

---

## Progress card (sticky if relevant)

Renders only if `room.plan_id` is set (Main team coordination ask from earlier specs):

| Field | Spec |
|---|---|
| Plan title | 14pt weight 600 ink-strong, truncates ellipsis |
| Progress | "X of Y steps" — accent for completed count, ink-muted for total |
| Next-up | `→ @assignee` — who owns the next step |
| Tap | Opens Plans tab scoped to this plan (deep-link) |

If no plan → no card rendered, transcript starts higher.

---

## Open asks banner

If `asksForThisRoom.filter { $0.targetHandle == currentUser }.count > 0`:

```
┌─────────────────────────────────────┐
│ ⚠ 2 asks need you here              │
└─────────────────────────────────────┘
```

- Accent-coloured border (`Tokens.accent` 1.5pt) — pulls eye
- Tap → opens the asks scoped to this room as a sheet
- Auto-hides when count == 0

---

## Transcript section

| Element | Spec |
|---|---|
| **Section divider** | "▼ Transcript" 13pt ink-muted, tap to collapse — saves vertical space when user wants progress-only view |
| **Messages** | Standard chat bubbles, lifted from existing implementation |
| **Threads** | Tap a message → reply-in-thread opens as a side sheet (`.medium` detent). Thread reply replies-to the parent. Closing the sheet returns to room with the thread chip visible on the parent message. |
| **Filter chips** | Persistent above composer. Multi-select. Tap each to toggle. Filters: **Decisions** (decision-class messages), **Asks** (`ask_card` kind), **Files** (`system_artefact_added` + `compliance_step`), **@me** (mentions), **Unread**, **⏰ Today** (date filter). |

**Filter behaviour:** active filters compose — `@me + Unread` shows unread mentions only. Empty result → "No messages match these filters" empty state with a "Clear filters" button.

---

## Composer

| Element | Spec |
|---|---|
| **TextEditor** | Multi-line, auto-expands 1 → 6 lines, scrolls when content exceeds 6 lines. `Tokens.Surface.card` bg, `Tokens.line.soft` border, padding 12, corner radius 14. |
| **Placeholder** | "Type a message…" — ink-muted, italic |
| **Attachment** | 📎 `paperclip` SF Symbol, 22pt accent. Tap → action sheet (Files / Photos / Camera / Files.app) — verify wired end-to-end |
| **Table** | 📊 `tablecells` SF Symbol, 22pt accent. Tap → opens inline table-cell composer (per the Stage spec's table primitive). Verify wired or stub for v0.2.5. |
| **Reply** | "Reply" chip, 14pt weight 600, accent text on accent-soft bg, padding [12,7], corner radius 8. Appears only when a message is selected (long-press). **Bumped from current size to match Mac remoteant Reply button dimensions.** |
| **React** | "React 😀" chip, same sizing as Reply. Long-press a message → emoji picker. |
| **Send** | `arrow.up.circle.fill` SF Symbol, 28pt accent. Disabled when TextEditor empty. ⌘↩ on iPad also sends. |

---

## NOT in this view (banked)

| Removed item | Why |
|---|---|
| Y/N quick-reply shortcuts | Nonsensical chrome (JWPK finding #1) — delete entirely |
| Infinity (∞) symbol prominent placement | Demote to overflow menu inside More — it's a minor/advanced feature (Stage/Loop/Continuous mode — confirm with @antchatmacdev which feature this gates) |
| "Share room" as top-level More target | Replaced by Mobile RoomShelf (see below) |

---

## Mobile RoomShelf — the More button bottom sheet

Triggered by tap on the `ellipsis.circle` More button in the room header. Opens as `.sheet` with `.medium` and `.large` detents.

### Layout

```
╭─────────────────────────────────────╮
│  ━━ (grabber)                       │
│                                     │
│  Room utilities                     │  ← Heading, 17pt weight 700
│                                     │
│  ┌───────────────────────────────┐  │
│  │ 👥 Participants         ▶     │  │  ← Row, 50pt tall, tap to enter
│  ├───────────────────────────────┤  │
│  │ 📄 Artefacts (12)       ▶     │  │
│  ├───────────────────────────────┤  │
│  │ 📊 Plan                 ▶     │  │
│  ├───────────────────────────────┤  │
│  │ 🎤 Interviews (3)       ▶     │  │
│  ├───────────────────────────────┤  │
│  │ 🧠 Memories             ▶     │  │
│  ├───────────────────────────────┤  │
│  │ 📎 Attachments (8)      ▶     │  │
│  ├───────────────────────────────┤  │
│  │ 📸 Screenshots          ▶     │  │
│  ├───────────────────────────────┤  │
│  │ 🔍 Search & filter      ▶     │  │
│  ├───────────────────────────────┤  │
│  │ 🔗 Linked rooms (3)     ▶     │  │
│  ├───────────────────────────────┤  │
│  │ ★ Chair      premium    ▶     │  │  ← warn-soft bg
│  ├───────────────────────────────┤  │
│  │ ★ Validation premium    ▶     │  │  ← warn-soft bg
│  ├───────────────────────────────┤  │
│  │ ⚙ Room settings         ▶     │  │
│  ├───────────────────────────────┤  │
│  │ ∞ Loop mode             ▶     │  │  ← The infinity feature,
│  └───────────────────────────────┘  │     demoted to here
│                                     │
│  Share room                         │  ← Old top-level action,
│                                     │     now a small grey link
╰─────────────────────────────────────╯
```

### Per-row behaviour

| Row | Counts | Detail |
|---|---|---|
| Participants | `members.count` | Tap → full member list with status dot + per-member focus link |
| Artefacts | `room.artefacts.count` | Tap → grid of artefacts with Quick Look |
| Plan | — | Tap → opens Plans tab scoped to this room's plan (same target as Progress card) |
| Interviews | `room.interviews.count` | Tap → list of interviews + transcripts |
| Memories | — | Tap → memory references for this room (per Slice 2 Memory tab) |
| Attachments | `room.attachments.count` | Tap → file list, drag-drop receiver, Quick Look |
| Screenshots | — | Tap → screenshot history (taken in-room with ⌘⇧4 / iOS native share) |
| Search & filter | — | Tap → full-screen search for this room's message stream |
| Linked rooms | `room.links.count` | Tap → linked rooms list |
| ★ Chair | premium | Tap → if premium: Chair-in-this-room panel. If not: upgrade upsell |
| ★ Validation | premium | Same shape — tap → validation runs + scores, or upgrade |
| Room settings | — | Rename / archive / notification rules / member admin |
| Loop mode | — | The "infinity" feature — continuous voice / always-on mode / whatever the existing ∞ feature does (@antchatmacdev to confirm) |
| Share room | — | Old top-level action, demoted to bottom small link |

### Tokens

- Sheet bg: `Tokens.Surface.app`
- Rows: `Tokens.Surface.card` bg, `Tokens.line.soft` divider
- Premium rows (Chair, Validation): `Tokens.Soft.warn` (`#FFF2C7`) bg
- Counts: `Tokens.accent` if > 0, hidden if 0

---

## States (room view + shelf)

| State | What renders |
|---|---|
| Room - idle (loaded) | Full layout above |
| Room - loading | Skeleton header + skeleton progress + skeleton 4 messages |
| Room - empty (no messages) | "This room is quiet. Start the conversation." prompt + composer |
| Room - error | "Could not load room" + Retry button |
| Shelf - opening | `.medium` detent with rows animated in from top, staggered |
| Shelf - searching | Search & filter row tapped → keyboard up + filter chips appear |
| Shelf - premium-locked | Premium row tapped → upgrade sheet |

---

## PASS gate (for @antmacdevcodex)

1. Y/N quick-reply shortcuts removed
2. Attachment + Table buttons present + tap fires real flows (or graceful stub if unimplemented)
3. Composer expands 1 → 6 lines as user types, scrolls past
4. Reply + React chips sized to match Mac remoteant spec (~14pt weight 600, padding [12,7])
5. Tapping a message opens thread reply as `.medium` detent sheet
6. Filter chips multi-select + compose; "No messages match" empty state works
7. Infinity (∞) symbol moved out of room header into Mobile RoomShelf's Loop mode row
8. More button (`ellipsis.circle`) opens Mobile RoomShelf — NOT Share room
9. Mobile RoomShelf has all 14 rows above with correct icons + counts (where applicable)
10. Premium rows (Chair, Validation) styled with `Tokens.Soft.warn` background
11. VoiceOver labels on every interactive element, focus order header → progress → asks → transcript → filters → composer → toolbar
12. Build green + CanvasGrid captures land for Room-Chat (5 states) + Room-Shelf (3 states minimum)

---

## Implementation tools

```swift
// Header sticky
.safeAreaInset(edge: .top) { RoomHeader(...) }

// Composer expanding
TextEditor(text: $draft)
    .frame(minHeight: 44, maxHeight: 144)  // 1 line to 6 lines
    .scrollContentBackground(.hidden)
    .background(Tokens.Surface.card)

// Filter chips
ScrollView(.horizontal, showsIndicators: false) {
    HStack(spacing: 8) {
        ForEach(filters) { FilterChip(filter: $0, selected: $selected) }
    }
}

// Shelf sheet
.sheet(isPresented: $showingShelf) {
    MobileRoomShelf(room: currentRoom)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
}

// Thread reply
.sheet(isPresented: $threadSheetShowing) {
    ThreadReplyView(parent: selectedMessage)
        .presentationDetents([.medium, .large])
}
```

---

## Hand-off

@antchatmacdev — build against the layout + tokens above. Composer-expand + filter-chip-row are the trickiest pieces; threads + Mobile RoomShelf are largely composition of existing primitives. Wrap each new view as `CanvasGrid("Room-Chat-Filtered") { ... }` etc per the IA spec naming.

@antmacdevcodex — 12-item PASS gate. The Y/N removal + infinity demotion + More-button shelf are the JWPK-visible fixes that gate next TestFlight signoff.

@codexuxant — Mobile RoomShelf is folded into this spec (rolling my T9 into T5). Loop-mode infinity-feature row needs @antchatmacdev confirmation on what the existing ∞ symbol gates.

## Open clarifications

- **What does the ∞ symbol currently DO?** Loop mode? Stage entry? Continuous voice? Need @antchatmacdev to confirm so the Mobile RoomShelf Loop mode row links to the correct existing feature.
- **Table affordance scope** — is the 📊 button a literal data-table inline composer (Stage's table primitive) or a "table of contents" jump-list? Default to the data-table interpretation; flag if wrong.
