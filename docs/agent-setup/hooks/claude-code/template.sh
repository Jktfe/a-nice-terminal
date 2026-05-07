#!/bin/bash
# ANT — Claude Code hook templates (canonical reference).
#
# This file documents the seven hook scripts that together populate the
# unified state file at $HOME/.ant/state/claude-code/<session_id>.json.
# Each hook below is its own script in the user's hook directory. Wire
# them into ~/.claude/settings.json under .hooks.<event>.
#
# State-file location: $HOME/.ant/state/claude-code/<session_id>.json
# Legacy location (back-compat): $HOME/.claude/state/<session_id>.json
# Both should be written; ANT reads either.
#
# Schema: ../state-schema.json
#
# Three universal gotchas for all of these (see docs/LESSONS.md § 1.12):
#   1. Always export PATH including /opt/homebrew/bin so jq + perspective
#      are findable when Claude Code spawns the hook with minimal env.
#   2. Set refreshInterval: 1 on the statusLine config or the corner won't
#      update until the next keystroke.
#   3. Sanitise markdown before sending text to the perspective classifier
#      (bold/code/links/bullets/tables) — small models flip on noise.

# ───────────────────────────────────────────────────────────────────────
# write-state.sh — atomic merge-write of session state
# ───────────────────────────────────────────────────────────────────────
#
# Usage: write-state.sh <session_id> <jq-merge-expr>
# Two output paths to keep both unified and legacy locations in sync.

write_state() {
  local session_id="$1"
  local merge_expr="$2"
  [ -z "$session_id" ] && return

  local now_iso
  now_iso=$(date -u "+%Y-%m-%dT%H:%M:%SZ")

  for state_dir in "$HOME/.ant/state/claude-code" "$HOME/.claude/state"; do
    mkdir -p "$state_dir"
    local file="$state_dir/$session_id.json"
    if [ ! -s "$file" ] || ! jq -e . "$file" >/dev/null 2>&1; then
      echo '{}' > "$file"
    fi
    local tmp
    tmp=$(mktemp "$file.XXXX")
    if jq --arg now "$now_iso" "$merge_expr" "$file" > "$tmp" 2>/dev/null; then
      mv "$tmp" "$file"
    else
      rm -f "$tmp"
    fi
  done
}

# ───────────────────────────────────────────────────────────────────────
# on-session-start.sh — SessionStart hook
# ───────────────────────────────────────────────────────────────────────
#
# Wire as: hooks.SessionStart[].matcher = "startup|resume"

on_session_start() {
  local input
  input=$(cat)
  local sid
  sid=$(echo "$input" | jq -r '.session_id // empty')
  local cwd
  cwd=$(echo "$input" | jq -r '.cwd // empty')
  local project_dir
  project_dir=$(echo "$input" | jq -r '.workspace.project_dir // empty')
  write_state "$sid" \
    ". + {state:\"Available\", session_start:\$now, cwd:\"$cwd\", project_dir:\"$project_dir\"}"
}

# ───────────────────────────────────────────────────────────────────────
# on-prompt-submit.sh — UserPromptSubmit hook
# ───────────────────────────────────────────────────────────────────────

on_prompt_submit() {
  local input
  input=$(cat)
  local sid
  sid=$(echo "$input" | jq -r '.session_id // empty')
  write_state "$sid" '. + {state:"Working", last_user_ts:$now}'
}

# ───────────────────────────────────────────────────────────────────────
# on-pre-tool-use.sh — PreToolUse hook
# ───────────────────────────────────────────────────────────────────────
#
# AskUserQuestion / ExitPlanMode flip state to Menu; everything else just
# bumps last_edit_ts.

