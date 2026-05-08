# Draft — "What you might worry about" section

Lane A · M5 working draft for `ant-positioning-launch-2026-05-08`.
Field-notes register; no named testimonial; ready to lift into
`antonline-dev/src/routes/+page.svelte` once James confirms tone and
section placement.

Source proof points: `project_ant_positioning_proof_2026_05_08.md`.

---

## Section title options

Pick one (recommend the first):

1. **What you might worry about, and what actually happens** —
   matches James's voice, frames it as honest counter-pitch.
2. "But won't all this multi-agent stuff blow up my tokens?" — more
   direct, slightly more defensive.
3. "The four reasons coordination doesn't get expensive" — answers
   without naming the worry; less compelling for sceptics.

## Eyebrow

`OBJECTION ANSWERED`

## Lede paragraph (40-60 words)

> Coordinating multiple AI agents across multiple rooms looks
> expensive. More agents reading more context, more cross-room
> chatter, more prompt overhead. In practice ANT spends fewer tokens,
> not more, because five design choices keep each agent's context
> tight and put the right model on the right slice. Field notes from
> a heavy week of real use:

## The five mechanisms (cards or bullets)

### 1. The CLI is zero-token

Every interaction with ANT — sending a chat, creating a task, reading
evidence, joining a room — goes through the `ant` CLI, which runs in
the shell, not inside an LLM context. Agents only spend tokens on
work they actually decide to do.

> Example: `ant chat send <room> --msg "shipping in 5"` is a shell
> command, not a model invocation.

### 2. Room context is bounded by `/break`

Long-running rooms accumulate weeks of history. Sending all of it to
every agent prompt is wasteful — the agent re-reads obsolete decisions
and re-derives already-solved problems. ANT lets you post `/break`
when a conversation pivots; from that point on, agents in the room
see only post-break context. Old messages stay scrollable for
humans; agents get a fresh, small window.

> Per-room override: rooms with long-memory enabled (e.g. an
> always-on watchdog room) bypass break markers and keep full
> history.

### 3. Plan-as-shared-truth replaces re-derivation

When one agent finishes work, another shouldn't have to re-read the
chat history to figure out what got done. ANT plans hold the
authoritative state — milestones, acceptances, tests, who's doing
what. Agents read the plan instead of re-deriving from chat, which
is both faster and cheaper.

> Mechanism: `plan_event` projector model with append-only events,
> latest-ts wins. The plan view is what every agent sees.

### 4. Lane discipline caps coordination overhead

ANT's multi-agent protocol caps parallel architectural lanes at two.
That keeps each agent in their specialist context (no swap-in/swap-out
of unrelated material) and prevents the n² coordination explosion
that kills bigger agent fleets.

> Side benefit: the same cap forces clean contract syncs between
> agents. Lanes meet at a contract, not in shared state.

### 5. The right model for the right slice

ANT speaks to Claude, Codex, Gemini, Copilot, Qwen, Pi, and local
models from the same coordination surface. That means each slice of
work goes to the cheapest model that can do it well — small local
models for grunt-work, frontier models for architectural calls,
specialist CLIs for their specialist tasks. The bill collapses
because nobody is overpaying for routine work.

> Mechanism: per-agent terminals + room-scoped routing means model
> choice is a deployment decision, not a code rewrite.

## The result line (one sentence, italicised)

> *Field notes from one heavy week: model-usage limits stayed
> untouched, work output went up, and a typical multi-human +
> multi-agent session shipped in roughly half the time it normally
> would by removing the email/Slack polling between colleagues.*

## CTA / link block

Two links:

- **Read the mechanism in detail** → `/docs/CHAT-BREAK.md` (chat-break
  bounded context spec) — primary
- **Multi-agent protocol** → `/docs/multi-agent-protocol.md` (lane
  discipline + contract syncs) — secondary

---

## Implementation notes (for the eventual edit)

- New section sits after the snapshot band ("Not a terminal skin. A
  coordination layer.") and before the capabilities flip grid. This
  preserves the reader's path: positioning → why it doesn't get
  expensive → what it actually does.
- Visually mirror the existing capabilities flip grid layout. Five
  cards is awkward in a 2x2 grid; either lay out 3+2 (top row of
  three, bottom row of two centred) or 1+2+2 (lede card on its own,
  then two pairs). My preference: 3+2 with mechanism #5 ("right model
  for the right slice") as the wide card on the bottom row since it's
  the synthesis. Single column on mobile.
- Each card's "Example" / "Mechanism" sub-block uses the existing
  `code-block` style to match the install section.
- The result line gets the same eyebrow + h2 treatment as other
  sections, so it doesn't read as a footnote.
- Italic for the result line, not bold — bold reads as marketing,
  italic reads as field-notes.

## Open questions for James before this lands on antonline.dev

1. Section title preference (option 1, 2, or 3 above)?
2. The result line names "model-usage limits stayed untouched" — is
   that the right register, or should it be "I didn't hit the rate
   limit once this week" (more first-person, matches his voice)?
3. Are the deep-read links the right two? Other candidates:
   `/docs/multi-agent-session-guide.md` or `/docs/agent-setup/`.

## Out of scope

- Visual polish, hover states, transitions (handled when lifting
  into the live route)
- Card-component reuse decisions (use existing `CapabilityFlipGrid`
  or new component) — defer to implementation pass
