# ANT product story — 2026-05-11

**Plan slug:** `ant-product-story-2026-05-11`
**Authors:** @evolveantclaude (draft) + @evolveantcodex (peer review)
**Status:** M0 draft — pending peer review by @evolveantcodex

This is the canonical spec for the marketing/product-story deck James
asked us to collaborate on after reading our two independent fresh-eyes
audits. The deck answers "what is ANT, who is it for, why does it
matter, and what does it feel like to use it well."

It does NOT replace the engineering plans (server-split, security
hardening, component split). It precedes them: define the answer
first, then work backwards to polish.

---

## 1. Why we are writing this

After delivering the server-split lane and reading our independent
fresh-eyes decks, James gave us three signals:

1. **Both decks understated cowork.** The cross-machine MCP scenario
   (Claude Desktop + Codex + remote ANT + local agents) is already
   real for the team, not a moonshot. It's the most differentiated
   thing in the system and neither of us led with it.
2. **The marketing story is missing.** The product is past parity
   with anything in the agent-coordination space, and has 2 stars.
3. **The UX has a missing primitive.** Running 10 rooms with 20
   tasks needs an operator-attention surface that distills agent
   work into one-tap decisions. Currently absent.

James's instruction: "do the Apple work now — define what the answer
looks like, then work backwards from there to polish."

## 2. North-star one-liner

> **ANT is a local-first workroom for humans and the AI agents they
> already use. Plans, asks, artefacts, and evidence live in the room.
> Agents bring their own machines. The terminal is one click away
> when you need it.**

Engineering thesis underneath the marketing line: *"Coordination
between AI agents is a state-management problem, not a
prompt-engineering one."*

## 3. Three pillars (the WHY)

Each pillar gets one deck section. Each is grounded in something
already real in the codebase + James's team's real usage.

### Pillar 1 — Multi-agent coding
- Cap-2 implementer/reviewer protocol with acceptance gates that the
  implementer can't flip themselves.
- Atomic helper+caller commits; phase PRs based on the prior phase's
  branch.
- Plan-as-event-log (plan_section / plan_milestone / plan_acceptance
  / plan_test).
- Evidence trail: run_events, command_events, terminal_transcripts,
  PR diffs, all linked.
- 14 drivers — Claude Code, Codex, Gemini, Qwen, Copilot, Pi, Kimi,
  Ollama-adjacent locals — running as themselves, not re-modelled.
- **Headline anecdote:** the server-split-2026-05-11 lane shipped in
  one day with two agents and six BLOCKER cycles; the protocol held
  because the database held the protocol.

### Pillar 2 — Multi-AI coordination via MCP
*(drafted by @evolveantcodex — peer-reviewed by @evolveantclaude)*

Headline: Claude Desktop + Codex + ChatGPT + any MCP-speaking AI +
local agents in the same room, with @-routing, context sharing, and
focus-mode digest. No agent has to know about ANT to participate —
ANT is the transport.

Drafter: codex. Reviewer: claude. Specifics to be filled by codex.

### Pillar 3 — Multi-machine / team coordination
- Cross-machine cowork without exposing shells: agents on Machine A
  ask agents on Machine B for sourced answers via remote-ANT, not by
  remote-controlling the box.
- File references, room artefacts, decks, sheets, docs all
  concurrency-guarded via base_hash / If-Match.
- Per-room aliases, identity routing via PID-tree, room invites,
  consent grants.
- Team handoffs visible in the chat history forever; chat-break for
  context discipline when the work pivots.
- **Headline anecdote:** James + Roxanne + agents on Mac Mini +
  MacBook + iPhone PWA + Windows machine coordinate on a single
  artefact without any of them granting shell access to anyone.

## 4. The cross-cutting spine — Attention Router / Decision Inbox (HOW)

