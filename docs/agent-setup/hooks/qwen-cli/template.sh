#!/bin/bash
# Qwen CLI — ANT status hook template (forked from Gemini).
# See docs/agent-setup/hooks/gemini-cli/template.sh for the canonical
# implementation. Adjustments for Qwen:
#   - Paths use ~/.qwen/ and ~/.ant/state/qwen-cli/
#   - on_turn_end falls back to .choices[0].message.content for
#     Ollama-brokered routes.

set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

write_state() {
  local session_id="$1"
  local merge_expr="$2"
  [ -z "$session_id" ] && return
  local now_iso; now_iso=$(date -u "+%Y-%m-%dT%H:%M:%SZ")
  for state_dir in "$HOME/.ant/state/qwen-cli" "$HOME/.qwen/state"; do
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

# Qwen's turn-end with Ollama fallback for assistant text
on_turn_end() {
  local input; input=$(cat)
  local sid; sid=$(echo "$input" | jq -r '.sessionId // .session_id // empty')
  local text; text=$(echo "$input" | jq -r '.assistantText // .response // .choices[0].message.content // empty')
  local verdict="Waiting"
  if [ -n "$text" ]; then
    verdict=$(printf '%s' "$text" | "$HOME/.qwen/hooks/ant-status/classify.sh")
  fi
  case "$verdict" in
    ResponseNeeded) write_state "$sid" '. + {state:"Response needed", last_resp_ts:$now}' ;;
    *)              write_state "$sid" '. + {state:"Waiting", last_resp_ts:$now}' ;;
  esac
}

# Other event handlers — copy from gemini-cli/template.sh and adjust paths.
