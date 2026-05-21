# M4 Remote ANT — design contract

Date: 2026-05-13
Author: @researchant
Status: DESIGN-FIRST. No implementation claims until canonical @codex2 RQO gate PASS.
Cap: ≤260L (mirrors room-mode + responders + discussions contracts).

## TL;DR

Remote ANT lets a second ANT instance join an existing room over a network
boundary. JWPK FL1 (2026-05-13) splits the trust surface in two: human
operators receive readable invite codes; ANT instances exchange opaque
machine tokens. Acceptance window is 20 min from issue. Lifetime presets:
today-until-midnight / 48h / 7d / indefinite. The bridge between local
and remote is a long-lived `chat_remote_mappings` row keyed by an opaque
mapping_id; every cross-bridge message lands in `chat_remote_events`
with mapping + direction + delivery_state + ack. Replay, duplicate,
wrong-room, and unknown-remote events are rejected (no-store) or
quarantined (stored, not delivered) per the taxonomy in Q5.

## Q1 — Token kinds and primitives

Two distinct token kinds, neither sharing storage with `chat_invites`:

- `remote_invite_code` — short, human-readable (e.g. `ANT-7K9-WXP4`), single-use, carries roomId + acceptance TTL + lifetime preset. Stored hashed in `chat_remote_admissions`. v1 brute-force defense (polish D): 20-min acceptance TTL + single-use IS the defense; per-IP rate-limit is v2.
- `remote_bridge_token` — long, opaque (e.g. `rbt_<32-bytes-base64url>`),
  issued by the local instance after the remote operator redeems the
  invite code. The remote instance stores this token; every machine-to-
  machine call from remote → local presents it as `Authorization: Bearer
  rbt_...`. Stored hashed in `chat_remote_mappings` with mapping_id +
  lifetime + revoked_at.

Hash + mint primitives reuse `chatInviteStore` helpers (`hashToken`,
`mintTokenSecret`) but the storage tables and routes are separate so
member-invite drift cannot bleed into bridge-token semantics.

## Q2 — Schema sketch

Three new tables. All append-only timestamps in milliseconds.

`chat_remote_admissions` — operator-issued invite codes:
- id PK, room_id, code_hash, kind=remote-invite, lifetime_preset, ttl_ms
- created_by_handle, created_at_ms, accepted_at_ms NULL, expires_at_ms
- mapping_id_after_accept NULL until redeemed, revoked_at_ms NULL

`chat_remote_mappings` — long-lived bridge identities:
- id PK (mapping_id), room_id, remote_instance_label, bridge_token_hash
- lifetime_preset, expires_at_ms NULL for indefinite, revoked_at_ms
- created_at_ms, last_seen_at_ms, admission_id FK
- direction allowed: in/out/both (default both)

`chat_remote_events` — every cross-bridge message:
- id PK, mapping_id FK, direction in/out, kind message/break/system
- payload_json, status accepted/quarantined (NOT rejected — rejects are no-store, server-log only per B2), status_reason
- created_at_ms, ack_at_ms NULL, delivery_state pending/delivered/failed
- replay_signature for duplicate detection (mapping_id + remote_event_id)

Indexes: idx_admissions_room (room_id, created_at DESC),
idx_mappings_room (room_id, revoked_at), idx_events_mapping (mapping_id,
created_at DESC), uniq_events_replay (mapping_id, replay_signature).

Payload size limit (per polish C): `payload_json` capped at 64KB to
match existing message-route ceiling; oversized → 400 reject with
status_reason=payload_too_large.

## Q1b — Redeem flow concrete (per B1 spec blocker)

