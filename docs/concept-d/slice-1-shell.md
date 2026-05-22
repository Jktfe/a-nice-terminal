# Slice 1 — Mac shell scaffold (Concept D chrome)

**Status:** spec ready for implementation
**Owners:** @antchatmacdev (build) · @antmacdevcodex (QA) · @antux (UX)
**Room:** `98jzzlxv9p`
**Visual contract:** Concept D frame in `/Users/you/CascadeProjects/antOSux.pen` at `x=1520 y=-1122`, 1440×1080
**Brand contract:** `src/lib/components/AntLogo.svelte`
**Token contract:** `src/app.css` (light + dark themes)

This is the chrome ONLY — no live data, no real wiring. Everything inside the chrome renders as `.redacted(reason: .placeholder)` skeleton until slices 2–6 fill it in.

---

## Architecture calls (locked — `msg_iek3ccwvfa`)

| # | Decision | SwiftUI primitive |
|---|---|---|
| 1 | NSToolbar | `.toolbar { }` on `NavigationSplitView` |
| 2 | Window restore | `NSWindow.frameAutosaveName` ("antchat.remoteant") |
| 3 | Column-width persistence | `@AppStorage("sidebar.width" / "ops.width" / "shelf.width" / "bridges.hidden")` |
| 4 | App lifecycle | `App` protocol in `AntchatApp.swift` — no `NSApplicationDelegate` |
| 5 | Skeleton empty state | `.redacted(reason: .placeholder)` |
| 6 | Keyboard shortcuts | `.commands { }` so they surface in the menu bar |

Scene config (`AntchatApp.swift`):
```swift
WindowGroup { AppShellView() }
  .windowResizability(.contentSize)
  .defaultSize(width: 1440, height: 1080)
  .windowToolbarStyle(.unified)
  .commands { AntCommands() }
```

---

## Slice 1 scope

**INCLUDES** (in this PR):
- `AntchatApp.swift` — scene config + commands
- `Views/Shell/AppShellView.swift` — `NavigationSplitView` + bottom drawer composition
- `Views/Shell/AntToolbar.swift` — top chrome (Region 1)
- `Views/Shell/SidebarColumn.swift` — left column shell (Region 2)
- `Views/Shell/OpsColumn.swift` — middle column shell (Region 3)
- `Views/Shell/RoomColumn.swift` — right area, room header + room shelf (Region 4)
- `Views/Shell/RoomShelf.swift` — tab strip (placeholder labels only)
- `Views/Shell/BridgesStrip.swift` — bottom drawer (Region 5)
- `Tokens.swift` — palette + spacing constants (in flight by @antchatmacdev)
- `Views/AntBrandMark.swift` — brand glyph (in flight by @antchatmacdev)
- `AntCommands.swift` — `.commands { }` for ⌘1/2/3/K/B/⇧4/⇧B

**EXCLUDES** (later slices):
- Sidebar list contents (SOURCES + SAVED ROOMS + ON THIS MAC) → **Slice 2**
- Ops column Today content (asks / rooms / plan progress) → **Slice 3**
- Room header + chat + composer + shelf tab content → **Slice 4**
- Native bridge data + drop-target wiring → **Slice 5**
- Premium gating on ★ Chair / ★ Validation → **Slice 6**

---

## Region 1: Top toolbar — `AntToolbar.swift`
**Pencil ref:** node `mmX8j` · 72 h × fill_container

Order (left → right):
1. macOS traffic lights (automatic)
2. `AntBrandMark` — `>_ANT` wordmark (chevron `#0A85F0`, underscore `#1AC270`, ANT adaptive `--ink-strong`) + `ant-logo.svg` 38×38
3. Title separator `·`
4. Window title `"remoteant"`
5. Spacer (`Spacer()`)
6. ⌘K Search palette — 380 × 36, hint `"Search rooms, asks, files, agents, plans…"`, trailing `⌘K` keycap
7. Connected pill — green dot + `"Connected"`
8. Notification bell + accent badge (placeholder count `3`)
9. Share button (`square.and.arrow.up`)
10. Menu-bar chevron (`chevron.up`)
11. Profile chip — avatar + `"James"` + `chevron.down`

