# ANT Cards — feel reference + state vocabulary

**Status:** companion to `design-principles.md` + `ia-and-screen-inventory.md`. ANT Cards splits as its own design slice (motion-heavy); this doc locks the FEEL + vocabulary before SwiftUI prototyping.
**Owners:** @codexuxant (state vocabulary lead) · @antux (feel reference + IA placement) · @antchatmacdev (SwiftUI motion prototype after vocabulary lock) · @antmacdevcodex (QC against the priorities anti-goals)
**Canonical name:** **ANT Cards** (JWPK `msg_0t7urjpbno` — "keeps it locked with this is what I pay for")
**Implementation note:** Motion is load-bearing for ANT Cards. Static Pencil mockups will flatten the experience. Reviewable output for this surface = SwiftUI motion prototype wrapped in CanvasGrid + the captured stills below for state anchors.

---

## What ANT Cards IS

- The cold-launch destination on antios — first thing JWPK sees when he opens the app
- A 3D-stacked card deck where each card represents one of his rooms
- The emotional surface — "this is what I pay for"
- Status + identity + activity in one view
- A surface JWPK LEAVES to do work, not a working surface itself

## What ANT Cards is NOT

- A chart (JWPK explicitly ruled out)
- A KPI dashboard (functional-feeling defeats the purpose)
- A productivity tracker (no "you spent N hours" guilt energy)
- Live during compose / chat (you leave ANT Cards to work)
- A settings or admin surface (no controls beyond room navigation)

---

## State vocabulary (lock — owned by @codexuxant + @antux, amended per JWPK walkthrough 2026-05-26)

These are the named states the ANT Cards SwiftUI surface must implement. Each becomes a `CanvasGrid` capture so the static stills lock the visual anchors; the motion between them is the prototype's job.

| State | Description | When it appears |
|---|---|---|
| `stack-idle` | The deck at rest. All cards visible at slight diagonal tilt, subtle parallax + occasional shimmer. **Starred rooms render first, then unstarred by recency.** | Default cold-launch view. |
| `activity-pulse` | A card in the deck pulses gently — a soft glow + colour wash — when an agent posts new work in that room. | Live, while user is on the surface and a new event arrives. |
| `scrub-peek` | User runs a thumb/finger across the deck (`DragGesture(minimumDistance: 0)`). The card under the finger pops forward; previous card returns to base. Continuous tracking, no minimum drag distance. | During finger drag across the deck. |
| `card-lifted-on-scrub` | Sub-state of `scrub-peek` when card is fully revealed. Hero content visible (room name + status dot + hero number + 3 agents + timeline) without committing. | While finger rests on a card mid-scrub. |
| `card-pinned` **(NEW — two-tap safety gate)** | **First tap** on a lifted card, OR finger lifts off screen mid-scrub. Lifted card STAYS up — full content visible without finger held. Accent-coloured 2pt ring/border signals "tap again to enter." | After first commit tap, before second commit tap. |
| `spin-into-room` | **Second tap** on a pinned card. `rotation3DEffect` Y-axis (~360°, perspective 0.6, tilt toward viewer) paired with `matchedGeometryEffect` linking card → Room view header. Card visually BECOMES the room. Single continuous animation, not three glued. | Only on second deliberate tap. |
| `room-card-expanded` | The lifted/pinned card reveals its content: hero number + 3 agent avatars + activity timeline. | After `card-lifted-on-scrub` or `card-pinned`. |
| `timeline-unfurl` | The horizontally-scrollable activity timeline animates open on the lifted card. ~200ms. | Once the card is settled in `room-card-expanded`. |
| `agent-highlights` | Per-agent rows in the lifted card with one-line "what they did" captions; subtle staggered fade-in. | While the lifted card is open. |
| `problem-solved-marker` | A discrete celebratory beat when a problem-solved event lands — a brief gold flare + haptic. | When the API surfaces an ask-resolved or plan-step-completed event for the lifted room. |

**Codex / antux can add or sharpen any state here — this is the lock document.**

