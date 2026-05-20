#!/usr/bin/env bash
#
# scripts/audit-auth-gates.sh — auth-gate regression probes.
#
# Per @evolveantclaude security audit (subagent commits b2af0a6 +
# c233595 + CVE-B fix) closing 3 unauth bypass classes. This harness
# ensures the gates STAY closed — runs against the live server and
# asserts that auth-required endpoints reject unauthenticated requests
# with 401.
#
# Exit codes (CI-ready):
#   0 — all probes 401 unauth (gates closed)
#   2 — at least one probe returned non-401 unauth (BYPASS REGRESSION)
#   1 — uncaught harness error
#
# Probes (one per CVE-class):
#   CVE-A: POST /api/terminals/<id>/input  unauth → expect 401
#   CVE-A: POST /api/terminals/<id>/escape unauth → expect 401
#   CVE-B: POST /api/terminals/<id>/kill   with `callerHandle: '@you'` only → expect 401
#   CVE-C: PATCH /api/chat-rooms/<id>/name unauth → expect 401
#
# Extension probes (svelte pre-launch code-review blockers, 2026-05-20):
#   CVE-D: POST /api/cron-jobs unauth → expect 401 (cron-auth, B1 blocker)
#   CVE-E: POST /api/plan-triggers/<id>/fire unauth → expect 401 (planTrigger SSRF)
#   CVE-F: PATCH /api/terminals/<id>/settings unauth → expect 401 (settings IDOR, LAUNCH-3)
#   CVE-G: GET /api/agents/<handle>/availability-digest unauth → expect 401 (LAUNCH-5)
#   CVE-H: GET /api/asks/<askId>/pickup unauth → expect 401 (LAUNCH-5)
#
# Usage:
#   bash scripts/audit-auth-gates.sh
#   ANT_AUDIT_BASE=http://127.0.0.1:6174 bash scripts/audit-auth-gates.sh

set -u
set -o pipefail

ANT_AUDIT_BASE="${ANT_AUDIT_BASE:-http://127.0.0.1:6174}"
TEST_TID="${TEST_TID:-probe-tid-does-not-need-to-exist}"
TEST_ROOM="${TEST_ROOM:-zj4jlety9q}"

pass_count=0
fail_count=0
failed_rows=()

log() { printf '%s\n' "$*" 1>&2; }

probe_status() {
  local label="$1" method="$2" path="$3" body="$4" expected="$5"
  local actual ok=0
  actual=$(curl -s -o /dev/null -w '%{http_code}' \
    -X "$method" "${ANT_AUDIT_BASE}${path}" \
    -H 'Content-Type: application/json' \
    -d "$body" 2>/dev/null)
  # Accept "|"-separated list of expected codes (e.g. "401|404" for fail-closed endpoints)
  local IFS='|'
  for code in $expected; do
    if [ "$actual" = "$code" ]; then ok=1; break; fi
  done
  if [ $ok -eq 1 ]; then
    log "  PASS · $label · HTTP $actual"
    pass_count=$((pass_count + 1))
  else
    log "  FAIL · $label · HTTP $actual (expected $expected) — BYPASS REGRESSION"
    fail_count=$((fail_count + 1))
    failed_rows+=("$label (got $actual, expected $expected)")
  fi
}

log "─────────────────────────────────────────────────────"
log "Auth-gate regression harness · base=${ANT_AUDIT_BASE}"
log "Ensures CVE-A/B/C bypass classes stay CLOSED."
log "─────────────────────────────────────────────────────"

# CVE-A: keystroke injection via /input + /escape must require auth
probe_status \
  "CVE-A · POST /api/terminals/${TEST_TID}/input unauth → 401" \
  POST "/api/terminals/${TEST_TID}/input" \
  '{"text":"x"}' 401

probe_status \
  "CVE-A · POST /api/terminals/${TEST_TID}/escape unauth → 401" \
  POST "/api/terminals/${TEST_TID}/escape" \
  '{}' 401

# CVE-B: callerHandle self-claim ('@you' shortcut) must NOT pass
probe_status \
  "CVE-B · POST /api/terminals/${TEST_TID}/kill with callerHandle:@you only → 401" \
  POST "/api/terminals/${TEST_TID}/kill" \
  '{"callerHandle":"@you"}' 401

# CVE-C: chat-room sub-routes must require auth (claude's c233595)
probe_status \
  "CVE-C · PATCH /api/chat-rooms/${TEST_ROOM}/name unauth → 401" \
  PATCH "/api/chat-rooms/${TEST_ROOM}/name" \
  '{"name":"probe"}' 401

# CVE-D: cron-jobs creation must require auth (svelte 090b579, B1 blocker)
probe_status \
  "CVE-D · POST /api/cron-jobs unauth → 401" \
  POST "/api/cron-jobs" \
  '{"cron":"*/5 * * * *","prompt":"probe"}' 401

# CVE-E: plan trigger fire must require auth — SSRF prevention (svelte 894c100)
probe_status \
  "CVE-E · POST /api/plan-triggers/probe-trigger/fire unauth → 401" \
  POST "/api/plan-triggers/probe-trigger/fire" \
  '{}' 401

# CVE-F: terminal settings PATCH must require auth — IDOR prevention (LAUNCH-3)
probe_status \
  "CVE-F · PATCH /api/terminals/${TEST_TID}/settings unauth → 401" \
  PATCH "/api/terminals/${TEST_TID}/settings" \
  '{"theme":"dark"}' 401

# CVE-G: availability-digest must require auth — private room leak (LAUNCH-5)
probe_status \
  "CVE-G · GET /api/agents/@evolveantsvelte/availability-digest unauth → 401" \
  GET "/api/agents/@evolveantsvelte/availability-digest" \
  '' 401

# CVE-H: asks pickup — private room leak (LAUNCH-5)
# Accept 401 (unknown caller) OR 404 (fail-closed: don't leak ask-existence
# even to anonymous callers, per the route's documented gate).
probe_status \
  "CVE-H · GET /api/asks/probe-ask-id/pickup unauth → 401|404" \
  GET "/api/asks/probe-ask-id/pickup" \
  '' '401|404'

# Summary
log ""
log "─────────────────────────────────────────────────────"
total=$((pass_count + fail_count))
if [ "$fail_count" -eq 0 ]; then
  log "SUMMARY: ALL PASS ($pass_count/$total). Auth gates closed."
  exit 0
fi
log "SUMMARY: FAILED ($fail_count/$total). BYPASS REGRESSION DETECTED:"
for row in "${failed_rows[@]}"; do log "  ✗ $row"; done
log ""
log "Any FAIL means an auth-required endpoint accepted an"
log "unauthenticated request. Reproduce the failing probe + patch"
log "the route to use resolveCallerIdentityStrict or equivalent."
exit 2
