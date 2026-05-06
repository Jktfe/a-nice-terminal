#!/bin/bash
# ANT Hook — forwards Claude Code events to the ANT server
#
# Receives JSON on stdin from Claude Code hooks system.
# Adds ant_session_id and POSTs to the ANT hooks API.
#
# Environment:
#   ANT_SERVER     — ANT server URL (default: https://localhost:6458)
#   ANT_SESSION_ID — ANT terminal session ID (preferred, set by session startup)
#   ANT_SESSION    — Legacy fallback alias for ANT_SESSION_ID

INPUT=$(cat)
ANT_SERVER="${ANT_SERVER:-https://localhost:6458}"
SESSION_ID="${ANT_SESSION_ID:-${ANT_SESSION:-unknown}}"

# Inject the ANT session ID so the server knows which session this came from
PAYLOAD=$(echo "$INPUT" | jq -c ". + {\"ant_session_id\": \"${SESSION_ID}\"}")

# Fire and forget — don't block Claude Code
curl -sk -X POST "${ANT_SERVER}/api/hooks" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  > /dev/null 2>&1

exit 0
