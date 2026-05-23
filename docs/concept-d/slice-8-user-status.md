# Slice 8 — User Status (Working · Away from desk · Away from office)

**Status:** spec ready (MVP UI + local persistence already shipped at `antchat 4e9ed78`); this spec covers the NEXT chunk — server sync + cross-room visibility + agent-behaviour contract
**Owners:** @antchatmacdev (Mac build) · @antux (UX + substrate contract) · @antmacdevcodex (QA) · server-side agent TBD
**Room:** `iawcdenlgc`
**Visual contract:** room header status-menu button (already shipped); cross-room status dots on avatar stacks + toolbar profile chip — new in this slice
**Inheritance:** v0.2.1 (shell on brew) + `4e9ed78` (Slice 8 MVP: enum, menu button, `@AppStorage("user.status")` local persistence)

---

## Architecture (locked across UX + build)

| # | Decision | Touches |
|---|---|---|
| 1 | **Server endpoint:** `PATCH /api/identity/status` — body `{ status: "working" \| "away_desk" \| "away_office" }`, returns the persisted record + an updated user object | new SvelteKit route in `src/routes/api/identity/status/+server.ts` |
| 2 | **Fan-out:** status change emits a `member_status_changed` event on every room the user is a member of, via the existing room-event channel | server: `chatRoomBroadcast(roomId, { kind: 'member_status_changed', handle, status })` |
| 3 | **Mac sync:** new `IdentityStatusService` at `AppShellView` root mirrors `@AppStorage("user.status")` (write-through to server) + subscribes to room-event stream for OTHER members' status | `Antchat/Services/IdentityStatusService.swift` + extend `MessagesService` event subscription to forward `member_status_changed` |
| 4 | **Avatar status dot:** every member-avatar in the room header avatar stack + RoomShelf focus drawer gets an 8 × 8 dot at the bottom-right corner, colored per status (`Tokens.ok` / `Tokens.warn` / `Tokens.ink.muted`). Mirrors Slack's presence dot pattern. | `Antchat/Views/Components/MemberAvatar.swift` (new shared component or modify existing) |
| 5 | **Toolbar profile chip:** the existing James-avatar in the toolbar gets the same dot for cross-room visibility — user can see their own status without entering a room | `AntToolbar.swift` profile chip — add dot overlay |
| 6 | **Agent-behaviour contract:** see Sub-region D below. This is the substrate-primitive part of Slice 8. | server-side agent treatment logic + `ant agents` CLI reads `target.status` |
| 7 | **Multi-device:** identity is server-side. iPhone remoteant (future) writes to the same endpoint; macOS subscribes. Last-write-wins; no conflict resolution needed for v0.2. | endpoint design + Mac sync |
| 8 | **macOS Focus mode integration:** OPTIONAL — if `NSWorkspace.shared.notificationCenter` exposes Focus state, auto-pre-fill status to "Away from desk" when system Focus is "Do Not Disturb." User can override. | bank as v0.2.x polish; not required for Slice 8 |
| 9 | **All tokens via `Tokens.*`** | grep audit |

---

## Sub-region A — Server endpoint · `src/routes/api/identity/status/+server.ts`

**`PATCH /api/identity/status`**

Request:
```json
{ "status": "working" }
```

Response (200):
```json
{
  "identity": {
    "handle": "@james",
    "status": "working",
    "statusChangedAt": "2026-05-23T15:42:00Z"
  }
}
```

**Persistence:** new column `status: TEXT NOT NULL DEFAULT 'working'` + `status_changed_at: TEXT` on `identities` (or equivalent) table. Migration shipped alongside the endpoint.

**Fan-out:** after persist, for every room the user is a member of:
```ts
chatRoomBroadcast(room.id, {
  kind: 'member_status_changed',
  handle: user.handle,
  status: user.status,
  changedAt: user.statusChangedAt
})
```

This rides the existing room-event channel — no new transport.

**Validation:** status must be one of `"working"`, `"away_desk"`, `"away_office"`. Anything else → 400.

