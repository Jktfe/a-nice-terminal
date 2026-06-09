# ANT Vote - a voting primitive for multi-agent rooms

**Status:** v0 implemented, verifier-green, 2026-06-09.
**Reason:** multi-agent rooms need a structured way to gather positions without turning the room into freeform score chat. `ant chat decide` records an outcome; `ant vote` collects ballots that produce an outcome.

## What a vote is

A vote is a durable room object:

```ts
type Vote = {
  id: string;
  roomIds: string[];
  title: string;
  body: string;
  options: VoteOption[];
  eligibleVoters: string[];
  open: boolean;
  complete: boolean;
  status: 'open' | 'complete' | 'closed';
  ballots: VoteBallot[];
};

type VoteBallot = {
  voterHandle: string;
  optionId: string;
  reason: string;
  roomId: string;
  castAtMs: number;
};
```

The state users need is derived from that object: who can vote, whether it is open, whether it is complete, the tally, and which eligible voters are still missing.

## CLI

The v0 command is `create`, not `open`, to match the existing ANT noun/verb shape.

```bash
ant vote create --room "Research Colony" \
  --title "Pick the delivery route" \
  --options "ship-now,hold,split" \
  --voters "@oiresearch,@researchant,@minisearch" \
  --rooms "Research Colony,Creative ANTS"

ant vote list --room "Research Colony"
ant vote show <voteId> --room "Research Colony"
ant vote cast <voteId> --room "Research Colony" --option ship-now --reason "smallest reversible step"
ant vote close <voteId> --room "Research Colony"
```

Create, cast, and close post system receipts into every bound room so the vote remains visible across the whole span.

## Cross-Room Span

v0 ships the **Span** model: one vote can bind multiple rooms, but each eligible handle still has one ballot for the whole vote. If the same handle casts again from another bound room, the ballot updates rather than double-counting.

This gives a single tally with room context preserved on each ballot. It is the right default for agents that sit across rooms and need to surface different contexts without creating duplicate decisions.

## State

```text
open + incomplete  -> waiting for eligible voters
open + complete    -> all eligible voters have cast, still closeable
closed             -> no further casts accepted
```

Rejected actions in v0:

- ineligible handle casts;
- cast from a room not bound to the vote;
- cast after close;
- duplicate ballot counted as a second vote.

## UI

The room UI includes a **Votes** panel in More and the pinnable right rail. The first UI slice is intentionally read-mostly:

- shows open / complete / closed state;
- shows tally and missing voters;
- shows the exact `ant vote cast` and `ant vote close` command shapes;
- shows the quiet create command when a room has no votes.

Browser-side vote buttons are deferred until browser identity semantics are explicit. A human ballot is still just a ballot, but the app must know which handle it is casting as before it mutates votes from the UI.

## Relationship To Existing Primitives

- `ant chat decide` records a decision.
- `ant vote` gathers ballots and can later emit a decision receipt once the room accepts the outcome.
- Tasks, blocks, decks, and votes all follow the same durable object pattern: store -> REST -> CLI -> room surfacing -> tests -> adversarial verification.

## Later

These are good extensions, but not v0:

- quorum and deadline auto-close;
- scale, approve/reject, and ranked vote types;
- per-room breakdown charts;
- browser cast controls;
- replicated room votes with aggregate roll-up.
