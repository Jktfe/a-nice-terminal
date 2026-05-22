# Slice 2 — Sidebar list contents (SOURCES + SAVED ROOMS + ON THIS MAC)

**Status:** spec ready for implementation
**Owners:** @antchatmacdev (build) · @antmacdevcodex (QA) · @antux (UX)
**Room:** `98j482lg8g`
**Visual contract:** Concept D frame `antOSux.pen` at `x=1520 y=-1122`, sidebar region `Z5SjX` (224 w)
**Reference PNG:** `docs/concept-d/Z5SjX.png` @ 2×
**Inheritance:** Slice 1 (antchat `824b33d`, docs `96edb1b`) — replaces the `.redacted(reason: .placeholder)` rows in `SidebarColumn.swift` with real content. Shell topology, brand, tokens, toolbar collapse-toggles all UNCHANGED.

---

## Architecture (locked across UX + build + QA)

| # | Decision | SwiftUI primitive / file |
|---|---|---|
| 1 | Folder | `antchat/Antchat/Views/Shell/Sidebar/` with `SourcesNav.swift` · `SavedRoomsList.swift` · `OnThisMacList.swift`. `SidebarColumn.swift` composes them. |
| 2 | Source-selection state | `@AppStorage("sources.selected")` default `"today"` (String). `SourcesNav` reads/writes; `SidebarColumn` forwards as `@Binding` to `AppShellView` so the centre-column composition reacts in Slice 3+. Slice 2 ships the wire, no behaviour change in centre. |
| 3 | Current-room state | `@AppStorage("currentRoom.id")` optional String. `SavedRoomsList` row click writes; `RoomColumn` reads in Slice 4. Slice 2 ships the write side only. |
| 4 | Saved-rooms ordering | `@AppStorage("savedRooms.order")` storing JSON-encoded `[String]` of room IDs. Decoded on read; defensively drops unknown IDs from the persisted list quietly on each load (no corruption on stale IDs from deleted rooms). |
| 5 | Saved-rooms data source | `GET /api/chat-rooms` → zip IDs from @AppStorage against API response → `[SavedRoomEntry]`. Falls back to last-known-persisted titles on API error. New `Antchat/Models/RoomSummary.swift` to hold `{ id, name, status, lastActiveAt }`. |
| 6 | Reorder | `NSItemProvider`-based row drag (pointer); writes the new order to `@AppStorage("savedRooms.order")`. |
| 7 | Keyboard reorder | `.accessibilityCustomActions` per row exposing `"Move up"` + `"Move down"`. SHOULD for Slice 2; escape valve to Slice 2.5 if pointer drag is the only thing landing cleanly. |
| 8 | ★ toggle undo toast | New `Antchat/Views/Components/UndoToast.swift` (slide-up, 3 s window, accent-soft background). **Toast centre stays local to `AppShellView` for Slice 2** — `@State var pendingUndo: UndoToastModel?` on `AppShellView` is enough. No app-wide notification bus until a second consumer (memory pin / ask dismiss / etc) actually arrives and proves the abstraction needed. Per @antmacdevcodex `msg_04ksmnvk7f`. |
| 9 | ON THIS MAC clicks | `NSWorkspace.shared.open(URL)` one-liners — non-permissioned URL handler launches. `LSWorkspace` returns Bool; if false, fail silently (no error banner, no permission prompt). Vault path `~/Library/CloudStorage/ant-vault/` is a placeholder; `.help("placeholder — Slice 5 mounts the real FileProvider vault")` makes that explicit. |
| 10 | Loading / empty / error | `.redacted(reason: .placeholder)` for loading; soft-prompt card for empty SAVED ROOMS; subtle `.warn` chip + retry on API error (no full-screen broken state). |

---

## Sub-region A — SOURCES nav · `SourcesNav.swift`

Seven rows, in this order:

| # | Source ID | Label | Icon (SF Symbol · Lucide reference) | Count source | Notes |
|---|---|---|---|---|---|
| 1 | `today` | Today | `sun.max` (Lucide: `sun`) | none | **default active state** |
| 2 | `asks` | Asks | `tray` (Lucide: `inbox`) | `GET /api/asks?status=open` count | accent count chip if > 0 |
| 3 | `rooms` | Rooms | `bubble.left.and.bubble.right` (Lucide: `messages-square`) | `GET /api/chat-rooms` count where `status=warm` | ok-green count |
| 4 | `library` | Library | `books.vertical` (Lucide: `library`) | none | sub-label `decks · sheets` |
| 5 | `agents` | Agents | `person.2` (Lucide: `users`) | `GET /api/agents/availability` count | sub-label `N live` in ok-green |
| 6 | `vault` | Vault | `archivebox` (Lucide: `archive`) | none | sub-label `in Finder` |
| 7 | `memory` | Memory | `brain` (Lucide: `brain`) | none | no count |

