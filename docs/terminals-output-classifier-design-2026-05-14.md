# Terminals output classifier (Layer B) — design contract

Date: 2026-05-14
Author: @researchant
Status: DESIGN-FIRST. T2c-impl claim-first AFTER canonical PASS.
Cap: ≤180L. Closes the ANT-view "interpreted stream" half of the
JWPK 3-view spec.

## TL;DR

Today (T2a): every PTY chunk is persisted as `kind='raw'` in
`terminal_run_events`. JWPK ANT view needs richer kinds — message,
thinking, tool_call — so the view can render kind-specific cards.
This is Layer B per ANTstorm + claude2 frontend audit + RQO32 scope-
correction (drivers Layer A = interactive-event detection only). T2c
adds a per-CLI output classifier that turns raw bytes into typed
NormalisedEvents.

## Q1 — Triggering

**Default proposal**: synchronous in the existing T2a boot subscriber.
On each ptyClient output chunk:
1. Look up the per-terminal CLI kind (already known via existing
   `agent_kind` field on terminals + agentStatusPoller).
2. Append chunk to per-terminal buffer.
3. Run the CLI's classifier on (buffer, lastEmittedTs).
4. Emit detected events via `appendTerminalRunEvent`. Drop emitted
   bytes from buffer; keep tail.
5. If buffer >N bytes (default 8KB) without classification, emit as
   kind='raw' to avoid unbounded growth.

**Rejected**: background worker / batch — adds latency for live ANT
view tail; pty-chunk frequency is already throttled by the daemon.

## Q2 — Per-CLI dispatch

**Default proposal**: classifier registry keyed by `agent_kind`. Each
CLI ships a single `classify(buffer, opts) → {events, remaining}`
function. Unknown agent_kind falls through to a generic plain-text
classifier (entire buffer = one kind='message' event when buffer ends
with newline).

CLI module shape (NEW src/lib/server/classifiers/<cli>.ts):
```ts
export function classify(buffer: string): { events: ClassifiedEvent[]; remaining: string };
```

T2c-impl-1 ships ONLY: `claude-code` classifier + generic fallback.
codex / gemini / aider / etc deferred to T2c-impl-2 (per-CLI scope).

## Q3 — Kind enum (delta-1: aligned to T2 frontend design)

Six kinds locked, matching the FRONT-3 ANT-view consumer:
- `'message'` — agent text addressed to user / room (chat surface).
- `'thinking'` — agent's reasoning/scratchpad output.
- `'tool_call'` — agent invoking a tool.
- `'command'` — shell command line (user or agent-issued, with cwd).
- `'agent_prompt'` — agent emitting a prompt-card payload (durable
  history-only; live interactive detection still belongs to Layer A T2b).
- `'raw'` — unclassified bytes (fallback, preserved for audit).

T2c-impl-1 ships only the SUBSET produced by generic + claude-code
classifiers (likely message + thinking + tool_call + raw). command +
agent_prompt rows land when their per-CLI parsers ship in T2c-impl-2/3.

## Q4 — Confidence + fallback

Classifier returns `events: ClassifiedEvent[]` for high-confidence
matches + `remaining: string` for unclassified tail. The boot
subscriber tracks per-terminal buffer; if `remaining` exceeds 8KB it
emits the entire buffer as kind='raw' + clears it (prevents unbounded
memory growth on chatty terminals).

`trust` field on the persisted run_event:
- `'high'` — classifier matched a structured marker (e.g. JSON event).
- `'medium'` — classifier matched a heuristic (e.g. plain-text-by-newline).
- `'raw'` — fallback / generic / unknown.

## Q5 — Persistence interaction

T2a writes `kind='raw'` for every chunk today. T2c REPLACES that with
classified writes:
- Boot subscriber renamed: `terminalRunEventsBoot` → still calls
  `appendTerminalRunEvent` but with classified `kind` + `text`
  per classifier output.
