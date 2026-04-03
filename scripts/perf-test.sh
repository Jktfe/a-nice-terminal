#!/usr/bin/env bash
# ANT performance test — 100 sessions, bulk inserts, query timing.
#
# Usage:
#   ANT_URL=https://localhost:6458 ANT_API_KEY=<key> ./scripts/perf-test.sh
#
# Requires: curl, jq, python3

set -euo pipefail

BASE_URL="${ANT_URL:-http://localhost:6458}"
API_KEY="${ANT_API_KEY:-}"
SESSIONS=100
MESSAGES_PER_SESSION=20
RUN_ID=$(python3 -c "import time; print(int(time.time()))")

AUTH_HEADER=""
if [[ -n "$API_KEY" ]]; then
  AUTH_HEADER="X-API-Key: $API_KEY"
fi

# Millisecond timestamp — uses python3 for portability on macOS
now_ms() { python3 -c "import time; print(int(time.time()*1000))"; }

api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-sfk -X "$method")
  [[ -n "$AUTH_HEADER" ]] && args+=(-H "$AUTH_HEADER")
  [[ -n "$body" ]] && args+=(-H "Content-Type: application/json" -d "$body")
  curl "${args[@]}" "${BASE_URL}${path}"
}

# ── Health check ──────────────────────────────────────────────────────────────
echo "→ Health check..."
api GET /api/health | jq -r '"  status: \(.status // "ok")"' 2>/dev/null || echo "  (no JSON body — daemon up)"

# ── Create sessions ───────────────────────────────────────────────────────────
echo ""
echo "→ Creating ${SESSIONS} sessions..."
SESSION_IDS=()
START=$(now_ms)
for i in $(seq 1 $SESSIONS); do
  ID=$(api POST /api/sessions \
    "{\"name\":\"perf-test-${RUN_ID}-$i\",\"type\":\"conversation\"}" | jq -r '.id')
  SESSION_IDS+=("$ID")
done
END=$(now_ms)
ELAPSED=$((END - START))
echo "  ${SESSIONS} sessions created in ${ELAPSED}ms ($(python3 -c "print(round($SESSIONS*1000/$ELAPSED))") /s)"

# ── Post messages ─────────────────────────────────────────────────────────────
echo ""
echo "→ Posting ${MESSAGES_PER_SESSION} messages to each session (${SESSIONS} sessions)..."
TOTAL_MSGS=$((SESSIONS * MESSAGES_PER_SESSION))
START=$(now_ms)
for SID in "${SESSION_IDS[@]}"; do
  for j in $(seq 1 $MESSAGES_PER_SESSION); do
    api POST "/api/sessions/${SID}/messages" \
      "{\"role\":\"human\",\"content\":\"Performance test message ${j} — the quick brown fox jumps over the lazy dog.\",\"format\":\"markdown\",\"status\":\"complete\"}" \
      > /dev/null
  done
done
END=$(now_ms)
ELAPSED=$((END - START))
echo "  ${TOTAL_MSGS} messages posted in ${ELAPSED}ms ($(python3 -c "print(round($TOTAL_MSGS*1000/$ELAPSED))") /s)"

# ── Session list query ────────────────────────────────────────────────────────
echo ""
echo "→ Session list query (p50 of 10 runs)..."
TIMES=()
for _ in $(seq 1 10); do
  T_START=$(now_ms)
  api GET /api/sessions > /dev/null
  TIMES+=($(($(now_ms) - T_START)))
done
IFS=$'\n' SORTED=($(printf '%s\n' "${TIMES[@]}" | sort -n)); unset IFS
echo "  p50=${SORTED[4]}ms  p90=${SORTED[8]}ms"

# ── Search query ──────────────────────────────────────────────────────────────
echo ""
echo "→ FTS search query (p50 of 10 runs)..."
TIMES=()
for _ in $(seq 1 10); do
  T_START=$(now_ms)
  api GET "/api/search?q=performance+test" > /dev/null
  TIMES+=($(($(now_ms) - T_START)))
done
IFS=$'\n' SORTED=($(printf '%s\n' "${TIMES[@]}" | sort -n)); unset IFS
echo "  p50=${SORTED[4]}ms  p90=${SORTED[8]}ms"

# ── Cleanup ───────────────────────────────────────────────────────────────────
echo ""
echo "→ Cleaning up ${SESSIONS} sessions..."
START=$(now_ms)
for SID in "${SESSION_IDS[@]}"; do
  api DELETE "/api/sessions/${SID}" > /dev/null || true
done
echo "  Done in $(($(now_ms) - START))ms"

echo ""
echo "✓ Performance test complete."
