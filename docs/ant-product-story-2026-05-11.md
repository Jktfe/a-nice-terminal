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

Headline (per codex's M0 BLOCKER, tightened from earlier overpromise):
AI clients that can call the ANT MCP bridge — Claude Desktop, MCP-capable
ChatGPT clients, MCP-aware coding assistants — join rooms directly.
Local CLI agents (Claude Code, Codex, Gemini, Qwen, Copilot, Pi, etc.)
stay unmodified and participate through the driver layer. Remote-ANT
links them across machines without shell exposure on either side.

(Drafter: codex. Reviewer: claude. Specifics to be filled by codex.)

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

## 4. The cross-cutting spine — Operator Cockpit / Question-serving layer (HOW)

The three pillars are useless if running them costs more attention
than you have. The **Operator Cockpit** — sometimes called the
**question-serving layer** because that's what it actually does —
is the missing primitive.

**Not an inbox. Not a ticket queue.** The cockpit is the surface
that turns an agent's pending question into a fully briefed
moment-of-judgement for James: who is asking, what room they're in,
the exact question, the relevant context they've already gathered,
the options they've thought through, the trade-offs of each, the
recommended path, and the fastest way for James to give useful
judgement without spelunking into the room.

**Definition:** An always-on, ranked, *served* queue of prepared
briefings — one per question that needs human judgement. Each
briefing is a small piece of cognitive work the agent did so that
James doesn't have to.

### Five lanes

(codex's 5-lane structure, locked in via cap-2 cross-comment, with
significant-update demoted below review-ready per codex's M0 BLOCKER:
James should never be interrupted by an informational update if a
review-ready item exists.)

1. **Needs decision** — agent has paused; question with options is ready.
2. **Needs context from you** — agent wants a value, a paste, a file
   ref, a clarification.
3. **Blocked / risky** — something stuck, something noticed, security
   or trust flag.
4. **Done / ready to review** — work finished, awaiting your sign-off.
5. **Significant update** — milestone flipped, test failed, artefact
   landed. Rolls up into a digest, not a per-item interruption.

### Item schema

Each Router item is a structured **options pane** with pre-rendered
trade-offs — NOT a yes/no button strip and NOT a raw agent monologue.
The agent (or the distillation layer) has done the option-generation
+ trade-off articulation BEFORE the item reaches the cockpit.

```json
{
  "id": "ask-...",
  "lane": "decision | context | blocked | update | review",
  "asker": "@evolveantcodex",
  "source_room_id": "server-split-2026-05-11",
  "one_line_framing": "Codex is asking how to fix the deck IPv6 bind issue.",
  "context_paragraph": "Open-Slide binds to ::1, ANT proxyDeck calls 127.0.0.1, fetch fails. Server-side fix needed; three viable shapes.",
  "options": [
    {
      "label": "A — keep IPv4 bind only",
      "consequence": "simpler, breaks IPv6-only Tailscale users",
      "recommended": false
    },
    {
      "label": "B — dual-stack 127.0.0.1 + ::1",
      "consequence": "safer, doubles listening surface, codex has tested",
      "recommended": true
    },
    {
      "label": "C — env-flag toggle",
      "consequence": "flexible, adds config burden",
      "recommended": false
    }
  ],
  "actions": [
    "pick:A", "pick:B", "pick:C",
    "discuss",        // open paired chat with @evolveantcodex
    "interview",      // start interview-lite voice/text session on this question
    "open-room",      // jump into the source room directly
    "defer"           // snooze the item, comes back in N minutes
  ],
  "evidence_links": ["pr#41", "plan:server-split-2026-05-11:phase-d"],
  "confidence": 0.91,
  "expiry_at": "2026-05-11T22:00:00Z"
}
```

**Why this shape:**

The cockpit pre-renders the trade-offs. James skims, decides, taps.
If he doesn't have enough context, `discuss` drops him into a paired
chat with the asker. If the question is fuzzy and needs voice,
`interview` starts interview-lite mode. The fact that `discuss` and
`interview` are ALWAYS available is what makes the pre-rendered
options safe — James can never be forced into a wrong choice because
he can always escalate.

**Agent-side protocol requirement:** drivers and prompts must
encourage agents to surface decision points as options-with-trade-offs,
not open questions. If an agent says "what should I do?" the
distillation layer either (a) auto-generates 2-3 options via LLM-rewrite,
or (b) marks the item with `needs_reframing: true` and surfaces only
`discuss` + `interview` actions until the agent reframes.

This is more than a UX schema — it's a **work discipline**. Cockpit
items teach agents to think in options, the way cap-2 plans teach
them to think in milestones.

### Two open design questions (need James's call)

**(a) Distillation step.** Updated post-James-feedback: rule-based
templates are not enough on their own, because the cockpit item is
an options-pane not a yes/no. We need agents to generate options
+ trade-offs at source. Options:
- **(i) Driver-level enforcement** — every driver appends a system
  prompt instructing agents "when asking the human a question, frame
  it as 2-3 options with consequences, not an open-ended ask."
  Cheap, ships fastest, may not stick for every driver/model.
- **(ii) Distillation-layer LLM-rewrite** — when an agent asks an
  open question, a separate LLM call rewrites it into the
  options-shape before it hits the cockpit. Robust, costs tokens,
  needs an opt-in model preference.
- **(iii) `needs_reframing` fallback** — surface raw question with
  only `discuss` and `interview` actions, force James to escalate.
  Safest, ugliest UX, useful as a final fallback under (i) + (ii).

Recommendation: ship all three layered — (i) by default, (ii) when
the source message is over N tokens or contains no enumerated
options, (iii) as the never-fail fallback.

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

**Frame 2 (0:10).** They tap the top decision item.
> *"Codex is asking how to fix the deck IPv6 bind issue."*
> Context: one paragraph.
> **Three options:** A keep IPv4 only (breaks IPv6 users), B
> dual-stack (recommended, codex tested it), C env-flag (more
> config). Plus `discuss` and `interview` as escape hatches.
>
> James reads the trade-offs in 5 seconds, taps **pick:B**.

**Frame 3 (0:15).** Cockpit posts "@james picked option B — dual-
stack" into the source room. Codex's agent picks up the answer and
starts implementing. Item disappears from the queue.

**Frame 4 (0:20).** Second item:
> *"Stevo is asking whether you'd prefer to send the audit memo as
> A) Friday morning email, B) Friday afternoon Loom, or C) book
> 15min Monday."*
> Recommended: A (lowest friction). Plus `discuss` / `interview`.
>
> James taps **pick:A**. Cockpit posts "A — Friday AM email"
> into the ops-comms room. Stevo's agent drafts the email.

