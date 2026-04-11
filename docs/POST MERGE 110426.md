# POST MERGE 11-04-26

Instructions for the human and future Claudes to **check**, **activate**, and
**extend** the multi-agent substrate that landed on
`claude/explore-agent-browser-gcfz3` in April 2026.

Four commits merged as one feature set:

| Commit | Summary |
|---|---|
| `5795c52` | terminal transcripts become a readable, FTS-searchable database |
| `be23ec2` | mempalace schema + multi-agent protocol doc + `ant memory` + `ant agents` CLI |
| `7555bc0` | tmux control mode structured events → `terminal_events` timeline |
| `e5b45ba` | `scripts/idle-tick.ts` — zero-LLM-token background heartbeat |

Together they give ANT the substrate for multi-agent coordination without an
MCP server, without a framework, and without a per-turn token tax. Before any
of it produces value, a short activation sequence needs to run.

---

## Part A — activation checklist (one-time, human)

Do these in order. Each step is <1 minute. None of them can be automated
because they're choices about *what* data to seed, not *how* to seed it.

### A.1 Set the goal

Every agent reads `goals/current` on wake. Without this, step 3 of the wake
ritual returns null and the protocol has no north star.

```bash
ant memory put goals/current '{
  "title": "<one-line north star>",
  "description": "<one paragraph>",
  "owner": "<your handle>",
  "status": "active"
}'
```

Verify:

```bash
ant memory get goals/current
```

### A.2 Seed the agent registry

Write one row per agent you actually want to use. The delegation protocol
chooses from this menu — an empty menu means nothing can be delegated and
every task stays with the most expensive agent available.

Minimal shape (see `docs/mempalace-schema.md` for full field list):

```bash
ant memory put agents/haiku-local '{
  "id": "haiku-local",
  "model": "claude-haiku-4-5",
  "cost": "cheap",
  "strengths": ["file edits","grep","renames","lint","test runs"],
  "avoid": ["architecture","novel algorithms","ambiguous specs"],
  "reliability": 0.5,
  "completed": 0,
  "rejected": 0
}'

ant memory put agents/sonnet-review '{
  "id": "sonnet-review",
  "model": "claude-sonnet-4-6",
  "cost": "medium",
  "strengths": ["verification","spot-checks","test re-runs"],
  "avoid": ["implementation","large edits"],
  "reliability": 0.5,
  "completed": 0,
  "rejected": 0
}'

ant memory put agents/opus-main '{
  "id": "opus-main",
  "model": "claude-opus-4-6",
  "cost": "expensive",
  "strengths": ["architecture","novel algorithms","ambiguous specs","code review"],
  "avoid": ["mechanical edits","lint fixes"],
  "reliability": 0.5,
  "completed": 0,
  "rejected": 0
}'
```

`reliability` starts at 0.5 and converges with experience. Verifiers bump it
on accept, decrement on reject — see the protocol doc.

Verify:

```bash
ant agents list
```

Expect a table with all three rows.

### A.3 Wire your personal `CLAUDE.md` to import the protocol

`CLAUDE.md` is gitignored in this repo (host-specific). The committed
protocol lives at `docs/multi-agent-protocol.md`. One line in your personal
`CLAUDE.md` pulls it in so every Claude Code session reads it on startup:

```markdown
# CLAUDE.md for <host>

@docs/multi-agent-protocol.md
```

Verify from a fresh Claude Code session: the first turn should include the
six-command wake ritual output automatically.

### A.4 Install shell capture hooks (if not already)

The hooks emit OSC 133 markers and NDJSON command events. They're auto-installed
into `~/.zshrc` on first server start, but verify:

```bash
grep -q 'ant/hooks/ant.zsh' ~/.zshrc && echo installed || echo missing
```

If missing:

```bash
ant hooks install
source ~/.zshrc
```

### A.5 Start the idle-tick loop

This is the zero-LLM-token polling loop that keeps the mempalace warm.

**Manual (for testing):**

```bash
bun run idle-tick &
```

**As a launchd agent (macOS, recommended):**

Copy `ant.server.plist.example` to `ant.idle-tick.plist` and adjust
`ProgramArguments` to:

```xml
<array>
    <string>/opt/homebrew/bin/bun</string>
    <string>run</string>
    <string>--cwd</string>
    <string>/absolute/path/to/a-nice-terminal</string>
    <string>idle-tick</string>
</array>
```

