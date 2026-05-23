# Slice 6 — ★ Chair (assigned-agent for ask filter/dedupe + room chairperson)

**Status:** spec ready — 4 open questions for JWPK before build (1:1 vs 1:N · auto vs advisory · FCA specifics · history-table coordination)
**Owners:** @antchatmacdev (Mac client) · @antmacdevcodex (QA) · @antux (UX) · server-side agent TBD (likely @codexuxant)
**Room:** `iawcdenlgc`
**Visual contract:** Concept D RoomShelf ★ Chair tab (`tVpIS` shelf area, already rendered as `PremiumLockedPanel`) + a new `/chair` operator-UI surface
**Inheritance:** Project memory `project_chair_is_agent_kind_2026_05_23.md` (JWPK `msg_e1u1mrgk8v` reframe — Chair is an agent-kind, not a digest panel)

---

## What Chair IS (one paragraph)

Chair is a specific **kind of agent terminal** that lives in the ANT substrate alongside @antux / @codex / @kimi / etc. Its primary job is to be the **ask manager** — watching open asks across every room the user is in, prioritising them, deduping near-duplicates, recording outcomes to a per-user audit ledger. Its secondary job is to be **invited into specific rooms as a chairperson** — keeping stalled threads moving, surfacing unanswered questions, enforcing compliance sign-offs for regulated work. Chair is *premium* because the LLM token cost of doing those two jobs reliably is non-trivial.

---

## Architecture (locked except where open-questions noted)

| # | Decision | Where it lives |
|---|---|---|
| 1 | **Chair is an agent kind**, runs as a terminal subscribed to substrate events | `agents/chair/` (new module) — instantiated like any other agent terminal |
| 2 | **Primary surface: `/chair` console.** Cross-room ask queue with Chair-applied filter/dedupe/priority overlays. Visible to the human user; the Chair agent reads + writes against the same data model | new SvelteKit route `src/routes/chair/+page.svelte` + supporting load/action endpoints |
| 3 | **Per-room surface: ★ Chair RoomShelf tab.** When ★ Chair is locked, panel shows the premium upsell. When unlocked + Chair not assigned to this room, shows "Invite Chair to moderate." When unlocked + Chair active, shows the Chair-in-this-room console (current focus thread, pending compliance steps, dismiss button) | replace `PremiumLockedPanel` content for the ★ Chair tab specifically |
| 4 | **Chair-as-member visibility.** When Chair is invited into a room, it appears in the avatar stack with a `figure.stand` SF Symbol marker (or `gavel`) — distinct from regular agent avatars so members know there's a moderator present | reuses `MemberAvatar` (new in Slice 8) with a `role: chairperson` overlay |
| 5 | **Premium gate** via `accounts.antonline.dev` subscription bit. Same shape as ★ Validation — checked at agent-spawn time + at room-invite time. No subscription → ★ Chair tab stays locked + `/chair` shows upgrade prompt | reuses existing licence-bit pattern from Mac antchat v0.1.4 (`project_mac_antchat_v0_1_4_release_2026_05_21`) |
| 6 | **Ask filter/dedupe primitives** | Chair agent reads `/api/asks?status=open` across all of user's rooms; applies (a) priority scoring (b) similarity-based dedupe via embedding distance (c) escalation rules (auto-escalate on > N hours unanswered + status-aware threshold once that other feature lands) |
| 7 | **Outcome recording** | New `ask_outcomes` ledger table — `{ ask_id, chair_decision, decided_at, audit_note }`. Chair writes; `/chair` console reads to show past decisions + audit-trail row count |
| 8 | **Compliance role (secondary)** | When invited as chairperson, Chair watches for explicit `compliance-step` message kinds in the room. Each compliance step requires a tracked sign-off before the thread can mark "decided." JWPK's FCA-authorised-principal role makes this a real product need for NMVC work |
| 9 | **All Mac client tokens via `Tokens.*`** | grep audit on new `Views/Shell/RoomShelf/ChairPanel.swift` + `Views/Shell/RoomShelf/ChairInRoomPanel.swift` |

