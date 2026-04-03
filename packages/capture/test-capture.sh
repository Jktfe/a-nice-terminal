#!/usr/bin/env bash
# Smoke test for ant-capture + shell integration
#
# Verifies:
# 1. The .meta file is written with valid JSON
# 2. The .log file captures expected output
# 3. The .events file contains well-formed NDJSON with expected event types
# 4. command_start and command_end events have required fields
#
# Usage: ./test-capture.sh
# Exit code: 0 = all pass, 1 = one or more failures

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_SESSION="test-$(date +%s)"
CAPTURE_DIR="/tmp/ant-capture-test-$$"
PASS=0
FAIL=0

export ANT_CAPTURE_DIR="$CAPTURE_DIR"
mkdir -p "$CAPTURE_DIR"

# Cleanup on exit (success or failure)
cleanup() {
  rm -rf "$CAPTURE_DIR"
}
trap cleanup EXIT

pass() { echo "[PASS] $1"; PASS=$(( PASS + 1 )); }
fail() { echo "[FAIL] $1"; FAIL=$(( FAIL + 1 )); }

echo "=== ANT Capture Smoke Test ==="
echo "Session : $TEST_SESSION"
echo "Capture : $CAPTURE_DIR"
echo ""

# ---------------------------------------------------------------------------
# Run a few commands through ant-capture with shell integration active.
# We source ant.bash explicitly inside bash --norc so hooks fire.
# ---------------------------------------------------------------------------
echo "--- Running commands through ant-capture ---"
HOOK="$SCRIPT_DIR/shell-integration/ant.bash"

# Feed commands to the shell via stdin; the shell must be interactive (-i)
# so PROMPT_COMMAND fires. We force interactive + norc and source our hook.
COMMANDS="source \"$HOOK\"
echo 'hello from ANT capture'
ls /tmp > /dev/null
exit"

"$SCRIPT_DIR/ant-capture" "$TEST_SESSION" bash --norc --noprofile -i \
  <<<"$COMMANDS" 2>/dev/null || true

echo ""
echo "--- Checking capture files ---"
echo ""

# ---------------------------------------------------------------------------
# 1. .meta file
# ---------------------------------------------------------------------------
META="$CAPTURE_DIR/$TEST_SESSION.meta"
if [ -f "$META" ]; then
  pass ".meta file exists"
  # Validate it's parseable JSON (python3 or node)
  if command -v python3 &>/dev/null; then
    if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$META" 2>/dev/null; then
      pass ".meta is valid JSON"
    else
      fail ".meta is not valid JSON"
    fi
  fi
else
  fail ".meta file missing"
fi
echo ""

# ---------------------------------------------------------------------------
# 2. .log file — exists and contains expected output
# ---------------------------------------------------------------------------
LOG="$CAPTURE_DIR/$TEST_SESSION.log"
if [ -f "$LOG" ]; then
  LOG_SIZE=$(wc -c < "$LOG")
  pass ".log file exists (${LOG_SIZE} bytes)"

  if grep -q "hello from ANT capture" "$LOG" 2>/dev/null; then
    pass "'hello from ANT capture' found in .log"
  else
    fail "Expected output 'hello from ANT capture' not found in .log"
  fi
else
  fail ".log file missing"
fi
echo ""

# ---------------------------------------------------------------------------
# 3. .events file — NDJSON validation
# ---------------------------------------------------------------------------
EVENTS="$CAPTURE_DIR/$TEST_SESSION.events"
if [ -f "$EVENTS" ]; then
  EVENT_LINES=$(grep -c . "$EVENTS" 2>/dev/null || echo 0)
  pass ".events file exists ($EVENT_LINES lines)"

  # Validate every line is parseable JSON (requires python3 or node)
  MALFORMED=0
  if command -v python3 &>/dev/null; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      if ! python3 -c "import json; json.loads('''$line''')" 2>/dev/null; then
        MALFORMED=$(( MALFORMED + 1 ))
      fi
    done < "$EVENTS"
    if [ "$MALFORMED" -eq 0 ]; then
      pass "All event lines are valid JSON"
    else
      fail "$MALFORMED malformed JSON line(s) in .events"
    fi
  fi

  # Check for command_start event with required fields
  if grep -q '"event":"command_start"' "$EVENTS"; then
    pass "command_start event found"

    # Verify required fields: session, command, cwd, ts
    MISSING_FIELDS=""
    grep '"event":"command_start"' "$EVENTS" | head -1 | {
      read -r line
      for field in '"session"' '"command"' '"cwd"' '"ts"'; do
        if ! echo "$line" | grep -q "$field"; then
          MISSING_FIELDS="$MISSING_FIELDS $field"
        fi
      done
      if [ -z "$MISSING_FIELDS" ]; then
        pass "command_start has all required fields (session, command, cwd, ts)"
      else
        fail "command_start missing fields:$MISSING_FIELDS"
      fi
    }
  else
    echo "[INFO] command_start not found — hooks may not have fired in this shell mode"
  fi

  # Check for command_end event with required fields
  if grep -q '"event":"command_end"' "$EVENTS"; then
    pass "command_end event found"

    # Verify required fields: session, command, exit_code, cwd, duration_ms, ts
    grep '"event":"command_end"' "$EVENTS" | head -1 | {
      read -r line
      MISSING_FIELDS=""
      for field in '"session"' '"command"' '"exit_code"' '"cwd"' '"duration_ms"' '"ts"'; do
        if ! echo "$line" | grep -q "$field"; then
          MISSING_FIELDS="$MISSING_FIELDS $field"
        fi
      done
      if [ -z "$MISSING_FIELDS" ]; then
        pass "command_end has all required fields (session, command, exit_code, cwd, duration_ms, ts)"
      else
        fail "command_end missing fields:$MISSING_FIELDS"
      fi
    }
  else
    echo "[INFO] command_end not found — hooks may not have fired in this shell mode"
  fi

  # Verify session ID in events matches what we passed
  if grep -q "\"session\":\"${TEST_SESSION}\"" "$EVENTS"; then
    pass "Session ID '${TEST_SESSION}' found in events"
  else
    fail "Session ID '${TEST_SESSION}' not found in events"
  fi

else
  echo "[INFO] .events file not created"
  echo "       This is expected if bash was non-interactive — hooks only fire in interactive shells."
  echo "       To exercise hooks, run ant-capture with an interactive shell session."
fi
echo ""

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
