#!/usr/bin/env bash
#
# scripts/test-mention-fanout.sh — end-to-end acceptance smoke for the
# @mention narrowed-delivery contract (flowspec § routing).
#
# Gates @evolveantcodex's pty-inject-fanout regression fix
# (msg_php01f0sje / msg_cnkksjhdsp). Codex's unit tests in
# src/lib/server/pty-inject-fanout.test.ts cover the internal contract;
# THIS script is the operational acceptance gate — hit the live server,
# observe terminal panes, assert exactly the expected set of panes
# received the inject.
#
# Contract being asserted — quoted verbatim from the fresh-ANT manual
# (2026-05-13 internal reference; canonical text now lives in
# audits/2026-05-13-mention-routing.md per flowspec routing § ):
#
#   "A bare @handle is routing syntax: ANT treats it as an instruction
#    to deliver to that named agent or terminal. A bracketed handle is
#    just text."
#
# Operationalised as 4 cases:
#
#   1. bare @<handle> in body          → inject ONLY @<handle>'s terminal
#   2. bracketed [@<handle>] in body   → inject NO terminals (text only)
#   3. plain "hey can someone help"    → inject all non-browser member terminals (#159)
#   4. @everyone in body               → inject all member terminals EXCEPT sender
#
# Out of scope for this smoke (separate flowspec-contract regressions —
# audit next, do NOT bundle into the bare-@ patch):
#   - Focus-mode digest: messages to a focused agent should queue, not
#     pty-inject. Manual: "Focused. Owner has flipped focus mode on;
#     messages queue to a digest."
#   - Heads-down responder walk: manual specifies ANT walks the room's
#     ordered responder list, skips busy, stops on accept. v4 currently
#     just refuses-to-inject at fanout L168-174.
#
# Exit 0 on all-pass, 1 on any-fail. Per-row PASS/FAIL line + one-line summary at end.
#
# Pre-reqs:
#   - ant server reachable on $ANT_BASE (default http://localhost:6174)
#   - ant CLI on PATH (used for posting messages with valid identity)
#   - tmux on PATH (used to capture pane contents)
#   - rover terminal IS a member of $TEST_ROOM_ID

set -u
set -o pipefail

ANT_BASE="${ANT_BASE:-http://localhost:6174}"
TEST_ROOM_ID="${TEST_ROOM_ID:-lz0udiayuh}"   # @evolveantux is a member
PROBE_TAG="rover-fanout-probe-$$-$(date +%s)"
POST_SETTLE_SECONDS="${POST_SETTLE_SECONDS:-2}"

# Test-handle constants. The smoke asserts behaviour for ONE bare/bracket
# target; ROVER_BARE_TARGET should be a real member of TEST_ROOM_ID whose
# terminal exists. @evolveantclaude is in lz0udiayuh.
ROVER_BARE_TARGET="${ROVER_BARE_TARGET:-@evolveantclaude}"

pass_count=0
fail_count=0
failed_rows=()

log() { printf '%s\n' "$*" 1>&2; }

# ── Helpers ───────────────────────────────────────────────────────────

list_room_member_terminals() {
  # Returns lines of "<handle>|<tmuxTargetPane>" for each member of
  # $TEST_ROOM_ID that has a terminal record. Skips the sender (@you).
  curl -s "${ANT_BASE}/api/terminals" \
    | python3 -c "
import sys, json
d = json.load(sys.stdin)
terminals = d.get('terminals', d if isinstance(d, list) else [])
for t in terminals:
    handle = t.get('derivedHandle') or t.get('handle')
    pane   = t.get('tmuxTargetPane')
    if handle and pane:
        print(f'{handle}|{pane}')
"
}

capture_pane_tail() {
  # $1 = tmux target pane (eg sessId:0.0). Print last 30 lines of pane.
  local pane="$1"
  tmux capture-pane -t "$pane" -p 2>/dev/null | tail -30 || true
}

count_panes_with_probe() {
  # $1 = probe tag to search for. Tally panes containing this tag.
  # Per-case tags prevent case-1's delivery leaking into case-2..4 reads.
  # Returns: total_hits<TAB>matched_handle1,matched_handle2,...
  local tag="$1"
  local hits=0
  local matched=()
  while IFS='|' read -r handle pane; do
    if capture_pane_tail "$pane" | grep -q "$tag"; then
      hits=$((hits + 1))
      matched+=("$handle")
    fi
  done < <(list_room_member_terminals)
  printf '%s\t%s\n' "$hits" "$(IFS=,; echo "${matched[*]:-}")"
}