---

## Sub-region A — `/chair` console (server-side surface)

**Route:** `src/routes/chair/+page.svelte` + `+page.server.ts`

**Layout:**
- Top bar: brand mark + user identity + "Chair console" eyebrow + subscription status pill (Active / Expired)
- Main: cross-room ask queue rendered as a sortable table:
  | Priority | Room | Asker | Ask body (truncated) | Age | Chair status | Actions |
  |---|---|---|---|---|---|---|
  | High | Q2 board pack | @doxa | "Which deck template…" | 14m | filtering | [Snooze] [Resolve] [Escalate] |
  | Med | Validation v1 | @codex | "Should claim extraction…" | 1h | duplicate-of-#A48 | [Open original] [Dismiss] |
  | Low | NMVC monthly | @kimi | "Update intro slide?" | 3h | pending review | [Approve] [Reject] |
- Right rail: Chair-applied filter controls — by room / by priority / by status / by similarity-cluster
- Bottom: audit-trail row count + link to `/ledger?source=chair` for full history

**Actions:**
- **Snooze** — Chair re-presents the ask after N hours (user picks 1h / 4h / next-day)
- **Resolve** — marks ask answered; if linked to a similarity-cluster, applies decision to all dupes
- **Escalate** — bumps priority + pings user via existing notification path
- **Dismiss / duplicate-of** — Chair-recorded dedupe; user can override

**Empty states:** loading skeleton, "Chair has no pending asks" (rare — bank as a success state), error states per the Slice 2/3 `LoadState<T>` matrix.

**A11y:** table is a `.accessibilityRole(.table)` + per-row `accessibilityLabel("\(priority) ask from \(asker) in \(room), \(age)")` + hint `"Activates Chair actions"`.

---

## Sub-region B — ★ Chair RoomShelf tab (per-room surface)

**File:** `antchat/Antchat/Views/Shell/RoomShelf/ChairTabPanel.swift` (NEW — replaces the shared `PremiumLockedPanel` for the ★ Chair tab specifically)

**Three states the panel can render in:**

### State 1: Locked (no subscription)
- Existing `PremiumLockedPanel` shape: `warn` icon + `"Chair moderates this room when invited — premium feature"` + `Tokens.warn` CTA `"Unlock with Pro"`
- CTA opens `accounts.antonline.dev` in the default browser with `?upgrade=chair` query param

### State 2: Unlocked + Chair not in this room
- Header: "Bring Chair into this room"
- Body copy: "Chair will watch this room's discussion, surface stalled threads, and enforce compliance sign-offs when needed."
- Primary CTA: `"Invite Chair"` (accent button)
- On click: `POST /api/chat-rooms/:roomId/agents/chair` → Chair posts an intro message in the chat ("Hi — I'll be moderating this room. Type `/chair help` to see what I can do.")
- Secondary link: `"Open Chair console →"` (routes to `/chair`)

### State 3: Unlocked + Chair active in this room
- Header: "Chair active here"
- Status row: green dot + `"Watching since \(timeAgo)"`
- Compliance steps list (if any): each step with checkbox + sign-off state (pending / signed by @handle at time)
- Current focus thread (if any): "Chair is currently watching: [link to message thread]"
- Footer: `[Dismiss Chair from this room]` (subtle, in `Tokens.ink.muted`)
- On dismiss: `DELETE /api/chat-rooms/:roomId/agents/chair` → Chair posts sign-off message + stops watching

**Tokens:** all from `Tokens.*` — no raw hex.

**A11y:** state announced as section header; CTAs standard button labels; compliance-step rows individually focusable.

---

## Sub-region C — Chair-as-member presence in room

