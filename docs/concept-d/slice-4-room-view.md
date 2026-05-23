# Slice 4 — Room view (header + chat + composer + shelf tab content)

**Status:** spec ready for implementation
**Owners:** @antchatmacdev (build, lead) · @antmacdevcodex (QA) · @antux (UX)
**Room:** `iawcdenlgc`
**Visual contract:** Concept D frame `antOSux.pen` at `x=1520 y=-1122`, room region `DUxR1`
**Reference PNG:** `docs/concept-d/DUxR1.png` @ 2×
**Inheritance:** Slice 1 shell + Slice 2 sidebar + Slice 2.5 invite modal + Slice 3 ops. Replaces the `.redacted` chat skeleton in `RoomColumn.swift` with real chat lifted from `LegacyAppShellView`. **Load-bearing slice — when this lands the new shell becomes usable.**

---

## Architecture (locked across UX + build + QA)

| # | Decision | SwiftUI / file |
|---|---|---|
| 1 | **Lift, don't rewrite — BUT SURGICAL.** | Extract ONLY the chat surface from `LegacyAppShellView` into `Antchat/Views/Chat/` (`ChatStream.swift`, `ChatMessageRow.swift`, `ChatComposer.swift`). **DO NOT bulk-lift the LegacyAppShellView side-panels.** See "DO NOT LIFT" callout below the table — those surfaces are REPLACED by the new RoomShelf tabs, not duplicated into RoomColumn body. JWPK dogfood `msg_wsdvgzkgkb` saw the over-lift result (the OLD panel stack rendered alongside the new shelf). Fix is to delete every legacy-panel reference from RoomColumn body. |
| 2 | **MessagesService.** | New `Antchat/Services/MessagesService.swift` at `AppShellView` root. Long-poll keyed on `currentRoom.id`; 30 s passive refresh fallback. Same `LoadState<T>` shape as Slices 2/3. |
| 3 | **RoomShelf tab content.** | Each of the 8 tabs ships a static content panel in `Antchat/Views/Shell/RoomShelf/`. ★Chair + ★Validation are `PremiumLockedPanel.swift` (shared locked-card placeholder). |
| 4 | **Empty "no room selected".** | Keep the existing fallback in `RoomColumn.swift:65` from Slice 2.5 — when `currentRoom.id` is nil/empty, show "Pick a room" empty state. |
| 5 | **Composer = single-line.** | Send button + paste-text-into-textfield is the hard PASS. Multi-line / paperclip / Continuity Camera / Dictate / router-picker defer to **Slice 4.5** if timing slips. |
| 6 | **Avatar click → focus-mode drawer.** | Lift the existing v0.1.x focus-mode UI; click routes there, no rewrite. (New `Views/Chat/RoomFocusDrawer.swift` if extraction is cleaner than referencing `LegacyAppShellView` directly.) |
| 7 | **"N LIVE" derivation.** | `room.members.filter { $0.lastActiveAt > Date().addingTimeInterval(-300) }.count` (5-min window). Falls back to `room.members.count` if `lastActiveAt` missing. |
| 8 | **Honour ALL v0.1.x message kinds.** | `ChatMessageRow` switches on `Message.kind`: `chat`, `system_break`, `focus_banner`, `agent_status`, `plan_step`, `ask_card`, `deck_slide`. Anything dropped = regression to existing users. |
| 9 | **NO cost meter.** | Per the remoteant chrome cleanup — cost is server-operator concern, stays in `/dashboard`. Do not re-introduce by accident. |
| 10 | **All tokens via `Tokens.*`** | No raw hex in `Views/Chat/` or `Views/Shell/RoomShelf/`. |

---

## DO NOT LIFT — surfaces that stay OUT of RoomColumn body

Per JWPK dogfood `msg_wsdvgzkgkb` (Slice 4 redo guidance). The following v0.1.x `LegacyAppShellView` sub-views/panels **MUST NOT** be lifted into `RoomColumn` body. They are replaced by RoomShelf tabs in the right rail, and rendering them in the middle column produces the dup-panel mess JWPK flagged.

