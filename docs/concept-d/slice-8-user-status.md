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

## Sub-region D — Agent-behaviour contract — REMOVED FROM SLICE 8 SCOPE

**Per JWPK `msg_e1u1mrgk8v`:** status in Slice 8 is **decoration + cross-room visibility only**. The agent-behaviour matrix (queue-vs-digest, ping-vs-defer, escalation thresholds) is being developed by other agents as a separate substrate feature; ANT just provides the status primitive that the eventual routing layer will read.

**What Slice 8 ships:**
- User picks a status (UI — Slice 8 MVP, already shipped at `4e9ed78`)
- Status persists locally + syncs to server (Sub-regions A + B)
- Status visible on member avatars across rooms + on the toolbar profile chip (Sub-region C)
- That's it.

**What Slice 8 does NOT ship:**
- No `member_return_digest` table
- No agent dispatch logic reading `target.status`
- No queue-vs-digest gating
- No "Chair reads status" coupling (Slice 6 is independent for now)

**Future plumbing:** when the substrate-routing feature lands (owned elsewhere), it consumes the `identities.status` column written by this slice's endpoint. No coordination needed today.

**Existing CVE-fix-D-style auth gate:** status changes do NOT bypass identity verification — only the AUTHENTICATED user can change their own status. No agent-impersonation of status changes.

---

## PASS gate (proposed — pending @antmacdevcodex final wording)

| # | Criterion | Met by |
|---|---|---|
| 1 | `PATCH /api/identity/status` persists + returns updated identity | curl harness + DB inspection |
| 2 | Status change fans out via `member_status_changed` event to every room the user belongs to | manual: change status on device A in room R1, observe event delivery on device B in room R2 |
| 3 | Mac client `IdentityStatusService` write-through is optimistic + reverts on server failure | manual + simulated 500 |
| 4 | Avatar status dot renders for every room member in the avatar stack + focus drawer; correct token color per status | screenshot sweep of 3-status states |
| 5 | Toolbar profile chip shows current user's status dot | screenshot sweep |
| 6 | VoiceOver labels: every status dot has `accessibilityLabel("status: \(name), \(status.label)")` | VO sweep |
| 7 | All tokens via `Tokens.*`, no raw hex in `IdentityStatusService` / `MemberAvatar` / status views | grep audit |
| 8 | `xcodebuild` green + server tests green + screenshot evidence | CI + `docs/concept-d/slice-8-screenshots/` |

*(Per JWPK `msg_e1u1mrgk8v` — agent-behaviour matrix gates removed from Slice 8. Status is decoration-only this slice; the routing layer that consumes status is being developed elsewhere.)*

---

## File map

**New (server):**
- `src/routes/api/identity/status/+server.ts` — PATCH route
- DB migration: add `status` + `status_changed_at` columns to `identities`
- *(no `member_return_digest` table — that was for the agent-behaviour matrix which is no longer in Slice 8 scope per JWPK `msg_e1u1mrgk8v`)*

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
- *(none — agent dispatch logic was Sub-region D, removed from Slice 8 scope per JWPK `msg_e1u1mrgk8v`)*

---

## Tokens used

| Token | Used by |
|---|---|
| `Tokens.ok` `#1AC270` | Working status dot |
| `Tokens.warn` `#FFB100` | Away from desk dot |
| `Tokens.ink.muted` `#8A7A70` | Away from office dot |
| `Tokens.Surface.raised` `#FFF0DF` | status-dot 2 px stroke ring (separates from avatar) |

---

## Slice 8 → Slice 6 handshake — DECOUPLED

Per JWPK `msg_e1u1mrgk8v`, Slice 8 status is decoration-only; Slice 6 ★ Chair (now correctly framed as an agent-kind per `project_chair_is_agent_kind_2026_05_23`) does **NOT** depend on `user.status`. The two slices are independent. The eventual feature that plumbs `user.status` into agent-routing is owned elsewhere and will consume the `identities.status` column without any coordination from Slice 6 or Slice 8.

## Open items

None UX. Awaiting @antmacdevcodex PASS gate ratification + server route owner (codex or substrate agent).

## Hand-off

@antchatmacdev — when ready, Mac client work is: extract `MemberAvatar` shared component + thread `IdentityStatusService` through `AppShellView` + cross-room dot rendering. Should be small.

Server route + DB migration + agent-dispatch behaviour matrix is a separate ownership — likely @codexuxant or whoever picks up substrate-side. Spec includes the contract so server work can land in parallel with Mac work.
