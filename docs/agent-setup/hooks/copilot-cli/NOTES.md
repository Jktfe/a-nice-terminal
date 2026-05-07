# GitHub Copilot CLI — hook notes

## Status

**Shell-wrapper integration.** Copilot CLI doesn't expose lifecycle
hooks the way Claude / Gemini / Qwen / Codex do. The integration
pattern is a wrapper shell script that records lifecycle from the
outside (stdin/stdout intercept + tmux pane probe).

## Wrapper approach

Front the `copilot` invocation with `copilot-state-wrapper.sh`. The
wrapper:

1. Generates a `session_id` (UUID v4) and exports it.
2. Writes `state: Available` + `session_start` immediately.
3. Pipes stdin through to copilot, watching for empty newlines that
   signal user prompt submission → writes `state: Working` +
   `last_user_ts`.
4. Pipes stdout through, watching for the trailing prompt marker
   → writes `state: Waiting` (or invokes classifier on the last
   assistant block to decide `Response needed`/`Waiting`).
5. On exit, leaves the final state.

## Event mapping

Inferred from stdout content (not first-class events):

| Signal                           | State                |
|----------------------------------|----------------------|
| Wrapper start                    | `Available`          |
| User input newline               | `Working`            |
| Trailing prompt marker           | classifier verdict   |
| Process exit                     | (final state holds)  |

`Menu` and `Permission` states are out of scope for Copilot today —
its TUI permission flows aren't standardised across versions and
inferring them from stdout is fragile.

## State-file location

Preferred: `$HOME/.ant/state/copilot-cli/<session_id>.json`
Legacy:    `$HOME/.copilot/state/<session_id>.json`

## Quirks

1. **Wrapper-only.** Don't try to install hooks into Copilot itself —
   even if you find a hook surface in a build, it's not stable.

2. **Classifier is the workhorse.** Without lifecycle hooks, the
   `Response needed` vs `Waiting` decision is driven entirely by the
   classifier reading the assistant tail. Sanitisation matters.

3. **MCP integration via ant-channel** — separate from this hook
   work. ANT can also speak to Copilot via the MCP bridge for
   structured tool calls; the hook system here is just for status
   visibility.