| Legacy surface | Where it goes instead |
|---|---|
| Participants list / member roster panel | RoomColumn header avatar stack + (future) Members RoomShelf tab |
| Focus mode panel | Stays as a popover / drawer triggered by avatar click — NOT inline |
| Open asks panel | RoomShelf "Asks" tab (or merge with existing Interviews tab) |
| Documents panel | RoomShelf "Artefacts" tab |
| Tasks panel | RoomShelf "Plan" tab |
| Artefacts panel (legacy) | RoomShelf "Artefacts" tab (the new one) |
| Screenshots panel | RoomShelf "Attachments" tab |
| Linked rooms panel | RoomShelf "Linked rooms" tab |
| Pinned / workflow side panels | Removed entirely (per JWPK "remove this") |
| Cost / token meter | Stays removed per Slice 1 chrome cleanup |

**Lift checklist for the build:**
1. Open `LegacyAppShellView.swift`. Identify the `ScrollView` or `VStack` that holds the chat messages.
2. Extract ONLY that subtree (and its direct dependencies) into `ChatStream.swift`.
3. Identify the message-input `TextField` + Send button. Extract ONLY those into `ChatComposer.swift`.
4. Identify the per-row rendering switch. Extract ONLY that into `ChatMessageRow.swift`.
5. Every OTHER `View` instantiation in `LegacyAppShellView` — Participants / Focus / Asks / Docs / Tasks / Artefacts panels — gets **deleted** from the RoomColumn composition. If a surface needs to live somewhere, it's in the corresponding RoomShelf tab; if it doesn't have one yet, it's a backlog item, not a RoomColumn child.
6. `RoomColumn.body` end state = `VStack { header; dragDropHint; ChatStream(); ChatComposer() }`. Nothing else.

If the build sees a panel that has nowhere to go, FLAG it in chat rather than bulk-lifting "just to be safe."

---

## Sub-region A — Room header · `RoomColumn.swift` (header section)
**Pencil ref:** node `iuS2k`

**Composition (top to bottom):**
1. **Top row** (HStack, gap 14, alignItems center):
   - Title block (VStack, gap 4):
     - Eyebrow row: `Tokens.accent` dot 8 × 8 + `"ACTIVE ROOM · \(liveCount) LIVE"` 10 pt weight 800 letter-spacing 1.4 fill `Tokens.accent`
     - Title: 24 pt weight 800 fill `Tokens.ink.strong` — bound to `room.name`
   - `Spacer()`
   - Avatar stack (HStack, gap −6, alignItems center): up to 4 × 30 × 30 circles (member colour) with 2 px `Tokens.Surface.raised` stroke; if `members.count > 4` show `+N` chip
   - **Invite** button — `Tokens.Soft.accent` bg + `Tokens.accent` text "Invite" (opens Slice 2.5 invite modal)
   - **Screenshot** button — `Tokens.Surface.card` bg + `Tokens.line.soft` border + `camera` SF Symbol + `"Screenshot"` + `⌘⇧4` keycap (no-op stub for Slice 4; Slice 5 wires ScreenCaptureKit)
   - **Share** button — `square.and.arrow.up` SF Symbol (opens native share sheet)
   - Right-shelf collapse chev — `sidebar.right` SF Symbol (already wired Slice 1)
2. **Drag-drop hint row** (HStack, padding [12, 8], dashed border `Tokens.line.soft` [6, 4]):
   - `file-down` SF Symbol 16 × 16 `Tokens.ink.muted`
   - `"Drag any file from Finder — PDFs, Numbers, Pages, Keynote, screenshots — and the room becomes evidence-aware"` 12 pt `Tokens.ink.soft`
   - Slice 5 wires actual drop targets; Slice 4 ships visual hint only.

