# Claude Code — hook notes

## Available events

Claude Code's hook surface (as of v2.x) per `code.claude.com/docs/en/hooks`:

| Event              | When it fires                                          | Payload (key fields)                                   |
|--------------------|--------------------------------------------------------|--------------------------------------------------------|
| `SessionStart`     | Session opens (`startup` or `resume`)                  | `session_id`, `cwd`, `workspace.project_dir`           |
| `UserPromptSubmit` | User hits enter on a message                           | `session_id`, `prompt`                                 |
| `PreToolUse`       | Before a tool invocation                               | `session_id`, `tool_name`, `tool_input`                |
| `PostToolUse`      | After a tool returns                                   | `session_id`, `tool_name`, `tool_response`             |
| `Stop`             | Assistant turn ends                                    | `session_id`, `transcript_path`, `stop_hook_active`    |
| `Notification`     | Idle / permission / notification events               | `session_id`, `notification_type`, `message`           |
| `PermissionRequest`| Tool permission prompt fires                           | `session_id`, `tool_name`, `tool_input`                |
| `SubagentStart`    | A subagent (Task tool) launches                        | `session_id`, `agent_name`                             |
| `SubagentStop`     | Subagent ends                                          | `session_id`                                           |

## State mapping

Each event maps to a transition in the unified `state` enum (see
`../state-schema.json`):

| Hook event                                    | New state               |
|-----------------------------------------------|-------------------------|
| `SessionStart`                                | `Available`             |
| `UserPromptSubmit`                            | `Working`               |
| `PreToolUse` (AskUserQuestion / ExitPlanMode) | `Menu` + `menu_kind`    |
| `PreToolUse` (other tools)                    | (no change; bump edit_ts) |
| `PostToolUse` (AskUserQuestion / ExitPlanMode)| `Working` + clear menu  |
| `Stop`                                        | `Menu` (if unanswered AUQ/EPM tool_use exists), else classifier verdict (`Response needed` or `Waiting`) |
| `Notification` (idle_prompt)                  | `Response needed` (only if currently Working/Available) |
| `Notification` (permission)                   | `Permission`            |
| `PermissionRequest`                           | `Permission`            |
| `SubagentStart` / `SubagentStop`              | (no change — main session state only; subagents have their own files) |

## Quirks discovered during initial implementation

1. **Spawning env is stripped.** Claude Code on macOS spawns hook scripts
   with a minimal PATH that doesn't include `/opt/homebrew/bin`. Every
   hook must `export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"`
   at the top or `jq` and `perspective` silently fail.

2. **Status-line refresh is event-driven.** The corner re-runs the
   `statusLine.command` only on new-message / compact / permission /
   vim-mode events (debounced 300 ms). When a hook writes state *after*
   the last assistant token streams (e.g. `Stop` writing `Waiting`), the
   corner stays frozen on the previous state until the user types again.
   Set `refreshInterval: 1` on the `statusLine` config to force a 1 s
   poll cadence and surface post-Stop changes immediately.

3. **Stop fires after `tool_result`, not during the menu.** When
   `AskUserQuestion` is invoked, `Stop` does NOT fire while the menu is
   open — it fires only after the user picks (the matching
   `tool_result` is already in the transcript by then). Result: a
   Stop-only Menu detector is unreliable. The fix is the dedicated
   `PreToolUse` matcher above — it flips state to `Menu` immediately
   when the tool starts, and `PostToolUse` clears it.

4. **Classifier non-determinism without `--temperature 0.0`.** Apple
   Foundation Models default sampling temperature is non-zero. On
   ambiguous text (relative clauses with "what to do next", "which is
   faster"), the binary classifier flips verdict ~1 in 5 runs. Always
   pass `--temperature 0.0` to force argmax.

5. **Markdown noise breaks the classifier.** `**bold**`, backticks,
   `[links](...)`, bullet markers, numbered lists, unicode arrows
   (`→`, `–`, `—`), and Markdown table rows (lines starting with `|`)
   all flip the verdict on otherwise-identical content. Sanitise before
   sending. See `classify.sh` for the canonical list.

## Reference paths on a fully set-up Claude Code

| Purpose                | Path                                                          |
|------------------------|---------------------------------------------------------------|
| Hook scripts           | `~/.claude/hooks/ant-status/*.sh`                             |
| Status-line renderer   | `~/.claude/statusline-command.sh`                             |
| Settings               | `~/.claude/settings.json`                                     |
| Unified state          | `~/.ant/state/claude-code/<session_id>.json`                  |
| Legacy state           | `~/.claude/state/<session_id>.json` (back-compat)             |
| Forensics log          | `~/.claude/state/ant-status.log`                              |
| Transcript JSONL       | `~/.claude/projects/<encoded-cwd>/<session_id>.jsonl`         |

## Verification commands

```bash
# Live state for current session
jq -r '.state, .last_resp_ts' ~/.ant/state/claude-code/*.json

# Recent hook fires
tail -20 ~/.claude/state/ant-status.log

# Rendered status line (preview)
echo '{"session_id":"<id>","cwd":"/path","model":{"display_name":"Opus 4.7"}}' \
  | bash ~/.claude/statusline-command.sh
```