**Tokens:**
| Element | Token |
|---|---|
| toolbar background | `--surface-card` `#FFFFFF` |
| toolbar border-bottom | `--line-soft` `#EAD8CA` |
| search field background | `--surface-app` `#FFF7ED` |
| search field border | `--line-soft` |
| Connected pill background | `ok-soft` `#DCFCE7` / border `#A8E6B8` / text `#0C8348` |
| Notification badge | `--accent` `#FF3D5A` / text `#FFFFFF` |
| Profile avatar | `--accent` `#FF3D5A` |

**A11y labels:** brand `"antOS remoteant"`, search `"Search rooms, asks, files, agents, plans"`, Connected `"Connected to server"`, bell `"Notifications, 3 unread"`, share `"Share"`, profile `"James, account"`.

**Empty state:** all chrome renders normally; counts (`3` on bell) come from a binding that is `nil` until Slice 4 — when `nil`, the badge view returns `EmptyView()`. Connected pill is **not** redacted — it reflects real connection state from Slice 1 onwards.

---

## Region 2: Sidebar — `SidebarColumn.swift`
**Pencil ref:** node `Z5SjX` · 224 w × fill_container

`NavigationSplitView` first column. Width `@AppStorage("sidebar.width")` default `224`, min `200`, max `300`. Visibility `@AppStorage("sidebar.visible")` default `true`. Collapse via toolbar `panel-left-close` icon, ⌘1, or ⌘B.

**Shell content (this slice):**
- `"SOURCES"` eyebrow row + `plus` button + `panel-left-close` collapse chev
- 7 redacted-skeleton list rows (matches: Today, Asks, Rooms, Library, Agents, Vault, Memory)
- `"SAVED ROOMS"` eyebrow row + count + chev-down
- 4 redacted-skeleton rows with grip-vertical handle on left
- `"ON THIS MAC"` eyebrow row
- 3 redacted-skeleton rows
- `Spacer()`
- `"Start something"` CTA — full width, `--accent`, white text, `sparkles` leading icon
- Footer text `"Connected · home Mac mini · 24 ms"` (placeholder ping)

**Tokens:**
| Element | Token |
|---|---|
| sidebar background | `--surface-raised` `#FFF0DF` |
| right border | `--line-soft` `#EAD8CA` |
| CTA background | `--accent` `#FF3D5A` |
| CTA shadow | `rgba(255,61,90,0.18)` y=2 blur=6 |
| eyebrow text | `--ink-muted` `#8A7A70`, 10 pt, weight 800, letter-spacing 1.6 |

---

## Region 3: Ops column — `OpsColumn.swift`
**Pencil ref:** node `k4Juf` · 340 w × fill_container

Width `@AppStorage("ops.width")` default `340`, min `280`, max `420`. Visibility `@AppStorage("ops.visible")` default `true`. Collapse via toolbar `panel-left-close` icon or ⌘2.

**Shell content:**
- Header (84 h): `"FRIDAY"` eyebrow + `"Today"` title (22 pt, weight 800) + `"All"` filter chip placeholder + `panel-left-close` collapse chev
- Scroll body — three placeholder sections, each with a 14-pt eyebrow + 2–4 redacted skeleton cards:
  - `"ASKS NEEDING YOU"` (accent-coloured eyebrow + count badge)
  - `"ROOMS"` (muted eyebrow + warm count)
  - `"PLAN PROGRESS"` (muted eyebrow + active count + bar skeleton)

**Tokens:**
| Element | Token |
|---|---|
| column background | `--surface-app` `#FFF7ED` |
| header background | `--surface-raised` `#FFF0DF` |
| header border-bottom | `--line-soft` |
| asks eyebrow | `--accent` `#FF3D5A` |

---

## Region 4: Room column — `RoomColumn.swift` + `RoomShelf.swift`
**Pencil ref:** node `DUxR1` · fill × fill, min 600 w

`NavigationSplitView` detail.

**Room header (top):**
- `"ACTIVE ROOM · 7 LIVE"` eyebrow (accent) + dot
- Room title — 24 pt, weight 800 (placeholder `"Mac client rethink"`)
- Avatar stack (5 × 30 px, overlap −6, 2 px surface-raised stroke) — 4 placeholders + `+4` count chip
- Invite button — accent-soft background, `user-plus` icon, label `"Invite"`
- Screenshot button — surface-card + line-soft border, `camera` icon, label `"Screenshot"`, trailing `⌘⇧4` keycap
- Share button (`square.and.arrow.up`)
- Right-shelf collapse chev (`panel-right`)
- Drag-drop hint row beneath header — dashed border `--line-soft`, `file-down` icon + `"Drag any file from Finder — PDFs, Numbers, Pages, Keynote, screenshots — and the room becomes evidence-aware"`

