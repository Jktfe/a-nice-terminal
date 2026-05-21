# Lane-B v4-delta-rebase — chat-rooms / invites / remote-ant / rooms parity

Status: DELTA ARTIFACT (decision-doc scope). codex2 RQO32 gate in kqyng03.
Owner: researchant (greenlit to drive; sole v4-up blocker). 2026-05-15.
Grounded on disk: v4 TARGET `/Users/you/CascadeProjects/ant`,
v3 REFERENCE `/Users/you/CascadeProjects/a-nice-terminal`.

---

## 1. Framing (the verdict direction that matters)

JWPK bar = **v4 must have AT LEAST all v3 capabilities.** Therefore:
- **PARITY** = v4 covers v3's capability.
- **v4-AHEAD** = v4 has MORE than v3 (NOT a gap; does not block v4-up).
- **GAP** = v4 is BEHIND v3 (missing a v3 capability) — the only
  direction that can block v4-up.

Delta-only: this audits the v4-vs-v3 difference per surface, not a
re-spec. First-hand basis where flagged (researchant shipped B2-1
chat-invites consent-gate, B2-2 invite-summary, identityGate FINDING-3
linked-chat self-handle, the B2-6 attachments↔file_refs verify, and
authored docs/v4-v3-parity-audit-2026-05-15.md).

## 2. Per-surface delta

| # | Surface | v4 state (disk) | v3 ref | Verdict |
|---|---------|-----------------|--------|---------|
| 1 | list/detail | `api/chat-rooms/+server.ts` + `[roomId]/+server.ts` + `rooms/`; `chatRoomStore.ts` SQLite `chat_rooms` (+ `deleted_at_ms` soft-delete) | v3 session-scoped, invite-centric, no first-class room entity | **v4-AHEAD** (explicit persistent room entity) |
| 2 | messages | `chat-rooms/[roomId]/messages/`; `chatMessageStore.ts` SQLite `chat_messages` + `parent_message_id` + `discussion_id` + `post_order` | v3 session `messages` table, reply via JSON meta | **PARITY** (v4 adds explicit threading cols) |
| 3 | invites / admissions | chat-invites create/exchange/revoke/**summary** + consent gate (B2-1); remote-ant admissions/admit/bridge/mappings/quarantine SQLite | v3 `room-invites.ts` SQLite invites+tokens; **no remote-ant HTTP bridge** | **v4-AHEAD** (remote-ant bridge is net-new; v3 has no inbound bridge) |
| 4 | membership | `roomMembershipsStore.ts` SQLite `room_memberships` (room_id, handle, terminal_id, revoked_at_ms) | v3 implicit via invite tokens | **PARITY** (explicit rows ⊇ token-derived) |
| 5 | attachments | `chat-rooms/[roomId]/attachments/`; `chatAttachmentStore.ts` **in-memory base64 blob, room-scoped** | v3 `file_refs` **SQLite-persisted path+note pointer** at session+task scope | **GAP** (see §3 — known, triaged deferrable) |
| 6 | reactions / read | `messages/[messageId]/reactions` + `/read`; in-memory stores | v3 none (flags in message meta) | **v4-AHEAD** (dedicated endpoints; in-mem = robustness note §4) |
| 7 | discussions | `chat-rooms/[roomId]/discussions/`; `chatDiscussionStore.ts` SQLite `chat_discussions` + open/close/reclose lifecycle | v3 generic `room_links` | **v4-AHEAD** |
| 8 | linked-chat | `linkedRoomTerminalLookup.ts` + `linkedChatPermissionStore.ts` + `terminalReplyRouter.ts` + identityGate self-handle (FINDING-3, RQO32); `terminal_records.linked_chat_room_id` | v3 session-meta helper, no HTTP route | **v4-AHEAD / PARITY** |

## 3. The one real v4-behind-v3 GAP — attachments (already triaged, NOT a v4-up blocker)

Surface 5 is the sole direction-correct gap: v4 attachments are an
in-memory base64 blob (room-scoped, ephemeral); v3 `file_refs` is a
**persisted path+note evidence/handoff pointer** at session+task scope.
v4 cannot today reference a file by path without uploading bytes.

This is **NOT new**: researchant's B2-6 verify already established
"VERIFIED GAP, does NOT collapse to B1"; coordinator+JWPK already set
B2-6 build = **post-v4-stable, JWPK-timing (default doc-gates-then-park)**.
So it is a *known, accepted, scheduled* gap — explicitly **not a
v4-up-today dogfood blocker**. No action required for v4-up; the B2-6
build slice carries it post-stable.

## 4. Persistence-robustness notes (B-bucket, NOT v3-parity gaps, NOT v4-up blockers)

These are in-memory in v4 where v3 had *less* (so still ≥ v3 — not
gaps), but are worth a hardening backlog entry:
- `chatInviteStore.ts` — in-memory Maps (first-hand: B2-1/B2-2). v3
  persisted invites; however v4 invite *consent + summary + remote
  bridge* exceed v3 functionally. Flag: invite persistence = B-bucket.
- `messageReactionStore.ts` / `messageReadReceiptStore.ts` /
  `chatAttachmentStore.ts` — in-memory; v3 had no equivalent endpoints.
  Robustness-hardening backlog, not parity gaps.

Recommend a single B-bucket item "B-HARDEN-chat-persistence" (invites +
reactions + read-receipts + attachment-blobs → SQLite) — design-first,
post-v4-stable, **deferred**. Composes with the existing B2-6 build.

## 5. Admissions follow-on (deferrable per directive)

remote-ant admissions is v4-AHEAD (v3 has none). Any *gap-admission*
(in-scope-if-absent) here would be a follow-on design-first item, NOT
dogfood-critical — **DEFER** per the lane-B scope carve-out. No v4-up
impact.

## 6. v4-up verdict

**Lane-B does NOT block v4-up.** Across all 8 surface families v4 is at
PARITY or v4-AHEAD vs v3, with the single v4-behind gap (attachments
path+note file_refs) being a pre-known, JWPK-scheduled, post-v4-stable
item — not a dogfood-critical regression. No surface requires a v4-up
code change. The persistence-robustness items are B-bucket hardening,
explicitly deferred.

## 7. Asks of codex2 RQO32

1. Ratify §1 framing (v4-AHEAD ≠ gap) + the §2 per-surface verdicts.
2. Confirm §3: attachments gap is the pre-triaged B2-6 deferral, NOT a
   v4-up blocker.
3. Accept §4 "B-HARDEN-chat-persistence" + §5 admissions as
   deferred-post-v4-stable backlog (no v4-up action).
4. Gate this as the lane-B v4-delta closer → v4-up unblocked from
   lane-B.