Set `RunAtLoad=true`, `KeepAlive=true`, and an `EnvironmentVariables` dict
with `ANT_SERVER_URL` and `ANT_API_KEY` if the server uses bearer auth.

Load it:

```bash
launchctl load ~/Library/LaunchAgents/ant.idle-tick.plist
```

Verify from logs:

```bash
log stream --predicate 'process=="bun"' --style compact | grep idle-tick
```

Or simpler — just check memory:

```bash
ant memory get heartbeat/latest
```

Should show a tick counter that increments every 60 seconds.

### A.6 Sanity check the full pipeline

```bash
# 1. The six-command wake ritual runs cleanly:
cat docs/multi-agent-protocol.md
cat docs/mempalace-schema.md
ant memory get goals/current
ant memory list tasks/
ant memory list digest/ --limit 1
ant agents list

# 2. Terminal history reads from the DB:
ant terminal history <any-terminal-sid> --since 5m

# 3. Terminal events have structured rows:
ant terminal events <any-terminal-sid> --since 1h

# 4. idle-tick is writing heartbeats:
ant memory get heartbeat/latest
ant memory list heartbeat/terminals/
```

If all six return non-empty, the substrate is live.

---

## Part B — what future Claudes should check on every session

This is the evergreen checklist. Paste it into CLAUDE.md or a dedicated
skill doc so every new agent reads it.

### B.1 Run the wake ritual

From `docs/multi-agent-protocol.md` — six commands, ~1–2k tokens, paid once
per session. Do this **before** writing any code.

### B.2 Before delegating, check reliability and last_seen

```bash
ant agents list
```

An agent with `last_seen` older than 24h is effectively offline — deprioritise
it. An agent with `reliability < 0.4` has been rejected more than accepted —
prefer another or do the task yourself.

### B.3 Before accepting a task, check your own row

```bash
ant agents show <your-id>
```

If the task title falls under your `avoid` list, redirect via
`status: blocked, block_reason: "outside capability"` — don't attempt.

### B.4 When done, write evidence

Evidence is command invocations and their outputs, not prose. Minimum:

- commit sha (`git log -1 --format=%H`)
- `ant terminal history <sid> --since 10m` excerpt, or test output
- updated task row with `status: review`, wait for verifier

Never self-approve. Even if you're the only agent around, write
`verifier: "self"` — the checklist still catches mistakes.

### B.5 Watch for loop ping-pong

If you've handed a task to B and it's come back to you in the same chain,
**pause**. Mark the task `blocked` with `block_reason: "loop detected",
awaiting: "human"`. Never auto-resume.

---

## Part C — known open items (ranked by leverage)

From the session that shipped this, in the order I'd tackle them:

1. **`ant.idle-tick.plist.example`** — 20 LOC template so A.5 becomes copy-paste.
2. **Loop-guard enforcement in fan-out messaging** — the protocol says "never
   ping-pong" but the fan-out handler doesn't enforce it. Add a per-chain hop
   counter (~40 LOC in the fan-out handler + config).
3. **Migrate `ant task` to read/write `tasks/*` memory rows** so the legacy
   per-session tasks table and the mempalace converge. ~80 LOC in
   `cli/commands/task.ts` and new DB queries. Today, an agent typing
   `ant memory list tasks/` and `ant task <session> list` sees two different
   views; these need to be the same view.
4. **Claude watcher → ANT messages link.**
   `src/lib/server/capture/claude-watcher.ts:69` has `// TODO: link to ANT
   session for full capture`. Populate so Claude Code jsonl events land in
   the `messages` table. ~60 LOC.
5. **Event-driven wakes (not polling).** idle-tick is 60 s polling. A shell
   hook that emits on test-failure/build-failure and wakes the librarian
   directly would cut the "a test just failed" latency from 60 s to ~1 s.
   Only pursue when you hit a concrete case where the lag hurts.
6. **Retention policy** for `terminal_transcripts` and old memory rows. Do
   nothing until the DB file grows faster than expected — revisit in ~2
   weeks of real use.
7. **Path B Phase 2** — replace the raw PTY byte source with tmux control
   mode's `%output` stream. Would unlock per-pane attribution and
   byte-perfect asciinema-style replays. Requires octal-escape decoder +
   feature flag + live tmux format verification. Only pursue when you want
   split-pane support or the current byte capture proves insufficient.

---

## Part D — things you should NOT do next

Explicit non-goals, in case a future Claude is tempted:

- **Do not add an MCP server.** Every time you consider it, recall the
  ~10 kB-per-turn system prompt cost. The mempalace + CLI substrate replaces
  MCP for multi-agent coordination at ~0 kB per turn.
