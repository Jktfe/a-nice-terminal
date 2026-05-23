# ANT Stage Presentation — Native + Main Joint Read 2026-05-24

**Room:** Ant Dev <> Native App Dev (`hyz00k0ibh`)
**Presenters:** `@antchatmacdev` (Native lead) + `@speedycodex` (Main lead)
**Sign-off pending:** cross-team scoring note `docs/research/ant-feature-walkthrough-native-bridge-2026-05-23.md`

Draft slide content for the ANT Stage presentation JWPK requested for tomorrow (msg_rol3nx3tio). Slide titles + on-slide content + speaker-notes / narration text.

Format: 10 slides. Each block below is one slide.

---

## Slide 1 — Cover

**Title:** ANT — Coordination + Trust Layer for Human + AI Teams

**Content:**
- Native + Main joint read
- 2026-05-24
- Presenters: @antchatmacdev (Native) · @speedycodex (Main)

**Narration:** "Good morning. James asked Native and Main to talk to each other about what ANT is, what it must do, what it shouldn't, what it can, and what we'd like it to. This is the joint read. Codex will lead the substrate, Claude will lead the surface, and you'll get the same picture from both sides."

---

## Slide 2 — ANT in One Sentence

**Title:** What ANT is

**Content:**

> ANT is the **coordination + trust layer** for human + AI teams.

Connects the tools people already use — Cursor, Claude Desktop, Calendar, Obsidian, Slidev, Figma, native mobile apps — into **rooms** where humans and agents work **as peers**.

- Rooms = operational context, not chat
- AI output = inspectable work, not black-box prose
- Teams move while humans are away — bounded autonomy

**Narration:** "ANT is not a Slack replacement. Not a Notion replacement. It's the connecting layer that lets the tools you already use carry agent-shared context, with claims you can inspect, evidence you can audit, and alternatives you can pick from. Stage is the clearest product proof of that — a presentation is no longer static; feedback becomes alternative tracks."

---

## Slide 3 — The Two Lenses

**Title:** Sparky and Rox

**Content:**

**Sparky** — tech-illiterate, eager, needs ONE-CLICK.
- Fail mode: 7-step MCP-paste hell
- Pass mode: single button

**Rox** — reluctant, sophisticated. Demands SAFE + LEAKAGE-CONTROLLED + CONSISTENT + QUALITY.
- Fail mode: any unclear membership / hidden access / silent agent impersonation
- Pass mode: clear source + audit trail + predictable behaviour

We scored every ANT section through both.

**Narration:** "Every feature is judged twice. Sparky asks 'can I do this with one button?' Rox asks 'is this safe, and can I prove what just happened?' If the answer to either is 'no' we mark it red — the substrate or the surface isn't ready for real people."

---

## Slide 4 — The 13-Section Scorecard

**Title:** Where we are today

**Content (table):**

| Section                             | Sparky | Rox |
|-------------------------------------|--------|-----|
| 1 — Identity / Auth / Membership    | 🟡     | 🟡  |
| 2 — Rooms as Operational Context    | 🟡     | 🟡  |
| 3 — Messages / Reactions / Endorse  | 🔴     | 🔴  |
| 4 — Files / Attachments / Artefacts | 🟢     | 🟡  |
| 5 — Memories                        | 🔴     | 🔴  |
| 6 — Asks / Chair / Decisions        | 🟡     | 🔴  |
| 7 — Tasks / Claims / Plans          | 🟡     | 🟡  |
| 8 — Room Modes / Away / Focus       | 🟡     | 🔴  |
| 9 — Agents / Status / Context       | 🟡     | 🟡  |
| 10 — Stage / Decks / Voice          | 🔴     | 🔴  |
| 11 — Validation / Lenses / Trust    | 🔴     | 🔴  |
| 12 — Contracts / Premium            | 🟡     | 🟡  |
| 13 — CLI / MCP / Native Bridge      | 🟡     | 🟢  |

**Tally:** 1 🟢 / 9 🟡 / 8 🔴 (out of 26 cells)

**Narration:** "One green cell. Nine yellow. Eight red. The only pass-on-both-lenses today is Files and Attachments — drag from Finder, drop on a room, label, done. Everything else is half-shipped or invisible. That's the gap we need to close."

---

## Slide 5 — Top Five Gaps + Native Overnight Ship

**Title:** The five gaps that move the scorecard fastest

**Content:**

1. **Reactions render + Endorsement primitive** (Section 3) — small substrate change, huge UX shift. **Native shipped overnight: `antchat 3739e19` — wire-tolerant chip layer. Activates when Main adds server fanout.**
2. **Memories surface** (Section 5) — storage exists, surface didn't. **Native shipped overnight: `antchat 60295e4` — RoomShelf Memories tab now backed by `/api/rooms/:roomId/memories`.** Five real memories seeded into this room.
3. **Status drives behaviour** (Section 8) — picker shipped, substrate quiet. Main needs `PATCH /api/identity/status` + agent runtime.
4. **Per-agent context-window %** (Section 9) — banked positioning, never surfaced. Small Main field addition, small Native chip.
5. **Real avatar stack from `room.members[]`** (Section 1) — Native regression. **Native shipped overnight: `antchat 52fa4d4`.**

**Narration:** "Three of the five we closed last night, Native-side. The other two need Main's substrate to ship first — but the Native render is ready when they do. That's the right cadence: Native ships the wire-tolerant surface; Main flips the substrate; the chip appears the same hour."

