# ANT Vote — a voting primitive for multi-agent rooms

**Status:** concept (proposed 2026-06-09, JWPK). Spine to follow.
**Why now:** multi-agent rooms collapse into a mess without structured voting. Observed live in the Research Colony rating session — agents posting `4.5/10`, `8.5/10`, `7/7 READY` as freeform chat lines: no electorate, no tally, no state, no surfacing. `ant chat decide` records *an outcome*; it does not *collect ballots → an outcome*. Voting is the missing primitive.

## What a vote is

A **first-class durable object** (like tasks, blocks, decks): agents (and humans) cast ballots; the room and the user see live state and the result.

```
Vote {
  id
  scope:        { kind: 'room' | 'multi-room', rooms: roomId[] }
  subject:      string                 // the question
  kind:         'options' | 'scale' | 'approve-reject' | 'ranked'
  options:      string[]               // for options/ranked; scale uses min/max
  electorate:   { mode: 'explicit' | 'all-agents' | 'role', handles?: [], role?: }   // WHO CAN VOTE
  status:       'open' | 'closed' | 'tallied'                                         // STATE
  quorum?:      number                 // min ballots before it can tally
  closesAt?:    epochMs                // optional deadline (auto-close)
  createdBy, createdAtMs
  ballots:      Ballot[]
  result?:      { tally, outcome, talliedAtMs }   // set on tally
}
Ballot { voter, choice, weight?, rationale?, roomContext, atMs }
```

The variables JWPK called out map directly: **who can vote** = `electorate`, **open?** / **complete?** / **state** = `status` (+ `quorum`/`closesAt`), plus the live tally and who's-voted-vs-outstanding derived from `ballots` against `electorate`.

## CLI — `ant vote` (mirrors `ant task`)

```
ant vote open  --room R --q "…" --options "a|b|c"
               [--scale 1-10] [--approve-reject] [--ranked]
               [--electorate @x,@y | --all-agents | --role verifier]
               [--quorum N] [--closes 30m] [--rooms R1,R2,R3]
ant vote cast  <id> --choice X [--weight W] [--why "…"] --handle @me
ant vote show  <id> [--json]      # question · live tally · voted vs outstanding · status · quorum-met?
ant vote list  --room R [--open]
ant vote close <id> [--json]      # → tally + outcome (also auto-closes at closesAt/quorum)
```

## Surfacing to users

A vote renders as a **live poll card** in the room: the question, options with a bar tally, `N/M voted` (electorate progress), an `open`/`closed`/`tallied` badge, and the outcome when complete. **Humans vote too** (a human ballot is just a ballot). This replaces the freeform chat-score soup with one glanceable object.

## Cross-room (the "different perspectives, different contexts" idea)

A vote may span rooms. Three models, layered:

1. **Span (v1 — recommended).** One vote; `electorate` is drawn from `scope.rooms`. Each agent casts from *its own* room, so `roomContext` rides on the ballot. You can then see how the Research room voted vs the Build room — same question, different contexts, one tally (with a per-room breakdown).
2. **Replicate + aggregate.** Clone the vote into sibling rooms; tally a meta-result across them. Good when each room should deliberate independently first.
3. **Roving voter.** A single agent that sits across N rooms casts N context-distinct ballots — gathering varied perspectives itself.

v1 ships **Span**; (2)/(3) layer on the same object (`scope.rooms` + `roomContext` already carry what they need).

## State machine

```
open ──(ballot cast)──▶ open ──(quorum met │ closesAt │ `vote close`)──▶ closed ──(tally)──▶ tallied
```
`show` always exposes: `status`, `electorate` vs `ballots` (voted / outstanding), live `tally`, `quorum`-met?, and `result` once tallied.

## Relationship to existing primitives

- **Complements `ant chat decide`** — `decide` records *a* decision; `vote` produces one *from* ballots. A tallied vote can auto-emit a `decide`.
- **Same shape as `ant task`/blocks/decks** — durable object + `ant <noun>` CLI + room surfacing + REST. Build the spine the curated-queue way (store → REST → CLI → tests → adversarial-verify).

## Build order (proposed)

1. `voteStore` (table `room_votes` + `vote_ballots`; open/cast/show/list/close; one-ballot-per-voter; quorum/close logic) + tests.
2. REST `/api/chat-rooms/[roomId]/votes{,/[voteId],/cast,/close}` (mutation-gated).
3. `ant vote` CLI verbs.
4. Poll-card UI in the room (live tally + electorate progress).
5. Cross-room Span (electorate across `scope.rooms`, per-room tally breakdown).
