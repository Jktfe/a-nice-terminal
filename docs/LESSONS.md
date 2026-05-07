# Lessons & insights

A retrospective on what ANT taught us — distilled from the four prose
docs in this directory and the 58 commits that produced them. Two
audiences:

- **Part 1 — transferable insights**: for anyone building agent
  systems. Reusable claims that apply outside ANT.
- **Part 2 — ANT-specific decisions**: design choices a future
  contributor should not re-litigate.
- **Part 3 — regressions the commit log taught us**: concrete
  gotchas with sha-cited evidence.
- **Part 4 — changelog**: append-only, dated entries.

## TL;DR

1. Convention beats framework. ~200 lines of markdown + ~150 lines of
   CLI/SQL replaces 5–15k tokens/turn of MCP tool schema tax.
2. Stable key prefixes (`goals/`, `tasks/`, `agents/`) require zero
   discovery. The schema *is* the discovery.
3. The trust model is one rule: a separate verifier reads the evidence,
   not the prose. Self-approval collapses reliability to self-report.
4. Evidence is command invocations and their outputs. Prose is not
   evidence.
5. Background polling belongs in shell/bun scripts at zero LLM cost,
   not in `/loop` calls that burn ~120k tokens/hour idling.
6. Plain text injected into a PTY is a coordination channel. JSON
   schemas, retry loops, and tool-call envelopes are tax.
7. Normalise agent events at the driver layer; the UI consumes one
   schema and knows nothing about specific CLIs.
8. In real multi-agent sessions, the lead delivers 60–80% of the work.
   Plan for it.
9. Checkpoints, not status polling. "Report when X lands" beats
   "are you done yet?" every 5 minutes.
10. xterm renders the live viewport; SQLite stores the history. Don't
    merge the two.

---

## Part 1 — Transferable insights

### 1.1 Convention over framework beats the MCP tool tax

> "MCP tool definitions live in the system prompt on every turn. A
> typical MCP-based agent coordinator burns 5–15k tokens per request
> before any work. … CLI + memory mean agents pay discovery costs
> **once per session** and retrieval costs **on demand**."
> — `docs/POST MERGE 110426.md` §E.1

If your coordination layer is text-based (CLI commands + a shared store)
and your agents already speak shell, you don't need a framework or an
MCP server. You need a markdown doc the agents read on wake. The
mempalace + `ant` CLI replace MCP-style coordination at ~0 kB per turn
versus ~10 kB-per-turn-per-tool with MCP.

When to break this rule: you have non-shell consumers (browser
extensions, mobile apps) that genuinely need typed tool schemas.

### 1.2 Stable key prefixes beat tool registries

> "Stable keys let agents read/write specific rows deterministically.
> A tool registry would require agents to discover tools before using
> them; memory keys require no discovery — the schema is the discovery."
> — `docs/POST MERGE 110426.md` §E.2

ANT uses four prefixes (`goals/`, `tasks/`, `agents/`, `heartbeat/`)
plus two supporting (`done/`, `digest/`, `thinking/`) — see
`docs/mempalace-schema.md`. Adding a new coordination pattern is one
`ant memory put` call, not an SDK update + redeploy.

The key insight: agents are perfectly capable of reading a 200-line
markdown schema and writing JSON to documented keys. They do not need
strongly-typed runtime tools to do that.

### 1.3 Mandatory separate verifier is the entire trust model

> "Trust propagation requires an independent observer. Self-approval
> collapses reliability to self-reported confidence. A separate
> verifier turns every task into an opportunity to update the
> assignee's `reliability` score with a second opinion."
> — `docs/POST MERGE 110426.md` §E.4

The `assignee → verifier` split is enforced by a single field
(`evidence[]` is required when `status: done`). Reliability
propagates: verifier accepts → assignee's score goes up; rejects →
goes down (`docs/multi-agent-protocol.md` §"Updating the registry").

