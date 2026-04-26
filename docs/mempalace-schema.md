# Mempalace schema

The mempalace is just the `memories` table in ANT's SQLite DB, accessed via
`ant memory` and the `/api/memories` HTTP surface. It becomes a *palace*
when every agent agrees on a small set of key prefixes.

This document is the source of truth for those prefixes. If you want to add
one, edit this file first and the next agent will read it.

## Key conventions

Keys are slash-delimited. Prefix defines category, remainder identifies the
row. Values are JSON objects encoded as strings — SQLite's `memories.value`
column is `TEXT`, so the serialisation lives at the application layer.

Every memory row has stable identity via `key`: two writes to the same key
**upsert**, they do not create duplicates. That means agents can safely
re-write the same task row whenever its state changes.

## The four axes

### 1. Goals — what we're trying to achieve

```
goals/current                   Single pinned top-level goal for the workspace
goals/<slug>                    Named sub-goals with an optional parent ref
```

Value shape:

```json
{
  "title": "Ship multi-agent coordination v1",
  "description": "Agents collaborate via mempalace + skill docs, not MCP",
  "parent": null,                // or "goals/<slug>" for sub-goals
  "owner": "<agent-id-or-human>",
  "status": "active",            // active | paused | achieved | abandoned
  "created_at": "<iso>",
  "updated_at": "<iso>"
}
```

### 2. Tasks — what's being done and what's next

```
tasks/<id>                      One task row. id can be t-<epoch> or a slug.
```

Value shape:

```json
{
  "title": "rename getCwd → getCurrentWorkingDirectory across src/",
  "status": "todo",              // todo | doing | review | blocked | done
  "delegator": "<agent-id>",     // who created the task
  "assignee": "<agent-id>",      // who's doing it
  "verifier": "<agent-id>",      // who will accept/reject (never = assignee)
  "goal": "goals/<slug>",        // optional — which goal this serves
  "done_criteria": "…",          // how the verifier knows it's complete
  "plan": "…",                   // one-line plan posted by assignee before starting
  "evidence": [                  // command invocations and outputs, not prose
    "git log -1 --format=%H → abc123…",
    "ant terminal history sid --since 10m → …",
    "bun test → 42 passing"
  ],
  "block_reason": null,          // set when status = blocked
  "last_rejection": null,        // set on reject, cleared on re-accept
  "created_at": "<iso>",
  "updated_at": "<iso>"
}
```

### 3. Done — the archive

```
done/<yyyy-mm-dd>/<task-id>     Completed task rows, never modified
```

Archived when a task transitions to `done`. The verifier copies the task
row value into `done/<date>/<id>` verbatim. The live `tasks/<id>` row stays
around with `status: done` for a while then is cleaned up by the idle-tick
script (older than 14 days → deleted from `tasks/`, kept in `done/`).

### 4. Session archives — summaries, not working memory

```
session:<safe-session-name>     Concise archive summary for one ANT session
```

Session archive rows are allowed in the memories table so old work remains
searchable, but they are **not** operational context. They must contain a
short session summary, participants, task/file references, and a bounded
set of key exchanges. They must not contain raw tmux output, agent event JSON,
or full transcripts. Full transcripts live in ANT session history, not in live
memory and not in the Obsidian vault.

Do not create a memory for a session with no learnable content. Test terminals,
empty setup sessions, launch smoke tests, and pure command-routing checks may
be useful logs, but they are not memory palace material. They should stay in
session history or Obsidian only.

Default memory reads and searches exclude `session:*` rows. Use explicit
archive scope when an agent or user really wants historical session material.

### 5. Agents — the registry

```
agents/<id>                     One agent's capability and reliability row
```

Value shape:

```json
{
  "id": "haiku-local",
  "model": "claude-haiku-4-5",
  "cost": "cheap",               // cheap | medium | expensive
  "strengths": [
    "file edits", "grep", "renames", "lint fixes", "test running"
  ],
  "avoid": [
    "architecture decisions", "novel algorithms", "ambiguous specs"
  ],
  "reliability": 0.92,           // 0..1, updated by verifier on accept/reject
  "completed": 47,
  "rejected": 5,
  "join": "ant chat <session-id>",
  "last_seen": "<iso>",          // updated by idle-tick when terminal is alive
  "created_at": "<iso>",
  "updated_at": "<iso>"
}
```