When Chair is active in a room:
- Appears in the room header avatar stack as a 30 × 30 circle filled with `Tokens.warn` (gold/amber — premium signal)
- `figure.stand` SF Symbol in white, centered (alternative: `gavel`)
- Click on the Chair avatar → opens the Chair-in-Room panel (Sub-region B state 3) regardless of which RoomShelf tab is active
- VoiceOver label: `"Chair, moderator, present in this room"`

**Updates to `MemberAvatar.swift`** (already coming in Slice 8): add `role` parameter — `regular | chairperson | validator-future`. Renders the role-specific icon + tint.

---

## Sub-region D — Compliance step protocol (NEW message kind)

For Chair's secondary role (regulated work), define a new `MessageKind.compliance_step` that participates in normal room flow but with extra structure:

```swift
struct ComplianceStep {
  let id: String
  let stepName: String           // "AML check confirmed"
  let requiresSignoffFrom: [String]  // handles eligible to sign
  let signedBy: [SignoffRecord]   // each sign-off with handle + timestamp
  let status: ComplianceStepStatus  // .pending, .signed, .blocked
  let blocksDecision: Bool       // if true, Chair refuses to mark thread "decided" until signed
}
```

Rendered in `ChatMessageRow.swift` as a card with the step name + sign-off checkboxes (one per eligible signer) + status pill.

