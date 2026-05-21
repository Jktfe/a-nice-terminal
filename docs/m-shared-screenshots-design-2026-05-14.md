# M-SHARED-SCREENSHOTS — design contract — 2026-05-14 (delta-2 JWPK Q-A/Q-E)

Author: @claude2 TTVPh3mnu8wERzALQLJO6
Gate: canonical @codex2 RQO32LuIK8xmcV7fq04Oq
Source: JWPK Q-A/Q-E answers (surface-size-only + soft-delete) supersede delta-1 caps/TTL/cascade.

## Why

JWPK asked "do we cover this or give the equivalent?" Agents shouldn't
duplicate already-taken captures; users want mark-up. Today's `ant
evidence screenshot` writes to `~/.ant-v3/evidence/screenshots/` but
has no dedup-before-capture or per-room visibility. This slice closes
the gap.

## JWPK locked answers (delta-2, 2026-05-14)

- **Q-A OFF**: per-room opt-in default OFF.
- **Q-B SURFACE-SIZE-ONLY**: NO hard storage cap, NO auto-purge, NO TTL.
  Room-settings UI shows size; user prunes manually.
- **Q-C SAME LANE**: agent-evidence and chat-context captures share the
  room directory; no separate evidence lane.
- **Q-D NO MIGRATION**: existing chat attachments at
  `static/uploads/{sha}.{ext}` stay flat.
- **Q-E SOFT-DELETE + MANUAL PRUNE**: on room delete, preserve files via
  soft-delete; user hard-deletes via prune UI / CLI.

## Scope

IN (T1-T3a):
- Per-room shared pool at `static/uploads/rooms/{room_id}/screenshots/`.
- SQLite `screenshots` table; opt-in `chat_rooms.shared_folder_enabled`.
- Capture-to-temp-then-hash-then-rename atomic flow.
- Routes PUT `/api/chat-rooms/:roomId/screenshots/enable` (pidChain) +
  GET `/api/chat-rooms/:roomId/screenshots` (room-exists).

IN (deferred T3b/T3c):
- `chat_rooms.deleted_at_ms` soft-delete column (room itself becomes
  soft-deletable so FK CASCADE never fires; files + screenshot rows
  survive room deletion).
- `ant screenshot prune --room <id>` CLI verb (soft-delete index row;
  hard-delete-file via `--purge-bytes`).
- Room-settings UI section: list shared files + size + per-row/bulk
  delete + export-before-delete confirmation.
- Capture-wrapper module (capture-to-temp + sha + rename-or-discard).

OUT: cross-room visibility, mark-up editor UI (deck/canvas reference
via `deck_slug` column), cross-machine sync, screenshot-of-non-ANT
content rules.

## Question locks (REJECT to amend)

### Q1 Storage path
`static/uploads/rooms/{room_id}/screenshots/{sha256}.png`. Atomic:
write to `static/uploads/.tmp/<random>.png`, hash, rename only if SHA
not present in this room's index.

### Q2 Index schema (delta-2)
```sql
CREATE TABLE IF NOT EXISTS screenshots (
  sha             TEXT NOT NULL,
  room_id         TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  taken_by        TEXT NOT NULL,
  taken_at_ms     INTEGER NOT NULL,
  bytes           INTEGER NOT NULL DEFAULT 0,
  topic           TEXT,
  dimensions      TEXT,
  parent_sha      TEXT,
  ttl_until_ms    INTEGER,           -- legacy nullable, no enforcement (delta-2)
  deck_slug       TEXT,
  deleted_at_ms   INTEGER,           -- soft-delete: list filters NULL only
  PRIMARY KEY (sha, room_id)
);
CREATE INDEX IF NOT EXISTS idx_screenshots_room_taken
  ON screenshots (room_id, taken_at_ms DESC);
```
SQLite chosen over JSON-manifest (RQO B1 — concurrent agents would
corrupt JSON without locking). FK `ON DELETE CASCADE` STAYS — per RQO
delta-2 caution SQLite cannot ALTER FK without table-rebuild migration.
Soft-delete is achieved at the chat_rooms layer (T3b: rooms become
soft-deletable), not by mutating screenshots FK.

### Q3 Dedup-before-write (RQO B2)
1. Capture → `static/uploads/.tmp/<random>.png`.
2. SHA-256.
3. SELECT `(sha, room_id)` — if present: discard temp, return existing.
4. If absent: rename temp → canonical path; INSERT row.

No storage cap (Q-B). No TTL (Q-B). Disk size is the user's surface.

### Q4 Opt-in flag
`chat_rooms.shared_folder_enabled INTEGER DEFAULT 0`. Capture refuses
with `SharedFolderDisabledError` when 0. CLI `ant screenshot
enable|disable <room-id>` flips it (pidChain-strict).

### Q5 Soft-delete (delta-2)
`screenshots.room_id` keeps FK `ON DELETE CASCADE` (no SQLite ALTER).
Room deletion preservation is achieved at the room layer: T3b adds
`chat_rooms.deleted_at_ms` so room rows are never hard-deleted in
normal flow; FK CASCADE never fires; files + screenshot rows survive.
For T3a, the FK is unchanged and `softDeleteScreenshot(sha, room_id)`
sets `deleted_at_ms` on the index row only — files stay on disk.

### Q6 Routes (delta-2)
- `PUT /api/chat-rooms/:roomId/screenshots/enable` — body `{ enabled,
  pidChain }`, IDENTITY-GATE-strict (M3.6a-v1 precedent). Toggles
  flag; returns `{ enabled }`.
- `GET /api/chat-rooms/:roomId/screenshots` — room-exists-only (matches
  `/messages` GET); returns `{ screenshots: ScreenshotRow[] }` newest-
  first, soft-deleted excluded.
- POST capture route + ant screenshot prune verb land T3b/T3c.

## Acceptance (delta-2)

1. Doc under 180L, canonical RQO PASS.
2. Q1-Q6 + JWPK Q-A/Q-E locked.
3. T1-T3 chunk plan:
   - **T1 (DONE)**: schema + screenshotIndexStore.ts + tests.
   - **T2-WIRING (DONE)**: CLI scaffold + manifest 4 rows + dispatch.
   - **T3a (THIS SLICE)**: doc delta-2 + store refactor (drop caps/TTL,
     add `deleted_at_ms`, soft-delete helper) + routes PUT enable +
     GET list + route tests.
   - **T3b (NEXT)**: chat_rooms.deleted_at_ms migration + room-delete
     soft-delete behaviour + `ant screenshot prune` CLI verb.
   - **T3c (LAST)**: capture-wrapper module + plan_milestone done event.