post_test_message() {
  # $1 = message body. Posts to $TEST_ROOM_ID using `ant rooms post`
  # which carries pidChain identity for the running terminal.
  local body="$1"
  ant rooms post "$TEST_ROOM_ID" "$body" 2>&1 | tail -3
}

run_case() {
  # $1 = case label, $2 = per-case probe tag, $3 = body template
  # (use %TAG% placeholder), $4 = expected hits, $5 = expected handles
  local label="$1" tag="$2" body_template="$3"
  local expected_hits="$4" expected_match="$5"
  local body="${body_template//%TAG%/$tag}"
  log ""
  log "── case: $label"
  log "   tag:      $tag"
  log "   body:     $body"
  log "   expected: $expected_hits hit(s) on [$expected_match]"

  post_test_message "$body" > /dev/null
  sleep "$POST_SETTLE_SECONDS"

  local result
  result="$(count_panes_with_probe "$tag")"
  local got_hits="${result%%	*}"
  local got_match="${result##*	}"

  if [[ "$got_hits" == "$expected_hits" && "$got_match" == "$expected_match" ]]; then
    log "   PASS — hits=$got_hits matched=[$got_match]"
    pass_count=$((pass_count + 1))
  else
    log "   FAIL — got hits=$got_hits matched=[$got_match] (expected hits=$expected_hits matched=[$expected_match])"
    fail_count=$((fail_count + 1))
    failed_rows+=("$label")
  fi
}

# ── Pre-flight ────────────────────────────────────────────────────────

log "─────────────────────────────────────────────────────"
log "Mention fanout smoke — probe tag: $PROBE_TAG"
log "Target room: $TEST_ROOM_ID  base: $ANT_BASE"
log "Bare-target handle: $ROVER_BARE_TARGET"
log "─────────────────────────────────────────────────────"

if ! command -v ant > /dev/null; then
  log "FATAL: ant CLI not on PATH"; exit 2
fi
if ! command -v tmux > /dev/null; then
  log "FATAL: tmux not on PATH"; exit 2
fi
if ! curl -fs "${ANT_BASE}/api/health" > /dev/null; then
  log "FATAL: cannot reach ${ANT_BASE}/api/health"; exit 2
fi

# Capture the universe of member terminals so we know what 'all' means.
member_count=$(list_room_member_terminals | wc -l | tr -d ' ')
log "Member terminals in room: $member_count"
list_room_member_terminals | sed 's/^/  - /' 1>&2

# ── Cases ─────────────────────────────────────────────────────────────

# Case 1: bare @<handle> → exactly that handle's terminal hit
run_case \
  "bare @<handle> narrowed delivery" \
  "${PROBE_TAG}-c1" \
  "%TAG% bare $ROVER_BARE_TARGET — narrowed delivery probe, please ignore" \
  "1" \
  "$ROVER_BARE_TARGET"

# Case 2: bracketed [@<handle>] → no terminal inject
run_case \
  "bracketed [@<handle>] informational only" \
  "${PROBE_TAG}-c2" \
  "%TAG% bracketed [$ROVER_BARE_TARGET] — informational probe, please ignore" \
  "0" \
  ""

# Case 3: plain message → all non-browser member terminals
others_count=$((member_count - 1))
others_handles=$(list_room_member_terminals | awk -F'|' '$1 != "@evolveantux" {print $1}' | paste -sd, -)
run_case \
  "plain message → broadcast to non-browser members (#159 P0)" \
  "${PROBE_TAG}-c3" \
  "%TAG% plain — broadcast probe, please ignore" \
  "$others_count" \
  "$others_handles"

# Case 4: @everyone → broadcast to all member terminals except sender
run_case \
  "@everyone broadcast (sender excluded)" \
  "${PROBE_TAG}-c4" \
  "%TAG% everyone @everyone — broadcast probe, please ignore" \
  "$others_count" \
  "$others_handles"

# ── Summary ──────────────────────────────────────────────────────────

log ""
log "─────────────────────────────────────────────────────"
total=$((pass_count + fail_count))
if [[ $fail_count -eq 0 ]]; then
  log "SUMMARY: ALL PASS ($pass_count/$total). Routing contract holds."
  exit 0
fi

log "SUMMARY: FAILED ($fail_count/$total)."
for row in "${failed_rows[@]}"; do
  log "  ✗ $row"
done
log "─────────────────────────────────────────────────────"
exit 1