**Room body:** horizontal split
- Chat area (fill): redacted-skeleton message stack (3 message slots), empty composer placeholder pinned to bottom
- Room shelf (340 w, see below)

**RoomShelf tab strip** — 3 rows of 3 tabs each, all label-only:

| Tab | State | Token |
|---|---|---|
| Artefacts | Active default | `--accent` text on accent-soft bg |
| Plan | Inactive | `--ink-strong` text, transparent bg |
| Interviews | Inactive | same |
| Memories | Inactive | same |
| Attachments | Inactive | same |
| ★ Chair | **Premium · locked** | `--warn` `#FFB100` text on `warn-soft` `#FFF2C7` bg + `.disabled(true)` |
| ★ Validation `(84%)` | **Premium · locked** | same |
| Linked rooms `(3)` | Inactive | inactive style + count chip |

Active tab content area: redacted-skeleton card placeholder. No real artefact preview.

**Tokens:**
| Element | Token |
|---|---|
| room background | `--surface-card` `#FFFFFF` |
| room header background | `--surface-raised` `#FFF0DF` |
| Active room eyebrow + dot | `--accent` `#FF3D5A` |
| Invite | `--accent-soft` bg + `--accent` text |
| drop-zone dash | `--line-soft`, dashPattern [6, 4] |
| shelf right border | `--line-soft` |
| Active tab | `--accent` text on `accent-soft` `#FFE2E6` |
| Premium tab | `--warn` text on `warn-soft` `#FFF2C7` |

---

## Region 5: Native bridges strip — `BridgesStrip.swift`
**Pencil ref:** node `xw1XI` · fill × 104 h (expanded) | 16 h (collapsed)

Persistent at bottom of window. Visibility `@AppStorage("bridges.hidden")` default `false`. Toggle via Hide chip → folds to a 16 h sliver with `chevron-up` handle to reopen. ⌘⇧B also toggles.

**Shell content (expanded):**
- 48 × 4 drag pip (`--line-soft`) centred at top
- Header column (144 w): `"NATIVE BRIDGES"` accent eyebrow + sub `"Drag from any · or grant once"`
- 12 placeholder chips — vertical icon + name:

| Chip | Icon | Background tint |
|---|---|---|
| Mail | `mail` | `#3478F6` |
| Calendar | `calendar` | `#FF3B30` |
| Reminders | `list-checks` | `#5856D6` |
| Notes | `sticky-note` | `#FFC107` |
| Safari | `compass` | `#1E88E5` |
| Chrome | `globe` | `#4285F4` |
| Teams | `users-round` | `#6264A7` |
| Zoom | `video` | `#2D8CFF` |
| Office | `presentation` | `#D24726` |
| iWork | `presentation` | `#FF8B23` |
| Files | `folder` | `#2D6CDF` |
| + Connect | `plus` | dashed border, surface-app fill |

- `"Hide"` chip at far right — `chevron-down` + label

**Tokens:**
| Element | Token |
|---|---|
| strip background | `--surface-raised` `#FFF0DF` |
| top border | `--line-soft` |
| chip background | `--surface-card` `#FFFFFF` |
| chip border | `--line-soft` |
| drag pip | `#D8C3B1` (a slightly darker stone — used for visible-but-passive controls) |
| eyebrow | `--accent` `#FF3D5A` |
| Connect chip border | `--line-soft`, dashPattern [4, 4] |

**Slice 1 behaviour:** chips render but have **no drop target wiring** and **no real bridge data**. Tapping any chip is a no-op. Slice 5 wires the drag receivers + per-bridge permission flow.

---

## Keyboard shortcuts (`AntCommands.swift`)

| Shortcut | Action | Menu placement |
|---|---|---|
| ⌘1 | Toggle sidebar | View › Sidebar |
| ⌘2 | Toggle ops column | View › Today |
| ⌘3 | Toggle room shelf | View › Room shelf |
| ⌘K | Focus search palette | Edit › Find |
| ⌘B | Toggle sidebar (Mail.app alias) | (no menu) |
| ⌘⇧B | Toggle bridges strip | View › Bridges |
| ⌘⇧4 | Screenshot the active room | File › Screenshot |

