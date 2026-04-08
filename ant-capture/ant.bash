# ANT shell integration for bash
# Sources automatically when ANT_SESSION_ID is set.
#
# Emits OSC 133 prompt markers and posts structured command events
# to antd via the capture event log.
#
# This gives ANT:
#   - Precise command boundaries (not quiet-period heuristics)
#   - Exit codes, timing, CWD per command
#   - Works even if antd is down (events written to file, ingested on reconnect)

# Guard: only activate if running inside an ANT capture session
[ -z "$ANT_SESSION_ID" ] && return

# Guard: don't double-capture nested shells (e.g. tmux pane spawning a sub-shell)
if [ "${ANT_CAPTURE_DEPTH:-0}" -gt 1 ]; then
  return
fi

__ant_event_dir="${ANT_CAPTURE_DIR:-${HOME}/.local/state/ant/capture}"
__ant_event_file="${__ant_event_dir}/${ANT_SESSION_ID}.events"

# Timestamp in milliseconds
__ant_ms() {
  if command -v gdate &>/dev/null; then
    gdate +%s%3N
  elif date +%s%3N &>/dev/null 2>&1; then
    date +%s%3N
  else
    echo $(( $(date +%s) * 1000 ))
  fi
}

# Write a JSON event line to the events file (newline-delimited JSON)
__ant_emit() {
  echo "$1" >> "$__ant_event_file"
}

# JSON-escape a string
__ant_json_str() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\t'/\\t}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  printf '"%s"' "$s"
}

# Track state between preexec and precmd
__ant_cmd_start_ms=""
__ant_current_cmd=""

# --- preexec: fires just before a command executes ---
__ant_preexec() {
  __ant_cmd_start_ms="$(__ant_ms)"
  __ant_current_cmd="$1"

  printf '\033]133;C\007'

  __ant_emit "{\"event\":\"command_start\",\"session\":\"${ANT_SESSION_ID}\",\"command\":$(__ant_json_str "$1"),\"cwd\":\"${PWD}\",\"ts\":${__ant_cmd_start_ms}}"
}

# --- precmd: fires just before the prompt is displayed ---
__ant_precmd() {
  local exit_code=$?
  local end_ms="$(__ant_ms)"

  printf '\033]133;D;%s\007' "$exit_code"

  if [ -n "$__ant_cmd_start_ms" ]; then
    local duration_ms=$(( end_ms - __ant_cmd_start_ms ))
    __ant_emit "{\"event\":\"command_end\",\"session\":\"${ANT_SESSION_ID}\",\"command\":$(__ant_json_str "$__ant_current_cmd"),\"exit_code\":${exit_code},\"cwd\":\"${PWD}\",\"duration_ms\":${duration_ms},\"ts\":${end_ms}}"
    __ant_cmd_start_ms=""
    __ant_current_cmd=""
  fi

  printf '\033]133;A\007'

  printf '\033]7;file://%s%s\007' "$(hostname)" "$PWD"
}

# --- Install hooks ---
if [[ -n "${bash_preexec_imported:-}" ]]; then
  precmd_functions+=(__ant_precmd)
  preexec_functions+=(__ant_preexec)
else
  __ant_original_prompt_command="${PROMPT_COMMAND:-}"

  PROMPT_COMMAND='__ant_precmd'
  if [ -n "$__ant_original_prompt_command" ]; then
    PROMPT_COMMAND="__ant_precmd; ${__ant_original_prompt_command}"
  fi

  __ant_debug_trap() {
    [[ "$BASH_COMMAND" == "__ant_precmd"* ]] && return
    [[ "$BASH_COMMAND" == "${__ant_original_prompt_command}"* ]] && return

    if [ -z "$__ant_cmd_start_ms" ]; then
      __ant_preexec "$BASH_COMMAND"
    fi
  }
  trap '__ant_debug_trap' DEBUG
fi

printf '\033]133;A\007'
