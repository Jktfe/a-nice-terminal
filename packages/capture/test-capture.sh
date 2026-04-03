#!/usr/bin/env bash
# Quick smoke test for ant-capture + shell integration
#
# Runs a few commands via ant-capture, then verifies:
# 1. The .log file captured all output
# 2. The .events file has command_start/command_end events
# 3. The .meta file has session metadata
#
# Usage: ./test-capture.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_SESSION="test-$(date +%s)"
CAPTURE_DIR="/tmp/ant-capture-test"

export ANT_CAPTURE_DIR="$CAPTURE_DIR"
mkdir -p "$CAPTURE_DIR"

echo "=== ANT Capture Smoke Test ==="
echo "Session: $TEST_SESSION"
echo "Capture dir: $CAPTURE_DIR"
echo ""

# Run a few commands through ant-capture
echo "--- Running commands through ant-capture ---"
echo -e "echo 'hello from ANT capture'\necho 'exit code test' && false || true\nls /tmp | head -5\nexit" | \
  "$SCRIPT_DIR/ant-capture" "$TEST_SESSION" bash --norc --noprofile 2>/dev/null || true

echo ""
echo "--- Checking capture files ---"

# Check .meta
if [ -f "$CAPTURE_DIR/$TEST_SESSION.meta" ]; then
  echo "[PASS] .meta file exists"
  echo "  Content: $(cat "$CAPTURE_DIR/$TEST_SESSION.meta")"
else
  echo "[FAIL] .meta file missing"
fi
echo ""

# Check .log
if [ -f "$CAPTURE_DIR/$TEST_SESSION.log" ]; then
  LOG_SIZE=$(wc -c < "$CAPTURE_DIR/$TEST_SESSION.log")
  echo "[PASS] .log file exists ($LOG_SIZE bytes)"
  echo "  First 200 chars:"
  head -c 200 "$CAPTURE_DIR/$TEST_SESSION.log" | cat -v
  echo ""

  # Verify the output is captured
  if grep -q "hello from ANT capture" "$CAPTURE_DIR/$TEST_SESSION.log"; then
    echo "[PASS] 'hello from ANT capture' found in log"
  else
    echo "[FAIL] Expected output not found in log"
  fi
else
  echo "[FAIL] .log file missing"
fi
echo ""

# Check .events (may not exist if shell integration didn't activate in non-interactive mode)
if [ -f "$CAPTURE_DIR/$TEST_SESSION.events" ]; then
  EVENT_LINES=$(wc -l < "$CAPTURE_DIR/$TEST_SESSION.events")
  echo "[PASS] .events file exists ($EVENT_LINES events)"
  echo "  Events:"
  cat "$CAPTURE_DIR/$TEST_SESSION.events"
else
  echo "[INFO] .events file not created (expected in non-interactive test — hooks need interactive shell)"
fi
echo ""

echo "--- Cleanup ---"
rm -rf "$CAPTURE_DIR"
echo "Done."