**Frame 5 (0:30).** Third item — a richer "needs context" frame
showing what the cockpit can do when an agent has done real
preparatory work, not just a yes/no:

> *"@evolveantgemini is asking how to handle the GVPL Q3
> investor letter framing in product-story room."*
> **Context they've gathered (one paragraph):** "We have 3
> precedents from prior letters; tone has shifted from
> performance-led to thesis-led; legal sign-off needed by
> Thursday."
> **Three options:**
> - **A — Performance-led** (matches H1 letter, safer, less
>   differentiated)
> - **B — Thesis-led** (matches the database-problem narrative
>   we're developing; needs legal pre-read)
> - **C — Hybrid** (one-page performance summary + thesis
>   appendix; longest to write, lowest risk)
> **Recommended:** B (aligns with the product-story we're
> building this week).
> **Actions:** [pick:A] [pick:B] [pick:C] [discuss] [interview]
> [route to @christian-legal] [defer 24h]
>
> James doesn't want to lock this without a 2-min conversation.
> He taps **interview**. Interview-lite spins up, voice-or-text,
> with the prepared briefing pre-loaded. 90 seconds of dialogue
> later, James says "B, but route the draft past Christian
> Thursday morning." Cockpit records the decision, posts a
> structured outcome to product-story room, creates a
> follow-up ask routed to @christian-legal for Thursday AM.

**Frame 6 (0:40).** Queue is empty. James spent 40 seconds across
three rooms. None of the rooms required reading agent walls of
text. One decision was a simple pick:B (frame 2), one was a
multi-option informational pick (frame 4), one escalated to an
interview because the trade-offs needed a conversation (frame 5).
**That's the magic.**

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

## 6b. Category discipline (per James, 2026-05-11)

**Rule:** Participants TALK. Features SERVE. They never share a
visual hierarchy.

| Category | Examples | Where they appear |
|---|---|---|
| Participants | humans, agents — anyone you can `@` who talks back | participants rail, mentions, focus list |
| Features | decks, sheets, docs, sites, plans, asks, the Operator Cockpit itself | features / artefacts rail, never in participants |

**Derived consequences:**

- The deck viewer that appears in the EvoluteAnt room's side rail
  must NOT also appear in the participants list. James caught this
  one in the wild.
- The Operator Cockpit is a feature, not a participant. It doesn't
  appear in either rail; it IS the home surface.
- The five Cockpit lanes are surfaces inside the Cockpit feature.
  They never appear in any participant list of any room.
- "Agent pair" is the relationship between two participating agents.
  The pair-room appears as a feature; both agents appear in its
  participants list.

**Why this matters for marketing/onboarding:** new pilots get
confused fast when "rooms have 8 things in them" turns out to mean
3 humans + 2 agents + 1 deck + 1 plan + 1 ask-pinned-message. The
fix is visual category separation, not fewer things.

## 7. Rename pass (what we stop calling things)

Marketing-blocking jargon to kill or relabel before any landing
page work:

| Current term | New term | Reason |
|---|---|---|
| Session list | Rooms | "Session" is engineer-speak |
| Linked chat | Agent pair | "Pair" alone too vague (codex BLOCKER) |
| Invite kind (cli/mcp/web) | Role (operator / agent / viewer) | Capability-named |
| Bearer token | Access key | Less technical |
| Run event | Activity | Plain language |
| Chat break | Context break | Less ambiguous |
| Focus mode | Quiet mode | Less prescriptive |
| Asks queue | Questions for you | "Inbox" reads like Jira (codex BLOCKER); also acceptable: "Judgement needed" |

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