> **Icon source:** use **native SF Symbols** in the SwiftUI implementation (column above gives the SF Symbol name first). Lucide names are kept for cross-reference with the Concept D mockup (which used Lucide). Per @antmacdevcodex `msg_7xp6qkpy7z`, no Lucide icon dependency added in this slice.

**Row composition (left → right):**
- 18 × 18 Lucide icon
- Label (14 pt, weight 500 default / 600 active)
- `Spacer()`
- Right-aligned: count chip OR muted sub-label

**Padding per row:** `[10, 14]` (vertical, horizontal). **Gap between rows:** 2. **Corner radius:** 8.

**States:**
| State | Background | Icon fill | Label weight | A11y |
|---|---|---|---|---|
| Active | `Tokens.Soft.accent` `#FFE2E6` | `Tokens.accent` `#FF3D5A` | 600 | `.accessibilityValue("selected")` |
| Inactive | transparent | `Tokens.ink.soft` `#61564D` | 500 | — |
| Hover | `Tokens.line.soft.opacity(0.4)` on `Surface.raised` | `Tokens.ink.strong` | 500 | pointer cursor |
| Pressed | `Tokens.Soft.accent.opacity(0.6)` | — | — | — |

**Count chip:** background `Tokens.accent` if `asks` > 0, `Tokens.ok` if `agents`/`rooms` (live count), text `#FFFFFF` 11 pt weight 600. Padding `[6, 2]`, corner radius 5. Hidden cleanly when count == 0 (no `0` chip).

**Keyboard:**
- `↑`/`↓` traverse rows when sidebar has focus
- `Enter` / `Space` activates the focused row
- **Do NOT repurpose ⌘1/⌘2/⌘3** — those are locked to Slice 1 panel toggles (sidebar / ops / shelf). Source nav uses row focus + Enter/Space only in Slice 2. New global shortcuts for source selection can come in a later slice if needed.

**A11y labels:**
- Row: `accessibilityLabel("\(label), \(count.formatted) \(units)")` (e.g. "Asks, 2 open")
- Hint: `"Switches to \(label) view"`
- Active row also carries `.accessibilityValue("selected")`

---

## Sub-region B — SAVED ROOMS · `SavedRoomsList.swift`

**Section header:**
- `"SAVED ROOMS"` 10 pt weight 800 letter-spacing 1.6, fill `Tokens.ink.muted`
- Right side: count chip "N" + `chevron-down` icon
- Click toggles collapse via `@AppStorage("savedRooms.collapsed")` default `false`
- `accessibilityRole(.disclosureGroup)` with current state

**Row composition (left → right):**
- `grip-vertical` icon, 12 × 12, fill `Tokens.ink.muted` — drag handle
- `star.fill` icon, 13 × 13, fill `Tokens.accent` — toggle button
- Room title (12 pt, weight 500 / 600 if `id == currentRoom.id`)
- `Spacer()`
- Live-status dot, 7 × 7 — `Tokens.accent` if active room, `Tokens.ok` if recent activity (< 24h), `Tokens.ink.muted` if quiet

**Active-room row:** background `Tokens.Surface.card`, 1 px `Tokens.line.soft` stroke. Other rows: transparent.
**Padding:** `[10, 6]`. **Corner radius:** 8.

**Interactions:**
| Trigger | Effect |
|---|---|
| Click row body (not grip, not ★) | Writes `currentRoom.id = room.id` |
| Drag grip → drop above/below another row | Reorders, persists `savedRooms.order` |
| `accessibilityCustomActions: ["Move up", "Move down"]` | Same as drag, keyboard-driven |
| Click ★ | Animates row out (`.transition(.move(edge: .leading).combined(with: .opacity))`), removes ID from `savedRooms.order`, posts UndoToast (`"Removed \(room.name)"` + Undo button, 3 s window) |
| Toast Undo click | Re-inserts ID at original index, dismisses toast |

**Data flow:**
1. `SavedRoomsList` reads `@AppStorage("savedRooms.order")` → `[String]`
2. Fires `GET /api/chat-rooms` (cached, refreshed on appear + every 30 s)
3. Builds `[SavedRoomEntry]` by zipping order-IDs → API records
4. **Defensive cleanup:** any ID in `order` that has no matching API record is silently dropped from `order` (writes back the cleaned array — no UI churn, no toast). This prevents stale IDs from deleted rooms persisting forever.

