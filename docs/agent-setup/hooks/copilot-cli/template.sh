#!/bin/bash
# Copilot CLI — ANT status wrapper template.
# Stdin/stdout intercept since Copilot CLI doesn't expose lifecycle hooks.

set -u
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

write_state() {
  local session_id="$1"
  local merge_expr="$2"
  [ -z "$session_id" ] && return
  local now_iso; now_iso=$(date -u "+%Y-%m-%dT%H:%M:%SZ")
  for state_dir in "$HOME/.ant/state/copilot-cli" "$HOME/.copilot/state"; do
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

# Generate UUID v4 for session_id (no external deps)
gen_uuid() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  else
    local hex; hex=$(od -x /dev/urandom | head -1 | awk '{OFS="-"; print $2$3,$4,$5,$6,$7$8$9}')
    echo "$hex"
  fi
}

SESSION_ID=$(gen_uuid)
export ANT_COPILOT_SESSION_ID="$SESSION_ID"

CWD=$(pwd)
write_state "$SESSION_ID" \
  ". + {state:\"Available\", session_start:\$now, cwd:\"$CWD\"}"

# Spawn Copilot, intercept stdin/stdout. This is a starting point —
# real implementation needs:
#   - A line-buffered tee on stdin to detect newline submission
#   - A line-buffered tee on stdout to detect the trailing prompt
#   - Periodic classifier invocation on the assistant tail
copilot "$@"

# On exit, leave whatever final state the wrapper wrote.
