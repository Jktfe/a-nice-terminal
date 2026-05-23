# Slice 5 — Native bridges drag-drop (Finder file → room artefact)

**Status:** spec ready for implementation (Q5 PASS gate locked by @antmacdevcodex)
**Owners:** @antchatmacdev (build, lead) · @antmacdevcodex (QA) · @antux (UX)
**Room:** `iawcdenlgc`
**Visual contract:** Concept D frame `antOSux.pen` at `x=1520 y=-1122`, room region `DUxR1` (drop-hint band already in slice-1-shell.md Region 4)
**Reference PNG:** `docs/concept-d/DUxR1.png` @ 2× — drop-hint band visible at top of room body
**Inheritance:** v0.2.1 ship. BridgesStrip chips are visible-but-passive; drop-hint band in RoomColumn header already promises "Drag any file from Finder — the room becomes evidence-aware." Slice 5 makes that promise true.

---

## Architecture (locked across UX + build + QA)

| # | Decision | SwiftUI / file |
|---|---|---|
| 1 | **Drop target = whole RoomColumn body**, NOT the BridgesStrip chips. Users drag TO the room they're focused on, not TO a chip. | `RoomColumn.swift` — `.onDrop(of: [.fileURL], isTargeted:)` in v1 |
| 2 | **NSItemProvider types** for v1: `.fileURL`. Plain text + URLs defer to Slice 5.5. Finder PDFs/images are covered as file URLs on macOS. | `AttachmentUploadService` filters by `provider.canLoadObject(ofClass: URL.self)` |
| 3 | **Auto-name from filename.** Inline rename is deferred until the shelf has editable attachment/artefact cards. No prompt sheet per drop. | `AttachmentUploadService` uses `fileURL.lastPathComponent` |
| 4 | **No-room-selected drop, Slice 5 v1:** `.onDrop` returns false + a soft toast `"Pick a room first"` surfaces briefly, with the sidebar SAVED ROOMS section highlighting for ~1.5 s to hint where to choose. **v0.2.2 polish upgrade:** add `RoomPickerSheet` (reuses SAVED ROOMS sorted by recency + search field) — drag pending state holds providers, picker dismisses, drop replays against picked room + writes `currentRoom.id`. | v1 path = soft toast in `RoomColumn.swift`; v0.2.2 path = new `Views/Chat/RoomPickerSheet.swift` |
| 5 | **Backend** — existing `POST /api/chat-rooms/:roomId/attachments` endpoint. **NO server work in Slice 5.** Pure Mac app delivery. Artefact metadata is optional follow-up: if the shelf must show the upload under Artefacts, create a second metadata row via `POST /api/chat-rooms/:roomId/artefacts` with `kind: "other"` and `refUrl` pointing at the attachment download URL. | Attachment upload JSON body `{ filename, mimeType, contentsBase64, uploadedByHandle }` → `201 { sharedFile }` |
| 6 | **Multi-file drop allowed.** Sequential upload is the target behaviour; concurrent first-cut is acceptable only as a non-release blocker if the UI state remains correct. One file failing does NOT cancel siblings. | `AttachmentUploadService` collects `[NSItemProvider]`, processes each as one upload entry |
| 7 | **Visual feedback states:** | See Sub-region A below |
| 8 | **Unsupported types** (arbitrary text, executable, archives we won't accept) → silent no-op, cursor returns to default. No toast, no banner. Don't punish the user for trying. | `.onDrop` type filter + provider validation returns false silently |
| 9 | **All tokens via `Tokens.*`** in new files. | grep audit |
| 10 | **BridgesStrip chips stay no-op for Slice 5.** Chips visualise connected services, not drop trays. Slice 7b will invert for bring-in-LLM. | No changes to `BridgesStrip.swift` this slice |

---

## Sub-region A — RoomColumn drop target

**Files:** `Antchat/Views/Shell/RoomColumn.swift` (modify), `Antchat/Services/AttachmentUploadService.swift` (new)

**Visual states:**

| State | Drop-hint band | Cursor | Room body |
|---|---|---|---|
| Idle (no drag) | Default — `Tokens.line.soft` 1 px dashed border, `Tokens.ink.muted` icon + sub label | default | normal |
| Drag enter (over RoomColumn) | Background → `Tokens.Soft.accent` (#FFE2E6), border → `Tokens.accent` 1.5 px dashed, label text → `Tokens.accent` weight 600 | `.copy` | normal |
| Drag over (still hovering) | Same as drag enter | `.copy` | normal — no overlay, no dimming (user can still read the chat behind their cursor) |
| Drag exit | Revert to idle within 100 ms | default | normal |
| Uploading | Drop-hint band shows progress chip: `arrow.up.circle.fill` icon + `"\(filename) · \(percent)%"` + cancel × — appears in the band's right edge | default | normal |
| Multi-file uploading | Progress chip shows `"3 files · 2 of 3 uploaded"`, expands to a small dropdown on hover listing each filename + per-file progress + per-file cancel | default | normal |
| Upload success | Progress chip animates to `Tokens.ok` checkmark + `"\(filename) attached"` (1 s) → fades out → drop-hint band returns to idle | default | Attachment count increments live. If the optional metadata step is implemented, Artefacts count increments too. |
| Upload error | Progress chip → `Tokens.warn` exclamation + `"\(filename) — retry?"` (5 s) with Retry button + dismiss × | default | no chat message appended for the failed file |

**`AttachmentUploadService` shape:**

```swift
final class AttachmentUploadService: ObservableObject {
  @Published private(set) var entries: [UploadEntry] = []
  @Published private(set) var isReceivingDrop: Bool = false

  func handleDrop(providers: [NSItemProvider], roomId: String) -> Bool {
    guard !roomId.isEmpty else { return false }
    // Resolve file URLs, read bytes, base64 encode, POST /attachments.
    return true
  }

  func setReceiving(_ value: Bool) { isReceivingDrop = value }
}
```

**A11y:**
- RoomColumn `.accessibilityLabel("Room \(name), drop files here to attach")` includes the drop affordance
- During upload, progress chip has `.accessibilityLiveRegion(.polite)` announcing `"\(filename) uploading, \(percent) percent"`
- On success / error, `.accessibilityLiveRegion(.polite)` announces final state
- Keyboard users have no drag affordance in this slice (drag is pointer-only); RoomShelf "Attachments" tab will surface an "Add file…" button in Slice 5.5 for keyboard parity

---

## Sub-region B — No-room soft toast

Triggered when user drops a file with `currentRoomId == ""`.

**Slice 5 v1 behaviour:**
- Return `false` from `.onDrop` so no upload starts.
- Surface a soft toast: `"Pick a room first"`.
- Briefly highlight the SAVED ROOMS section for about 1.5 s so the user knows how to recover.
- No upload entries should be created.

**Banked v0.2.2 polish:** `RoomPickerSheet` with saved/recent room search, pending providers held, and replay after room selection.

---

## Sub-region C — Attachment upload flow

**Files:** `AttachmentUploadService.swift` (new or modify — add `uploadAttachments(roomId:providers:)`)

**Flow:**

1. Provider loop: each `NSItemProvider` resolved to a file URL via `loadObject(ofClass: URL.self)`. Skip silently on unresolved.
2. For each file URL:
   - Read bytes, base64-encode, and POST JSON to `POST /api/chat-rooms/:roomId/attachments` with fields `filename`, `mimeType`, `contentsBase64`, and `uploadedByHandle`.
   - Track state through `@Published var entries: [UploadEntry]` that the RoomColumn's progress chip subscribes to. True byte-level progress can be added later if the implementation moves to `URLSessionUploadTask`.
   - On 201 success: `sharedFile.id` is returned. Update the attachment count immediately. Optional: POST a metadata artefact row with `kind: "other"`, `title: filename`, and `refUrl: /api/chat-rooms/:roomId/attachments/:attachmentId` if this slice chooses to mirror uploads into the Artefacts tab.
   - On failure: keep entry in `uploads` with `state = .error`; UI shows retry.
3. After all uploads (success or fail), drop-hint band animates back to idle.

**Message row:** no new message kind in Slice 5. Current server message kinds are `human`, `agent`, `system`, and `system-break`; ordinary `/messages` POST accepts only `human|agent`. If a chat-stream confirmation is needed, post a normal human message containing the attachment markdown link. Otherwise the upload is surfaced through the progress chip + Attachments/Artefacts shelf counts.

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

## PASS gate (locked)

| # | Criterion | Met by |
|---|---|---|
| 1 | RoomColumn accepts `.fileURL` drops; rejects other types silently | manual: drag a non-file payload → no visual feedback, cursor stays default |
| 2 | Drag enter / over / exit visual states match Sub-region A spec | manual + screenshot at each state |
| 3 | Single-file drop → upload → attachment stored via `/attachments`; Attachments count increments immediately. If optional artefact metadata mirroring is implemented, Artefacts count increments too. | manual: drag a PDF → chip succeeds; attachment is listed/downloadable; count goes up |
| 4 | Multi-file drop → sequential upload, per-file progress, one failure doesn't cancel siblings | manual: drop 3 files; mid-upload network failure on file 2 → files 1 + 3 succeed, file 2 shows retry |
| 5 | No-room-selected drop → soft toast `"Pick a room first"` + SAVED ROOMS section highlights briefly | manual: clear currentRoom.id, drag file in, observe toast + highlight, no upload triggered. (v0.2.2 polish replaces with RoomPickerSheet — drag completes against picked room.) |
| 6 | No-room soft-toast path does not create upload entries or orphaned pending state | manual + grep/inspect `uploads` array after a no-room drop |
| 7 | Auto-name from filename; no prompt sheet appears during drop | manual: drop `report.pdf` → status chip / attachment metadata uses `report.pdf` |
| 8 | Errors surface as retry chip (5xx / network) or non-retry chip (413 / 401) per Sub-region C | manual + harness with simulated bad responses |
| 9 | All colours via `Tokens.*`, no raw hex in `RoomColumn.swift` drop UI or `AttachmentUploadService.swift` | grep audit |
| 10 | VoiceOver labels + live-region announcements for upload progress + outcome | VO sweep |
| 11 | `xcodebuild` green + screenshot evidence of idle / drag-over / uploading / success / error states | CI + `docs/concept-d/slice-5-screenshots/` |

---

## File map

**New files:**
- `antchat/Antchat/Services/AttachmentUploadService.swift` (or equivalent) — upload queue, provider resolution, per-file state
- `antchat/Antchat/Wire/AttachmentModels.swift` — share-file request/response models for `/attachments`

**Modified files:**
- `antchat/Antchat/Views/Shell/RoomColumn.swift` — wire `.onDrop` + visual state on drag flag + progress chip overlay on the drop-hint band
- `antchat/Antchat/Core/Network/AntchatAPIClient.swift` — add `shareFileInRoom(...)` + request builder for `/attachments`

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
| `Tokens.Surface.card` | soft-toast / upload chip background |
| `Tokens.Surface.raised` | upload chip raised treatment |

---

## Hand-off

@antchatmacdev — build against `RoomColumn.swift` + `AttachmentUploadService.swift` + `/attachments`. `/artefacts` is metadata-only and optional in this slice; do not wire binary upload there.

@antmacdevcodex — Q5 gate is locked here. The novel patterns this slice are (a) drag visual states (b) progress chip animations (c) no-room-selected soft-toast recovery. `RoomPickerSheet` is banked for v0.2.2, not a Slice 5 blocker.

## Open items
None UX. Q5 locked.