**Empty / loading / error states:**
| State | Render |
|---|---|
| Loading (no cached data) | 4 `.redacted(reason: .placeholder)` skeleton rows matching real row geometry |
| Loaded, empty `order` | Soft-prompt card: `star` icon (16 px ink-muted) + caption `"★ any room to save it here"` |
| Loaded, all `order` IDs unknown (after cleanup → empty) | Same empty state |
| API error, has stale cache | Render last-known titles + small `Tokens.warn` chip `"Reconnecting…"` + spinner |
| API error, no cache | 1 ghost row: `"Couldn't load rooms"` + `Retry` button |

**A11y:**
- Row: button role with `accessibilityLabel("\(name), saved room \(index + 1) of \(total), status: \(statusName)")` + hint `"Opens room"` — ordinal in the label per `msg_04ksmnvk7f` so VO announces position cleanly
- ★ button: independent accessibility element, label `"Unsave \(name)"`, hint `"Removes from saved list"`
- Grip handle: `accessibilityLabel("Reorder")` + `accessibilityCustomActions` mirroring drag:
  - `"Move up"` action — present only if `index > 0`; updates `savedRooms.order` via the same persistence path as pointer drag
  - `"Move down"` action — present only if `index < total - 1`; same persistence path
  - First row therefore has no effective Move up; last row has no effective Move down — bounds-safe by construction
- Toast: `.accessibilityLiveRegion(.polite)` with content `"Removed \(name). Undo available for 3 seconds."`

---

## Sub-region C — ON THIS MAC · `OnThisMacList.swift`

**Section header:** `"ON THIS MAC"` 10 pt weight 800 letter-spacing 1.6, fill `Tokens.ink.muted`. No count chip, no chevron.

Three rows (Reminders deferred to Slice 2.5 / merge with Slice 5):

| # | Label | Icon (SF Symbol · Lucide ref) · fill | Click → `NSWorkspace.shared.open(URL)` | Help tooltip |
|---|---|---|---|---|
| 1 | Finder · ANT Vault | `folder` (Lucide: `folder-open`) · `Tokens.info` | `file:///Users/<user>/Library/CloudStorage/ant-vault/` | `"placeholder — Slice 5 mounts the real FileProvider vault"` |
| 2 | Calendar · plan steps | `calendar` (Lucide: `calendar`) · `Tokens.accent` | `calshow:` | `"Surfaces plan steps in Calendar — wired in Slice 5"` |
| 3 | Shortcuts | `bolt` (Lucide: `zap`) · `Tokens.warn` | `shortcuts:` | `"Run ANT Shortcuts from Spotlight — wired in Slice 5"` |

**Row composition:** 16 × 16 icon + 13 pt label + `Spacer()`. **Padding:** `[12, 8]`. **Gap:** 2.

**Click behaviour:** call `NSWorkspace.shared.open(url)` directly. Return value is a Bool; if `false` (URL handler missing, app not installed), fail silently — no error banner, no permission prompt, no UI churn. The `.help(tooltip)` provides discoverability that this is "wired in Slice 5" if the user wants more.

**Empty / loading / error:** Section always renders the 3 rows regardless of host state. System apps don't have an empty state.

**A11y:**
- Row: button role + `accessibilityLabel("\(label), opens \(appName)")` + hint `"Switches to \(appName) app"`
- No `accessibilityValue` needed — these are pure actions, not selections

---

## PASS gate (ratified — `msg_5he1atbj5h`)

| # | Criterion | Met by |
|---|---|---|
| 1 | Visual match to Concept D sidebar (region `Z5SjX`) — every sub-section against the reference PNG | `docs/concept-d/Z5SjX.png` side-by-side with build screenshot |
| 2 | Token parity — every colour resolves to a `Tokens.*` value, no literal hex | code review + grep `Color(hex:` in `Views/Shell/Sidebar/` |
| 3 | Three subcomponents + `#Preview` each | `Views/Shell/Sidebar/{SourcesNav,SavedRoomsList,OnThisMacList}.swift` + `Views/Components/UndoToast.swift` all `#Preview`d |
| 4 | `@AppStorage("sources.selected")` drives active-row visual state across launches | manual test: select Asks → quit → relaunch → Asks still active |
| 5 | `@AppStorage("savedRooms.order")` drives ordering; drag persists across launches | manual test: reorder → quit → relaunch → order preserved |
| 6 | ★ toggle removes row + UndoToast 3 s window | manual: click ★ → row animates out + toast + Undo restores |
| 7 | ON THIS MAC click opens corresponding macOS app via `NSWorkspace.shared.open()`. **Degrades cleanly** if URL/app missing — no permission prompts, no UI breakage | manual: click each row, app launches; degradation test = unit-level wrapper that returns `false` from `NSWorkspace.shared.open(_:)` OR call with a bogus URL handler like `calshow-broken-test://noop` → assert silent no-op, no thrown error, `.help` tooltip remains visible. **Do not mutate system apps** for QA per `msg_7xp6qkpy7z`. |
| 8a | VoiceOver labels + keyboard activation (HARD PASS) | VO sweep: every row has a label + hint; tab + Enter activates each interactive element |
| 8b | Keyboard reorder via `accessibilityCustomActions` (SHOULD — Slice 2.5 escape valve) | VO sweep: focus row → action rotor shows Move up / Move down |
| 9 | Empty / loading / error states render correctly | manual: clear `savedRooms.order` → empty prompt; offline → ghost row + retry; bad API response → warn chip |
| 10 | Build evidence: `xcodebuild` green + screenshots (populated sidebar + empty SAVED ROOMS + active-source state) | CI + `docs/concept-d/slice-2-screenshots/` |