- Pure-raw rows STOP being written — kind='raw' only as classifier
  fallback per Q4.

OLD raw-only rows (created pre-T2c) remain readable; new classified
rows coexist. Frontend ANT view filters by kind set (all 6); CHAT
view filters to kind='message'; RAW view bypasses run_events entirely
(reads the existing /api/terminals/[id]/stream T1 byte stream).

## Touch points (T2c-impl-1 — partial-frame 1 of N)

T2c-impl-1 ships:
- NEW src/lib/server/classifiers/types.ts ≤40L: ClassifiedEvent type +
  `Classifier` function shape.
- NEW src/lib/server/classifiers/generic.ts ≤60L: plain-text-by-
  newline fallback. Whole buffer ending in `\n` becomes one
  kind='message' trust='medium'; remainder buffered.
- NEW src/lib/server/classifiers/claudeCode.ts ≤120L: claude-code-
  specific patterns (e.g. lines beginning with `[thinking]` → kind=
  thinking; lines beginning with `[tool]` → kind=tool_call; everything
  else → message).
- NEW src/lib/server/classifierRegistry.ts ≤60L: agent_kind →
  classifier dispatcher with per-terminal buffer Map.
- EDIT src/lib/server/terminalRunEventsBoot.ts: replace
  `appendTerminalRunEvent({kind:'raw'})` with classifier dispatch
  loop emitting per-event kinds.
- 6+ unit tests across types/generic/claudeCode/registry/boot.

T2c-impl-2 (DEFERRED): codex / gemini / aider / kimi / qwen / copilot
per-CLI classifiers (~80L each).
T2c-impl-3 (DEFERRED): structured-event detection (JSON markers per CLI).
T2b (still DEFERRED): driver-lift Layer A for interactive events.

## Locked acceptance (T2c-impl-1)

- Generic fallback classifier emits one kind='message' per `\n` line.
- claude-code classifier recognises [thinking] / [tool] prefix lines.
- Per-terminal buffer survives across chunks (keyed by sessionId).
- 8KB buffer overflow emits kind='raw' fallback.
- terminalRunEventsBoot dispatches via classifierRegistry.
- ANT view GET /run-events shows kinds=message/thinking/tool_call/raw mix.
- CHAT view GET /run-events?kinds=message returns message-only subset.
- svelte-check + tests green.
- Plan event `terminals-backend-t2c-impl-1-classifier` status=done.

## Do-not-use

| Rejected | Why |
|---|---|
| Classify all 14 CLIs in v1 | Scope-blow; partial-frame per-CLI in T2c-impl-2. |
| Inline classifier regex in boot file | Per-CLI dispatch gives clean lift path. |
| Drop kind='raw' fallback | Audit trail required (ANTstorm trust/sandbox). |
| Background worker | Adds live-tail latency. |
| Re-use Layer A drivers' detect() for output classification | RQO32 scope-correction: drivers detect interactive events only. |

## Locked assumptions (delta-1: per coordinator no-JWPK-questionnaire)

1. claude-code v1 markers: prefix-line heuristic (`[thinking] ...`,
   `[tool] ...`). Structured-event JSON parsing is T2c-impl-3 scope.
2. Per-terminal buffer overflow threshold: 8KB; tunable per agent_kind
   in v2 if needed.
3. trust='medium' for heuristic-matched plain-text events; trust='high'
   reserved for structured-marker matches.

## What I did NOT verify

- claude-code's actual line-prefix vocab (assumed [thinking]/[tool] heuristic; real markers may differ — adjust at impl time).
- Per-CLI streaming chunk boundary semantics (some CLIs emit partial lines without newlines — handled by buffer + 8KB overflow).
- Performance under high-output sessions (vim-heavy).

## Next step

T2c-impl-1 claim-first under THIS doc Locked Acceptance immediately
on canonical PASS — defaults are ship-defaults per coordinator no-
questionnaire-churn discipline. T2c-impl-2/-3 + T2b sequenced after.
