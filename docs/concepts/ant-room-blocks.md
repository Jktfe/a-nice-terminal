# Room Blocks — ANT's unit of room memory

_Designed by JWPK in Oldboys, 2026-06-05, captured by @v4claude. A core ANT
concept: the room is segmented into addressable, summarisable, curatable blocks._

## The idea

A room's history is segmented by **context breaks** (`system-break` messages)
into **blocks**. A break already creates a real boundary — agents only see
messages since the last break; humans see everything. Blocks make that boundary
a **first-class, addressable unit** with state and a cover page.

> A break stops being a thin divider and becomes a chapter checkpoint: "here's
> the state of play; everything above is sealed." An agent resuming reads the
> board, not a bare "switching lane."

## The seven facets (all on one foundation)

1. **Addressable + readable.** Any block can be looked up and read on demand —
   `readBlock(roomId, blockId)`. An agent asked to "summarise the previous
   section" fetches that block and reads its messages. (BUILT — `roomBlocksStore`.)
2. **State-board cover.** When a break seals a block it captures a rich snapshot
   — the lanes-by-goal board (swimlanes × stage columns, task cards with status +
   dependency arrows, milestone diamonds). The board is the *quick* read; the
   messages are the *deep* read. (Storage BUILT — `roomBlockStateStore.snapshot_json`;
   capture + render = follow-up.)
3. **Search scoped to the current block.** Search defaults to the current
   (open) block — the boundary agents already live under — and an **"all content
   available"** toggle widens it to full history. Reuses the existing break
   boundary rather than inventing a second concept. (`readCurrentBlock` BUILT;
   wire into search = follow-up.)
4. **Block soft-delete.** A block marked `deleted` is SKIPPED in reads / memory /
   research / reviews but its rows are NEVER removed (audit). (BUILT —
   `setBlockDeleted` + skip-by-default + `includeDeleted` audit view.)
5. **Ownership-scoped deletion.** "If someone posts something stupid I can delete
   it so it won't pollute research." A user can delete their OWN messages (exists:
   `softDeleteMessage` author-check) AND messages of agents/terminals they OWN.
   The owned-agents part needs the **F1 ownership model** (accounts-linked
   agentID) — same dependency as the 7-gate caller-identity work. (Own-message
   delete works; owned-agents = F1 follow-up.)
6. **Reaction-weighted summaries.** When summarising a block, weight messages by
   their user reactions (👍 etc.) — high-signal messages count more.
   `readBlock` already returns each message's `reactions`, so the summariser has
   the weights for free. (Foundation ready; summariser = follow-up.)
7. **Audit-preserving throughout.** Nothing is ever physically removed — deleted
   messages and deleted blocks are tombstoned and recoverable. Clean memories +
   reviews on the surface; a complete forensic record underneath.

## Why it matters (the "ANT is my brain" tie-in)

Blocks are the substrate for durable, curatable agent memory: an agent compacts
freely because the room's history is chunked into sealed, summarisable,
de-noised sections it can retrieve on demand. The board cover + reaction weights
make summaries fast and high-signal; soft-delete keeps research clean; the audit
trail keeps it honest.

## Build state (branch `v4claude/room-blocks`, commit `dee4d83`)

FOUNDATION SHIPPED + tested (4 tests, tsc 0): `roomBlocksStore` (list/read/
current, skip-deleted) + `roomBlockStateStore` (delete tombstone + snapshot
storage). Layers on top: break-snapshot capture+render (facet 2), search wiring
(3), reaction-weighted summariser (6), owned-agent deletion (5, F1-gated).
Foundation is additive — touches no existing table, changes no existing read.