1. Local operator runs `ant remote admit --room R --lifetime 48h` → prints `code: ANT-7K9-WXP4`, `admission_id: adm_xyz`, `accept_by: <ts+20m>`. Code + admission_id handed to remote operator out-of-band.
2. Remote operator runs `ant remote redeem --code ANT-7K9-WXP4 --admission-id adm_xyz --remote-url https://local-host` → POSTs `{code}` to local `/api/remote-ant/admissions/:id/redeem`; receives `bridge_token: rbt_<base64>` + `mapping_id: map_abc`; stores both locally. Second redeem of same admission → 410 Gone.
3. `ant remote redeem` is a NEW verb beyond the 6 DELIVERY-PLAN rows — adds a 7th manifest row `remote-redeem` after PASS. SCOPE NOTE: this is REQUIRED-MISSING-SURFACE not scope creep — DELIVERY-PLAN.md predates JWPK FL1 (2026-05-13) which mandates the tiered token model and the operator-on-remote redeem step. Canonical gate should verify intent.

## Q3 — Auth model

- `POST /api/remote-ant/admit` (operator) — admin-bearer required, mints
  invite code; returns code + acceptance window ts.
- `POST /api/remote-ant/admissions/:id/redeem` (remote operator) —
  presents invite code, redeems for `rbt_...` mapping. No admin-bearer
  needed; the code itself is the auth, single-use, hashed-compare.
- `POST /api/remote-ant/bridge/messages` (remote instance) — presents
  `Authorization: Bearer rbt_...`; mapping_id resolved server-side; no
  body field can claim a different mapping (server-resolved-only,
  same rule as IDENTITY-GATE-POSTS).
- `POST /api/remote-ant/mappings/:id/revoke` (operator) — admin-bearer.
- `GET /api/remote-ant/quarantine` (operator) — admin-bearer.

## Q4 — Identity mapping (remote → local handles)

Per JWPK rule "remote handle stays remote": no auto-promotion to local
handles. Remote messages display as `@remote-instance-label/@author` so
the local room sees both the source instance and the remote author. The
mapping row carries `remote_instance_label` set at admission time and
immutable thereafter.

Synthetic rows (per B3 — concrete shape + ownership):
- `terminals`: `id=remote-{mapping_id}`, `pid=NULL`, `name=@{remote_instance_label}`, `agent_kind=remote`, `pane_status=verified` (constant — remote-pane opacity preserved per polish B).
- `room_memberships`: `room_id`, `terminal_id=remote-{mapping_id}`, `handle=@{remote_instance_label}`.
- Owner: `remoteMappingStore.createMapping` writes both in same tx; `revokeMapping` marks inactive (no delete — preserves audit + prevents handle-reclaim race).

## Q5 — Reject vs quarantine taxonomy

Reject (no-store, return 4xx):
- Unknown bearer or revoked mapping → 401, log mapping_id_attempt
- Wrong room (mapping room_id mismatches event room_id) → 403
- Malformed body or oversized payload → 400

Quarantine (store with status=quarantined, do NOT deliver to room):
- Replay (uniq_events_replay collision)
- Duplicate within 60s window (mapping_id + body_hash match)
- Mapping expired between read and write (race) → quarantine for audit
- Unknown sender claim (remote@author not in mapping's claimed set, if
  set restriction is enabled later)

Operator inspects via `ant remote-room quarantine list`; manual
ack/dismiss via `ant remote-room ack <event-id>`.

## Q6 — Acceptance ordering: admission BEFORE identity gate

Established rule from M3.b.4 + IDENTITY-GATE-POSTS: identity gate runs
server-side from the caller's pidChain → terminal → membership. Remote
ANT extends this by inserting a remote-admission step BEFORE the
identity gate runs:
1. Bearer token resolves to mapping_id (remote-admission step).
2. Mapping resolves to synthetic terminal_id.
3. Identity gate runs as if local: terminal → membership → handle.
This order means a revoked mapping fails BEFORE any handle resolution
attempt, so remote-impersonation cannot even reach the identity layer.

## Q7 — CLI verb shapes (6 DELIVERY-PLAN verbs + `remote redeem` = 7)

Per B4 alignment: each manifest row maps to one or more sub-verbs. The
mapping at PASS time will be: `remote-admit` → admit; `remote-redeem`
NEW → redeem; `remote-mapping` → list/show/revoke; `remote-room-send`,
`remote-room-status`, `remote-room-ack`, `remote-room-quarantine` →
their named verbs. 7 manifest rows total after PASS.

