#!/bin/bash
# ANT Hook — forwards Claude Code events to the ANT server
#
# Receives JSON on stdin from Claude Code hooks system.
# Adds ant_session_id and POSTs to the ANT hooks API.
#
# Environment:
#   ANT_SERVER  — ANT server URL (default: https://localhost:6458)
#   ANT_SESSION — ANT terminal session ID (set by session startup)

INPUT=$(cat)
ANT_SERVER="${ANT_SERVER:-https://localhost:6458}"

# Inject the ANT session ID so the server knows which session this came from
PAYLOAD=$(echo "$INPUT" | jq -c ". + {\"ant_session_id\": \"${ANT_SESSION:-unknown}\"}")

# Fire and forget — don't block Claude Code
curl -sk -X POST "${ANT_SERVER}/api/hooks" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  > /dev/null 2>&1

exit 0
