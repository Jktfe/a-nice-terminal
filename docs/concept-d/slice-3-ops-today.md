# Slice 3 — Ops column Today content (ASKS NEEDING YOU · ROOMS · PLAN PROGRESS)

**Status:** spec ready for implementation
**Owners:** @antchatmacdev (build) · @antmacdevcodex (QA) · @antux (UX)
**Room:** `iawcdenlgc`
**Visual contract:** Concept D frame `antOSux.pen` at `x=1520 y=-1122`, ops region `k4Juf` (340 w)
**Reference PNG:** `docs/concept-d/k4Juf.png` @ 2×
**Inheritance:** Slice 1 shell (`824b33d`) + Slice 2 sidebar (`9d8799d`). Replaces the `.redacted` skeletons in `OpsColumn.swift`. Reuses `RoomSummary` model + `ChatRoomsService` state-machine shape.

---

## Architecture (locked across UX + build + QA)

| # | Decision | SwiftUI primitive / file |
|---|---|---|
| 1 | New services | `Antchat/Services/AsksService.swift` + `Antchat/Services/PlansService.swift`. Mirror `ChatRoomsService` exactly: `nil` = no fetch yet, `Loaded`, `ErrorWithCache`, `ErrorNoCache`, `Loading`. 30 s refresh on appear + foregrounding. |
| 2 | OpsColumn props | `asksState`, `roomsState`, `plansState` — each `LoadState<T>`. `AppShellView` owns the three services and passes states down. Same prop pattern as `SidebarColumn` in Slice 2. |
| 3 | Today header filter chip | Visible but `.disabled(true)` + `.help("Filtering arrives in a later slice")`. Selected style frozen at "All". No filter logic in Slice 3. |
| 4 | Card click contract | ASK card → write `@AppStorage("currentRoom.id") = ask.roomId`. ROOM card → write `currentRoom.id = room.id`. PLAN row → no-op + `.help("Plan detail surface arrives in a later slice")`. Plans visually non-clickable: default cursor, no hover state, no `.onTapGesture`. |
| 5 | Time format | Compact for ops density (matches Concept D). New helper `String.relativeShort(from: Date)` in `Antchat/Extensions/String+Relative.swift`: `now` / `Nm` / `Nh` / `Nd` / `MMM d`. Sibling helper `String.relativeVerbose(from:)` reserved for Slice 4 chat headers — same file, distinct callers. |
| 6 | Warm threshold | Reuse `RoomSummary.isLive` from Slice 2 (24h). No new constant. ROOMS section filter: `chatRoomsService.rooms.values.filter(\.isLive).sorted(by: \.lastActiveAt, .desc)`. |
| 7 | Counts agreement | `OpsColumn.ASKS` section count **MUST** equal `SourcesNav.Asks` chip count — both bind to `asksService.asks?.count`. Same for `OpsColumn.ROOMS` count and `SourcesNav.Rooms` chip count (warm-filtered). Single source of truth per data type, no duplicate filtering. |
| 8 | New models | `Antchat/Models/Ask.swift` (`id, body, askerHandle, askerAvatarColor, roomId, roomName, createdAt, thinkingAgents: [AgentMini]`). `Antchat/Models/PlanSummary.swift` (`id, name, stepsDone, stepsTotal, status, roomId?`). `Antchat/Models/AgentMini.swift` (`handle, avatarColor`). |
| 9 | Empty / loading / error | All three sections follow the Slice 2 state matrix. Soft-prompt cards for empty; `.redacted` skeletons for loading; small `Tokens.warn` chip + retry on `ErrorNoCache`; stale data + reconnecting chip on `ErrorWithCache`. |

---

## Sub-region A — ASKS NEEDING YOU · `AsksList.swift`

**Section header:**
- Left cluster: `tray` SF Symbol (12 × 12, `Tokens.accent`) + `"ASKS NEEDING YOU"` 11 pt weight 800 letter-spacing 1.2 fill `Tokens.accent`
- Right: count text `"N"` 11 pt weight 700 `Tokens.accent` (hidden when count == 0)
- Padding: `[0, 16]` (vertical, horizontal)

**Ask card composition:**
```
┌─────────────────────────────────────────────┐
│ ●avatar  @handle · roomName   spacer   14m │  ← top row: 8 gap, alignItems center
│                                              │
│ Ask body, up to 2 lines, line-height 1.4    │  ← body: textGrowth fixed-width fill_container
│ truncated with ellipsis at 2 lines          │
│                                              │
│ 👥 N agents thinking · @h1 @h2 @h3          │  ← footer: 6 gap, ink-muted
└─────────────────────────────────────────────┘
```