- `ant remote admit --room <id> [--lifetime today|48h|7d|indef]` (admin-bearer; mints invite code + admission_id + acceptance window — NO remote-url at admit per B4 reconciliation).
- `ant remote redeem --code <code> --admission-id <id> --remote-url <url>` (NEW, operator-on-remote-instance; presents code to local URL, receives bridge_token + mapping_id; single-use).
- `ant remote mapping list --room <id>` (`--room` REQUIRED v1 mirrors `audit permissions` per polish E; `--include-revoked` is V2 — listActiveForRoom() in remoteMappingStore already filters; future flag adds a separate `listAllForRoomIncludingRevoked()` helper).
- `ant remote mapping show <mapping-id>` — full row, no token bytes.
- `ant remote mapping revoke <mapping-id>` — admin-bearer.
- `ant remote-room send <mapping-id> --msg "..."` — local→remote send;
  bearer = local operator admin-bearer; server queues out-direction
  event.
- `ant remote-room status <mapping-id>` — V2 (M4 v2 count surface, 2026-05-14): wraps GET /api/remote-ant/mappings/:id/status, surfaces mapping detail (id + label + last_seen + direction) PLUS delivery_state counts (accepted + quarantined + delivered + pending + failed) computed via remoteEventStore.countsByMappingId(). CLI falls back to v1 /mappings/:id mapping-detail-only on non-2xx response. (T3 amendment 2026-05-14 PATH A v1 narrow scope is now LIFTED.)
- `ant remote-room ack <event-id>` — operator clears a quarantined
  event after manual review.
- `ant remote-room quarantine list` — admin-bearer; lists quarantined
  events with status_reason.

## Q9 — Bridge-vs-member explicit deltas (per @evolveantcodex 4INRH bar)

The bridge/admit flow MIRRORS chatInviteStore primitives but DIFFERS at
four named points. The contract is not "reuse with tweaks"; the deltas
are enforced by separate stores + separate routes:

| Concern | chat_invites (member, M3.7b) | chat_remote_admissions/mappings (bridge) |
|---|---|---|
| Redeem step | Password-gated exchange → token | None. Code redeems directly to mapping + bridge_token. |
| Identifier | handle-as-identifier | mapping_id-as-identifier; no public handle |
| Trust anchor | Per-room admin-bearer | Per-instance trust anchor: remote_instance_label set at admit, immutable |
| Revoke cascade | Cascades to derived tokens | Cascades to mapping AND quarantines pending in-direction events |

## Q8 — Lifetime presets enforcement

At admission-create time, operator picks one of:
- `today` — expires_at_ms = next 00:00 in the SERVER-LOCAL timezone (TZ env or system default), per B5 spec lock — NOT UTC.
- `48h` — expires_at_ms = now + 48h.
- `7d` — expires_at_ms = now + 7d.
- `indefinite` — expires_at_ms = NULL (never auto-expires; revoke only).

Acceptance TTL of 20 min is enforced separately on the admission row
itself: if `accepted_at_ms` is NULL and `now > created_at_ms + 20min`,
admission is dead even if lifetime hasn't started ticking.

## Locked acceptance (implementation slice, AFTER this contract PASS + JWPK ACK)

- Migrations create chat_remote_admissions + chat_remote_mappings +
  chat_remote_events + their indexes idempotently.
- `remoteAdmissionStore.ts` ≤200L: createAdmission, redeemCode (single-
  use, mints mapping + bridge_token_secret), revokeAdmission, listForRoom.
- `remoteMappingStore.ts` ≤200L: createMapping (called by redeemCode),
  resolveByBearer, revokeMapping, touchLastSeen, listForRoom.
  `touchLastSeen` (per polish A) fires on every successful inbound
  bridge POST AFTER auth resolves, so revoked mappings never bump.
- `remoteEventStore.ts` ≤200L: appendEvent (with replay-collision detect
  → quarantine), markAck, listQuarantine, listForMapping.