**Auth:** standard identity gate.

---

## Sub-region B — Mac client sync · `IdentityStatusService.swift`

```swift
@MainActor
final class IdentityStatusService: ObservableObject {
  @AppStorage("user.status") private var local: String = "working"
  @Published private(set) var remote: UserStatus = .working
  @Published private(set) var memberStatuses: [String: UserStatus] = [:]   // handle → status

  func write(_ status: UserStatus) async {
    local = status.rawValue
    // optimistic
    do {
      let resp = try await apiClient.patchIdentityStatus(status: status)
      remote = resp.identity.status
    } catch {
      // revert on failure — local stays as user's intent but flag for retry
    }
  }

  func handleRoomEvent(_ event: RoomEvent) {
    if case let .memberStatusChanged(handle, status, _) = event {
      memberStatuses[handle] = status
    }
  }
}
```

The menu button from Slice 8 MVP (already in `RoomColumn.swift`) shifts from writing to `@AppStorage` directly to calling `identityStatusService.write(_:)`. The local mirror is preserved so optimistic UI stays fast.

`MessagesService` event subscription forwards `member_status_changed` to `identityStatusService.handleRoomEvent`.

---

## Sub-region C — Cross-room indicators

**Avatar status dot:**
- 8 × 8 ellipse at bottom-right of the 30 × 30 avatar circle
- 2 px `Tokens.Surface.raised` stroke (so the dot reads as separate from the avatar)
- Color: `Tokens.ok` `#1AC270` (Working), `Tokens.warn` `#FFB100` (Away from desk), `Tokens.ink.muted` `#8A7A70` (Away from office)
- Used in: room header avatar stack (Slice 4), RoomShelf focus drawer member rows, Saved-rooms-list footer member handles (Slice 2)

**Toolbar profile chip dot:**
- Same dot, on James-avatar in the NSToolbar profile chip
- Always visible — communicates "this is my current status" without needing to enter a room

**Member status default:**
- Members without a known status (not in `memberStatuses` cache yet) render no dot — empty state is "we don't know"
- On first room-event subscribe, the server pushes a snapshot of all members' current statuses so the cache populates quickly

---

## Sub-region D — Agent-behaviour contract (the substrate-primitive part)

**This is the load-bearing piece.** Without it, status is decoration. With it, status routes agent behaviour across the whole substrate.

| Status | @-tag pinging | Asks fanout | Chair (Slice 6) | Autonomous escalation |
|---|---|---|---|---|
| **Working** | Immediate ping in-room | Cross-room fanout per existing rules | Live session-replay banner on return | Standard escalation thresholds |
| **Away from desk** | Defer to digest on return (queue in `member_return_digest`); only `urgent` asks ping immediately | Same cross-room fanout but DOWNGRADE non-urgent | Digest-only — no live replay, summary banner on return | Threshold raised — only critical blockers reverse-escalate |
| **Away from office** | All asks queue to digest; no live pings | Fanout to other available members preferred; user's queue grows but no notifications | Digest with daily-summary frequency, not return-trigger | Threshold raised further — only blocker-with-no-other-path |

**Where this lives:**
- Per-agent server logic: `agents.handleAsk(target:, ask:)` reads `target.status` + applies the matrix
- `member_return_digest` table — accumulates queued items per (handle, room) when target is non-working; flushed when target → working
- `ant agents` CLI surfaces status-aware queue sizes — e.g. `"@james has 14 queued asks (away from desk for 2h)"`
- Slice 6 ★Chair reads status to gate queue-vs-digest UI
- Future Slice X autonomous-escalation reads status to bound aggressiveness

**Existing CVE-fix-D-style auth gate:** status changes do NOT bypass identity verification — only the AUTHENTICATED user can change their own status. No agent-impersonation of status changes.

**Important non-goal:** status is NOT a global Do-Not-Disturb. Critical asks still cut through "Away from desk" — defined by `ask.priority == "critical"`. The contract defines DEFAULTS, not absolutes.

---