All declared via `.commands { CommandMenu(...) }` so they appear in the menu bar.

---

## PASS / BLOCKER gate (per @antmacdevcodex `msg_8jsair21n7`)

| # | PASS criterion | Where this slice satisfies |
|---|---|---|
| 1 | Launches at default 1440×1080, min 1280×800, no clipping | `AntchatApp.swift` `.defaultSize` + `.windowResizability(.contentSize)` |
| 2 | NavigationSplitView 3-column: sidebar 224 w · ops 340 w · room fill | `AppShellView.swift` |
| 3 | Toolbar matches Concept D intent | `AntToolbar.swift` + `AntBrandMark.swift` |
| 4 | Tokens mirror source palette | `Tokens.swift` + all per-region token maps above |
| 5 | Left / right / bottom each have visible independent collapse + restore | Per-region `@AppStorage` keys; toggling one does **not** alter sibling state |
| 6 | Tabbed shelf + bridges strip scaffolded as non-functional placeholders | RoomShelf chips render with `.disabled(true)` on premium; BridgesStrip chips are visual only |
| 7 | Chair / Validation premium tabs visible but locked | `.disabled(true)` + warn styling, no hidden state |
| 8 | Keyboard / a11y basics | `.accessibilityLabel` on every chrome control + `.commands` shortcuts |
| 9 | Build evidence | Swift build green + screenshots at 1440×1080 + 1280×800 + sidebar-collapsed + ops-collapsed + shelf-collapsed + bridges-collapsed |

**BLOCKER triggers:** any crash on launch, missing 3-column shell, token/brand mismatch vs Concept D, non-independent collapse state, clipped text/chrome at either target size, or any bridge chip presenting fake working behaviour.

---

## Existing files that get touched
- `antchat/Antchat/AntchatApp.swift` — replace scene config
- `antchat/Antchat/Views/Shell/AppShellView.swift` — switch from current layout to `NavigationSplitView` + bottom drawer composition
- `antchat/Antchat/Views/AntBrandMark.swift` — replace stale `"Ant Chat / Native Mac"` wordmark with canonical `>_ANT` + `ant-logo.svg`
- `antchat/Antchat/Theme/DirectionCTheme.swift` — **leave for now**. Slice 1 introduces `Tokens.swift` as new source of truth; DirectionCTheme call-sites migrate progressively over slices 2–6
- `antchat/Antchat/Assets.xcassets/ANTlogo.imageset/` — swap the source PNG for the live `ant-logo.svg` (or vector PDF generated from it)

## New files
- `antchat/Antchat/Tokens.swift`
- `antchat/Antchat/AntCommands.swift`
- `antchat/Antchat/Views/Shell/AntToolbar.swift`
- `antchat/Antchat/Views/Shell/SidebarColumn.swift`
- `antchat/Antchat/Views/Shell/OpsColumn.swift`
- `antchat/Antchat/Views/Shell/RoomColumn.swift`
- `antchat/Antchat/Views/Shell/RoomShelf.swift`
- `antchat/Antchat/Views/Shell/BridgesStrip.swift`

---

## Visual export

Per-region PNG exports were attempted via `mcp__pencil__export_nodes` but failed against the active editor (likely transport hiccup on the Pencil side — retry pending). Until exports land, QA verifies against:
1. Live Pencil canvas — `/Users/you/CascadeProjects/antOSux.pen`, frame `Concept D — antux · The Workspace` at `x=1520, y=-1122`
2. Inline screenshots posted to room `98jzzlxv9p`
3. Node IDs in this spec — every region references its Pencil node id (`mmX8j`, `Z5SjX`, `k4Juf`, `DUxR1`, `xw1XI`) so per-region crops can be regenerated by anyone with Pencil access

Once exports succeed, `docs/concept-d/` will contain:
- `concept-d-full@2x.png` — entire frame
- `region-1-toolbar@2x.png` — node `mmX8j`
- `region-2-sidebar@2x.png` — node `Z5SjX`
- `region-3-ops@2x.png` — node `k4Juf`
- `region-4-room@2x.png` — node `DUxR1`
- `region-5-bridges@2x.png` — node `xw1XI`
- `concept-d-tree.json` — `batch_get` dump of the frame node tree

---

## Open items
None for Slice 1. Architecture locked. QA locked. Visual contract locked. Build can proceed.
