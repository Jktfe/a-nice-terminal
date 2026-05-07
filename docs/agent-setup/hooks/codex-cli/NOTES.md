# Codex CLI — hook notes

## Status

**Draft** — verified hook surface matches Codex CLI ≥ v0.30. Earlier
versions used a different hook discovery path; check
`codex --version` before installing.

## Available events

OpenAI Codex CLI exposes hooks via TOML config at `~/.codex/config.toml`
under `[hooks]`. Lifecycle events (per upstream docs):

| Event              | When it fires                         | State mapping        |
|--------------------|---------------------------------------|----------------------|
| `session_start`    | Session opens                         | `Available`          |
| `prompt_submit`    | User input submitted                  | `Working`            |
| `pre_tool`         | Before tool execution                 | bump `last_edit_ts`  |
| `post_tool`        | After tool execution                  | (no change)          |
| `turn_end`         | Assistant turn complete               | classifier verdict   |
| `idle`             | No activity for N seconds             | `Response needed`*   |
| `confirm_request`  | Permission prompt (rare — full-auto)  | `Permission`         |

\* Codex full-auto mode (the default per ANT's setup) doesn't surface
permission prompts the way Claude Code does. `Permission` state will
rarely fire; `Response needed` from `turn_end` + classifier is the
primary "needs response" signal.

## State-file location

Preferred: `$HOME/.ant/state/codex-cli/<session_id>.json`
Legacy:    `$HOME/.codex/state/<session_id>.json`

## Quirks

1. Codex reuses the same `session_id` across `codex resume` invocations,
   so the state file persists across multiple human sessions. Reset
   `session_start` on each new `session_start` hook fire.

2. No `AskUserQuestion`-equivalent. Codex emits multi-choice options
   inline as numbered lists in the assistant text — they're caught by
   the classifier rather than a structured menu hook. `Menu` state is
   reserved; codex driver sets it directly when a `multi_choice`
   `NormalisedEvent` is detected from screen scrape.

3. Codex's TUI permission prompts (when running outside full-auto) are
   not consistently exposed via hooks across versions — fall back to
   `confirm_request` if available, otherwise rely on the driver's
   `permission_request` event-class detection from screen scrape.

## Verification

```bash
codex --print-config 2>&1 | grep -A 20 '\[hooks\]'
ls ~/.ant/state/codex-cli/
tail -20 ~/.codex/logs/hooks.log    # if logging enabled
```
