#!/bin/bash
# ANT chat poller — runs as a Claude Code / Codex CLI Stop hook.
# Outputs only genuinely new messages so the agent sees them in context.
#
# Env-driven (svelte patch 2026-05-19 per JWPK msg_gnv0oeuva2 + slide 5 #1
# of deck aae67ba4 in zj4jlety9q). Replaces the previous hardcoded
# Tailscale URL + session id with env vars so other operators can use
# the same hook against their own ANT instance.
#
# Required env (set in ~/.ant/secrets.env or your shell rc):
#   ANT_SERVER_URL   (default: http://127.0.0.1:6174)
#   ANT_SESSION_ID   (no default; required — the session to poll for chat)
#
# Codex-specific opt-in: the codex variant of this hook also gates on
# CODEX_POLL_ANT_CHAT=1 (defaults off) because automatic chat injection
# can make Codex continue a turn without a direct user prompt. The
# installer (`scripts/ant-cli-hooks.mjs`) layers that gate when deploying
# this template to ~/.codex/hooks/poll-ant-chat.sh.

SESSION_ID="${ANT_SESSION_ID:-}"
SERVER="${ANT_SERVER_URL:-http://127.0.0.1:6174}"
LAST_SEEN_FILE="/tmp/.ant-claude-last-seen"
COOLDOWN=10

if [ -z "$SESSION_ID" ]; then
  # No session configured — nothing to poll. Silent exit so the Stop
  # hook never blocks the agent.
  exit 0
fi

# Rate limit
if [ -f "$LAST_SEEN_FILE" ]; then
  last_ts=$(stat -f %m "$LAST_SEEN_FILE" 2>/dev/null || echo 0)
  now_ts=$(date +%s)
  if [ $((now_ts - last_ts)) -lt "$COOLDOWN" ]; then
    exit 0
  fi
fi

# Get last 3 messages (compact). curl --max-time 2 guarantees the hook
# returns within 2s even if the server is down — agent never hangs.
output=$(ant chat read "$SESSION_ID" --limit 3 --server "$SERVER" 2>/dev/null | tail -20)

if [ -z "$output" ]; then
  exit 0
fi

# Check if we've already seen this exact output
prev=""
[ -f "$LAST_SEEN_FILE" ] && prev=$(cat "$LAST_SEEN_FILE")
hash=$(echo "$output" | md5 -q 2>/dev/null || echo "$output" | md5sum | cut -d' ' -f1)

if [ "$hash" = "$prev" ]; then
  # No new messages
  touch "$LAST_SEEN_FILE"
  exit 0
fi

# New messages — output them and save hash
echo "$hash" > "$LAST_SEEN_FILE"
echo "=== ANT Chat Update ==="
echo "$output"
echo "=== End ==="
exit 0