Even when there's only one agent around, write `verifier: "self"`
anyway — the checklist still catches mistakes
(`docs/POST MERGE 110426.md` §B.4).

### 1.4 Evidence is commands and outputs, never prose

> "Don't post prose evidence. Evidence is commands and outputs. If you
> can't show it as a command output, it isn't evidence."
> — `docs/multi-agent-protocol.md` §"What not to do"

Concrete: `git log -1 --format=%H → abc123…` is evidence;
"I refactored the auth module" is not. This makes verification
mechanical. The verifier doesn't have to parse intent — they re-run
one of the commands and compare.

### 1.5 Zero-LLM-token background work

> "/loop 1m burns ~2k tokens per wake whether there's work or not —
> ~120k tokens/hour per idling agent. The shell script does the same
> cheap polling for zero tokens and only produces LLM load when a
> digest is compiled (~15 min intervals on delta). 1000× cheaper in
> the idle case."
> — `docs/POST MERGE 110426.md` §E.5

`scripts/idle-tick.ts:1-47` is the reference implementation: a Bun
script that polls `/api/sessions`, hashes terminal output, marks stale
tasks blocked, and writes `heartbeat/latest`. Zero LLM calls per tick.
Agents only wake when there's a delta worth compiling into a digest.

The general principle: any work that doesn't need an LLM should not
involve one. If your agent loop is mostly "check if anything
changed", that loop belongs outside the LLM.

### 1.6 Plain text over PTY beats structured agent protocols

> "Plain text PTY injection (no ANSI) works for ALL agents including
> Claude Code"
> — commit `cf15898` ("7-phase ANT architecture refactor")

Agents already accept terminal input. Treating that as the
coordination channel — `[antchat message for you] '...'` strings
injected via PTY — eliminates JSON schema validation, tool-call
formatting, and retry loops. The agent's existing language model
parses the message; no envelope, no retry.

Caveat: PTY quirks vary by CLI. Claude Code's multi-line mode needs
two `\r` to actually submit (commit `8047f40`). That's worth one
80-line driver, not a framework.

### 1.7 Normalised event schema decouples UI from agent drivers

ANT's fingerprint pipeline (`FINGERPRINTING.md`) defines seven event
classes (`permission_request`, `multi_choice`, `confirmation`,
`free_text`, `tool_auth`, `progress`, `error_retry`). Each driver
(`src/drivers/claude-code/`, `gemini-cli/`, `codex-cli/`, …)
implements `detect / respond / isSettled`. The chat UI consumes
normalised events only; adding a new agent never touches the UI.

This is the inverse of the MCP pattern: instead of every consumer
learning every tool's schema, every producer normalises into one
shared schema. The schema lives in 7 enum values; drivers are
~100–300 LOC each.

### 1.8 The lead carries 60–80% of delivery — plan for it

> "In the reference session, the lead (Claude) ended up delivering
> 80% of the work by picking up tasks when other agents stalled. This
> is normal and expected — the lead's job is to keep momentum, not
> to distribute work evenly."
> — `docs/multi-agent-session-guide.md` §6

Don't design for an even task split. Design for the lead picking up
slack. If you design for parity, every stall blocks the project; if
you design for asymmetry, stalls are absorbed.

### 1.9 Checkpoints, not status polling

> "Asking 'are you done?' every 5 minutes wastes everyone's context.
> Set explicit milestones."
> — `docs/multi-agent-session-guide.md` §11