Per-card layout:
- Wrapper: `VStack(alignment: .leading, spacing: 8) { ... }`, padding 14, corner radius 10
- Background `Tokens.Surface.card` (`#FFFFFF`), border 1 px `Tokens.Soft.accent` weakened (`#FCE5DD`)
- Top row: `HStack(spacing: 8, alignment: .center)` — avatar circle 22 × 22 (asker's color), `@handle` 12 pt weight 600, `·` 12 pt `Tokens.ink.muted`, room name 11 pt `Tokens.ink.muted`, `Spacer()`, time `String.relativeShort(from: createdAt)` 11 pt `Tokens.ink.muted`
- Body: `Text(ask.body)` 13 pt weight 500 `Tokens.ink.strong`, `lineLimit(2)` + `.truncationMode(.tail)`, line-height 1.4
- Footer: `HStack(spacing: 6, alignItems: .center)` — `users` SF Symbol 12 × 12 `Tokens.ink.muted`, `"N agents thinking · @h1 @h2 @h3"` 11 pt `Tokens.ink.muted`

**Interaction:**
- Click card body anywhere → `@AppStorage("currentRoom.id") = ask.roomId` (writes; Slice 4 RoomColumn picks up + can scroll to the ask)
- Hover: card scales 1.0 → 1.005, shadow `0 2 6 rgba(0,0,0,0.06)`
- Pressed: 0.98 scale + accent-soft background tint

**States:**
| State | Render |
|---|---|
| Loading (no cache) | 2 skeleton cards `.redacted(reason: .placeholder)` with realistic body lengths |
| Loaded, count > 0 | Real ask cards, max 5 visible — overflow shows `View all asks →` link to SOURCES.Asks |
| Loaded, count == 0 | Soft prompt: `tray` icon 16 × 16 `Tokens.ok` + caption `"No asks need you right now"` |
| ErrorWithCache | Real cards from last-known + small `Tokens.warn` chip top of section `"Reconnecting…"` + tiny spinner |
| ErrorNoCache | Ghost card `"Couldn't load asks"` + `Retry` button |

**A11y:**
- Card: button role + `accessibilityLabel("Ask from \(handle) in \(roomName), \(timeAgo): \(body)")` + hint `"Opens \(roomName)"`
- Section header: `.accessibilityAddTraits(.isHeader)`
- Count text: announced via section header label (`"Asks needing you, \(count)"`)

---

## Sub-region B — ROOMS (warm) · `RoomsList.swift`

**Section header:**
- Left: `bubble.left.and.bubble.right` SF Symbol (12 × 12, `Tokens.ink.muted`) + `"ROOMS"` 11 pt weight 800 letter-spacing 1.2 fill `Tokens.ink.soft`
- Right: `"N warm"` 11 pt weight 600 `Tokens.ok` (hidden when 0)

**Room card composition:**
```
┌─────────────────────────────────────────────┐
│ ● Room name                          now    │  ← title row: 8 gap, dot tinted per status
│ @h: last message preview, single line trunc │  ← preview: 12 pt ink-soft
│ @h1 @h2 @h3 · 1 ask open                    │  ← footer: 11 pt ink-muted + ask chip
└─────────────────────────────────────────────┘
```

Per-card layout:
- `VStack(spacing: 6) { ... }`, padding 12, corner radius 10
- Background: `Tokens.Surface.card`, border 1 px `Tokens.line.soft`
- **Active room highlight** (`room.id == currentRoom.id`): background `Tokens.Soft.accent`, border `Tokens.line.soft` mixed with `Tokens.accent` 30%
- Title row: `HStack(spacing: 8, alignItems: .center)` — status dot 8 × 8 (color rules below), name 14 pt weight 600 (700 if active), `Spacer()`, time `String.relativeShort(from: room.lastActiveAt)` 11 pt
- Preview: `Text("@handle: \(preview)")` 12 pt `Tokens.ink.soft`, `lineLimit(1)` truncation tail, `textGrowth: .fixed-width fill_container`
- Footer: `HStack(spacing: 6)` — last 3 agent handles 11 pt `Tokens.ink.muted`, then `· N ask open` chip if openAsks > 0 (chip = `Tokens.Soft.accent` background, `Tokens.accent` text 10 pt weight 600, padding `[5, 2]`, corner radius 4)

**Status dot color:**
- `Tokens.accent` if active room (`room.id == currentRoom.id`)
- `Tokens.ok` if `room.isLive` && lastActiveAt within 1h
- `Tokens.warn` if `room.isLive` && lastActiveAt within 24h
- `Tokens.ink.muted` otherwise (shouldn't appear in this filtered list — defensive)

**Interaction:**
- Click anywhere → `currentRoom.id = room.id`
- Same hover/pressed states as ask cards

**States:**
| State | Render |
|---|---|
| Loading | 4 skeleton room cards |
| Loaded, count > 0 | Real warm rooms, max 6 visible — overflow link `View all rooms →` |
| Loaded, count == 0 | Soft prompt: `messages-square` icon 16 × 16 `Tokens.ink.muted` + caption `"No warm rooms"` + sub `"Activity in the last 24h surfaces here"` |
| ErrorWithCache | Cards from last-known + `"Reconnecting…"` chip |
| ErrorNoCache | Ghost card + Retry |

**A11y:**
- Card: button role + `accessibilityLabel("Room \(name), \(statusName), last activity \(timeAgo): \(preview)")` + hint `"Opens \(name)"`
- Section: header trait + count in label

---

## Sub-region C — PLAN PROGRESS · `PlansList.swift`

**Section header:**
- Left: `calendar.badge.clock` SF Symbol (12 × 12, `Tokens.ink.muted`) + `"PLAN PROGRESS"` 11 pt weight 800 letter-spacing 1.2 fill `Tokens.ink.soft`
- Right: `"N active"` 11 pt weight 500 `Tokens.ink.muted`

**Plan row composition:**
```
┌─────────────────────────────────────────────┐
│ Plan name                            3 of 5 │  ← top row: 13 pt weight 700, count ok-green
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━            │  ← progress bar 6h
└─────────────────────────────────────────────┘
```

Per-row layout:
- `VStack(spacing: 8) { ... }`, padding 12, corner radius 10
- Background: `Tokens.Surface.card`, border 1 px `Tokens.line.soft`
- **NO hover state, NO press state, cursor stays default** — communicates non-interactive
- Top row: `HStack` — plan name 13 pt weight 700 `Tokens.ink.strong`, `Spacer()`, `"N of M"` 11 pt weight 600 `Tokens.ok` (`Tokens.warn` if M − N > 3, i.e. far from done)
- Progress bar: `ZStack(alignment: .leading) { ... }` — track 6 h × fill_container `Tokens.Surface.raised`, fill 6 h × `(N/M) * width` `Tokens.ok` (matches the "N of M" text colour)
- Both layers have corner radius 3

**Interaction:**
- Click → no-op
- `.help("Plan detail surface arrives in a later slice")`
- `.allowsHitTesting(false)` on the wrapper to disable click + cursor changes — this is the visible-non-destructive cue

**States:**
| State | Render |
|---|---|
| Loading | 2 skeleton plan rows |
| Loaded, count > 0 | Real plans, max 4 visible — overflow link `View all plans →` (also no-op for Slice 3) |
| Loaded, count == 0 | Soft prompt: `calendar.badge.clock` icon 16 × 16 `Tokens.ink.muted` + caption `"No active plans"` |
| ErrorWithCache | Cards from last-known + `"Reconnecting…"` chip |
| ErrorNoCache | Ghost row + Retry |

**A11y:**
- Row: `.accessibilityElement(children: .combine)` + `accessibilityLabel("Plan \(name), \(stepsDone) of \(stepsTotal) steps complete")` + `.accessibilityTraits(.staticText)` (NOT a button — non-interactive)
- Section: header trait

---

## OpsColumn header changes

Slice 1 shell already has `opsHead` with eyebrow "FRIDAY" + title "Today" + filter chip + collapse chev. Slice 3:
- Eyebrow `"FRIDAY"` → dynamic via `Date().formatted(.dateTime.weekday(.wide))` uppercased (today is dynamic; collapsed to weekday name)
- Title `"Today"` unchanged
- Filter chip: change `"All"` text style → keep, add `.disabled(true)` + `.help("Filtering arrives in a later slice")`. Visually a touch dimmed (opacity 0.6) to communicate disabled.
- Collapse chev: unchanged from Slice 1

---

## PASS gate (ratified per @antmacdevcodex `msg_w1c8hduemr`)

| # | Criterion | Met by |
|---|---|---|
| 1 | OpsColumn skeleton fully replaced by Today content sections | `OpsColumn.swift` composes `AsksList()` + `RoomsList()` + `PlansList()` with section dividers between |
| 2 | AsksService + PlansService follow ChatRoomsService nil / error / cache refresh semantics | code review against `ChatRoomsService.swift` (Slice 2) — same `enum LoadState`, same 30 s refresh on appear + foreground |
| 3 | Asks / Rooms / Plans each render loading · error-no-cache · error-with-cache · loaded · empty states | per-section state-matrix tables above; manual verification with offline + bad-API-response harness |
| 4 | ask count matches SourcesNav.Asks; warm room count matches SourcesNav.Rooms | counts both bind to the same service property; code review confirms no duplicate filtering |
| 5 | ask / room card click writes `currentRoom.id` | manual: click ask → quit → relaunch → currentRoom.id persisted to ask.roomId |
| 6 | Plan rows visibly non-destructive (no hover, default cursor, .help) | manual: hover plan row → cursor stays default, no scale, tooltip shows "Plan detail surface arrives…" |
| 7 | All colours via `Tokens.*`, no raw hex | code review + grep `Color(hex:` in `Views/Shell/Ops/` |
| 8 | `#Preview` coverage for populated / empty / error states | Each of `AsksList`, `RoomsList`, `PlansList` has at least 3 `#Preview` blocks: populated, empty, error |
| 9 | VoiceOver labels + keyboard activation on every card / row | VO sweep: every card has label + hint; tab + Enter routes correctly for asks/rooms; plans announce as static text (correct — they're non-interactive) |
| 10 | `xcodebuild` green + screenshot evidence with Slice 1.5 caveat policy | CI + `docs/concept-d/slice-3-screenshots/` with `SCREENSHOTS.md` documenting any stable-signing residuals |

**Pragmatic capture allowed:** Slice 1 / 2 precedent — if Keychain re-prompts return between captures, ship with `SCREENSHOTS.md` caveat. Slice 1.5 still unblocks.

---

## File map

**New files:**
- `antchat/Antchat/Services/AsksService.swift`
- `antchat/Antchat/Services/PlansService.swift`
- `antchat/Antchat/Models/Ask.swift`
- `antchat/Antchat/Models/PlanSummary.swift`
- `antchat/Antchat/Models/AgentMini.swift`
- `antchat/Antchat/Extensions/String+Relative.swift` (`relativeShort(from:)` + `relativeVerbose(from:)`)
- `antchat/Antchat/Views/Shell/Ops/AsksList.swift`
- `antchat/Antchat/Views/Shell/Ops/RoomsList.swift`
- `antchat/Antchat/Views/Shell/Ops/PlansList.swift`

**Modified files:**
- `antchat/Antchat/Views/Shell/OpsColumn.swift` — replace `.redacted` skeletons with `AsksList()` + `Divider()` + `RoomsList()` + `Divider()` + `PlansList()`. Keep `opsHead` mostly unchanged, just disable the filter chip per Architecture row 3 + dynamic weekday eyebrow.
- `antchat/Antchat/Views/Shell/AppShellView.swift` — instantiate `AsksService()` + `PlansService()` siblings to existing `ChatRoomsService`; pass states down to `OpsColumn`.

---

## Tokens used (all from `Tokens.swift` — no literal hex)

| Token | Hex | Used by |
|---|---|---|
| `Tokens.Surface.app` | `#FFF7ED` | column background |
| `Tokens.Surface.card` | `#FFFFFF` | all card backgrounds |
| `Tokens.Surface.raised` | `#FFF0DF` | progress bar track |
| `Tokens.ink.strong` | `#181512` | plan name, ask body |
| `Tokens.ink.soft` | `#61564D` | room preview, section eyebrows (non-accent) |
| `Tokens.ink.muted` | `#8A7A70` | time labels, footer meta, status muted |
| `Tokens.line.soft` | `#EAD8CA` | card borders, dividers |
| `Tokens.accent` | `#FF3D5A` | ASKS eyebrow, active-room highlight, ask-open chip text |
| `Tokens.Soft.accent` | `#FFE2E6` | ask card border (weakened), active-room bg, ask-open chip bg, hover tint |
| `Tokens.ok` | `#1AC270` | warm count, plan progress (healthy), recent activity dot, no-asks empty icon |
| `Tokens.warn` | `#FFB100` | plan progress (far from done), reconnecting chip, mid-activity dot |

---

## Open items
None. Architecture locked. PASS gate ratified. Visual contract is Concept D Region 3 (unchanged from Slice 1 spec). Build can proceed.

## Hand-off

@antchatmacdev — start `Services/AsksService.swift` + `Services/PlansService.swift` + 3 sub-component files + Models + the relative-time extension. State-machine pattern is identical to Slice 2 — should be mostly mechanical. Tokens locked above.

@antmacdevcodex — QC against this doc when build lands. The "Plan rows visibly non-destructive" check (gate 6) is the only novel pattern this slice — `.allowsHitTesting(false)` + `.help` tooltip + no hover state is the contract.
