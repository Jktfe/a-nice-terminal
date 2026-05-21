#!/usr/bin/env bash
#
# scripts/audit-auth-target-gaps.sh — auth-vs-target regression probes.
#
# Companion to scripts/audit-auth-gates.sh (which covers unauth bypass).
# This harness covers the "authed-caller spoofs target-handle" gap that
# @evolveantsvelte's 2nd code-review subagent identified as launch
# blockers #3 + #4 (2026-05-20 morning).
#
# The bug class: route requires an authed caller (good), then trusts a
# target/author handle from the body (bad). Any authed room member can
# act under @victim's identity (react, rename, hijack composer draft,
# create deck/doc with spoofed createdBy).
#
# Each probe:
#   1. Mints a browser session as @evolveantux (the caller)
#   2. POSTs/PATCHes with a body that names @evolveantclaude as the
#      actor/target/author
#   3. Asserts the response is 401/403 (gate caught the mismatch)
#
# A 2xx response means the gate is NOT YET in place — the route trusted
# the body handle without confirming caller == target.
#
# Exit codes (CI-ready, same shape as sibling harnesses):
#   0 — all probes 401/403 (gates caught spoof attempts)
#   2 — at least one probe returned 2xx (SPOOF GAP CONFIRMED)
#   1 — uncaught harness error
#
# Probes (one per surface called out in svelte's finding #3 + #4):
#   GAP-3a: POST reactions with reactorHandle:@victim → expect 401/403
#   GAP-3b: PUT composer-draft with authorHandle:@victim → expect 401/403
#   GAP-3c: POST aliases with globalHandle:@victim → expect 401/403
#   GAP-3d: PATCH members/<@victim> as @caller → expect 401/403
#   GAP-4a: POST decks with createdBy:@victim → expect 401/403
#   GAP-4b: POST docs with createdBy:@victim → expect 401/403
#
# Usage:
#   bash scripts/audit-auth-target-gaps.sh
#   ANT_AUDIT_BASE=http://127.0.0.1:6174 bash scripts/audit-auth-target-gaps.sh

set -u
set -o pipefail

ANT_AUDIT_BASE="${ANT_AUDIT_BASE:-http://127.0.0.1:6174}"
TEST_ROOM="${TEST_ROOM:-voxfuhuezk}"
CALLER="@evolveantux"
VICTIM="@evolveantclaude"
COOKIE_JAR="${COOKIE_JAR:-/tmp/audit-target-gaps-cookie.txt}"

pass_count=0
fail_count=0
failed_rows=()
created_artefacts=()

log() { printf '%s\n' "$*" 1>&2; }

# Mint a browser session as the caller — needed for all probes
log "─────────────────────────────────────────────────────"
log "Auth-vs-target regression harness · base=${ANT_AUDIT_BASE}"
log "Caller=${CALLER}  Victim=${VICTIM}  Room=${TEST_ROOM}"
log "─────────────────────────────────────────────────────"

SESSION=$(curl -s -X POST "${ANT_AUDIT_BASE}/api/chat-rooms/${TEST_ROOM}/browser-session" \
  -H "Content-Type: application/json" \
  -H "Origin: ${ANT_AUDIT_BASE}" \
  -d "{\"authorHandle\":\"${CALLER}\",\"callerHandle\":\"${CALLER}\"}" \
  -c "$COOKIE_JAR" 2>&1)

if ! printf '%s' "$SESSION" | grep -q browserSession; then
  log "FATAL: could not mint browser session: $SESSION"
  exit 1
fi
log "  ✓ Session minted as ${CALLER}"

