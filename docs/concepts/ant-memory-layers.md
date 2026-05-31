---
name: ant-memory-layers
description: "Three memory/recall systems compose on ANT at distinct altitudes, with explicit routing so a fact lives in exactly one lane. ObsidiANT = canonical durable shared ledger (markdown + git, scope-gated, room-attachable). mempalace = fast private recall engine (semantic + temporal knowledge graph, AAAK compression, diary). semble = code/repo discovery only, NOT memory (vault is denied). Lanes cross-reference (kg_entities frontmatter ↔ KG source_closet), never duplicate. Personal contract today = ANT `ant memory` product blueprint later, no rework."
metadata:
  type: project
  importable: true
  category: concept
  scope: user
kg_entities:
  - ant-memory-layers
  - ObsidiANT
  - mempalace
  - semble
---

# ANT memory layers — three lanes, one fact per lane

## TL;DR

Three systems hold "what I know," but they are NOT interchangeable. Pick the lane at **write-time** by question type and durability; a given fact lives in **exactly one** lane.

- **ObsidiANT** = the **ledger**. Canonical, human-readable markdown, git-versioned, scope-gated (user/org/public), room-attachable via `ant memory recall/add`. Durable, auditable, shareable across agents and machines.
- **mempalace** = the **engine**. ChromaDB semantic search + a SQLite knowledge graph with temporal facts (`valid_from`/`valid_to`, invalidation) + AAAK ~30× compression + diary. Fast, private, single-machine. Answers "what is true about X, and what *was* true when."
- **semble** = the **code map**. Privacy-bounded repo discovery — "where in the code is X." Its allowlist *denies* the ObsidiANT vault. **Not a memory system; never store memory here.**

The pathology this kills: multiple systems doing one job with no rule for which → the same fact double-landed, drift between copies, wasted recall hops.

## Capabilities

### The layering model

| Lane | Owns (altitude) | Store | Scope | Strength | Never used for |
|---|---|---|---|---|---|
| **semble** | *Where* — code structure | ANT-owned repos (allowlist) | dev-machine, code only | "which file / where is this pattern" | any memory; vault is denied |
| **mempalace** | *Recall engine* — fast + temporal + private | ChromaDB + SQLite KG | personal, single-machine | speed, entity facts, "true from→to", dedup, diary | shareable/auditable canonical records |
| **ObsidiANT** | *Ledger* — durable, shared, audited narrative | markdown + git | user/org/public, cross-agent, cross-machine | auditability, room-attach, scope gating | ephemeral private notes; fast structured lookups |

**Peers, not cache.** mempalace is deliberately *not* a derived index of ObsidiANT. A fact is **either** a canonical shared record (→ ObsidiANT) **or** a fast/temporal/private fact (→ mempalace), never both. They cross-reference; they don't copy.

### Write routing — "where does this new thing go?"

- **Code structure / where-is?** → not a memory. Re-derive via **semble** (or `rg`). Store nothing.
- **Durable, shareable, auditable** — a decision, feedback, project state, concept, ratified spec others (humans or agents) need? → **ObsidiANT** canonical markdown. (Sibling rule: *banking writes to the user vault, not agent-private.*)
- **Fast-lookup, private, or time-varying** — an entity relationship, "X was true from A to B," a diary observation, a working-set note? → **mempalace** (KG triple and/or drawer + diary).

### Read routing — "where do I recall from?"

- "Where is X in the code / which file does Y" → **semble**.
- "What do I know about `<person/project/entity>`, what's current, what changed" → **mempalace KG first** (temporal), then follow its `source_closet` pointer to the ObsidiANT writeup if one exists.
- "What's the canonical/shared decision / concept / feedback" → **ObsidiANT** (`ant memory recall --search`).

### Cross-reference convention (links, not duplication)

The bit that keeps lanes distinct yet connected:

