# Gemini CLI — hook notes

## Status

**Reference for the hooks-via-settings.json model.** Gemini CLI ships
hooks both in `~/.gemini/settings.json` and as web hooks (POST to a URL
on lifecycle events). Either path works; settings.json is simpler.

## Available events (settings.json hooks)

Per upstream `~/.gemini/docs/hooks.md` (verify on the installed
version):

| Event              | When it fires                  | State mapping        |
|--------------------|--------------------------------|----------------------|
| `onStart`          | Session begins                 | `Available`          |
| `onUserMessage`    | User submits prompt            | `Working`            |
| `onToolStart`      | Before tool execution          | bump `last_edit_ts`  |
| `onToolEnd`        | After tool execution           | (no change)          |
| `onTurnEnd`        | Assistant turn complete        | classifier verdict   |
| `onIdle`           | No activity for N seconds      | `Response needed`*   |
| `onApprovalNeeded` | Tool approval prompt           | `Permission`         |

\* Gemini's auto-approval mode (default in ANT setup) means
`onApprovalNeeded` rarely fires; classifier on `onTurnEnd` is the
primary signal.

## State-file location

Preferred: `$HOME/.ant/state/gemini-cli/<session_id>.json`
Legacy:    `$HOME/.gemini/state/<session_id>.json`

## Web hooks (alternative)

Gemini also supports POSTing JSON to a URL on each event. If you'd
rather not write shell scripts, point the web hook at an ANT endpoint
that translates POST → state-file write. Recommended for hosts where
ANT runs alongside Gemini and can listen on localhost.

## Quirks

1. **Driver already has `setHooksActive()`.** When hooks are detected,
   `gemini-cli/driver.ts` already skips its progress-detection
   heuristics so the state file becomes authoritative. No driver change
   needed for this CLI.

2. **No structured menu equivalent.** Gemini's confirmation dialogs are
   inline text; classifier handles them.

3. **Settings.json hot-reload.** Gemini reloads settings on every new
   session, so installing hooks doesn't require a restart of running
   sessions — only new ones pick them up.