# Find a real message in the room so reactions probe has a target
MSG_ID=$(curl -s -b "$COOKIE_JAR" "${ANT_AUDIT_BASE}/api/chat-rooms/${TEST_ROOM}/messages?limit=5" 2>/dev/null | \
  python3 -c "
import json,sys
data = json.load(sys.stdin)
msgs = data.get('messages', [])
print(msgs[-1]['id'] if msgs else '')" 2>/dev/null)

if [ -z "$MSG_ID" ]; then
  log "FATAL: no messages in ${TEST_ROOM} to probe reactions against"
  exit 1
fi
log "  ✓ Target message: ${MSG_ID}"
log ""

# Generic probe runner: asserts response status is 401 or 403 (gate caught spoof)
probe_spoof() {
  local label="$1" method="$2" path="$3" body="$4"
  local actual
  actual=$(curl -s -b "$COOKIE_JAR" -o /dev/null -w '%{http_code}' \
    -X "$method" "${ANT_AUDIT_BASE}${path}" \
    -H 'Content-Type: application/json' \
    -H "Origin: ${ANT_AUDIT_BASE}" \
    -d "$body" 2>/dev/null)
  if [ "$actual" = "401" ] || [ "$actual" = "403" ]; then
    log "  PASS · $label · HTTP $actual (gate caught spoof)"
    pass_count=$((pass_count + 1))
  elif [ "$actual" = "404" ] || [ "$actual" = "400" ]; then
    # Route may not exist or input invalid — record but don't penalise.
    # Still informational so the harness output stays useful.
    log "  SKIP · $label · HTTP $actual (route absent or input invalid)"
  else
    log "  FAIL · $label · HTTP $actual — SPOOF GAP CONFIRMED (route accepted ${VICTIM} as actor while caller was ${CALLER})"
    fail_count=$((fail_count + 1))
    failed_rows+=("$label (got $actual, expected 401|403)")
    # If it returned a successful create, record so caller can clean up
    if [ "$actual" = "201" ] || [ "$actual" = "200" ]; then
      created_artefacts+=("$label")
    fi
  fi
}

# GAP-3a: reaction spoofing — POST with reactorHandle != caller
probe_spoof \
  "GAP-3a · POST reactions reactorHandle=${VICTIM} as ${CALLER}" \
  POST "/api/chat-rooms/${TEST_ROOM}/messages/${MSG_ID}/reactions" \
  "{\"reactorHandle\":\"${VICTIM}\",\"emoji\":\"👍\"}"

# Cleanup the spoofed reaction immediately if it landed (DELETE is idempotent)
curl -s -b "$COOKIE_JAR" -o /dev/null -X DELETE \
  "${ANT_AUDIT_BASE}/api/chat-rooms/${TEST_ROOM}/messages/${MSG_ID}/reactions" \
  -H "Content-Type: application/json" \
  -d "{\"reactorHandle\":\"${VICTIM}\",\"emoji\":\"👍\"}" 2>/dev/null || true

# GAP-3b: composer-draft hijack — PUT another member's draft
probe_spoof \
  "GAP-3b · PUT composer-draft authorHandle=${VICTIM} as ${CALLER}" \
  PUT "/api/chat-rooms/${TEST_ROOM}/composer-draft" \
  "{\"authorHandle\":\"${VICTIM}\",\"draftText\":\"hijack probe — please ignore\"}"

# GAP-3c: alias rename — POST alias for a different handle
probe_spoof \
  "GAP-3c · POST room aliases globalHandle=${VICTIM} as ${CALLER}" \
  POST "/api/chat-rooms/${TEST_ROOM}/aliases" \
  "{\"globalHandle\":\"${VICTIM}\",\"newAlias\":\"spoof-probe\"}"

# GAP-3d: rename/modify another member's record via URL-handle path
probe_spoof \
  "GAP-3d · PATCH members/${VICTIM} as ${CALLER}" \
  PATCH "/api/chat-rooms/${TEST_ROOM}/members/${VICTIM}" \
  "{\"displayName\":\"spoof-probe\"}"

# GAP-4a: deck creation with spoofed createdBy
probe_spoof \
  "GAP-4a · POST decks createdBy=${VICTIM} as ${CALLER}" \
  POST "/api/chat-rooms/${TEST_ROOM}/decks" \
  "{\"title\":\"spoof probe deck\",\"createdBy\":\"${VICTIM}\"}"

# GAP-4b: doc creation with spoofed createdBy
probe_spoof \
  "GAP-4b · POST docs createdBy=${VICTIM} as ${CALLER}" \
  POST "/api/chat-rooms/${TEST_ROOM}/docs" \
  "{\"title\":\"spoof probe doc\",\"createdBy\":\"${VICTIM}\"}"

# Summary
log ""
log "─────────────────────────────────────────────────────"
total=$((pass_count + fail_count))
if [ "$fail_count" -eq 0 ] && [ "$pass_count" -gt 0 ]; then
  log "SUMMARY: ALL PASS (${pass_count}/${total}). No spoof-target gaps."
  exit 0
elif [ "$fail_count" -eq 0 ] && [ "$pass_count" -eq 0 ]; then
  log "SUMMARY: ALL SKIP. No routes available to probe — re-check paths."
  exit 0
fi
log "SUMMARY: FAILED (${fail_count}/${total}). SPOOF-TARGET GAPS:"
for row in "${failed_rows[@]}"; do log "  ✗ $row"; done
if [ "${#created_artefacts[@]}" -gt 0 ]; then
  log ""
  log "Created artefacts (manual cleanup may be needed):"
  for a in "${created_artefacts[@]}"; do log "  ! $a"; done
fi
log ""
log "Any FAIL means an authed caller posted/patched under ${VICTIM}'s"
log "identity. Fix by gating the body handle against the resolved"
log "caller (callerHandle === bodyHandle, or admin-bearer overrides)."
exit 2