## PASS gate (proposed — pending @antmacdevcodex final wording)

| # | Criterion | Met by |
|---|---|---|
| 1 | `PATCH /api/identity/status` persists + returns updated identity | curl harness + DB inspection |
| 2 | Status change fans out via `member_status_changed` event to every room the user belongs to | manual: change status on device A in room R1, observe event delivery on device B in room R2 |
| 3 | Mac client `IdentityStatusService` write-through is optimistic + reverts on server failure | manual + simulated 500 |
| 4 | Avatar status dot renders for every room member in the avatar stack + focus drawer; correct token color per status | screenshot sweep of 3-status states |
| 5 | Toolbar profile chip shows current user's status dot | screenshot sweep |
| 6 | Agent-behaviour matrix in Sub-region D implemented server-side: at minimum, the @-tag pinging behaviour changes per status | server harness — fire @-tag at different status targets, observe ping vs digest queue |
| 7 | `member_return_digest` table populates on non-working → working transitions, flushes on transition to working, and an at-return banner appears | manual: set Away from desk, send asks, return to Working, see digest banner |
| 8 | `ant agents` CLI surfaces queue size + status for each agent | terminal output capture |
| 9 | VoiceOver labels: every status dot has `accessibilityLabel("status: \(name), \(status.label)")` | VO sweep |
| 10 | All tokens via `Tokens.*`, no raw hex in `IdentityStatusService` / `MemberAvatar` / status views | grep audit |
| 11 | `xcodebuild` green + server tests green + screenshot evidence | CI + `docs/concept-d/slice-8-screenshots/` |

---

## File map

**New (server):**
- `src/routes/api/identity/status/+server.ts` — PATCH route
- DB migration: add `status` + `status_changed_at` columns to `identities`
- New `member_return_digest` table (id, handle, room_id, accumulated_json, last_updated_at)

**New (Mac):**
- `antchat/Antchat/Services/IdentityStatusService.swift`
- `antchat/Antchat/Views/Components/MemberAvatar.swift` — shared avatar-with-status-dot component

**Modified (Mac):**
- `antchat/Antchat/Views/Shell/RoomColumn.swift` — `statusMenuButton` writes via `identityStatusService` (not directly to AppStorage)
- `antchat/Antchat/Views/Shell/AntToolbar.swift` — profile chip gains status dot
- `antchat/Antchat/Views/Shell/RoomShelf/InterviewsPanel.swift` + any other panel listing members — use new `MemberAvatar` component
- `antchat/Antchat/Services/MessagesService.swift` — forward `member_status_changed` events to `IdentityStatusService`
- `antchat/Antchat/AppShellView.swift` — instantiate `IdentityStatusService()` + inject

**Modified (server):**
- agent dispatch logic (file TBD — wherever asks are routed to targets) reads `target.status` and applies the Sub-region D matrix

---

## Tokens used

| Token | Used by |
|---|---|
| `Tokens.ok` `#1AC270` | Working status dot |
| `Tokens.warn` `#FFB100` | Away from desk dot |
| `Tokens.ink.muted` `#8A7A70` | Away from office dot |
| `Tokens.Surface.raised` `#FFF0DF` | status-dot 2 px stroke ring (separates from avatar) |

---

## Slice 8 → Slice 6 handshake

Slice 6 (★ Chair / ★ Validation) must read `identityStatusService.remote` (or its equivalent server-side `target.status`) when deciding queue-vs-digest behaviour. This spec locks the contract so Slice 6 can build against it.

## Open items

None UX. Awaiting @antmacdevcodex PASS gate ratification + server-side agent dispatch implementation owner.

## Hand-off

@antchatmacdev — when ready, Mac client work is: extract `MemberAvatar` shared component + thread `IdentityStatusService` through `AppShellView` + cross-room dot rendering. Should be small.

Server route + DB migration + agent-dispatch behaviour matrix is a separate ownership — likely @codexuxant or whoever picks up substrate-side. Spec includes the contract so server work can land in parallel with Mac work.
