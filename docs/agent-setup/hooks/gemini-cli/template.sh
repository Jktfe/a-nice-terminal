#!/bin/bash
# Gemini CLI — ANT status hook template.
# Mirrors the Claude Code template; payload field names differ per Gemini's
# stdin convention. Verify with a test invocation; current upstream uses
# {sessionId, userMessage, toolName, ...}.

set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

write_state() {
  local session_id="$1"
  local merge_expr="$2"
  [ -z "$session_id" ] && return
  local now_iso; now_iso=$(date -u "+%Y-%m-%dT%H:%M:%SZ")
  for state_dir in "$HOME/.ant/state/gemini-cli" "$HOME/.gemini/state"; do
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

read_sid() { jq -r '.sessionId // .session_id // empty'; }

# onStart
on_start() {
  local input; input=$(cat)
  local sid; sid=$(echo "$input" | read_sid)
  local cwd; cwd=$(echo "$input" | jq -r '.cwd // empty')
  write_state "$sid" \
    ". + {state:\"Available\", session_start:\$now, cwd:\"$cwd\"}"
}

# onUserMessage
on_user_message() {
  local input; input=$(cat)
  local sid; sid=$(echo "$input" | read_sid)
  write_state "$sid" '. + {state:"Working", last_user_ts:$now}'
}

# onToolStart — no Menu equivalent in Gemini
on_tool_start() {
  local input; input=$(cat)
  local sid; sid=$(echo "$input" | read_sid)
  write_state "$sid" '. + {last_edit_ts:$now}'
}

# onTurnEnd
on_turn_end() {
  local input; input=$(cat)
  local sid; sid=$(echo "$input" | read_sid)
  local text; text=$(echo "$input" | jq -r '.assistantText // .response // empty')
  local verdict="Waiting"
  if [ -n "$text" ]; then
    verdict=$(printf '%s' "$text" | "$HOME/.gemini/hooks/ant-status/classify.sh")
  fi
  case "$verdict" in
    ResponseNeeded) write_state "$sid" '. + {state:"Response needed", last_resp_ts:$now}' ;;
    *)              write_state "$sid" '. + {state:"Waiting", last_resp_ts:$now}' ;;
  esac
}

# onIdle
on_idle() {
  local input; input=$(cat)
  local sid; sid=$(echo "$input" | read_sid)
  local file="$HOME/.ant/state/gemini-cli/$sid.json"
  [ ! -f "$file" ] && file="$HOME/.gemini/state/$sid.json"
  local current; current=$(jq -r '.state // empty' "$file" 2>/dev/null)
  case "$current" in
    Working|Available|"") write_state "$sid" '. + {state:"Response needed"}' ;;
  esac
}

# onApprovalNeeded
on_approval_needed() {
  local input; input=$(cat)
  local sid; sid=$(echo "$input" | read_sid)
  write_state "$sid" '. + {state:"Permission"}'
}
