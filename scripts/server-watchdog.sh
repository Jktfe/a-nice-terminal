#!/usr/bin/env bash
# server-watchdog — self-healing band-aid for the event-loop-hang class
# (JWPK msg_2026-05-24 "still down…"; Silent heroes yz4clwzvbm diag).
#
# Symptom: ant-server proc holds :6174 but stops responding. SIGTERM is
# ignored (event-loop block); only `kill -9` lets launchd respawn.
#
# This script runs as its own launchd job on a 30s tick, hits the health
# endpoint with a 5s curl timeout, and force-kills the ant-server PID if
# the probe fails for two consecutive ticks. Two-tick threshold prevents
# a spurious one-off slow probe from killing a healthy server.
#
# State is held in /tmp/ant-server-watchdog.state (a single integer:
# consecutive failure count). Reset on the first successful probe.
#
# Exits 0 always — the launchd job stays clean even when it kills the
# server; the kill itself triggers respawn via the main com.ant.server
# job's KeepAlive policy.

set -u

readonly HEALTH_URL="http://127.0.0.1:6174/api/health"
readonly STATE_FILE="/tmp/ant-server-watchdog.state"
readonly LOG_FILE="/tmp/ant-server-watchdog.log"
readonly TIMEOUT_SECONDS=5
readonly KILL_AFTER_FAILS=2
readonly SERVICE_LABEL="com.ant.server"

log() {
  printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" >> "$LOG_FILE"
}

read_state() {
  if [[ -r "$STATE_FILE" ]]; then
    local raw
    raw="$(cat "$STATE_FILE" 2>/dev/null || printf '0')"
    if [[ "$raw" =~ ^[0-9]+$ ]]; then
      printf '%s' "$raw"
      return
    fi
  fi
  printf '0'
}

write_state() {
  printf '%s' "$1" > "$STATE_FILE" 2>/dev/null || true
}

probe_healthy() {
  curl --silent --show-error \
    --max-time "$TIMEOUT_SECONDS" \
    --output /dev/null \
    --write-out '%{http_code}' \
    "$HEALTH_URL" 2>/dev/null | grep -q '^200$'
}

find_server_pid() {
  # launchctl print is the canonical state source — falls back to lsof
  # if launchd is in a weird state.
  local pid
  pid="$(launchctl print "gui/$(id -u)/$SERVICE_LABEL" 2>/dev/null | awk -F'=' '/^[[:space:]]+pid[[:space:]]+=/{gsub(/^ +| +$/,"",$2); print $2; exit}')"
  if [[ -n "$pid" && "$pid" != "-" && "$pid" != "0" ]]; then
    printf '%s' "$pid"
    return
  fi
  pid="$(lsof -ti :6174 2>/dev/null | head -1)"
  printf '%s' "${pid:-}"
}

fails="$(read_state)"

if probe_healthy; then
  if [[ "$fails" != "0" ]]; then
    log "probe healthy after $fails consecutive fail(s); resetting"
    write_state "0"
  fi
  exit 0
fi

fails=$((fails + 1))
write_state "$fails"
log "probe failed ($fails consecutive)"

if [[ "$fails" -ge "$KILL_AFTER_FAILS" ]]; then
  pid="$(find_server_pid)"
  if [[ -n "$pid" ]]; then
    log "killing ant-server pid=$pid after $fails failures"
    kill -9 "$pid" 2>/dev/null || log "kill -9 $pid failed (perhaps already gone)"
  else
    log "no ant-server pid found despite failed probe — launchd may already be restarting"
  fi
  # Let launchd's KeepAlive respawn; reset counter so the next cycle
  # gives the new proc a clean slate.
  write_state "0"
fi

exit 0
