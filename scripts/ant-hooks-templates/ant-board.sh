#!/bin/bash
# Quick task board view for ANT coordination.
#
# Env-driven (rover patch 2026-05-19 per JWPK msg_gnv0oeuva2 + slide 5#1
# of deck aae67ba4 in zj4jlety9q). Replaces the previous hardcoded
# Tailscale URL + API key + session id with env vars so other operators
# can use the same hook against their own ANT instance.
#
# Required env (set in ~/.ant/secrets.env or your shell rc):
#   ANT_SERVER_URL   (default: http://127.0.0.1:6174)
#   ANT_SESSION_ID   (no default; required for board view)
#   ANT_API_KEY      (no default; required if your server expects x-api-key)

SERVER="${ANT_SERVER_URL:-http://127.0.0.1:6174}"
SESSION="${ANT_SESSION_ID:-}"
API_KEY="${ANT_API_KEY:-}"

if [ -z "$SESSION" ]; then
  echo "ant board: ANT_SESSION_ID env not set; nothing to show."
  echo "  Set it in ~/.ant/secrets.env or your shell rc."
  exit 0
fi

# Build curl headers conditionally so the script works against a dev
# server that doesn't require an API key.
HDRS=()
if [ -n "$API_KEY" ]; then
  HDRS+=(-H "x-api-key: $API_KEY")
fi

echo "=== ANT Task Board ==="
curl -s --max-time 2 "${HDRS[@]}" "$SERVER/api/sessions/$SESSION/tasks" 2>/dev/null | \
  python3 -c "
import json,sys
try:
    data=json.load(sys.stdin)
    tasks=data.get('tasks',[])
    if not tasks:
        print('  (no tasks or unreachable server)')
    for t in tasks:
        a=t.get('assigned_to','?') or '?'
        s=t.get('status','?')
        print(f'  [{t[\"id\"][:8]}] {s:10} {a:12} {t[\"title\"][:55]}')
except Exception:
    print('  (failed to load — server may be down; ANT board is best-effort)')
" 2>/dev/null

echo ""
echo "=== Last 3 Chat Messages ==="
if command -v ant >/dev/null 2>&1; then
  ant chat read "$SESSION" --limit 3 --server "$SERVER" 2>/dev/null | tail -10
else
  echo "  (ant CLI not on PATH)"
fi
echo "=== End ==="
