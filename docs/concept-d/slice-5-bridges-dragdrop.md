# Slice 5 — Native bridges drag-drop (Finder file → room artefact)

**Status:** spec ready for implementation (PASS gate pending @antmacdevcodex Q5 final wording)
**Owners:** @antchatmacdev (build, lead) · @antmacdevcodex (QA) · @antux (UX)
**Room:** `iawcdenlgc`
**Visual contract:** Concept D frame `antOSux.pen` at `x=1520 y=-1122`, room region `DUxR1` (drop-hint band already in slice-1-shell.md Region 4)
**Reference PNG:** `docs/concept-d/DUxR1.png` @ 2× — drop-hint band visible at top of room body
**Inheritance:** v0.2.1 ship. BridgesStrip chips are visible-but-passive; drop-hint band in RoomColumn header already promises "Drag any file from Finder — the room becomes evidence-aware." Slice 5 makes that promise true.

---

## Architecture (locked across UX + build + QA)

| # | Decision | SwiftUI / file |
|---|---|---|
| 1 | **Drop target = whole RoomColumn body**, NOT the BridgesStrip chips. Users drag TO the room they're focused on, not TO a chip. | `RoomColumn.swift` — `.onDrop(of: [.fileURL, .image, .pdf], delegate: RoomDropDelegate())` |
| 2 | **NSItemProvider types** for v1: `.fileURL`, `.image`, `.pdf`. Plain text + URLs defer to Slice 5.5. Covers Finder + Mail attachments + Notes exports + screenshots — the 80%. | `RoomDropDelegate.swift` filters by `provider.canLoadObject(ofClass: URL.self)` etc |
| 3 | **Auto-name from filename.** Inline rename via double-click in RoomShelf Artefacts tab (lifted from Slice 4 Artefacts panel). No prompt sheet per drop. | `MessagesService.uploadArtefact(roomId:, fileURL:, displayName: filename)` |
| 4 | **No-room-selected drop, Slice 5 v1 (shipped at 5940b6c):** `.onDrop` returns false silently + a soft toast `"Pick a room first"` surfaces briefly, with the sidebar SAVED ROOMS section highlighting for ~1.5 s to hint where to choose. **v0.2.2 polish upgrade:** add `RoomPickerSheet` (reuses SAVED ROOMS sorted by recency + search field) — drag pending state holds providers, picker dismisses, drop replays against picked room + writes `currentRoom.id`. | v1 path = soft toast in `RoomColumn.swift`; v0.2.2 path = new `Views/Chat/RoomPickerSheet.swift` |
| 5 | **Backend** — existing `POST /api/chat-rooms/:roomId/artefacts` endpoint. **NO server work in Slice 5.** Pure Mac app delivery. | Confirm endpoint shape; multipart upload with `roomId` + `displayName` + binary body |
| 6 | **Multi-file drop allowed.** Sequential upload with per-file progress. One file failing does NOT cancel siblings. | `RoomDropDelegate` collects `[NSItemProvider]`, iterates with `TaskGroup` |
| 7 | **Visual feedback states:** | See Sub-region A below |
| 8 | **Unsupported types** (arbitrary text, executable, archives we won't accept) → silent no-op, cursor returns to default. No toast, no banner. Don't punish the user for trying. | `RoomDropDelegate.validateDrop(_:)` returns false silently |
| 9 | **All tokens via `Tokens.*`** in new files. | grep audit |
| 10 | **BridgesStrip chips stay no-op for Slice 5.** Chips visualise connected services, not drop trays. Slice 7b will invert for bring-in-LLM. | No changes to `BridgesStrip.swift` this slice |

---

## Sub-region A — RoomColumn drop target

**Files:** `Antchat/Views/Shell/RoomColumn.swift` (modify), `Antchat/Views/Chat/RoomDropDelegate.swift` (new)

**Visual states:**

| State | Drop-hint band | Cursor | Room body |
|---|---|---|---|
| Idle (no drag) | Default — `Tokens.line.soft` 1 px dashed border, `Tokens.ink.muted` icon + sub label | default | normal |
| Drag enter (over RoomColumn) | Background → `Tokens.Soft.accent` (#FFE2E6), border → `Tokens.accent` 1.5 px dashed, label text → `Tokens.accent` weight 600 | `.copy` | normal |
| Drag over (still hovering) | Same as drag enter | `.copy` | normal — no overlay, no dimming (user can still read the chat behind their cursor) |
| Drag exit | Revert to idle within 100 ms | default | normal |
| Uploading | Drop-hint band shows progress chip: `arrow.up.circle.fill` icon + `"\(filename) · \(percent)%"` + cancel × — appears in the band's right edge | default | normal |
| Multi-file uploading | Progress chip shows `"3 files · 2 of 3 uploaded"`, expands to a small dropdown on hover listing each filename + per-file progress + per-file cancel | default | normal |
| Upload success | Progress chip animates to `Tokens.ok` checkmark + `"\(filename) added"` (1 s) → fades out → drop-hint band returns to idle | default | chat stream appends a `system_artefact_added` message; RoomShelf Artefacts count increments live |
| Upload error | Progress chip → `Tokens.warn` exclamation + `"\(filename) — retry?"` (5 s) with Retry button + dismiss × | default | no chat message appended for the failed file |

**`RoomDropDelegate` shape:**

```swift
struct RoomDropDelegate: DropDelegate {
  @Binding var currentRoomId: String?
  let messagesService: MessagesService
  let onPickRoom: () -> Void   // shows RoomPickerSheet when currentRoomId is nil

  func validateDrop(info: DropInfo) -> Bool { /* type filter */ }
  func performDrop(info: DropInfo) -> Bool {
    guard let roomId = currentRoomId else {
      onPickRoom(); /* hold the providers, replay after pick */
      return true
    }
    Task { try await messagesService.uploadArtefacts(roomId: roomId, providers: info.itemProviders(for: [.fileURL, .image, .pdf])) }
    return true
  }
  func dropEntered(info:) / dropUpdated / dropExited — update @State drag flag for visual states
}
```

**A11y:**
- RoomColumn `.accessibilityLabel("Room \(name), drop files here to attach")` includes the drop affordance
- During upload, progress chip has `.accessibilityLiveRegion(.polite)` announcing `"\(filename) uploading, \(percent) percent"`
- On success / error, `.accessibilityLiveRegion(.polite)` announces final state
- Keyboard users have no drag affordance in this slice (drag is pointer-only); RoomShelf "Attachments" tab will surface an "Add file…" button in Slice 5.5 for keyboard parity

---

## Sub-region B — Room picker sheet · `RoomPickerSheet.swift`

Triggered when user drops a file with `currentRoomId == nil`.

**Layout:**
- Modal sheet, fixed size 480 × 560
- Header: `"Which room is this for?"` 18 pt weight 700 `Tokens.ink.strong` + close `×` button top-right
- Search field at top — `magnifyingglass` SF Symbol + placeholder `"Search rooms…"` + debounced query
- List below: two sections — `SAVED ROOMS` (sorted by recency, max 10) + `OTHER ROOMS` (rest, paginated 20 at a time)
- Each row: status dot + room name + last-active timestamp via `String.relativeShort`
- Bottom: pending-drop strip — `"\(N) file(s) ready to attach"` + cancel button
- Selecting a row → assigns `currentRoom.id = picked.id` → drop completes → sheet dismisses with the upload starting

**Sheet behaviour:**
- Dismiss via ESC, close button, or click outside → cancels the pending drop
- Multi-file drop pending → the picker accepts ONE room for ALL the dropped files (consistent with whole-room-drop semantics from Sub-region A)

**A11y:** sheet is a `presentationDetents`-managed view with `.accessibilityAddTraits(.isModal)`; rows have `accessibilityHint("Attaches \(N) file(s) to this room")`.

---

## Sub-region C — Artefact upload flow

**Files:** `MessagesService.swift` (modify — add `uploadArtefacts(roomId:providers:)`)

**Flow:**

1. Provider loop: each `NSItemProvider` resolved to a file URL via `loadObject(ofClass: URL.self)`. Skip silently on unresolved.
2. For each file URL:
   - Open file handle, stream contents to `POST /api/chat-rooms/:roomId/artefacts` as multipart body with fields `displayName` (filename) + `kind` (auto-detected from extension: `pdf` / `image` / `file`) + `body` (binary).
   - Track progress via `URLSessionUploadTask` delegate → emit progress to a `@Published var uploads: [ArtefactUpload]` that the RoomColumn's progress chip subscribes to.
   - On 200/201 success: artefact ID returned in response body → append a synthetic `system_artefact_added` `Message` to the chat stream (locally only — server's own broadcast will dedupe).
   - On failure: keep entry in `uploads` with `state = .error`; UI shows retry.
3. After all uploads (success or fail), drop-hint band animates back to idle.

**`system_artefact_added` message kind** — should already exist in v0.1.x lineage; if not, this slice's `Message.swift` modification adds it (1-line enum case).

**Error handling:**
- HTTP 401/403 → "Sign-in expired — reconnect" toast + open the sign-in modal (existing flow)
- HTTP 413 (too large) → progress chip → `"\(filename) — too large (max 100 MB)"`, no retry button (size won't change)
- HTTP 5xx → retryable, surface Retry button
- Network failure → retryable, surface Retry button
- Local file read error → `"\(filename) — could not read"`, no retry

---

## Sub-region D — BridgesStrip chips (codify the boundary)

**No changes to `BridgesStrip.swift` this slice.**

Chips remain visible + passive. The boundary is intentional:
- BridgesStrip = "services connected to this Mac, drag FROM them" (Mail → drag email; Calendar → drag event; etc — Slice 5.5)
- RoomColumn = "drop INTO the room you're in" (Slice 5)

If a user attempts to drop ON a BridgesStrip chip, the chip ignores the drop (does NOT highlight, does NOT accept). The drop instead bubbles up to RoomColumn's delegate if the cursor moved over RoomColumn at any point during the drag. macOS default `.onDrop` behaviour handles this naturally if BridgesStrip chips don't register a drop target.

**Bank for Slice 5.5:** add drag SOURCES to BridgesStrip chips so Mail / Calendar / etc become drag-FROM origins.

---

## PASS gate (proposed — pending @antmacdevcodex final wording)

| # | Criterion | Met by |
|---|---|---|
| 1 | RoomColumn accepts `.fileURL` / `.image` / `.pdf` drops; rejects other types silently | manual: drag a `.txt` file → no visual feedback, cursor stays default |
| 2 | Drag enter / over / exit visual states match Sub-region A spec | manual + screenshot at each state |
| 3 | Single-file drop → upload → `system_artefact_added` appended to chat + RoomShelf Artefacts count increments | manual: drag a PDF → message appears, count goes up |
| 4 | Multi-file drop → sequential upload, per-file progress, one failure doesn't cancel siblings | manual: drop 3 files; mid-upload network failure on file 2 → files 1 + 3 succeed, file 2 shows retry |
| 5 | No-room-selected drop → soft toast `"Pick a room first"` + SAVED ROOMS section highlights briefly | manual: clear currentRoom.id, drag file in, observe toast + highlight, no upload triggered. (v0.2.2 polish replaces with RoomPickerSheet — drag completes against picked room.) |
| 6 | Cancel drop in picker → all pending uploads abandoned, no chat messages appended | manual + grep for orphaned items in `uploads` array |
| 7 | Auto-name from filename; double-click in Artefacts tab renames inline | manual: drop `report.pdf` → artefact card titled "report.pdf"; double-click → inline editor |
| 8 | Errors surface as retry chip (5xx / network) or non-retry chip (413 / 401) per Sub-region C | manual + harness with simulated bad responses |
| 9 | All tokens via `Tokens.*`, no raw hex in `Views/Chat/RoomDropDelegate.swift` or `Views/Chat/RoomPickerSheet.swift` | grep audit |
| 10 | VoiceOver labels + live-region announcements for upload progress + outcome | VO sweep |
| 11 | `xcodebuild` green + screenshot evidence of idle / drag-over / uploading / success / error states | CI + `docs/concept-d/slice-5-screenshots/` |

---

## File map

**New files:**
- `antchat/Antchat/Views/Chat/RoomDropDelegate.swift`
- `antchat/Antchat/Views/Chat/RoomPickerSheet.swift`
- `antchat/Antchat/Models/ArtefactUpload.swift` (struct `{ id, filename, state, progress, error? }`)

**Modified files:**
- `antchat/Antchat/Views/Shell/RoomColumn.swift` — wire `.onDrop` + visual state on drag flag + progress chip overlay on the drop-hint band
- `antchat/Antchat/Services/MessagesService.swift` — add `uploadArtefacts(roomId:providers:)` + `@Published var uploads: [ArtefactUpload]`
- `antchat/Antchat/Models/Message.swift` — add `MessageKind.system_artefact_added` case (1-line addition if not already there)

---

## Tokens used

| Token | Used by |
|---|---|
| `Tokens.line.soft` | idle drop-hint band border, dashed pattern |
| `Tokens.ink.muted` | idle band icon + sub-label |
| `Tokens.Soft.accent` | drag-over band background |
| `Tokens.accent` | drag-over band border + label, progress chip border |
| `Tokens.ok` | upload-success checkmark |
| `Tokens.warn` | upload-error chip + retry affordance |
| `Tokens.Surface.card` | RoomPickerSheet background, row backgrounds |
| `Tokens.Surface.raised` | RoomPickerSheet header + footer bars |

---

## Hand-off

@antchatmacdev — your groundwork starts at `RoomColumn.swift` with `.onDrop` + `RoomDropDelegate`. The endpoint-shape investigation (existing `POST /api/chat-rooms/:id/artefacts` vs `/attachments`) is the only thing that might block — if neither exists, this becomes "Slice 5 + a server-side artefact upload endpoint." Confirm shape first; if it's an unknown, raise here before committing to the wire path.

@antmacdevcodex — confirm or amend Q5 / the 11-item gate above. The novel patterns this slice are (a) drag visual states (b) progress chip animations (c) no-room-selected picker sheet — first time we have a modal-on-implicit-trigger in this codebase, so a11y treatment of the picker is the easy thing to overlook.

## Open items
None UX. Q5 pending @antmacdevcodex.