Notes:

- `strengths` and `avoid` are prose arrays, not a taxonomy — that's
  deliberate. Agents learn to match task text against these.
- `reliability` starts at 0.5 for new agents and converges with experience.
- `last_seen` older than 24h effectively deprioritises the agent for
  delegation — the delegator's skill doc says so.

## Supporting prefixes

### Heartbeat — script-populated world state

```
heartbeat/terminals/<session-id>   { hash, last_change, idle_for }
heartbeat/git/<repo>                { ahead_count, behind_count, last_fetch }
heartbeat/fs/<repo>                 { dirty_files, last_hash }
heartbeat/latest                    one consolidated row for quick reads
heartbeat/memories/latest           latest non-LLM memory hygiene audit
```

Written by `scripts/idle-tick.sh` (coming next) at zero LLM cost. Agents
read `heartbeat/latest` on wake to skip per-category reads when they just
need "has anything changed since my last turn."

### Digest — LLM-compiled summaries

```
digest/<epoch-ms>               A librarian's summary of recent heartbeat
                                and task activity
```

Written every ~15 minutes by a dedicated librarian agent that batches
heartbeat deltas into one short paragraph. Agents read the latest digest on
wake instead of replaying the raw heartbeat stream.

Value shape:

```json
{
  "window_start_ms": 1234567890,
  "window_end_ms": 1234568790,
  "summary": "git: 3 commits on feature/foo. terminal sid-42 idle. task t-91 stalled in review (verifier haiku-local unreachable).",
  "contradictions": [],          // librarian flags these for a human
  "compiled_by": "<librarian-agent-id>"
}
```

### Thinking — optional breadcrumbs

```
thinking/<agent-id>/<epoch-ms>   Free-form notes an agent leaves for itself
```

Use sparingly. These are not read by other agents except via search. They
exist so an agent can write "I decided X because Y" without cluttering
tasks/ or chat.

### Audit — hygiene reports

```
audit/<domain>/<yyyy-mm-dd>       Optional persisted audit reports
```

Most audits are exposed via endpoints and `heartbeat/*`; persist an `audit/*`
row only when a human needs a durable report. Audit rows should be concise
JSON reports with issue counts and references to affected keys, not copies of
the affected memory values.

## Lifecycle rules

- **`goals/*`** — rarely changes. `goals/current` is pinned.
- **`tasks/*`** — live state. Mutated freely during work.
- **`done/*`** — append-only. Never mutated after creation.
- **`session:*`** — archive-only. Updated on export, never injected as
  default operational context.
- **`agents/*`** — updated on every task verification (accept or reject)
  and by the idle-tick script for `last_seen`.
- **`heartbeat/*`** — high churn. Older than 1 hour is overwritten.
- **`digest/*`** — append-only. Older than 30 days is pruned.
- **`thinking/*`** — append-only. Older than 7 days is pruned.
- **`audit/*`** — append-only only when deliberately persisted. Older than
  30 days is pruned unless pinned in Obsidian.

Pruning is done by `scripts/idle-tick.sh`, not by agents.

## Access patterns

```bash
# Read one row
ant memory get tasks/t-42

# Read all rows under a prefix (default orders by updated_at desc)
ant memory list tasks/
ant memory list agents/

# Full-text search operational memory
ant memory search "rename getCwd"
ant memory search "rename getCwd" --all

# Hygiene report
ant memory audit

# Upsert one row (overwrites any existing row with the same key)
ant memory put tasks/t-42 '{"title":"…","status":"doing", …}'

# Delete one row
ant memory delete tasks/t-42
```

These commands are thin wrappers over the existing `/api/memories` HTTP surface
plus the `/api/memories/key/<key>`, `/api/memories/prefix`, and
`/api/memories/audit` routes. No MCP server, no framework, no per-turn token tax.

## Why this works without a framework

The schema above is ~200 lines of documentation. The code required to
support it is ~100 lines of CLI + ~50 lines of SQL. A framework like CAMEL
or MCP-based agent coordination would replace all of this with 5–15k
tokens of system prompt **every turn**.

Agents are capable of following written conventions. The only thing
conventions can't enforce is the verification gate — and we enforce that by
making `evidence` a mandatory field on `status: done` task rows. The
verifier reads the evidence, not the prose. That's the entire trust model.
