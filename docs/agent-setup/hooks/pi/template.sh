#!/bin/bash
# Pi — ANT state-file emitter template.
# Reads JSONL frames on stdin, writes state file. Runs as a tee filter
# alongside Pi (see bootstrap-prompt.md).

set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

write_state() {
  local session_id="$1"
  local merge_expr="$2"
  [ -z "$session_id" ] && return
  local now_iso; now_iso=$(date -u "+%Y-%m-%dT%H:%M:%SZ")
  for state_dir in "$HOME/.ant/state/pi" "$HOME/.pi/state"; do
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

SESSION_ID=""

while IFS= read -r line; do
  type=$(echo "$line" | jq -r '.type // empty' 2>/dev/null)
  case "$type" in
    session_init)
      SESSION_ID=$(echo "$line" | jq -r '.session_id // empty')
      cwd=$(echo "$line" | jq -r '.cwd // empty')
      write_state "$SESSION_ID" \
        ". + {state:\"Available\", session_start:\$now, cwd:\"$cwd\"}"
      ;;
    user_input)
      write_state "$SESSION_ID" '. + {state:"Working", last_user_ts:$now}'
      ;;
    tool_call)
      write_state "$SESSION_ID" '. + {last_edit_ts:$now}'
      ;;
    assistant_response_end)
      text=$(echo "$line" | jq -r '.text // .content // empty')
      verdict="Waiting"
      if [ -n "$text" ]; then
        verdict=$(printf '%s' "$text" | "$HOME/.pi/hooks/ant-status/classify.sh")
      fi
      case "$verdict" in
        ResponseNeeded) write_state "$SESSION_ID" '. + {state:"Response needed", last_resp_ts:$now}' ;;
        *)              write_state "$SESSION_ID" '. + {state:"Waiting", last_resp_ts:$now}' ;;
      esac
      ;;
    user_input_required)
      write_state "$SESSION_ID" '. + {state:"Response needed"}'
      ;;
    permission_request)
      write_state "$SESSION_ID" '. + {state:"Permission"}'
      ;;
    multi_choice_prompt)
      write_state "$SESSION_ID" '. + {state:"Menu", menu_kind:null}'
      ;;
  esac
done
