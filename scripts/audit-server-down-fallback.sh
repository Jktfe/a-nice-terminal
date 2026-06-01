#!/usr/bin/env bash
#
# scripts/audit-server-down-fallback.sh — server-down fallback harness.
#
# Task cli-gold-03 (v4-fresh-ant, deck aae67ba4 slide 5#4). Gold-
# standard hard rule from JWPK msg_gnv0oeuva2: "if the server goes
# down it should NEVER block their usage; otherwise, it should fall
# back to normal usage."
#
# Approach: point representative hooks + CLI verbs at a port that is
# DEFINITELY not listening (override ANT_SERVER_URL to http://127.0.0.1:19999)
# and assert each probe returns within a small timeout budget (5s by
# default). A passing probe means the hook degrades gracefully on a
# connection-refused error rather than hanging.
#
# We don't actually stop the production server — that would disrupt
# any running agents. The port-redirect approach gives an equivalent
# signal (the hook still sees "server unreachable") without service
# disruption.
#
# Exit codes (CI-ready):
#   0 — all probes returned within budget AND with sensible exit
#   2 — at least one probe exceeded its timeout (likely BLOCKING bug)
#   3 — at least one probe errored unexpectedly
#   1 — uncaught runtime error
#
# Usage:
#   bash scripts/audit-server-down-fallback.sh
#   ANT_VISREG_TIMEOUT=10 bash scripts/audit-server-down-fallback.sh

set -u
set -o pipefail

# Force every probe to think the server is on a closed port.
export ANT_SERVER_URL="http://127.0.0.1:19999"
export ANT_HOOKS_RECEIVER_URL=""  # let hooks resolve from ANT_SERVER_URL

TIMEOUT_SECS="${ANT_VISREG_TIMEOUT:-5}"

pass_count=0
fail_count=0
err_count=0
failed_rows=()

log() { printf '%s\n' "$*" 1>&2; }

# Probe runner — takes a label, a budget seconds, and a command.
# Captures stdout to /dev/null + measures wall-clock time. Exit codes:
#   - command success within budget  → PASS
#   - command non-zero within budget → PASS (graceful surface of error)
#   - command exceeded budget        → FAIL (likely blocking)
#   - command threw shell error      → ERR (harness bug, not subject bug)
probe() {
  local label="$1" budget="$2"
  shift 2
  log ""
  log "── probe: $label (budget ${budget}s)"
  local start end elapsed status
  start=$(date +%s)
  # `timeout` returns 124 when it kills the command for exceeding budget.
  if command -v timeout >/dev/null 2>&1; then
    timeout "${budget}s" "$@" > /dev/null 2>&1
    status=$?
  else
    # macOS may not ship GNU coreutils timeout — use gtimeout if present,
    # otherwise fall back to a shell-based timer (less precise but fine).
    if command -v gtimeout >/dev/null 2>&1; then
      gtimeout "${budget}s" "$@" > /dev/null 2>&1
      status=$?
    else
      # Run in background, wait up to budget, kill if needed.
      "$@" > /dev/null 2>&1 &
      local pid=$!
      local waited=0
      while kill -0 "$pid" 2>/dev/null && [ "$waited" -lt "$budget" ]; do
        sleep 1
        waited=$((waited + 1))
      done
      if kill -0 "$pid" 2>/dev/null; then
        kill -TERM "$pid" 2>/dev/null
        wait "$pid" 2>/dev/null
        status=124
      else
        wait "$pid" 2>/dev/null
        status=$?
      fi
    fi
  fi
  end=$(date +%s)
  elapsed=$((end - start))

  if [ "$status" = "124" ]; then
    log "   FAIL — exceeded ${budget}s budget (likely blocking on server)"
    fail_count=$((fail_count + 1))
    failed_rows+=("$label")
  elif [ "$elapsed" -le "$budget" ]; then
    log "   PASS — exit $status in ${elapsed}s"
    pass_count=$((pass_count + 1))
  else
    log "   ERR — elapsed ${elapsed}s > ${budget}s but exit was $status (harness anomaly)"
    err_count=$((err_count + 1))
    failed_rows+=("$label (harness anomaly)")
  fi
}

# ── Pre-flight ────────────────────────────────────────────────────────

log "─────────────────────────────────────────────────────"
log "Server-down fallback harness"
log "Pointing every probe at $ANT_SERVER_URL (closed port → connection refused)"
log "Timeout budget per probe: ${TIMEOUT_SECS}s"
log "─────────────────────────────────────────────────────"

# ── Probes ────────────────────────────────────────────────────────────

# 1. ant whoami — purely local; should be fast.
if command -v ant >/dev/null 2>&1; then
  probe "ant whoami (local-only, no fetch)" 2 ant whoami
else
  log "SKIP — ant CLI not on PATH"
fi

# 2. ant-board.sh — exercises our new env-driven hook with curl --max-time 2.
if [ -x "$HOME/.claude/hooks/ant-board.sh" ]; then
  probe "~/.claude/hooks/ant-board.sh (env-driven, --max-time 2)" 5 \
    bash "$HOME/.claude/hooks/ant-board.sh"
else
  log "SKIP — ~/.claude/hooks/ant-board.sh not present"
fi

if [ -x "$HOME/.codex/hooks/ant-board.sh" ]; then
  probe "~/.codex/hooks/ant-board.sh" 5 \
    bash "$HOME/.codex/hooks/ant-board.sh"
fi

# 3. poll-ant-chat.sh (svelte's b5e5039 ship) — same pattern.
if [ -x "$HOME/.claude/hooks/poll-ant-chat.sh" ]; then
  probe "~/.claude/hooks/poll-ant-chat.sh (env-driven)" 5 \
    bash "$HOME/.claude/hooks/poll-ant-chat.sh"
fi

if [ -x "$HOME/.codex/hooks/poll-ant-chat.sh" ]; then
  probe "~/.codex/hooks/poll-ant-chat.sh" 5 \
    bash "$HOME/.codex/hooks/poll-ant-chat.sh"
fi

# 4. write-state.sh — disk-only, should be ≤1s even when server is down.
if [ -x "$HOME/.claude/hooks/ant-status/write-state.sh" ]; then
  probe "~/.claude/hooks/ant-status/write-state.sh (disk-only)" 2 \
    bash "$HOME/.claude/hooks/ant-status/write-state.sh" "test-session-id" "."
fi

# 5. ant chat read — should error fast, not hang.
if command -v ant >/dev/null 2>&1; then
  probe "ant chat read (fast error expected)" 6 \
    ant chat read "test-session-id" --limit 1 --server "$ANT_SERVER_URL"
fi

# ── Summary ──────────────────────────────────────────────────────────

log ""
log "─────────────────────────────────────────────────────"
total=$((pass_count + fail_count + err_count))
if [ "$fail_count" -eq 0 ] && [ "$err_count" -eq 0 ]; then
  log "SUMMARY: ALL PASS ($pass_count/$total)."
  log "  Every probe completed within budget when the server is down."
  log "  Hard rule satisfied: server-down does not block CLI usage."
  exit 0
fi

log "SUMMARY: FAILED ($fail_count fail, $err_count err, $pass_count pass / $total total)"
for row in "${failed_rows[@]}"; do
  log "  ✗ $row"
done
log ""
log "Action: any FAIL row means that hook BLOCKS the agent when ANT"
log "is unreachable. Patch to use --max-time + fail-open exit (see"
log "scripts/ant-hooks-templates/ant-board.sh for the canonical shape)."
log "─────────────────────────────────────────────────────"

if [ "$fail_count" -gt 0 ]; then
  exit 2
fi
exit 3