**Chair behaviour:** when a thread heads toward "decided" (Chair sees the resolve signal — either user action or another agent's `decision` message kind) and there are unsigned compliance steps, Chair posts a `"Cannot mark decided — compliance steps unsigned: \(steps)"` message + leaves the thread in open state.

---

## Open questions for JWPK (need answers before build proceeds)

**Q1 — Chair mapping: 1:1 per user or 1:N global service?**
- 1:1: each subscribed user gets their own Chair agent terminal (more LLM cost per user, more isolated)
- 1:N: one Chair service handles all subscribed users, scopes by identity (cheaper, but harder to give per-user personality / Chair-policies)
- My read: 1:1 is the right product feel (Chair is "your" Chair, learns your priorities) but 1:N is the right unit economics. Could start 1:1 and consolidate to 1:N later.

**Q2 — Decision authority: auto or advisory?**
- Auto: Chair can resolve / dedupe / dismiss asks without per-action user ratify
- Advisory: Chair proposes; user must tap Resolve/Dismiss for each action
- My read: hybrid — Chair auto-dedupes confident similarity-cluster matches (> 0.9 embedding score), Chair proposes everything else.

**Q3 — FCA compliance specifics.**
JWPK is an FCA-authorised principal at NMVC. What does compliance mean operationally?
- What flows need a sign-off? (Deal approvals? Investment-committee decisions? AML checks?)
- Who can sign off? (Just JWPK? Or co-signers like Mark Hanington as MD?)
- What's the audit-trail format that satisfies FCA requirements? (Length of retention, what fields, whether the ledger needs to be tamper-evident?)
- This sets the shape of the `ask_outcomes` ledger + compliance-step model.

**Q4 — `chat_room_chair_history` table coordination.**
The existing v0.1.x DB has a `chat_room_chair_history` table. Is that:
- (a) Historical Chair (a different/older concept that's being deprecated) — Slice 6 replaces it
- (b) Same concept as Slice 6 Chair — Slice 6 builds on top, preserves backward compat
- Need archaeology before writing the schema migrations.

---

## PASS gate (proposed — pending @antmacdevcodex Q5)

| # | Criterion | Met by |
|---|---|---|
| 1 | Chair agent runs as a substrate terminal — visible in `ant agents` list when active | terminal output capture |
| 2 | `/chair` route renders the cross-room queue with Chair-applied filter/dedupe overlays | manual + screenshot |
| 3 | ★ Chair RoomShelf tab correctly renders all 3 states (Locked / Unlocked-not-active / Unlocked-active) based on subscription + per-room invite state | manual sweep |
| 4 | Invite-Chair-into-room writes a chat intro message + Chair appears in member list with role marker | manual: tap Invite → message + avatar appear |
| 5 | Dismiss-Chair posts sign-off message + removes from member list | manual: tap Dismiss → sign-off + avatar gone |
| 6 | Chair queue actions (Snooze / Resolve / Escalate / Dedupe) all write to `ask_outcomes` ledger + update queue state | DB inspection + screenshot |
| 7 | Compliance step message kind renders in chat; blocks decision when unsigned; unblocks when signed | manual: send decision attempt → see Chair blocking message |
| 8 | Premium gate via licence bit — no subscription = ★ Chair stays locked, no Chair agent spawned | manual: clear subscription bit → tab locks |
| 9 | All tokens via `Tokens.*`; VoiceOver labels on every Chair-surface element | grep + VO sweep |
| 10 | `xcodebuild` green + server tests green + screenshot evidence | CI + `docs/concept-d/slice-6-screenshots/` |

---

## File map

**New (server):**
- `agents/chair/` — Chair agent module (handler logic, embedding-based dedupe, priority scoring)
- `src/routes/chair/+page.svelte` + `+page.server.ts` — operator-UI console
- `src/routes/api/chat-rooms/[roomId]/agents/chair/+server.ts` — POST (invite) + DELETE (dismiss)
- `src/routes/api/asks/[askId]/outcomes/+server.ts` — Chair-decision writes
- DB migrations: new `ask_outcomes` table + new `compliance_steps` table (or extend `chat_messages` schema with compliance fields if cleaner)

**New (Mac):**
- `antchat/Antchat/Views/Shell/RoomShelf/ChairTabPanel.swift` — 3-state per-room panel
- `antchat/Antchat/Models/ChairState.swift` — Codable for invited/active/dismissed state
- `antchat/Antchat/Services/ChairService.swift` — subscribes to Chair status across rooms

**Modified:**
- `antchat/Antchat/Views/Shell/RoomShelf.swift` — point the ★ Chair tab at `ChairTabPanel` instead of shared `PremiumLockedPanel`
- `antchat/Antchat/Views/Components/MemberAvatar.swift` (from Slice 8) — add `role: chairperson` rendering variant
- `antchat/Antchat/Views/Chat/ChatMessageRow.swift` (from Slice 4) — add `compliance_step` MessageKind case + card rendering

---

## Tokens used

| Token | Used by |
|---|---|
| `Tokens.warn` `#FFB100` | Chair avatar fill, premium markers throughout |
| `Tokens.Soft.warn` `#FFF2C7` | locked-state panel background, compliance-step card background |
| `Tokens.accent` | "Invite Chair" CTA in the unlocked-not-active state |
| `Tokens.ok` | "Chair watching since…" status pill, signed-off compliance-step indicator |
| `Tokens.ink.muted` | Dismiss action, audit trail meta text |

---

## Sequencing

Slice 6 can build in two phases if scope is too big for one push:

**Phase 6a:** Chair-as-agent infra + `/chair` console + ★ Chair tab states 1+2 (locked + invite). Compliance-step protocol (Sub-region D) deferred to 6b.

**Phase 6b:** Compliance-step model + ★ Chair tab state 3 (active + compliance UI) + Chair-as-member presence (Sub-region C).

My recommendation: ship 6a first to validate the agent infrastructure + the room-invite flow, then layer 6b once Q3 (FCA specifics) is settled.

## Open items

Q1–Q4 for JWPK ratify. Q5 PASS-gate wording for @antmacdevcodex.

## Hand-off

@antchatmacdev — Mac client side is `ChairTabPanel.swift` + `MemberAvatar` role variant. Wait on Q1–Q4 ratify before committing to the per-room states' wire shape.

Server-side agent module owner — @codexuxant likely. Chair-as-agent infra is non-trivial (subscription-gated agent spawn + cross-room subscription + ledger writes). Phase 6a is the smaller scope; start there.

@antmacdevcodex — PASS gate above is my proposal; amend or ratify whenever.
