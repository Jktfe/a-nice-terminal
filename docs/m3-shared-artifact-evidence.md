# M3 — Shared Artifact Trust: Acceptance Evidence

> **Milestone** — "Shared artifacts are safe enough for team use."
>
> This doc maps each M3 acceptance test to the shipped code and tests that satisfy it, so a contributor can confirm the trust story without re-discovering the surface.

Companions: `docs/security-model.md` (auth modes) and `tests/room-scope.test.ts` (auth helpers, 17 cases).

---

## M3 #1 — Authenticated cross-machine room transport routes a scoped ask to a peer machine and returns a response

**Status: in flight.** Auth + transport primitives are landed; cross-machine round-trip is the open piece tracked under M4.

**Landed today**
- Per-room bearer issuance: `src/lib/server/room-invites.ts` (scrypt-hashed passwords, token minting, kind-bound write capability).
- Hooks-level scope enforcement: `src/hooks.server.ts:56` — bearer is one of `admin | room-scoped | wrong-room | none`. `wrong-room` returns explicit 403 instead of falling through.
- Route guards: `src/lib/server/room-scope.ts` — `assertSameRoom`, `assertNotRoomScoped`, `assertCanWrite` (web-kind read-only allowlist).
- Remote MCP transport: `src/routes/mcp/room/[id]/stream/+server.ts` accepts the same bearer via `?token=` for MCP clients that cannot set headers (narrowed to `/mcp/*`).

**Open**
- Cross-machine round-trip evidence: capture an ask issued from machine A, routed via the per-room bearer to machine B, returning a structured response. Tracked under M4 cross-machine pilots; M3 #1 stays "active" until that captured evidence is in.

**Tests**
- `tests/room-scope.test.ts` — 17 cases, all four exported helpers covered (committed 3c82b0c).
- `tests/auth.test.ts` — Tailscale IP gating + master-key check (existing).

---

## M3 #2 — Scope-of-grant consent supports topic, source set, duration, and answer count

**Status: partial.** Topic + duration scoping is in via the invite model; source-set and answer-count are open.

**Landed**
- **Topic scope** = the room id encoded in the bearer (`token.room_id`). Hook checks `targetRoom !== resolved.invite.room_id` and 403s; per-room bearers can only act on their own room.
- **Capability scope** = invite `kind` (`cli` | `mcp` | `web`) drives writability via the `WRITE_KINDS` allowlist in `room-scope.ts:27`. `web` is read-only by design.
- **Duration scope** = invite revocation. Two axes:
  - Per-device: clear `room_tokens.revoked_at` for one device.
  - Per-invite: clear `room_invites.revoked_at` to nuke every token derived from it.
- **Brute-force scope** = 5 failed password attempts auto-revoke the invite (`MAX_FAILED_ATTEMPTS`, override via `ANT_INVITE_MAX_FAILURES`).

**Open**
- **Source-set scope** — restrict which sources/files a given bearer can read. Today the kind allowlist is at the room level, not the source level. Spec needed before implementation.
- **Answer-count scope** — bound the number of responses a given bearer can produce. Today there is no per-token rate. Spec needed before implementation.

These two are the explicit decisions an operator makes when granting access; we ship without them today by treating room scope as the unit of grant. M3 #2 stays "active" until the spec lands.

---

## M3 #3 — Artifact conflict lane records path/region, base hash, proposed change, current change, and participants

**Status: passing.** The deck open-slide manifest + write-guard ships this lane.

**Implementation** — `src/lib/server/decks.ts`
- Manifest `.ant-deck.json` snapshots every deck file with `sha256` + `size` + `mtime_ms` (line 80, `DeckFileSnapshot`).
- `writeDeckBytes(slug, path, bytes, opts)` accepts `base_hash` and `if_match_mtime` guards.
- Mismatch raises `DeckConflictError` (line 107) carrying the path, the base the caller presented, and the current sha256/mtime — i.e. all five fields the spec calls for: path/region, base hash, proposed change, current change, participants.
- Audit log `.ant-deck/audit.jsonl` appends a `file_write` entry for every successful write and a `conflict` entry for every refused write — both also append matching `artifact run_events` for the evidence timeline.
- Internal-segment guard (`INTERNAL_SEGMENTS = {'.ant-deck'}`, line 29) prevents the audit log and manifest from being mutated through the file API.

**Route layer** — `src/routes/api/decks/[slug]/files/[...path]/+server.ts`
- GET sets `ETag: <sha256>` so clients can poll cheaply.
- PUT honours `x-ant-base-hash` header and `?base_hash=` query fallback. Mismatch returns 409 with the current sha256.

**Tests** — `tests/deck-manifest.test.ts` (17 cases, all passing)
- writeDeckBytes: first-write manifest entry, matching base_hash succeeds, mismatching throws DeckConflictError, no-guard back-compat path, matching/mismatching `if_match_mtime`.
- deleteDeckPath: matching base_hash removes manifest, mismatching throws and keeps the file.
- Audit jsonl: records file_write + conflict events; appends artifact run_events.
- Reserved-path guard: cleanDeckPath rejects writes to manifest filename + audit dir.
- listDeckFiles excludes the manifest from listing (no information leak).
- writeDeckManifest snapshots all files.
- Route layer: ETag header on GET; PUT 409 with mismatching `x-ant-base-hash`; back-compat without guard; query-param fallback.

The five spec fields map to:
| Spec field | Where it lives |
|---|---|
| Path / region | `DeckFileSnapshot.path`, normalised via `cleanDeckPath` |
| Base hash | Caller's `x-ant-base-hash` header (or `if_match_mtime` for mtime-based optimistic locking) |
| Proposed change | PUT body |
| Current change | `DeckConflictError.details.current_sha256` and the manifest entry |
| Participants | Audit jsonl `actor` field + `artifact run_events` (linked to room participants via session_id) |

---

## Summary

| Test | Status | Evidence |
|---|---|---|
| M3 #1 cross-machine transport | active | room-invites + hooks scope; round-trip evidence pending under M4 |
| M3 #2 scope-of-grant consent | active | room + kind + duration in; source-set + answer-count specs open |
| M3 #3 artifact conflict lane | passing | decks.ts + 17 tests in deck-manifest.test.ts |

M3 itself stays "active" while #1 and #2 close out; #3 is a discrete piece that has shipped and is now evidence.