**Avatar interaction:** click on avatar → opens existing focus-mode drawer with that member focused. Click on `+N` chip → opens full members list panel (lift from Legacy).

**Tokens:** header bg `Tokens.Surface.raised` `#FFF0DF`, border-bottom `Tokens.line.soft`.

**A11y:** title `.accessibilityAddTraits(.isHeader)`; avatars individual `accessibilityLabel("\(name), \(role)")` + hint `"Opens focus drawer"`; buttons standard labels.

---

## Sub-region B — Chat stream · `Antchat/Views/Chat/`

**Files:**
- `ChatStream.swift` — `ScrollView` + `LazyVStack` of `ChatMessageRow(message:)`, scroll-to-bottom on send + on initial load, scroll-anchor maintained on backfill
- `ChatMessageRow.swift` — switches on `message.kind`:
  | `kind` | Render |
  |---|---|
  | `chat` | Avatar + handle + time + body text + optional model badge + optional cost chip + reactions |
  | `system_break` | Centred horizontal rule + small label `"— BREAK: \(label) —"` |
  | `focus_banner` | Accent-soft band: `"@user entered focus mode"` |
  | `agent_status` | Inline grey pill: `"@agent is thinking…"` with breathing dot |
  | `plan_step` | Card with checkbox + step text + "N of M" |
  | `ask_card` | Card with asker avatar + body + "N agents thinking" footer (same shape as ops-column ask card) |
  | `deck_slide` | Slide preview thumbnail + title + slide number |
- `Message.swift` (model) — `kind: MessageKind` enum + per-kind associated data

**Data flow:**
- `ChatStream` takes `messagesState: LoadState<[Message]>`
- `MessagesService` long-polls `GET /api/chat-rooms/:id/messages?since=:cursor`
- On new message → append + scroll to bottom IF user is already at bottom (preserve scroll position otherwise)

**States:**
| State | Render |
|---|---|
| Loading | 4 `.redacted` chat-row skeletons |
| Loaded, count > 0 | Real messages, all kinds |
| Loaded, count == 0 | Soft prompt: `"This room is quiet. Send the first message."` |
| ErrorWithCache | Stale messages + `Tokens.warn` "Reconnecting…" chip at bottom |
| ErrorNoCache | Ghost row + Retry |

**A11y:** rows announced as they arrive via `.accessibilityLiveRegion(.polite)`; each row has full label including kind ("Chat from @user: …" / "System break: …" etc).

---

## Sub-region C — Composer · `ChatComposer.swift`

**Composition (this slice):**
- `HStack(spacing: 10, alignItems: .center)` — single-line `TextField` with placeholder `"Reply to @\(room.lastSpeaker)…"` + **Break button** (small `—break—` styled chip, `Tokens.ink.muted` text on `Tokens.Surface.card`) + `Send` button (accent bg, white text, paper-plane icon)
- Padding 14, corner radius 12, bg `Tokens.Surface.raised`, border `Tokens.line.soft`
- Send disabled when field empty (`.disabled(text.isEmpty)`)
- ⌘↩ also triggers Send

**Behaviour:**
- On Send → `MessagesService.send(roomId:body:)` → optimistic insert + POST → on failure, mark row with retry affordance
- Field clears on successful send

**Break POST mechanic:**
- Click `—break—` button → opens a small prompt sheet asking for an optional break label (placeholder: `"Slice close · Decision · …"`)
- Submit → `POST /api/chat-rooms/:id/breaks` with `{ label }` → server inserts a `system_break` message; ChatStream renders via existing `MessageKind.system_break` row
- Alternatively, typing `/break <label>` in the TextField + Send is auto-recognised as a break post (same endpoint, label is the text after `/break`)
- Break DELETE is in scope for Slice 4. Server contract:
  `DELETE /api/chat-rooms/:id/breaks/:breakId` soft-deletes the system-break
  row and broadcasts `message_updated`. Do **not** use
  `DELETE /api/chat-rooms/:id/messages/:messageId` for breaks; the normal
  message delete path intentionally refuses `system` / `system-break` rows.
  The row affordance is a small destructive delete action on rendered break
  markers, with a confirmation dialog.

