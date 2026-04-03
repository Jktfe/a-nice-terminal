#!/usr/bin/env bash
# ANT performance test — 100 sessions, bulk inserts, query timing.
#
# Usage:
#   ANT_URL=http://localhost:6458 ANT_API_KEY=<key> ./scripts/perf-test.sh
#
# Requires: curl, jq

set -euo pipefail

BASE_URL="${ANT_URL:-http://localhost:6458}"
API_KEY="${ANT_API_KEY:-}"
SESSIONS=100
MESSAGES_PER_SESSION=20

AUTH_HEADER=""
if [[ -n "$API_KEY" ]]; then
  AUTH_HEADER="X-API-Key: $API_KEY"
fi

api() {
  local method="$1"; shift
  local path="$1"; shift
  local body="${1:-}"
  local extra_args=()
  if [[ -n "$AUTH_HEADER" ]]; then extra_args+=(-H "$AUTH_HEADER"); fi
  if [[ -n "$body" ]]; then
    curl -sf -X "$method" "${extra_args[@]}" \
      -H "Content-Type: application/json" \
      -d "$body" \
      "${BASE_URL}${path}"
  else
    curl -sf -X "$method" "${extra_args[@]}" "${BASE_URL}${path}"
  fi
}

# ── Health check ──────────────────────────────────────────────────────────────
echo "→ Health check..."
api GET /api/health | jq -r '"  status: \(.status // "ok")"' 2>/dev/null || echo "  (no JSON body — daemon up)"

# ── Create sessions ───────────────────────────────────────────────────────────
echo ""
echo "→ Creating ${SESSIONS} sessions..."
SESSION_IDS=()
START=$(date +%s%3N)
for i in $(seq 1 $SESSIONS); do
  ID=$(api POST /api/sessions \
    "{\"name\":\"perf-test-$i\",\"type\":\"conversation\"}" | jq -r '.id')
  SESSION_IDS+=("$ID")
done
END=$(date +%s%3N)
ELAPSED=$((END - START))
echo "  ${SESSIONS} sessions created in ${ELAPSED}ms ($(( SESSIONS * 1000 / ELAPSED )) /s)"

# ── Post messages ─────────────────────────────────────────────────────────────
echo ""
echo "→ Posting ${MESSAGES_PER_SESSION} messages to each session (${SESSIONS} sessions)..."
TOTAL_MSGS=$((SESSIONS * MESSAGES_PER_SESSION))
START=$(date +%s%3N)
for SID in "${SESSION_IDS[@]}"; do
  for j in $(seq 1 $MESSAGES_PER_SESSION); do
    api POST "/api/sessions/${SID}/messages" \
      "{\"role\":\"human\",\"content\":\"Performance test message ${j} — the quick brown fox jumps over the lazy dog.\",\"format\":\"markdown\",\"status\":\"complete\"}" \
      > /dev/null
  done
done
END=$(date +%s%3N)
ELAPSED=$((END - START))
echo "  ${TOTAL_MSGS} messages posted in ${ELAPSED}ms ($(( TOTAL_MSGS * 1000 / ELAPSED )) /s)"

# ── Session list query ────────────────────────────────────────────────────────
echo ""
echo "→ Session list query (p50 of 10 runs)..."
TIMES=()
for _ in $(seq 1 10); do
  T_START=$(date +%s%3N)
  api GET /api/sessions > /dev/null
  T_END=$(date +%s%3N)
  TIMES+=($((T_END - T_START)))
done
# Sort and take median
IFS=$'\n' SORTED=($(sort -n <<<"${TIMES[*]}")); unset IFS
P50="${SORTED[4]}"
P90="${SORTED[8]}"
echo "  p50=${P50}ms  p90=${P90}ms"

# ── Search query ──────────────────────────────────────────────────────────────
echo ""
echo "→ FTS search query (p50 of 10 runs)..."
TIMES=()
for _ in $(seq 1 10); do
  T_START=$(date +%s%3N)
  api GET "/api/search?q=performance+test" > /dev/null
  T_END=$(date +%s%3N)
  TIMES+=($((T_END - T_START)))
done
IFS=$'\n' SORTED=($(sort -n <<<"${TIMES[*]}")); unset IFS
P50="${SORTED[4]}"
P90="${SORTED[8]}"
echo "  p50=${P50}ms  p90=${P90}ms"

# ── Cleanup ───────────────────────────────────────────────────────────────────
echo ""
echo "→ Cleaning up ${SESSIONS} sessions..."
START=$(date +%s%3N)
for SID in "${SESSION_IDS[@]}"; do
  api DELETE "/api/sessions/${SID}" > /dev/null || true
done
END=$(date +%s%3N)
echo "  Done in $((END - START))ms"

echo ""
echo "✓ Performance test complete."
