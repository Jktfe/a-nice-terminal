#!/bin/bash
# Codex CLI — ANT status hook template (skeleton).
#
# Codex hooks read the same JSON-on-stdin convention as Claude Code:
#   { "session_id": "...", "tool_name": "...", "cwd": "...", ... }
# (Confirm shape via `codex --print-hook-payload` or upstream docs for
# the version installed.)
#
# This template defines the function bodies; the bootstrap prompt
# expands them into separate executables in ~/.codex/hooks/ant-status/.

set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

write_state() {
  local session_id="$1"
  local merge_expr="$2"
  [ -z "$session_id" ] && return
  local now_iso
  now_iso=$(date -u "+%Y-%m-%dT%H:%M:%SZ")
  for state_dir in "$HOME/.ant/state/codex-cli" "$HOME/.codex/state"; do
    mkdir -p "$state_dir"
    local file="$state_dir/$session_id.json"
    [ ! -s "$file" ] || ! jq -e . "$file" >/dev/null 2>&1 && echo '{}' > "$file"
    local tmp; tmp=$(mktemp "$file.XXXX")
    if jq --arg now "$now_iso" "$merge_expr" "$file" > "$tmp" 2>/dev/null; then
      mv "$tmp" "$file"
    else
      rm -f "$tmp"
    fi
  done
}

# session_start
on_session_start() {
  local input; input=$(cat)
  local sid; sid=$(echo "$input" | jq -r '.session_id // empty')
  local cwd; cwd=$(echo "$input" | jq -r '.cwd // empty')
  write_state "$sid" \
    ". + {state:\"Available\", session_start:\$now, cwd:\"$cwd\"}"
}

# prompt_submit
on_prompt_submit() {
  local input; input=$(cat)
  local sid; sid=$(echo "$input" | jq -r '.session_id // empty')
  write_state "$sid" '. + {state:"Working", last_user_ts:$now}'
}

# pre_tool — Codex doesn't have an AskUserQuestion-equivalent so no
# Menu transition here; just bump last_edit_ts.
on_pre_tool() {
  local input; input=$(cat)
  local sid; sid=$(echo "$input" | jq -r '.session_id // empty')
  write_state "$sid" '. + {last_edit_ts:$now}'
}

# turn_end — call classifier on the assistant text
on_turn_end() {
  local input; input=$(cat)
  local sid; sid=$(echo "$input" | jq -r '.session_id // empty')
  # Codex's turn_end payload typically includes recent assistant text in
  # `.assistant_text` or via .transcript_path. Adapt to whichever your
  # version emits, then pipe into the bundled classify.sh:
  local text
  text=$(echo "$input" | jq -r '.assistant_text // empty')
  local verdict="Waiting"
  if [ -n "$text" ]; then
    verdict=$(printf '%s' "$text" | "$HOME/.codex/hooks/ant-status/classify.sh")
  fi
  case "$verdict" in
    ResponseNeeded) write_state "$sid" '. + {state:"Response needed", last_resp_ts:$now}' ;;
    *)              write_state "$sid" '. + {state:"Waiting", last_resp_ts:$now}' ;;
  esac
}

# idle — only fires when Codex marks the session idle for N seconds.
# Treat as Response needed unless current state is already Waiting.
on_idle() {
  local input; input=$(cat)
  local sid; sid=$(echo "$input" | jq -r '.session_id // empty')
  local file="$HOME/.ant/state/codex-cli/$sid.json"
  [ ! -f "$file" ] && file="$HOME/.codex/state/$sid.json"
  local current; current=$(jq -r '.state // empty' "$file" 2>/dev/null)
  case "$current" in
    Working|Available|"") write_state "$sid" '. + {state:"Response needed"}' ;;
  esac
}