**Deferred to Slice 4.5 (not in scope this slice):**
- Multi-line input
- Paperclip / file attach
- Continuity Camera button
- Dictate button
- Router-picker (model selector)

**A11y:** TextField `accessibilityLabel("Message to \(room.name)")`; Send button label `"Send message"`.

---

## Sub-region D — RoomShelf tab content · `Antchat/Views/Shell/RoomShelf/`

Slice 1 ships the 8-tab strip; Slice 4 fills each tab's content panel.

| Tab | File | Slice 4 content |
|---|---|---|
| Artefacts (default active) | `ArtefactsPanel.swift` | Lift v0.1.x artefacts list from Legacy — deck/sheet/doc cards with Quick Look + Open in App + Show in Finder buttons (already implemented per Concept D, just reuse) |
| Plan | `PlanPanel.swift` | List plan steps for `currentRoom.id` via `GET /api/chat-rooms/:id/plans` — show step list with done/in-progress/pending state + progress bar |
| Interviews | `InterviewsPanel.swift` | List interviews via `GET /api/chat-rooms/:id/interviews` — minimal row with subject + responder + timestamp |
| Memories | `MemoriesPanel.swift` | List banked memory references via `GET /api/chat-rooms/:id/memories` — row with memory title + scope + timestamp |
| Attachments | `AttachmentsPanel.swift` | List files dropped into room via `GET /api/chat-rooms/:id/attachments` — row with filename + size + Quick Look button |
| ★ Chair | `PremiumLockedPanel.swift` (shared) | Locked card: `Tokens.warn` icon + `"Chair tracks long-running sessions — premium feature"` + `Tokens.warn` CTA `"Unlock with Pro"` (no-op in Slice 4; Slice 6 wires) |
| ★ Validation `(84%)` | `PremiumLockedPanel.swift` (shared) | Locked card with score badge: `"Validation runs claim extraction + scoring — premium feature"` |
| Linked rooms `(3)` | `LinkedRoomsPanel.swift` | List linked rooms via `GET /api/chat-rooms/:id/links` — row with room name + relation type + last activity |

**Each panel takes `currentRoomId: String?` and renders empty state if nil.**

**Shared loading/empty/error pattern:** same `LoadState<T>` matrix as Slice 3 sections.

**Tokens:** all panel backgrounds `Tokens.Surface.card`, borders `Tokens.line.soft`. PremiumLockedPanel uses `Tokens.warn-soft` bg + `Tokens.warn` accents.

---

## PASS gate (proposed — pending @antmacdevcodex Q5 final wording)

| # | Criterion | Met by |
|---|---|---|
| 1 | RoomColumn skeleton replaced — header + chat + composer + shelf-content all live | `RoomColumn.swift` composes Header + ChatStream + ChatComposer + RoomShelf (existing) wired to panel content |
| 2 | MessagesService follows ChatRoomsService LoadState semantics | code review against Slice 2/3 services |
| 3 | All 7 message kinds (chat / system_break / focus_banner / agent_status / plan_step / ask_card / deck_slide) render via ChatMessageRow | `#Preview` for each kind |
| 4 | Avatar stack shows real members; click opens focus-mode drawer | manual VO test + focus drawer opens |
| 5 | Composer single-line Send works; ⌘↩ triggers Send | manual: type → ⌘↩ → message appears |
| 6 | Empty room (currentRoom.id nil) renders existing "Pick a room" fallback | manual: clear currentRoom.id → fallback visible |
| 7 | All 8 RoomShelf tab panels render their data — Artefacts default active; ★Chair + ★Validation locked-with-warn | manual sweep through tabs |
| 8 | All tokens via `Tokens.*` — no raw hex in `Views/Chat/` or `Views/Shell/RoomShelf/` | grep audit |
| 9 | VoiceOver labels on every interactive element; chat-row arrival announced `.polite` | VO sweep |
| **10** | **CHAT FUNCTIONAL CORRECTNESS:** send a message → it appears in stream → persists in DB → survives app relaunch + re-fetches | manual: send "hello" → quit → relaunch → "hello" still in stream |
| 11 | `xcodebuild` green + screenshot evidence per Slice 1.5 caveat policy | CI + `docs/concept-d/slice-4-screenshots/` |