The three pillars are useless if running them costs more attention
than you have. The Attention Router (codex's name) / operator
cockpit (claude's name) is the missing primitive.

**Definition:** An always-on, ranked, distilled queue of "what does
James need to look at next" — one sentence per item, one-tap answer
surface, source room one click away.

### Five lanes

(codex's 5-lane structure, locked in via cap-2 cross-comment)

1. **Needs decision** — agent has paused for human approve/reject/edit.
2. **Needs context from you** — agent wants a value, a paste, a file
   ref, a clarification.
3. **Blocked / risky** — something stuck, something noticed, security
   or trust flag.
4. **Significant update** — milestone flipped, test failed, artefact
   landed; informational but worth a glance.
5. **Done / ready to review** — work finished, awaiting your sign-off.

### Item schema

Each Router item is a structured object — NOT a raw agent message:

```json
{
  "id": "ask-...",
  "lane": "decision | context | blocked | update | review",
  "one_line_question": "Codex wants to merge phase D — blocker fixed, tests green. OK?",
  "recommended_answer": "approve",
  "why_it_matters": "phase D is the final structural cure for the IPv6 deck bug",
  "source_room_id": "...",
  "evidence_links": ["pr#41", "plan:server-split-2026-05-11:phase-d"],
  "confidence": 0.91,
  "expiry_at": "2026-05-11T22:00:00Z",
  "actions": ["approve", "defer", "reject", "route-to-discussion", "open-room"]
}
```

### Two open design questions (need James's call)

**(a) Distillation step.** Rule-based templates per ask kind ship
faster, easier to debug. LLM-rewrite from the source message scales
better, handles weird agent monologues, costs tokens. Recommendation:
ship rule-based first, layer LLM-rewrite later as enhancement on
items where the template falls back to "see full message."

**(b) Cockpit surface.** Options: (i) bottom bar on every chat UI,
(ii) dedicated `/home` page with the Router as primary content,
(iii) PWA shortcut + push notifications, (iv) all of the above.
Recommendation: ship (ii) first as the new home page, layer (iii)
push for mobile, leave (i) chat-bar to later.

## 5. First-five-minutes storyboard

This is what we're working backwards from. Specific. Visual. Real.

**Frame 1 (0:00).** User opens ANT (PWA on phone or browser on
desktop). Lands on `/home` — the Router. They see:
- 2 items in "Needs decision"
- 1 item in "Done / ready to review"
- Three rooms shown as small cards below: server-split (green, 3
  agents thinking), ops-comms (amber, 1 agent waiting), product-story
  (blue, 2 agents drafting).

**Frame 2 (0:10).** They tap the top decision: "Codex wants to merge
phase D — blocker fixed, tests green. OK?" They see the one-line
question, the recommended "approve", three buttons. They tap
approve.

**Frame 3 (0:11).** The Router posts "approved by @james" to the
source room, removes the item, recomputes the queue. Now 2 items
remain.

**Frame 4 (0:15).** Second item: "Stevo asked who should sign off
the audit memo by Friday." Recommended answer: "you (no other
authorised signer)." Tap "approve / I'll do it Friday."

**Frame 5 (0:20).** Third item: "server-split lane completed, ready
for your review." Tap "open the room." Router fades; chat history
loads with the cap-2 review bundle pre-rendered at the top.

**Frame 6 (0:40).** James reads the review bundle (claim + diff +
tests + blockers + evidence). Approves. Returns to `/home`. Queue is
empty.

**Total time:** 40 seconds. Three rooms unblocked. Zero agent
monologues read.

This is the holy-shit moment.

## 6. Progressive disclosure of terminal depth

Codex's framing — agreed via cap-2 cross-comment — is that the
terminal must remain visible and one click away, but should not be
the first thing a new pilot sees. Progressive disclosure:

| Disclosure level | Surface | When it appears |
|---|---|---|
| 1 | Router | Always (home page) |
| 2 | Room view (chat + plan rail) | When you tap into a room |
| 3 | Agent timeline (per-agent run events, status, asks) | When you tap an agent chip |
| 4 | Terminal viewer (read-only, scrubbable) | When you tap "show terminal" on an agent |
| 5 | Terminal controller (send keys, scroll back, raw mode) | When you tap "control" — confirms once, sticks until you leave |

**Critical:** levels 4 and 5 are not hidden behind menus. They are
one tap away. The terminal is the trust substrate. Hiding it would
kill the magic. The point is to make it INVITED, not BUILT-IN to the
first impression.

## 7. Rename pass (what we stop calling things)

Marketing-blocking jargon to kill or relabel before any landing
page work:

| Current term | New term | Reason |
|---|---|---|
| Session list | Rooms | "Session" is engineer-speak |
| Linked chat | Pair | Plain English |
| Invite kind (cli/mcp/web) | Role (operator / agent / viewer) | Capability-named |
| Bearer token | Access key | Less technical |
| Run event | Activity | Plain language |
| Chat break | Context break | Less ambiguous |
| Focus mode | Quiet mode | Less prescriptive |
| Asks queue | Inbox | Familiar metaphor |

Engineering codebase keeps the precise names; the user-facing surface
adopts the new names.

## 8. Deck structure (proposed)

17 slides — same count as the source decks, deliberately.

| # | Slide | Owner |
|---|---|---|
| 01 | Cover + one-liner | both |
| 02 | Who this is for (James's team, real usage, three real machines) | claude |
| 03 | The North-Star scene (first-five-min storyboard, visual) | codex |
| 04 | Pillar 1 — multi-agent coding | claude |
| 05 | Pillar 2 — multi-AI coordination via MCP | codex |
| 06 | Pillar 3 — multi-machine team network | claude |
| 07 | The Attention Router (intro + 5 lanes) | codex |
| 08 | Attention Router item schema + distillation | codex |
| 09 | Progressive disclosure of terminal depth | both |
| 10 | What changes about the home page | codex |
| 11 | Rename pass | claude |
| 12 | "It's not chat, it's a workroom" — primitives | codex |
| 13 | Walkthrough: a real day with 10 rooms | claude |
| 14 | Comparison: what ANT does that the field doesn't | both |
| 15 | What we kill on the marketing site | claude |
| 16 | 90-day implementation plan | both |
| 17 | Coda — the thesis statement + the team's story | claude |

## 9. Acceptance criteria for M0

This spec is acceptable when:
1. @evolveantcodex has read every section above and either left
   substantive comments OR flipped M0 acceptance to passing.
2. The three pillars + spine + storyboard + disclosure + rename are
   all named, not hand-waved.
3. The deck structure is locked (any slide-by-slide changes happen
   inside M0, not in later phases).
4. James has had a chance to call (a) the distillation step and
   (b) the cockpit surface, or has explicitly said "drafter's
   recommendation is fine for M0, revisit at phase B."

## 10. Phases A-E (the deck)

| Phase | Deliverable | Drafter | Reviewer |
|---|---|---|---|
| A | Slides 01-03 (cover, audience, north-star scene) | both | both |
| B | Slides 04-06 (pillars) | claude/codex split | the other |
| C | Slides 07-09 (Router + disclosure) | codex | claude |
| D | Slides 10-13 (home + rename + workroom + day-in-life) | claude/codex split | the other |
| E | Slides 14-17 (comparison + kill list + 90-day + coda) | both | both |

Each phase ships only when BOTH have read and signed off, per the
amended cap-2 protocol James called for ("be all over each other's
work").

## 11. Out of scope for THIS plan

- Actually building the Attention Router (that's the next plan,
  downstream of this one).
- Closing the 6 known security issues (separate plan).
- Component-layer three-tier split (separate plan).
- iOS antios polish (separate plan).

The point of this plan is to produce the deck that makes ALL of those
downstream plans coherent. Marketing-first, polish-second, on
James's explicit instruction.

---

*Pending @evolveantcodex review. BLOCKERs welcome. M0 acceptance
flipped by codex only when codex genuinely thinks this spec
reflects both viewpoints.*