- **ObsidiANT → mempalace:** md frontmatter carries an optional `kg_entities:` list — the entities a memory concerns. Lets the KG point back at the canonical narrative.
- **mempalace → ObsidiANT:** a KG triple's `source_closet` field points at the ObsidiANT md file path. The engine says "for the full story, read this file."
- **Promotion path:** when a private mempalace temporal fact becomes a *ratified, shareable* decision, **promote** it — write it once as an ObsidiANT canonical memory, update the triple's `source_closet` to point at it. Content never lives in both bodies.

## Architecture

- **ObsidiANT vault:** `~/CascadeProjects/ObsidiANT/memory-pack/` (core/ concepts/ research/ skills/). Frontmatter + body + `[[wikilinks]]`. Mirror of `docs/concepts/` repo-canonical docs. Frontmatter contract: `docs/concepts/_manifest.md` (incl. the optional `kg_entities:` field).
- **mempalace:** pipx MCP at `~/.local/pipx/venvs/mempalace/`; data in `~/.mempalace/`. Tools `mcp__mempalace__*` (KG: `kg_query` / `kg_add` / `kg_invalidate` / `kg_timeline`; drawers: `add_drawer` / `search` / `check_duplicate`; `diary_*`; `status` / `get_aaak_spec`). Query-before-respond protocol surfaced by `mempalace_status`.
- **semble:** spec at `docs/research/semble-mcp-scope-2026-05-20.md`; allowlist `scripts/semble-ant-owned-allowlist.json` (ANT-owned repos only; vault + agent state denied).

## CLI commands

```sh
# ObsidiANT — the ledger
ant memory recall --search "memory layers"        # read canonical records
ant memory recall --memID <mem_id>                 # read a specific memory
ant memory add --roomID <room> --memID <mem_id>    # attach a memory to a room
ant memory add --all-rooms --memID <mem_id>        # attach everywhere

# mempalace — the engine (MCP tools, query-before-respond)
mempalace_status                                   # load palace overview + AAAK spec on wake
mempalace_kg_query  <entity>                       # current facts about an entity
mempalace_kg_timeline <entity>                     # historical "what was true when"
mempalace_kg_add    <subject> <predicate> <object> --valid_from <date>
mempalace_kg_invalidate <subject> <predicate> <object> --ended <date>
mempalace_search    "<query>"                      # semantic drawer search
mempalace_diary_write <agent> "<entry>"            # private session journal

# semble — the code map (NOT memory)
#   route "where is X in the code" here; rg is first choice for exact literals
```

## Common patterns

- **New decision lands in a room** → write canonical md to ObsidiANT (`ant memory add` to the room) → if it concerns tracked entities, add a `kg_add` triple in mempalace with `source_closet` = the md path.
- **"What's the state of project P?"** → `mempalace_kg_query P` for current/temporal facts → open the `source_closet` ObsidiANT doc for the full ratified narrative.
- **"Where does the auth gate live?"** → `rg`/semble in the ANT repo. Do **not** ask mempalace or ObsidiANT.
- **A private working hunch hardens into a shared rule** → promote: write ObsidiANT memory once, repoint the KG triple's `source_closet`, leave no duplicate body in the drawer.

## Product blueprint (later — packaging, not re-architecture)

Because the personal contract already treats ObsidiANT as canonical and mempalace as a private engine, the ANT product falls out for free:

- **`ant memory` primitive = ObsidiANT-as-canonical** + scope gating + room-attach (the planned `ant-memory-and-attach.md`).
- **mempalace = optional per-terminal engine** — each terminal may run its own private index over the canonical memories it can see; *not* shared product state. Matches *"ANT doesn't pick models — terminals do": each terminal brings its own recall engine and pays its own bill.*
- **semble = dev tool, out of the memory primitive** — documented boundary only.

## Related concepts

- `_manifest.md` — pack manifest + frontmatter contract (`kg_entities:` field) + default-attach policy
- `ant-memory-and-attach.md` — (planned) the `ant memory` product feature this contract blueprints
- `ant-bridge.md` — local MCP+CLI bridge that fronts these tools
- Private memories: `feedback_banking_writes_to_user_vault_not_agent_private_2026_05_27.md`, `project_memory_search_and_attach_to_rooms_2026_05_27.md`, `project_room_memory_primitive_spec_jwpk_2026_05_22.md`