---

## File map

**New files:**
- `antchat/Antchat/Views/Chat/ChatStream.swift`
- `antchat/Antchat/Views/Chat/ChatMessageRow.swift`
- `antchat/Antchat/Views/Chat/ChatComposer.swift`
- `antchat/Antchat/Views/Chat/RoomFocusDrawer.swift` (if cleaner than referencing Legacy)
- `antchat/Antchat/Services/MessagesService.swift`
- `antchat/Antchat/Models/Message.swift` (+ `MessageKind` enum)
- `antchat/Antchat/Views/Shell/RoomShelf/ArtefactsPanel.swift`
- `antchat/Antchat/Views/Shell/RoomShelf/PlanPanel.swift`
- `antchat/Antchat/Views/Shell/RoomShelf/InterviewsPanel.swift`
- `antchat/Antchat/Views/Shell/RoomShelf/MemoriesPanel.swift`
- `antchat/Antchat/Views/Shell/RoomShelf/AttachmentsPanel.swift`
- `antchat/Antchat/Views/Shell/RoomShelf/LinkedRoomsPanel.swift`
- `antchat/Antchat/Views/Shell/RoomShelf/PremiumLockedPanel.swift`

**Modified files:**
- `antchat/Antchat/Views/Shell/RoomColumn.swift` — wire real header + ChatStream + ChatComposer; remove skeleton placeholders
- `antchat/Antchat/Views/Shell/RoomShelf.swift` — switch tab content area on selected tab to render the appropriate Panel file
- `antchat/Antchat/Views/Shell/AppShellView.swift` — instantiate `MessagesService()` + pass `messagesState` to RoomColumn

---

## Tokens used (all from `Tokens.swift`)

| Token | Used by |
|---|---|
| `Tokens.Surface.app` | (no new use) |
| `Tokens.Surface.card` | message-row backgrounds, all shelf panels |
| `Tokens.Surface.raised` | room header, composer |
| `Tokens.ink.strong` | room title, chat body |
| `Tokens.ink.soft` | secondary text, drag-drop hint body |
| `Tokens.ink.muted` | meta text (time, count, sub-labels) |
| `Tokens.line.soft` | card borders, dividers, dashed drag-drop border |
| `Tokens.accent` | ACTIVE ROOM eyebrow + dot, Invite CTA text, Send button bg |
| `Tokens.Soft.accent` | Invite CTA bg, ask-open chip bg |
| `Tokens.warn` | Premium locked panel accents, reconnecting chip |
| `Tokens.Soft.warn` | Premium locked panel bg |
| `Tokens.ok` | recent activity dots |

---

## Hand-off

@antchatmacdev — you're driving. Lift chat from `LegacyAppShellView` first (ChatStream + ChatMessageRow + ChatComposer + Message model + MessagesService), then RoomColumn composition, then RoomShelf panels (Artefacts first since it's default active). The lift work is mechanical; the only delicate bits are:
- Preserving FINDING-3 self-post behaviour
- Preserving the existing focus-mode drawer integration
- Per-kind ChatMessageRow rendering — needs all 7 kinds in #Preview

@antmacdevcodex — confirm or amend Q5 / PASS gate row 10. Chat-functional-correctness gate is the new pattern this slice.

## Open items
None awaiting UX. Q5 awaiting @antmacdevcodex final wording.
