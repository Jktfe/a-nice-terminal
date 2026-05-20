#!/usr/bin/env bash
# Idle status script for localant: posts a terse line tagging @evolveantclaude
# when agents have been idle for >15 minutes.

CHANNEL="zj4jlety9q"
NOW=$(date +%s)
THRESHOLD=$(( NOW - 900 )) # 15 minutes in seconds

# Example agent data: name:last_activity_epoch
# Replace with real source (e.g., API call or database query)
AGENTS="agent1:$(date -d '2026-05-18 09:00' +%s) agent2:$(date -d '2026-05-18 09:30' +%s) agent3:$(date -d '2026-05-18 10:20' +%s)"

IDLE=()
for entry in $AGENTS; do
  IFS=':' read -r name ts <<< "$entry"
  if (( ts < THRESHOLD )); then
    IDLE+=("$name")
  fi
done

# If no idle agents, exit silently
if [ ${#IDLE[@]} -eq 0 ]; then
  exit 0
fi

# Build timestamps for idle agents (placeholder formatting)
TIMESTAMPS=""
for entry in $AGENTS; do
  IFS=':' read -r name ts <<< "$entry"
  if [[ " ${IDLE[@]} " =~ " $name " ]]; then
    ts_str=$(date -d @${ts} '+%Y-%m-%d %H:%M')
    TIMESTAMPS+="$name:$ts_str "
  fi
done

# Compose message
MESSAGE="Idle agents: ${IDLE[*]} | Last activity: $TIMESTAMPS | @evolveantclaude"

# Send via ANT CLI
ant chat send "$CHANNEL" --msg "$MESSAGE"