- **Do not build a CAMEL/agentscope-style framework wrapper.** Every
  abstraction those frameworks provide is already a shell command in ANT.
- **Do not pre-emptively add retention.** Wait for actual data shape.
- **Do not replace xterm.js's internal scrollback with a DB-backed
  viewport.** xterm is the right renderer for the live viewport; the DB is
  the right store for history. Each does its job; don't merge them.
- **Do not commit `CLAUDE.md` to this repo.** It's in `.gitignore` for a
  reason — host-specific. Edit `docs/multi-agent-protocol.md` instead and
  let personal `CLAUDE.md`s `@`-import it.

---

## Part E — design decisions a future Claude should not re-litigate

So I (or any future Claude) doesn't waste tokens re-deriving these:

### E.1 Why no MCP

Token math: MCP tool definitions live in the system prompt on every turn.
A typical MCP-based agent coordinator burns 5–15k tokens per request before
any work. Multiplied by every agent in a conversation and every turn, that's
a 10–100× tax on coordination alone. CLI + memory mean agents pay discovery
costs **once per session** and retrieval costs **on demand** — typically
1–2k tokens per session, and zero per turn.

### E.2 Why memory keys, not a tool registry

Stable keys let agents read/write specific rows deterministically. A tool
registry would require agents to discover tools before using them; memory
keys require no discovery — the schema is the discovery.

### E.3 Why skills docs, not framework-enforced protocols

Written conventions are cheap, editable mid-conversation, and don't require
a redeploy. Frameworks lock you into their conceptual model. Agents are
capable enough to follow written conventions when the substrate makes them
executable — and we enforce the one thing that matters (verification) by
making `evidence[]` a required field on `status: done` task rows.

### E.4 Why a dedicated verifier, not self-approval

Trust propagation requires an independent observer. Self-approval collapses
reliability to self-reported confidence. A separate verifier turns every
task into an opportunity to update the assignee's `reliability` score with
a second opinion.

### E.5 Why the idle-tick is a shell script, not a Claude Code `/loop`

`/loop 1m` burns ~2k tokens per wake whether there's work or not — ~120k
tokens/hour per idling agent. The shell script does the same cheap polling
for zero tokens and only produces LLM load when a digest is compiled (~15
min intervals on delta). 1000× cheaper in the idle case.

### E.6 Why terminal_transcripts is additive, not a replacement for xterm

xterm.js is a renderer, SQLite is a store. Making the DB the source of
truth for history (Path A, shipped) solves the "agents can't read terminal
history" problem. Making the DB the source of truth for the live viewport
(Path B Phase 2, not shipped) is a bigger rewrite with real keystroke
latency risks and no clear payoff today.

### E.7 Why `%output` is parsed but not persisted (yet)

The tmux control mode parser recognises `%output` lines but doesn't act on
them — they're dropped by `PERSIST_KINDS`. That's deliberate: `%output`
fires once per character in busy panes, and persisting each would balloon
the events table while duplicating bytes already captured by the raw PTY
path. Phase 2 would change this by using `%output` as the **only** byte
source, removing the raw PTY read entirely — but that's a rewrite, not an
addition. Don't flip the flag halfway.

---

## Part F — verification commands (copy-paste)

```bash
# Substrate
bun run build                              # svelte-kit + server bundle
npx svelte-check                           # strict type check (0 errors expected)
cd cli && bun build --target=bun index.ts  # CLI bundles

# Data pipes
ant sessions                               # server reachable
ant memory get goals/current               # mempalace reachable
ant agents list                            # registry populated
ant memory get heartbeat/latest            # idle-tick running

# Terminal surfaces
ant terminal history <sid> --since 1h      # Path A read path
ant terminal events <sid> --since 1h       # control mode events
ant terminal events <sid> --kind exit      # filtered event query

# End-to-end sanity
ant memory put tasks/smoke-test '{"title":"smoke","status":"doing","assignee":"haiku-local"}'
ant memory list tasks/
# Wait 16 minutes; the stale task should flip to blocked
ant memory get tasks/smoke-test
ant memory delete tasks/smoke-test
```

If any of these fail, the substrate is not fully activated — return to Part A.

---

## Part G — changelog

- **2026-04-11** (this doc): initial write-up, covers the four commits on
  `claude/explore-agent-browser-gcfz3`. Future Claudes: append your
  substrate-level changes here as a dated section with "what changed" and
  "what you should check".
