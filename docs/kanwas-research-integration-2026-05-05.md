# Kanwas Research Integration Note

Date: 2026-05-05

Status: First slice shipped. This note documents what landed and what was deliberately deferred.

## Source Check

- Repo: https://github.com/kanwas-ai/kanwas
- Inspected: README, docs/SYSTEM_OVERVIEW.md, execenv sync code, live-state-server, CLI pull/push.

## What Kanwas Gets Right

- One canonical workspace state mirrored to a normal filesystem so agents can use file tools.
- All agent actions/tool progress stream into the same visible timeline as human work.
- Pull/push uses snapshot hashes and three-way conflict detection.
- Filesystem watchers are queued/serialized to avoid racey metadata/file writes.
- Local helper APIs let agents resolve/apply canvas section placement instead of scraping/guessing.
- `kanwas pull` exports a portable markdown handoff format.
- Per-block `source_event_id` provenance so every claim traces to a run/message.

## What Open Slide Was Missing

Open Slide already had: deterministic React deck export, room-scoped file API, raw-bytes-stay-in-ANT contract.

Open Slide did not have, prior to this slice:
- Deck file integrity beyond mtime.
- Conflict detection on concurrent agent writes.
- Audit trail for export/write/delete events.
- Source-evidence provenance on the exported deck itself.

## What Shipped (2026-05-05)

Co-built by codex (manifest/audit/CLI/route core) and claude (tests, route header verification, lane coordination).

1. `<deck_dir>/.ant-deck.json` manifest. `schema_version=1`, `kind=ant-open-slide-deck`. Snapshots every file with `sha256+size+mtime`, plus `source_session_id`, `source_evidence_hash`, `generator`. Written atomically on every successful `writeDeckBytes` / `deleteDeckPath`.
2. `<deck_dir>/.ant-deck/audit.jsonl`. One line per event. Emits `file_write`, `file_delete`, `conflict`, `export`.
3. Reserved-path guard. `cleanDeckPath` rejects any segment matching `.ant-deck` or filename `.ant-deck.json` with "internal metadata not editable". Listing excludes hidden files except `.env.example`.
4. Optimistic write/delete guard. `DeckWriteGuard { base_hash?, if_match_mtime?, actor? }` passed into `writeDeckBytes`/`deleteDeckPath`. If supplied and stale, throws `DeckConflictError` (status 409) and emits a `conflict` audit event. Absent guard = back-compat write.
5. HTTP semantics on `/api/decks/:slug/files/[...path]`:
   - GET: returns `ETag: "<sha256>"`, `X-ANT-Deck-Sha256`, `X-ANT-Deck-Mtime-Ms`.
   - PUT/DELETE: read `x-ant-base-hash` header or `?base_hash=` query, plus `x-ant-if-match-mtime` / `?if_match_mtime=`. 409 on mismatch.
6. `writeOpenSlideDeck` stamps `source_evidence_hash = sha256(JSON.stringify(evidence))` on the manifest and emits one `export` audit event.
7. Agent-facing CLI: `ant deck list`, `ant deck status <slug>`, `ant deck manifest <slug>`, `ant deck audit <slug>`. New `GET /api/decks/:slug/audit`.
8. Successful writes/deletes broadcast `deck_updated` WS events to allowed rooms.

## Verification

- 167/167 vitest, 0 type errors, 0 svelte-check warnings.
- Both guard modes (`base_hash` + `if_match_mtime`) tested for hit and miss.
- Audit jsonl verified for `file_write` and `conflict` events.
- ETag round-trips through GET → PUT If-Match header.
- Live smoke against `https://localhost:6458` created a temp deck, exercised `ant deck status`, wrote slides, read `ant deck audit`, cleaned up.

## What Was Deferred

Deliberately deferred to keep the first slice small and reversible:

- CRDT/Yjs co-edit. Open Slide is evidence-as-output, not a shared work surface. Snapshot-per-session is fine until Open Slide becomes genuinely multiplayer.
- `ant deck pull` markdown export for portable handoff. Strong candidate for next slice.
- `ant deck push` three-way merge.
- Watcher/queue around deck dirs so manual edits feed back into ANT timeline.
- Agent-facing helper surface beyond status/manifest/audit: `ant deck outline`, `add-slide --after`, `validate`, `screenshot`, `check-overflow`, `notes`.
- Per-block `source_event_id` provenance inside slide content (deferred until structured-edit helpers exist).

## Why This Fits ANT

Open Slide stays evidence-as-output, and now every export and every agent edit leaves a verifiable trail. Two agents writing to the same deck cannot silently overwrite each other. The manifest gives a deterministic head hash so future `pull/push/watch` semantics have something to compare against without reading every byte.

## Coordination Lesson

Two agents converged on the same problem with overlapping designs. claude started a parallel `deck-manifest.ts` module before realising codex had built the same logic into `decks.ts`. Deleting the orphan and pivoting to "tests + route header semantics + memory write-up" was faster than trying to merge two implementations of the same module. Trust the other agent's core; claim non-conflicting work.