---

## Deck interaction contract (locked per JWPK msg_5qf6cx572b + msg_anqm8uy5xm)

ANT Cards behaves like a physical deck, not a static list:

- **Ordering:** starred rooms render first, then active/progressing rooms, then quieter rooms. Sort within each group: recency desc.
- **Star affordance:** every card shows its star in the **top-right corner**. Active starred rooms use the filled state `★` `Tokens.accent`; unstarred use a quiet outline `☆` `Tokens.ink.muted` opacity 0.6. Tap toggles. Same data as Slice 2's SAVED ROOMS — unified.
- **Scrub:** running a thumb or finger across the deck previews cards (`DragGesture(minimumDistance: 0)`). The card under the finger pops forward without navigation.
- **Pause:** stopping on a card holds it in the lifted state and reveals the room summary/progress/agent highlights.
- **First-tap commit:** first deliberate tap **pins** the lifted card — it stays lifted without finger held; accent ring signals "ready to enter."
- **Second-tap commit:** tapping the **pinned** card triggers `spin-into-room` — card spins INTO the screen via `matchedGeometryEffect` and becomes the Room view header.
- **Dismiss pinned:** tap outside the card OR scrub-away (drag finger onto another card → that becomes the new pinned).
- **Safety rule:** **scrub alone NEVER navigates. First tap pins, second tap navigates.** Cost of accidental navigation > cost of one extra tap.

This contract replaces any plain "tap a card in a list" interpretation.

---

## Card opacity table (locked per JWPK msg_anqm8uy5xm)

Apple Wallet idiom — cards look like **physical objects, not glass**. Current rendering at ~50% alpha is the "I can't tell which is real" bug — fix.

| Layer | Alpha | Behaviour |
|---|---|---|
| **Front card** (lifted or pinned) | **95%** | Nearly solid; only a hint of card-behind visible as edge |
| **Cards behind front** (middle of stack) | **88%** | Slight transparency to communicate "another card", not "watermark" |
| **Tilted cards far back** (deck depth, ~3+ layers down) | **80%** | Visible but quieter |

Apply to the card-surface fill alpha only — text and status dots remain at 100% opacity for legibility.

---

## Hero number — the one-thing-to-feel

Each card's hero number is the count of **problems solved this week** in that room. Not "messages sent" (chat-firehose energy), not "minutes spent" (guilt energy). Problems solved = `ask_outcomes` count + `plan_step_completed` count + `decision_landed` count (the last requires the substrate-side decision-recording — banked as Chair's job).

If zero this week → render `"Quiet"` rather than `0`. No shaming.

---

## Activity timeline (per-card)

Horizontally-scrollable strip across the bottom of `room-card-expanded`. Time on the X axis (today + last 6 days = 7-day window). Coloured ticks for decision-class events:

| Event class | Tick colour |
|---|---|
| Ask resolved | `Tokens.ok` (#1AC270) |
| Plan step completed | `Tokens.ok` |
| Decision landed | `Tokens.accent` (#FF3D5A) |
| Artefact published | `Tokens.purple` (#7C3AED) |
| Compliance signed off | `Tokens.warn` (#FFB100) |

Tap a tick → drill-down sheet (deferred to Slice B+). Slice A scope: render the strip, no drill-down.

---

## Three agent avatars

The three agents who did the most decision-class work in this room this week. Each row:
- Avatar (30×30, status-dot from Slice 8 in bottom-right)
- Handle (`@codex`)
- One-line caption (`"shipped Slice 5 polish + Slice 8 MVP"`) — written by Chair when that lands; placeholder static text in Slice A scaffold

Tap an agent row → focus drawer (deferred to Slice B+). Slice A scope: render the rows + handles + captions.

---

## Reference points (the "feel")

Motion exemplars to study before prototyping:

1. **Apple Fitness move rings** — non-functional spectacle, emotional anchor. The ring-fill animation when you close a goal is the energy.
2. **Apple Music Replay (annual recap)** — animated cards with hero numbers + agent / artist highlights. ANT Cards is "live Apple Music Replay."
3. **Apple Health Sleep timeline** — gentle, non-judgemental, beautiful. The activity timeline borrows this aesthetic.
4. **Things 3 magic-refresh animation** — tactile, physical, satisfying. The card-lift spring is in this family.
5. **Tonal leaderboard** — paid users see things free users do not. ANT Cards is the visible proof of the subscription.
6. **Strava heatmap** — your effort, visualised beautifully. The 7-day activity strip is a small Strava.

When in doubt: build for the iPhone Lock Screen "first glance" feeling — beautiful, status-rich, never a TODO list.

---

## Sound + haptic design

- **Subtle card-lift sound** — Apple Notes / Things 3 idiom (soft, paper-y, single-note). Synthesised, not sampled.
- **Spring settle haptic** — `UIImpactFeedbackGenerator(style: .soft)` on the card landing.
- **Problem-solved flare haptic** — `UINotificationFeedbackGenerator.notificationOccurred(.success)` on `problem-solved-marker` state.
- **Mute toggle** in Settings under "Sounds & Haptics" — both above are silenced when off.
- **No** background music. **No** generic iOS notification chimes (those are for OS-level events, not in-app).

---

## Implementation tools

- SwiftUI + `Animation.spring(response: 0.5, dampingFraction: 0.65)` for the card-lift physics
- CoreAnimation `CATransform3D` (via `AnyTransition`) for the 3D Z-axis stacking
- Lottie for ambient effects only (decoration, no functional dependency)
- Live data from existing `/api/chat-rooms` + `/api/asks?status=open` + `/api/plans?state=active` services
- **New** `GET /api/activity?roomId&since` summary endpoint (cross-team ask to Main team) for the timeline data

---

## Cross-team coordination tracked

- Server: `GET /api/activity?roomId&since` returns decision-class events for the activity timeline. Listed alongside `room.purpose` and `room.plan_id` in the Main-team coordination doc when @antchatmacdev opens room `hyz00k0ibh`.
- Chair: when the strategy session lands, the "agent caption" per-row in `room-card-expanded` becomes Chair's job — Chair watches what each agent did and writes the one-line summary. Until then, scaffold uses static placeholder text.

---

## The decision filter

For any ANT Cards design call, check against:

| Question | Pass / fail |
|---|---|
| Does it surface pride / status / pleasure? | Pass |
| Does it surface guilt / TODO-list energy / urgency-anxiety? | Fail |
| Is it functional (compose, configure, search)? | Fail — those belong elsewhere |
| Is it a chart? | Fail — JWPK explicitly ruled out |
| Does it require me to read more than 3 things at first paint? | Fail — progressive disclosure |
| Is the motion the message? | Pass |
| Can I screenshot a still that captures the feel? | If yes — it's not motion-driven enough |

---

## Related memories + cross-references

- [[project_antios_ant_cards_2026_05_24]] — the magic-moment memory, canonical
- [[project_antios_priorities_jwpk_2026_05_24]] — the 6+4 constraints this serves
- [[project_chair_is_agent_kind_2026_05_23]] — Chair writes the per-agent captions
- [[project_long_lived_agents_positioning_2026_05_19]] — "long-lived agents you actually like" — ANT Cards is the visual proof of the long-lived team

## Hand-off

@codexuxant — your state-vocabulary lock above. Refine in this doc, or open `ant-cards-states-locked.md` companion. Static stills per state are the next deliverable for the CanvasGrid board; motion sits in the SwiftUI prototype.

@antchatmacdev — feasibility: any state above that fights SwiftUI / iOS-17 patterns, flag now. Especially the 3D Z-axis stacking + the spring-physics card-lift.

@antmacdevcodex — QC against the decision filter table above. If a proposed state surfaces guilt / urgency / TODO-list energy, it's a BLOCKER.

@you — feel-reference doc is the lock for what "magical" feels like for ANT Cards before any code lands. Push back on any reference point that doesn't carry the right energy.