**Pragmatic capture allowed (per Slice 1 precedent):** if macOS Keychain re-prompts return between captures, document with `SCREENSHOTS.md` caveat and ship. Don't burn cycles chasing perfect shots — Slice 1.5 (stable signing) is queued.

---

## File map

**New files:**
- `antchat/Antchat/Views/Shell/Sidebar/SourcesNav.swift`
- `antchat/Antchat/Views/Shell/Sidebar/SavedRoomsList.swift`
- `antchat/Antchat/Views/Shell/Sidebar/OnThisMacList.swift`
- `antchat/Antchat/Views/Components/UndoToast.swift` — view + `UndoToastModel` value type (`title`, `actionTitle`, `onUndo: () -> Void`, `expiresAt: Date`)
- `antchat/Antchat/Models/RoomSummary.swift` (struct `RoomSummary { id, name, status, lastActiveAt }`)

**Modified files:**
- `antchat/Antchat/Views/Shell/SidebarColumn.swift` — replace skeleton rows with `SourcesNav()` + `Divider()` + `SavedRoomsList()` + `Divider()` + `OnThisMacList()` + bottom `Start something` CTA + footer
- `antchat/Antchat/Views/Shell/AppShellView.swift` — add `@State private var pendingUndo: UndoToastModel?` + overlay `UndoToast(model:)` view when non-nil. Local state for Slice 2; no global bus.
- `antchat/Antchat/AntCommands.swift` — UNCHANGED in this slice. ⌘1/⌘2/⌘3 stay locked to Slice 1 panel toggles per @antmacdevcodex `msg_7xp6qkpy7z`. Source nav uses row focus + Enter/Space only.

**Optional:**
- `antchat/Antchat/Services/ChatRoomsService.swift` if `/api/chat-rooms` calling logic doesn't already exist and needs to be centralised. Build team's call.

---

## Tokens used (all from `Tokens.swift` — no literal hex in this slice)

| Token | Hex | Used by |
|---|---|---|
| `Tokens.Surface.app` | `#FFF7ED` | — (sidebar is `Surface.raised`) |
| `Tokens.Surface.card` | `#FFFFFF` | active-room row background |
| `Tokens.Surface.raised` | `#FFF0DF` | sidebar background |
| `Tokens.ink.strong` | `#181512` | labels (hover) |
| `Tokens.ink.soft` | `#61564D` | labels (inactive) |
| `Tokens.ink.muted` | `#8A7A70` | eyebrows, sub-labels, grip handle, quiet status dot |
| `Tokens.line.soft` | `#EAD8CA` | row borders, dividers |
| `Tokens.accent` | `#FF3D5A` | active-source icon + label, ★ icon, active-room dot, Calendar icon |
| `Tokens.Soft.accent` | `#FFE2E6` | active-row background, UndoToast background |
| `Tokens.ok` | `#1AC270` | recent-activity dot, ok-green count chips |
| `Tokens.warn` | `#FFB100` | Shortcuts icon, reconnecting chip |
| `Tokens.info` | `#0A85F0` | Finder icon |

---

## Open items
None for Slice 2. Architecture locked. PASS gate ratified. Visual contract is Concept D Region 2 (unchanged from Slice 1 spec). Build can proceed.

## Hand-off

@antchatmacdev — start `Views/Shell/Sidebar/` + `Views/Components/UndoToast.swift` (view + `UndoToastModel` value type only — no service class) + `Models/RoomSummary.swift`. The 10-item gate is your build target; the .help tooltips on ON THIS MAC + the silent NSWorkspace degradation are the only "delicate" bits.

@antmacdevcodex — QC against this doc when build lands. If keyboard reorder (8b) threatens timing it's a Slice 2.5 split, not a blocker.