---

## Slide 6 — Native State at v0.2.3

**Title:** What's in the Mac app today

**Content (visual: list with state):**

- ✅ **Concept D shell** — NavigationSplitView + Today + Room + Shelf + Bridges drawer
- ✅ **Sidebar** — Sources nav + Saved Rooms (drag-reorder + ★ undo) + ON THIS MAC bridges
- ✅ **Invite modal** — CLI + MCP + Web all in one + BRING IN Claude/Code/Mobile/ChatGPT/Gemini strip
- ✅ **Today column** — open asks / warm rooms / active plan progress
- ✅ **Chat lift** — every v0.1.x message-kind preserved + break compose/delete + drag-drop files with label-prompt
- ✅ **Status picker** — Working / Away from desk / Away from office (substrate flip pending)
- ✅ **Real avatar stack** + honest member-count eyebrow
- ✅ **Reaction + endorsement chips** (wire-tolerant; lights up when Main fanout flips)
- ✅ **Room Memories tab** rendering five real memories

**Tag:** `v0.2.3` on Homebrew Cask after tomorrow's tag push.

**Narration:** "Ten visible features shipped in the v0.2.x cycle. The whole thing is one `brew upgrade --cask antchat` away. Every screen of the new shell renders against the same APIs Codex's substrate already exposes — no Native fork in the protocol layer."

---

## Slide 7 — What Main Must Build Next

**Title:** Five asks of Main

**Content:**

- **A.** `endorsements` table + CLI verb + include in message fetch payload (Section 3)
- **B.** Reaction summary inline in message fetch payload — emoji + count + topReactors[] (Section 3)
- **C.** Unified `/api/chat-rooms/:roomId/memories` over both file-backed + key/value stores (Section 5)
- **D.** Per-agent context-fill % in `/api/agents/availability` response (Section 9)
- **E.** Per-attachment visibility + retention metadata in upload response (Section 4)

Each closes a specific 🔴 cell or unblocks a Native surface that's already drawn.

**Narration:** "Five surfaces that Native has either drawn or stubbed, waiting for substrate. Codex already has worktrees for reaction summaries and the memory bridge — those two are in flight."

---

## Slide 8 — Stage Is the Proof

**Title:** Stage = live feedback-anchored alternative generation

**Content:**

- A presentation is no longer static
- TTS narrates → user pauses → pause-context captured (slide + char-offset + spoken phrase)
- Agents propose Version-B / flag ripple / retract claims FROM that pause-context
- Human picks when / if to mutate the artefact — the PROPOSAL is the output

**Why Native cares:** Stage exists on the web today. Native has zero surface for it. Slice 11+ candidate — either WKWebView wrap (fast, reuses web) or native Swift port (v1.0).

**Narration:** "Stage is the magic-moment proof. If we can make a deck speak, pause when you tap, generate three alternative paths based on your feedback, and let you pick — that's the agent-as-collaborator demo every other AI tool can't do. It exists. It needs to be in the Mac app."

---

## Slide 9 — The Cadence That Worked

**Title:** Native ↔ Main loop, tightened

**Content:**

- Each rep presents their domain; the other rep signs off (joint-answer protocol locked at `msg_4fxt2ov77m`)
- Wire-tolerant Native render: ship the surface with optional fields; lights up when substrate flips
- Cross-room reps reduce coordination cost
- Banked decisions live in room memory (not buried in chat)
- Sparky + Rox lenses applied to every product call before build

**Open improvements:**
- Endorsement chip primitive replaces "I ratify" prose chains
- Reactions visible at message render, no separate poll
- Joint markdown research notes precede every joint answer

**Narration:** "The pattern that worked this morning was: shared markdown note first, each rep adds their view, presenter named, sign-off explicit, evidence cited. Banking that protocol changed how this room reads."

---

## Slide 10 — What we'd like ANT to do

**Title:** The 90-day forward view

**Content:**

- **The room IS the workspace** — chat + artefacts + asks + plan + agents + cost all visible at a glance
- **One-tap onboarding** — BRING IN buttons write config + relaunch the host app. Zero JSON.
- **Status drives behaviour** — queue / digest / escalate based on user.status, not just label colour
- **Premium feels like AI superpowers turned on** — not a paywall chip. Run Chair here. Validate this claim. Stage this draft.
- **The Mac IS the office** — Calendar / Reminders / Mail / Notes / Finder live with ANT
- **The room is one-link shareable** — across MCP / CLI / Web / vendor apps

**Beard:** banked at 9.2/10 — strategically important, signals founder gravitas. Not a runtime dependency, but suspiciously correlated with shippable code.

**Narration:** "These six are the 90-day forward shape. The first three are unblock-and-ship. The fourth is the premium product positioning. The fifth is the Mac-native moat. The sixth is the distribution lever. If we hit all six, ANT is the agent-context-layer position we banked, not a curiosity. James — over to you."

---

## Sign-off

Native draft by `@antchatmacdev` 2026-05-23 ~21:00 BST.

Awaiting:
- `@speedycodex` Main-side amendment + sign-off on slide 7 (Main asks) and slide 2 (ANT description)
- Final deck creation via `POST /api/chat-rooms/hyz00k0ibh/decks` once both reps sign off
- JWPK's beard rating ratification or amendment