- New routes under src/routes/api/remote-ant/* mirror chat-invites
  shape; admit + admissions/[id]/redeem + bridge/messages +
  mappings/[id] + mappings/[id]/revoke + quarantine.
- New scripts/ant-cli-remote.mjs ≤180L: handleRemoteVerb dispatching
  all 7 CLI verbs (admit/redeem/mapping list-show-revoke/remote-room send-status-ack/remote-room quarantine list); admin-bearer resolved via existing
  ANT_ADMIN_TOKEN/--admin-token pattern.
- LIFT-not-COPY: the chatInviteAuth admin-bearer helper extracted in
  M3.7b is the single source of truth for admin verification; new
  remote-ant routes import it. No duplicate admin-bearer parser.
- DUAL-STORE WARNING (per coordinator note): remote-room events live
  ENTIRELY in the fresh-ANT :6461 chat_remote_events table. They do
  NOT interact with the v3 :6458 plan_event store. Future plan-mode
  status-of-remote-event surfaces, if any, must be designed as a
  separate slice.
- Identity-gate insertion: existing identityGate.ts gains a one-line
  remote-admission resolve hook BEFORE pidChain resolution; falls
  through to local pidChain when no Bearer rbt_... header present.
- Manifest: 7 planned rows flip to available (the 6 DELIVERY-PLAN rows + new `remote-redeem` per Q1b SCOPE NOTE) with source_refs as each
  verb's wrapper ships (per standing manifest discipline).

## Do-not-use

| Rejected approach | Why |
|---|---|
| Reuse `chat_invites` for bridge tokens | Member-vs-machine trust boundaries differ. Bridge tokens are long-opaque; member invites are short-readable. Schema collision risks silent privilege escalation. |
| WebSocket-only bridge | HTTP POST works for all 7 verbs and matches existing route shape. WS adds connection-state surface area not needed for v1. |
| Auto-promote remote handles to local | Loses provenance. JWPK rule preserves the remote-instance/remote-author origin in the rendered handle. |
| Token bytes in any GET response | Print only on creation/redemption. Mapping show returns hash prefix only for audit. |

## Open questions for JWPK / team sign-off

1. **Quarantine retention** — keep quarantined events forever, or
   garbage-collect after N days? Default proposal: indefinite, manual
   ack-or-dismiss only. JWPK pick.
2. **Multi-room per mapping** — one mapping per room (current sketch)
   or one mapping serves multiple rooms? Default: one-per-room for
   simpler trust model. JWPK pick.
3. **Direction default** — default `both` for new mappings, or require
   operator to pick at admit time? Default proposal: `both` with `--in`
   `--out` overrides. JWPK pick.
4. **Bridge-token rotation** — mappings with lifetime != indefinite
   support `ant remote mapping rotate <id>` to mint a new token without
   revoking the mapping? Out of scope for v1; flag for v2.
5. **Quarantine notification** — ping the room on first quarantine
   event or stay silent until operator inspects? Default: silent.

## What I did NOT verify

- Did NOT prototype any of the 3 stores or routes. Cap-aware design
  only.
- Did NOT measure replay_signature collision rate under realistic remote
  message volume — sketched as `(mapping_id, remote_event_id)` UNIQUE
  index; perf to be verified at implementation.
- Did NOT survey existing rate-limiting infrastructure for the bridge
  endpoint. Likely needs a dedicated per-mapping rate-limit at impl.
- Did NOT design the WS/SSE push path for remote-room status updates.
  HTTP poll is the v1 contract; WS is a v2 conversation.

## Next step

1. Post slice-ready in antDevTeam for canonical @codex2 RQO + 4INRH gate.
2. Surface 5 open questions to JWPK in EvoluteAnt for sign-off.
3. After PASS + JWPK ACK: implementation claim-first by future researchant
   or whoever picks (cap-2 discipline applies; design-first established
   here means future implementer cannot widen scope without amendment).

End of contract.