The lead sets a checkpoint when assigning ("report back when vitest
is wired up and the grid fix lands"). Two unprompted status pings
means something is wrong — investigate or reassign.

### 1.10 Written conventions beat framework-enforced protocols

> "Written conventions are cheap, editable mid-conversation, and
> don't require a redeploy. Frameworks lock you into their conceptual
> model. Agents are capable enough to follow written conventions when
> the substrate makes them executable — and we enforce the one thing
> that matters (verification) by making `evidence[]` a required field
> on `status: done` task rows."
> — `docs/POST MERGE 110426.md` §E.3

Enforce the one thing that matters in code (the schema). Leave the
rest in markdown. Agents follow it.

### 1.11 Boundary-hop diagnosis beats single-cause fixes

When a live integration fails, map every boundary and test each hop
directly before patching. Reproduce the user-path symptom, then split
the path into independently provable steps: local config, URL/protocol
selection, auth/upgrade, server log entry, daemon call, persisted
evidence.

This pattern caught the M1 WS-send failure in May 2026. The first
diagnosis found that `http://` CLI config produced `ws://` against an
HTTPS ANT server. A second audit pass found a separate auth-ordering
bug: the WebSocket upgrade treated the configured master API key as an
invalid room invite token before checking admin auth. Either fix alone
would have shipped half-correct.

**Lesson**: don't stop after the first plausible root cause. If a
workflow crosses process, protocol, auth, or persistence boundaries,
prove each boundary with the smallest direct probe and make the
failure move. The patch is allowed only after the boundary map explains
the symptom end to end.

### 1.12 Hook → state file → renderer beats transcript-polling for live status

A custom CLI status indicator (e.g. "Working / Waiting / Response
needed / Menu / Permission") wants two things that are in tension:
**deterministic state** (don't guess from text), and a **fast render
path** (no LLM call per redraw). The pattern that solves both:

```
host CLI fires lifecycle events
       │
       ▼
hook scripts (one per event)
       │       writes
       ▼
~/.claude/state/<session_id>.json   ←── single source of truth
       ▲       reads
       │
status renderer (jq + plain text — no LLM, no transcript walk)
```

Lifecycle hooks → state mapping that worked across Claude Code, and
should translate directly to any CLI that exposes equivalent events:

| State            | Trigger                                                                  |
|------------------|--------------------------------------------------------------------------|
| Available        | `SessionStart`                                                           |
| Working          | `UserPromptSubmit`                                                       |
| Menu             | `PreToolUse` matches `AskUserQuestion` / `ExitPlanMode`; cleared by `PostToolUse` for the same tool |
| Permission       | `Notification` of permission type, or `PermissionRequest`                |
| Response needed  | `Stop` and the assistant text contains a question; or `Notification idle_prompt` |
| Waiting          | `Stop` and assistant text has no question                                |

The "is there a question in the last 2 paragraphs" decision is the
only place a model is needed. We use a local Apple Foundation Models
classifier via the `perspective --fm --system <few-shot>` CLI, called
**once per turn** from the `Stop` hook (~400 ms). Output is one of two
tokens, written to the state file. The renderer never invokes the
classifier.

**Three non-obvious gotchas** that all silently produce
wrong-but-plausible behaviour:

1. **Hooks may run with a stripped PATH.** Always
   `export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"`
   at the top of every hook script, or `jq`, `perspective`, and
   any other Homebrew binary is silently missing. SessionStart
   appears to "work" because its merge expression only invokes one
   binary; the heavier Stop hook fails opaquely.
2. **Status line refresh is event-driven by default.** When a hook
   writes state *after* the last assistant token streams, the renderer
   isn't re-invoked, and the corner stays frozen on the previous state
   until the user types. In Claude Code the fix is `refreshInterval: 1`
   on the `statusLine` config. Other CLIs need their own polling cadence
   or will exhibit the same lag.
3. **Markdown noise breaks small classifier models.** Bold, backticks,
   `[links](...)`, bullet markers, and unicode arrows (`→`, `–`, `—`)
   change a 3 B-parameter model's verdict on identical content. Strip
   these before classification — `sed -E 's/\*\*([^*]+)\*\*/\1/g'`
   plus equivalents — then the same text classifies the same way.

**Classifier fingerprint** — what actually worked for binary
question-vs-no-question on Apple FM:

- `--system` containing both an explicit rule ("any question anywhere
  → ResponseNeeded; trailing pleasantries don't cancel an earlier
  question") and 12 few-shot pairs covering: simple question,
  multi-question with trailing compliment, soft-ask ("Want me to
  ..."), hint-to-act ("Let me know if ..."), and the negative cases
  (status report, completion summary, bullet lists with no question).
- `--prompt "Input: \"$TRIMMED\"\nOutput:"` — explicit `Input:` /
  `Output:` cues to anchor the few-shot pattern.
- Cap input at 2000 chars (`tail -c 2000`) — small models lose focus
  on long inputs, and the question is almost always at the tail.
- **Pass `--temperature 0.0`.** A binary classifier has two valid
  output tokens. At default sampling temperature, edge-case text
  (relative clauses with question words like "what to do next",
  "which is faster") flips verdict roughly 1 run in 5. `t=0.0`
  forces argmax → same input, same output every time. Stable wrong
  is more useful than flickering right/wrong.

Reference implementation lives at `~/.claude/hooks/ant-status/` and
`~/.claude/statusline-command.sh`; the tuned classifier system prompt
is in `classify.sh`. To recreate in another CLI, the work is mostly
mapping the host's lifecycle events onto the state-machine table
above and confirming the renderer-refresh story.

**Lesson**: state belongs in a file written by event hooks; classifiers
run once per turn, not per render; renderer must be timer-polled
unless the host CLI emits an event for every state-relevant hook
completion.

---

## Part 2 — ANT-specific decisions not to re-litigate

These are direct ports from `docs/POST MERGE 110426.md` §§D–E. If
you're tempted to revisit one, read the original section first; the
token math hasn't changed.

### 2.1 Don't add an MCP server (E.1)

The mempalace + CLI substrate replaces MCP for multi-agent
coordination at ~0 kB per turn vs MCP's ~10 kB-per-turn-per-tool.
Every consideration of "what if we add MCP for X" should start with
the token math.

### 2.2 Don't build a CAMEL/agentscope-style framework wrapper (Part D)

> "Every abstraction those frameworks provide is already a shell
> command in ANT."

If the abstraction can be a shell command, it should be.

### 2.3 Don't pre-emptively add retention (Part D)

`heartbeat/*` is overwritten after 1 hour, `digest/*` pruned after 30
days, `thinking/*` after 7. Beyond that, wait for actual data shape
before designing retention. Premature retention is a guess; observed
retention is policy.

### 2.4 Don't replace xterm.js scrollback with a DB-backed viewport (Part D, E.6)

> "xterm.js is a renderer, SQLite is a store. Making the DB the source
> of truth for history (Path A, shipped) solves the 'agents can't read
> terminal history' problem. Making the DB the source of truth for the
> live viewport (Path B Phase 2, not shipped) is a bigger rewrite with
> real keystroke latency risks and no clear payoff today."

Two stores, two responsibilities. Don't merge them.

### 2.5 Don't commit `CLAUDE.md` (Part D)

`CLAUDE.md` is gitignored — it's host-specific. Edit
`docs/multi-agent-protocol.md` instead and let personal `CLAUDE.md`s
`@`-import it. This protects per-host customisation and keeps the
canonical protocol in one place.

### 2.6 Don't replace the wake ritual with a startup hook (E.5 corollary)

The six-command wake ritual is paid once per session (~1–2k tokens).
Wrapping it in a startup hook that auto-injects on every turn would
add per-turn cost — exactly what we're avoiding.

### 2.7 Don't flip the `%output` parser flag halfway (E.7)

The tmux control mode parser recognises `%output` lines but doesn't
persist them. Switching to `%output` as the only byte source is Path
B Phase 2 — a deliberate full migration with a feature flag and live
verification, not a quiet refactor.

---

## Part 3 — Regressions the commit log taught us

Sha-cited gotchas. Each one cost real time when discovered; documenting
them stops the next contributor from re-discovering them.

### 3.1 Svelte 5 `onclick` silently fails on real mouse clicks under SSR (`5b697ce`, `e7dc608`, `c4640df`)

> "Svelte 5 event delegation has a hydration bug where onclick
> handlers on buttons silently fail on real mouse clicks. This
> affected Share, tmux dropdown, grid picker, Send, and other buttons
> across every component."
> — commit `5b697ce`

The fix went through three iterations:

1. `e7dc608` — added native `addEventListener` via `bind:this` +
   `$effect` to every button (belt-and-braces).
2. `5b697ce` — disabled SSR globally in `+layout.ts`. The app uses
   browser-only APIs (WebSocket, localStorage, clipboard) so SSR
   provided no benefit.
3. `c4640df` — removed the `bind:this`/`$effect` workaround entirely
   because **`$state` mutations inside native listeners don't trigger
   Svelte's reactivity**. Plain `onclick` works correctly once SSR
   is off.

**Lesson**: when a UI framework's event system "silently fails", check
the SSR/hydration interaction before piling on workarounds. The
workaround in `e7dc608` made the symptom go away but introduced a
worse bug (broken reactivity) that took another commit to undo.

### 3.2 Sweep commits silently drop files (`571d843` → regression from `1f046d4`)

> "QuickLaunchBar.svelte and quicklaunch.svelte.ts were added in
> 2de1c56 but silently dropped when 1f046d4 replaced
> ChatMessages.svelte without the import."
> — commit `571d843`

A "sweep" commit (`1f046d4 sweep: fix PageSession type errors across
components`) replaced a component file without preserving an import,
silently deleting two source files from the working tree.

**Lesson**: review sweep / refactor commits with `git diff --stat` and
diff every replaced file; don't trust "sweep" labels. The TS-002
sprint also left type errors and an a11y warning that needed
follow-up (`aff1b84`).

### 3.3 Claude Code PTY needs double-return to submit (`8047f40`)

> "Claude Code's multi-line input mode treats a single \r as a
> continuation line (quote> prompt). Add a second \r after a beat to
> actually submit the prompt."
> — commit `8047f40`

CLI quirks vary. The fix is keyed off `cli_flag='claude-code'` so
other CLIs are unaffected — driver-aware, not global.

**Lesson**: PTY injection tax is real but bounded. Each agent gets
its own ~80 LOC driver instead of a framework that tries to be
generic.

### 3.4 Double terminal_input — fan-out was already forwarding (`2644ed6`)

> "postToLinkedChat was sending the command both via direct WS
> terminal_input AND via the messages API fan-out (auto_forward_chat).
> This caused commands to execute twice and produced garbage
> keystrokes ('cq')."
> — commit `2644ed6`

Two paths to the same effect → double-execute. Easy to introduce
when adding "just in case" fallbacks.

**Lesson**: when adding a delivery path, audit existing paths first.
Garbage like "cq" is the symptom of overlapping pipes.

### 3.5 Standalone chat rooms shouldn't auto-add terminals (`d163a3a`)

> "Standalone chat rooms were auto-adding every active terminal
> session as a participant on the first message. Room membership
> should be explicit — sessions must be manually invited/added."
> — commit `d163a3a`

**Lesson**: implicit membership feels convenient and is almost
always wrong. Multi-agent rooms need explicit invites; "everyone's
in" is a privacy bug waiting to happen.

### 3.6 Browser `prompt()` / `confirm()` are invisible to automation (`d3b6e01`)

> "Native prompt(), alert(), and confirm() dialogs are invisible to
> browser automation tools (Chrome extensions, MCP, DevTools
> protocol). Replaced all three in SessionList.svelte with inline
> DOM-rendered modals."
> — commit `d3b6e01`

**Lesson**: if your app might be driven by an agent (Chrome
extension, MCP browser tool, Playwright), avoid native browser
dialogs entirely. They block the page synchronously and can't be
inspected or auto-dismissed.

### 3.7 Fresh clones need `svelte-kit sync` before `vitest` (`628cb5f`, `1ae9bac`)

> "tsconfig.json extends .svelte-kit/tsconfig.json which only exists
> after sync. Fresh clones (and CI) need this step before vitest can
> resolve TypeScript."
> — commit `628cb5f`

Plus `vitest` itself was missing from `package.json` after a revert
cycle (`1ae9bac`).

**Lesson**: test the fresh-clone flow on CI, not just on the
maintainer's machine. Revert cycles drop devDeps; CI catches it.

### 3.8 Integration tests broadcast to live participants (`5602164` security scrub)

> "Integration test defaults to localhost, skips in CI without
> ANT_TEST_URL"
> — commit `5602164`

Earlier integration tests created sessions against the dev server,
which broadcast to anyone connected. Gating with an env var fixes it.

**Lesson**: tests that touch a live multi-agent system need an env-
var kill switch. Default-on is a leak; default-off-with-opt-in is
safe.

### 3.9 Rebuild after every source edit (server runs from `build/`)

> "When the server runs from build output (`npm run build`), source
> edits make the build stale. Every agent that modifies source files
> must run `npx vite build`. Failure to rebuild causes 500 errors
> from stale chunks."
> — `docs/multi-agent-session-guide.md` §7

**Lesson**: when multiple agents share a build output, "did you
rebuild" needs to be a posted convention, not an assumption. Mystery
500s in this repo were almost always stale chunks.

### 3.10 Native module ABI must match the launchd Node

The server can appear to start and still die before it is actually
usable if a native dependency was rebuilt under a different Node than
the launchd service uses. In May 2026, the server logged its normal
"ANT v3 running at 6458" line, then immediately crashed in `db.ts`
while loading `better_sqlite3.node`. The process looked alive briefly,
but nothing was listening on the port.

The root cause was a native ABI mismatch: `better-sqlite3` had been
rebuilt against Node 22 (`NODE_MODULE_VERSION` 141), while the launchd
plist ran Node 20.19.4 (`NODE_MODULE_VERSION` 115). A worktree install
had poisoned the shared native module for the daemon runtime.

**Diagnosis checklist**:

1. Check the server logs for a native addon load failure after the
   normal startup banner.
2. Compare the launchd Node path with the shell Node path.
3. Compare `process.versions.modules` for the runtime that built the
   addon and the runtime that launches ANT.
4. Confirm the port with `lsof -iTCP:6458` instead of trusting the
   startup log line.

**Fix pattern**: rebuild the native dependency with the same Node
binary launchd uses, then restart the service. For the observed
failure, that meant explicitly using
`$HOME/.nvm/versions/node/v20.19.4/bin/node` for the rebuild
and then running `launchctl kickstart -k gui/UID/com.ant.server`.

**Lesson**: launchd runtime, shell runtime, and worktree install
runtime are separate boundaries. Any dependency with a `.node` binary
must be rebuilt under the daemon's Node version, not whichever Node an
agent happened to use in a worktree.

---

## Part 4 — Changelog

Append new dated entries here as substrate-level lessons accumulate.

- **2026-04-22** (this doc): initial extraction. Distils
  `docs/POST MERGE 110426.md`, `docs/multi-agent-protocol.md`,
  `docs/mempalace-schema.md`, `docs/multi-agent-session-guide.md`,
  `FINGERPRINTING.md`, and 58 commits (2026-04-15 through
  2026-04-22) into one retrospective. Source for Part 3 is the
  `git log` on this repo's visible branches.
- **2026-05-03**: added the boundary-hop diagnosis pattern after the
  M1 WS-send investigation. The useful reusable practice was not only
  the two-part fix, but the method: reproduce the user path, then
  independently test config -> protocol -> auth -> server log -> PTY
  write -> persisted evidence before accepting a root cause.
- **2026-05-03**: recorded the launchd/native-module ABI pattern after
  the `better-sqlite3` crash. Worktree installs can rebuild `.node`
  dependencies under a different Node version than the daemon uses; the
  fix is to rebuild with the launchd Node binary and restart the
  service.
