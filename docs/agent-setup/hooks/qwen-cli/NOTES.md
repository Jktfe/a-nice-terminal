# Qwen CLI — hook notes

## Status

**Forked from Gemini CLI** — Qwen Code CLI shares the
settings.json-based hook surface. Use the Gemini template as the
starting point and adapt event field names to Qwen's payload shape.

## Event mapping

Same canonical mapping as Gemini:

| Event              | State                |
|--------------------|----------------------|
| `onStart`          | `Available`          |
| `onUserMessage`    | `Working`            |
| `onToolStart`      | bump `last_edit_ts`  |
| `onTurnEnd`        | classifier verdict   |
| `onIdle`           | `Response needed`    |
| `onApprovalNeeded` | `Permission`         |

## State-file location

Preferred: `$HOME/.ant/state/qwen-cli/<session_id>.json`
Legacy:    `$HOME/.qwen/state/<session_id>.json`

## Quirks

1. **Ollama bridge** — when Qwen routes through Ollama, the assistant
   text appears in `.choices[0].message.content` rather than
   `.assistantText`. Check both fields in the `onTurnEnd` hook.

2. **YOLO mode** — Qwen's full-auto mode skips most permission
   prompts; classifier on `onTurnEnd` is the primary signal there.

3. **Settings.json shared with Gemini** — some Qwen builds reuse
   `~/.gemini/settings.json` rather than `~/.qwen/`. Check before
   installing — duplicating hooks across both files causes them to
   fire twice.

## Use the Gemini bootstrap prompt

`docs/agent-setup/hooks/gemini-cli/bootstrap-prompt.md` works for Qwen
unchanged except: substitute `gemini` → `qwen` everywhere in paths.