on_pre_tool_use() {
  local input
  input=$(cat)
  local sid
  sid=$(echo "$input" | jq -r '.session_id // empty')
  local tool_name
  tool_name=$(echo "$input" | jq -r '.tool_name // empty')

  case "$tool_name" in
    AskUserQuestion|ExitPlanMode)
      write_state "$sid" \
        ". + {state:\"Menu\", menu_kind:\"$tool_name\", last_edit_ts:\$now}"
      ;;
    *)
      write_state "$sid" '. + {last_edit_ts:$now}'
      ;;
  esac
}

# ───────────────────────────────────────────────────────────────────────
# on-post-tool-use.sh — PostToolUse hook
# ───────────────────────────────────────────────────────────────────────
#
# Clears Menu back to Working when the structured menu tool returns.

on_post_tool_use() {
  local input
  input=$(cat)
  local sid
  sid=$(echo "$input" | jq -r '.session_id // empty')
  local tool_name
  tool_name=$(echo "$input" | jq -r '.tool_name // empty')

  case "$tool_name" in
    AskUserQuestion|ExitPlanMode)
      write_state "$sid" \
        '. + {state:"Working", menu_kind:null, last_edit_ts:$now}'
      ;;
  esac
}

# ───────────────────────────────────────────────────────────────────────
# on-stop.sh — Stop hook
# ───────────────────────────────────────────────────────────────────────
#
# Decides Menu / Response needed / Waiting based on transcript content.
# Calls classify.sh on the last 2 paragraphs (filtered to skip ★ Insight
# boxes, code fences, table rows). See ~/.claude/hooks/ant-status/on-stop.sh
# for the canonical implementation; behaviour mirrored here.

# ───────────────────────────────────────────────────────────────────────
# on-notification.sh — Notification hook
# ───────────────────────────────────────────────────────────────────────
#
# notification_type=idle_prompt → Response needed (only if not Waiting)
# notification_type=permission   → Permission

on_notification() {
  local input
  input=$(cat)
  local sid
  sid=$(echo "$input" | jq -r '.session_id // empty')
  local nt
  nt=$(echo "$input" | jq -r '.notification_type // empty')

  local file="$HOME/.ant/state/claude-code/$sid.json"
  [ ! -f "$file" ] && file="$HOME/.claude/state/$sid.json"
  local current
  current=$(jq -r '.state // empty' "$file" 2>/dev/null)

  case "$nt" in
    idle_prompt)
      case "$current" in
        Working|Available|"") write_state "$sid" '. + {state:"Response needed"}' ;;
      esac
      ;;
    permission|permission_request)
      write_state "$sid" '. + {state:"Permission"}'
      ;;
  esac
}

# ───────────────────────────────────────────────────────────────────────
# Bootstrap reminder
# ───────────────────────────────────────────────────────────────────────
#
# After installing these scripts in your hook directory, edit
# ~/.claude/settings.json and add:
#
#   "statusLine": {
#     "type": "command",
#     "command": "bash ~/.claude/statusline-command.sh",
#     "refreshInterval": 1
#   },
#   "hooks": {
#     "SessionStart":     [{ "matcher": "startup|resume", "hooks": [{"type":"command","command":"<dir>/on-session-start.sh","timeout":5}] }],
#     "UserPromptSubmit": [{ "matcher": ".*",             "hooks": [{"type":"command","command":"<dir>/on-prompt-submit.sh","timeout":5}] }],
#     "PreToolUse":       [{ "matcher": ".*",             "hooks": [{"type":"command","command":"<dir>/on-pre-tool-use.sh","timeout":5}] }],
#     "PostToolUse":      [{ "matcher": ".*",             "hooks": [{"type":"command","command":"<dir>/on-post-tool-use.sh","timeout":5}] }],
#     "Stop":             [{ "matcher": ".*",             "hooks": [{"type":"command","command":"<dir>/on-stop.sh","timeout":10}] }],
#     "Notification":     [{ "matcher": ".*",             "hooks": [{"type":"command","command":"<dir>/on-notification.sh","timeout":5}] }]
#   }
#
# refreshInterval: 1 is essential — without it the corner won't update
# until the next keystroke after a hook writes new state.
